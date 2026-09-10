/**
 * Module hooks that let `node --test` import the frontend's pure TypeScript helpers
 * (lib/party.ts, lib/backend.ts, lib/backendErrors.ts, lib/kyc.ts, lib/inAppWallet.ts)
 * without a bundler. Node ≥ 22.18 strips types natively; what it cannot do on its own
 * is resolve Vite's `@/` alias and extensionless relative imports, or evaluate
 * `import.meta.env`. Registered from a test file with
 * `register("./_support/frontend-loader.mjs", import.meta.url)`.
 *
 *  - `@/x` → `<repo>/frontend/x`, then `.ts` / `.tsx` / `/index.ts` are tried.
 *  - Extensionless relative imports from inside frontend/ get the same treatment.
 *  - In every frontend `.ts` module, `import.meta.env` is rewritten to read
 *    `globalThis.__VITE_ENV__` so a test can set the few VITE_* values it needs
 *    (config.ts and debugLog.ts read it at module level).
 *
 * Only `.ts` modules are importable this way (JSX is not stripped), which is exactly
 * the set of files that should hold logic worth unit-testing.
 */
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const FRONTEND = path.join(ROOT, "frontend");
const FRONTEND_URL = pathToFileURL(FRONTEND + path.sep).href;
const EXTENSIONS = [".ts", ".tsx", ".mts", ".js", ".mjs"];

function isFile(p) {
  return existsSync(p) && statSync(p).isFile();
}

function withExtension(filePath) {
  if (isFile(filePath)) return filePath;
  for (const ext of EXTENSIONS) if (isFile(filePath + ext)) return filePath + ext;
  for (const ext of EXTENSIONS) {
    const index = path.join(filePath, `index${ext}`);
    if (isFile(index)) return index;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  let candidate = null;
  if (specifier.startsWith("@/")) {
    candidate = path.join(FRONTEND, specifier.slice(2));
  } else if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    typeof context.parentURL === "string" &&
    context.parentURL.startsWith(FRONTEND_URL)
  ) {
    candidate = fileURLToPath(new URL(specifier, context.parentURL));
  }
  if (candidate) {
    const file = withExtension(candidate);
    if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  // Declare the format up front: the frontend has no package.json "type", so Node
  // would otherwise sniff every file and warn about it.
  const frontendTs = url.startsWith(FRONTEND_URL) && url.endsWith(".ts");
  const result = await nextLoad(url, frontendTs ? { ...context, format: "module-typescript" } : context);
  if (!frontendTs) return result;
  const source = String(result.source).replaceAll("import.meta.env", "(globalThis.__VITE_ENV__ ?? {})");
  return { ...result, source };
}
