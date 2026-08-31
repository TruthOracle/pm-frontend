/**
 * TruthOracle — dump active contracts from the Canton JSON Ledger API.
 *
 * Queries POST /v2/state/active-contracts once *per template*, so a template that
 * isn't in the uploaded package (or that nobody has created yet) degrades to a
 * warning instead of failing the whole run — the participant rejects the entire
 * request with NO_TEMPLATES_FOR_PACKAGE_NAME_AND_QUALIFIED_NAME if any single
 * template in a combined filter is unknown.
 *
 * Usage:
 *   npm run contracts:active                       # every template, grouped summary
 *   npm run contracts:active MarketCounter         # one template
 *   npm run contracts:active -- --network zkpc     # against the zkpc (MainNet) node
 *   npm run contracts:active -- --party <partyId>  # query as some other party
 *   npm run contracts:active -- --json             # machine-readable
 *   npm run contracts:active -- --raw              # verbatim API responses
 *
 * Config: root `.env`. One credential set per network, never mixed:
 *   --network devnet (default): VITE_CANTON_PARTICIPANT_URL, VITE_KEYCLOAK_URL/REALM,
 *                               KEYCLOAK_CLIENT_ID/SECRET, VITE_ENTERPRISE_WALLET_PARTY_ID
 *   --network zkpc:             ZKPC_LEDGER_API_URL, ZKPC_KEYCLOAK_* (party: VITE_ENTERPRISE_WALLET_PARTY_ID)
 *   Optional: VITE_TRUTHORACLE_PACKAGE_NAME (default 'truthoracle')
 */

import dotenv from "dotenv";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

type Json = Record<string, unknown>;

/** Every template in the TruthOracle package (daml/daml/*.daml). */
const TEMPLATES = [
  { module: "Truthoracle", entity: "MarketCounter" },
  { module: "Truthoracle", entity: "PredictionMarket" },
  { module: "Truthoracle", entity: "Position" },
  { module: "Truthoracle", entity: "LiquidityPosition" },
  { module: "Truthoracle", entity: "PendingPayout" },
  { module: "Truthoracle", entity: "OutcomeAttestation" },
  { module: "Truthoracle", entity: "ModelForecast" },
  { module: "Marketplace", entity: "PredictionModel" },
  { module: "Incentives", entity: "UserRewardsSummary" },
  { module: "Incentives", entity: "ClaimedReward" },
];

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
  return mustEnv(viteEnv("VITE_ENTERPRISE_WALLET_PARTY_ID"), "VITE_ENTERPRISE_WALLET_PARTY_ID (or pass --party)");
}

/**
 * The devnet participant intermittently exceeds undici's 10s connect timeout,
 * which surfaces as a bare "fetch failed". Retry rather than make the caller re-run.
 */
async function fetchWithRetry(url: string, init: RequestInit, attempts = 3): Promise<Response> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fetch(url, init);
    } catch (e) {
      lastErr = e;
      if (i < attempts) {
        console.warn(`  … connection attempt ${i}/${attempts} failed, retrying`);
        await new Promise((r) => setTimeout(r, 1000 * i));
      }
    }
  }
  throw lastErr;
}

