import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type PluginOption } from "vite";
import { nodePolyfills } from 'vite-plugin-node-polyfills';

import ledgerHandler from "./api/proxy/ledger.mjs";
import walletHandler from "./api/proxy/wallet.mjs";
import c8backendHandler from "./api/proxy/c8backend.mjs";
import newsHandler from "./api/news.mjs";
import adminNonceHandler from "./api/admin/nonce.mjs";
import adminSessionHandler from "./api/admin/session.mjs";
import adminLogoutHandler from "./api/admin/logout.mjs";
import adminMeHandler from "./api/admin/me.mjs";
import walletDepositHandler from "./api/wallet/deposit.mjs";
import walletSettlePayoutHandler from "./api/wallet/settle-payout.mjs";
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

  // Same resolution order as api/proxy/keycloak.mjs, so the user-auth passthrough
  // points at the same host under `vite dev` as it does on Vercel. Reading only
  // VITE_KEYCLOAK_URL here meant a .env using the server-only KEYCLOAK_URL name fell
  // through to the hardcoded default without saying so.
  const keycloakTarget =
    [env.KEYCLOAK_PROXY_TARGET_URL, env.KEYCLOAK_URL, env.VITE_KEYCLOAK_URL]
      .map((value) => (value || "").trim().replace(/\/$/, ""))
      .find((value) => /^https?:\/\//i.test(value)) ||
    "https://auth.dev.digik.cantor8.tech";

  // @cantor8/wallet-connect-sdk 0.5.0 hardcodes wallet-backend.main.cantor8.tech for
  // mainnet origins — NXDOMAIN, and the real host (…main.digik…) sends no CORS headers
  // anyway, so the SDK's internal balance/status polling can only work through our
  // same-origin relay. Rewrite the constant inside the SDK until Cantor8 ships a fix.
  // (optimizeDeps.exclude below makes the transform apply under `vite dev` too.)
  const patchCantor8Backend: PluginOption = {
    name: "patch-cantor8-wallet-backend",
    transform(code, id) {
      if (!id.includes("@cantor8/wallet-connect-sdk")) return null;
      const broken = "https://wallet-backend.main.cantor8.tech";
      if (!code.includes(broken)) return null;
      return code.split(broken).join("/__proxy/c8b");
    },
  };

  // Dev server: token injection happens inside these handlers (same as prod), so the
  // browser calls /__proxy/ledger and /__proxy/wallet with no credentials at all.
  const devServerProxies: PluginOption = {
    name: "truthoracle-dev-proxies",
    configureServer(server) {
      server.middlewares.use(proxyMiddleware("/__proxy/ledger", ledgerHandler));
      server.middlewares.use(proxyMiddleware("/__proxy/wallet", walletHandler));
      server.middlewares.use(proxyMiddleware("/__proxy/c8b", c8backendHandler));
      server.middlewares.use(proxyMiddleware("/api/news", newsHandler));
      // Vercel routes these by filename; `vite dev` needs them wired by hand.
      server.middlewares.use(routeMiddleware("/api/admin/nonce", adminNonceHandler));
      server.middlewares.use(routeMiddleware("/api/admin/session", adminSessionHandler));
      server.middlewares.use(routeMiddleware("/api/admin/logout", adminLogoutHandler));
      server.middlewares.use(routeMiddleware("/api/admin/me", adminMeHandler));
      server.middlewares.use(routeMiddleware("/api/wallet/deposit", walletDepositHandler));
      server.middlewares.use(routeMiddleware("/api/wallet/settle-payout", walletSettlePayoutHandler));
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
      react(), nodePolyfills(), devServerProxies, patchCantor8Backend,
    ],
    optimizeDeps: {
      // Keep the SDK out of esbuild pre-bundling so patchCantor8Backend sees it in dev.
      exclude: ["@cantor8/wallet-connect-sdk"],
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./frontend"),
      },
    },
  };
});
