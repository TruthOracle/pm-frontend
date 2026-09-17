/**
 * Module-level handle to the live Cantor8 `C8WalletProvider`, plus the last account
 * payload the wallet delivered.
 *
 * The React context (Cantor8WalletContext) owns the instance and registers it here
 * so non-React code — the active-contract readers in utils/activeContracts.ts — can
 * use the SDK's Scanner reads (`getActiveContracts` / `getLedgerUpdates`, SDK ≥0.6.0)
 * without threading the provider through every call site.
 *
 * The accounts snapshot exists so balance readers can fall back to the wallet's own
 * reported holdings WITHOUT calling `getAccounts()` themselves: that SDK call also
 * refreshes from `/api/balance` and destroys the session on a 401, which a polling
 * balance widget must never be able to trigger.
 *
 * Null / empty whenever the Cantor8 provider isn't mounted (e.g. VITE_WALLET_TYPE=canton).
 */
import type { AccountInfoPayload, C8WalletProvider } from "@cantor8/wallet-connect-sdk";

let current: C8WalletProvider | null = null;
let accounts: AccountInfoPayload[] = [];

export function registerC8Provider(provider: C8WalletProvider | null): void {
  current = provider;
  if (!provider) accounts = [];
}

export function getC8Provider(): C8WalletProvider | null {
  return current;
}

/** Record the accounts the wallet just reported (connect, restore, accountChanged). */
export function setC8Accounts(next?: AccountInfoPayload[] | null): void {
  accounts = Array.isArray(next) ? next : [];
}

/** Last accounts payload from the wallet; holdings are as of that delivery. */
export function getC8Accounts(): AccountInfoPayload[] {
  return accounts;
}
