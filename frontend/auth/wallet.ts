/**
 * Cantor8 wallet proofs — the browser half of the challenge-signature flow
 * (ARCHITECTURE.md §7.3 / §8.1).
 *
 * The wallet popup proves control of a party by signing a server-issued message; the
 * server checks that the key fingerprints to the party's namespace and that the
 * signature verifies. Nothing security-relevant is decided here — this module only
 * drives the handshake and reports what the server said. Errors are rethrown UNCHANGED
 * (the BackendError with its code, or the wallet's own rejection) so the call site can
 * translate them with `authErrorMessage` and still branch on the code.
 * The public key IS sent (unlike lib/adminSession.ts): the accounts backend binds
 * it to the party cryptographically instead of pinning it in env.
 *
 * Popup discipline (wallets/cantor8/popupGesture.ts): the wallet opens one popup per
 * click and the SDK call must be the first thing the click awaits. The flow is therefore
 * split in three so callers can fetch the challenge BEFORE the click:
 *   requestLinkChallenge(partyId)  →  signChallenge(challenge, …)  →  submitWalletLink(proof)
 * `linkWallet` composes the three for callers that have no prefetched challenge (it is
 * fine in Chrome and Firefox, whose 5 s activation window covers the round trip).
 */
import { backendFetch } from "@/lib/backend";
import { backendCodeMessage, backendErrorMessage, type ErrorSentences } from "@/lib/backendErrors";
import { isWalletPopupBlocked } from "@/wallets/cantor8/popupGesture";
import type { WalletChallenge, WalletLinkResult } from "./types";

export type SignMessage = (message: string, partyId?: string) => Promise<string>;

/** Wording that only makes sense while linking a wallet (the base table covers the rest). */
const AUTH_SENTENCES: ErrorSentences = {
  primary_wallet_in_use:
    "This wallet is the account's primary wallet and already holds a deposit, so it cannot be changed.",
  backend_unconfigured: "Accounts are not available on this deployment.",
  challenge_rejected: "The wallet challenge expired or was already used. Try again.",
};

/**
 * Sentence for a bare code (the OIDC return lands with `?auth=error&code=…`, no
 * BackendError to hand over). Null for a code no table knows.
 */
export function authCodeMessage(code: string): string | null {
  return backendCodeMessage(code, AUTH_SENTENCES);
}

/** One sentence for whatever a sign-in / link flow threw. */
export function authErrorMessage(err: unknown): string {
  // Translated by Cantor8WalletContext; its sentence already says what to do.
  if (isWalletPopupBlocked(err)) return err.message;
  const message = backendErrorMessage(err, AUTH_SENTENCES);
  // The Cantor8 popup rejects with its own reason when the person closes it or presses
  // Reject ("User rejected the request", code USER_REJECTED).
  if (/cancel|rejected/i.test(message)) return "The wallet request was declined before a signature was produced.";
  if (/timed out/i.test(message)) return "The wallet did not answer in time. Open it and try again.";
  // Closing the popup mid-handshake, or the SDK tearing its transport down, reaches us as
  // internal wording ("Popup closed before handshake", "Transport destroyed"). Say what
  // the person actually has to do instead of quoting the SDK.
  if (/popup closed|transport destroyed|handshake/i.test(message)) {
    return "The wallet window closed before it answered. Open it again and approve the request.";
  }
  return message || "Something went wrong. Try again.";
}

/**
 * Same key-exposure precondition for every proof: the backend verifies the key against
 * the party's namespace fingerprint, so without it there is nothing to check.
 */
export function requireWalletPublicKey(publicKey: string | undefined): string {
  if (publicKey) return publicKey;
  throw new Error(
    "Your wallet did not expose its public key, so the signature cannot be tied to the party. " +
      "Reconnect the wallet (Cantor8 0.5 or newer) and try again.",
  );
}

