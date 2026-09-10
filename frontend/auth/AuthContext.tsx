/**
 * Account session for the whole app (ARCHITECTURE.md §16).
 *
 * Mounted as <WalletProvider><Router><AuthProvider> so it can read the connected
 * external wallet and the current URL. Children render immediately: the status is
 * `loading` only until the first probe settles, and every anonymous flow keeps working
 * while that happens. When the proxy has no BACKEND_URL the status is `unavailable`
 * and no account affordance is shown anywhere — the app is then exactly the pre-accounts
 * app: read + wallet-signed trading, no deposits or withdrawals. When a backend exists
 * but does not answer the status is `unreachable`: sign-in is offered but disabled and
 * the money rails pause, because "no backend" and "backend down" must never be confused
 * (one hides the controls for good, the other recovers on its own).
 *
 * Nothing security-relevant is decided here. The server owns the session; this module
 * only reports what it said and drives the login / link handshakes.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useToast } from "@chakra-ui/react";
import { backendFetch, isBackendError, onUnauthenticated, probeBackend } from "@/lib/backend";
import { isTransientBackendError } from "@/lib/backendErrors";
import { useCantonWallet } from "@/wallets";
import { LoginDialog } from "@/components/auth/LoginDialog";
import { LinkWalletPrompt } from "@/components/auth/LinkWalletPrompt";
import { authCodeMessage, linkWallet } from "./wallet";
import type {
  AuthContextValue,
  AuthStatus,
  ConnectedWalletState,
  Identity,
  LoginMode,
  MeResponse,
  SessionResponse,
  User,
} from "./types";

/** What one probe of the server produced. `loading` never comes back from a probe. */
interface Snapshot {
  status: Exclude<AuthStatus, "loading">;
  me: MeResponse | null;
  /** /me's user when loaded, else /auth/session's — set whenever `authenticated`. */
  user: User | null;
  sessionKind: "user" | "admin" | null;
  expiresAt: string | null;
}

const UNAVAILABLE: Snapshot = { status: "unavailable", me: null, user: null, sessionKind: null, expiresAt: null };
const UNREACHABLE: Snapshot = { status: "unreachable", me: null, user: null, sessionKind: null, expiresAt: null };
const ANONYMOUS: Snapshot = { status: "anonymous", me: null, user: null, sessionKind: null, expiresAt: null };

/** How soon to try again after a transient failure (probe or session read). */
const UNREACHABLE_RETRY_MS = 15_000;

/**
 * The mount-time probe is shared: Header, AccountPage and the wallet cards all want the
 * session at once and StrictMode runs the mount effect twice, so a naive hook would fire
 * several identical probes per page load. ONLY the initial probe goes through this
 * dedupe. Every refresh() after a mutation (login, link, logout) sends its own request:
 * joining a probe that started BEFORE the mutation would hand back the pre-mutation
 * answer (the KYC panel polls every 10 s, and /me reads the ledger, so there is a
 * multi-second window in which that happens).
 */
let initialProbe: Promise<Snapshot> | null = null;

function probeInitial(previous: Snapshot): Promise<Snapshot> {
  if (!initialProbe) {
    initialProbe = requestSnapshot(previous).finally(() => {
      initialProbe = null;
    });
  }
  return initialProbe;
}

/**
 * Never throws. `previous` matters for the transient cases: a network blip on
 * /auth/session while signed in must not downgrade the header to "Sign in" (the
 * cookie is still valid, and with a cookie present the login routes act in LINK
 * mode — a person "signing in as someone else" would attach that identity to the
 * existing account, and wallet sign-in is refused by purpose isolation, §7.3).
 */
