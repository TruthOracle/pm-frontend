/**
 * Diagnostic logging, off in production builds.
 *
 * Everything the app narrates for developers — wallet popup postMessages and event
 * payloads, full signAndExecute inputs, reward fetches, committed tx hashes — goes
 * through here. Printed in `vite dev`; silent in production unless the deployment
 * is built with VITE_DEBUG_WALLET=true to debug a live issue. Warnings and errors
 * are NOT routed through here: real failures stay visible everywhere.
 */
const DEBUG: boolean =
  import.meta.env.DEV || import.meta.env.VITE_DEBUG_WALLET === "true";

export function debugLog(...args: unknown[]): void {
  if (DEBUG) console.log(...args);
}

/**
 * Warn/error with detail objects withheld in production. The static message still
 * prints everywhere — a real failure must stay visible — but the caught error /
 * payload objects (which can embed party ids, URLs, or API payloads) print only in
 * dev or under VITE_DEBUG_WALLET=true.
 */
export function debugWarn(message: string, ...detail: unknown[]): void {
  if (DEBUG) console.warn(message, ...detail);
  else console.warn(message);
}

export function debugError(message: string, ...detail: unknown[]): void {
  if (DEBUG) console.error(message, ...detail);
  else console.error(message);
}
