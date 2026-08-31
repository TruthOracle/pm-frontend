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
      "  npm run dars:upload                             # zkpc (MainNet), daml/.daml/dist/truthoracle-v13-1.0.0.dar",
      "  npm run dars:upload -- --network devnet         # DevNet participant (VITE_CANTON_PARTICIPANT_URL)",
      "  npm run dars:upload -- path/to/file.dar         # uploads a specific DAR",
      "",
      "Config (root `.env`):",
      "  --network zkpc (default):",
      "    ZKPC_LEDGER_API_URL / ZKPC_KEYCLOAK_URL / ZKPC_KEYCLOAK_REALM",
      "    ZKPC_KEYCLOAK_CLIENT_ID / ZKPC_KEYCLOAK_CLIENT_SECRET",
      "  --network devnet:",
      "    VITE_CANTON_PARTICIPANT_URL / VITE_KEYCLOAK_URL / VITE_KEYCLOAK_REALM",
      "    KEYCLOAK_CLIENT_ID / KEYCLOAK_CLIENT_SECRET (server-only, no VITE_ prefix)",
      "  The zkpc and devnet Keycloaks hold different clients: exactly one set is",
      "  read per network, with no fallback to the other network's values.",
    ].join("\n"));
    return;
  }

  const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.join(scriptsDir, "..");
  const rootEnv = path.join(repoRoot, ".env");
  if (fs.existsSync(rootEnv)) dotenv.config({ path: rootEnv });

  const args = process.argv.slice(2);
  const network = parseNetwork(args, "zkpc");
  const networkIdx = args.indexOf("--network");
  const positional = args.filter((a, i) => !a.startsWith("-") && (networkIdx < 0 || i !== networkIdx + 1));
  const darPath = path.resolve(
    repoRoot,
    positional[0] || "daml/.daml/dist/truthoracle-v13-1.0.0.dar",
  );
  if (!fs.existsSync(darPath)) {
    throw new Error(`DAR not found: ${darPath}\nBuild it first: cd daml && dpm build`);
  }

  const net = networkConfig(network);
  const LEDGER_API = net.ledgerApi;
  console.log(`Target network: ${network} (${LEDGER_API})`);
  const bearerToken = await getKeycloakAccessToken(net);

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
