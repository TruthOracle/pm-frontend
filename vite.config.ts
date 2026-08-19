import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type PluginOption } from "vite";
import { nodePolyfills } from 'vite-plugin-node-polyfills';

import ledgerHandler from "./api/proxy/ledger.mjs";
import walletHandler from "./api/proxy/wallet.mjs";
import newsHandler from "./api/news.mjs";
import { proxyMiddleware } from "./api/proxy/_devProxy.mjs";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  // The api/proxy/*.mjs handlers read config from process.env (Vercel populates it).
  // Under plain `vite dev` we run them as middleware, so mirror .env into process.env
  // for the SERVER-ONLY names too (KEYCLOAK_CLIENT_SECRET, proxy targets, …). These
  // stay in the Node process — Vite never exposes non-VITE_ vars to the browser.
  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }

  const keycloakTarget =
    env.VITE_KEYCLOAK_URL?.replace(/\/$/, "") ||
    "https://auth.dev.digik.cantor8.tech";

  // Dev server: token injection happens inside these handlers (same as prod), so the
  // browser calls /__proxy/ledger and /__proxy/wallet with no credentials at all.
  const devServerProxies: PluginOption = {
    name: "truthoracle-dev-proxies",
    configureServer(server) {
      server.middlewares.use(proxyMiddleware("/__proxy/ledger", ledgerHandler));
      server.middlewares.use(proxyMiddleware("/__proxy/wallet", walletHandler));
      server.middlewares.use(proxyMiddleware("/api/news", newsHandler));
    },
  };

  return {
    build: {
      outDir: "dist",
    },
    server: {
      open: true,
      // Keycloak stays a plain pass-through proxy (no secret involved — the browser
      // no longer mints tokens). Ledger + wallet are handled by devServerProxies above
      // so they get server-side token injection.
      proxy: {
        "/__proxy/keycloak": {
          target: keycloakTarget,
          changeOrigin: true,
          secure: true,
          rewrite: (p) => p.replace(/^\/__proxy\/keycloak/, ""),
        },
      },
    },
    plugins: [
      react(), nodePolyfills(), devServerProxies,
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./frontend"),
      },
    },
  };
});
