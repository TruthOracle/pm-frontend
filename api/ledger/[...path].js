const UPSTREAM_LEDGER_BASE_URL =
  "https://api.validator.dev.digik.cantor8.tech/api/ledger";

// Simple in-memory cache for Keycloak access tokens.
// In serverless, this may survive across invocations.
let keycloakTokenCache = null;

async function fetchKeycloakAccessToken() {
  const keycloakUrl = process.env.KEYCLOAK_URL;
  const realm = process.env.KEYCLOAK_REALM || "master";
  const clientId = process.env.KEYCLOAK_CLIENT_ID;
  const clientSecret = process.env.KEYCLOAK_CLIENT_SECRET;

  if (!keycloakUrl || !clientId || !clientSecret) {
    throw new Error(
      "Missing Keycloak server env vars (KEYCLOAK_URL, KEYCLOAK_CLIENT_ID, KEYCLOAK_CLIENT_SECRET)"
    );
  }

  const nowMs = Date.now();
  if (
    keycloakTokenCache &&
    keycloakTokenCache.expiresAtMs - nowMs > 60_000 // refresh ~60s early
  ) {
    return keycloakTokenCache.accessToken;
  }

  const url = `${keycloakUrl.replace(/\/$/, "")}/realms/${realm}/protocol/openid-connect/token`;

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Keycloak token request failed (${resp.status}): ${text}`);
  }

  const data = await resp.json();
  const accessToken = data.access_token;
  const expiresInSec = typeof data.expires_in === "number" ? data.expires_in : 900;

  if (!accessToken) {
    throw new Error("Keycloak response missing access_token");
  }

  keycloakTokenCache = {
    accessToken,
    expiresAtMs: nowMs + expiresInSec * 1000,
  };

  return accessToken;
}

function getUpstreamPath(req) {
  // Derive from URL path so we don't depend on Vercel's query/params shape.
  // Example incoming: /api/ledger/v2/state/ledger-end
  const url = new URL(req.url, "http://localhost");
  const pathname = url.pathname;
  const prefix = "/api/ledger";
  if (pathname === prefix) return "";
  if (pathname.startsWith(prefix + "/")) return pathname.slice(prefix.length + 1);
  // Fallback: if mounted differently, return full pathname without leading "/"
  return pathname.replace(/^\//, "");
}

function isJsonContentType(contentType) {
  return typeof contentType === "string" && contentType.toLowerCase().includes("application/json");
}

async function handler(req, res) {
  try {
    const upstreamPath = getUpstreamPath(req);
    const upstreamUrl = `${UPSTREAM_LEDGER_BASE_URL}/${upstreamPath}${new URL(req.url, "http://localhost").search}`;

    const headers = new Headers();
    const incomingAuth = req.headers?.authorization || req.headers?.Authorization;

    for (const [key, value] of Object.entries(req.headers || {})) {
      if (key === "host") continue;
      if (key === "connection") continue;
      if (key === "content-length") continue;
      if (typeof value === "undefined") continue;
      headers.set(key, String(value));
    }

    // If the browser didn't send an Authorization header, obtain one server-side.
    // This avoids putting Keycloak secrets in the frontend bundle.
    if (!incomingAuth) {
      const hasServerKeycloakConfig =
        process.env.KEYCLOAK_URL &&
        process.env.KEYCLOAK_CLIENT_ID &&
        process.env.KEYCLOAK_CLIENT_SECRET;

      // Prefer a static bearer token if provided.
      const staticToken = process.env.CANTON_PARTICIPANT_TOKEN;
      if (staticToken) {
        headers.set("authorization", `Bearer ${staticToken}`);
      } else if (hasServerKeycloakConfig) {
        const accessToken = await fetchKeycloakAccessToken();
        headers.set("authorization", `Bearer ${accessToken}`);
      }
    }

    let body;
    if (req.method && req.method.toUpperCase() !== "GET" && req.method.toUpperCase() !== "HEAD") {
      const contentType = req.headers?.["content-type"];
      if (isJsonContentType(contentType)) {
        // Vercel typically parses JSON body into an object.
        body = req.body ?? undefined;
        if (body && typeof body === "object" && !(body instanceof Buffer)) {
          body = JSON.stringify(body);
        }
      } else if (typeof req.body !== "undefined") {
        // Forward non-JSON bodies as-is.
        body = req.body;
      }
    }

    const upstreamRes = await fetch(upstreamUrl, {
      method: req.method,
      headers,
      body,
    });

    // Mirror upstream status + headers.
    res.status(upstreamRes.status);
    for (const [key, value] of upstreamRes.headers.entries()) {
      // Vercel/Next may dislike certain hop-by-hop headers; skip common ones.
      if (key.toLowerCase() === "transfer-encoding") continue;
      if (key.toLowerCase() === "content-encoding") {
        // Keep as-is; Vercel should handle decompression already.
      }
      res.setHeader(key, value);
    }

    const buf = Buffer.from(await upstreamRes.arrayBuffer());
    res.send(buf);
  } catch (e) {
    res.status(500).json({
      error: "ledger-proxy-failed",
      message: e?.message ? String(e.message) : String(e),
    });
  }
}

module.exports = handler;

