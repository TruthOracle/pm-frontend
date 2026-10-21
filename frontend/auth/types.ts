/**
 * TypeScript shapes of the accounts backend (truthoracle-backend/docs/API.md, v1).
 *
 * Kept verbatim from the contract so it documents what the wire carries; nothing
 * validates it at runtime (`backendFetch` returns `data as T`), so a drift shows up
 * wherever a component first reads the missing field. Money is a STRING with exactly
 * ten decimals — never do arithmetic on it with `Number`; format it through
 * `formatAmount` (lib/instruments.ts, next to the instrument it is in) and test it
 * with `moneyIsPositive`.
 */

import type { InstrumentRef } from "@/lib/instruments";

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
  /** Reconcile refused because the ledger index lags the ledger end (503); transient, retried by the caller. */
  | "ledger_stale"
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
  /** 409 from `POST /admin/markets/:id/resolution` (review F0); `details.reason` names the check, `details.opensAt` / `closedAt` / `cid` / `sources` where they apply. */
  | "market_not_resolvable"
  | "no_in_app_wallet"
  | "no_position"
  | "insufficient_balance"
  | "insufficient_shares"
  | "quote_unavailable"
  | "catalog_conflict"
  /** `POST /admin/instruments` for an (admin, id) pair the catalog already has (409). */
  | "instrument_exists"
  /** A registry-mode treasury transfer finds too few unlocked holdings in the index (409). */
  | "insufficient_treasury_holdings"
  // BYN ramp — buy by card / ERIP, cash out to card / bank (truthoracle-backend docs/RAMP.md, API §12.1)
  | "ramp_unavailable"
  /** A runtime halt of new orders (503); orders in flight continue. */
  | "ramp_paused"
  /** 403; `details.reasons` — every compliance reason arrives as `compliance`. */
  | "ramp_not_eligible"
  /** 409; `details.limit` (daily | monthly | bank_first_payout), `details.available`, `details.max` (bank_first_payout). */
  | "ramp_limit_exceeded"
  | "ramp_quote_changed"
  /** 409; `details.orderId` = the order that waits for the person. */
  | "ramp_order_open"
  | "ramp_order_state"
  /** 409; card-bought value inside the dispute window: `details.withdrawableToBank`. */
  | "ramp_exposure"
  /** 409; more than the card's purchases can still refund: `details.available`. */
  | "ramp_card_cashout_limit"
  /** 409; `details.rail`, and for a bank account not usable yet `details.reason` (`bank_account_<status>` | `bank_blocked`) + `usableFrom`. */
  | "ramp_rail_unavailable"
  /** 409; an Idempotency-Key replayed with a different request. */
  | "idempotency_key_reused"
  | "bank_account_invalid"
  | "bank_account_exists"
  | "bank_account_limit"
  /** 409; a payout to the account is still in flight. */
  | "bank_account_in_use"
  /** 401; adding a payout account needs a sign-in within the last 15 minutes. */
  | "recent_auth_required"
  | "kyc_identity_unavailable"
  // money and token-app internals (operator console; lib/rampAdminErrors.ts words them)
  | "instrument_unknown"
  | "instrument_disabled"
  | "token_app_unauthorized"
  | "token_app_forbidden"
  | "token_app_invalid_request"
  | "token_app_cap"
  | "token_command_conflict"
  | "token_command_state"
  // ramp controls and four-eyes approvals (operator console, docs/RAMP.md §6)
  | "reserve_gate"
  | "payout_gate"
  /** 403; `details.role` names the operator role the route needs. */
  | "role_required"
  | "approval_pending"
  | "approval_not_pending"
  | "approval_expired"
  | "approval_self"
  | "approval_same_person"
  | "approval_linked_person"
  /** 409: a conflict of interest; `details.reason` names it (`position_in_market`: the person holds a position in the market being resolved), `details.person` who. */
  | "approval_conflict"
  | "approval_role_required"
  | "approval_signature_required"
  | "approval_signature_invalid"
  | "approval_precondition_changed"
  | "approval_failed"
  | "ramp_card_state"
  /** 409: the webhook event was applied or closed meanwhile (replay / close, C31). */
  | "ramp_event_state"
  // bank rail: payout batches, statements, lines (operator console, docs/RAMP.md §10)
  | "batch_state"
  | "batch_held"
  | "batch_export_mismatch"
  | "statement_invalid"
  | "statement_account"
  | "statement_duplicate"
  | "statement_continuity"
  | "statement_mismatch"
  | "bank_line_state"
  // compliance: alerts, exports, screening, freezes (operator console, docs/RAMP.md §11)
  | "compliance_alert_state"
  | "export_range"
  | "screening_list_invalid"
  | "screening_list_exists"
  | "screening_hit_state"
  | "screening_hits_open"
  | "rescreen_running"
  | "freeze_active"
  | "freeze_state"
  | "validation_failed"
  | "bad_request"
  | "not_found"
  | "payload_too_large"
  | "unsupported_media_type"
  | "upstream_failed"
  /** Cantor8's token-app (mint / burn) is not configured on this backend (503). */
  | "token_app_unconfigured"
  /** `GET /health/ready` while a dependency check fails or the process drains. */
  | "not_ready"
  | "internal_error"
  /** Relay (api/proxy/backend.mjs): no BACKEND_URL on this deployment. */
  | "backend_unconfigured"
  /** Relay: BACKEND_URL is set but the backend did not answer. */
  | "backend_unreachable"
  /** Relay (413): the request body is above the relay's cap for that route. */
  | "body_too_large"
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

