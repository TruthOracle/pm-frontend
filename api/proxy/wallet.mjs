import { keycloakBearer } from "./_keycloakToken.mjs";
import { authorise } from "../_lib/proxyGuard.mjs";

const TARGET_ENV = ["ENTERPRISE_WALLET_PROXY_TARGET_URL", "VITE_ENTERPRISE_WALLET_URL"];

// The Enterprise Wallet runs with AUTH_TYPE=keycloak — every /api/v1/* call needs a
// Bearer JWT. This proxy mints one server-side (client id/secret never reach the
// browser) and injects it. Prefers dedicated server creds, then the shared ones.
//
// ACCESS: admin session required for every path (see ../_lib/proxyGuard.mjs). The
// injected token signs with the treasury key, so an unauthenticated caller reaching
// this handler could mint in-app balances and drain CC. User-facing flows that need
// the treasury signature (deposit credit, payout settlement) live in the accounts
// backend behind a user session, and derive amounts from upstream state rather than
// accepting them from the browser.
// Unlike the ledger proxy, this stays on the normal (digik) credentials on every
// network — the wallet trusts its own Keycloak, not the zkpc node's; use
// WALLET_KEYCLOAK_* if the wallet's issuer ever differs.
const AUTH_PREFIXES = ["WALLET_KEYCLOAK", "KEYCLOAK", "VITE_KEYCLOAK"];

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

async function headersForUpstream(req) {
  const headers = { ...req.headers };
  delete headers.host;
  delete headers.connection;
  delete headers["content-length"];
  // Always REPLACE the caller's Authorization rather than passing it through. The
  // header we care about from the browser is the session cookie, which authorises the
  // request; letting a caller-supplied bearer reach the wallet would hand them a
  // second, unreviewed way to talk to it.
  delete headers.authorization;
  delete headers.cookie;
  // Half of the admin credential pair — for this proxy only, never for the upstream.
  delete headers["x-admin-instance"];
  const token = await keycloakBearer(AUTH_PREFIXES);
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
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

  const gate = authorise({ req, path: proxyPath(req), kind: "wallet" });
  if (!gate.allow) {
    res.statusCode = gate.status;
    res.setHeader("content-type", "application/json");
    res.setHeader("cache-control", "no-store");
    res.end(JSON.stringify({ error: gate.error }));
    return;
  }

  const target = targetFor();
  if (!target) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      error: "Missing proxy target for enterprise wallet",
      expectedEnv: TARGET_ENV,
    }));
    return;
  }

  const body = ["GET", "HEAD"].includes(req.method || "") ? undefined : await readBody(req);
  const upstream = await fetch(`${target}/${proxyPath(req)}${proxyQuery(req)}`, {
    method: req.method,
    headers: await headersForUpstream(req),
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
