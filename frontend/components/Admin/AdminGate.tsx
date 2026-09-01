/**
 * Sign-in wall for /admin.
 *
 * The page itself is not a secret — every privileged call it makes is re-checked by
 * the server — so an unauthenticated visitor gets an explanation and a sign-in
 * button rather than a silent redirect. That also makes a failed login debuggable
 * instead of looking like a broken link.
 */
import { useEffect, useState } from "react";
import { Box, Center, Spinner } from "@chakra-ui/react";
import { useCantonWallet } from "@/wallets";
import { useAdminSession } from "@/lib/useIsAdmin";
import { signInAsAdmin, signOutAsAdmin } from "@/lib/adminSession";

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

  const signIn = async () => {
    setError(null);
    setBusy(true);
    try {
      if (!connected || !account?.partyId) await connect();
      const partyId = account?.partyId;
      if (!partyId) throw new Error("Connect a wallet first.");
      await signInAsAdmin({ partyId, signMessage });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
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
        wallet. Your wallet will ask you to approve a short message — this is a signature,
        not a transaction, and moves no funds.
      </p>

      {account?.partyId ? (
        <p className="mt-4 break-all font-mono text-xs text-slate-500">
          Connected as {account.partyId}
        </p>
      ) : (
        <p className="mt-4 text-xs text-slate-500">No wallet connected yet.</p>
      )}

      {/*
        Setup aid: the server pins each operator's public key, and the only convenient
        place to read it is the connected account itself. Showing the exact env line
        removes the guesswork from onboarding a new operator. Public keys are public —
        nothing sensitive is revealed here.
      */}
      {account?.partyId && account.publicKey ? (
        <details className="mt-4">
          <summary className="cursor-pointer text-xs text-slate-500">
            Adding yourself as an operator?
          </summary>
          <p className="mt-2 text-xs text-slate-600">
            Give this line to whoever runs the deployment, to append to{" "}
            <code className="font-mono">ADMIN_OPERATORS</code>:
          </p>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-100 p-3 font-mono text-[11px] leading-relaxed text-slate-800">
            {`${account.partyId}=${account.publicKey}`}
          </pre>
        </details>
      ) : null}

      <button
        type="button"
        onClick={signIn}
        disabled={busy}
        className="mt-6 w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? "Waiting for your wallet…" : connected ? "Sign in as operator" : "Connect wallet and sign in"}
      </button>

      {error ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
          <button
            type="button"
            onClick={() => void signOutAsAdmin().then(refresh)}
            className="mt-2 block text-xs underline"
          >
            Clear any stale session and retry
          </button>
        </div>
      ) : null}

      <p className="mt-6 text-xs text-slate-500">
        Not an operator? Your party id has to be listed in the server's{" "}
        <code className="font-mono">ADMIN_OPERATORS</code> allowlist. Ask whoever runs the
        deployment to add it.
      </p>
    </Shell>
  );
}
