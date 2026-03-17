/**
 * Cantor8 Wallet – C8WalletProvider implementation.
 * Uses @cantor8/wallet-connect-sdk for Cantor8 wallet.
 * Transaction submission uses Canton Participant API (same as Canton with VITE_USE_PARTICIPANT_API).
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { C8WalletProvider } from "@cantor8/wallet-connect-sdk";
import { createParticipantClient } from "@/lib/cantonParticipant";
import type { PrepareExecuteParams } from "@/lib/cantonDapp";
import type {
  CantonAccount,
  CantonNetworkInfo,
  CantonWalletItem,
  CantonWalletContextValue,
  ConnectOptions,
} from "../types";

const Cantor8WalletContext = createContext<CantonWalletContextValue | null>(null);

const APP_NAME = "TruthOracle";

export function Cantor8WalletProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState<CantonAccount | null>(null);
  const [network] = useState<CantonNetworkInfo | null>(() => ({
    networkId: "devnet",
    ledgerApi: undefined,
  }));
  const walletRef = useRef<C8WalletProvider | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const wallet = new C8WalletProvider({
      dappName: APP_NAME,
      dappUrl: window.location.href,
      network: "devnet",
    });

    wallet.on("connected", async () => {
      // Cantor8 "connected" event has no accounts; fetch via getAccounts()
      try {
        const { accounts } = await wallet.getAccounts();
        const partyId = accounts?.[0]?.partyId ?? "";
        if (partyId) {
          setAccount({ address: partyId, partyId });
        }
      } catch (e) {
        console.warn("[Cantor8] getAccounts after connect failed:", e);
      }
    });

    wallet.on("disconnected", () => {
      setAccount(null);
    });

    walletRef.current = wallet;

    // Restore account if already connected (e.g. page refresh)
    wallet.status().then(({ connected }) => {
      if (connected) {
        wallet.getAccounts().then(({ accounts }) => {
          const partyId = accounts?.[0]?.partyId ?? "";
          if (partyId) setAccount({ address: partyId, partyId });
        }).catch(() => {});
      }
    }).catch(() => {});
  }, []);

  const connect = useCallback(async (_options?: ConnectOptions) => {
    if (!walletRef.current) {
      throw new Error("Cantor8 wallet not initialized");
    }
    await walletRef.current.connect();
    // Fetch account after connect (in case "connected" event didn't include it)
    try {
      const { accounts } = await walletRef.current.getAccounts();
      const partyId = accounts?.[0]?.partyId ?? "";
      if (partyId) {
        setAccount({ address: partyId, partyId });
      }
    } catch (e) {
      console.warn("[Cantor8] getAccounts after connect failed:", e);
    }
  }, []);

  const disconnect = useCallback(async () => {
    if (walletRef.current) {
      await walletRef.current.disconnect();
    }
    setAccount(null);
  }, []);

  const signAndSubmitTransaction = useCallback(
    async (params: PrepareExecuteParams): Promise<{ hash: string }> => {
      // Cantor8 uses Canton Participant API for transaction submission
      const client = createParticipantClient();
      return await client.submitTransaction(params);
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
    <Cantor8WalletContext.Provider value={value}>
      {children}
    </Cantor8WalletContext.Provider>
  );
}

export function useCantor8Wallet(): CantonWalletContextValue {
  const ctx = useContext(Cantor8WalletContext);
  if (!ctx) {
    throw new Error("useCantor8Wallet must be used within Cantor8WalletProvider");
  }
  return ctx;
}