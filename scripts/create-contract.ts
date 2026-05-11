/**
 * TruthOracle DAML — create on-ledger contracts via the Canton participant.
 *
 * Default: creates `Truthoracle:MarketCounter` (admin + value: 0) using
 * interactive submission (prepare + execute).
 *
 * Env: reads only the repo root `.env` and `VITE_*` keys (same names as the Vite app).
 *
 * Usage:
 *   npm run create:contract
 *   npm run create:contract -- market-counter   # explicit (only kind for now)
 */

import dotenv from "dotenv";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

type Json = Record<string, unknown>;

function viteEnv(name: string) {
  const v = process.env[name];
  return typeof v === "string" ? v.trim() : "";
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

async function getSynchronizerId(token: string, baseUrl: string) {
  const url = `${baseUrl}/v2/state/connected-synchronizers`;
  const raw = await fetchJson(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });

  const first = (raw as any).connectedSynchronizers?.[0]?.synchronizerId;
  if (!first || typeof first !== "string") throw new Error("No synchronizerId found in connected-synchronizers response");
  return first;
}

async function queryActiveContractIdByTemplate(opts: {
  token: string;
  baseUrl: string;
  partyId: string;
  templateId: string;
}) {
  const ledgerEndUrl = `${opts.baseUrl}/v2/state/ledger-end`;
  const ledgerEnd = await fetchJson(ledgerEndUrl, {
    method: "GET",
    headers: { Authorization: `Bearer ${opts.token}`, "Content-Type": "application/json" },
  });
  const offset = typeof (ledgerEnd as any).offset === "number" ? (ledgerEnd as any).offset : 0;

  const url = `${opts.baseUrl}/v2/state/active-contracts`;
  const body = {
    verbose: false,
    activeAtOffset: String(offset),
    eventFormat: {
      filtersByParty: {
        [opts.partyId]: {
          cumulative: [
            {
              identifierFilter: {
                TemplateFilter: { value: { templateId: opts.templateId, includeCreatedEventBlob: false } },
              },
            },
          ],
        },
      },
      verbose: false,
    },
  };

  const raw = await fetchJson(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const list = Array.isArray(raw) ? raw : ((raw as any).activeContracts ?? (raw as any).contracts ?? []);
  if (!Array.isArray(list) || list.length === 0) return "";

  const first = list[0] as any;
  const contractId =
    first?.contractEntry?.JsActiveContract?.createdEvent?.contractId ??
    first?.contractEntry?.JsActiveContract?.contractId ??
    first?.contractId ??
    first?.contract_id ??
    "";
  return typeof contractId === "string" ? contractId : "";
}

function mustEnv(value: string, name: string) {
  if (!value || !value.trim()) throw new Error(`Missing required config: ${name}`);
  return value;
}

async function createMarketCounter() {
  const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.join(scriptsDir, "..");

  // Same `.env` as the Vite app (no separate scripts/.env or non-VITE aliases).
  const rootEnv = path.join(repoRoot, ".env");
  if (fs.existsSync(rootEnv)) dotenv.config({ path: rootEnv });

  const BASE_URL = stripTrailingSlash(viteEnv("VITE_CANTON_PARTICIPANT_URL"));
  if (!BASE_URL) throw new Error("Missing VITE_CANTON_PARTICIPANT_URL in .env (same as the frontend)");

  const PACKAGE_ID = viteEnv("VITE_TRUTHORACLE_PACKAGE_ID");
  if (!PACKAGE_ID) throw new Error("Missing VITE_TRUTHORACLE_PACKAGE_ID in .env (same as the frontend)");
  // daml.yaml `name:` — the active-contracts filter wants a package-name reference, not a package id.
  const PACKAGE_NAME = viteEnv("VITE_TRUTHORACLE_PACKAGE_NAME") || "truthoracle";

  // TruthOracle Daml admin (MarketCounter signatory). Never use VALIDATOR_PARTY—that is the Cantor8 infra party.
  const DEFAULT_ADMIN_PARTY_ID = "6ff9435fff4d4f43856f688e95a27368::12204e98dc339cc86c6d318f3746f99e880245b4a5827ef1e8bbe7ba6193ef8c0e58";
  /** Set in .env (recommended); falls back to repo dev default. */
  const explicitAdminPartyId = viteEnv("VITE_TRUTHORACLE_ADMIN_PARTY_ID");

  const TEMPLATE_ID = `${PACKAGE_ID}:Truthoracle:MarketCounter`;
  // Package-name reference, used for the active-contracts template filter.
  const TEMPLATE_ID_BY_NAME = `#${PACKAGE_NAME}:Truthoracle:MarketCounter`;
  const PREPARE_USER_ID = viteEnv("VITE_PREPARE_USER_ID") || "sachin";

  // Always use Keycloak client_credentials (same as frontend participant API + Keycloak).
  const bearerToken = await getKeycloakAccessToken({
    keycloakUrl: mustEnv(viteEnv("VITE_KEYCLOAK_URL"), "VITE_KEYCLOAK_URL"),
    realm: viteEnv("VITE_KEYCLOAK_REALM") || "master",
    clientId: mustEnv(viteEnv("VITE_KEYCLOAK_CLIENT_ID"), "VITE_KEYCLOAK_CLIENT_ID"),
    clientSecret: mustEnv(viteEnv("VITE_KEYCLOAK_CLIENT_SECRET"), "VITE_KEYCLOAK_CLIENT_SECRET"),
  });

  const synchronizerId = await getSynchronizerId(bearerToken, BASE_URL);

  const admin = explicitAdminPartyId || DEFAULT_ADMIN_PARTY_ID;
  const adminSource = explicitAdminPartyId
    ? "VITE_TRUTHORACLE_ADMIN_PARTY_ID"
    : "repo default (DEFAULT_ADMIN_PARTY_ID)";
  console.log(`Using admin party (${adminSource}): ${admin}`);

  const commandId = `cmd-${Date.now()}-${randomUUID()}`;
  const prepareBody = {
    userId: PREPARE_USER_ID,
    commandId,
    synchronizerId,
    verboseHashing: false,
    commands: [
      {
        CreateCommand: {
          templateId: TEMPLATE_ID,
          // Daml `Int` (Int64) — the JSON Ledger API accepts a numeric string here.
          createArguments: { admin, value: "0" },
        },
      },
    ],
    actAs: [admin],
    readAs: [],
    disclosedContracts: [],
    packageIdSelectionPreference: [PACKAGE_ID],
  };

  console.log("=== TruthOracle: create MarketCounter contract ===");
  console.log(
    "(admin = VITE_TRUTHORACLE_ADMIN_PARTY_ID or repo default — not VALIDATOR_PARTY; see .env.example / INTEGRATION.md)"
  );
  console.log(`BASE_URL=${BASE_URL}`);
  console.log(`TEMPLATE_ID=${TEMPLATE_ID}`);
  console.log(`admin=${admin}`);
  console.log(`synchronizerId=${synchronizerId}`);
  console.log(`commandId=${commandId}`);
  console.log("");

  const prepareResp = await fetchJson(`${BASE_URL}/v2/interactive-submission/prepare`, {
    method: "POST",
    headers: { Authorization: `Bearer ${bearerToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(prepareBody),
  });

  const preparedTransaction =
    (prepareResp as any).preparedTransaction ?? (prepareResp as any).prepared_transaction ?? "";
  if (typeof preparedTransaction !== "string" || !preparedTransaction) {
    console.log("Prepare response (debug):");
    console.log(JSON.stringify(prepareResp, null, 2));
    throw new Error("Prepare did not return preparedTransaction");
  }

  const executeResp = await fetchJson(`${BASE_URL}/v2/interactive-submission/execute`, {
    method: "POST",
    headers: { Authorization: `Bearer ${bearerToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ preparedTransaction }),
  });

  const commandIdOut =
    (executeResp as any).commandId ?? (executeResp as any).command_id ?? (executeResp as any).transactionId ?? "";
  if (typeof commandIdOut === "string" && commandIdOut) {
    console.log(`Execute done. commandId/transactionId: ${commandIdOut}`);
  } else {
    console.log("Execute done.");
  }

  await new Promise((r) => setTimeout(r, 500));
  const cid = await queryActiveContractIdByTemplate({
    token: bearerToken,
    baseUrl: BASE_URL,
    partyId: admin,
    templateId: TEMPLATE_ID_BY_NAME,
  });

  if (cid) console.log(`\nMarketCounter contract ID: ${cid}`);
  else console.log("\nMarketCounter created, but contract id not found yet (refresh later).");
}

export async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log([
      "TruthOracle — create DAML contracts on the participant.",
      "",
      "Usage:",
      "  npm run create:contract",
      "  npm run create:contract -- market-counter",
      "",
      "Kinds:",
      "  market-counter (default) — Create Truthoracle:MarketCounter { admin, value: 0 }",
      "",
      "Config: same VITE_* vars as the frontend (.env in repo root).",
      "  VITE_CANTON_PARTICIPANT_URL, VITE_TRUTHORACLE_PACKAGE_ID",
      "  VITE_KEYCLOAK_URL, VITE_KEYCLOAK_REALM, VITE_KEYCLOAK_CLIENT_ID, VITE_KEYCLOAK_CLIENT_SECRET",
      "",
      "Optional:",
      "  VITE_TRUTHORACLE_ADMIN_PARTY_ID — MarketCounter admin (recommended; else repo dev default)",
      "  VITE_PREPARE_USER_ID — prepare userId (default sachin)",
    ].join("\n"));
    return;
  }

  const positional = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const kind = (positional[0] || "market-counter").toLowerCase();

  if (kind === "market-counter") {
    await createMarketCounter();
    return;
  }

  throw new Error(`Unknown contract kind "${kind}". Use: market-counter (or run with --help)`);
}

const thisFile = path.resolve(fileURLToPath(import.meta.url));
const entryScript = process.argv[1] ? path.resolve(process.argv[1]) : "";
const runAsCli = entryScript === thisFile;

if (runAsCli) {
  void main().catch((e) => {
    console.error("\nError:", e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
