/**
 * Server-side Keycloak client_credentials token minter for the ledger relay
 * (api/proxy/ledger.mjs). Runs only in the serverless function / dev-server runtime — the
 * client id/secret it reads must be SERVER-ONLY env vars (no VITE_ prefix), so they
 * are never compiled into the browser bundle.
 *
 * Each field resolves independently: `prefixes` is walked in order per suffix, so a
 * deployment can mix names (e.g. take URL/REALM from VITE_KEYCLOAK_* while the
 * credentials come from the unprefixed KEYCLOAK_*) — which is exactly how the
 * checked-in .env is laid out.
 *
 * A VITE_* prefix only ever applies to URL and REALM. CLIENT_ID and CLIENT_SECRET
 * are never read from a VITE_-prefixed name: Vite compiles every referenced VITE_*
 * var into the public JS bundle, so honouring VITE_KEYCLOAK_CLIENT_SECRET here would
 * invite putting the secret one bare `import.meta.env` capture away from shipping.
 */

const MARGIN_SEC = 60;
const cache = new Map(); // key -> { token, expiresAt }

// Suffixes that carry a credential — never resolved from a VITE_-prefixed name.
const SECRET_SUFFIXES = new Set(["CLIENT_ID", "CLIENT_SECRET"]);

function readEnv(prefixes, suffix) {
  const usable = SECRET_SUFFIXES.has(suffix)
    ? prefixes.filter((prefix) => !prefix.startsWith("VITE_"))
    : prefixes;
  for (const prefix of usable) {
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
