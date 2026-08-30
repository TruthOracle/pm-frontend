/**
 * TruthOracle — grant ledger-user rights for a party on a Canton participant.
 *
 * A freshly created party (e.g. via the Enterprise Wallet's POST /api/v1/accounts)
 * is NOT readable by the Keycloak client the scripts/proxies authenticate with:
 * active-contracts returns HTTP 403 until the client's ledger user is granted
 * CanReadAs/CanActAs for that party. This script performs that grant. It is
 * idempotent — existing rights are detected and skipped — and requires the
 * authenticated user to hold ParticipantAdmin.
 *
 * Usage:
 *   npm run rights:grant                        # grant CanReadAs + CanActAs for
 *                                               # VITE_ENTERPRISE_WALLET_PARTY_ID
 *                                               # to the token's own ledger user
 *   npm run rights:grant -- --party <partyId>   # grant for another party
 *   npm run rights:grant -- --user <userId>     # grant to another ledger user
 *   npm run rights:grant -- --read-only         # grant only CanReadAs
 *
 * Config: root `.env` (same variables the other scripts read).
 *   Required: VITE_CANTON_PARTICIPANT_URL, KEYCLOAK_* (or VITE_KEYCLOAK_*),
 *             VITE_ENTERPRISE_WALLET_PARTY_ID (unless --party is given)
 */

import dotenv from "dotenv";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

type Json = Record<string, unknown>;

function viteEnv(name: string) {
  const v = process.env[name];
  return typeof v === "string" ? v.trim() : "";
}

function firstEnv(...names: string[]) {
  for (const name of names) {
    const value = viteEnv(name);
    if (value) return value;
  }
  return "";
}

function mustEnv(value: string, name: string) {
  if (!value || !value.trim()) throw new Error(`Missing required config: ${name}`);
  return value;
}

function stripTrailingSlash(url: string) {
  return url.replace(/\/$/, "");
}

