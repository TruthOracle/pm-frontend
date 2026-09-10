/**
 * Single source of truth for where the ledger and wallet live, and which Keycloak
 * credentials reach them. Previously this resolution was duplicated inside each
 * proxy; the server-side helpers in api/_lib need exactly the same answers, and two
 * copies would eventually disagree about which network they were on.
 */

import { keycloakBearer } from "../proxy/_keycloakToken.mjs";

export const IS_MAINNET = () =>
  (process.env.VITE_APP_NETWORK || "").trim().toLowerCase() === "mainnet";

/**
 * On mainnet only the ZKPC_* names are read — no fallback to the devnet ones — so a
 * misconfigured deploy fails fast rather than minting tokens against the wrong
 * Keycloak, which the participant rejects with an opaque 401.
 */
export const LEDGER_TARGET_ENV = () =>
  IS_MAINNET() ? ["ZKPC_LEDGER_API_URL"] : ["CANTON_LEDGER_PROXY_TARGET_URL", "VITE_CANTON_PARTICIPANT_URL"];

export const LEDGER_AUTH_PREFIXES = () =>
  IS_MAINNET() ? ["ZKPC_KEYCLOAK"] : ["LEDGER_KEYCLOAK", "KEYCLOAK", "VITE_KEYCLOAK"];

// The wallet trusts its OWN Keycloak on every network, not the zkpc node's.
export const WALLET_TARGET_ENV = ["ENTERPRISE_WALLET_PROXY_TARGET_URL", "VITE_ENTERPRISE_WALLET_URL"];
export const WALLET_AUTH_PREFIXES = ["WALLET_KEYCLOAK", "KEYCLOAK", "VITE_KEYCLOAK"];

export function absoluteTarget(value) {
  const trimmed = typeof value === "string" ? value.trim().replace(/\/$/, "") : "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : "";
}

export function resolveTarget(names) {
  for (const name of names) {
    const target = absoluteTarget(process.env[name]);
    if (target) return target;
  }
  return "";
}

export const ledgerBaseUrl = () => resolveTarget(LEDGER_TARGET_ENV());
export const walletBaseUrl = () => resolveTarget(WALLET_TARGET_ENV);

export const adminPartyId = () => (process.env.VITE_ENTERPRISE_WALLET_PARTY_ID || "").trim();
export const appName = () => (process.env.VITE_ENTERPRISE_WALLET_APP_NAME || "truthoracle").trim();
export const packageId = () => (process.env.VITE_TRUTHORACLE_PACKAGE_ID || "").trim();
/**
 * daml.yaml `name:` of the TruthOracle package. Active-contracts filters must reference
 * templates by package NAME ("#name:Module:Entity"); the participant rejects the
 * package-id form with INVALID_FIELD "expected a package name". Commands keep using
 * packageId() — those accept (and are pinned by) the id.
 */
export const packageName = () => (process.env.VITE_TRUTHORACLE_PACKAGE_NAME || "").trim();

/** Authenticated JSON call to an upstream. Throws with the upstream body on failure. */
export async function authedJson(baseUrl, path, { method = "GET", body, authPrefixes } = {}) {
  const token = await keycloakBearer(authPrefixes);
  if (!token) throw new Error(`Could not mint an upstream token (tried ${authPrefixes.join(", ")})`);

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`${method} ${path} failed: HTTP ${res.status} ${text.slice(0, 600)}`);
    err.status = res.status;
    throw err;
  }
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
