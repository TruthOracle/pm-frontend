import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { nodePolyfills } from 'vite-plugin-node-polyfills';


export default defineConfig({
  build: {
    outDir: "dist",
  },
  server: {
    open: true,
    // Proxy so the browser calls same-origin /api/*; avoids CORS on Keycloak token + Ledger API.
    proxy: {
      "/api/keycloak": {
        target: "https://auth.dev.digik.cantor8.tech",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/keycloak/, ""),
      },
      "/api/ledger": {
        target: "https://api.validator.dev.digik.cantor8.tech",
        changeOrigin: true,
        secure: true,
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
});