async function fetchJson(url: string, init: RequestInit): Promise<Json> {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}: ${text.slice(0, 1200)}`);
  if (!text) return {};
  return JSON.parse(text) as Json;
}

async function getKeycloakAccessToken(opts: {
  keycloakUrl: string;
  realm: string;
  clientId: string;
  clientSecret: string;
}) {
  const tokenUrl = `${stripTrailingSlash(opts.keycloakUrl)}/realms/${opts.realm}/protocol/openid-connect/token`;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
  }).toString();
  const data = await fetchJson(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const token = data.access_token;
  if (typeof token !== "string" || !token) throw new Error("Keycloak response missing access_token");
  return token;
}

type Right = { kind: Record<string, { value: { party?: string } }> };

function hasRight(rights: Right[], kind: "CanReadAs" | "CanActAs", party: string) {
  return rights.some((r) => r.kind?.[kind]?.value?.party === party);
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log([
      "Grant CanReadAs/CanActAs rights for a party to a ledger user (JSON Ledger API).",
      "",
      "Usage:",
      "  npm run rights:grant                        # VITE_ENTERPRISE_WALLET_PARTY_ID → own user",
      "  npm run rights:grant -- --party <partyId>   # grant for a specific party",
      "  npm run rights:grant -- --user <userId>     # grant to a specific ledger user",
      "  npm run rights:grant -- --read-only         # grant only CanReadAs",
      "",
      "Requires the authenticated user to hold ParticipantAdmin. Idempotent.",
      "",
      "Config (root `.env`):",
      "  VITE_CANTON_PARTICIPANT_URL, KEYCLOAK_* (or VITE_KEYCLOAK_*),",
      "  VITE_ENTERPRISE_WALLET_PARTY_ID (unless --party is given)",
    ].join("\n"));
    return;
  }

  const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.join(scriptsDir, "..");
  const rootEnv = path.join(repoRoot, ".env");
  if (fs.existsSync(rootEnv)) dotenv.config({ path: rootEnv });

  const argv = process.argv.slice(2);
  const readOnly = argv.includes("--read-only");
  const partyIdx = argv.indexOf("--party");
  const userIdx = argv.indexOf("--user");
  const partyOverride = partyIdx >= 0 ? argv[partyIdx + 1] : "";
  const userOverride = userIdx >= 0 ? argv[userIdx + 1] : "";

  const LEDGER_API = stripTrailingSlash(
    mustEnv(viteEnv("VITE_CANTON_PARTICIPANT_URL"), "VITE_CANTON_PARTICIPANT_URL"),
  );
  const PARTY = partyOverride
    || mustEnv(viteEnv("VITE_ENTERPRISE_WALLET_PARTY_ID"), "VITE_ENTERPRISE_WALLET_PARTY_ID (or pass --party)");

  const bearerToken = await getKeycloakAccessToken({
    keycloakUrl: mustEnv(firstEnv("KEYCLOAK_URL", "VITE_KEYCLOAK_URL"), "KEYCLOAK_URL"),
    realm: firstEnv("KEYCLOAK_REALM", "VITE_KEYCLOAK_REALM") || "master",
    clientId: mustEnv(firstEnv("KEYCLOAK_CLIENT_ID", "VITE_KEYCLOAK_CLIENT_ID"), "KEYCLOAK_CLIENT_ID"),
    clientSecret: mustEnv(firstEnv("KEYCLOAK_CLIENT_SECRET", "VITE_KEYCLOAK_CLIENT_SECRET"), "KEYCLOAK_CLIENT_SECRET"),
  });
  const headers = { Authorization: `Bearer ${bearerToken}`, "Content-Type": "application/json" };

  // Default target: the ledger user the token itself authenticates as.
  let userId = userOverride;
  if (!userId) {
    const me = await fetchJson(`${LEDGER_API}/v2/authenticated-user`, { method: "GET", headers });
    userId = String((me as any)?.user?.id ?? "");
    if (!userId) throw new Error("Could not resolve the authenticated ledger user; pass --user <userId>.");
  }

  console.log(`Participant: ${LEDGER_API}`);
  console.log(`Ledger user: ${userId}`);
  console.log(`Party:       ${PARTY}\n`);

  const rightsUrl = `${LEDGER_API}/v2/users/${encodeURIComponent(userId)}/rights`;
  const existing = ((await fetchJson(rightsUrl, { method: "GET", headers })) as any).rights ?? [];
  const hasReadAs = hasRight(existing, "CanReadAs", PARTY);
  const hasActAs = hasRight(existing, "CanActAs", PARTY);
  console.log(`Existing rights for party — CanReadAs: ${hasReadAs}, CanActAs: ${hasActAs}`);

  const toGrant: Right[] = [];
  if (!hasReadAs) toGrant.push({ kind: { CanReadAs: { value: { party: PARTY } } } });
  if (!readOnly && !hasActAs) toGrant.push({ kind: { CanActAs: { value: { party: PARTY } } } });

  if (toGrant.length === 0) {
    console.log("Nothing to grant — rights already present.");
    return;
  }

  const granted = await fetchJson(rightsUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ userId, identityProviderId: "", rights: toGrant }),
  });
  const newly = ((granted as any).newlyGrantedRights ?? []) as Right[];
  console.log(
    `Granted: ${newly.map((r) => Object.keys(r.kind)[0]).join(", ") || "(none — participant reported no new rights)"}`,
  );

  // Sanity probe: the same call that 403s when rights are missing.
  const ledgerEnd = await fetchJson(`${LEDGER_API}/v2/state/ledger-end`, { method: "GET", headers });
  const activeAtOffset = String(typeof (ledgerEnd as any).offset === "number" ? (ledgerEnd as any).offset : 0);
  await fetchJson(`${LEDGER_API}/v2/state/active-contracts`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      verbose: false,
      activeAtOffset,
      eventFormat: {
        filtersByParty: {
          [PARTY]: {
            cumulative: [
              { identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } },
            ],
          },
        },
        verbose: false,
      },
    }),
  });
  console.log("Verified: active-contracts now readable as this party.");
}

main().catch((e) => {
  console.error("\nError:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
