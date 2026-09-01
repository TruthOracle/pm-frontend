/**
 * Cross-instance state for the auth stack: single-use claims, rate limits, locks.
 *
 * Serverless invocations share no memory, so purely in-process guards only slow one
 * warm instance. When an Upstash-compatible Redis REST endpoint is configured this
 * module makes them fleet-wide; without one it degrades to the previous per-instance
 * behaviour rather than failing. Callers can treat every function as best-effort —
 * the invariants that guard money do NOT live here (they are closed by ledger
 * command-dedup on deterministic ids, see api/wallet/*.mjs).
 *
 * Config (either pair; Vercel KV and Upstash use the same REST protocol):
 *   KV_REST_API_URL + KV_REST_API_TOKEN            (Vercel KV / Marketplace)
 *   UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
 *
 * Every failure mode of the store itself (down, misconfigured, slow) falls back to
 * the in-memory answer and logs once — availability of login and payouts is worth
 * more than the marginal cross-instance protection.
 */

const KEY_PREFIX = "truthoracle:";

const memClaims = new Map(); // key -> expiresAtMs
const memCounts = new Map(); // key -> { resetAt, count }
const memLocks = new Map(); // key -> expiresAtMs

function kvConfig() {
  const url = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "").trim();
  const token = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

export function sharedStoreConfigured() {
  return Boolean(kvConfig());
}

let warned = false;
function warnUnavailable(error) {
  if (warned) return;
  warned = true;
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[shared-store] unavailable, degrading to per-instance guards: ${message}`);
}

/** Run commands as one pipeline. Returns the array of results, throws on any error. */
async function kvCall(commands) {
  const cfg = kvConfig();
  const res = await fetch(`${cfg.url}/pipeline`, {
    method: "POST",
    headers: { authorization: `Bearer ${cfg.token}`, "content-type": "application/json" },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error(`shared store responded ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data) || data.length !== commands.length) {
    throw new Error("shared store returned an unexpected response shape");
  }
  for (const entry of data) {
    if (entry && typeof entry === "object" && entry.error) throw new Error(`shared store: ${entry.error}`);
  }
  return data.map((entry) => entry?.result);
}

function ns(key) {
  return `${KEY_PREFIX}${key}`;
}

function sweep(map, now) {
  if (map.size < 1000) return;
  for (const [key, expiry] of map) if (expiry <= now) map.delete(key);
}

/**
 * Claim `key` exactly once across the fleet for `ttlMs`. Returns whether this caller
 * won the claim, and whether the verdict came from the shared store (false = only
 * this instance's memory could be consulted).
 */
export async function claimOnce(key, ttlMs) {
  const now = Date.now();
  sweep(memClaims, now);
  if ((memClaims.get(key) ?? 0) > now) return { claimed: false, shared: false };
  memClaims.set(key, now + ttlMs);
  if (!kvConfig()) return { claimed: true, shared: false };
  try {
    const [result] = await kvCall([["SET", ns(key), "1", "NX", "PX", String(Math.max(1, Math.round(ttlMs)))]]);
    return { claimed: result === "OK", shared: true };
  } catch (error) {
    warnUnavailable(error);
    return { claimed: true, shared: false };
  }
}

/**
 * Count a hit against `key` in a fixed window. Returns { limited, count, shared }.
 * The memory counter always runs too, so a store outage never lifts the limit
 * below what the old per-instance guard provided.
 */
export async function hitRateLimit(key, windowMs, max) {
  const now = Date.now();
  const slot = memCounts.get(key);
  const mem = slot && slot.resetAt > now ? slot : { resetAt: now + windowMs, count: 0 };
  mem.count += 1;
  memCounts.set(key, mem);
  if (memCounts.size > 1000) {
    for (const [k, v] of memCounts) if (v.resetAt <= now) memCounts.delete(k);
  }
  if (mem.count > max) return { limited: true, count: mem.count, shared: false };
  if (!kvConfig()) return { limited: false, count: mem.count, shared: false };
  try {
    const [count] = await kvCall([["INCR", ns(key)]]);
    // First hit in the window sets the expiry. A crash between INCR and PEXPIRE would
    // leave the key eternal, so the expiry is retried by whichever caller sees count 1.
    if (Number(count) === 1) await kvCall([["PEXPIRE", ns(key), String(Math.round(windowMs))]]);
    return { limited: Number(count) > max, count: Number(count), shared: true };
  } catch (error) {
    warnUnavailable(error);
    return { limited: false, count: mem.count, shared: false };
  }
}

/**
 * Take a short-lived exclusive lock. Returns { acquired, release }. The TTL is the
 * crash ceiling — a holder that dies un-releases automatically. Callers must still
 * be safe without the lock (it only cheapens the failure to a fast 409).
 */
export async function acquireLock(key, ttlMs) {
  const now = Date.now();
  sweep(memLocks, now);
  if ((memLocks.get(key) ?? 0) > now) return { acquired: false, release: async () => {} };
  memLocks.set(key, now + ttlMs);
  const releaseMemory = () => memLocks.delete(key);
  if (!kvConfig()) return { acquired: true, release: async () => releaseMemory() };
  try {
    const [result] = await kvCall([["SET", ns(key), "1", "NX", "PX", String(Math.max(1, Math.round(ttlMs)))]]);
    if (result !== "OK") {
      releaseMemory();
      return { acquired: false, release: async () => {} };
    }
    return {
      acquired: true,
      release: async () => {
        releaseMemory();
        try {
          await kvCall([["DEL", ns(key)]]);
        } catch {
          // TTL cleans it up.
        }
      },
    };
  } catch (error) {
    warnUnavailable(error);
    return { acquired: true, release: async () => releaseMemory() };
  }
}

/**
 * Rate-limit key for the caller. x-real-ip is platform-set; the first x-forwarded-for
 * entry is client-supplied and trivially spoofable, so it is only the fallback.
 */
export function requestClientKey(req) {
  return (
    String(req.headers?.["x-real-ip"] || "").trim() ||
    String(req.headers?.["x-forwarded-for"] || "").split(",")[0].trim() ||
    "unknown"
  );
}

/** Test hook: clear the in-memory fallbacks and the one-shot outage warning. */
export function resetSharedStoreForTests() {
  memClaims.clear();
  memCounts.clear();
  memLocks.clear();
  warned = false;
}
