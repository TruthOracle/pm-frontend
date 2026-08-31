/**
 * TruthOracle DAML — create on-ledger contracts where the C8 Enterprise Wallet signs
 * for the admin party.
 *
 * Flow (v0.1.28+): one POST to /api/v1/external/submit on the local Enterprise Wallet
 * — the wallet prepares + signs + executes the transaction with the admin party's key.
 * The wallet runs with AUTH_TYPE=keycloak, so every wallet call carries a Bearer JWT
 * obtained via client_credentials from KEYCLOAK_CLIENT_ID/SECRET (same client as the
 * Ledger API), with the issuer from KEYCLOAK_URL or VITE_KEYCLOAK_URL.
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
 *   npm run create:contract -- market-counter
 *   npm run create:contract -- user-wallet <ownerPartyId> [initialCC] [txRef]
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
    // Don't print the JWT into logs.
    const shown = k.toLowerCase() === "authorization" ? "Bearer <redacted>" : v;
    parts.push(`  -H '${k}: ${shown}'`);
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

function mustEnv(value: string, name: string) {
  if (!value || !value.trim()) throw new Error(`Missing required config: ${name}`);
  return value;
}

/**
 * Keycloak client_credentials token for the Enterprise Wallet (AUTH_TYPE=keycloak).
 * The wallet validates tokens against ITS OWN Keycloak, which may differ from the
 * Ledger API's — WALLET_KEYCLOAK_* wins when set (same order as the wallet proxy);
 * a 401 "Key ID … not found in JWKS" from the wallet means the token issuer is wrong.
 */
