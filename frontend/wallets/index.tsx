/**
 * Unified wallet export.
 * Switch between Canton (Loop SDK) and Cantor8 via VITE_WALLET_TYPE env var.
 *
 * VITE_WALLET_TYPE=canton   → Canton (Loop SDK) - for future use
 * VITE_WALLET_TYPE=cantor8  → Cantor8 (default)
 *
 * Add to .env:
 *   VITE_WALLET_TYPE=cantor8
 * or
 *   VITE_WALLET_TYPE=canton
 */
import {
  CantonWalletProvider as CantonProvider,
  useCantonWallet as useCantonWalletHook,
} from "@/wallets/canton/CantonWalletContext";
import {
  Cantor8WalletProvider as Cantor8Provider,
  useCantor8Wallet as useCantor8WalletHook,
} from "@/wallets/cantor8/Cantor8WalletContext";

export type { CantonAccount, CantonNetworkInfo, CantonWalletItem, CantonWalletContextValue } from "./types";
export type { PrepareExecuteParams } from "./types";

const WALLET_TYPE = (import.meta.env.VITE_WALLET_TYPE ?? "cantor8") as "canton" | "cantor8";

/** Main provider – use Canton or Cantor8 based on VITE_WALLET_TYPE */
export const CantonWalletProvider =
  WALLET_TYPE === "canton" ? CantonProvider : Cantor8Provider;

/** Main hook – use Canton or Cantor8 based on VITE_WALLET_TYPE */
export const useCantonWallet =
  WALLET_TYPE === "canton" ? useCantonWalletHook : useCantor8WalletHook;
