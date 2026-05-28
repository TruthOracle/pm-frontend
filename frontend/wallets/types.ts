/**
 * Shared wallet types for Canton and Cantor8.
 * Both implementations expose the same interface for easy switching.
 */

export interface CantonAccount {
  address: string;
  partyId: string;
  publicKey?: string;
  namespace?: string;
}

export interface CantonNetworkInfo {
  networkId: string;
  ledgerApi?: { baseUrl?: string };
}

export interface CantonWalletItem {
  partyId: string;
  primary: boolean;
  publicKey?: string;
  namespace?: string;
}

export interface ConnectOptions {
  defaultGateways?: Array<{ name: string; rpcUrl: string }>;
  additionalGateways?: Array<{ name: string; rpcUrl: string }>;
}

/** Re-export for wallet implementations that submit transactions */
export type { PrepareExecuteParams } from "@/lib/cantonDapp";

export interface TransferCCArgs {
  /** Recipient party id. */
  to: string;
  /** Amount in whole CC units (e.g. 1.5). */
  amount: number;
  /** Optional memo shown in the wallet popup / on-ledger metadata. */
  memo?: string;
  /** Optional structured metadata. */
  metadata?: Record<string, string>;
}

export interface CantonWalletContextValue {
  account: CantonAccount | null;
  connected: boolean;
  connect: (options?: ConnectOptions) => Promise<void>;
  disconnect: () => Promise<void>;
  signAndSubmitTransaction: (params: import("@/lib/cantonDapp").PrepareExecuteParams) => Promise<{ hash: string }>;
  /**
   * High-level Canton Coin transfer. Wraps Cantor8 SDK's `wallet.send()` — the
   * wallet handles AmuletRules / OpenMiningRound / fees / popup signing internally.
   * Resolves with the txId after the user confirms in the wallet popup.
   */
  transferCC: (args: TransferCCArgs) => Promise<{ txId: string }>;
  wallets: CantonWalletItem[] | null;
  network: CantonNetworkInfo | null;
}
