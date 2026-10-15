/**
 * Cantor8 Wallet – C8WalletProvider implementation.
 * Uses @cantor8/wallet-connect-sdk (>=0.5.0) for the Cantor8 wallet.
 *
 * Transaction submission: the connected C8 party is an external / self-custody party — the
 * wallet's participant prepares, signs, and executes via the `signAndExecute({ note,
 * partyId, commandId, commandsJson, disclosedContracts })` API. Resolution flows through
 * events (`txInitiated` / `txChanged`).
 *
 * Every method that needs the wallet's approval (connect, signMessage, transfer,
 * signAndSubmitTransaction) opens a popup, and the browser allows ONE popup per click —
 * callers must give each its own button and call it first thing in the handler
 * (popupGesture.ts has the rules). When a popup is blocked anyway, the SDK crashes with a
 * TypeError and leaves its transport wedged; `guardPopup` translates the crash into
 * `WalletPopupBlockedError` and resets the transport so the next click can open a popup.
 *
 * `listInstruments` and `getAccounts` are the exceptions: SDK 0.5.1 answers both from its
 * session (the tokens the connected account holds, named by the SDK's own table — `Amulet`
 * reads "CC") without opening a popup, so they may run from an effect.
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { C8WalletProvider } from "@cantor8/wallet-connect-sdk";
import type { AccountInfoPayload } from "@cantor8/wallet-connect-sdk";
import type { PrepareExecuteParams } from "@/lib/cantonDapp";
import { APP_NETWORK } from "@/config";
import { normalizeCommands } from "@/utils/normalizeCommand";
import type {
  CantonAccount,
  CantonNetworkInfo,
  CantonWalletItem,
  CantonWalletContextValue,
  ConnectOptions,
  TransferArgs,
  WalletInstrument,
} from "../types";
import { debugLog, debugWarn } from "@/lib/debugLog";
import { isSdkPopupBlockedFailure, translateWalletError } from "./popupGesture";

const Cantor8WalletContext = createContext<CantonWalletContextValue | null>(null);

const APP_NAME = "TruthOracle";

type C8Network = "devnet" | "mainnet" | "local";
type C8SdkNetwork = "devnet" | "testmainnet" | "mainnet";

/** Resolve the C8 network from env, falling back to devnet for unsupported values. */
function resolveNetwork(): C8Network {
  const raw = APP_NETWORK.toLowerCase().trim();
  if (raw === "mainnet" || raw === "local") return raw;
  return "devnet";
}

/**
 * App network → SDK network. SDK 0.5.0 dropped "local" and throws on unknown
 * values, so local dev talks to the devnet wallet.
 */
