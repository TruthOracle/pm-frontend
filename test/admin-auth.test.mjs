/**
 * Tests for the admin auth stack: nonces, sessions, the operator allowlist, Ed25519
 * signature verification, and the proxy access policy.
 *
 * Run with `npm test` (plain `node --test`, no framework). Everything here is pure
 * Node against the modules in api/_lib — no network, no ledger.
 */

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { generateKeyPairSync, sign as ed25519Sign } from "node:crypto";

import {
  SESSION_COOKIE,
  allowedOperators,
  consumeNonce,
  isAllowedOperator,
  isConfigured,
  issueNonce,
  issueSession,
  operatorPublicKey,
  readCookie,
  verifySession,
} from "../api/_lib/adminSession.mjs";
import { verifyPartySignature } from "../api/_lib/verifyPartySignature.mjs";
import { authorise } from "../api/_lib/proxyGuard.mjs";

const SECRET = "test-secret-0123456789abcdef0123456789abcdef";
const PARTY = "operator::1220aabbccddeeff00112233445566778899aabbccddeeff001122334455667788";
// The page-load binding token a browser would hold in JS memory (base64url, ≥22 chars).
const INSTANCE = "dGVzdC1pbnN0YW5jZS10b2tlbi0xMjM0NTY";

function operatorKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  // Raw 32-byte public key = the tail of the SPKI DER encoding.
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  return { raw, privateKey };
}

function configure({ publicKeyEncoding = "hex" } = {}) {
  const { raw, privateKey } = operatorKeypair();
  process.env.ADMIN_SESSION_SECRET = SECRET;
  process.env.ADMIN_OPERATORS = `${PARTY}=${raw.toString(publicKeyEncoding)}`;
  delete process.env.ADMIN_SESSION_TTL_HOURS;
  return { raw, privateKey };
}

beforeEach(() => {
  delete process.env.ADMIN_SESSION_SECRET;
  delete process.env.ADMIN_OPERATORS;
  delete process.env.ADMIN_SESSION_TTL_HOURS;
});

describe("configuration", () => {
  it("is unconfigured without a secret, or with a short one", () => {
    assert.equal(isConfigured(), false);
    process.env.ADMIN_SESSION_SECRET = "too-short";
    assert.equal(isConfigured(), false);
    process.env.ADMIN_SESSION_SECRET = SECRET;
    assert.equal(isConfigured(), true);
  });
});

describe("login nonce", () => {
  beforeEach(() => configure());

  it("round-trips", () => {
    const { nonce, expiresAt } = issueNonce();
    assert.ok(expiresAt > Date.now());
    assert.equal(consumeNonce(nonce).ok, true);
  });

  it("rejects a replay (same warm instance)", () => {
    const { nonce } = issueNonce();
    assert.equal(consumeNonce(nonce).ok, true);
    const replay = consumeNonce(nonce);
    assert.equal(replay.ok, false);
    assert.match(replay.reason, /already used/);
  });

  it("rejects tampering with the timestamp", () => {
    const { nonce } = issueNonce();
    const [random, issuedAt, mac] = nonce.split(".");
    const forged = `${random}.${Number(issuedAt) - 10 * 60 * 1000}.${mac}`;
    assert.equal(consumeNonce(forged).ok, false);
  });

  it("rejects garbage", () => {
    assert.equal(consumeNonce("").ok, false);
    assert.equal(consumeNonce("a.b").ok, false);
    assert.equal(consumeNonce("a.b.c.d").ok, false);
  });
});

