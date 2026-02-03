import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import {
  connect as cantonConnect,
  disconnect as cantonDisconnect,
  status as cantonStatus,
  listAccounts,
  prepareExecuteAndWait,
  dappAPI,
} from "@canton-network/dapp-sdk";

type PrepareExecuteParams = dappAPI.PrepareExecuteParams;
type PrepareExecuteAndWaitResult = dappAPI.PrepareExecuteAndWaitResult;
type Wallet = dappAPI.Wallet;

export interface CantonAccount {
  address: string; // Canton party ID
  partyId: string;
  publicKey?: string;
  namespace?: string;
}

type CantonNetwork = dappAPI.Network;

type ConnectOptions = Parameters<typeof cantonConnect>[0];

interface CantonWalletContextValue {
  account: CantonAccount | null;
  connected: boolean;
  connect: (options?: ConnectOptions) => Promise<void>;
  disconnect: () => Promise<void>;
  signAndSubmitTransaction: (params: PrepareExecuteParams) => Promise<{ hash: string }>;
  wallets: Wallet[] | null;
  network: CantonNetwork | null;
}

const CantonWalletContext = createContext<CantonWalletContextValue | null>(null);

function primaryAccount(wallets: Wallet[]): CantonAccount | null {
  const primary = wallets.find((w) => w.primary) ?? wallets[0];
  if (!primary) return null;
  return {
    address: primary.partyId,
    partyId: primary.partyId,
    publicKey: primary.publicKey,
    namespace: primary.namespace,
  };
}

export function CantonWalletProvider({ children }: { children: React.ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [wallets, setWallets] = useState<Wallet[] | null>(null);
  const [account, setAccount] = useState<CantonAccount | null>(null);
  const [network, setNetwork] = useState<CantonNetwork | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await cantonStatus();
      setConnected(!!s.isConnected);
      setNetwork(s.network ?? null);
      if (s.isConnected) {
        const accounts = await listAccounts();
        setWallets(accounts);
        setAccount(primaryAccount(accounts));
      } else {
        setWallets(null);
        setAccount(null);
      }
    } catch {
      setConnected(false);
      setWallets(null);
      setAccount(null);
      setNetwork(null);
    }
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  const connect = useCallback(
    async (options?: ConnectOptions) => {
      await cantonConnect(options);
      await refreshStatus();
    },
    [refreshStatus]
  );

  const disconnect = useCallback(async () => {
    await cantonDisconnect();
    setConnected(false);
    setWallets(null);
    setAccount(null);
  }, []);

  const signAndSubmitTransaction = useCallback(
    async (params: PrepareExecuteParams): Promise<{ hash: string }> => {
      const result: PrepareExecuteAndWaitResult = await prepareExecuteAndWait(params);
      const commandId = result?.tx?.commandId ?? "";
      return { hash: commandId };
    },
    []
  );

  const value: CantonWalletContextValue = {
    account,
    connected,
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
