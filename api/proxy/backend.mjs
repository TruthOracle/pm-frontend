/**
 * Same-origin relay for the accounts backend (truthoracle-backend: sign-in, linked
 * wallets, KYC, the in-app wallet). The browser calls /__backend/api/v1/... on the app
 * host and this handler forwards to BACKEND_URL (server-only env — the Railway service).
 *
 * Why a relay instead of CORS: the session is an HttpOnly cookie. Same-origin keeps it
 * first-party (host-only cookie, no SameSite=None, immune to third-party-cookie
 * blocking) and lets the backend learn the real client IP and app host from headers
 * only this relay sets, authenticated by a shared secret. The contract is §4.1 of
 * truthoracle-backend/docs/ARCHITECTURE.md: the backend trusts x-forwarded-host and
 * x-real-ip ONLY when x-truthoracle-proxy matches its BACKEND_PROXY_SECRET.
 *
 * Under `npm run dev` the SAME handler runs through _devProxy.mjs proxyMiddleware, so
 * dev and prod share one code path (deliberately no vite `server.proxy` shortcut).
 *
 * Unlike ledger.mjs / wallet.mjs this injects NO server credential — the caller's own
 * session cookie is what authorises the request upstream. The guards here are about
 * containment: which paths, which headers and which cookies may cross.
 *   - Only api/v1/**, health and health/ready are forwarded (never /api/docs, never a
 *     path with dot segments).
 *   - Request headers are an allow-list built from scratch, never a copy of req.headers.
 *   - Only the backend's own cookies (to_session, to_oidc) are forwarded. to_admin
 *     belongs to the /admin UI's separate flow (api/_lib/adminSession.mjs) and must
 *     never reach the backend; nor may a client bearer or x-admin-instance.
 *   - Client-supplied x-forwarded-* are discarded and rebuilt from what the platform
 *     tells us, so nobody can spoof their IP or host through the relay. "The platform"
 *     is Vercel (VERCEL=1), whose edge overwrites x-real-ip / x-forwarded-host /
 *     x-forwarded-proto; anywhere else (vite dev, a self-hosted Node) those headers
 *     are whatever the client typed, so only the socket address and Host are used.
 *   - Bodies are capped (every proxied route is small JSON) — 413 above the cap.
 *
 * With BACKEND_URL unset the relay answers 503 backend_unconfigured. The frontend
 * treats that as "accounts unavailable" (no Sign-in button) and the legacy money
 * endpoints under api/wallet/ keep working exactly as before — ARCHITECTURE.md §18.
 */

// Vercel function config: /in-app-wallet reads walk the treasury transfer history,
// which can take well past the 10 s default.
export const config = { maxDuration: 60 };

const ALLOWED = [/^api\/v1\/.+/, /^health$/, /^health\/ready$/];

// The backend's own cookies. Everything else living on the app origin (to_admin,
// analytics, …) stays home.
const FORWARDED_COOKIES = new Set(["to_session", "to_oidc"]);

// Copied verbatim from the caller. Deliberately absent: authorization, cookie and
// x-forwarded-* (all rebuilt below), x-admin-instance, host, content-length.
// The x-payload-digest pair is the KYC vendor's webhook signature (Sumsub-style names,
// verified by the backend over the raw body): the documented webhook URL is on the app host,
// so without these the relay would strip the signature and every webhook would be 401.
const FORWARDED_REQUEST_HEADERS = [
  "content-type",
  "accept",
  "origin",
  "referer",
  "x-requested-with",
  "x-payload-digest",
  "x-payload-digest-alg",
];

// fetch already decoded the body and Node reframes it, so the upstream's framing
// headers would be wrong. set-cookie is relayed separately (getSetCookie, Domain= off).
const DROPPED_RESPONSE_HEADERS = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "set-cookie",
]);

/** The backend base URL, or "" when no accounts backend is deployed for this app. */
export function backendTarget() {
  const trimmed = String(process.env.BACKEND_URL ?? "").trim().replace(/\/$/, "");
  return /^https?:\/\//i.test(trimmed) ? trimmed : "";
}