/**
 * An on-ledger `UserWallet` as the index sees it. There is one per (owner, instrument)
 * (docs/TOKENS.md §2.1): a party holds its collateral balance and its TRO balance in two
 * contracts, and a market only ever debits or credits the wallet of its own collateral.
 */
export interface LedgerWallet {
  contractId: string;
  owner: string;
  instrument: InstrumentRef;
  balance: Money;
  deposited: Money;
  withdrawn: Money;
  /** Refs already applied — deposit credits and reward grants — newest first. */
  creditRefs: string[];
}

/** Deposits from one linked wallet credited to the account's in-app balance, per instrument. */
export interface WalletCredit {
  instrument: InstrumentRef;
  credited: Money;
  /** Only present in GET /in-app-wallet: what the ledger index shows received from this party in this instrument. */
  received?: Money;
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
  /** One entry per instrument this wallet was ever credited in (the only attribution — nothing predates the backend); empty until the first deposit. */
  credits: WalletCredit[];
  /**
   * A non-primary party's own on-ledger UserWallets, one per instrument. Empty for the
   * primary wallet and for nearly every other one: the backend creates UserWallets only
   * for an account's primary party. The one exception (ARCHITECTURE §18) is an in-app
   * payout (`bond` / `model-prize`) settled to a party that traded with its own key —
   * those wallets are shown here and never folded into the account's balance.
   */
  ownLedgerWallets: LedgerWallet[];
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

/** Every `to_payouts.status`: what an operator sees (`GET /admin/payouts`). */
export type PayoutStatus =
  | "queued"
  | "settling"
  | "settled_external"
  | "settled_in_app"
  | "blocked_kyc"
  | "blocked_unknown_user"
  | "blocked_unknown_reason"
  | "blocked_wallet_revoked"
  /** Card-bought value still inside the card dispute window (docs/RAMP.md §9.3): settles by itself as that ends. */
  | "blocked_ramp_exposure"
  /** Held by a compliance decision or freeze (§11.6); the payee sees `processing`. */
  | "blocked_compliance"
  /** A cash-out's MarkPaid deferred by the payout gate (§6.4); retried until it passes; the payee sees `processing`. */
  | "blocked_payout_gate"
  | "failed"
  | "archived";

/**
 * What the PAYEE sees (`GET /in-app-wallet[/payouts]`, settle): every internal hold — a freeze, a
 * compliance review, the payout gate — is the one neutral `processing` (C8 / C11, no tipping-off).
 */
export type UserPayoutStatus = PayoutStatus | "processing";

export interface Payout {
  pendingPayoutCid: string;
  payeeParty: string;
  walletId: string | null;
  /** The instrument the payout is in: the market's collateral for bonds and prizes, the wallet's for a withdrawal. */
  instrument: InstrumentRef;
  amount: Money;
  reason: string;
  status: UserPayoutStatus;
  retryAfterKyc: boolean;
  attempts: number;
  /** The payee's view: null, except a fixed neutral sentence for `failed` (never the raw error). */
  lastError: string | null;
  firstSeenAt: string;
  settledAt: string | null;
  /** Still an active PendingPayout contract. */
  onLedger: boolean;
  /** The ramp cash-out this withdrawal was bound to, when the backend reports it (links the order page). */
  offrampOrderId?: string | null;
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
   * The party whose UserWallets the money rails key on — non-null exactly in states A
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
