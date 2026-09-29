/**
 * TypeScript shapes of the accounts backend (truthoracle-backend/docs/API.md, v1).
 *
 * Kept verbatim from the contract so it documents what the wire carries; nothing
 * validates it at runtime (`backendFetch` returns `data as T`), so a drift shows up
 * wherever a component first reads the missing field. Money is a STRING with exactly
 * ten decimals — never do arithmetic on it with `Number`; format it through
 * `accountUi.fmtMoney` / test it with `moneyIsPositive`.
 */

export type Money = string; // "0.0000000000"

/**
 * Every stable error code the backend (ARCHITECTURE.md §11 / API.md) or the relay can
 * put in `{ error }`, plus the two the fetch wrapper synthesises itself. Typing the
 * sentence tables with this union turns a misspelt code into a compile error.
 */
export type BackendErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "csrf_rejected"
  | "rate_limited"
  | "user_suspended"
  | "identity_already_linked"
  | "identity_unlinked"
  | "last_identity"
  | "identity_locked_by_kyc"
  /** Google ID token / nonce could not be verified (401). */
  | "invalid_credential"
  /** Telegram OIDC callback refused; arrives as `?auth=error&code=oidc_failed`. */
  | "oidc_failed"
  | "wallet_already_linked"
  | "wallet_key_mismatch"
  | "signature_invalid"
  | "challenge_rejected"
  | "challenge_purpose_mismatch"
  | "no_primary_wallet"
  | "primary_wallet_in_use"
  | "deposit_in_progress"
  | "deposit_attribution_drift"
  | "payout_not_found"
  | "payout_blocked"
  | "kyc_required"
  | "kyc_duplicate_identity"
  | "kyc_provider_unavailable"
  /** Sumsub webhook signature refused — server-to-server only, never seen by a browser. */
  | "webhook_rejected"
  // markets / orders (truthoracle-backend docs/MARKETS.md)
  | "trading_halted"
  | "market_not_tradable"
  | "no_in_app_wallet"
  | "no_position"
  | "insufficient_balance"
  | "insufficient_shares"
  | "quote_unavailable"
  | "catalog_conflict"
  | "validation_failed"
  | "bad_request"
  | "not_found"
  | "payload_too_large"
  | "unsupported_media_type"
  | "upstream_failed"
  /** `GET /health/ready` while a dependency check fails or the process drains. */
  | "not_ready"
  | "internal_error"
  /** Relay (api/proxy/backend.mjs): no BACKEND_URL on this deployment. */
  | "backend_unconfigured"
  /** Relay: BACKEND_URL is set but the backend did not answer. */
  | "backend_unreachable"
  /** Synthesised by backendFetch: fetch() itself rejected. */
  | "network_error"
  /** Synthesised by backendFetch: a 2xx with a non-JSON body. */
  | "invalid_response";
export type KycStatus = "none" | "pending" | "approved" | "rejected" | "blocked_duplicate";
export type IdentityProvider = "google" | "telegram" | "canton_wallet";

