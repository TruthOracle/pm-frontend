/**
 * Canton-only client facade.
 * All ledger reads (balance, markets, rewards) are done via Canton participant API
 * or blockend/cantonService. This module exists for compatibility; use Canton
 * Dapp SDK and cantonService for Canton integration.
 */
export function cantonClient(): void {
  // No-op: Canton integration uses @canton-network/wallet-sdk and frontend lib/cantonDapp + blockend/cantonService.
  throw new Error("Use Canton Dapp SDK and cantonService for Canton integration.");
}
