/**
 * TruthOracle DAML — create on-ledger contracts via the Canton participant.
 *
 * Default: creates `Truthoracle:MarketCounter` { admin, value: 0 } using the
 * interactive submission flow (prepare + execute) against the Canton JSON Ledger API.
 *
 * NOTE on `admin` / signing:
 *   The interactive submission `execute` step requires the acting party's *external
 *   signature* of the prepared-transaction hash. The script cannot produce that — only
 *   the holder of the party's key (e.g. the Cantor8 wallet) can. So:
 *     - If `VITE_TRUTHORACLE_ADMIN_PARTY_ID` is a self-custody / external party
 *       (the participant does not hold its key), `execute` will fail with
 *       "did not provide an external signature" — that's expected; the prepared
 *       transaction must be signed and executed via the Cantor8 wallet instead.
 *     - If it points at a participant-hosted party, `execute` succeeds (participant signs).
 *
 * Every HTTP call is logged as a copy-pasteable `curl` plus its full response — nothing
 * redacted (real bearer token, client secret, response bodies). Treat the output as sensitive.
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

let curlSeq = 0;

/** Build a copy-pasteable curl command equivalent to the given fetch call (nothing redacted). */
function curlOf(url: string, init: RequestInit): string {
  const parts: string[] = [`curl -sS -X ${init.method ?? "GET"} '${url}'`];
  const headers = (init.headers ?? {}) as Record<string, string>;
  for (const [k, v] of Object.entries(headers)) {
    parts.push(`  -H '${k}: ${v}'`);
  }
  if (typeof init.body === "string" && init.body.length) {
    parts.push(`  --data '${init.body.replace(/'/g, "'\\''")}'`);
  }
  return parts.join(" \\\n");
}

