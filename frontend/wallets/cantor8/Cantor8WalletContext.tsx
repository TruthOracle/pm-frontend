/**
 * Cantor8 Wallet – C8WalletProvider implementation.
 * Uses @cantor8/wallet-connect-sdk (>=0.3.0) for the Cantor8 wallet.
 *
 * Transaction submission: the connected C8 party is an external / self-custody party — the
 * wallet's participant prepares, signs, and executes via the new `signAndExecute({ note,
 * partyId, commandId, commandsJson, disclosedContracts })` API. Resolution flows through
 * events (`txInitiated` / `txChanged`).
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { C8WalletProvider } from "@cantor8/wallet-connect-sdk";
import type { AccountInfoPayload } from "@cantor8/wallet-connect-sdk";
import type { PrepareExecuteParams } from "@/lib/cantonDapp";
import { normalizeCommands } from "@/utils/normalizeCommand";
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

/**
 * Popup origin per network — matches the SDK's `e`/`origin` constants. We use this
 * to filter raw `window.message` events so we can log everything the popup sends
 * (the SDK only re-exposes `kind: "event"` messages via `wallet.on()`; responses,
 * auth-flow, internal_event, handshake-ack are handled internally).
 */
function popupOriginFor(network: C8Network): string {
  if (network === "mainnet") return "https://wallet.cantor8.tech";
  return "https://wallet.dev.digik.cantor8.tech";
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

    // Log EVERY postMessage from the wallet popup origin (including the kinds the
    // SDK consumes internally: `response`, `auth-flow`, `internal_event`,
    // `handshake-ack`). The SDK only re-exposes `kind:"event"` via wallet.on().
    const popupOrigin = popupOriginFor(network.networkId as C8Network);
    const onRawPopupMessage = (ev: MessageEvent) => {
      if (ev.origin !== popupOrigin) return;
      const data = ev.data as { kind?: string } | undefined;
      const kind = data && typeof data === "object" ? data.kind ?? "(no-kind)" : typeof data;
      console.log(`[Cantor8] raw popup message kind=${kind}:`, ev.data);
    };
    window.addEventListener("message", onRawPopupMessage);

    // The "connected" event in 0.2.x carries no accounts payload — fetch them explicitly.
    wallet.on("connected", (e) => {
      console.log("[Cantor8] event=connected:", e);
      void refreshAccount();
    });

    wallet.on("disconnected", (e) => {
      console.log("[Cantor8] event=disconnected:", e);
      setAccount(null);
    });

    // 0.2.x: accountChanged delivers the updated account list directly.
    wallet.on("accountChanged", (e) => {
      console.log("[Cantor8] event=accountChanged:", e);
      applyPartyId(partyIdFromAccounts(e.accounts));
    });

    wallet.on("themeChanged", (e) => {
      console.log("[Cantor8] event=themeChanged:", e);
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
      window.removeEventListener("message", onRawPopupMessage);
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

      // 0.3.0 signAndExecute({ note, partyId, commandId, commandsJson, disclosedContracts }):
      // the SDK auto-opens the wallet popup; the wallet's participant prepares + signs +
      // executes. The returned Promise<void> doesn't carry the txId — resolution flows via:
      //   - txInitiated → wallet submitted; resolve with txId
      //   - txChanged status=failed → reject
      //   - operationCanceled → user closed the popup → reject
      const commandId = (params.commandId as string | undefined) ?? crypto.randomUUID();

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
            console.log("[Cantor8] txInitiated event:", JSON.stringify(e, null, 2));
            finish(() => resolve({ hash: e.txId ?? commandId }));
          }),
        );
        cleanup.push(
          wallet.on("txChanged", (e) => {
            console.log("[Cantor8] txChanged event:", JSON.stringify(e, null, 2));
            if (e.status === "failed") {
              finish(() => reject(new Error(`Wallet failed to submit tx ${e.txId}`)));
            }
          }),
        );
        cleanup.push(
          wallet.on("operationCanceled", (e) => {
            console.log("[Cantor8] operationCanceled event:", JSON.stringify(e, null, 2));
            finish(() => reject(new Error(e.reason || "Wallet operation canceled")));
          }),
        );

        // SDK 0.3 .d.ts types `disclosedContracts` as `string`; per Vasiliy this
        // should be a JSON-stringified array — same shape as `commandsJson` —
        // not a raw array. Stringify the DisclosedContract[] from the dApp.
        const signAndExecuteInput = {
          note: "TruthOracle transaction",
          partyId: params.actAs?.[0] ?? partyId,
          commandId,
          commandsJson: JSON.stringify(normalizeCommands(params.commands)),
          disclosedContracts: JSON.stringify(params.disclosedContracts ?? []),
        };
        console.log(
          "[Cantor8] signAndExecute payload:\n" + JSON.stringify(signAndExecuteInput, null, 2),
        );
        wallet
          .signAndExecute(signAndExecuteInput)
          .then((result) => {
            console.log("[Cantor8] signAndExecute resolved:", result);
          })
          .catch((err) => {
            console.log("[Cantor8] signAndExecute rejected:", err);
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

  /**
   * High-level Amulet (Canton Coin) transfer via Cantor8 SDK's wallet.send().
   * The SDK handles popup signing + AmuletRules / OpenMiningRound / fee plumbing
   * internally — we just say "transfer X CC to Y".
   */
  const transferCC = useCallback(
    async ({ to, amount, memo, metadata }: { to: string; amount: number; memo?: string; metadata?: Record<string, string> }): Promise<{ txId: string }> => {
      const wallet = walletRef.current;
      if (!wallet) throw new Error("Cantor8 wallet not initialized");
      if (!account?.partyId) throw new Error("Cantor8 wallet not connected (no partyId)");
      if (!(amount > 0)) throw new Error("Transfer amount must be positive");

      const result = await wallet.send({
        senderPartyId: account.partyId,
        instrumentId: "Amulet",
        amount,
        receiverPartyId: to,
        ...(memo ? { memo } : {}),
        ...(metadata ? { metadata } : {}),
      });
      return { txId: result?.txId ?? "" };
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
    transferCC,
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
