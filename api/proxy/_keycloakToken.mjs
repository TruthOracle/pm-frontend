/**
 * Server-side Keycloak client_credentials token minter, shared by the ledger and
 * wallet proxies. Runs only in the serverless function / dev-server runtime — the
 * client id/secret it reads must be SERVER-ONLY env vars (no VITE_ prefix), so they
 * are never compiled into the browser bundle.
 *
 * `prefixes` is tried in order; the first prefix that yields a full {URL, CLIENT_ID,
 * CLIENT_SECRET} set wins. E.g. ["WALLET_KEYCLOAK", "KEYCLOAK", "VITE_KEYCLOAK"]
 * resolves WALLET_KEYCLOAK_CLIENT_SECRET, then KEYCLOAK_CLIENT_SECRET, etc.
 * (VITE_KEYCLOAK_* is only a migration fallback — prefer the non-VITE names.)
 */

const MARGIN_SEC = 60;
const cache = new Map(); // key -> { token, expiresAt }

function readEnv(prefixes, suffix) {
  for (const prefix of prefixes) {
    const value = process.env[`${prefix}_${suffix}`];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function absoluteUrl(value) {
  const trimmed = (value || "").replace(/\/$/, "");
  return /^https?:\/\//i.test(trimmed) ? trimmed : "";
}

/**
 * @param {string[]} prefixes env-var name prefixes to try, highest priority first
 * @returns {Promise<string>} a bearer token, or "" if not configured / mint failed
 */
export async function keycloakBearer(prefixes) {
  const baseUrl = absoluteUrl(readEnv(prefixes, "URL"));
  const realm = readEnv(prefixes, "REALM") || "master";
  const clientId = readEnv(prefixes, "CLIENT_ID");
  const clientSecret = readEnv(prefixes, "CLIENT_SECRET");
  if (!baseUrl || !clientId || !clientSecret) return "";

  const key = `${baseUrl}|${realm}|${clientId}`;
  const nowSec = Date.now() / 1000;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > nowSec + MARGIN_SEC) return hit.token;

  try {
    const res = await fetch(`${baseUrl}/realms/${realm}/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    });
    if (!res.ok) return "";
    const data = await res.json();
    if (typeof data.access_token !== "string" || !data.access_token) return "";
    const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 900;
    cache.set(key, { token: data.access_token, expiresAt: nowSec + expiresIn });
    return data.access_token;
  } catch {
    return "";
  }
}