export interface User {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  email: string | null;
  status: "active" | "suspended" | "closed";
  kycStatus: KycStatus;
  partyId: string | null;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface Identity {
  id: string;
  provider: IdentityProvider;
  subject: string;
  email: string | null;
  profile: { name?: string; username?: string; picture?: string; hd?: string };
  status: "active" | "unlinked";
  verifiedAt: string;
  lastUsedAt: string | null;
  /** Cannot be unlinked while the KYC approval stands. */
  kycLocked: boolean;
}

export interface LedgerWallet {
  contractId: string;
  owner: string;
  balanceCC: Money;
  depositedCC: Money;
  withdrawnCC: Money;
}

export interface Wallet {
  id: string;
  chain: "canton";
  kind: "cantor8";
  partyId: string;
  label: string | null;
  isPrimary: boolean;
  status: "active" | "revoked";
  verifiedAt: string;
  creditedCC: Money;
  /** Only present in GET /in-app-wallet. */
  receivedCC?: Money;
  /**
   * A non-primary party's own on-ledger UserWallet. Null for the primary wallet and for
   * nearly every other one: the backend creates UserWallets only for an account's primary
   * party. The one exception (ARCHITECTURE §18) is an in-app payout (`bond` /
   * `model-prize`) settled to a party that traded with its own key — that wallet is
   * shown here and never folded into the account's balance.
   */
  ownLedgerWallet: LedgerWallet | null;
}

export interface KycVerification {
  id: string;
  provider: "mock" | "sumsub" | "admin";
  levelName: string;
  attemptNo: number;
  status:
    | "initiated"
    | "pending"
    | "needs_review"
    | "approved"
    | "rejected_retry"
    | "rejected_final"
    | "blocked_duplicate"
    | "expired";
  rejectLabels: string[];
  moderationComment: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export interface KycSummary {
  /** null = not configured. */
  provider: "mock" | "sumsub" | null;
  status: KycStatus;
  levelName: string;
  requiredForWithdrawal: boolean;
  attachedIdentityId: string | null;
  verification: KycVerification | null;
}

export interface Capabilities {
  canDeposit: boolean;
  canWithdraw: boolean;
  kycRequiredForWithdrawal: boolean;
  primaryPartyId: string | null;
  isAdmin: boolean;
}

export interface Session {
  id: string;
  kind: "user" | "admin";
  authMethod: IdentityProvider;
  identityId: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string | null;
  ip: string | null;
  userAgent: string | null;
  current: boolean;
}

export interface Payout {
  pendingPayoutCid: string;
  payeeParty: string;
  walletId: string | null;
  amountCC: Money;
  reason: string;
  status:
    | "queued"
    | "settling"
    | "settled_external"
    | "settled_in_app"
    | "blocked_kyc"
    | "blocked_unknown_user"
    | "blocked_unknown_reason"
    | "blocked_wallet_revoked"
    | "failed"
    | "archived";
  retryAfterKyc: boolean;
  attempts: number;
  lastError: string | null;
  firstSeenAt: string;
  settledAt: string | null;
  /** Still an active PendingPayout contract. */
  onLedger: boolean;
}

export interface LoginResult {
  /** "link" when a session was present. */
  mode: "login" | "link";
  user: User;
  kind: "user" | "admin";
  expiresAt: string;
  /** The identity that authenticated / was linked. */
  identity: Identity;
  /** A new account was created. */
  created: boolean;
  /** Only for client = "native". */
  token?: string;
}

export interface AuditEvent {
  id: string;
  actorType: "user" | "admin" | "system";
  actorUserId: string | null;
  action: string;
  subjectType: string;
  subjectId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Route-specific responses the auth module exchanges with the backend.
// ---------------------------------------------------------------------------

/** GET /auth/session */
export type SessionResponse =
  | { authenticated: false }
  | { authenticated: true; kind: "user" | "admin"; user: User; expiresAt: string };

/** GET /me */
export interface MeResponse {
  user: User;
  identities: Identity[];
  wallets: Wallet[];
  kyc: KycSummary;
  capabilities: Capabilities;
}

/** POST /auth/google/nonce */
export interface GoogleNonceResponse {
  nonce: string;
  expiresAt: string;
}

/** POST /auth/wallet/challenge and POST /wallets/link-challenge */
export interface WalletChallenge {
  challengeId: string;
  message: string;
  expiresAt: string;
}

/**
 * Wallets are not a user sign-in method: a challenge either links a wallet to the
 * signed-in account (`link-wallet`, POST /wallets/link-challenge) or signs an operator
 * into the admin API (`admin-sign-in`, POST /auth/admin/challenge — the backend admin
 * flow; the /admin page in this app uses its own nonce route).
 */
export type WalletChallengePurpose = "link-wallet" | "admin-sign-in";

/** POST /wallets/link — a wallet row only; linking creates no identity (§8.1). */
export interface WalletLinkResult {
  wallet: Wallet;
}

/**
 * What the Telegram Login Widget hands to `onTelegramAuth` — forwarded to
 * POST /auth/telegram/widget as-is (the backend verifies `hash` over the other fields).
 */
export interface TelegramWidgetUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

// ---------------------------------------------------------------------------
// Context shapes (frontend/auth/AuthContext.tsx)
// ---------------------------------------------------------------------------

/**
 * `unavailable`  the relay answered 503 backend_unconfigured: accounts do not exist on
 *                this deployment, so there are no deposits or withdrawals either — the
 *                app is read + wallet-signed trading only.
 * `unreachable`  a backend IS configured but the last probe could not reach it (502
 *                backend_unreachable, network error, 5xx). Sign-in is offered but
 *                disabled and the money rails pause until it answers.
 * `loading`      lasts only until the first probe settles; children render throughout.
 */
export type AuthStatus = "unavailable" | "unreachable" | "loading" | "anonymous" | "authenticated";

/**
 * The connected external wallet (Cantor8 account) compared with the account's wallets:
 *  none      no wallet connected
 *  primary   the connected party is `user.partyId` (deposit, trade, withdraw)
 *  linked    an active non-primary wallet of this account (deposit-only)
 *  unlinked  connected, but not an active wallet of this account (or no account at all)
 */
export type ConnectedWalletState = "none" | "primary" | "linked" | "unlinked";

/**
 * `login`     no session: sign in (or create an account).
 * `link`      session present: attach another sign-in method to it.
 * `reattach`  re-attach one of the account's UNLINKED identities with a fresh proof
 *             (POST /me/identities/:id/reattach, §6.4); the dialog shows only that
 *             identity's provider.
 */
export type LoginMode = "login" | "link" | "reattach";

export interface AuthContextValue {
  status: AuthStatus;
  /** False when status is `unavailable` — hide every account affordance. */
  available: boolean;
  /**
   * GET /me, or null. Null while `authenticated` means the session is valid but /me
   * could not be loaded (ledger hiccup, 5xx): keep the signed-in chrome, pause the
   * money rails, offer Retry — never treat it as anonymous.
   */
  me: MeResponse | null;
  /** From /me when loaded, else from /auth/session — set whenever `authenticated`. */
  user: User | null;
  sessionKind: "user" | "admin" | null;
  expiresAt: string | null;
  connectedWalletState: ConnectedWalletState;
  /** `capabilities.primaryPartyId ?? user.partyId` from /me; null without /me. */
  primaryPartyId: string | null;
  /**
   * The party whose UserWallet the money rails key on — non-null exactly in states A
   * and B of §16 (connected wallet is the primary, or an active linked wallet). Null
   * for anonymous, unlinked (state C), degraded and unavailable.
   */
  accountParty: string | null;
  /**
   * Re-probe the session and /me. Always a fresh request with a monotonic sequence:
   * the result of an older probe never overwrites a newer one, so calling this right
   * after login / link / logout reflects that mutation. Never throws.
   */
  refresh(): Promise<void>;
  /** POST /auth/logout, then refresh. Rethrows when the logout request itself failed. */
  signOut(): Promise<void>;
  /** `reattach` needs the unlinked identity the dialog is re-proving. */
  openLogin(mode?: LoginMode, identity?: Identity): void;
  closeLogin(): void;
  loginOpen: boolean;
  /**
   * Link the currently connected external wallet to the signed-in account:
   * link-challenge → wallet.signMessage → POST /wallets/link → refresh.
   * Throws the raw error (BackendError or the wallet's); translate with
   * `authErrorMessage` at the call site.
   */
  linkConnectedWallet(): Promise<void>;
}
