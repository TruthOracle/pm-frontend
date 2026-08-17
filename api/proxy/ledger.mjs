import { keycloakBearer } from "./_keycloakToken.mjs";

const TARGET_ENV = ["CANTON_LEDGER_PROXY_TARGET_URL", "VITE_CANTON_PARTICIPANT_URL"];

// The Ledger API requires a Bearer JWT (Keycloak client_credentials). This proxy
// mints one server-side and injects it, so the client id/secret never reach the
// browser bundle. A caller-supplied Authorization header is passed through untouched.
const AUTH_PREFIXES = ["LEDGER_KEYCLOAK", "KEYCLOAK", "VITE_KEYCLOAK"];

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
  if (!headers.authorization) {
    const token = await keycloakBearer(AUTH_PREFIXES);
    if (token) headers.authorization = `Bearer ${token}`;
  }
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
