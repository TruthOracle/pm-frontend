/**
 * Canton Wallet – Loop SDK implementation.
 * Uses @fivenorth/loop-sdk for Loop Wallet (Canton / Five North).
 * For future use when switching from Cantor8 to Canton.
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
} from "../types";
import { walletDebugLog } from "@/lib/walletDebug";

const CantonWalletContext = createContext<CantonWalletContextValue | null>(null);

const APP_NAME = "TruthOracle";

function toLoopPayload(params: PrepareExecuteParams): DamlCommandPayload {
  const {
    actAs,
    commands,
    readAs,
    disclosedContracts,
    packageIdSelectionPreference,
  } = params as Record<string, unknown>;
  const commandsArray = Array.isArray(commands)
    ? commands
    : commands && typeof commands === "object"
      ? [commands]
      : [];
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
        walletDebugLog("[CantonWallet] Transaction update:", payload);
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

  const signAndSubmitTransaction = useCallback(
    async (params: PrepareExecuteParams): Promise<{ hash: string }> => {
      if (USE_PARTICIPANT_API) {
        const client = createParticipantClient();
        return await client.submitTransaction(params);
      } else {
        const provider = (await import("@fivenorth/loop-sdk")).loop
          .provider as LoopProvider | undefined;
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
    },
    []
  );

  /**
   * Loop wallet path doesn't have an Amulet send equivalent in this SDK build,
   * so we throw. End users on this codebase connect via Cantor8 in practice.
   */
  const transferCC = useCallback(
    async (_args: { to: string; amount: number; memo?: string; metadata?: Record<string, string> }): Promise<{ txId: string }> => {
      throw new Error(
        "Canton Coin transfer is only wired through the Cantor8 wallet. Connect via Cantor8 to send CC.",
      );
    },
    [],
  );

  /** Same story as transferCC — admin login runs through the Cantor8 popup. */
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
    transferCC,
    signMessage,
    wallets,
    network,
  };

  return (
    <CantonWalletContext.Provider value={value}>
      {children}
    </CantonWalletContext.Provider>
  );
}

export function useCantonWallet(): CantonWalletContextValue {
  const ctx = useContext(CantonWalletContext);
  if (!ctx) {
    throw new Error("useCantonWallet must be used within CantonWalletProvider");
  }
  return ctx;
}