function sdkNetworkFor(network: C8Network): C8SdkNetwork {
  return network === "mainnet" ? "mainnet" : "devnet";
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

function accountFromPayload(accounts?: AccountInfoPayload[] | null): CantonAccount | null {
  const first = accounts?.[0];
  if (!first?.partyId) return null;
  // 0.5.0 exposes publicKey (and validator info) on the account payload; 0.5.1 adds the
  // holdings per token, which the UI labels through the instrument catalog.
  return {
    address: first.partyId,
    partyId: first.partyId,
    publicKey: first.publicKey,
    holdings: Array.isArray(first.holdings)
      ? first.holdings.map((h) => ({ instrumentId: h.instrumentId, balance: h.balance, balanceUsd: h.balanceUsd }))
      : undefined,
  };
}

export function Cantor8WalletProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState<CantonAccount | null>(null);
  const network = useRef<CantonNetworkInfo>({ networkId: resolveNetwork(), ledgerApi: undefined }).current;
  const walletRef = useRef<C8WalletProvider | null>(null);
  /**
   * `getInstruments()` once per connected party: the answer is the wallet's own session cache
   * (SDK 0.5.1 derives it from the account's holdings at connect and on every account update),
   * so a second call buys nothing. Keyed by party and dropped when the account changes or the
   * wallet disconnects, because a different party holds different tokens.
   */
  const instrumentsRef = useRef<{ party: string; promise: Promise<WalletInstrument[]> } | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const wallet = new C8WalletProvider({
      dappName: APP_NAME,
      dappUrl: window.location.href,
      network: sdkNetworkFor(network.networkId as C8Network),
    });

    const refreshAccount = async () => {
      try {
        const { accounts } = await wallet.getAccounts();
        setAccount(accountFromPayload(accounts));
      } catch (e) {
        debugWarn("[Cantor8] getAccounts failed", e);
      }
    };

    // Log EVERY postMessage from the wallet popup origin (including the kinds the
    // SDK consumes internally: `response`, `auth-flow`, `internal_event`,
    // `handshake-ack`). The SDK only re-exposes `kind:"event"` via wallet.on().
    const popupOrigin = popupOriginFor(network.networkId as C8Network);
    const onRawPopupMessage = (ev: MessageEvent) => {
      if (ev.origin !== popupOrigin) return;
      const data = ev.data as { kind?: string } | undefined;
      const kind = data && typeof data === "object" ? (data.kind ?? "(no-kind)") : typeof data;
      debugLog(`[Cantor8] raw popup message kind=${kind}:`, ev.data);
    };
    window.addEventListener("message", onRawPopupMessage);

    // The "connected" event carries no accounts payload — fetch them explicitly.
    wallet.on("connected", (e) => {
      debugLog("[Cantor8] event=connected:", e);
      instrumentsRef.current = null;
      void refreshAccount();
    });

    wallet.on("disconnected", (e) => {
      debugLog("[Cantor8] event=disconnected:", e);
      instrumentsRef.current = null;
      setAccount(null);
    });

    // accountChanged delivers the updated account list directly.
    wallet.on("accountChanged", (e) => {
      debugLog("[Cantor8] event=accountChanged:", e);
      instrumentsRef.current = null;
      setAccount(accountFromPayload(e.accounts));
    });

    wallet.on("themeChanged", (e) => {
      debugLog("[Cantor8] event=themeChanged:", e);
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

  /**
   * After a blocked popup SDK 0.5.0 keeps `popup === null` in its transport, and every
   * later request on that provider posts into nothing and never settles. `disconnect()`
   * is the only public call that destroys and resets the transport (it also clears the
   * stored session, so the person reconnects on the next click — an honest cost for a
   * state the SDK cannot otherwise leave). Verified against the bundle on 2026-09-11.
   */
  const resetAfterBlockedPopup = useCallback(async (wallet: C8WalletProvider) => {
    try {
      await wallet.disconnect();
    } catch (e) {
      debugWarn("[Cantor8] reset after blocked popup failed", e);
    }
    instrumentsRef.current = null;
    setAccount(null);
  }, []);

  /**
   * Run one popup-opening SDK call: translate the SDK's failure into an Error the UI can
   * show (popupGesture.ts) and, when the popup was blocked, reset the transport so the
   * next click works. Every popup-opening method below goes through this.
   */
  const guardPopup = useCallback(
    async <T,>(wallet: C8WalletProvider, run: () => Promise<T>): Promise<T> => {
      try {
        return await run();
      } catch (err) {
        if (isSdkPopupBlockedFailure(err)) {
          debugWarn("[Cantor8] popup blocked by the browser", err);
          await resetAfterBlockedPopup(wallet);
        }
        throw translateWalletError(err);
      }
    },
    [resetAfterBlockedPopup],
  );

  const connect = useCallback(
    async (_options?: ConnectOptions) => {
      const wallet = walletRef.current;
      if (!wallet) {
        throw new Error("Cantor8 wallet not initialized");
      }
      // The popup opens synchronously inside connect(): keep this the first await.
      await guardPopup(wallet, () => wallet.connect());
      // Fetch account after connect (in case the "connected" event hasn't landed yet).
      try {
        const { accounts } = await wallet.getAccounts();
        const connected = accountFromPayload(accounts);
        if (connected) {
          setAccount(connected);
        }
      } catch (e) {
        debugWarn("[Cantor8] getAccounts after connect failed", e);
      }
    },
    [guardPopup],
  );

  const disconnect = useCallback(async () => {
    if (walletRef.current) {
      await walletRef.current.disconnect();
    }
    instrumentsRef.current = null;
    setAccount(null);
  }, []);

  const signAndSubmitTransaction = useCallback(
    async (params: PrepareExecuteParams): Promise<{ hash: string }> => {
      const wallet = walletRef.current;
      if (!wallet) throw new Error("Cantor8 wallet not initialized");
      const partyId = account?.partyId ?? params.actAs?.[0] ?? "";
      if (!partyId) throw new Error("Cantor8 wallet not connected (no partyId)");

      // signAndExecute({ note, partyId, commandId, commandsJson, disclosedContracts }):
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
            debugLog("[Cantor8] txInitiated event:", JSON.stringify(e, null, 2));
            finish(() => resolve({ hash: e.txId ?? commandId }));
          }),
        );
        cleanup.push(
          wallet.on("txChanged", (e) => {
            debugLog("[Cantor8] txChanged event:", JSON.stringify(e, null, 2));
            if (e.status === "failed") {
              finish(() => reject(new Error(`Wallet failed to submit tx ${e.txId}`)));
            }
          }),
        );
        cleanup.push(
          wallet.on("operationCanceled", (e) => {
            debugLog("[Cantor8] operationCanceled event:", JSON.stringify(e, null, 2));
            finish(() => reject(new Error(e.reason || "Wallet operation canceled")));
          }),
        );

        // `disclosedContracts` is typed as `string`: a JSON-stringified array —
        // same shape as `commandsJson` — not a raw array. Stringify the
        // DisclosedContract[] from the dApp.
        const signAndExecuteInput = {
          note: "TruthOracle transaction",
          partyId: params.actAs?.[0] ?? partyId,
          commandId,
          commandsJson: JSON.stringify(normalizeCommands(params.commands)),
          disclosedContracts: JSON.stringify(params.disclosedContracts ?? []),
        };
        debugLog("[Cantor8] signAndExecute payload:\n" + JSON.stringify(signAndExecuteInput, null, 2));
        // The popup opens synchronously inside signAndExecute(): it runs before any await
        // in this method, so a click handler that calls us first keeps its gesture.
        guardPopup(wallet, () => wallet.signAndExecute(signAndExecuteInput))
          .then((result) => {
            debugLog("[Cantor8] signAndExecute resolved:", result);
          })
          .catch((err: unknown) => {
            debugLog("[Cantor8] signAndExecute rejected:", err);
            finish(() => reject(err instanceof Error ? err : new Error(String(err))));
          });

        // User may walk away from the wallet popup; bound the wait.
        const timer = setTimeout(() => finish(() => reject(new Error("Wallet sign timed out"))), 5 * 60 * 1000);
        cleanup.push(() => clearTimeout(timer));
      });
    },
    [account, guardPopup],
  );

  /**
   * High-level token transfer via the Cantor8 SDK's wallet.send(), in whichever instrument the
   * caller names by the wallet's id (`Amulet` for Canton Coin, `cBYN`, `TRO`). The SDK handles
   * popup signing and the token's transfer plumbing internally — we just say "transfer X of
   * this token to Y". A token the wallet does not list fails inside the popup; `listInstruments`
   * is how callers avoid offering that.
   */
  const transfer = useCallback(
    async ({ instrumentId, to, amount, memo, metadata }: TransferArgs): Promise<{ txId: string }> => {
      const wallet = walletRef.current;
      if (!wallet) throw new Error("Cantor8 wallet not initialized");
      if (!account?.partyId) throw new Error("Cantor8 wallet not connected (no partyId)");
      if (!instrumentId) throw new Error("Transfer needs the wallet's instrument id");
      if (!(amount > 0)) throw new Error("Transfer amount must be positive");

      // The popup opens synchronously inside send(): keep this the first await.
      const result = await guardPopup(wallet, () =>
        wallet.send({
          senderPartyId: account.partyId,
          instrumentId,
          amount,
          receiverPartyId: to,
          ...(memo ? { memo } : {}),
          ...(metadata ? { metadata } : {}),
        }),
      );
      return { txId: result?.txId ?? "" };
    },
    [account, guardPopup],
  );

  /**
   * The tokens the connected account can send, by the wallet's ids (SDK `getInstruments()`,
   * answered from its session — no popup). One request per connected party; a failure is not
   * cached, so the next caller asks again.
   */
  const listInstruments = useCallback(async (): Promise<WalletInstrument[]> => {
    const wallet = walletRef.current;
    if (!wallet) throw new Error("Cantor8 wallet not initialized");
    const party = account?.partyId;
    if (!party) throw new Error("Cantor8 wallet not connected (no partyId)");
    const cached = instrumentsRef.current;
    if (cached && cached.party === party) return cached.promise;
    const promise = wallet
      .getInstruments()
      .then((res) =>
        (res?.instruments ?? [])
          .filter((i) => typeof i?.instrumentId === "string" && i.instrumentId !== "")
          .map((i) => ({ instrumentId: i.instrumentId, name: i.name ?? i.instrumentId, symbol: i.symbol ?? i.instrumentId })),
      )
      .catch((e: unknown) => {
        if (instrumentsRef.current?.promise === promise) instrumentsRef.current = null;
        throw translateWalletError(e);
      });
    instrumentsRef.current = { party, promise };
    return promise;
  }, [account?.partyId]);

  /**
   * Sign a plain string with the connected party's key (SDK 0.5.0 `signMessage`).
   * The wallet-link and operator challenges use this; the popup prompts for approval,
   * and the returned string is opaque here — the server decides whether it verifies.
   * The popup opens synchronously inside the SDK call, so a click handler that calls
   * this first (with the challenge already in hand) keeps its one popup allowance.
   */
  const signMessage = useCallback(
    async (message: string, partyId?: string): Promise<string> => {
      const wallet = walletRef.current;
      if (!wallet) throw new Error("Cantor8 wallet not initialized");
      const signer = partyId ?? account?.partyId;
      if (!signer) throw new Error("Cantor8 wallet not connected (no partyId)");
      return guardPopup(wallet, () => wallet.signMessage(message, signer));
    },
    [account, guardPopup],
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
    transfer,
    listInstruments,
    signMessage,
    wallets,
    network,
  };

  return <Cantor8WalletContext.Provider value={value}>{children}</Cantor8WalletContext.Provider>;
}

export function useCantor8Wallet(): CantonWalletContextValue {
  const ctx = useContext(Cantor8WalletContext);
  if (!ctx) {
    throw new Error("useCantor8Wallet must be used within Cantor8WalletProvider");
  }

  return ctx;
}
