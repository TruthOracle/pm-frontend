import dotenv from "dotenv";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

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

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Keycloak token request failed: HTTP ${res.status} ${res.statusText}: ${text.slice(0, 800)}`);
  const data = JSON.parse(text);
  const token = data.access_token;
  if (typeof token !== "string" || !token) throw new Error("Keycloak response missing access_token");
  return token as string;
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log([
      "Upload a DAR to a Canton participant via the JSON Ledger API (POST /v2/packages).",
      "",
      "Usage:",
      "  npm run dars:upload                       # uploads daml/.daml/dist/truthoracle-1.0.0.dar",
      "  npm run dars:upload -- path/to/file.dar   # uploads a specific DAR",
      "",
      "Config (root `.env`):",
      "  ZKPC_LEDGER_API_URL          e.g. https://api.validator.main.zkpc.cantor8.tech/api/ledger",
      "  ZKPC_KEYCLOAK_URL            e.g. https://auth.main.zkpc.cantor8.tech",
      "  ZKPC_KEYCLOAK_REALM          default: master",
      "  ZKPC_KEYCLOAK_CLIENT_ID      (admin client id from Cantor8)",
      "  ZKPC_KEYCLOAK_CLIENT_SECRET  (admin client secret from Cantor8)",
    ].join("\n"));
    return;
  }

  const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.join(scriptsDir, "..");
  const rootEnv = path.join(repoRoot, ".env");
  if (fs.existsSync(rootEnv)) dotenv.config({ path: rootEnv });

  const positional = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const darPath = path.resolve(
    repoRoot,
    positional[0] || "daml/.daml/dist/truthoracle-1.0.0.dar",
  );
  if (!fs.existsSync(darPath)) {
    throw new Error(`DAR not found: ${darPath}\nBuild it first: cd daml && dpm build`);
  }

  const LEDGER_API = stripTrailingSlash(mustEnv(viteEnv("ZKPC_LEDGER_API_URL"), "ZKPC_LEDGER_API_URL"));
  const bearerToken = await getKeycloakAccessToken({
    keycloakUrl: mustEnv(viteEnv("ZKPC_KEYCLOAK_URL"), "ZKPC_KEYCLOAK_URL"),
    realm: viteEnv("ZKPC_KEYCLOAK_REALM") || "master",
    clientId: mustEnv(viteEnv("ZKPC_KEYCLOAK_CLIENT_ID"), "ZKPC_KEYCLOAK_CLIENT_ID"),
    clientSecret: mustEnv(viteEnv("ZKPC_KEYCLOAK_CLIENT_SECRET"), "ZKPC_KEYCLOAK_CLIENT_SECRET"),
  });

  const darBytes = fs.readFileSync(darPath);
  const sizeKb = (darBytes.byteLength / 1024).toFixed(1);
  console.log(`Uploading ${path.basename(darPath)} (${sizeKb} KB) to ${LEDGER_API}/v2/packages …`);

  const res = await fetch(`${LEDGER_API}/v2/packages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      "Content-Type": "application/octet-stream",
    },
    body: darBytes,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Upload failed: HTTP ${res.status} ${res.statusText}: ${text.slice(0, 2000)}`);
  }
  console.log("Upload succeeded.");
  if (text.trim()) {
    try {
      console.log(JSON.stringify(JSON.parse(text), null, 2));
    } catch {
      console.log(text);
    }
  }
}

main().catch((e) => {
  console.error("\nError:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
