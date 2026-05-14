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
 * `signAndExecute` exists on the SDK provider at runtime but is typed `private` in
 * the published .d.ts (provider.d.ts:26). Cast through this standalone interface +
 * `unknown` at the call site.
 *
 * Unlike `signAndExecutePreparedTransfer` (which only posts to an already-open
 * popup and silently no-ops if the popup is closed), `signAndExecute` auto-opens
 * the wallet popup via init("signAndExecute"). The wallet's participant handles
 * prepare + sign + execute. Resolution returns `void`; the txId arrives via the
 * `txInitiated` event, and pass/fail via `txChanged`.
 */
interface C8Signer {
  signAndExecute(input: { message?: string; commands: unknown }): Promise<void>;
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

      // signAndExecute (not signAndExecutePreparedTransfer): the SDK auto-opens
      // the wallet popup for this method via init("signAndExecute"). The wallet's
      // participant prepares + signs + executes — we pass the JSON Ledger API
      // command shape directly. Resolution is via events:
      //   - txInitiated → wallet submitted; resolve with txId
      //   - txChanged status=failed → reject
      //   - operationCanceled → user closed the popup → reject
      const signer = wallet as unknown as C8Signer;

      return new Promise<{ hash: string }>((resolve, reject) => {
        let settled = false;
        const cleanup: Array<() => void> = [];
        const finish = (fn: () => void) => {
          if (settled) return;
          settled = true;
          for (const off of cleanup) {
            try {
              off();
            } catch {
              /* listener already removed */
            }
          }
          fn();
        };

        cleanup.push(
          wallet.on("txInitiated", (e) => {
            finish(() => resolve({ hash: e.txId ?? "" }));
          }),
        );
        cleanup.push(
          wallet.on("txChanged", (e) => {
            if (e.status === "failed") {
              finish(() => reject(new Error(`Wallet failed to submit tx ${e.txId}`)));
            }
          }),
        );
        cleanup.push(
          wallet.on("operationCanceled", (e) => {
            finish(() => reject(new Error(e.reason || "Wallet operation canceled")));
          }),
        );

        signer
          .signAndExecute({
            message: "TruthOracle transaction",
            commands: {
              actAs: params.actAs ?? [partyId],
              commands: params.commands ?? [],
              packageIdSelectionPreference: params.packageIdSelectionPreference ?? [],
              disclosedContracts: params.disclosedContracts ?? [],
            },
          })
          .catch((err) => {
            finish(() => reject(err instanceof Error ? err : new Error(String(err))));
          });

        // User may walk away from the wallet popup; bound the wait.
        const timer = setTimeout(
          () => finish(() => reject(new Error("Wallet sign timed out"))),
          5 * 60 * 1000,
        );
        cleanup.push(() => clearTimeout(timer));
      });
    },
    [account],
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
