/**
 * The Enterprise Wallet's treasury party, as the browser knows it (VITE_ENTERPRISE_WALLET_PARTY_ID):
 * the party the market reads are keyed by and the treasury deposits are sent to.
 *
 * Nothing in the browser submits through the Enterprise Wallet any more. The wallet relay
 * (api/proxy/wallet.mjs) and the console's `external/submit` of ResolveT0 / Resolve / VoidMarket are
 * gone (review F0): market resolution is the accounts backend's four-eyes `market.resolve`
 * (lib/marketResolution.ts), which signs as the treasury with the backend's own clock, and deposit
 * credits and payout settlement are the backend's too (lib/inAppWallet.ts).
 */
import { ENTERPRISE_WALLET_PARTY_ID } from "@/config";

export function enterpriseWalletPartyId(): string {
  return ENTERPRISE_WALLET_PARTY_ID;
}
