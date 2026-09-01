/**
 * Same-origin relay for the Cantor8 wallet-backend, because the mainnet backend
 * sends no CORS headers — a browser on truthoracle.xyz cannot call it directly.
 *
 * Unlike the ledger/wallet proxies this injects NO server credential: the caller's
 * own bearer token (the Cantor8 SDK session) is forwarded verbatim, and the backend
 * authorises with it. With no authority of our own to protect, the guard here is
 * only a path allowlist of the read-only endpoints the frontend actually uses, so
 * the deployment does not become an open relay to arbitrary backend paths.
 */

const IS_MAINNET = (process.env.VITE_APP_NETWORK || "").trim().toLowerCase() === "mainnet";

/** Env override first (server-only), then the verified per-network default. */
function target() {
  const override = (process.env.C8_WALLET_BACKEND_URL || "").trim().replace(/\/$/, "");
  if (/^https?:\/\//i.test(override)) return override;
  return IS_MAINNET
    ? "https://wallet-backend.main.digik.cantor8.tech"
    : "https://wallet-backend.dev.digik.cantor8.tech";
}

// GET-only reads from frontend/lib/cantor8Status.ts and getAccountBalance.ts.
const ALLOWED = [
  /^healthz$/,
  /^api\/balance$/,
  /^api\/command\/[^/]+\/status$/,
  /^api\/transfer\/status$/,
  /^api\/transfer\/history$/,
];

export function allowedPath(path) {
  return ALLOWED.some((re) => re.test(path));
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

  // Only what the backend needs: the caller's own bearer and the decimals flag.
  // Cookies (our admin session) must never leak upstream.
  const headers = {};
  if (typeof req.headers.authorization === "string") headers.authorization = req.headers.authorization;
  if (typeof req.headers["x-feat-decimals"] === "string") {
    headers["x-feat-decimals"] = req.headers["x-feat-decimals"];
  }

  const upstream = await fetch(`${target()}/${path}${proxyQuery(req)}`, {
    method: "GET",
    headers,
    redirect: "manual",
  });

  res.statusCode = upstream.status;
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (!["content-encoding", "content-length", "transfer-encoding", "set-cookie"].includes(lower)) {
      res.setHeader(key, value);
    }
  });
  res.end(Buffer.from(await upstream.arrayBuffer()));
}
