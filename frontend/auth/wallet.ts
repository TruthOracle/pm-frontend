/**
 * Canton wallet sign-in / link — the browser half of the challenge-signature flow
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
 */
import { backendFetch } from "@/lib/backend";
import { backendCodeMessage, backendErrorMessage, type ErrorSentences } from "@/lib/backendErrors";
import type { LoginResult, WalletChallenge, WalletChallengePurpose, WalletLinkResult } from "./types";

export type SignMessage = (message: string, partyId?: string) => Promise<string>;

/** Wording that only makes sense while signing in / linking (the base table covers the rest). */
const AUTH_SENTENCES: ErrorSentences = {
  primary_wallet_in_use:
    "This wallet is the account's primary wallet and already holds a deposit, so it cannot be changed.",
  backend_unconfigured: "Accounts are not available on this deployment.",
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
  const message = backendErrorMessage(err, AUTH_SENTENCES);
  // The Cantor8 popup rejects with its own reason when the person closes it.
  if (/cancel/i.test(message)) return "The wallet request was cancelled before a signature was produced.";
  if (/timed out/i.test(message)) return "The wallet did not answer in time. Open it and try again.";
  return message || "Something went wrong. Try again.";
}

/**
 * Same key-exposure precondition for sign-in and link: the backend verifies the key
 * against the party's namespace fingerprint, so without it there is nothing to check.
 */
export function requireWalletPublicKey(publicKey: string | undefined): string {
  if (publicKey) return publicKey;
  throw new Error(
    "Your wallet did not expose its public key, so the signature cannot be tied to the party. " +
      "Reconnect the wallet (Cantor8 0.5 or newer) and try again.",
  );
}

async function signChallenge(challenge: WalletChallenge, partyId: string, signMessage: SignMessage): Promise<string> {
  // The message is signed verbatim (raw UTF-8) — the server regenerates it from the
  // stored challenge, so any client-side reformatting would fail verification.
  const signature = await signMessage(challenge.message, partyId);
  if (!signature) throw new Error("The wallet returned an empty signature.");
  return signature;
}

/** Body of POST /auth/wallet and of a canton_wallet re-attach (API.md → Auth). */
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
 * Challenge → popup → signed proof, without submitting it anywhere. Shared by sign-in
 * (`purpose: "sign-in"`) and identity re-attachment (`purpose: "link-wallet"`, which
 * the server issues only to a session — exactly the caller a re-attach has). Blocks
 * on a human: the popup asks the person to approve.
 */
export async function proveWallet(args: WalletProofArgs, purpose: WalletChallengePurpose): Promise<WalletProof> {
  const publicKey = requireWalletPublicKey(args.publicKey);
  const challenge = await backendFetch<WalletChallenge>("/api/v1/auth/wallet/challenge", {
    method: "POST",
    body: { partyId: args.partyId, purpose },
  });
  const signature = await signChallenge(challenge, args.partyId, args.signMessage);
  return { challengeId: challenge.challengeId, partyId: args.partyId, publicKey, signature, kind: "cantor8" };
}

/** Run the sign-in challenge and exchange the proof for a session. */
export async function signInWithWallet(args: WalletProofArgs & { purpose?: WalletChallengePurpose }): Promise<LoginResult> {
  const proof = await proveWallet(args, args.purpose ?? "sign-in");
  return backendFetch<LoginResult>("/api/v1/auth/wallet", { method: "POST", body: proof });
}

/**
 * Attach a wallet to the signed-in account (session-bound `link-wallet` challenge).
 * Re-linking a party this account already had reactivates the old row on the server.
 */
export async function linkWallet(args: WalletProofArgs & { label?: string }): Promise<WalletLinkResult> {
  const publicKey = requireWalletPublicKey(args.publicKey);
  const challenge = await backendFetch<WalletChallenge>("/api/v1/wallets/link-challenge", {
    method: "POST",
    body: { partyId: args.partyId },
  });
  const signature = await signChallenge(challenge, args.partyId, args.signMessage);
  return backendFetch<WalletLinkResult>("/api/v1/wallets/link", {
    method: "POST",
    body: {
      challengeId: challenge.challengeId,
      partyId: args.partyId,
      publicKey,
      signature,
      kind: "cantor8",
      ...(args.label ? { label: args.label } : {}),
    },
  });
}
