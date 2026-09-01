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
// ACCESS: read-only query paths are public; everything else needs an admin session
// (see ../_lib/proxyGuard.mjs). The injected token holds ParticipantAdmin — the same
// authority scripts/grant-rights.ts relies on — so an open /v2/users/*/rights would
// let anyone grant themselves act-as on any party hosted here.
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

async function headersForUpstream(req) {
  const headers = { ...req.headers };
  delete headers.host;
  delete headers.connection;
  delete headers["content-length"];
  // Replace, never pass through — see the matching note in wallet.mjs.
  delete headers.authorization;
  delete headers.cookie;
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

  const gate = authorise({ req, path: proxyPath(req), kind: "ledger" });
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
      error: "Missing proxy target for ledger",
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
