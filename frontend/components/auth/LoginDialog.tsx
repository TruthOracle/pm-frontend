/**
 * Sign-in / link / re-attach dialog: Google and Telegram (widget + OIDC).
 *
 * The account is the person, so the two identity providers are the only ways in
 * (ARCHITECTURE.md §6–§7; the Kalshi / Polymarket-US model). The Cantor8 wallet is not a
 * sign-in method: it is a signing key and funding rail that a signed-in person connects
 * and links afterwards, one popup per click (wallets/cantor8/popupGesture.ts). Operators
 * sign into /admin with their wallet through AdminGate, which is a separate flow.
 *
 * Rendered once by AuthProvider. The body is mounted only while open so every open
 * gets a fresh Google nonce and a fresh Telegram widget (both are single-shot on the
 * server side), and so the third-party scripts touch the DOM only when someone actually
 * asked to sign in. Same portal/backdrop pattern as WalletSelector, one z-index above
 * the fixed site header.
 *
 * "link" mode is the same dialog opened from the Account page: identical providers,
 * "Link …" labels; the server decides it is a link because a session cookie is present.
 * The response's `mode` is checked against what the person asked for — a lapsed cookie
 * would otherwise turn "add Google to my account" into "sign into a brand-new account"
 * without a word.
 *
 * "reattach" mode re-proves ONE unlinked identity of the account (§6.4): only that
 * identity's provider is shown and the credential goes to
 * POST /me/identities/:id/reattach instead of the login route (auth/reattach.ts).
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { useToast } from "@chakra-ui/react";
import { Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/auth/AuthContext";
import { renderGoogleButton, requestGoogleNonce, signInWithGoogle } from "@/auth/google";
import { mountTelegramWidget, signInWithTelegramWidget, startTelegramOidc } from "@/auth/telegram";
import { authErrorMessage } from "@/auth/wallet";
import { reattachIdentity } from "@/auth/reattach";
import { providerLabel } from "@/components/Account/accountUi";
import type { Identity, LoginMode, LoginResult } from "@/auth/types";
import { GOOGLE_CLIENT_ID, TELEGRAM_BOT_USERNAME, TELEGRAM_OIDC_ENABLED, WALLET_DISPLAY_NAME } from "@/config";

type Busy = null | "google" | "telegram";

export interface LoginDialogProps {
  open: boolean;
  mode: LoginMode;
  /** The unlinked identity being re-proved; required (and only read) in `reattach` mode. */
  reattach?: Identity | null;
  onClose: () => void;
}

export function LoginDialog({ open, mode, reattach, onClose }: LoginDialogProps) {
  if (!open) return null;
  if (mode === "reattach" && !reattach) return null;
  return createPortal(<LoginDialogBody mode={mode} reattach={reattach ?? null} onClose={onClose} />, document.body);
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      {children}
    </section>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])';