async function fetchJson(url: string, init: RequestInit): Promise<Json> {
  const res = await fetchWithRetry(url, init);
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

type Row = {
  entity: string;
  module: string;
  contractId: string;
  createdAt: string;
  payload: Json;
};

function rowsOf(active: unknown, module: string, entity: string): Row[] {
  const items: any[] = Array.isArray(active)
    ? (active as any[])
    : ((active as any)?.activeContracts ?? (active as any)?.contracts ?? []);
  const out: Row[] = [];
  for (const item of items) {
    const ev = item?.contractEntry?.JsActiveContract?.createdEvent;
    if (!ev) continue;
    out.push({
      entity,
      module,
      contractId: String(ev.contractId ?? "?"),
      createdAt: String(ev.createdAt ?? "?"),
      payload: (ev.createArgument ?? {}) as Json,
    });
  }
  return out;
}

/** Per-template summary line — the fields that actually identify the contract. */
function describe(row: Row): string {
  const p = row.payload as Record<string, any>;
  switch (row.entity) {
    case "MarketCounter":
      return `value=${p.value} (next marketId would be ${Number(p.value) + 1})`;
    case "PredictionMarket":
      return `marketId=${p.marketId} status=${
        typeof p.status === "object" ? (p.status?.tag ?? JSON.stringify(p.status)) : p.status
      } "${String(p.question ?? "").slice(0, 48)}"`;
    case "Position":
      return `marketId=${p.marketId} holder=${String(p.holder ?? "").slice(0, 24)}… yes=${p.yesShares} no=${p.noShares}`;
    case "LiquidityPosition":
      return `marketId=${p.marketId} lpTokens=${p.lpTokens} deposited=${p.depositedCC}`;
    case "PendingPayout":
      return `marketId=${p.marketId} amount=${p.amountCC ?? p.amount}`;
    case "OutcomeAttestation":
      return `marketId=${p.marketId} attester=${String(p.attester ?? "").slice(0, 24)}…`;
    case "ModelForecast":
      return `marketId=${p.marketId}`;
    default:
      return JSON.stringify(p).slice(0, 120);
  }
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log([
      "Dump active TruthOracle contracts from the Canton JSON Ledger API.",
      "",
      "Usage:",
      "  npm run contracts:active                       # every template, grouped summary",
      "  npm run contracts:active MarketCounter         # a single template",
      "  npm run contracts:active -- --network zkpc     # against the zkpc (MainNet) node",
      "  npm run contracts:active -- --party <partyId>  # query as another party",
      "  npm run contracts:active -- --json             # machine-readable JSON",
      "  npm run contracts:active -- --raw              # verbatim API responses",
      "",
      `Known templates: ${TEMPLATES.map((t) => t.entity).join(", ")}`,
      "",
      "Config (root `.env`) — one credential set per network, never mixed:",
      "  --network devnet (default): VITE_CANTON_PARTICIPANT_URL, VITE_KEYCLOAK_URL/REALM,",
      "                              KEYCLOAK_CLIENT_ID/SECRET, VITE_ENTERPRISE_WALLET_PARTY_ID",
      "  --network zkpc:             ZKPC_LEDGER_API_URL, ZKPC_KEYCLOAK_* (party: VITE_ENTERPRISE_WALLET_PARTY_ID)",
      "  VITE_TRUTHORACLE_PACKAGE_NAME (default 'truthoracle')",
    ].join("\n"));
    return;
  }

  const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.join(scriptsDir, "..");
  const rootEnv = path.join(repoRoot, ".env");
  if (fs.existsSync(rootEnv)) dotenv.config({ path: rootEnv });

  const argv = process.argv.slice(2);
  const raw = argv.includes("--raw");
  const asJson = argv.includes("--json");
  const network = parseNetwork(argv, "devnet");
  const partyIdx = argv.indexOf("--party");
  const networkIdx = argv.indexOf("--network");
  const flagValueIdxs = new Set([partyIdx, networkIdx].filter((i) => i >= 0).map((i) => i + 1));
  const partyOverride = partyIdx >= 0 ? argv[partyIdx + 1] : "";
  const positional = argv.filter((a, i) => !a.startsWith("--") && !flagValueIdxs.has(i));

  const net = networkConfig(network);
  const LEDGER_API = net.ledgerApi;
  const PARTY = partyOverride || adminParty();
  // The active-contracts template filter takes a package-*name* reference
  // ("#truthoracle-v13:Module:Entity"), never a package id.
  const PACKAGE_NAME = viteEnv("VITE_TRUTHORACLE_PACKAGE_NAME") || "truthoracle";

  const onlyEntity = positional[0];
  const targets = onlyEntity
    ? TEMPLATES.filter((t) => t.entity.toLowerCase() === onlyEntity.toLowerCase())
    : TEMPLATES;
  if (onlyEntity && targets.length === 0) {
    throw new Error(`Unknown template "${onlyEntity}". Known: ${TEMPLATES.map((t) => t.entity).join(", ")}`);
  }

  const bearerToken = await getKeycloakAccessToken(net);
  const headers = { Authorization: `Bearer ${bearerToken}`, "Content-Type": "application/json" };

  const ledgerEnd = await fetchJson(`${LEDGER_API}/v2/state/ledger-end`, { method: "GET", headers });
  const activeAtOffset = String(typeof (ledgerEnd as any).offset === "number" ? (ledgerEnd as any).offset : 0);

  if (!asJson && !raw) {
    console.log(`Network:      ${network}`);
    console.log(`Participant:  ${LEDGER_API}`);
    console.log(`Package name: ${PACKAGE_NAME}`);
    console.log(`Party:        ${PARTY}`);
    console.log(`Offset:       ${activeAtOffset}\n`);
  }

  const all: Row[] = [];
  const missing: string[] = [];
  const rawDump: Record<string, unknown> = {};

  for (const t of targets) {
    const body = JSON.stringify({
      verbose: false,
      activeAtOffset,
      eventFormat: {
        filtersByParty: {
          [PARTY]: {
            cumulative: [
              {
                identifierFilter: {
                  TemplateFilter: {
                    value: {
                      templateId: `#${PACKAGE_NAME}:${t.module}:${t.entity}`,
                      includeCreatedEventBlob: false,
                    },
                  },
                },
              },
            ],
          },
        },
        verbose: false,
      },
    });

    try {
      const active = await fetchJson(`${LEDGER_API}/v2/state/active-contracts`, { method: "POST", headers, body });
      rawDump[`${t.module}:${t.entity}`] = active;
      all.push(...rowsOf(active, t.module, t.entity));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Template not in the uploaded package — expected for templates added/removed
      // between package versions. Everything else is a real failure.
      if (msg.includes("NO_TEMPLATES_FOR_PACKAGE_NAME_AND_QUALIFIED_NAME")) {
        missing.push(`${t.module}:${t.entity}`);
        continue;
      }
      throw e;
    }
  }

  if (raw) {
    console.log(JSON.stringify(rawDump, null, 2));
    return;
  }
  if (asJson) {
    console.log(JSON.stringify({ participant: LEDGER_API, packageName: PACKAGE_NAME, party: PARTY, offset: activeAtOffset, missing, contracts: all }, null, 2));
    return;
  }

  const byEntity = new Map<string, Row[]>();
  for (const r of all) {
    const list = byEntity.get(r.entity) ?? [];
    list.push(r);
    byEntity.set(r.entity, list);
  }

  for (const t of targets) {
    const rows = byEntity.get(t.entity) ?? [];
    if (missing.includes(`${t.module}:${t.entity}`)) {
      console.log(`${t.module}:${t.entity} — not in package ${PACKAGE_NAME} (skipped)`);
      continue;
    }
    if (rows.length === 0) {
      if (onlyEntity) console.log(`${t.module}:${t.entity} — 0 active`);
      continue;
    }
    console.log(`${t.module}:${t.entity} — ${rows.length} active`);
    for (const r of rows) {
      console.log(`  • ${describe(r)}`);
      console.log(`      contractId: ${r.contractId}`);
      console.log(`      createdAt:  ${r.createdAt}`);
    }
    console.log("");
  }

  console.log(`Total active contracts: ${all.length}`);
  if (missing.length) console.log(`Templates absent from package: ${missing.join(", ")}`);
}

main().catch((e) => {
  console.error("\nError:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