describe("session tokens", () => {
  beforeEach(() => configure());

  it("round-trips and reports the party", () => {
    const { token, expiresAt } = issueSession(PARTY, INSTANCE);
    const session = verifySession(token, INSTANCE);
    assert.ok(session);
    assert.equal(session.partyId, PARTY);
    assert.equal(session.expiresAt, expiresAt);
  });

  it("is bound to one page load: the cookie alone proves nothing", () => {
    const { token } = issueSession(PARTY, INSTANCE);
    // A reload wipes the in-memory token — the surviving cookie must be inert.
    assert.equal(verifySession(token, ""), null, "no instance token");
    assert.equal(verifySession(token, undefined), null, "missing instance token");
    assert.equal(
      verifySession(token, "c29tZS1vdGhlci1wYWdlLWxvYWQtdG9rZW4"),
      null,
      "a different page load's token must not unlock the session",
    );
  });

  it("refuses to issue a session without a valid instance token", () => {
    assert.throws(() => issueSession(PARTY));
    assert.throws(() => issueSession(PARTY, "short"));
    assert.throws(() => issueSession(PARTY, "not base64url!!"));
  });

  it("rejects a tampered payload even with the original MAC", () => {
    const { token } = issueSession(PARTY, INSTANCE);
    const [, issuedAt, expiresAt, boundHash, mac] = token.split(".");
    const otherParty = Buffer.from("intruder::1220ff", "utf8").toString("base64url");
    assert.equal(
      verifySession(`${otherParty}.${issuedAt}.${expiresAt}.${boundHash}.${mac}`, INSTANCE),
      null,
    );
  });

  it("revokes immediately when the party leaves ADMIN_OPERATORS", () => {
    const { token } = issueSession(PARTY, INSTANCE);
    assert.ok(verifySession(token, INSTANCE));
    process.env.ADMIN_OPERATORS = "";
    assert.equal(verifySession(token, INSTANCE), null, "live cookie must die with the allowlist entry");
  });
});

describe("operator allowlist", () => {
  it("parses comma- and whitespace-separated entries, splitting on the first '='", () => {
    // base64 keys may end in '=' padding — the value must survive intact.
    process.env.ADMIN_OPERATORS = `a::1220aa=Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaQ==, b::1220bb=deadbeef\n c::1220cc=cafe`;
    const ops = allowedOperators();
    assert.equal(ops.get("a::1220aa"), "Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaQ==");
    assert.equal(ops.get("b::1220bb"), "deadbeef");
    assert.equal(ops.get("c::1220cc"), "cafe");
    assert.equal(isAllowedOperator("a::1220aa"), true);
    assert.equal(isAllowedOperator("A::1220AA"), false, "party ids are case-sensitive");
    assert.equal(operatorPublicKey("missing::1220dd"), "");
  });
});

describe("verifyPartySignature", () => {
  const message = "challenge.1234567890.mac";

  for (const keyEnc of ["hex", "base64", "base64url"]) {
    for (const sigEnc of ["hex", "base64", "base64url"]) {
      it(`verifies key=${keyEnc} signature=${sigEnc}`, () => {
        const { raw, privateKey } = operatorKeypair();
        const sig = ed25519Sign(null, Buffer.from(message, "utf8"), privateKey);
        const result = verifyPartySignature({
          message,
          signature: sig.toString(sigEnc),
          publicKey: raw.toString(keyEnc),
        });
        assert.equal(result.ok, true, JSON.stringify(result));
        assert.equal(result.form, "utf8");
      });
    }
  }

  it("verifies a wallet that pre-hashes the message", async () => {
    const { createHash } = await import("node:crypto");
    const { raw, privateKey } = operatorKeypair();
    const digest = createHash("sha256").update(Buffer.from(message, "utf8")).digest();
    const sig = ed25519Sign(null, digest, privateKey);
    const result = verifyPartySignature({
      message,
      signature: sig.toString("base64"),
      publicKey: raw.toString("hex"),
    });
    assert.equal(result.ok, true);
    assert.equal(result.form, "sha256(utf8)");
  });

  it("rejects a signature from a different key", () => {
    const { privateKey } = operatorKeypair();
    const { raw: otherPub } = operatorKeypair();
    const sig = ed25519Sign(null, Buffer.from(message, "utf8"), privateKey);
    const result = verifyPartySignature({
      message,
      signature: sig.toString("hex"),
      publicKey: otherPub.toString("hex"),
    });
    assert.equal(result.ok, false);
  });

  it("rejects a signature over a different message", () => {
    const { raw, privateKey } = operatorKeypair();
    const sig = ed25519Sign(null, Buffer.from("some other nonce", "utf8"), privateKey);
    const result = verifyPartySignature({
      message,
      signature: sig.toString("hex"),
      publicKey: raw.toString("hex"),
    });
    assert.equal(result.ok, false);
  });

  it("rejects malformed inputs without throwing", () => {
    assert.equal(verifyPartySignature({ message, signature: "xx", publicKey: "yy" }).ok, false);
    assert.equal(verifyPartySignature({ message: "", signature: "", publicKey: "" }).ok, false);
  });
});

