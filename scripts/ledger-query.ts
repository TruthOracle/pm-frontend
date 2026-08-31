import dotenv from "dotenv";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

type Json = Record<string, unknown>;

function viteEnv(name: string) {
  const v = process.env[name];
  return typeof v === "string" ? v.trim() : "";
}

function mustEnv(value: string, name: string) {
  if (!value || !value.trim()) throw new Error(`Missing required config: ${name}`);
  return value;
}

function stripTrailingSlash(url: string) {
  return url.replace(/\/$/, "");
}

type Network = "devnet" | "zkpc";

function parseNetwork(argv: string[], fallback: Network): Network {
  const i = argv.indexOf("--network");
  const network = i >= 0 ? (argv[i + 1] ?? "") : fallback;
  if (network !== "devnet" && network !== "zkpc") {
    throw new Error(`Unknown --network "${network}". Use: devnet | zkpc`);
  }
  return network;
}

/**
 * Exactly one credential set per network — never mixed. The digik (devnet) and
 * zkpc (MainNet) Keycloaks hold DIFFERENT clients; a token minted on the wrong
 * one is rejected by the participant with an opaque 401.
 */
function networkConfig(network: Network) {
  return network === "zkpc"
    ? {
        ledgerApi: stripTrailingSlash(mustEnv(viteEnv("ZKPC_LEDGER_API_URL"), "ZKPC_LEDGER_API_URL")),
        keycloakUrl: mustEnv(viteEnv("ZKPC_KEYCLOAK_URL"), "ZKPC_KEYCLOAK_URL"),
        realm: viteEnv("ZKPC_KEYCLOAK_REALM") || "master",
        clientId: mustEnv(viteEnv("ZKPC_KEYCLOAK_CLIENT_ID"), "ZKPC_KEYCLOAK_CLIENT_ID"),
        clientSecret: mustEnv(viteEnv("ZKPC_KEYCLOAK_CLIENT_SECRET"), "ZKPC_KEYCLOAK_CLIENT_SECRET"),
      }
    : {
        ledgerApi: stripTrailingSlash(mustEnv(viteEnv("VITE_CANTON_PARTICIPANT_URL"), "VITE_CANTON_PARTICIPANT_URL")),
        keycloakUrl: mustEnv(viteEnv("VITE_KEYCLOAK_URL"), "VITE_KEYCLOAK_URL"),
        realm: viteEnv("VITE_KEYCLOAK_REALM") || "master",
        clientId: mustEnv(viteEnv("KEYCLOAK_CLIENT_ID"), "KEYCLOAK_CLIENT_ID"),
        clientSecret: mustEnv(viteEnv("KEYCLOAK_CLIENT_SECRET"), "KEYCLOAK_CLIENT_SECRET"),
      };
}

