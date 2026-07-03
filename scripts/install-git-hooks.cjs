const { existsSync } = require("node:fs");
const { execFileSync } = require("node:child_process");

const isCi = process.env.CI === "true" || process.env.VERCEL === "1";
const force = process.argv.includes("--force");

if (!force && isCi) {
  process.exit(0);
}

if (!existsSync(".git") || !existsSync(".githooks")) {
  process.exit(0);
}

try {
  execFileSync("git", ["config", "core.hooksPath", ".githooks"], {
    stdio: force ? "inherit" : "ignore",
  });
} catch (error) {
  if (force) {
    throw error;
  }
}
