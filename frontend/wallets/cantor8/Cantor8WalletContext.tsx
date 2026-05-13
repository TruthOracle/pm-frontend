/**
 * Cantor8 Wallet – C8WalletProvider implementation.
 * Uses @cantor8/wallet-connect-sdk (>=0.2.0) for the Cantor8 wallet.
 *
 * Transaction submission: the connected C8 party is an external / self-custody party — the
 * dApp's participant cannot sign for it. So we use the interactive-submission flow:
 *   1. prepare the transaction against the Canton JSON Ledger API (VITE_CANTON_PARTICIPANT_URL),
 *   2. hand the prepared transaction + hash to the wallet, which signs the hash with the party's
 *      key and executes (`signAndExecutePreparedTransfer`),
 *   3. return the resulting txId.
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

/**
 * `signAndExecutePreparedTransfer` exists on the SDK provider at runtime but is typed `private`
 * in the published .d.ts. This is the wallet-side "sign a prepared transaction & execute it" entry
 * point — the params are generic (prepared tx bytes + hash), not transfer-specific.
 * (Standalone interface — not an intersection with C8WalletProvider, which would collapse to `never`
 * because of the private member of the same name. Cast through `unknown` at the call site.)
 */
interface C8PreparedSigner {
  signAndExecutePreparedTransfer(input: {
    partyId: string;
    commandId: string;
    preparedTxB64: string;
    hashB64: string;
    hashingSchemeVersion: string;
  }): Promise<{ txId: string }>;
}

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
      const wallet = walletRef.current;
      if (!wallet) throw new Error("Cantor8 wallet not initialized");
      const partyId = account?.partyId ?? params.actAs?.[0] ?? "";
      if (!partyId) throw new Error("Cantor8 wallet not connected (no partyId)");

      // 1. prepare on the dApp's participant.
      const client = createParticipantClient();
      const commandId = crypto.randomUUID();
      const prepared = await client.prepare(params, commandId);

      // 2. wallet signs the hash with the party's key and executes.
      const signer = wallet as unknown as C8PreparedSigner;
      const { txId } = await signer.signAndExecutePreparedTransfer({
        partyId,
        commandId,
        preparedTxB64: prepared.preparedTransaction,
        hashB64: prepared.preparedTransactionHash,
        hashingSchemeVersion: prepared.hashingSchemeVersion,
      });
      return { hash: txId };
    },
    [account]
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