async function requestSnapshot(previous: Snapshot): Promise<Snapshot> {
  const keepOrUnreachable = previous.status === "authenticated" ? previous : UNREACHABLE;

  const availability = await probeBackend();
  if (availability === "unconfigured") return UNAVAILABLE;
  if (availability === "unreachable") return keepOrUnreachable;

  let session: SessionResponse;
  try {
    session = await backendFetch<SessionResponse>("/api/v1/auth/session");
  } catch (err) {
    if (isBackendError(err, "backend_unconfigured")) return UNAVAILABLE;
    if (isTransientBackendError(err)) return keepOrUnreachable;
    return ANONYMOUS;
  }
  if (!session.authenticated) return ANONYMOUS;

  // /me is only worth fetching once the server says there is someone to describe.
  try {
    const me = await backendFetch<MeResponse>("/api/v1/me");
    return { status: "authenticated", me, user: me.user, sessionKind: session.kind, expiresAt: session.expiresAt };
  } catch (err) {
    // The session died between the two calls (revoked from another device, expired).
    if (isBackendError(err, "unauthenticated")) return ANONYMOUS;
    if (isBackendError(err, "backend_unconfigured")) return UNAVAILABLE;
    // Valid session, /me unavailable (GET /me reads the ledger — a hiccup is realistic).
    // Keep the last good /me for the same person when we have one; otherwise report the
    // session without it so the signed-in chrome, Sign out and a Retry still render.
    const sameUser = previous.status === "authenticated" && previous.me?.user.id === session.user.id;
    return {
      status: "authenticated",
      me: sameUser ? previous.me : null,
      user: sameUser && previous.me ? previous.me.user : session.user,
      sessionKind: session.kind,
      expiresAt: session.expiresAt,
    };
  }
}

