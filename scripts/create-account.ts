/**
 * TruthOracle — register an account (party) with the Enterprise Wallet.
 *
 * One POST to /api/v1/accounts on the wallet: the wallet derives a key from its
 * mnemonic, onboards the party on its validator, and returns the partyId. This is
 * the party the app then uses as VITE_ENTERPRISE_WALLET_PARTY_ID. Idempotent:
 * if an account with the requested name already exists, its partyId is printed
 * and nothing is created.
 *
 * The wallet runs with AUTH_TYPE=keycloak and validates tokens against ITS OWN
 * Keycloak (configured in the wallet's deployment) — which may differ from the
 * Keycloak the Ledger API scripts use. A token from the wrong issuer fails with
 * 401 "Key ID … not found in JWKS". Set WALLET_KEYCLOAK_* to the issuer the
 * wallet trusts; it takes priority over KEYCLOAK_* / VITE_KEYCLOAK_* (same
 * resolution order as api/proxy/_keycloakToken.mjs).
 *
 * Usage:
 *   npm run create:account                                # name 'truthoracle-admin', validatorId 0
 *   npm run create:account -- --name my-admin             # custom account name
 *   npm run create:account -- --validator-id 3            # validator id from Cantor8
 *   npm run create:account -- --coupon <code>             # MainNet onboarding coupon
 *   npm run create:account -- --no-preapprove             # skip amulet transfer pre-approval
 *   npm run create:account -- --list                      # just list registered accounts
 *
 * Config: root `.env`.
 *   Required: VITE_ENTERPRISE_WALLET_URL (or wallet on http://localhost:8080),
 *             WALLET_KEYCLOAK_* or KEYCLOAK_* (client the wallet's Keycloak knows)
 */

import dotenv from "dotenv";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

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

async function fetchText(url: string, init: RequestInit): Promise<{ status: number; ok: boolean; text: string }> {
  const res = await fetch(url, init);
  const text = await res.text();
  return { status: res.status, ok: res.ok, text };
}

/**
 * Mint the wallet Bearer token. WALLET_KEYCLOAK_* wins so the wallet can trust a
 * different Keycloak than the Ledger API without disturbing the ledger credentials.
 */
