/**
 * Shared wallet types for Canton and Cantor8.
 * Both implementations expose the same interface for easy switching.
 */

import type { TransferArgs } from "@/lib/inAppWallet";

/** What the wallet says this party holds, under the wallet's own token ids (Cantor8: `Amulet`, `cBYN`, …). */
export interface CantonAccountHolding {
  instrumentId: string;
  balance: number;
  balanceUsd: number;
}

export interface CantonAccount {
  address: string;
  partyId: string;
  publicKey?: string;
  namespace?: string;
  /**
   * The wallet's snapshot of the party's holdings at connect / account change. Labelled in the
   * UI through the instrument catalog's `walletInstrumentId` (lib/instruments.ts), never by the
   * wallet's id itself. Absent on wallets that do not report holdings (Loop).
   */
  holdings?: CantonAccountHolding[];
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
export type { TransferArgs };

/**
 * A token the connected wallet can send, under the wallet's OWN id — what `transfer()` takes
 * as `instrumentId` and what the catalog's `walletInstrumentId` maps to (`Amulet` for Canton
 * Coin). `name` and `symbol` are the wallet's labels, kept for logs and fallbacks; the UI labels
 * tokens from the instrument catalog.
 */
export interface WalletInstrument {
  instrumentId: string;
  name: string;
  symbol: string;
}

export interface CantonWalletContextValue {
  account: CantonAccount | null;
  connected: boolean;
  connect: (options?: ConnectOptions) => Promise<void>;
  disconnect: () => Promise<void>;
  signAndSubmitTransaction: (params: import("@/lib/cantonDapp").PrepareExecuteParams) => Promise<{ hash: string }>;
  /**
   * High-level token transfer in ANY instrument the wallet lists (docs/TOKENS.md §5): wraps the
   * Cantor8 SDK's `wallet.send({ instrumentId, … })` — the wallet handles the token's transfer
   * rules, fees and popup signing internally. `instrumentId` is the wallet's id for the token
   * (`ApiInstrument.walletInstrumentId`). Resolves with the txId once the person confirms in the
   * wallet popup; opens ONE popup, so it must be the first thing a click handler awaits
   * (wallets/cantor8/popupGesture.ts).
   */
  transfer: (args: TransferArgs) => Promise<{ txId: string }>;
  /**
   * The tokens the connected wallet can send, by the wallet's own ids. Answered from the wallet's
   * session (no popup), fetched once per connected party and cached until the account changes —
   * the deposit button is disabled for a token that is missing here, before any transfer is
   * offered ("Your Cantor8 wallet does not list <symbol> yet").
   */
  listInstruments: () => Promise<WalletInstrument[]>;
  /**
   * Sign an arbitrary string with the connected party's key. Used for the admin
   * login challenge (frontend/lib/adminSession.ts) — the popup prompts the operator,
   * and the server verifies the result against a pinned public key.
   */
  signMessage: (message: string, partyId?: string) => Promise<string>;
  wallets: CantonWalletItem[] | null;
  network: CantonNetworkInfo | null;
}
