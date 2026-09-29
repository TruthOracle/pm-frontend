/**
 * Sign-in wall for /admin.
 *
 * The page itself is not a secret — every privileged call it makes is re-checked by
 * the server — so an unauthenticated visitor gets an explanation and a sign-in
 * button rather than a silent redirect. That also makes a failed login debuggable
 * instead of looking like a broken link.
 */
import { useEffect, useRef, useState } from "react";
import { Box, Center, Spinner } from "@chakra-ui/react";
import { useCantonWallet } from "@/wallets";
import { WALLET_DISPLAY_NAME } from "@/config";
import { useAdminSession } from "@/lib/useIsAdmin";
import { type AdminNonce, NONCE_REUSE_MS, adminNonceIsFresh, fetchAdminNonce, signInAsAdmin, signOutAsAdmin } from "@/lib/adminSession";
import { authErrorMessage } from "@/auth/wallet";

/** "expires in 7h 59m 30s" — a live countdown, so the operator sees it moving. */
function expiryLabel(expiresAt: number): string {
  const ms = expiresAt - Date.now();
  if (ms <= 0) return "session expired — sign in again";
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `expires in ${h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`}`;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <Box width="100%" pt={20} px={[6, 10, 20]} pb={20}>
      <Center>
        <div className="w-full max-w-xl rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
          {children}
        </div>
      </Center>
    </Box>
  );
}

export default function AdminGate({ children }: { children: React.ReactNode }) {
  const { account, connected, connect, signMessage } = useCantonWallet();
  const { session, loading, refresh } = useAdminSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-render each second so the countdown visibly ticks. The remaining time itself
  // is computed from ms timestamps at render, so every tick shows the true value.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!session.authenticated || !session.expiresAt) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [session.authenticated, session.expiresAt]);

  // Connect and sign are two clicks on purpose: each opens a wallet popup and the browser
  // allows one popup per click (frontend/wallets/cantor8/popupGesture.ts). The old
  // one-click "Connect wallet and sign in" had the second popup blocked and also read
  // `account` from a stale closure right after connect().
  const connectWallet = async () => {
    setError(null);
    setBusy(true);
    try {
      await connect();
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // The sign-in nonce is fetched BEFORE the click so the wallet popup is the first thing
  // the click awaits; single-use and 5 min, so it is replaced before it goes stale and
  // after every attempt (`nonceAttempt`).
  const nonceRef = useRef<AdminNonce | null>(null);
  const [nonceAttempt, setNonceAttempt] = useState(0);
  const needNonce = !loading && !session.authenticated && session.configured && connected && Boolean(account?.partyId);
  useEffect(() => {
    if (!needNonce) {
      nonceRef.current = null;
      return;
    }
    let cancelled = false;
    let timer: number | undefined;
    const arm = async () => {
      if (!adminNonceIsFresh(nonceRef.current)) {
        try {
          const nonce = await fetchAdminNonce();
          if (cancelled) return;
          nonceRef.current = nonce;
        } catch {
          // The click falls back to fetch-then-sign; try again quietly in a while.
          if (!cancelled) timer = window.setTimeout(() => void arm(), 15_000);
          return;
        }
      }
      // Fixed local cadence: arithmetic on a server timestamp could land on NaN or zero
      // and turn this into a request loop.
      timer = window.setTimeout(() => {
        nonceRef.current = null;
        void arm();
      }, NONCE_REUSE_MS);
    };
    void arm();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [needNonce, nonceAttempt]);

  const signIn = async () => {
    // Rendered only while connected, so this reads the current party, not a stale one.
    const partyId = account?.partyId;
    if (!partyId) {
      setError("Connect a wallet first.");
      return;
    }
    setError(null);
    setBusy(true);
    const nonce = nonceRef.current;
    nonceRef.current = null; // single-use, whatever happens next
    try {
      await signInAsAdmin({ partyId, signMessage, nonce });
      await refresh();
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setNonceAttempt((n) => n + 1);
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <Shell>
        <Center py={8}>
          <Spinner />
        </Center>
      </Shell>
    );
  }

  if (session.authenticated) {
    return (
      <>
        {/* Who is acting, and a way to stop — operator actions are attributed to this
            party in the server logs, so it should be visible which hat is on. */}
        <Box width="100%" pt={4} px={[6, 10, 20]}>
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs text-slate-600">
            <span className="min-w-0">
              Operator session:{" "}
              <code className="break-all font-mono text-slate-800">{session.partyId}</code>
              {session.expiresAt ? (
                <span className="ml-2 whitespace-nowrap text-slate-400">
                  · {expiryLabel(session.expiresAt)}
                </span>
              ) : null}
            </span>
            <button
              type="button"
              onClick={() => void signOutAsAdmin().then(refresh)}
              className="shrink-0 rounded-md border border-slate-300 px-3 py-1 font-semibold text-slate-700 transition hover:bg-slate-100"
            >
              Sign out
            </button>
          </div>
        </Box>
        {children}
      </>
    );
  }

  if (!session.configured) {
    return (
      <Shell>
        <h1 className="font-jbm text-xl font-bold text-slate-950">Admin access is not configured</h1>
        <p className="mt-3 text-sm text-slate-600">
          This deployment has no <code className="font-mono">ADMIN_SESSION_SECRET</code>, so admin
          actions are disabled for everyone. See <code className="font-mono">ADMIN_AUTH.md</code> for
          the setup steps.
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="font-jbm text-xl font-bold text-slate-950">Operator sign-in</h1>
      <p className="mt-3 text-sm text-slate-600">
        Admin actions are authorised by signing a one-time challenge with your operator
        wallet. Two steps, each in its own wallet popup: connect the {WALLET_DISPLAY_NAME} wallet,
        then approve a short message — a signature, not a transaction, and it moves no funds.
      </p>

      {account?.partyId ? (
        <p className="mt-4 break-all font-mono text-xs text-slate-500">
          Step 1 done — connected as {account.partyId}
        </p>
      ) : (
        <p className="mt-4 text-xs text-slate-500">Step 1 of 2: no wallet connected yet.</p>
      )}

      {connected && account?.partyId ? (
        <button
          type="button"
          onClick={() => void signIn()}
          disabled={busy}
          className="mt-6 w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? "Waiting for your wallet…" : "Step 2 of 2: sign in as operator"}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => void connectWallet()}
          disabled={busy}
          className="mt-6 w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? "Waiting for your wallet…" : `Connect ${WALLET_DISPLAY_NAME} wallet`}
        </button>
      )}

      {error ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => void signOutAsAdmin().then(refresh)}
            className="mt-3 rounded-md border border-red-300 px-3 py-1 text-xs font-semibold text-red-700 transition hover:bg-red-100"
          >
            Clear stale session and retry
          </button>
        </div>
      ) : null}
    </Shell>
  );
}
