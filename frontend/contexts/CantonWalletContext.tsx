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

export interface CantonAccount {
  address: string;
  partyId: string;
  publicKey?: string;
  namespace?: string;
}

/** Minimal network info for UI (Loop does not expose full network object the same way). */
export interface CantonNetworkInfo {
  networkId: string;
  ledgerApi?: { baseUrl?: string };
}

/** Single-account wallet shape for compatibility with existing UI (list of one). */
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

interface CantonWalletContextValue {
  account: CantonAccount | null;
  connected: boolean;
  connect: (options?: ConnectOptions) => Promise<void>;
  disconnect: () => Promise<void>;
  signAndSubmitTransaction: (params: PrepareExecuteParams) => Promise<{ hash: string }>;
  wallets: CantonWalletItem[] | null;
  network: CantonNetworkInfo | null;
}

const CantonWalletContext = createContext<CantonWalletContextValue | null>(null);

const APP_NAME = "TruthOracle";

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
        console.log("[CantonWallet] Transaction update:", payload);
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

  const connect = useCallback(async () => {
    await loopConnect();
  }, []);

  const disconnect = useCallback(async () => {
    loopDisconnect();
    setAccount(null);
  }, []);

  const signAndSubmitTransaction = useCallback(
    async (params: PrepareExecuteParams): Promise<{ hash: string }> => {
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
    },
    []
  );

  const wallets: CantonWalletItem[] | null = account
    ? [{ partyId: account.partyId, primary: true, publicKey: account.publicKey }]
    : null;

  const value: CantonWalletContextValue = {
    account,
    connected: !!account,
    connect,
    disconnect,
    signAndSubmitTransaction,
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
