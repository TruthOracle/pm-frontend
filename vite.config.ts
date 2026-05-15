import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { nodePolyfills } from 'vite-plugin-node-polyfills';


export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const keycloakTarget =
    env.VITE_KEYCLOAK_URL?.replace(/\/$/, "") ||
    "https://auth.dev.digik.cantor8.tech";
  const ledgerTarget =
    env.VITE_CANTON_PARTICIPANT_URL?.replace(/\/$/, "") ||
    "https://api.validator.dev.digik.cantor8.tech/api/ledger";
  const enterpriseWalletTarget =
    env.VITE_ENTERPRISE_WALLET_URL?.replace(/\/$/, "") || "http://localhost:8080";

  return {
    build: {
      outDir: "dist",
    },
    server: {
      open: true,
      // Proxy in dev to avoid CORS when calling external APIs from the browser.
      // Targets come from VITE_KEYCLOAK_URL / VITE_CANTON_PARTICIPANT_URL so the
      // proxy follows whatever hosts the .env points at (not hardcoded).
      proxy: {
        "/__proxy/keycloak": {
          target: keycloakTarget,
          changeOrigin: true,
          secure: true,
          rewrite: (p) => p.replace(/^\/__proxy\/keycloak/, ""),
        },
        "/__proxy/ledger": {
          target: ledgerTarget,
          changeOrigin: true,
          secure: true,
          rewrite: (p) => p.replace(/^\/__proxy\/ledger/, ""),
        },
        "/__proxy/wallet": {
          target: enterpriseWalletTarget,
          changeOrigin: true,
          secure: false,
          rewrite: (p) => p.replace(/^\/__proxy\/wallet/, ""),
        },
      },
    },
    plugins: [
      react(), nodePolyfills()
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./frontend"),
      },
    },
  };
});