/** fetch + JSON parse, logging the equivalent curl and the response body. */
async function fetchJsonLogged(label: string, url: string, init: RequestInit): Promise<{ ok: boolean; status: number; data: Json }> {
  const n = ++curlSeq;
  console.log(`\n──────────────────────────────────────────────────────────────`);
  console.log(`# [${n}] ${label}`);
  console.log(`# REQUEST (curl):`);
  console.log(curlOf(url, init));
  const res = await fetch(url, init);
  const text = await res.text();
  console.log(`# RESPONSE: HTTP ${res.status} ${res.statusText}`);
  console.log(text || "(empty body)");
  console.log(`──────────────────────────────────────────────────────────────`);
  let data: Json = {};
  if (text) {
    try {
      data = JSON.parse(text) as Json;
    } catch {
      data = { _raw: text };
    }
  }
  return { ok: res.ok, status: res.status, data };
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

  const r = await fetchJsonLogged("Keycloak token (client_credentials)", tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) throw new Error(`Keycloak token request failed (${r.status})`);
  const data = r.data;
  const token = data.access_token;
  if (typeof token !== "string" || !token) throw new Error("Keycloak response missing access_token");
  return token;
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function getSynchronizerId(token: string, baseUrl: string) {
  const r = await fetchJsonLogged("GET connected-synchronizers", `${baseUrl}/v2/state/connected-synchronizers`, {
    method: "GET",
    headers: authHeaders(token),
  });
  if (!r.ok) throw new Error(`connected-synchronizers failed (${r.status})`);
  const first = (r.data as any).connectedSynchronizers?.[0]?.synchronizerId;
  if (!first || typeof first !== "string") throw new Error("No synchronizerId found in connected-synchronizers response");
  return first;
}

async function queryActiveContractIdByTemplate(opts: {
  token: string;
  baseUrl: string;
  partyId: string;
  templateId: string;
}) {
  const le = await fetchJsonLogged("GET ledger-end", `${opts.baseUrl}/v2/state/ledger-end`, {
    method: "GET",
    headers: authHeaders(opts.token),
  });
  const offset = typeof (le.data as any).offset === "number" ? (le.data as any).offset : 0;

  const body = JSON.stringify({
    verbose: false,
    activeAtOffset: String(offset),
    eventFormat: {
      filtersByParty: {
        [opts.partyId]: {
          cumulative: [
            { identifierFilter: { TemplateFilter: { value: { templateId: opts.templateId, includeCreatedEventBlob: false } } } },
          ],
        },
      },
      verbose: false,
    },
  });
  const r = await fetchJsonLogged("POST active-contracts", `${opts.baseUrl}/v2/state/active-contracts`, {
    method: "POST",
    headers: authHeaders(opts.token),
    body,
  });
  const raw = r.data as any;
  const list = Array.isArray(raw) ? raw : (raw.activeContracts ?? raw.contracts ?? []);
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
  // Only sent if explicitly configured; otherwise the participant derives the user from the token.
  const PREPARE_USER_ID = viteEnv("VITE_PREPARE_USER_ID");

  // Always use Keycloak client_credentials (same as frontend participant API + Keycloak).
  const bearerToken = await getKeycloakAccessToken({
    keycloakUrl: mustEnv(viteEnv("VITE_KEYCLOAK_URL"), "VITE_KEYCLOAK_URL"),
    realm: viteEnv("VITE_KEYCLOAK_REALM") || "master",
    clientId: mustEnv(viteEnv("VITE_KEYCLOAK_CLIENT_ID"), "VITE_KEYCLOAK_CLIENT_ID"),
    clientSecret: mustEnv(viteEnv("VITE_KEYCLOAK_CLIENT_SECRET"), "VITE_KEYCLOAK_CLIENT_SECRET"),
  });

  const synchronizerId = await getSynchronizerId(bearerToken, BASE_URL);

  const admin = explicitAdminPartyId || DEFAULT_ADMIN_PARTY_ID;
  const adminSource = explicitAdminPartyId ? "VITE_TRUTHORACLE_ADMIN_PARTY_ID" : "repo default (DEFAULT_ADMIN_PARTY_ID)";

  console.log("=== TruthOracle: create MarketCounter contract ===");
  console.log(`BASE_URL=${BASE_URL}`);
  console.log(`TEMPLATE_ID=${TEMPLATE_ID}`);
  console.log(`admin=${admin}  (${adminSource})`);
  console.log(`synchronizerId=${synchronizerId}`);

  const commandId = `cmd-${Date.now()}-${randomUUID()}`;
  const prepareBody: Json = {
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
  if (PREPARE_USER_ID) prepareBody.userId = PREPARE_USER_ID;

  const prep = await fetchJsonLogged("POST interactive-submission/prepare", `${BASE_URL}/v2/interactive-submission/prepare`, {
    method: "POST",
    headers: authHeaders(bearerToken),
    body: JSON.stringify(prepareBody),
  });
  if (!prep.ok) throw new Error(`prepare failed (${prep.status})`);

  const preparedTransaction = (prep.data as any).preparedTransaction ?? (prep.data as any).prepared_transaction ?? "";
  const hashingSchemeVersion = (prep.data as any).hashingSchemeVersion ?? "HASHING_SCHEME_VERSION_V2";
  if (typeof preparedTransaction !== "string" || !preparedTransaction) {
    throw new Error("Prepare did not return preparedTransaction");
  }

  // Interactive execute. For a participant-hosted party the participant signs (empty partySignatures works).
  // For an external / self-custody party this fails with "did not provide an external signature" — by design;
  // the prepared transaction above must instead be signed + executed via the Cantor8 wallet.
  const executeBody: Json = {
    preparedTransaction,
    hashingSchemeVersion,
    partySignatures: { signatures: [] },
    deduplicationPeriod: { Empty: {} },
    submissionId: `sub-${Date.now()}-${randomUUID()}`,
  };
  const exec = await fetchJsonLogged("POST interactive-submission/execute", `${BASE_URL}/v2/interactive-submission/execute`, {
    method: "POST",
    headers: authHeaders(bearerToken),
    body: JSON.stringify(executeBody),
  });

  if (!exec.ok) {
    const cause = String((exec.data as any).cause ?? "");
    if (/external signature/i.test(cause)) {
      console.log(
        [
          "",
          "⚠️  execute failed because the acting party is an EXTERNAL / self-custody party:",
          `    ${admin}`,
          "    The participant does not hold its key, so the prepared transaction (logged above)",
          "    must be signed + executed via the Cantor8 wallet instead — or point",
          "    VITE_TRUTHORACLE_ADMIN_PARTY_ID at a participant-hosted party for seeding.",
        ].join("\n")
      );
    }
    throw new Error(`execute failed (${exec.status})`);
  }

  const updateId = (exec.data as any).updateId ?? (exec.data as any).update_id ?? "";
  console.log(`\nExecute done. updateId: ${updateId || "(none)"}`);

  await new Promise((r) => setTimeout(r, 800));
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
      "TruthOracle — create DAML contracts on the participant (logs curl + response for every call).",
      "",
      "Usage:",
      "  npm run create:contract",
      "  npm run create:contract -- market-counter",
      "",
      "Kinds:",
      "  market-counter (default) — Create Truthoracle:MarketCounter { admin, value: 0 }",
      "",
      "Config: same VITE_* vars as the frontend (.env in repo root).",
      "  VITE_CANTON_PARTICIPANT_URL, VITE_TRUTHORACLE_PACKAGE_ID, VITE_TRUTHORACLE_PACKAGE_NAME",
      "  VITE_KEYCLOAK_URL, VITE_KEYCLOAK_REALM, VITE_KEYCLOAK_CLIENT_ID, VITE_KEYCLOAK_CLIENT_SECRET",
      "",
      "Optional:",
      "  VITE_TRUTHORACLE_ADMIN_PARTY_ID — MarketCounter admin / actAs party (else repo dev default).",
      "    NOTE: if this is an external/self-custody party, `execute` requires a wallet signature.",
      "  VITE_PREPARE_USER_ID — prepare userId (default: omit; participant derives it from the token).",
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