describe("proxy access policy", () => {
  const HOST = "app.example.com";

  function request({ cookie = "", origin, host = HOST, instance = INSTANCE } = {}) {
    const headers = { host };
    if (cookie) {
      headers.cookie = cookie;
      if (instance) headers["x-admin-instance"] = instance;
    }
    if (origin !== undefined) headers.origin = origin;
    return { headers };
  }

  function sessionCookieHeader() {
    const { token } = issueSession(PARTY, INSTANCE);
    return `${SESSION_COOKIE}=${encodeURIComponent(token)}`;
  }

  it("allows public ledger reads without any auth or configuration", () => {
    const gate = authorise({ req: request(), path: "v2/state/active-contracts", kind: "ledger" });
    assert.deepEqual(gate, { allow: true, operator: null });
  });

  it("fails CLOSED with 503 on privileged paths when auth is unconfigured", () => {
    const gate = authorise({ req: request(), path: "v2/users/x/rights", kind: "ledger" });
    assert.equal(gate.allow, false);
    assert.equal(gate.status, 503);
  });

  it("requires a session for every wallet path", () => {
    configure();
    // api/v1/accounts is the exact read that was reachable anonymously on the old
    // open relay — the wallet allowlist must stay empty, reads included.
    for (const path of ["api/v1/transfer", "api/v1/accounts", "api/v1/external/submit"]) {
      const gate = authorise({ req: request(), path, kind: "wallet" });
      assert.equal(gate.allow, false, `wallet path should be denied: ${path}`);
      assert.equal(gate.status, 401);
    }
  });

  it("denies wallet reads even before auth is configured (fail closed)", () => {
    const gate = authorise({ req: request(), path: "api/v1/accounts", kind: "wallet" });
    assert.equal(gate.allow, false);
    assert.equal(gate.status, 503);
  });

  it("admits a valid operator session", () => {
    configure();
    const gate = authorise({
      req: request({ cookie: sessionCookieHeader() }),
      path: "api/v1/external/submit",
      kind: "wallet",
    });
    assert.equal(gate.allow, true);
    assert.equal(gate.operator.partyId, PARTY);
  });

  it("rejects a session cookie without its page-instance header (the reload case)", () => {
    configure();
    const gate = authorise({
      req: request({ cookie: sessionCookieHeader(), instance: "" }),
      path: "api/v1/external/submit",
      kind: "wallet",
    });
    assert.equal(gate.allow, false);
    assert.equal(gate.status, 401);
  });

  it("does not treat path decoration as an allowlist match", () => {
    configure();
    for (const path of [
      "v2/state/active-contracts/../../users/x/rights",
      "/v2/users/x/rights?fake=v2/state/active-contracts",
      "V2/STATE/ACTIVE-CONTRACTS",
    ]) {
      const gate = authorise({ req: request(), path, kind: "ledger" });
      assert.equal(gate.allow, false, `path should not be public: ${path}`);
    }
  });

  it("rejects cross-origin requests carrying a session (CSRF fence)", () => {
    configure();
    const cookie = sessionCookieHeader();
    for (const origin of ["https://evil.example.net", "null", "not a url"]) {
      const gate = authorise({
        req: request({ cookie, origin }),
        path: "api/v1/transfer",
        kind: "wallet",
      });
      assert.equal(gate.allow, false, `origin should be rejected: ${origin}`);
      assert.equal(gate.status, 403);
    }
  });

  it("accepts same-origin and origin-less requests with a session", () => {
    configure();
    const cookie = sessionCookieHeader();
    for (const origin of [`https://${HOST}`, undefined]) {
      const gate = authorise({
        req: request({ cookie, origin }),
        path: "api/v1/transfer",
        kind: "wallet",
      });
      assert.equal(gate.allow, true, `origin should be accepted: ${origin}`);
    }
  });

  it("survives an undecodable cookie instead of throwing pre-auth", () => {
    configure();
    assert.equal(readCookie({ headers: { cookie: `${SESSION_COOKIE}=%zz%` } }, SESSION_COOKIE), "");
    const gate = authorise({
      req: request({ cookie: `${SESSION_COOKIE}=%zz%` }),
      path: "api/v1/transfer",
      kind: "wallet",
    });
    assert.equal(gate.allow, false);
    assert.equal(gate.status, 401);
  });
});