async function fetchWalletBearerToken(): Promise<string> {
  const url = stripTrailingSlash(
    mustEnv(firstEnv("WALLET_KEYCLOAK_URL", "KEYCLOAK_URL", "VITE_KEYCLOAK_URL"), "WALLET_KEYCLOAK_URL or KEYCLOAK_URL"),
  );
  const realm = firstEnv("WALLET_KEYCLOAK_REALM", "KEYCLOAK_REALM", "VITE_KEYCLOAK_REALM") || "master";
  // No VITE_ fallback for the credentials — see api/proxy/_keycloakToken.mjs. URL and
  // REALM may still come from VITE_KEYCLOAK_* above; they are not secrets.
  const clientId = mustEnv(
    firstEnv("WALLET_KEYCLOAK_CLIENT_ID", "KEYCLOAK_CLIENT_ID"),
    "WALLET_KEYCLOAK_CLIENT_ID or KEYCLOAK_CLIENT_ID",
  );
  const clientSecret = mustEnv(
    firstEnv("WALLET_KEYCLOAK_CLIENT_SECRET", "KEYCLOAK_CLIENT_SECRET"),
    "WALLET_KEYCLOAK_CLIENT_SECRET or KEYCLOAK_CLIENT_SECRET",
  );

  const res = await fetchText(`${url}/realms/${realm}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  });
  if (!res.ok) throw new Error(`Keycloak token request failed: HTTP ${res.status}: ${res.text.slice(0, 800)}`);
  const token = JSON.parse(res.text).access_token;
  if (typeof token !== "string" || !token) throw new Error("Keycloak response missing access_token");
  return token;
}

type AccountInfo = {
  accountName: string;
  validatorId: number;
  partyId?: string;
  isActive?: boolean;
};

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log([
      "Register an account (party) with the Enterprise Wallet via POST /api/v1/accounts.",
      "",
      "Usage:",
      "  npm run create:account                        # name 'truthoracle-admin', slot from WALLET_VALIDATOR_ID",
      "  npm run create:account -- --name <name>       # custom account name",
      "  npm run create:account -- --validator-id <n>  # wallet's numeric validator slot (overrides env)",
      "  npm run create:account -- --coupon <code>     # onboarding coupon (MainNet)",
      "  npm run create:account -- --no-preapprove     # don't pre-approve amulet transfers",
      "  npm run create:account -- --list              # list registered accounts and exit",
      "",
      "Config (root `.env`):",
      "  VITE_ENTERPRISE_WALLET_URL — wallet base URL (default http://localhost:8080)",
      "  WALLET_VALIDATOR_ID — numeric validator slot the party is created on (no default;",
      "    slot 0 is the network default validator, usually NOT the project's node).",
      "  WALLET_VALIDATOR_NAME — the node's name, for humans (e.g. zkpc-cantor8-1).",
      "  WALLET_KEYCLOAK_* — Keycloak the WALLET trusts (falls back to KEYCLOAK_* / VITE_KEYCLOAK_*).",
      "    A 401 'Key ID … not found in JWKS' means the token came from a Keycloak the",
      "    wallet does not trust — set WALLET_KEYCLOAK_* to the wallet's issuer.",
      "",
      "On success, prints the partyId — set it as VITE_ENTERPRISE_WALLET_PARTY_ID, then",
      "run `npm run rights:grant` so the Ledger API client can read/act as it.",
    ].join("\n"));
    return;
  }

  const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.join(scriptsDir, "..");
  const rootEnv = path.join(repoRoot, ".env");
  if (fs.existsSync(rootEnv)) dotenv.config({ path: rootEnv });

  const argv = process.argv.slice(2);
  const listOnly = argv.includes("--list");
  const preApprove = !argv.includes("--no-preapprove");
  const arg = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? (argv[i + 1] ?? "") : "";
  };
  const accountName = arg("--name") || "truthoracle-admin-zkpc";
  // No silent default: slot 0 is the network's default validator, which is the wrong
  // node for this project (that's how the a99dd107… party ended up unreachable from
  // the zkpc participant). The slot must be stated, via flag or WALLET_VALIDATOR_ID.
  const validatorIdRaw = arg("--validator-id") || viteEnv("WALLET_VALIDATOR_ID");
  const coupon = arg("--coupon");
  if (!validatorIdRaw && !listOnly) {
    throw new Error(
      "No validator slot given. Pass --validator-id <n> or set WALLET_VALIDATOR_ID in .env — " +
        "the wallet's NUMERIC slot for the target node" +
        (viteEnv("WALLET_VALIDATOR_NAME") ? ` (WALLET_VALIDATOR_NAME=${viteEnv("WALLET_VALIDATOR_NAME")})` : "") +
        ". Check SDK_VALIDATOR_<n>_NAME in the wallet deployment to find it.",
    );
  }
  const validatorId = Number(validatorIdRaw || "0");
  if (!Number.isInteger(validatorId) || validatorId < 0) {
    throw new Error(`validator id must be a non-negative integer, got "${validatorIdRaw}"`);
  }

  const WALLET_URL = stripTrailingSlash(viteEnv("VITE_ENTERPRISE_WALLET_URL") || "http://localhost:8080");
  const bearer = await fetchWalletBearerToken();
  const headers = { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" };

  console.log(`Wallet: ${WALLET_URL}`);

  const listRes = await fetchText(`${WALLET_URL}/api/v1/accounts`, { method: "GET", headers });
  if (!listRes.ok) {
    throw new Error(
      `GET /api/v1/accounts failed: HTTP ${listRes.status}: ${listRes.text.slice(0, 600)}` +
        (listRes.status === 401
          ? "\nHint: the wallet rejected the token (wrong Keycloak issuer). Set WALLET_KEYCLOAK_URL/" +
            "WALLET_KEYCLOAK_REALM/WALLET_KEYCLOAK_CLIENT_ID/WALLET_KEYCLOAK_CLIENT_SECRET in .env to " +
            "the Keycloak the wallet deployment is configured with."
          : ""),
    );
  }
  const accounts = JSON.parse(listRes.text) as AccountInfo[];

  if (accounts.length) {
    console.log(`Registered accounts (${accounts.length}):`);
    for (const a of accounts) {
      console.log(`  • ${a.accountName} (validatorId=${a.validatorId})  partyId=${a.partyId ?? "(none)"}`);
    }
  } else {
    console.log("Registered accounts: none");
  }
  if (listOnly) return;

  const existing = accounts.find((a) => a.accountName === accountName);
  if (existing?.partyId) {
    console.log(`\nAccount "${accountName}" already exists — nothing created.`);
    console.log(`partyId: ${existing.partyId}`);
    console.log(`\nSet in root .env: VITE_ENTERPRISE_WALLET_PARTY_ID=${existing.partyId}`);
    return;
  }
  if (existing) {
    // A failed registration (e.g. MainNet "No signup ticket provided") leaves a stub
    // account with no partyId that still occupies the name. Re-POSTing the same name
    // may conflict, so require a fresh name for the real attempt.
    throw new Error(
      `Account "${accountName}" exists but has NO partyId (validatorId=${existing.validatorId}) — ` +
        `a stub from a failed registration. Retry with a fresh name, the right slot, and a coupon:\n` +
        `  npm run create:account -- --name ${accountName}-2 --validator-id <n> --coupon <ticket>`,
    );
  }

  // Recovered accounts keep their wallet-generated name ("Recovered MainNet:… Acc #1"),
  // so also match on the configured party id — creating a duplicate party for it would
  // needlessly burn a MainNet signup ticket.
  const configuredParty = viteEnv("VITE_ENTERPRISE_WALLET_PARTY_ID");
  const explicitName = Boolean(arg("--name"));
  const byParty = !explicitName && configuredParty && accounts.find((a) => a.partyId === configuredParty);
  if (byParty) {
    console.log(
      `\nThe configured VITE_ENTERPRISE_WALLET_PARTY_ID is already registered as ` +
        `"${byParty.accountName}" — nothing created. Pass --name with a new name AND a ` +
        `--coupon if you really want an additional account.`,
    );
    return;
  }

  console.log(`\nCreating account "${accountName}" (validatorId=${validatorId}, preApproveAmuletTransfers=${preApprove}${coupon ? ", with coupon" : ""}) …`);
  const createRes = await fetchText(`${WALLET_URL}/api/v1/accounts`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      desiredAccountName: accountName,
      validatorId,
      preApproveAmuletTransfers: preApprove,
      ...(coupon ? { coupon } : {}),
    }),
  });
  if (!createRes.ok) {
    throw new Error(`POST /api/v1/accounts failed: HTTP ${createRes.status}: ${createRes.text.slice(0, 1200)}`);
  }

  // The endpoint returns the partyId as a JSON string; tolerate an object shape too.
  let partyId = "";
  try {
    const parsed = JSON.parse(createRes.text);
    partyId = typeof parsed === "string" ? parsed : String(parsed?.partyId ?? "");
  } catch {
    partyId = createRes.text.trim();
  }

  console.log("Account created.");
  console.log(`partyId: ${partyId || "(not returned — check `--list`)"}`);
  if (partyId) {
    console.log(`\nNext steps:`);
    console.log(`  1. Set in root .env: VITE_ENTERPRISE_WALLET_PARTY_ID=${partyId}`);
    console.log(`  2. Run: npm run rights:grant   (lets the Ledger API client read/act as the party)`);
  }
}

main().catch((e) => {
  console.error("\nError:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
