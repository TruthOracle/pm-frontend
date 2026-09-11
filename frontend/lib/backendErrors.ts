/**
 * One code → sentence table for the accounts backend (ARCHITECTURE.md §11).
 *
 * The server's codes are stable tokens meant for logs; the person at the screen needs
 * a complete sentence that says what to do next. Every flow-specific translator
 * (`authErrorMessage`, `accountErrorMessage`, `moneyErrorMessage`, `kycErrorMessage`)
 * is a thin wrapper that passes an override map for the codes whose meaning depends on
 * what was attempted — "last_identity" reads differently when unlinking a wallet than
 * when unlinking a Google sign-in — and everything else falls through to here.
 *
 * Keys are typed with `BackendErrorCode` so a misspelt code is a compile error instead
 * of a dead branch.
 */
import { BackendError } from "@/lib/backend";
import type { BackendErrorCode } from "@/auth/types";

export type ErrorSentences = Partial<Record<BackendErrorCode, string>>;

export const SESSION_EXPIRED_SENTENCE = "Your session has expired. Sign in again to continue.";
export const BACKEND_UNREACHABLE_SENTENCE =
  "Could not reach the accounts service. Check your connection and try again in a moment.";
export const RATE_LIMITED_SENTENCE = "Too many attempts. Wait a minute and try again.";

/**
 * The one sentence a duplicate ever sees. It deliberately names no account, email
 * or wallet: telling a user WHICH account already holds their identity would turn
 * the check into a lookup oracle (§9.3).
 */
export const KYC_DUPLICATE_SENTENCE =
  "This identity is already verified on another TruthOracle account. Contact support.";

const BASE: ErrorSentences = {
  unauthenticated: SESSION_EXPIRED_SENTENCE,
  forbidden: "This account is not allowed to do that.",
  csrf_rejected: "The request was refused as a cross-site call. Reload the page and try again.",
  rate_limited: RATE_LIMITED_SENTENCE,
  identity_already_linked:
    "This sign-in method already belongs to another account. Sign out and sign in with it directly, or use a different one.",
  identity_unlinked:
    "This sign-in method was unlinked from its account. Sign in another way, then re-attach it under Account → Sign-in methods → Unlinked methods.",
  last_identity: "This is the account's only sign-in method. Add another one before removing it.",
  identity_locked_by_kyc:
    "This sign-in method is attached to the account's identity verification and cannot be removed while the approval stands.",
  invalid_credential: "The Google sign-in could not be verified. Try signing in again.",
  oidc_failed: "Telegram sign-in did not complete. Start it again from this page.",
  wallet_already_linked:
    "This wallet is already linked to another account. Sign in with that account, or connect a different wallet.",
  wallet_key_mismatch:
    "This wallet's signing key is not its namespace key, so the signature cannot be tied to the party. " +
    "Parties with a rotated key, or allocated under a participant namespace, cannot be linked yet.",
  signature_invalid:
    "The signature could not be verified for this wallet. Approve the message with the connected party and try again.",
  challenge_rejected: "The wallet challenge expired or was already used. Try again.",
  challenge_purpose_mismatch: "The wallet challenge did not match this action. Try again.",
  no_primary_wallet: "Your account has no primary wallet yet. Link a wallet on the Account page first.",
  primary_wallet_in_use:
    "Your primary wallet can't change once you have deposited or have a withdrawal in progress.",
  deposit_in_progress:
    "Another deposit is still being credited. Your transfer is safe — check the balance again in a moment.",
  deposit_attribution_drift:
    "The deposit could not be credited automatically because the treasury's records and your wallet disagree. Your CC is safe — support has been notified and will credit it manually.",
  payout_not_found: "The server hasn't picked up this payout yet. It settles automatically within a minute.",
  payout_blocked: "This payout cannot be settled right now.",
  kyc_required: "Identity verification is required before you can withdraw.",
  kyc_duplicate_identity: KYC_DUPLICATE_SENTENCE,
  kyc_provider_unavailable: "Verification is not available yet.",
  user_suspended: "This account is suspended. Contact support if you think that is a mistake.",
  validation_failed: "Some of the details are missing or in the wrong format.",
  // `bad_request` deliberately has no sentence: the backend uses it with a per-site
  // message ("verification is approved; start a new session") that says more than a
  // generic line could, so the server's words fall through. `webhook_rejected` is
  // server-to-server only and never reaches a browser.
  not_found: "That record no longer exists. Reload the page and try again.",
  payload_too_large: "The request was too large to send. Try again with less data.",
  unsupported_media_type: "The request was sent in a format the accounts service does not accept. Reload the page and try again.",
  upstream_failed: "A service we depend on did not answer. Try again in a moment.",
  not_ready: "The accounts service is starting up. Try again in a moment.",
  internal_error: "The accounts service hit an unexpected error. Try again in a moment.",
  backend_unconfigured: "Accounts are not enabled on this deployment.",
  backend_unreachable: BACKEND_UNREACHABLE_SENTENCE,
  network_error: BACKEND_UNREACHABLE_SENTENCE,
  invalid_response: "The accounts service returned an unexpected response. Try again in a moment.",
};

/** The sentence for a code alone (null when neither the overrides nor the base table know it). */
export function backendCodeMessage(code: string, overrides?: ErrorSentences): string | null {
  const key = code as BackendErrorCode;
  return overrides?.[key] ?? BASE[key] ?? null;
}

/**
 * One sentence for whatever a backend call threw. `BackendError.message` is always a
 * non-empty string (backendFetch guarantees it), so the server's own wording is the
 * fallback for codes the tables do not name; a plain Error is passed through.
 */
export function backendErrorMessage(e: unknown, overrides?: ErrorSentences): string {
  if (e instanceof BackendError) return backendCodeMessage(e.code, overrides) ?? e.message;
  return e instanceof Error ? e.message : String(e ?? "");
}

/** A transient failure worth retrying automatically, as opposed to a definitive answer. */
export function isTransientBackendError(e: unknown): boolean {
  if (!(e instanceof BackendError)) return false;
  if (
    e.code === "network_error" ||
    e.code === "backend_unreachable" ||
    e.code === "upstream_failed" ||
    e.code === "not_ready"
  ) {
    return true;
  }
  return e.status >= 500 && e.code !== "backend_unconfigured";
}

/**
 * Account-management flavour (Me / Wallets routes): the base sentences with the
 * section's own overrides layered on top — "last_identity" reads differently when
 * unlinking a wallet than when unlinking a Google sign-in.
 */
export function accountErrorMessage(e: unknown, overrides?: ErrorSentences): string {
  return backendErrorMessage(e, overrides);
}
