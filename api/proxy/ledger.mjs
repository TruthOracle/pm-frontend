import { keycloakBearer } from "./_keycloakToken.mjs";
import { authorise } from "../_lib/proxyGuard.mjs";

// VITE_APP_NETWORK=mainnet points the app at the dedicated zkpc node, whose
// Keycloak holds DIFFERENT credentials from the digik (devnet) set. On mainnet
// only the ZKPC_* values are read — no fallback to the devnet names — so a
// misconfigured deploy fails fast instead of silently minting tokens against
// the wrong Keycloak (the participant rejects those with an opaque 401).
const IS_MAINNET = (process.env.VITE_APP_NETWORK || "").trim().toLowerCase() === "mainnet";

const TARGET_ENV = IS_MAINNET
  ? ["ZKPC_LEDGER_API_URL"]
  : ["CANTON_LEDGER_PROXY_TARGET_URL", "VITE_CANTON_PARTICIPANT_URL"];

// The Ledger API requires a Bearer JWT (Keycloak client_credentials). This proxy
// mints one server-side and injects it, so the client id/secret never reach the
// browser bundle.
//
// ACCESS: read-only query paths are public — the active-contracts query only for the
// treasury's market data, any other read as the treasury needs an admin session (F1); the
// interactive submission (prepare / execute) is public except as the treasury or with a body that
// names whose ledger rights to use (userId), and refused entirely while
// VITE_ENTERPRISE_WALLET_PARTY_ID is unset; a short list of GET diagnostics
// needs an admin session; everything else — /v2/users, /v2/parties, package uploads, command
// submission — is 403 relay_write_disabled for everyone (see ../_lib/proxyGuard.mjs).
// The injected token holds ParticipantAdmin — the same authority
// truthoracle-contracts/scripts/grant-rights.ts relies on — so an open /v2/users/*/rights
// would let anyone grant themselves act-as on any party hosted here.
const AUTH_PREFIXES = IS_MAINNET
  ? ["ZKPC_KEYCLOAK"]
  : ["LEDGER_KEYCLOAK", "KEYCLOAK", "VITE_KEYCLOAK"];

function absoluteTarget(value) {
  const trimmed = typeof value === "string" ? value.trim().replace(/\/$/, "") : "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : "";
}

function targetFor() {
  for (const name of TARGET_ENV) {
    const target = absoluteTarget(process.env[name]);
    if (target) return target;
  }
  return "";
}

const METHOD_OVERRIDE_HEADERS = ["x-http-method-override", "x-http-method", "x-method-override"];

async function headersForUpstream(req) {
  const headers = { ...req.headers };
  delete headers.host;
  delete headers.connection;
  delete headers["content-length"];
  // Always REPLACE the caller's Authorization rather than passing it through: the relay's own
  // token is the only credential the participant sees, and a caller-supplied bearer would be a
  // second, unreviewed way in. The session cookie and its instance header are for this relay only.
  delete headers.authorization;
  delete headers.cookie;
  delete headers["x-admin-instance"];
  // A method override would let a checked POST arrive upstream as something else.
  for (const name of METHOD_OVERRIDE_HEADERS) delete headers[name];
  const token = await keycloakBearer(AUTH_PREFIXES);
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

// Prepared transactions and active-contract queries stay far below this; it only bounds
// what an anonymous caller of the public paths could make the function buffer.
export const MAX_BODY_BYTES = 8 * 1024 * 1024;

class BodyTooLarge extends Error {}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on("data", (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        failed = true;
        reject(new BodyTooLarge());
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!failed) resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });
}

function refuse(res, status, error, message) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(message ? { error, message } : { error }));
}

function proxyPath(req) {
  const value = Array.isArray(req.query.path) ? req.query.path.join("/") : req.query.path;
  return String(value || "").split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

function proxyQuery(req) {
  const url = new URL(req.url, "http://localhost");
  url.searchParams.delete("path");
  return url.searchParams.toString() ? `?${url.searchParams.toString()}` : "";
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  const gate = authorise({ req, path: proxyPath(req), kind: "ledger", method: req.method });
  if (!gate.allow) {
    if (gate.error === "relay_write_disabled") {
      console.warn(`[ledger-proxy] refused ${req.method} ${proxyPath(req)}`);
    }
    refuse(res, gate.status, gate.error, gate.message);
    return;
  }

  const target = targetFor();
  if (!target) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      error: "Missing proxy target for ledger",
      expectedEnv: TARGET_ENV,
    }));
    return;
  }

  let body;
  try {
    body = ["GET", "HEAD"].includes(req.method || "") ? undefined : await readBody(req);
  } catch (e) {
    if (e instanceof BodyTooLarge) {
      refuse(res, 413, "body_too_large", `Request body exceeds ${MAX_BODY_BYTES} bytes.`);
      return;
    }
    throw e;
  }
  if (gate.inspect) {
    // The active-contracts query: whose contracts it reads decides public or session (F1). The
    // interactive submission: never as the treasury, never naming a ledger user. Checked before
    // the relay mints its token, so a refused body never reaches Keycloak either.
    const verdict = await gate.inspect(body);
    if (!verdict.allow) {
      console.warn(`[ledger-proxy] refused ${req.method} ${proxyPath(req)}: ${verdict.message ?? verdict.error}`);
      refuse(res, verdict.status, verdict.error, verdict.message);
      return;
    }
    body = verdict.body;
  }
  const headers = await headersForUpstream(req);
  // The checked JSON is what goes upstream, labelled as JSON whatever the caller sent.
  if (gate.inspect) headers["content-type"] = "application/json";
  const upstream = await fetch(`${target}/${proxyPath(req)}${proxyQuery(req)}`, {
    method: req.method,
    headers,
    body,
    redirect: "manual",
  });

  res.statusCode = upstream.status;
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (!["content-encoding", "content-length", "transfer-encoding"].includes(lower)) {
      res.setHeader(key, value);
    }
  });
  res.end(Buffer.from(await upstream.arrayBuffer()));
}