async function fetchWalletBearerToken(): Promise<string> {
  const url = stripTrailingSlash(mustEnv(
    viteEnv("WALLET_KEYCLOAK_URL") || viteEnv("KEYCLOAK_URL") || viteEnv("VITE_KEYCLOAK_URL"),
    "WALLET_KEYCLOAK_URL or KEYCLOAK_URL",
  ));
  const realm = viteEnv("WALLET_KEYCLOAK_REALM") || viteEnv("KEYCLOAK_REALM") || viteEnv("VITE_KEYCLOAK_REALM") || "master";
  // No VITE_ fallback for the credentials — see api/proxy/_keycloakToken.mjs. URL and
  // REALM may still come from VITE_KEYCLOAK_* above; they are not secrets.
  const clientId = mustEnv(
    viteEnv("WALLET_KEYCLOAK_CLIENT_ID") || viteEnv("KEYCLOAK_CLIENT_ID"),
    "WALLET_KEYCLOAK_CLIENT_ID or KEYCLOAK_CLIENT_ID",
  );
  const clientSecret = mustEnv(
    viteEnv("WALLET_KEYCLOAK_CLIENT_SECRET") || viteEnv("KEYCLOAK_CLIENT_SECRET"),
    "WALLET_KEYCLOAK_CLIENT_SECRET or KEYCLOAK_CLIENT_SECRET",
  );

  const res = await fetch(`${url}/realms/${realm}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  });
  if (!res.ok) {
    throw new Error(`Keycloak token request failed (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("Keycloak response missing access_token");
  return data.access_token;
}

async function createMarketCounter() {
  const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.join(scriptsDir, "..");
  const rootEnv = path.join(repoRoot, ".env");
  if (fs.existsSync(rootEnv)) dotenv.config({ path: rootEnv });

  const WALLET_URL = stripTrailingSlash(viteEnv("VITE_ENTERPRISE_WALLET_URL") || "http://localhost:8080");
  const PACKAGE_ID = mustEnv(viteEnv("VITE_TRUTHORACLE_PACKAGE_ID"), "VITE_TRUTHORACLE_PACKAGE_ID");
  const APP_NAME = viteEnv("VITE_ENTERPRISE_WALLET_APP_NAME") || "truthoracle";
  const admin = mustEnv(viteEnv("VITE_ENTERPRISE_WALLET_PARTY_ID"), "VITE_ENTERPRISE_WALLET_PARTY_ID");

  const TEMPLATE_ID = `${PACKAGE_ID}:Truthoracle:MarketCounter`;
  const commandId = `cmd-${Date.now()}-${randomUUID()}`;
  const bearer = await fetchWalletBearerToken();
  const authHeader = { Authorization: `Bearer ${bearer}` };

  console.log("=== TruthOracle: create MarketCounter (via wallet /api/v1/external/submit) ===");
  console.log(`WALLET=${WALLET_URL}`);
  console.log(`TEMPLATE_ID=${TEMPLATE_ID}`);
  console.log(`appName=${APP_NAME}`);
  console.log(`admin=${admin}`);
  console.log(`commandId=${commandId}`);

  // 1. Confirm the admin party is registered with the wallet (else the wallet has no key for it).
  const acct = await fetchJsonLogged(
    "GET wallet admin account",
    `${WALLET_URL}/api/v1/accounts/${encodeURIComponent(admin)}`,
    { method: "GET", headers: { ...authHeader } }
  );
  if (!acct.ok) {
    throw new Error(
      `Admin party ${admin} is not registered with the wallet at ${WALLET_URL}. ` +
        `Create it via POST /api/v1/accounts (see wallet-deploy/README.md).`
    );
  }

  // 2. Submit the create — wallet handles prepare + sign + execute end-to-end.
  const submitBody: Json = {
    partyId: admin,
    appName: APP_NAME,
    commandId,
    commands: [
      {
        CreateCommand: {
          templateId: TEMPLATE_ID,
          // Daml `Int` (Int64) — JSON Ledger API accepts a numeric string.
          createArguments: { admin, value: "0" },
        },
      },
    ],
    disclosedContracts: [],
  };
  const submit = await fetchJsonLogged(
    "POST wallet /api/v1/external/submit",
    `${WALLET_URL}/api/v1/external/submit`,
    { method: "POST", headers: { "Content-Type": "application/json", ...authHeader }, body: JSON.stringify(submitBody) }
  );
  if (!submit.ok) throw new Error(`wallet external/submit failed (${submit.status})`);

  console.log(`\nDone. Wallet returned: ${typeof submit.data === "string" ? submit.data : JSON.stringify(submit.data)}`);
  console.log(
    `\nMarketCounter creation submitted. Get the contract id via the frontend's fetchMarketCounterContractId() ` +
      `or by querying active-contracts as ${admin} (template ${TEMPLATE_ID}).`
  );
}

/**
 * Create a UserWallet for `owner` (in-app balance, custodied by the admin).
 * With initialCC > 0 the wallet is seeded as an already-credited deposit —
 * equivalent to create(balance 0) + Deposit, since the admin is sole signatory.
 * Run this AFTER the owner's real CC transfer landed in the treasury; txRef
 * records that transfer for audit.
 */
async function createUserWallet(owner: string, initialCC: number, txRef: string) {
  const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.join(scriptsDir, "..");
  const rootEnv = path.join(repoRoot, ".env");
  if (fs.existsSync(rootEnv)) dotenv.config({ path: rootEnv });

  const WALLET_URL = stripTrailingSlash(viteEnv("VITE_ENTERPRISE_WALLET_URL") || "http://localhost:8080");
  const PACKAGE_ID = mustEnv(viteEnv("VITE_TRUTHORACLE_PACKAGE_ID"), "VITE_TRUTHORACLE_PACKAGE_ID");
  const APP_NAME = viteEnv("VITE_ENTERPRISE_WALLET_APP_NAME") || "truthoracle";
  const admin = mustEnv(viteEnv("VITE_ENTERPRISE_WALLET_PARTY_ID"), "VITE_ENTERPRISE_WALLET_PARTY_ID");
  if (!owner) throw new Error("user-wallet requires <ownerPartyId>: npm run create:contract -- user-wallet <ownerPartyId> [initialCC] [txRef]");
  if (!(initialCC >= 0)) throw new Error(`initialCC must be a non-negative number, got: ${initialCC}`);

  const TEMPLATE_ID = `${PACKAGE_ID}:Truthoracle:UserWallet`;
  const commandId = `cmd-${Date.now()}-${randomUUID()}`;
  const bearer = await fetchWalletBearerToken();
  const amount = initialCC.toFixed(10); // Daml Decimal as string

  console.log("=== TruthOracle: create UserWallet (via wallet /api/v1/external/submit) ===");
  console.log(`WALLET=${WALLET_URL}`);
  console.log(`TEMPLATE_ID=${TEMPLATE_ID}`);
  console.log(`owner=${owner}`);
  console.log(`initialCC=${amount}${txRef ? ` (txRef=${txRef})` : ""}`);

  const submitBody: Json = {
    partyId: admin,
    appName: APP_NAME,
    commandId,
    commands: [
      {
        CreateCommand: {
          templateId: TEMPLATE_ID,
          createArguments: {
            admin,
            owner,
            balanceCC: amount,
            depositedCC: amount,
            withdrawnCC: "0.0000000000",
          },
        },
      },
    ],
    disclosedContracts: [],
  };
  const submit = await fetchJsonLogged(
    "POST wallet /api/v1/external/submit",
    `${WALLET_URL}/api/v1/external/submit`,
    { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer}` }, body: JSON.stringify(submitBody) }
  );
  if (!submit.ok) throw new Error(`wallet external/submit failed (${submit.status})`);
  console.log(`\nDone. UserWallet for ${owner} submitted (balance ${amount} CC).`);
}

export async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log([
      "TruthOracle — create DAML contracts (Enterprise Wallet signs).",
      "",
      "Usage:",
      "  npm run create:contract",
      "  npm run create:contract -- market-counter",
      "  npm run create:contract -- user-wallet <ownerPartyId> [initialCC] [txRef]",
      "",
      "Required .env:",
      "  VITE_TRUTHORACLE_PACKAGE_ID — DAR package id",
      "  VITE_ENTERPRISE_WALLET_PARTY_ID — admin party id (must be registered with the wallet)",
      "  KEYCLOAK_URL / KEYCLOAK_CLIENT_ID / KEYCLOAK_CLIENT_SECRET — wallet Bearer token (AUTH_TYPE=keycloak)",
      "",
      "Optional:",
      "  VITE_ENTERPRISE_WALLET_URL — wallet base URL (default http://localhost:8080)",
      "  VITE_ENTERPRISE_WALLET_APP_NAME — appName field sent to /external/submit (default 'truthoracle')",
    ].join("\n"));
    return;
  }

  const positional = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const kind = (positional[0] || "market-counter").toLowerCase();
  if (kind === "market-counter") {
    await createMarketCounter();
    return;
  }
  if (kind === "user-wallet") {
    await createUserWallet(positional[1] ?? "", Number(positional[2] ?? "0"), positional[3] ?? "");
    return;
  }
  throw new Error(`Unknown contract kind "${kind}". Use: market-counter | user-wallet (or run with --help)`);
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
