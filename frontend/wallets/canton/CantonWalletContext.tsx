/**
 * Canton Wallet – Loop SDK implementation.
 * Uses @fivenorth/loop-sdk for Loop Wallet (Canton / Five North).
 * For future use when switching from Cantor8 to Canton.
 *
 * Amulet only: the Loop wallet holds Canton Coin and this SDK build has no token `send`, so
 * `listInstruments()` names that one token and `transfer()` refuses — deposits in any
 * instrument, like operator sign-in, run through the Cantor8 wallet in practice
 * (docs/TOKENS.md §5). The context conforms to `CantonWalletContextValue` so the app does not
 * branch on the wallet type anywhere else.
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  initLoop,
  loopConnect,
  loopDisconnect,
  loopAutoConnect,
  getLoopNetwork,
  type LoopProvider,
  type DamlCommandPayload,
  type LoopTxResult,
} from "@/lib/loopSdk";
import type { PrepareExecuteParams } from "@/lib/cantonDapp";
import { USE_PARTICIPANT_API } from "@/config";
import { createParticipantClient } from "@/lib/cantonParticipant";
import type {
  CantonAccount,
  CantonNetworkInfo,
  CantonWalletItem,
  CantonWalletContextValue,
  ConnectOptions,
  TransferArgs,
  WalletInstrument,
} from "../types";
import { debugLog } from "@/lib/debugLog";

const CantonWalletContext = createContext<CantonWalletContextValue | null>(null);

const APP_NAME = "TruthOracle";

/**
 * The one token a Loop wallet holds, under the id the Canton Coin registry (and the Cantor8
 * wallet) use for it. The instrument catalog maps `Amulet` back to the configured symbol.
 */
const LOOP_INSTRUMENTS: readonly WalletInstrument[] = [{ instrumentId: "Amulet", name: "Canton Coin", symbol: "CC" }];

function toLoopPayload(params: PrepareExecuteParams): DamlCommandPayload {
  const { actAs, commands, readAs, disclosedContracts, packageIdSelectionPreference } = params as Record<string, unknown>;
  const commandsArray = Array.isArray(commands) ? commands : commands && typeof commands === "object" ? [commands] : [];
  return {
    commands: commandsArray,
    actAs: actAs as string[] | undefined,
    readAs: readAs as string[] | undefined,
    disclosedContracts: disclosedContracts as unknown[] | undefined,
    packageIdSelectionPreference: packageIdSelectionPreference as string[] | undefined,
  };
}

export function CantonWalletProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState<CantonAccount | null>(null);
  const [network] = useState<CantonNetworkInfo | null>(() => ({
    networkId: getLoopNetwork(),
    ledgerApi: undefined,
  }));
  const initRef = useRef(false);

  useEffect(() => {
    if (initRef.current || typeof window === "undefined") return;
    initRef.current = true;
    initLoop({
      appName: APP_NAME,
      network: getLoopNetwork(),
      onTransactionUpdate: (payload) => {
        debugLog("[CantonWallet] Transaction update:", payload);
      },
      options: { openMode: "popup", requestSigningMode: "popup" },
      onAccept: (provider: LoopProvider) => {
        setAccount({
          address: provider.party_id,
          partyId: provider.party_id,
          publicKey: provider.public_key,
        });
      },
      onReject: () => {
        setAccount(null);
      },
    });
    loopAutoConnect().catch(() => {
      // No prior session – normal on first visit
    });
  }, []);

  const connect = useCallback(async (_options?: ConnectOptions) => {
    await loopConnect();
  }, []);

  const disconnect = useCallback(async () => {
    loopDisconnect();
    setAccount(null);
  }, []);

  const signAndSubmitTransaction = useCallback(async (params: PrepareExecuteParams): Promise<{ hash: string }> => {
    if (USE_PARTICIPANT_API) {
      const client = createParticipantClient();
      return await client.submitTransaction(params);
    } else {
      const provider = (await import("@fivenorth/loop-sdk")).loop.provider as LoopProvider | undefined;
      if (!provider) throw new Error("Loop wallet not connected. Connect first.");
      const payload = toLoopPayload(params);
      const result: LoopTxResult = await provider.submitAndWaitForTransaction(payload, {
        message: "TruthOracle transaction",
        estimateTraffic: true,
      });
      const hash = result?.command_id ?? result?.submission_id ?? "";
      if (result?.error?.error_message) {
        throw new Error(result.error.error_message);
      }
      return { hash };
    }
  }, []);

  /**
   * The Loop SDK build has no token `send`, so a deposit cannot be signed here in any
   * instrument. End users on this codebase connect via Cantor8 in practice.
   */
  const transfer = useCallback(async (_args: TransferArgs): Promise<{ txId: string }> => {
    throw new Error(
      "Token transfers are only wired through the Cantor8 wallet. Connect via Cantor8 to deposit into your in-app wallet.",
    );
  }, []);

  /** Canton Coin is the only token a Loop wallet holds; see the module note. */
  const listInstruments = useCallback(async (): Promise<WalletInstrument[]> => [...LOOP_INSTRUMENTS], []);

  /** Same story as transfer — admin login runs through the Cantor8 popup. */
  const signMessage = useCallback(async (_message: string, _partyId?: string): Promise<string> => {
    throw new Error(
      "Message signing is only wired through the Cantor8 wallet. Connect via Cantor8 to sign in as an operator.",
    );
  }, []);

  const wallets: CantonWalletItem[] | null = account
    ? [{ partyId: account.partyId, primary: true, publicKey: account.publicKey }]
    : null;

  const value: CantonWalletContextValue = {
    account,
    connected: !!account,
    connect,
    disconnect,
    signAndSubmitTransaction,
    transfer,
    listInstruments,
    signMessage,
    wallets,
    network,
  };

  return <CantonWalletContext.Provider value={value}>{children}</CantonWalletContext.Provider>;
}

export function useCantonWallet(): CantonWalletContextValue {
  const ctx = useContext(CantonWalletContext);
  if (!ctx) {
    throw new Error("useCantonWallet must be used within CantonWalletProvider");
  }
  return ctx;
}