function oidcReturnMessage(code: string | null): string {
  if (!code) return "Telegram sign-in did not complete. Try again.";
  return authCodeMessage(code) ?? `Telegram sign-in failed (${code}). Try again.`;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { account, signMessage } = useCantonWallet();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();

  // Until the first probe settles the public status is `loading`, whatever sits here.
  const [snapshot, setSnapshot] = useState<Snapshot>(ANONYMOUS);
  const [settled, setSettled] = useState(false);
  // Bumped on every applied probe so the timer effects re-arm after each one.
  const [probeCount, setProbeCount] = useState(0);
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginMode, setLoginMode] = useState<LoginMode>("login");
  const [reattachTarget, setReattachTarget] = useState<Identity | null>(null);
  const [promptParty, setPromptParty] = useState<string | null>(null);

  // Async handlers (link, sign-in) must see the wallet the person has NOW, not the one
  // captured when the handler was created — connect() resolves before React commits
  // the new account, so a closure over `account` would be one render behind.
  const accountRef = useRef(account);
  useEffect(() => {
    accountRef.current = account;
  }, [account]);

  const snapshotRef = useRef(snapshot);
  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Monotonic sequence: a probe's result is applied only if no newer probe has started
  // since. Two probes can otherwise resolve out of order (old one started, mutation,
  // new one, old one lands last) and the stale answer would overwrite the right one.
  const seqRef = useRef(0);
  const apply = useCallback((mySeq: number, next: Snapshot) => {
    if (!mountedRef.current || mySeq !== seqRef.current) return;
    // Synchronously, so a refresh() started in the same tick sees this probe's answer
    // as its `previous` rather than the one the effect has not mirrored yet.
    snapshotRef.current = next;
    setSnapshot(next);
    setSettled(true);
    setProbeCount((n) => n + 1);
  }, []);

  const refresh = useCallback(async () => {
    const mySeq = ++seqRef.current;
    apply(mySeq, await requestSnapshot(snapshotRef.current));
  }, [apply]);

  // First probe: deduped, so StrictMode's double mount is one request. The sequence
  // guard drops the first mount's copy of the (identical) result.
  useEffect(() => {
    const mySeq = ++seqRef.current;
    void probeInitial(snapshotRef.current).then((next) => apply(mySeq, next));
  }, [apply]);

  // A 401 anywhere (sessions revoked from another device, suspension, TTL) means the
  // signed-in chrome is stale. One re-probe per occurrence, only while we still think
  // we are signed in — anonymous flows can 401 legitimately and need no probe.
  const reprobePendingRef = useRef(false);
  useEffect(
    () =>
      onUnauthenticated(() => {
        if (snapshotRef.current.status !== "authenticated" || reprobePendingRef.current) return;
        reprobePendingRef.current = true;
        void refresh().finally(() => {
          reprobePendingRef.current = false;
        });
      }),
    [refresh],
  );

  // Re-probe when the server-side session lapses so the header does not keep showing a
  // signed-in state on a cookie that is already gone. If the server still reports an
  // expiresAt in the past (clock skew, a probe that raced the expiry) keep re-checking
  // on a short backoff instead of clamping once and stopping.
  useEffect(() => {
    if (snapshot.status !== "authenticated" || !snapshot.expiresAt) return;
    const delay = new Date(snapshot.expiresAt).getTime() - Date.now();
    if (!Number.isFinite(delay)) return;
    const wait = delay <= 0 ? UNREACHABLE_RETRY_MS : Math.min(delay, 2_147_000_000);
    const id = window.setTimeout(() => void refresh(), wait);
    return () => window.clearTimeout(id);
  }, [snapshot.status, snapshot.expiresAt, probeCount, refresh]);

  // A transient failure is retried on its own so a cold-started backend recovers
  // without the person reloading; probeCount re-arms the timer after each attempt.
  useEffect(() => {
    if (snapshot.status !== "unreachable") return;
    const id = window.setTimeout(() => void refresh(), UNREACHABLE_RETRY_MS);
    return () => window.clearTimeout(id);
  }, [snapshot.status, probeCount, refresh]);

  // OIDC return: the Telegram callback redirects to `returnTo?auth=ok|error&code=…`.
  // Strip the two params (router-aware replaceState, so useSearchParams readers agree
  // with the address bar), re-probe, and tell the person when it failed. Keyed on the
  // raw search string so StrictMode's second run of the effect (same deps, URL not yet
  // replaced) does not toast twice.
  const oidcHandledRef = useRef<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const outcome = params.get("auth");
    if (outcome !== "ok" && outcome !== "error") return;
    if (oidcHandledRef.current === location.search) return;
    oidcHandledRef.current = location.search;
    const code = params.get("code");
    params.delete("auth");
    params.delete("code");
    const search = params.toString();
    navigate({ pathname: location.pathname, search: search ? `?${search}` : "", hash: location.hash }, { replace: true });
    if (outcome === "ok") {
      void refresh();
    } else {
      toast({
        title: "Telegram sign-in failed",
        description: oidcReturnMessage(code),
        status: "error",
        duration: 8000,
        isClosable: true,
      });
    }
  }, [location.search, location.pathname, location.hash, navigate, refresh, toast]);

  const signOut = useCallback(async () => {
    try {
      await backendFetch<{ ok: true }>("/api/v1/auth/logout", { method: "POST" });
    } catch (err) {
      // The server revokes on its side and the cookie expires on its own, but the
      // person asked to leave NOW: show whatever state is actually left, then let the
      // caller say the request failed.
      await refresh();
      throw err;
    }
    await refresh();
  }, [refresh]);

  const status: AuthStatus = settled ? snapshot.status : "loading";
  const available = status !== "unavailable";
  const me = snapshot.me;
  const address = account?.address ?? null;
  const primaryPartyId = me ? (me.capabilities.primaryPartyId ?? me.user.partyId) : null;

  const connectedWalletState = useMemo<ConnectedWalletState>(() => {
    if (!address) return "none";
    if (!me) return "unlinked";
    if (me.user.partyId && me.user.partyId === address) return "primary";
    const row = me.wallets.find((w) => w.partyId === address && w.status === "active");
    return row ? "linked" : "unlinked";
  }, [address, me]);

  // States A and B (§16): the money rails key on the primary party. Everything else —
  // anonymous, unlinked (C), a session whose /me failed, no backend — is null, and the
  // components offer no deposit / withdraw at all.
  const accountParty =
    me !== null && primaryPartyId !== null && (connectedWalletState === "primary" || connectedWalletState === "linked")
      ? primaryPartyId
      : null;

  const openLogin = useCallback(
    (mode: LoginMode = "login", identity?: Identity) => {
      if (!available) return;
      if (mode === "reattach" && !identity) return;
      setLoginMode(mode);
      setReattachTarget(mode === "reattach" ? (identity ?? null) : null);
      setLoginOpen(true);
    },
    [available],
  );
  const closeLogin = useCallback(() => setLoginOpen(false), []);

  const linkConnectedWallet = useCallback(async () => {
    if (!available) throw new Error("Accounts are not available on this deployment.");
    const current = accountRef.current;
    if (!current?.address) throw new Error("Connect a wallet first.");
    await linkWallet({ partyId: current.address, publicKey: current.publicKey, signMessage });
    await refresh();
  }, [available, signMessage, refresh]);

  // The single "link this wallet?" prompt. Keyed on the connected party: shown once per
  // party per page load, only while signed in (with /me loaded — a degraded session
  // cannot tell whether the wallet is linked) with that party unlinked, and never on
  // top of the login dialog (whose own wallet option covers the same action).
  const promptedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (status !== "authenticated" || !me || !address || connectedWalletState !== "unlinked" || loginOpen) {
      setPromptParty(null);
      return;
    }
    if (promptedRef.current.has(address)) return;
    promptedRef.current.add(address);
    setPromptParty(address);
  }, [status, me, address, connectedWalletState, loginOpen]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      available,
      me,
      user: snapshot.user,
      sessionKind: snapshot.sessionKind,
      expiresAt: snapshot.expiresAt,
      connectedWalletState,
      primaryPartyId,
      accountParty,
      refresh,
      signOut,
      openLogin,
      closeLogin,
      loginOpen,
      linkConnectedWallet,
    }),
    [
      status,
      available,
      me,
      snapshot.user,
      snapshot.sessionKind,
      snapshot.expiresAt,
      connectedWalletState,
      primaryPartyId,
      accountParty,
      refresh,
      signOut,
      openLogin,
      closeLogin,
      loginOpen,
      linkConnectedWallet,
    ],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
      {/* Exactly one dialog for the whole app, whichever header/page opened it. */}
      {available ? (
        <LoginDialog open={loginOpen} mode={loginMode} reattach={reattachTarget} onClose={closeLogin} />
      ) : null}
      {promptParty ? (
        <LinkWalletPrompt
          partyId={promptParty}
          onLink={linkConnectedWallet}
          onDismiss={() => setPromptParty(null)}
        />
      ) : null}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

