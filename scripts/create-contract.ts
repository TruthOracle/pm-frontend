/**
 * TruthOracle DAML — create on-ledger contracts where the C8 Enterprise Wallet signs
 * for the admin party.
 *
 * Hybrid flow:
 *   1. POST /v2/interactive-submission/prepare on the Canton participant (Keycloak token)
 *      → returns preparedTxB64 + preparedTransactionHash + hashingSchemeVersion.
 *   2. POST /api/v1/transaction/sign_and_execute on the local Enterprise Wallet
 *      → wallet signs the hash with the admin party's key and executes.
 *
 * This is the same pattern the popup SDK uses (`signAndExecutePreparedTransfer`); we just
 * point at the self-hosted Enterprise Wallet REST endpoint instead.
 *
 * Why not /api/v1/external/submit?
 *   In v0.1.21 the wallet's request validator types `commands[]` as JSON-strings while the
 *   downstream backend expects dicts; the wallet does not translate between them, so the
 *   call always fails with "Input should be a valid dictionary". The hybrid flow avoids
 *   the external/* endpoints entirely and uses the well-defined sign_and_execute primitive.
 *
 * Every HTTP call is logged as a copy-pasteable `curl` plus its full response.
 *
 * Setup:
 *   1. Run the wallet — see wallet-deploy/README.md.
 *   2. Create the admin account once (returns a partyId):
 *        curl -X POST $VITE_ENTERPRISE_WALLET_URL/api/v1/accounts \
 *          -H 'Content-Type: application/json' \
 *          -d '{"desiredAccountName":"truthoracle-admin","validatorId":0,"preApproveAmuletTransfers":true}'
 *   3. Set in .env: VITE_ENTERPRISE_WALLET_PARTY_ID=<that partyId>
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

async function fetchJsonLogged(label: string, url: string, init: RequestInit): Promise<{ ok: boolean; status: number; data: Json | string }> {
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
  let data: Json | string = "";
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { ok: res.ok, status: res.status, data };
}

async function getKeycloakAccessToken(opts: { keycloakUrl: string; realm: string; clientId: string; clientSecret: string }) {
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
  const token = (r.data as any)?.access_token;
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
  const first = (r.data as any)?.connectedSynchronizers?.[0]?.synchronizerId;
  if (typeof first !== "string" || !first) throw new Error("No synchronizerId found");
  return first;
}

function mustEnv(value: string, name: string) {
  if (!value || !value.trim()) throw new Error(`Missing required config: ${name}`);
  return value;
}

async function createMarketCounter() {
  const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.join(scriptsDir, "..");
  const rootEnv = path.join(repoRoot, ".env");
  if (fs.existsSync(rootEnv)) dotenv.config({ path: rootEnv });

  const BASE_URL = stripTrailingSlash(mustEnv(viteEnv("VITE_CANTON_PARTICIPANT_URL"), "VITE_CANTON_PARTICIPANT_URL"));
  const WALLET_URL = stripTrailingSlash(viteEnv("VITE_ENTERPRISE_WALLET_URL") || "http://localhost:8080");
  const PACKAGE_ID = mustEnv(viteEnv("VITE_TRUTHORACLE_PACKAGE_ID"), "VITE_TRUTHORACLE_PACKAGE_ID");
  const admin = mustEnv(viteEnv("VITE_ENTERPRISE_WALLET_PARTY_ID"), "VITE_ENTERPRISE_WALLET_PARTY_ID");

  const TEMPLATE_ID = `${PACKAGE_ID}:Truthoracle:MarketCounter`;
  const commandId = `cmd-${Date.now()}-${randomUUID()}`;

  console.log("=== TruthOracle: create MarketCounter (hybrid: prepare on participant, sign+execute on wallet) ===");
  console.log(`PARTICIPANT=${BASE_URL}`);
  console.log(`WALLET=${WALLET_URL}`);
  console.log(`TEMPLATE_ID=${TEMPLATE_ID}`);
  console.log(`admin=${admin}`);
  console.log(`commandId=${commandId}`);

  // 1. Confirm the admin party is registered with the wallet (else the wallet has no key for it).
  const acct = await fetchJsonLogged(
    "GET wallet admin account",
    `${WALLET_URL}/api/v1/accounts/${encodeURIComponent(admin)}`,
    { method: "GET" }
  );
  if (!acct.ok) {
    throw new Error(
      `Admin party ${admin} is not registered with the wallet at ${WALLET_URL}. ` +
        `Create it via POST /api/v1/accounts (see wallet-deploy/README.md).`
    );
  }

  // 2. Keycloak token for the Canton participant Ledger API.
  const bearerToken = await getKeycloakAccessToken({
    keycloakUrl: mustEnv(viteEnv("VITE_KEYCLOAK_URL"), "VITE_KEYCLOAK_URL"),
    realm: viteEnv("VITE_KEYCLOAK_REALM") || "master",
    clientId: mustEnv(viteEnv("VITE_KEYCLOAK_CLIENT_ID"), "VITE_KEYCLOAK_CLIENT_ID"),
    clientSecret: mustEnv(viteEnv("VITE_KEYCLOAK_CLIENT_SECRET"), "VITE_KEYCLOAK_CLIENT_SECRET"),
  });
  const synchronizerId = await getSynchronizerId(bearerToken, BASE_URL);

  // 3. Prepare on the participant.
  const prepareBody: Json = {
    commandId,
    synchronizerId,
    verboseHashing: false,
    commands: [
      {
        CreateCommand: {
          templateId: TEMPLATE_ID,
          // Daml `Int` (Int64) — JSON Ledger API accepts a numeric string.
          createArguments: { admin, value: "0" },
        },
      },
    ],
    actAs: [admin],
    readAs: [],
    disclosedContracts: [],
    packageIdSelectionPreference: [PACKAGE_ID],
  };
  const prep = await fetchJsonLogged(
    "POST /v2/interactive-submission/prepare",
    `${BASE_URL}/v2/interactive-submission/prepare`,
    { method: "POST", headers: authHeaders(bearerToken), body: JSON.stringify(prepareBody) }
  );
  if (!prep.ok) throw new Error(`prepare failed (${prep.status})`);

  const preparedTxB64 = (prep.data as any)?.preparedTransaction ?? (prep.data as any)?.prepared_transaction ?? "";
  const hashB64 = (prep.data as any)?.preparedTransactionHash ?? (prep.data as any)?.prepared_transaction_hash ?? "";
  const hashingSchemeVersion = (prep.data as any)?.hashingSchemeVersion ?? (prep.data as any)?.hashing_scheme_version ?? "HASHING_SCHEME_VERSION_V2";
  if (typeof preparedTxB64 !== "string" || !preparedTxB64) throw new Error("prepare did not return preparedTransaction");
  if (typeof hashB64 !== "string" || !hashB64) throw new Error("prepare did not return preparedTransactionHash (required by wallet sign_and_execute)");

  // 4. Wallet signs the hash with the admin party's key and executes.
  const signBody: Json = { partyId: admin, preparedTxB64, hashingSchemeVersion, hashB64, commandId };
  const exec = await fetchJsonLogged(
    "POST wallet /api/v1/transaction/sign_and_execute",
    `${WALLET_URL}/api/v1/transaction/sign_and_execute`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(signBody) }
  );
  if (!exec.ok) throw new Error(`wallet sign_and_execute failed (${exec.status})`);

  console.log(`\nDone. Wallet returned: ${typeof exec.data === "string" ? exec.data : JSON.stringify(exec.data)}`);
  console.log(
    `\nMarketCounter created. Get the contract id via the frontend's fetchMarketCounterContractId() ` +
      `or by querying active-contracts as ${admin} (template ${TEMPLATE_ID}).`
  );
}

export async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log([
      "TruthOracle — create DAML contracts (Enterprise Wallet signs).",
      "",
      "Usage:",
      "  npm run create:contract",
      "  npm run create:contract -- market-counter",
      "",
      "Required .env:",
      "  VITE_TRUTHORACLE_PACKAGE_ID — DAR package id",
      "  VITE_ENTERPRISE_WALLET_PARTY_ID — admin party id (must be registered with the wallet)",
      "  VITE_CANTON_PARTICIPANT_URL — participant Ledger API base URL",
      "  VITE_KEYCLOAK_URL, VITE_KEYCLOAK_REALM, VITE_KEYCLOAK_CLIENT_ID, VITE_KEYCLOAK_CLIENT_SECRET",
      "",
      "Optional:",
      "  VITE_ENTERPRISE_WALLET_URL — wallet base URL (default http://localhost:8080)",
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
