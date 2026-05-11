/**
 * Cantor8 Wallet – C8WalletProvider implementation.
 * Uses @cantor8/wallet-connect-sdk (>=0.2.0) for the Cantor8 wallet.
 * Transaction submission uses Canton Participant API (same as Canton with VITE_USE_PARTICIPANT_API).
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { C8WalletProvider } from "@cantor8/wallet-connect-sdk";
import type { AccountInfoPayload } from "@cantor8/wallet-connect-sdk";
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

type C8Network = "devnet" | "mainnet" | "local";

/** Resolve the C8 network from env, falling back to devnet for unsupported values. */
function resolveNetwork(): C8Network {
  const raw = String(import.meta.env.VITE_APP_NETWORK ?? "devnet").toLowerCase().trim();
  if (raw === "mainnet" || raw === "local") return raw;
  return "devnet";
}

function partyIdFromAccounts(accounts?: AccountInfoPayload[] | null): string {
  return accounts?.[0]?.partyId ?? "";
}

export function Cantor8WalletProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState<CantonAccount | null>(null);
  const network = useRef<CantonNetworkInfo>({ networkId: resolveNetwork(), ledgerApi: undefined }).current;
  const walletRef = useRef<C8WalletProvider | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const wallet = new C8WalletProvider({
      dappName: APP_NAME,
      dappUrl: window.location.href,
      network: network.networkId as C8Network,
    });

    const applyPartyId = (partyId: string) => {
      setAccount(partyId ? { address: partyId, partyId } : null);
    };

    const refreshAccount = async () => {
      try {
        const { accounts } = await wallet.getAccounts();
        applyPartyId(partyIdFromAccounts(accounts));
      } catch (e) {
        console.warn("[Cantor8] getAccounts failed:", e);
      }
    };

    // The "connected" event in 0.2.x carries no accounts payload — fetch them explicitly.
    wallet.on("connected", () => {
      void refreshAccount();
    });

    wallet.on("disconnected", () => {
      setAccount(null);
    });

    // 0.2.x: accountChanged delivers the updated account list directly.
    wallet.on("accountChanged", (e) => {
      applyPartyId(partyIdFromAccounts(e.accounts));
    });

    walletRef.current = wallet;

    // Restore account if already connected (e.g. page refresh)
    wallet
      .status()
      .then(({ connected }) => {
        if (connected) void refreshAccount();
      })
      .catch(() => {});

    return () => {
      walletRef.current = null;
    };
  }, [network]);

  const connect = useCallback(async (_options?: ConnectOptions) => {
    const wallet = walletRef.current;
    if (!wallet) {
      throw new Error("Cantor8 wallet not initialized");
    }
    await wallet.connect();
    // Fetch account after connect (in case the "connected" event hasn't landed yet).
    try {
      const { accounts } = await wallet.getAccounts();
      const partyId = partyIdFromAccounts(accounts);
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
