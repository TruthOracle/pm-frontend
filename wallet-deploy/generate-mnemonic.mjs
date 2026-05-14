#!/usr/bin/env node
// Generate a 24-word BIP39 mnemonic for WALLET_MNEMONIC in .env.
//
// Usage:  node generate-mnemonic.mjs
//
// Uses the `bip39` package via dynamic install (no global install needed).
// Print once — copy into .env, store offline. C8 cannot recover funds if lost.

import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "bip39-"));
try {
  execSync("npm install --silent --no-audit --no-fund --no-package-lock bip39@3", {
    cwd: dir,
    stdio: ["ignore", "ignore", "inherit"],
  });
  const { generateMnemonic } = await import(join(dir, "node_modules/bip39/src/index.js"));
  console.log(generateMnemonic(256)); // 256 bits => 24 words
} finally {
  rmSync(dir, { recursive: true, force: true });
}
