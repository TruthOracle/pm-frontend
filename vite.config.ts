import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type PluginOption } from "vite";
import { nodePolyfills } from 'vite-plugin-node-polyfills';

import ledgerHandler from "./api/proxy/ledger.mjs";
import c8backendHandler from "./api/proxy/c8backend.mjs";
import backendHandler from "./api/proxy/backend.mjs";
import newsHandler from "./api/news.mjs";
import adminNonceHandler from "./api/admin/nonce.mjs";
import adminSessionHandler from "./api/admin/session.mjs";
import adminLogoutHandler from "./api/admin/logout.mjs";
import adminMeHandler from "./api/admin/me.mjs";
import { proxyMiddleware, routeMiddleware } from "./api/proxy/_devProxy.mjs";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  // The api/proxy/*.mjs handlers read config from process.env (Vercel populates it).
  // Under plain `vite dev` we run them as middleware, so mirror .env into process.env
  // for the SERVER-ONLY names too (KEYCLOAK_CLIENT_SECRET, proxy targets, …). These
  // stay in the Node process — Vite never exposes non-VITE_ vars to the browser.
  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }

  // SDK 0.5.1 uses the correct MainNet hostname, but its internal session-restore
  // and balance polling still call that host directly. The MainNet backend does
  // not allow browser CORS for the app origin, so route only that backend through
  // the existing same-origin relay. DevNet remains direct because its CORS works.
  const routeCantor8MainnetBackendViaProxy: PluginOption = {
    name: "route-cantor8-mainnet-backend-via-proxy",
    transform(code, id) {
      if (!id.includes("@cantor8/wallet-connect-sdk")) return null;
      const mainnetBackend = "https://wallet-backend.main.digik.cantor8.tech";
      if (!code.includes(mainnetBackend)) return null;
      return code.split(mainnetBackend).join("/__proxy/c8b");
    },
  };

  // Dev server: token injection happens inside these handlers (same as prod), so the
  // browser calls /__proxy/ledger with no credentials at all. There is no wallet relay: nothing
  // in the browser signs as the treasury (market resolution is the backend's, review F0).
  const devServerProxies: PluginOption = {
    name: "truthoracle-dev-proxies",
    configureServer(server) {
      server.middlewares.use(proxyMiddleware("/__proxy/ledger", ledgerHandler));
      server.middlewares.use(proxyMiddleware("/__proxy/c8b", c8backendHandler));
      // Accounts backend relay (ARCHITECTURE.md §4.1): no token injection — the
      // browser's own to_session cookie is forwarded, and nothing else. The same
      // handler serves prod, so its path/header/cookie rules are exercised in dev too.
      server.middlewares.use(proxyMiddleware("/__backend", backendHandler));
      server.middlewares.use(proxyMiddleware("/api/news", newsHandler));
      // Vercel routes these by filename; `vite dev` needs them wired by hand.
      server.middlewares.use(routeMiddleware("/api/admin/nonce", adminNonceHandler));
      server.middlewares.use(routeMiddleware("/api/admin/session", adminSessionHandler));
      server.middlewares.use(routeMiddleware("/api/admin/logout", adminLogoutHandler));
      server.middlewares.use(routeMiddleware("/api/admin/me", adminMeHandler));
    },
  };

  return {
    build: {
      outDir: "dist",
    },
    server: {
      open: true,
      // No Keycloak passthrough: the browser holds no Keycloak credentials, and a relay that
      // forwarded the app's cookies to a third-party host was removed (review F4). The ledger is
      // handled by devServerProxies above so it gets server-side token injection.
    },
    plugins: [
      react(), nodePolyfills(), devServerProxies, routeCantor8MainnetBackendViaProxy,
    ],
    optimizeDeps: {
      // Keep the SDK transform active under `vite dev` as well as production builds.
      exclude: ["@cantor8/wallet-connect-sdk"],
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./frontend"),
      },
    },
  };
});
