/**
 * Cantor8 Wallet – C8WalletProvider implementation.
 *
 * The C8 wallet popup auto-closes immediately after the user clicks Approve,
 * which makes the SDK's documented flow (`await connect(); await getAccounts()`)
 * unusable: by the time getAccounts() is called the popup is gone, the SDK
 * marks the transport "destroyed", and rejects all pending requests. The wallet
 * also doesn't include the partyId on the `connected` event payload.
 *
 * Workaround: tap into the raw postMessage stream from the wallet origin and
 * pull the partyId out of whichever message carries it.
 *
 * SDK ≥0.2 also persists a bearer token in localStorage (`c8-session`). When a
 * token exists, `connect()` resolves immediately **without** opening the popup,
 * and restore-session polling hits `/api/balance` in the background. If we only
 * listened to postMessage, React would stay "disconnected" while those balance
 * calls ran — so we hydrate `account` from `getAccounts()` and `connected` /
 * `accountChanged` events as well.
 *
 * Transactions go through the Canton Participant API (Keycloak service-account
 * token), so wallet signing isn't on the critical path.
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
const WALLET_ORIGIN =
  import.meta.env.VITE_CANTOR8_WALLET_ORIGIN ?? "https://wallet.dev.digik.cantor8.tech";

/** Recursively scan an object for any string that looks like a Canton partyId. */
function findPartyIdDeep(value: unknown, depth = 0): string {
  if (depth > 6 || value == null) return "";
  if (typeof value === "string") {
    return /::[0-9a-f]{8,}$/i.test(value) ? value : "";
  }
  if (Array.isArray(value)) {
    for (const v of value) {
      const found = findPartyIdDeep(v, depth + 1);
      if (found) return found;
    }
    return "";
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.partyId === "string") return obj.partyId;
    for (const k of Object.keys(obj)) {
      const found = findPartyIdDeep(obj[k], depth + 1);
      if (found) return found;
    }
  }
  return "";
}

export function Cantor8WalletProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState<CantonAccount | null>(null);
  const [network] = useState<CantonNetworkInfo | null>(() => ({
    networkId: "devnet",
    ledgerApi: undefined,
  }));
  const walletRef = useRef<C8WalletProvider | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onRawMessage = (e: MessageEvent) => {
      if (e.origin !== WALLET_ORIGIN) return;
      const data = e.data;
      if (!data || typeof data !== "object") return;
      const partyId = findPartyIdDeep(data);
      if (partyId) {
        setAccount((prev) => prev ?? { address: partyId, partyId });
      }
    };
    window.addEventListener("message", onRawMessage);

    const wallet = new C8WalletProvider({
      dappName: APP_NAME,
      dappUrl: window.location.href,
      network: "devnet",
    });

    const unsubDisconnected = wallet.on("disconnected", (event: any) => {
      // The SDK fires a synthetic disconnected event with reason "destroyed"
      // whenever the popup closes (including the auto-close right after
      // Approve). That's transport teardown, not a real wallet disconnect —
      // ignore it so we don't wipe the account we just set.
      if (event?.reason === "destroyed") return;
      setAccount(null);
    });

    const syncAccountFromSdk = async () => {
      try {
        const { accounts } = await wallet.getAccounts();
        const partyId = accounts[0]?.partyId;
        if (partyId) setAccount({ address: partyId, partyId });
      } catch {
        // No valid session / token — keep relying on postMessage after popup auth.
      }
    };

    const unsubConnected = wallet.on("connected", () => {
      void syncAccountFromSdk();
    });

    const unsubAccountChanged = wallet.on("accountChanged", (ev) => {
      const partyId = ev.accounts[0]?.partyId;
      if (partyId) setAccount({ address: partyId, partyId });
    });

    // Hydrate UI when localStorage already has a C8 session (no popup on connect()).
    void syncAccountFromSdk();

    walletRef.current = wallet;

    return () => {
      window.removeEventListener("message", onRawMessage);
      unsubDisconnected();
      unsubConnected();
      unsubAccountChanged();
    };
  }, []);

  const connect = useCallback(async (_options?: ConnectOptions) => {
    if (!walletRef.current) {
      throw new Error("Cantor8 wallet not initialized");
    }
    // Opens the popup when there is no cached bearer token; otherwise the SDK
    // resolves immediately (see sync above / postMessage for partyId).
    await walletRef.current.connect();
    try {
      const { accounts } = await walletRef.current.getAccounts();
      const partyId = accounts[0]?.partyId;
      if (partyId) setAccount({ address: partyId, partyId });
    } catch {
      /* fresh popup flow — party may arrive via postMessage */
    }
  }, []);

  const disconnect = useCallback(async () => {
    // Best-effort: if the wallet popup auto-closed, the SDK's request()
    // returns a promise that never resolves. Don't block local state cleanup
    // on it.
    if (walletRef.current) {
      void walletRef.current.disconnect().catch(() => {});
    }
    setAccount(null);
  }, []);

  const signAndSubmitTransaction = useCallback(
    async (params: PrepareExecuteParams): Promise<{ hash: string }> => {
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