/**
 * The wallet ↔ account view every money component needs (§16 states A/B/C), derived
 * once here so InAppWalletCard, MarketView, PendingPayouts and WalletsSection cannot
 * drift apart on which party's UserWallet is spent from.
 */
export interface AccountWalletView {
  status: AuthStatus;
  /** /me when loaded (null for anonymous, unavailable, unreachable and a failed /me). */
  me: MeResponse | null;
  primaryPartyId: string | null;
  walletState: ConnectedWalletState;
  /** States A/B: the primary party the money rails key on. */
  accountParty: string | null;
  /** `accountParty !== null`. */
  accountMode: boolean;
  /** Anonymous with a backend present: deposits and withdrawals need an account — ask for sign-in. */
  signInRequired: boolean;
  /** Signed in with an UNLINKED wallet connected (state C): link before deposit/withdraw. */
  linkRequired: boolean;
  /**
   * Backend configured but not answering, or signed in without /me: the money rails
   * must pause — the backend is the only thing that credits or settles a UserWallet.
   */
  backendPaused: boolean;
}

export function useAccountWallet(): AccountWalletView {
  const auth = useAuth();
  const me = auth.status === "authenticated" ? auth.me : null;
  const walletState = me ? auth.connectedWalletState : "none";
  return {
    status: auth.status,
    me,
    primaryPartyId: me ? auth.primaryPartyId : null,
    walletState,
    accountParty: auth.accountParty,
    accountMode: auth.accountParty !== null,
    signInRequired: auth.status === "anonymous",
    linkRequired: me !== null && walletState === "unlinked",
    backendPaused: auth.status === "unreachable" || (auth.status === "authenticated" && me === null),
  };
}
