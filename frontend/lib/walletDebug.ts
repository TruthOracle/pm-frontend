/**
 * Wallet diagnostic logging, off in production builds.
 *
 * The wallet contexts narrate everything the popup sends (raw postMessages, event
 * payloads, full signAndExecute inputs). Invaluable in dev — it is how operator
 * public keys are read and how popup protocol changes get diagnosed — but noise to
 * shippable users, so production builds drop it unless VITE_DEBUG_WALLET=true is
 * set on the deployment to debug a live issue. Warnings and errors are NOT routed
 * through here: real failures stay visible everywhere.
 */
const WALLET_DEBUG: boolean =
  import.meta.env.DEV || import.meta.env.VITE_DEBUG_WALLET === "true";

export function walletDebugLog(...args: unknown[]): void {
  if (WALLET_DEBUG) console.log(...args);
}
