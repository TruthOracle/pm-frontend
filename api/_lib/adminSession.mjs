/**
 * Stateless admin auth primitives: login nonces and session cookies.
 *
 * Both are HMAC-stamped blobs rather than rows in a store — the proxies run as
 * isolated serverless invocations with no shared memory or database, so anything
 * requiring server-side state would have to be re-fetched on every call. The
 * signing key is ADMIN_SESSION_SECRET (server-only; never VITE_-prefixed).
 *
 * Nonce:   <random>.<issuedAtMs>.<hmac>        — 5 minute window, single use
 *          (best effort; see consumeNonce)
 * Session: <partyId>.<issuedAtMs>.<expiresAtMs>.<instanceHash>.<hmac>
 *
 * A session is BOUND TO ONE PAGE LOAD. At login the browser generates a random
 * instance token that lives only in JS memory (never in storage) and the server bakes
 * its sha256 into the cookie token. Every privileged request must present the token
 * in the x-admin-instance header; the cookie alone proves nothing. Reloading or
 * leaving the page wipes JS memory, so every new page document requires a fresh
 * wallet signature — the cookie that survives the reload is inert.
 *
 * Every comparison uses timingSafeEqual: a byte-by-byte `===` on a MAC leaks the
 * position of the first mismatch, which is enough to forge one over many requests.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const NONCE_TTL_MS = 5 * 60 * 1000;
// Short by design: the session authorises treasury-signed actions, and renewing it
// costs the operator one wallet popup. Expiry is absolute, not sliding — activity
// never extends a session, so a stolen cookie has a hard ceiling.
const DEFAULT_SESSION_TTL_MS = 15 * 60 * 1000;
const MAX_SESSION_TTL_HOURS = 24;
export const SESSION_COOKIE = "to_admin";
export const INSTANCE_HEADER = "x-admin-instance";

/** Shape gate for the client-generated instance token (base64url of ≥16 random bytes). */
function validInstanceToken(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{22,128}$/.test(value);
}

function instanceHash(instanceToken) {
  return createHash("sha256").update(instanceToken, "utf8").digest("base64url");
}

function secret() {
  const value = process.env.ADMIN_SESSION_SECRET;
  if (typeof value !== "string" || value.trim().length < 32) {
    throw new Error(
      "ADMIN_SESSION_SECRET is missing or shorter than 32 characters. " +
        "Generate one with: openssl rand -hex 32",
    );
  }
  return value.trim();
}

/** True when admin auth is configured at all. Callers must FAIL CLOSED when false. */
export function isConfigured() {
  const value = process.env.ADMIN_SESSION_SECRET;
  return typeof value === "string" && value.trim().length >= 32;
}

function sign(payload) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