function LoginDialogBody({ mode, reattach, onClose }: { mode: LoginMode; reattach: Identity | null; onClose: () => void }) {
  const { refresh, signOut } = useAuth();
  const location = useLocation();
  const toast = useToast();
  const linking = mode === "link";
  const reattaching = mode === "reattach" && reattach !== null;

  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [googleReady, setGoogleReady] = useState(false);
  // A link-mode request that came back as a plain login (the session had lapsed):
  // offer the way out instead of leaving the person signed into the wrong account.
  const [driftedLogin, setDriftedLogin] = useState<LoginResult | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const googleRef = useRef<HTMLDivElement>(null);
  const telegramRef = useRef<HTMLDivElement>(null);

  // Latest callbacks for the third-party callbacks (GIS / Telegram call into us long
  // after the effect that registered them ran).
  const onCloseRef = useRef(onClose);
  const refreshRef = useRef(refresh);
  useEffect(() => {
    onCloseRef.current = onClose;
    refreshRef.current = refresh;
  }, [onClose, refresh]);

  // Escape must respect the same busy guard as the backdrop and the X button; the
  // keydown listener is registered once, so it reads the current value through a ref.
  const busyRef = useRef<Busy>(null);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  const provider = reattaching ? reattach.provider : null;
  const showGoogle = Boolean(GOOGLE_CLIENT_ID) && (provider === null || provider === "google");
  const showTelegramWidget = Boolean(TELEGRAM_BOT_USERNAME) && (provider === null || provider === "telegram");
  // OIDC is a full-page round trip through the login routes; a re-attach needs the
  // credential in-page, so only the widget can re-prove a Telegram identity.
  const showTelegramOidc = TELEGRAM_OIDC_ENABLED && provider === null;
  const showTelegram = showTelegramWidget || showTelegramOidc;
  const nothingConfigured = !showGoogle && !showTelegram;

  // Focus + Escape + a Tab trap (aria-modal alone does not keep keyboard focus inside),
  // and give focus back to whatever opened us.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (busyRef.current === null) onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const nodes = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialogRef.current.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, []);

  /**
   * What the server did versus what the person asked for. Returns the sentence to show
   * instead of closing, or null when the outcome matches the request.
   */
  const checkOutcome = (result: LoginResult): string | null => {
    const method = providerLabel(result.identity.provider);
    if (linking) {
      if (result.mode === "link") return null;
      setDriftedLogin(result);
      return result.created
        ? "Your session had expired, so instead of linking this to your account it created a NEW account and signed you into it. Sign out below, sign back into your original account, then link again."
        : "Your session had expired, so instead of linking this to your account it signed you in with it. If that is a different account, sign out below and sign into your original account first.";
    }
    if (result.mode === "link") {
      toast({
        title: "Already signed in",
        description: `You were still signed in, so ${method} was linked to that account instead of starting a new session.`,
        status: "info",
        duration: 8000,
        isClosable: true,
      });
    } else if (result.created) {
      // Naming the method is what stops the accidental second account next time.
      toast({
        title: `Account created with ${method}`,
        description: `Sign in with ${method} next time to get back to this account. Expected an existing account? Sign out and sign in with the method you used before — every method opens its own account until you link them under Account → Sign-in methods.`,
        status: "info",
        duration: 12000,
        isClosable: true,
      });
    }
    return null;
  };

  const finish = async (result: LoginResult | null) => {
    await refreshRef.current();
    const problem = result ? checkOutcome(result) : null;
    if (problem) {
      setError(problem);
      return false;
    }
    onCloseRef.current();
    return true;
  };

  const reattached = async () => {
    await refreshRef.current();
    toast({
      title: `${providerLabel(reattach!.provider)} sign-in re-attached`,
      status: "success",
      duration: 4000,
      isClosable: true,
    });
    onCloseRef.current();
  };

  // Google: nonce → button. Cleanup empties the container, so StrictMode's double
  // mount leaves exactly one button, bound to the second nonce.
  useEffect(() => {
    if (!showGoogle) return;
    const container = googleRef.current;
    if (!container) return;
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    void (async () => {
      try {
        const { nonce } = await requestGoogleNonce();
        if (cancelled) return;
        cleanup = await renderGoogleButton(container, {
          clientId: GOOGLE_CLIENT_ID,
          nonce,
          text: linking || reattaching ? "continue_with" : "signin_with",
          onCredential: async (credential) => {
            if (cancelled) return;
            setBusy("google");
            setError(null);
            try {
              if (reattaching) {
                await reattachIdentity(reattach, { credential, nonce });
                await reattached();
              } else {
                await finish(await signInWithGoogle(credential, nonce));
              }
            } catch (err) {
              if (!cancelled) setError(authErrorMessage(err));
            } finally {
              if (!cancelled) setBusy(null);
            }
          },
        });
        if (cancelled) cleanup();
        else setGoogleReady(true);
      } catch (err) {
        if (!cancelled) setError(authErrorMessage(err));
      }
    })();
    return () => {
      cancelled = true;
      cleanup?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showGoogle, linking, reattaching, reattach?.id]);

  // Telegram Login Widget. The global handler is registered before the script lands.
  useEffect(() => {
    if (!showTelegramWidget) return;
    const container = telegramRef.current;
    if (!container) return;
    let cancelled = false;
    const unmount = mountTelegramWidget(container, {
      botUsername: TELEGRAM_BOT_USERNAME,
      onAuth: async (user) => {
        if (cancelled) return;
        setBusy("telegram");
        setError(null);
        try {
          if (reattaching) {
            await reattachIdentity(reattach, user);
            await reattached();
          } else {
            await finish(await signInWithTelegramWidget(user));
          }
        } catch (err) {
          if (!cancelled) setError(authErrorMessage(err));
        } finally {
          if (!cancelled) setBusy(null);
        }
      },
    });
    return () => {
      cancelled = true;
      unmount();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showTelegramWidget, reattaching, reattach?.id]);

  const handleTelegramOidc = () => {
    setError(null);
    setBusy("telegram");
    // Full-page navigation; the return lands on this same path with ?auth=… which
    // AuthProvider handles.
    startTelegramOidc(mode === "link" ? "link" : "login", `${location.pathname}${location.search}`);
  };

  const handleDriftSignOut = async () => {
    setBusy("google");
    try {
      await signOut();
      onClose();
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const title = reattaching
    ? `Re-attach ${providerLabel(reattach.provider)}`
    : linking
      ? "Link a sign-in method"
      : "Sign in to TruthOracle";
  const subtitle = reattaching
    ? `Prove ${providerLabel(reattach.provider)} once more and it signs you into this account again. It stayed reserved for this account while unlinked.`
    : linking
      ? "Add another way to sign in to this account. Whatever you link here can sign you in on any device."
      : `One account keeps your ${WALLET_DISPLAY_NAME} wallets, in-app balance and identity verification together across devices. You connect your wallet after signing in, when you deposit or trade.`;

  return (
    <div
      className="fixed inset-0 z-[1100] flex items-center justify-center bg-white/35 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && busy === null) onClose();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-dialog-title"
        className="relative grid w-full max-w-md gap-4 rounded-xl border border-slate-200 bg-background p-6 shadow-lg outline-none"
      >
        <button
          type="button"
          onClick={onClose}
          disabled={busy !== null}
          className="absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 disabled:opacity-40"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        <div>
          <h2 id="login-dialog-title" className="text-lg font-semibold leading-snug text-slate-950">
            {title}
          </h2>
          <p className="mt-1 text-sm text-slate-600">{subtitle}</p>
          {reattaching && (
            <p className="mt-1 break-all font-mono text-[11px] text-slate-400">
              {reattach.email ?? reattach.profile.username ?? reattach.subject}
            </p>
          )}
        </div>

        {nothingConfigured ? (
          <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
            {reattaching
              ? `${providerLabel(reattach.provider)} sign-in is not configured on this deployment, so this method cannot be re-attached here.`
              : "No sign-in method is configured on this deployment, so nobody can sign in, deposit or trade. Set VITE_GOOGLE_CLIENT_ID and/or VITE_TELEGRAM_BOT_USERNAME (and the matching backend credentials)."}
          </p>
        ) : null}

        {showGoogle ? (
          <Section label={reattaching ? "Re-attach Google" : linking ? "Link Google" : "Google"}>
            {/* The placeholder overlays rather than sits beside the container so GIS
                measures the full width when it renders the button. */}
            <div className="relative flex min-h-[44px] items-center justify-center">
              <div ref={googleRef} className="w-full max-w-[400px]" />
              {!googleReady && !error ? (
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-slate-400">
                  Loading Google sign-in…
                </span>
              ) : null}
            </div>
          </Section>
        ) : null}

        {showTelegram ? (
          <Section label={reattaching ? "Re-attach Telegram" : linking ? "Link Telegram" : "Telegram"}>
            <div className="flex flex-col items-center gap-3">
              {showTelegramWidget ? <div ref={telegramRef} className="flex min-h-[40px] justify-center" /> : null}
              {showTelegramOidc ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleTelegramOidc}
                  disabled={busy !== null}
                  className="w-full rounded-lg border-slate-200 text-slate-800"
                >
                  <Send className="h-4 w-4" />
                  {busy === "telegram" ? "Opening Telegram…" : linking ? "Link with Telegram" : "Continue with Telegram"}
                </Button>
              ) : null}
            </div>
          </Section>
        ) : null}

        {!reattaching && !nothingConfigured ? (
          <p className="text-xs text-slate-500">
            By continuing you create or open your TruthOracle account. Your {WALLET_DISPLAY_NAME} wallet is connected
            and linked afterwards — two separate wallet prompts, when you first deposit or trade.
          </p>
        ) : null}

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
            {error}
            {driftedLogin ? (
              <div className="mt-2">
                <Button type="button" variant="outline" size="sm" onClick={() => void handleDriftSignOut()} disabled={busy !== null}>
                  Sign out
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
