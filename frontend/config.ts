/**
 * Every env value the browser bundle reads, in one place.
 *
 * Each var is read as an explicit `import.meta.env.VITE_*` property so Vite inlines
 * only that reference. Capturing `import.meta.env` as an object and indexing it with
 * a computed key (the previous shape) forces Vite to serialise EVERY VITE_-prefixed
 * var into the bundle — including ones nothing here reads. Keep the explicit form:
 * it means a stray VITE_-prefixed secret in the deploy env cannot leak into the JS.
 */

function readString(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

function readBoolean(value: unknown): boolean {
  return value === "true";
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/, "");
}

export const IS_DEV = import.meta.env.DEV === true;

export const APP_NETWORK = readString(import.meta.env.VITE_APP_NETWORK, "devnet");
export const LOOP_NETWORK = readString(import.meta.env.VITE_LOOP_NETWORK, "devnet").toLowerCase();
export const WALLET_TYPE =
  readString(import.meta.env.VITE_WALLET_TYPE, "cantor8").toLowerCase() === "canton"
    ? "canton"
    : "cantor8";

/**
 * Display name of the connected EXTERNAL wallet. Balances live in two places —
 * this wallet and the on-ledger in-app wallet — so every balance in the UI is
 * labeled with one or the other.
 */
export const WALLET_DISPLAY_NAME = WALLET_TYPE === "canton" ? "Canton" : "Cantor8";

export const TRUTHORACLE_PACKAGE_ID = readString(
  import.meta.env.VITE_TRUTHORACLE_PACKAGE_ID,
  "0a786ef1027354cb70a1cd78331680bf34054a642520dc0eb94c9ac4f775b837",
);
export const TRUTHORACLE_PACKAGE_NAME = readString(
  import.meta.env.VITE_TRUTHORACLE_PACKAGE_NAME,
  "truthoracle-v13",
);

// The browser never calls the participant or the wallet directly — it calls the
// proxies below, which resolve the upstream URL and inject a Keycloak token
// server-side. Each proxy accepts two names, first match wins:
//   api/proxy/ledger.mjs    CANTON_LEDGER_PROXY_TARGET_URL → VITE_CANTON_PARTICIPANT_URL
//   api/proxy/wallet.mjs    ENTERPRISE_WALLET_PROXY_TARGET_URL → VITE_ENTERPRISE_WALLET_URL
//   api/proxy/keycloak.mjs  KEYCLOAK_PROXY_TARGET_URL → KEYCLOAK_URL → VITE_KEYCLOAK_URL
//
// The VITE_* spellings are what .env uses and they stay out of the bundle only
// because nothing in THIS file reads them: Vite inlines a VITE_ var when it sees an
// explicit `import.meta.env.VITE_X` reference. Don't add one for an upstream URL,
// and don't capture `import.meta.env` as an object (see the note at the top) — that
// second form serialises every VITE_ var in the deploy env, these included.
export const PARTICIPANT_PROXY_URL = trimTrailingSlash(
  readString(import.meta.env.VITE_CANTON_PARTICIPANT_PROXY_URL, "/__proxy/ledger"),
);
/**
 * Cantor8 wallet-backend, via our same-origin relay by default (the mainnet backend
 * sends no CORS headers, so direct browser calls fail). The relay picks the real
 * upstream server-side from VITE_APP_NETWORK, overridable with C8_WALLET_BACKEND_URL.
 */
export const C8_BACKEND_URL = trimTrailingSlash(
  readString(import.meta.env.VITE_C8_BACKEND_URL, "/__proxy/c8b"),
);
export const USE_PARTICIPANT_API = readBoolean(import.meta.env.VITE_USE_PARTICIPANT_API);

// Keycloak client credentials are intentionally NOT read here — token minting is
// server-side only (api/proxy/*.mjs), so the client id/secret live in server-only
// env (KEYCLOAK_CLIENT_ID / KEYCLOAK_CLIENT_SECRET, no VITE_ prefix) and never reach
// the browser bundle. See the enterprise-wallet repository README → Authentication.

export const ENTERPRISE_WALLET_PARTY_ID = readString(
  import.meta.env.VITE_ENTERPRISE_WALLET_PARTY_ID,
);
export const ENTERPRISE_WALLET_APP_NAME = readString(
  import.meta.env.VITE_ENTERPRISE_WALLET_APP_NAME,
  "truthoracle",
);
export const ENTERPRISE_WALLET_PROXY_URL = trimTrailingSlash(
  readString(import.meta.env.VITE_ENTERPRISE_WALLET_PROXY_URL, "/__proxy/wallet"),
);

export const DEBUG_ACTIVE_CONTRACTS = readBoolean(import.meta.env.VITE_DEBUG_ACTIVE_CONTRACTS);
export const DEBUG_WALLET_STATUS = readBoolean(import.meta.env.VITE_DEBUG_WALLET_STATUS);

export const PUSHER_KEY = readString(import.meta.env.VITE_PUSHER_KEY, "5c9c8369bdc5cdcb8b7c");
export const PUSHER_CLUSTER = readString(import.meta.env.VITE_PUSHER_CLUSTER, "ap2");
export const MODULE_ADDRESS = readString(
  import.meta.env.VITE_MODULE_ADDRESS,
  "0xbde9b5978954614b28adf8e8c71d919271ccad89a878d4d914249444a31f2b49",
);

// ---------------------------------------------------------------------------
// Accounts backend (truthoracle-backend: sign-in, linked wallets, KYC). Everything
// here is OPTIONAL — with no backend deployed these stay at their defaults and the
// app runs exactly as before, anonymous and wallet-signed. The browser never learns
// BACKEND_URL: it calls the same-origin relay below (api/proxy/backend.mjs), which
// resolves the real host server-side — the same pattern as the ledger/wallet proxies.
// ---------------------------------------------------------------------------
export const BACKEND_BASE_URL = trimTrailingSlash(
  readString(import.meta.env.VITE_BACKEND_PROXY_URL, "/__backend"),
);
/** Google Identity Services client id. Empty = no Google button. */
export const GOOGLE_CLIENT_ID = readString(import.meta.env.VITE_GOOGLE_CLIENT_ID);
/** Bot username (no "@") for the Telegram Login Widget. Empty = Telegram sign-in hidden. */
export const TELEGRAM_BOT_USERNAME = readString(import.meta.env.VITE_TELEGRAM_BOT_USERNAME);
/**
 * Telegram OIDC only works on hosts whose /__backend/api/v1/auth/telegram/oidc/callback
 * URL is registered with Telegram, so it is opt-in per deployment; the widget works
 * wherever the bot's domain is set.
 */
export const TELEGRAM_OIDC_ENABLED = readBoolean(import.meta.env.VITE_TELEGRAM_OIDC_ENABLED);
