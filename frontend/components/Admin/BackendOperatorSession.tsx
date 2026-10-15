/**
 * The backend operator session the console's cards share (truthoracle-backend docs/API.md
 * "Admin", ARCHITECTURE §7.4): an operator signs a one-time challenge with their Cantor8 wallet
 * and the backend issues a `kind = "admin"` session cookie. One provider probes the backend and
 * reads the session once, so the catalog, instruments, tokens and rewards panels agree on whether
 * an operator is signed in instead of each asking (and each showing its own sign-in button).
 * `OperatorSessionCard` is the single place that explains the state and offers sign-in / sign-out;
 * a panel renders nothing until `ready`.
 *
 * This is separate from the older `to_admin` Vercel session (`lib/adminSession.ts`, AdminGate),
 * which still gates the browser-side ledger / wallet relays the payout queue uses.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useToast } from "@chakra-ui/react";
import { useCantonWallet } from "@/wallets";
import { authErrorMessage } from "@/auth/wallet";
import { WALLET_DISPLAY_NAME } from "@/config";
import { probeBackend, type BackendAvailability } from "@/lib/backend";
import { fetchBackendAdminSession, signInAsBackendAdmin, signOutBackendAdmin } from "@/lib/backendAdmin";
import { btn, btnQuiet, Card } from "./adminUi";

interface OperatorSession {
  authenticated: boolean;
  isAdmin: boolean;
  partyId: string | null;
}

interface OperatorSessionState {
  availability: BackendAvailability | "probing";
  /** null until the first read answered. */
  session: OperatorSession | null;
  /** The backend answers and the session is an operator's: the cards may load and act. */
  ready: boolean;
  busy: boolean;
  refresh: () => Promise<void>;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<OperatorSessionState | null>(null);

export function BackendOperatorProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const { account, signMessage } = useCantonWallet();
  const [availability, setAvailability] = useState<BackendAvailability | "probing">("probing");
  const [session, setSession] = useState<OperatorSession | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = useCallback(
    (title: string, e: unknown) =>
      toast({ title, description: authErrorMessage(e), status: "error", duration: 8000, isClosable: true }),
    [toast],
  );

  const refresh = useCallback(async () => {
    const a = await probeBackend();
    setAvailability(a);
    if (a !== "ok") {
      setSession(null);
      return;
    }
    try {
      setSession(await fetchBackendAdminSession());
    } catch (e) {
      setSession({ authenticated: false, isAdmin: false, partyId: null });
      fail("Could not read the backend session", e);
    }
  }, [fail]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const a = await probeBackend();
      if (cancelled) return;
      setAvailability(a);
      if (a !== "ok") return;
      try {
        const s = await fetchBackendAdminSession();
        if (!cancelled) setSession(s);
      } catch (e) {
        if (!cancelled) {
          setSession({ authenticated: false, isAdmin: false, partyId: null });
          fail("Could not read the backend session", e);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fail]);

  // The signature is the first thing the click awaits after the challenge round trip
  // (auth/wallet.ts): one popup per click, and nothing else opens one in this handler.
  const signIn = useCallback(async () => {
    if (!account?.partyId) {
      toast({ title: `Connect your ${WALLET_DISPLAY_NAME} wallet first`, status: "info", duration: 4000, isClosable: true });
      return;
    }
    setBusy(true);
    try {
      await signInAsBackendAdmin({ partyId: account.partyId, publicKey: account.publicKey, signMessage });
      setSession(await fetchBackendAdminSession());
    } catch (e) {
      fail("Operator sign-in failed", e);
    } finally {
      setBusy(false);
    }
  }, [account, signMessage, toast, fail]);

  const signOut = useCallback(async () => {
    try {
      await signOutBackendAdmin();
    } finally {
      setSession(await fetchBackendAdminSession());
    }
  }, []);

  const value = useMemo<OperatorSessionState>(
    () => ({
      availability,
      session,
      ready: availability === "ok" && session?.isAdmin === true,
      busy,
      refresh,
      signIn,
      signOut,
    }),
    [availability, session, busy, refresh, signIn, signOut],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBackendOperator(): OperatorSessionState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useBackendOperator must be used within BackendOperatorProvider");
  return ctx;
}

/** The console's one explanation of the backend state, with sign-in while no operator session exists and sign-out once one does. */
export function OperatorSessionCard() {
  const { availability, session, ready, busy, signIn, signOut } = useBackendOperator();
  const { account, connected, connect } = useCantonWallet();
  const toast = useToast();

  if (availability === "probing") return null;
  if (availability !== "ok") {
    return (
      <Card title="Accounts backend">
        <p className="text-sm text-slate-600">
          {availability === "unconfigured"
            ? "This deployment has no accounts backend, so there is no catalog, instrument registry, token console or rewards: markets are read straight from the ledger."
            : "The accounts backend is not reachable right now; the console retries when you reload."}
        </p>
      </Card>
    );
  }

  if (!ready) {
    return (
      <Card title="Backend operator session">
        <p className="text-sm text-slate-600">
          The catalog, the market factory, the instrument registry, the token console and the rewards rules live in the
          accounts backend. Sign in there as an operator: connect your {WALLET_DISPLAY_NAME} wallet and approve a short
          message (a signature, not a transaction). Only parties in the backend&apos;s{" "}
          <code className="font-mono">ADMIN_OPERATORS</code> are accepted.
        </p>
        {session?.authenticated && !session.isAdmin && (
          <p className="mt-2 text-xs text-amber-700">You are signed in to the backend as a user; sign out there before signing in as an operator.</p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          {!connected || !account?.partyId ? (
            <button
              type="button"
              className={btn}
              disabled={busy}
              onClick={() =>
                void connect().catch((e: unknown) =>
                  toast({ title: "Could not connect", description: authErrorMessage(e), status: "error", duration: 8000, isClosable: true }),
                )
              }
            >
              Connect {WALLET_DISPLAY_NAME} wallet
            </button>
          ) : (
            <button type="button" className={btn} disabled={busy} onClick={() => void signIn()}>
              {busy ? "Waiting for your wallet…" : "Sign in to the backend as operator"}
            </button>
          )}
        </div>
      </Card>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs text-slate-600">
      <span>
        Backend operator session: <code className="font-mono">{session?.partyId ?? "operator"}</code>
      </span>
      <button type="button" className={btnQuiet} onClick={() => void signOut()}>
        Sign out of the backend
      </button>
    </div>
  );
}
