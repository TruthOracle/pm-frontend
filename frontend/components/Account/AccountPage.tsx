/**
 * /account — the signed-in person's profile, sign-in methods, wallets, identity
 * verification and sessions (ARCHITECTURE.md §16).
 *
 * Gated the way /admin is (AdminGate): an anonymous visitor gets an explanation and a
 * Sign-in button instead of a redirect, so a failed login is debuggable rather than
 * looking like a broken link; a deployment without an accounts backend says so; and a
 * backend that exists but is not answering says THAT — never "accounts are not
 * enabled", which reads as permanent when the outage is transient.
 */
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Box, Center, Spinner } from "@chakra-ui/react";
import { LogIn, RefreshCw, ShieldCheck, UserRound } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { WALLET_DISPLAY_NAME } from "@/config";
import { BACKEND_UNREACHABLE_SENTENCE } from "@/lib/backendErrors";
import KycPanel from "@/components/kyc/KycPanel";
import ProfileSection from "./ProfileSection";
import IdentitiesSection from "./IdentitiesSection";
import WalletsSection from "./WalletsSection";
import SessionsSection from "./SessionsSection";
import { SectionCard, primaryBtn, secondaryBtn } from "./accountUi";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <Box width="100%" pt={20} px={[6, 10, 20]} pb={20}>
      <Center>
        <div className="w-full max-w-xl rounded-xl border border-slate-200 bg-white p-8 shadow-sm">{children}</div>
      </Center>
    </Box>
  );
}

function RetryButton({ label = "Retry" }: { label?: string }) {
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void auth.refresh().finally(() => setBusy(false));
      }}
      className={`${secondaryBtn} mt-6`}
    >
      <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} /> {busy ? "Checking…" : label}
    </button>
  );
}

export default function AccountPage() {
  const auth = useAuth();
  const location = useLocation();

  // Deep links such as /account#verification arrive before the gated content exists,
  // so the browser's own anchor jump misses. Scroll once the sections are mounted.
  useEffect(() => {
    if (auth.status !== "authenticated" || !auth.me || !location.hash) return;
    const el = document.getElementById(location.hash.slice(1));
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [auth.status, auth.me, location.hash]);

  if (auth.status === "loading") {
    return (
      <Shell>
        <Center py={8}>
          <Spinner />
        </Center>
      </Shell>
    );
  }

  if (auth.status === "unavailable") {
    return (
      <Shell>
        <h1 className="font-jbm text-xl font-bold text-slate-950">Accounts are not enabled on this deployment</h1>
        <p className="mt-3 text-sm text-slate-600">
          This TruthOracle instance runs without an accounts backend, so nobody can sign in, deposit or withdraw
          here, and with no in-app balance to trade from the markets are read-only. Reading positions from a
          connected {WALLET_DISPLAY_NAME} wallet still works.
        </p>
      </Shell>
    );
  }

  if (auth.status === "unreachable") {
    return (
      <Shell>
        <h1 className="font-jbm text-xl font-bold text-slate-950">The accounts service is not reachable</h1>
        <p className="mt-3 text-sm text-slate-600">
          {BACKEND_UNREACHABLE_SENTENCE} Until it answers, sign-in, deposits and withdrawals are paused; trading
          from your connected wallet is unaffected. This page retries on its own.
        </p>
        <RetryButton />
      </Shell>
    );
  }

  if (auth.status !== "authenticated") {
    return (
      <Shell>
        <h1 className="font-jbm text-xl font-bold text-slate-950">Your TruthOracle account</h1>
        <p className="mt-3 text-sm text-slate-600">
          An account ties your sign-in methods and {WALLET_DISPLAY_NAME} wallets together: deposit from any linked
          wallet into one in-app balance, verify your identity once to withdraw, and see where you are signed in.
        </p>
        <button type="button" onClick={() => auth.openLogin()} className={`${primaryBtn} mt-6 w-full justify-center py-2.5`}>
          <LogIn className="h-4 w-4" /> Sign in
        </button>
      </Shell>
    );
  }

  const me = auth.me;
  if (!me) {
    // Signed in (the session is valid) but GET /me failed — it reads the ledger, so a
    // hiccup is realistic. Keep the person signed in and let them retry; the header's
    // Sign out still works.
    return (
      <Shell>
        <h1 className="font-jbm text-xl font-bold text-slate-950">Could not load your account</h1>
        <p className="mt-3 text-sm text-slate-600">
          You are signed in{auth.user?.displayName ? ` as ${auth.user.displayName}` : ""}, but your account details
          did not load. This is usually momentary.
        </p>
        <RetryButton label="Load again" />
      </Shell>
    );
  }

  return (
    <div className="page-container py-10 sm:py-14">
      <div className="mb-8">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1 text-xs font-semibold text-primary">
          <UserRound className="h-3.5 w-3.5" />
          Your account
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl">Account</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
          Sign-in methods, linked wallets, identity verification and active sessions.
        </p>
      </div>
      <div className="space-y-6">
        <ProfileSection me={me} />
        <IdentitiesSection me={me} />
        <WalletsSection me={me} />
        <SectionCard
          id="verification"
          icon={<ShieldCheck className="h-4 w-4" />}
          title="Identity verification"
          description="Verify once to withdraw CC from your in-app balance. One person, one account."
        >
          <KycPanel />
        </SectionCard>
        <SessionsSection />
      </div>
    </div>
  );
}