function macMatches(payload, mac) {
  const expected = Buffer.from(sign(payload), "utf8");
  const actual = Buffer.from(String(mac ?? ""), "utf8");
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

// ---------------------------------------------------------------------------
// Login nonce
// ---------------------------------------------------------------------------

export function issueNonce() {
  const issuedAt = Date.now();
  const payload = `${randomBytes(18).toString("base64url")}.${issuedAt}`;
  return { nonce: `${payload}.${sign(payload)}`, expiresAt: issuedAt + NONCE_TTL_MS };
}

/**
 * Warm-instance replay guard. A cold invocation starts with an empty set, so this
 * narrows the replay window rather than closing it — the 5 minute TTL and HTTPS do
 * the real work. Swap for Redis/KV if a shared store ever exists.
 */
const spent = new Map();

function forget(now) {
  for (const [value, expiry] of spent) if (expiry <= now) spent.delete(value);
}

export function consumeNonce(nonce) {
  const raw = String(nonce ?? "");
  const parts = raw.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed nonce" };
  const [random, issuedAtRaw, mac] = parts;
  if (!macMatches(`${random}.${issuedAtRaw}`, mac)) return { ok: false, reason: "bad nonce signature" };

  const issuedAt = Number(issuedAtRaw);
  if (!Number.isFinite(issuedAt)) return { ok: false, reason: "bad nonce timestamp" };
  const now = Date.now();
  if (now - issuedAt > NONCE_TTL_MS) return { ok: false, reason: "nonce expired" };
  if (issuedAt - now > 60_000) return { ok: false, reason: "nonce issued in the future" };

  forget(now);
  if (spent.has(raw)) return { ok: false, reason: "nonce already used" };
  spent.set(raw, issuedAt + NONCE_TTL_MS);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

function sessionTtlMs() {
  const hours = Number(process.env.ADMIN_SESSION_TTL_HOURS);
  if (Number.isFinite(hours) && hours > 0 && hours <= MAX_SESSION_TTL_HOURS) {
    return hours * 60 * 60 * 1000;
  }
  return DEFAULT_SESSION_TTL_MS;
}

export function issueSession(partyId, instanceToken) {
  if (!validInstanceToken(instanceToken)) {
    throw new Error("a session cannot be issued without a valid page-instance token");
  }
  const issuedAt = Date.now();
  const expiresAt = issuedAt + sessionTtlMs();
  // partyId contains "::" but never "." — see Canton party id format <hint>::<fingerprint>.
  // Only the HASH of the instance token is embedded: the cookie must not itself
  // contain the secret it is supposed to be paired with.
  const payload = `${Buffer.from(partyId, "utf8").toString("base64url")}.${issuedAt}.${expiresAt}.${instanceHash(instanceToken)}`;
  return { token: `${payload}.${sign(payload)}`, expiresAt };
}

export function verifySession(token, instanceToken) {
  if (!validInstanceToken(instanceToken)) return null;

  const parts = String(token ?? "").split(".");
  if (parts.length !== 5) return null;
  const [partyB64, issuedAtRaw, expiresAtRaw, boundHash, mac] = parts;
  if (!macMatches(`${partyB64}.${issuedAtRaw}.${expiresAtRaw}.${boundHash}`, mac)) return null;

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) return null;

  // The page-load binding: the caller must hold the in-memory token whose hash this
  // session was issued for. Both sides are 43-char sha256/base64url digests.
  const expected = Buffer.from(instanceHash(instanceToken), "utf8");
  const actual = Buffer.from(boundHash, "utf8");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  const partyId = Buffer.from(partyB64, "base64url").toString("utf8");
  if (!partyId) return null;

  // The allowlist is re-checked on every request, not just at login: revoking an
  // operator must take effect immediately, not whenever their cookie happens to expire.
  if (!isAllowedOperator(partyId)) return null;

  return { partyId, expiresAt };
}

// ---------------------------------------------------------------------------
// Operator allowlist
// ---------------------------------------------------------------------------

/**
 * ADMIN_OPERATORS pins each operator's party id to their signing public key:
 *
 *   ADMIN_OPERATORS="a99dd107…::1220880b…=b6f1…hex, 3b9317d2…::1220514795…=9ac4…hex"
 *
 * Pinning the key server-side is what makes the signature challenge mean anything.
 * If the browser supplied its own `publicKey` alongside the signature, an attacker
 * would simply generate a fresh keypair, sign our nonce with it, and claim any party
 * id they liked — the signature would verify perfectly against the key they chose.
 * Deriving the key from the party id instead is not an option either: the `::1220…`
 * suffix is a multihash of Canton's serialized key protobuf, not of the raw key bytes,
 * so it cannot be recomputed from a bare Ed25519 public key.
 */
export function allowedOperators() {
  const raw = process.env.ADMIN_OPERATORS || "";
  const operators = new Map();
  for (const entry of raw.split(/[\s,]+/)) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    // Split on the FIRST "=": a party id is <hint>::<hex fingerprint> and never
    // contains "=", whereas a base64 key may carry "=" padding at its end.
    const split = trimmed.indexOf("=");
    if (split <= 0) continue;
    const partyId = trimmed.slice(0, split).trim();
    const publicKey = trimmed.slice(split + 1).trim();
    if (partyId && publicKey) operators.set(partyId, publicKey);
  }
  return operators;
}

/** The pinned public key for a party, or "" when that party is not an operator. */
export function operatorPublicKey(partyId) {
  const wanted = String(partyId ?? "").trim();
  if (!wanted) return "";
  // Party ids are case-sensitive; compare exactly.
  return allowedOperators().get(wanted) || "";
}

export function isAllowedOperator(partyId) {
  return Boolean(operatorPublicKey(partyId));
}

// ---------------------------------------------------------------------------
// Cookie plumbing
// ---------------------------------------------------------------------------

export function readCookie(req, name) {
  const header = req.headers?.cookie;
  if (typeof header !== "string") return "";
  for (const chunk of header.split(";")) {
    const eq = chunk.indexOf("=");
    if (eq < 0) continue;
    if (chunk.slice(0, eq).trim() !== name) continue;
    // A malformed %-sequence throws, and this runs before auth on every proxied
    // request — treat an undecodable cookie as absent, not as a 500.
    try {
      return decodeURIComponent(chunk.slice(eq + 1).trim());
    } catch {
      return "";
    }
  }
  return "";
}

/**
 * HttpOnly so a XSS payload cannot read the session; SameSite=Strict so a third-party
 * page cannot drive the admin proxy with the operator's cookie attached (these are
 * state-changing endpoints, so Lax would still let top-level navigations through).
 */
export function sessionCookie(token, maxAgeMs) {
  const secure = process.env.NODE_ENV === "production" ? " Secure;" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly;${secure} SameSite=Strict; Max-Age=${Math.floor(maxAgeMs / 1000)}`;
}

export function clearedCookie() {
  const secure = process.env.NODE_ENV === "production" ? " Secure;" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly;${secure} SameSite=Strict; Max-Age=0`;
}

/** The one call every protected endpoint makes. Returns null when unauthenticated. */
export function currentOperator(req) {
  if (!isConfigured()) return null;
  const instanceToken = String(req.headers?.[INSTANCE_HEADER] ?? "");
  return verifySession(readCookie(req, SESSION_COOKIE), instanceToken);
}