/**
 * `path` is the normalised proxy path (segments joined by "/", no leading slash).
 * Dot segments are refused outright: proxyPath keeps "." and ".." as they are, and
 * the URL built for fetch would resolve them — turning api/v1/../docs into /api/docs.
 */
export function allowedPath(path) {
  const value = String(path ?? "");
  if (!value) return false;
  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return false;
  return ALLOWED.some((re) => re.test(value));
}

/**
 * Rebuild the Cookie header from scratch with only the backend's cookies. Values are
 * copied byte-for-byte — no decode/re-encode: the session token is opaque and the
 * backend compares its hash, so any normalisation here would log the user out.
 */
export function filterCookies(cookieHeader) {
  if (typeof cookieHeader !== "string" || !cookieHeader) return "";
  const kept = [];
  for (const chunk of cookieHeader.split(";")) {
    const eq = chunk.indexOf("=");
    if (eq < 0) continue;
    const name = chunk.slice(0, eq).trim();
    if (!FORWARDED_COOKIES.has(name)) continue;
    const value = chunk.slice(eq + 1).trim();
    if (!value) continue;
    kept.push(`${name}=${value}`);
  }
  return kept.join("; ");
}

/**
 * The backend sets host-only cookies (its COOKIE_DOMAIN stays empty for proxied
 * traffic), but should a Domain= ever appear it would name the BACKEND host — a
 * browser on the app origin would reject or mis-scope it. Dropping the attribute
 * binds the cookie to the app host, which is the only host the browser talked to.
 */
export function stripCookieDomain(setCookie) {
  const [nameValue, ...attributes] = String(setCookie ?? "").split(";");
  const kept = attributes.map((attribute) => attribute.trim()).filter((attribute) => attribute && !/^domain=/i.test(attribute));
  return [nameValue.trim(), ...kept].join("; ");
}

// Proxied bodies are small JSON (a credential, a signed challenge, a mock KYC form);
// this is far above any of them and far below what a hostile client could otherwise
// make a function buffer.
export const MAX_BODY_BYTES = 256 * 1024;

function firstHeader(req, name) {
  const raw = req.headers?.[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" ? value.split(",")[0].trim() : "";
}

/**
 * Only Vercel's edge is known to overwrite x-real-ip / x-forwarded-host /
 * x-forwarded-proto with trustworthy values. Anywhere else the same headers are
 * client-supplied — and because the relay signs them with the proxy secret, the
 * backend would believe them (spoofed IP for the per-IP rate limits and session
 * records, spoofed host for the CSRF origin check and the challenge's Domain line).
 */
export function trustPlatformHeaders() {
  return String(process.env.VERCEL ?? "").trim() === "1";
}

/**
 * The host the browser typed. The backend scopes cookies, checks CSRF origins and
 * writes the wallet challenge message ("Domain: <app host>") from this, so it must be
 * OUR host, never the Railway one. On Vercel x-forwarded-host is a platform header
 * (the edge overwrites anything the client sent); elsewhere Host is it.
 */
function appHost(req) {
  return (trustPlatformHeaders() ? firstHeader(req, "x-forwarded-host") : "") || firstHeader(req, "host");
}

function appProto(req) {
  if (trustPlatformHeaders()) {
    const platform = firstHeader(req, "x-forwarded-proto").toLowerCase();
    if (platform === "http" || platform === "https") return platform;
  }
  return req.socket?.encrypted ? "https" : "http";
}

/**
 * The real client, for the backend's rate limits and session records: Vercel's
 * x-real-ip on Vercel, the socket address everywhere else. A client-supplied
 * x-forwarded-for is never consulted.
 */
function clientIp(req) {
  return (trustPlatformHeaders() ? firstHeader(req, "x-real-ip") : "") || String(req.socket?.remoteAddress ?? "").trim();
}

/**
 * Exactly the request headers the backend may see (§4.1). Built from scratch so a
 * new header the browser starts sending — or one an attacker adds — never crosses by
 * default; the allow-list has to grow on purpose.
 */
export function buildForwardHeaders(req) {
  const headers = {};
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const raw = req.headers?.[name];
    const value = Array.isArray(raw) ? raw.join(", ") : raw;
    if (typeof value === "string" && value) headers[name] = value;
  }

  const cookie = filterCookies(req.headers?.cookie);
  if (cookie) headers.cookie = cookie;

  const host = appHost(req);
  if (host) headers["x-forwarded-host"] = host;
  headers["x-forwarded-proto"] = appProto(req);
  const ip = clientIp(req);
  if (ip) headers["x-real-ip"] = ip;

  // What makes the three headers above trustworthy. Without it the backend ignores
  // them and falls back to the socket address and Host (which would be the relay's).
  const secret = String(process.env.BACKEND_PROXY_SECRET ?? "").trim();
  if (secret) headers["x-truthoracle-proxy"] = secret;

  return headers;
}

