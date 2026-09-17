/**
 * Same-origin relay for the Cantor8 wallet-backend, because the mainnet backend
 * sends no CORS headers — a browser on truthoracle.xyz cannot call it directly.
 *
 * Unlike the ledger/wallet proxies this injects NO server credential: the caller's
 * own bearer token (the Cantor8 SDK session) is forwarded verbatim, and the backend
 * authorises with it. With no authority of our own to protect, the guard here is
 * only a path allowlist of the read-only endpoints the frontend actually uses, so
 * the deployment does not become an open relay to arbitrary backend paths.
 *
 * MainNet has one wallet-backend per Cantor8 validator (digik, zkpc, cache): the
 * popup at wallet.cantor8.tech ships all three, and a session token is only valid
 * at the backend of the validator hosting the account. The SDK hardcodes digik, so
 * an account on another validator got 401 on every read and the SDK tore the
 * session down right after connect. The relay therefore tries each mainnet backend
 * until one accepts the token and remembers the match per token.
 */

import { createHash } from "node:crypto";

/**
 * Read at request time, not import time: under `vite dev` this module is imported
 * at the top of vite.config.ts BEFORE the config mirrors .env into process.env, so
 * an import-time check always saw "" and pointed a mainnet app at the devnet backend
 * (every read 401ed and the SDK tore the session down right after connect).
 */
const isMainnet = () => (process.env.VITE_APP_NETWORK || "").trim().toLowerCase() === "mainnet";

export const MAINNET_BACKENDS = [
  "https://wallet-backend.main.digik.cantor8.tech",
  "https://wallet-backend.main.zkpc.cantor8.tech",
  "https://wallet-backend.main.cache.cantor8.tech",
];
const DEVNET_BACKEND = "https://wallet-backend.dev.digik.cantor8.tech";

/** Env override first (server-only, single host), then the per-network defaults. */
function targets() {
  const override = (process.env.C8_WALLET_BACKEND_URL || "").trim().replace(/\/$/, "");
  if (/^https?:\/\//i.test(override)) return [override];
  return isMainnet() ? MAINNET_BACKENDS : [DEVNET_BACKEND];
}

// GET-only reads from frontend/lib/cantor8Status.ts and getAccountBalance.ts, plus
// the SDK's own session-restore / balance polling (routed here at build time).
const ALLOWED = [
  /^healthz$/,
  /^api\/balance$/,
  // Per-contract holdings and the backend's holding-bucket state: read-only
  // diagnostics for "insufficient unreserved holdings" (all Amulets reserved).
  /^api\/holdings$/,
  /^api\/holding-buckets\/status$/,
  /^api\/command\/[^/]+\/status$/,
  /^api\/transfer\/status$/,
  /^api\/transfer\/history$/,
];

export function allowedPath(path) {
  return ALLOWED.some((re) => re.test(path));
}

/** Backend that last accepted a given token, so later reads skip the probing. */
const WINNER_TTL_MS = 10 * 60 * 1000;
const WINNER_MAX = 500;
const winners = new Map();

function tokenKey(authorization) {
  return createHash("sha256").update(authorization).digest("hex");
}

function rememberWinner(authorization, target) {
  if (winners.size >= WINNER_MAX) winners.delete(winners.keys().next().value);
  winners.set(tokenKey(authorization), { target, expires: Date.now() + WINNER_TTL_MS });
}

function knownWinner(authorization) {
  const hit = winners.get(tokenKey(authorization));
  if (!hit) return null;
  if (hit.expires <= Date.now()) {
    winners.delete(tokenKey(authorization));
    return null;
  }
  return hit.target;
}

/** `preferred` first (when it is one of `list`), then the rest in their given order. */
export function orderTargets(list, preferred) {
  if (!preferred || !list.includes(preferred)) return [...list];
  return [preferred, ...list.filter((t) => t !== preferred)];
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
  res.setHeader("cache-control", "no-store");

  const path = proxyPath(req);
  if (req.method !== "GET" || !allowedPath(path)) {
    res.statusCode = req.method !== "GET" ? 405 : 404;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "path not proxied" }));
    return;
  }

  // Only what the backend needs: the caller's own bearer, the decimals flag, and the
  // dApp name the SDK sends with every call. Cookies (our admin session) must never
  // leak upstream.
  const headers = {};
  const authorization = typeof req.headers.authorization === "string" ? req.headers.authorization : "";
  if (authorization) headers.authorization = authorization;
  for (const name of ["x-feat-decimals", "x-app-name"]) {
    if (typeof req.headers[name] === "string") headers[name] = req.headers[name];
  }

  // Without a token every backend answers the same 401, so only probe when there is
  // one to authorise with.
  const candidates = authorization
    ? orderTargets(targets(), knownWinner(authorization))
    : targets().slice(0, 1);

  let upstream = null;
  let target = candidates[0];
  for (let i = 0; i < candidates.length; i++) {
    target = candidates[i];
    upstream = await fetch(`${target}/${path}${proxyQuery(req)}`, {
      method: "GET",
      headers,
      redirect: "manual",
    });
    const last = i === candidates.length - 1;
    if (upstream.status !== 401 || last) break;
    await upstream.arrayBuffer().catch(() => {});
  }
  if (authorization && upstream.ok) rememberWinner(authorization, target);

  res.statusCode = upstream.status;
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (!["content-encoding", "content-length", "transfer-encoding", "set-cookie"].includes(lower)) {
      res.setHeader(key, value);
    }
  });
  // Which validator's backend answered — visible in the browser's Network tab.
  res.setHeader("x-c8-relay-upstream", new URL(target).host);
  res.end(Buffer.from(await upstream.arrayBuffer()));
}
