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
      "Usage:",
      "  npm run ledger:query",
      "",
      "Config: same root `.env` and VITE_* names as the frontend / create-contract.",
      "  VITE_CANTON_PARTICIPANT_URL",
      "  VITE_KEYCLOAK_URL, VITE_KEYCLOAK_REALM, VITE_KEYCLOAK_CLIENT_ID, VITE_KEYCLOAK_CLIENT_SECRET",
    ].join("\n"));
    return;
  }

  const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.join(scriptsDir, "..");
  const rootEnv = path.join(repoRoot, ".env");
  if (fs.existsSync(rootEnv)) dotenv.config({ path: rootEnv });

  const LEDGER_API = stripTrailingSlash(viteEnv("VITE_CANTON_PARTICIPANT_URL"));
  if (!LEDGER_API) throw new Error("Missing VITE_CANTON_PARTICIPANT_URL in .env");

  const bearerToken = await getKeycloakAccessToken({
    keycloakUrl: mustEnv(viteEnv("VITE_KEYCLOAK_URL"), "VITE_KEYCLOAK_URL"),
    realm: viteEnv("VITE_KEYCLOAK_REALM") || "master",
    clientId: mustEnv(viteEnv("VITE_KEYCLOAK_CLIENT_ID"), "VITE_KEYCLOAK_CLIENT_ID"),
    clientSecret: mustEnv(viteEnv("VITE_KEYCLOAK_CLIENT_SECRET"), "VITE_KEYCLOAK_CLIENT_SECRET"),
  });

  console.log("bearerToken", bearerToken);

  const ledgerEnd = await fetchJson(`${LEDGER_API}/v2/state/ledger-end`, {
    method: "GET",
    headers: { Authorization: `Bearer ${bearerToken}`, "Content-Type": "application/json" },
  });
  const offset = typeof (ledgerEnd as any).offset === "number" ? (ledgerEnd as any).offset : 0;

  const active = await fetchJson(`${LEDGER_API}/v2/state/active-contracts?limit=2`, {
    method: "POST",
    headers: { Authorization: `Bearer ${bearerToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      verbose: false,
      activeAtOffset: offset,
      eventFormat: {
        filtersByParty: {},
        filtersForAnyParty: {
          cumulative: [
            {
              identifierFilter: {
                WildcardFilter: { value: { includeCreatedEventBlob: false } },
              },
            },
          ],
        },
        verbose: true,
      },
    }),
  });

  console.log(JSON.stringify(active, null, 2));
}

main().catch((e) => {
  console.error("\nError:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
