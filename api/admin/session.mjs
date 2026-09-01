/**
 * POST /api/admin/session — exchange a signed nonce for an admin session cookie.
 *
 * Body: { partyId, nonce, signature, instanceToken }
 *
 * There is deliberately no `publicKey` field. The verifying key comes from the
 * server-pinned ADMIN_OPERATORS map; accepting one from the caller would let anyone
 * sign our nonce with a freshly generated keypair and claim any party id.
 *
 * `instanceToken` is the page-load binding: random bytes the browser holds only in JS
 * memory. Its hash is baked into the session, and every privileged call must echo the
 * token in the x-admin-instance header — so a reload (which wipes JS memory) forces a
 * fresh wallet signature even though the cookie survives.
 */

import {
  consumeNonce,
  isConfigured,
  issueSession,
  operatorPublicKey,
  sessionCookie,
} from "../_lib/adminSession.mjs";
import { describeAttempt, verifyPartySignature } from "../_lib/verifyPartySignature.mjs";
import { hitRateLimit, requestClientKey } from "../_lib/sharedStore.mjs";

// Fleet-wide when a shared store is configured, per-warm-instance otherwise — the
// real protection either way is that a valid signature requires a pinned private key.
// Sized to be invisible to a human operator.
const ATTEMPT_WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 10;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 16 * 1024) reject(new Error("body too large"));
      else chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  res.setHeader("cache-control", "no-store");
  res.setHeader("content-type", "application/json");

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: "method not allowed" }));
    return;
  }
  if (!isConfigured()) {
    res.statusCode = 503;
    res.end(JSON.stringify({ error: "admin auth is not configured on this deployment" }));
    return;
  }

  const { limited } = await hitRateLimit(
    `rl:login:${requestClientKey(req)}`,
    ATTEMPT_WINDOW_MS,
    MAX_ATTEMPTS,
  );
  if (limited) {
    res.statusCode = 429;
    res.end(JSON.stringify({ error: "too many attempts, try again shortly" }));
    return;
  }

  let body;
  try {
    body = JSON.parse((await readBody(req)) || "{}");
  } catch {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "invalid JSON body" }));
    return;
  }

  const partyId = String(body.partyId ?? "").trim();
  const nonce = String(body.nonce ?? "").trim();
  const signature = String(body.signature ?? "").trim();
  const instanceToken = String(body.instanceToken ?? "").trim();
  if (!partyId || !nonce || !signature || !instanceToken) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "partyId, nonce, signature and instanceToken are required" }));
    return;
  }

  const nonceCheck = await consumeNonce(nonce);
  if (!nonceCheck.ok) {
    res.statusCode = 401;
    res.end(JSON.stringify({ error: "challenge rejected", detail: nonceCheck.reason }));
    return;
  }

  // Uniform response whether the party is unknown or the signature is wrong: telling
  // the caller which one failed turns this into an operator-enumeration oracle.
  const pinnedKey = operatorPublicKey(partyId);
  const result = pinnedKey
    ? verifyPartySignature({ message: nonce, signature, publicKey: pinnedKey })
    : { ok: false, reason: "party is not a configured operator" };

  if (!result.ok) {
    console.warn(
      `[admin-auth] rejected login for ${partyId}: ${result.reason}` +
        (pinnedKey ? ` — ${describeAttempt({ signature, publicKey: pinnedKey })}` : ""),
    );
    res.statusCode = 401;
    res.end(JSON.stringify({ error: "authentication failed" }));
    return;
  }

  let token;
  let expiresAt;
  try {
    ({ token, expiresAt } = issueSession(partyId, instanceToken));
  } catch {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "instanceToken is malformed" }));
    return;
  }
  console.log(`[admin-auth] session issued for ${partyId} (preimage form: ${result.form})`);
  res.setHeader("set-cookie", sessionCookie(token, expiresAt - Date.now()));
  res.statusCode = 200;
  res.end(JSON.stringify({ partyId, expiresAt }));
}