/** The party the queries act as — one admin party, same on every network. */
function adminParty() {
  return mustEnv(viteEnv("VITE_ENTERPRISE_WALLET_PARTY_ID"), "VITE_ENTERPRISE_WALLET_PARTY_ID");
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

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log([
      "List active TruthOracle contracts visible to the Enterprise Wallet admin party.",
      "",
      "Usage:",
      "  npm run ledger:query                  # all TruthOracle templates (MarketCounter, PredictionMarket, …)",
      "  npm run ledger:query MarketCounter    # only this template",
      "  npm run ledger:query -- --network zkpc  # against the zkpc (MainNet) node",
      "  npm run ledger:query --raw            # full JSON dump (no summary)",
      "",
      "Config: root `.env` — one credential set per network, never mixed:",
      "  --network devnet (default): VITE_CANTON_PARTICIPANT_URL, VITE_KEYCLOAK_URL/REALM,",
      "                              KEYCLOAK_CLIENT_ID/SECRET, VITE_ENTERPRISE_WALLET_PARTY_ID",
      "  --network zkpc:             ZKPC_LEDGER_API_URL, ZKPC_KEYCLOAK_* (party: VITE_ENTERPRISE_WALLET_PARTY_ID)",
      "  Optional: VITE_TRUTHORACLE_PACKAGE_NAME (default 'truthoracle')",
    ].join("\n"));
    return;
  }

  const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.join(scriptsDir, "..");
  const rootEnv = path.join(repoRoot, ".env");
  if (fs.existsSync(rootEnv)) dotenv.config({ path: rootEnv });

  const network = parseNetwork(process.argv.slice(2), "devnet");
  const net = networkConfig(network);
  const LEDGER_API = net.ledgerApi;
  const ADMIN_PARTY = adminParty();
  // The active-contracts template filter expects a package-name reference ("#name:Module:Entity"),
  // not a package id, so we use the daml.yaml `name:` field.
  const PACKAGE_NAME = viteEnv("VITE_TRUTHORACLE_PACKAGE_NAME") || "truthoracle";

  // Templates we care about. `null` entityName means "any template in this module" (wildcard via
  // multiple TemplateFilter entries — the JSON Ledger API doesn't accept a single module-level filter).
  const KNOWN_TEMPLATES = [
    { module: "Truthoracle", entity: "MarketCounter" },
    { module: "Truthoracle", entity: "PredictionMarket" },
    { module: "Truthoracle", entity: "Position" },
    { module: "Incentives", entity: "UserRewardsSummary" },
  ];

  const rawArgv = process.argv.slice(2);
  const networkIdx = rawArgv.indexOf("--network");
  const argv = rawArgv.filter((a, i) => !a.startsWith("-") && (networkIdx < 0 || i !== networkIdx + 1));
  const onlyEntity = argv[0]; // optional positional, e.g. "MarketCounter"
  const raw = rawArgv.includes("--raw");
  const targets = onlyEntity
    ? KNOWN_TEMPLATES.filter((t) => t.entity.toLowerCase() === onlyEntity.toLowerCase())
    : KNOWN_TEMPLATES;
  if (onlyEntity && targets.length === 0) {
    throw new Error(`Unknown entity "${onlyEntity}". Known: ${KNOWN_TEMPLATES.map((t) => t.entity).join(", ")}`);
  }

  const bearerToken = await getKeycloakAccessToken(net);
  const headers = { Authorization: `Bearer ${bearerToken}`, "Content-Type": "application/json" };

  const ledgerEnd = await fetchJson(`${LEDGER_API}/v2/state/ledger-end`, { method: "GET", headers });
  const activeAtOffset = String(typeof (ledgerEnd as any).offset === "number" ? (ledgerEnd as any).offset : 0);

  const active = await fetchJson(`${LEDGER_API}/v2/state/active-contracts`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      verbose: false,
      activeAtOffset,
      eventFormat: {
        filtersByParty: {
          [ADMIN_PARTY]: {
            cumulative: targets.map((t) => ({
              identifierFilter: {
                TemplateFilter: {
                  value: {
                    templateId: `#${PACKAGE_NAME}:${t.module}:${t.entity}`,
                    includeCreatedEventBlob: false,
                  },
                },
              },
            })),
          },
        },
        verbose: false,
      },
    }),
  });

  if (raw) {
    console.log(JSON.stringify(active, null, 2));
    return;
  }

  const items: any[] = Array.isArray(active) ? (active as any[]) : ((active as any).activeContracts ?? (active as any).contracts ?? []);
  console.log(`Network: ${network}`);
  console.log(`Admin party: ${ADMIN_PARTY}`);
  console.log(`Ledger offset: ${activeAtOffset}`);
  console.log(`Templates: ${targets.map((t) => `${t.module}:${t.entity}`).join(", ")}`);
  console.log(`Active contracts found: ${items.length}\n`);

  for (const item of items) {
    const ev = item?.contractEntry?.JsActiveContract?.createdEvent ?? {};
    const tid = String(ev.templateId ?? "");
    const entity = tid.split(":").pop() ?? tid;
    console.log(`• ${entity}`);
    console.log(`    contractId: ${ev.contractId ?? "?"}`);
    console.log(`    createdAt:  ${ev.createdAt ?? "?"}`);
    console.log(`    payload:    ${JSON.stringify(ev.createArgument ?? {})}`);
  }
}

main().catch((e) => {
  console.error("\nError:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