/**
 * How long a prefetched challenge is reused before a fresh one is fetched.
 *
 * Measured from the LOCAL moment of receipt, never from the server's absolute
 * `expiresAt`: a browser clock that is minutes off would otherwise make every challenge
 * look permanently fresh (so the popup signs a challenge the server has already dropped)
 * or permanently stale (so every click falls back to fetch-then-sign, which is the path
 * WebKit blocks). Elapsed local time is the only clock-skew-free measure available, and
 * two minutes sits well inside the server's five-minute TTL.
 */
export const CHALLENGE_REUSE_MS = 120_000;

/** A challenge together with the local time it arrived. */
export interface HeldChallenge {
  challenge: WalletChallenge;
  /** `Date.now()` at receipt. */
  receivedAt: number;
}

/** True while the held challenge is worth signing without fetching a new one. */
export function challengeIsFresh(held: HeldChallenge, now: number = Date.now()): boolean {
  const age = now - held.receivedAt;
  // A negative age means the clock moved backwards since receipt; treat it as stale.
  return Number.isFinite(age) && age >= 0 && age < CHALLENGE_REUSE_MS;
}

/**
 * Step 1 — a session-bound `link-wallet` challenge for `partyId` (§8.1). Single-use and
 * short-lived (5 min server side); fetch it before the click and hand it to
 * `signChallenge`.
 */
export function requestLinkChallenge(partyId: string): Promise<WalletChallenge> {
  return backendFetch<WalletChallenge>("/api/v1/wallets/link-challenge", {
    method: "POST",
    body: { partyId },
  });
}

/**
 * Step 2 — the popup. The message is signed verbatim (raw UTF-8): the server regenerates
 * it from the stored challenge, so any client-side reformatting would fail verification.
 * Blocks on a human: the popup asks the person to approve.
 */
export async function signChallenge(
  challenge: WalletChallenge,
  partyId: string,
  signMessage: SignMessage,
): Promise<string> {
  const signature = await signMessage(challenge.message, partyId);
  if (!signature) throw new Error("The wallet returned an empty signature.");
  return signature;
}

/** Body of POST /wallets/link and of a canton_wallet re-attach (API.md → Wallets / Me). */
export interface WalletProof {
  challengeId: string;
  partyId: string;
  publicKey: string;
  signature: string;
  kind: "cantor8";
}

export interface WalletProofArgs {
  partyId: string;
  publicKey: string | undefined;
  signMessage: SignMessage;
}

/**
 * Steps 2+3 for a challenge the caller already holds: sign it, then attach the wallet to
 * the signed-in account. Re-linking a party this account already had reactivates the old
 * row on the server.
 */
export async function linkWalletWithChallenge(
  challenge: WalletChallenge,
  args: WalletProofArgs & { label?: string },
): Promise<WalletLinkResult> {
  const publicKey = requireWalletPublicKey(args.publicKey);
  // First await = the popup. Nothing network-bound runs between the click and this line.
  const signature = await signChallenge(challenge, args.partyId, args.signMessage);
  return submitWalletLink(
    { challengeId: challenge.challengeId, partyId: args.partyId, publicKey, signature, kind: "cantor8" },
    args.label,
  );
}

/** Step 3 — exchange the signed proof for the wallet row. */
export function submitWalletLink(proof: WalletProof, label?: string): Promise<WalletLinkResult> {
  return backendFetch<WalletLinkResult>("/api/v1/wallets/link", {
    method: "POST",
    body: { ...proof, ...(label ? { label } : {}) },
  });
}

/**
 * Fallback composition for a caller without a prefetched challenge: challenge → popup →
 * link. Prefer `linkWalletWithChallenge` from a click handler (see the header).
 */
export async function linkWallet(args: WalletProofArgs & { label?: string }): Promise<WalletLinkResult> {
  requireWalletPublicKey(args.publicKey);
  const challenge = await requestLinkChallenge(args.partyId);
  return linkWalletWithChallenge(challenge, args);
}