class BodyTooLarge extends Error {
  constructor() {
    super("body too large");
    this.name = "BodyTooLarge";
  }
}

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

/**
 * Set-Cookie is the one header that cannot be comma-joined, so the relay needs the
 * per-cookie list `Headers.getSetCookie()` provides (Node ≥ 18.14 / undici ≥ 5.19).
 * On an older runtime fall back to the single joined value — one cookie survives —
 * and say so once, loudly: a silent `[]` would make every login "succeed" with a
 * 200 body and a session that never sticks.
 */
let warnedNoGetSetCookie = false;
export function upstreamSetCookies(headers) {
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  if (!warnedNoGetSetCookie) {
    warnedNoGetSetCookie = true;
    console.error(
      `[backend-proxy] Headers.getSetCookie is missing on this runtime (node ${process.version}); ` +
        "only a single Set-Cookie can be relayed. Pin Node >= 18.14 for the accounts relay.",
    );
  }
  const single = headers.get("set-cookie");
  return single ? [single] : [];
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

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(payload));
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  const path = proxyPath(req);
  if (!allowedPath(path)) return json(res, 404, { error: "path not proxied" });

  const target = backendTarget();
  if (!target) {
    return json(res, 503, {
      error: "backend_unconfigured",
      message: "The accounts backend is not configured on this deployment (BACKEND_URL is unset).",
    });
  }

  const method = String(req.method || "GET").toUpperCase();
  // Raw bytes, untouched: the backend verifies webhook signatures and parses JSON
  // itself, so any re-serialisation here would be a bug waiting to happen.
  let body;
  try {
    body = ["GET", "HEAD"].includes(method) ? undefined : await readBody(req);
  } catch (e) {
    if (e instanceof BodyTooLarge) {
      return json(res, 413, { error: "body_too_large", message: `Request body exceeds ${MAX_BODY_BYTES} bytes.` });
    }
    throw e;
  }

  let upstream;
  try {
    upstream = await fetch(`${target}/${path}${proxyQuery(req)}`, {
      method,
      headers: buildForwardHeaders(req),
      body,
      // The Telegram OIDC hops are 302s for the BROWSER to follow (to Telegram, then
      // back to the app). Following them here would swallow the flow.
      redirect: "manual",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[backend-proxy] ${method} ${path} unreachable: ${message}`);
    return json(res, 502, {
      error: "backend_unreachable",
      message: "The accounts backend did not respond.",
    });
  }

  res.statusCode = upstream.status;
  // Default only — set before the relay loop so the backend's own cache-control wins.
  res.setHeader("cache-control", "no-store");
  upstream.headers.forEach((value, key) => {
    if (DROPPED_RESPONSE_HEADERS.has(key.toLowerCase())) return;
    res.setHeader(key, value);
  });
  // As an array: a single joined string would merge two cookies into one invalid
  // header (Set-Cookie is the one header that cannot be comma-combined).
  const cookies = upstreamSetCookies(upstream.headers);
  if (cookies.length) res.setHeader("set-cookie", cookies.map(stripCookieDomain));
  res.end(Buffer.from(await upstream.arrayBuffer()));
}
