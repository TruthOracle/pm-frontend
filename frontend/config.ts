const env = import.meta.env as Record<string, string | boolean | undefined>;

function readString(name: string, fallback = ""): string {
  const value = env[name];
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

function readBoolean(name: string): boolean {
  return env[name] === "true";
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/, "");
}

export const IS_DEV = env.DEV === true;

export const APP_NETWORK = readString("VITE_APP_NETWORK", "devnet");
export const LOOP_NETWORK = readString("VITE_LOOP_NETWORK", "devnet").toLowerCase();
export const WALLET_TYPE =
  readString("VITE_WALLET_TYPE", "cantor8").toLowerCase() === "canton"
    ? "canton"
    : "cantor8";

/**
 * Display name of the connected EXTERNAL wallet. Balances live in two places —
 * this wallet and the on-ledger in-app wallet — so every balance in the UI is
 * labeled with one or the other.
 */
export const WALLET_DISPLAY_NAME = WALLET_TYPE === "canton" ? "Canton" : "Cantor8";

export const TRUTHORACLE_PACKAGE_ID = readString(
  "VITE_TRUTHORACLE_PACKAGE_ID",
  "0a786ef1027354cb70a1cd78331680bf34054a642520dc0eb94c9ac4f775b837",
);
export const TRUTHORACLE_PACKAGE_NAME = readString(
  "VITE_TRUTHORACLE_PACKAGE_NAME",
  "truthoracle-v13",
);

export const PARTICIPANT_URL = readString(
  "VITE_CANTON_PARTICIPANT_URL",
  "https://api.validator.dev.digik.cantor8.tech/api/ledger",
);
export const PARTICIPANT_PROXY_URL = trimTrailingSlash(
  readString("VITE_CANTON_PARTICIPANT_PROXY_URL", "/__proxy/ledger"),
);
export const USE_PARTICIPANT_API = readBoolean("VITE_USE_PARTICIPANT_API");

// Keycloak client credentials are intentionally NOT read here — token minting is
// server-side only (api/proxy/*.mjs), so the client id/secret live in server-only
// env (KEYCLOAK_CLIENT_ID / KEYCLOAK_CLIENT_SECRET, no VITE_ prefix) and never reach
// the browser bundle. See wallet-deploy/README.md → Authentication.

export const ENTERPRISE_WALLET_PARTY_ID = readString("VITE_ENTERPRISE_WALLET_PARTY_ID");
export const ENTERPRISE_WALLET_APP_NAME = readString(
  "VITE_ENTERPRISE_WALLET_APP_NAME",
  "truthoracle",
);
export const ENTERPRISE_WALLET_URL = trimTrailingSlash(
  readString("VITE_ENTERPRISE_WALLET_URL", "http://localhost:8080"),
);
export const ENTERPRISE_WALLET_PROXY_URL = trimTrailingSlash(
  readString("VITE_ENTERPRISE_WALLET_PROXY_URL", "/__proxy/wallet"),
);

export const DEBUG_ACTIVE_CONTRACTS = readBoolean("VITE_DEBUG_ACTIVE_CONTRACTS");
export const DEBUG_WALLET_STATUS = readBoolean("VITE_DEBUG_WALLET_STATUS");

export const PUSHER_KEY = readString(
  "VITE_PUSHER_KEY",
  readString("NEXT_PUBLIC_PUSHER_KEY", "5c9c8369bdc5cdcb8b7c"),
);
export const PUSHER_CLUSTER = readString(
  "VITE_PUSHER_CLUSTER",
  readString("NEXT_PUBLIC_PUSHER_CLUSTER", "ap2"),
);
export const MODULE_ADDRESS = readString(
  "VITE_MODULE_ADDRESS",
  readString(
    "NEXT_PUBLIC_MODULE_ADDRESS",
    "0xbde9b5978954614b28adf8e8c71d919271ccad89a878d4d914249444a31f2b49",
  ),
);
