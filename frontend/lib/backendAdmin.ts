/**
 * The backend's operator API from the browser (truthoracle-backend docs/API.md "Admin — catalog",
 * ARCHITECTURE §7.4): an operator signs a one-time challenge with their Cantor8 wallet and the
 * backend issues a `kind = "admin"` session cookie — the same proof the wallet-link flow uses,
 * with the `admin-sign-in` purpose. The catalog (series, events, market identity), the
 * treasury-signed market factory and the trading halt live behind it.
 *
 * This is separate from the older `to_admin` Vercel session (`lib/adminSession.ts`), which still
 * gates the browser-side ledger relay's operator reads; ADMIN_AUTH.md lists porting that as the next step.
 */
import { BackendError, backendDownload, backendFetch, type BackendDownload } from "@/lib/backend";
import { requireWalletPublicKey, type SignMessage } from "@/auth/wallet";
import type { LoginResult, Money, SessionResponse } from "@/auth/types";
import type {
  ApiCreateMarketResult,
  ApiEvent,
  ApiExchangeStatus,
  ApiMarket,
  ApiPage,
  ApiSeries,
} from "@/lib/marketsTypes";
import type {
  ApiAdminInstrument,
  InstrumentId,
  InstrumentRef,
  RegistryAuth,
  TreasuryTransferMode,
} from "@/lib/instruments";
import type { RewardGrant, RewardGrantStatus, RewardRule, RewardsFloat } from "@/lib/rewards";
import type {
  AlertDecision,
  AlertSeverity,
  AlertStatus,
  ApiAdminBankAccount,
  ApiAdminPayout,
  ApiAdminRampOrder,
  ApiAdminRampOrderDetail,
  ApiAdminSession,
  ApiApproval,
  ApiApprovalOutcome,
  ApiApproveManyResult,
  ApiBankLine,
  ApiBankStatement,
  ApiComplianceAlertList,
  ApiComplianceFreeze,
  ApiConsentDeclaration,
  ApiCursorPage,
  ApiItems,
  ApiKycOverrideAnswer,
  ApiPayoutBatch,
  ApiPayoutBatchDraft,
  ApiPayoutBatchItem,
  ApiAdminRampEvent,
  ApiRampControls,
  ApiRampEventPage,
  ApiRampProviderStatus,
  ApiRampReconciliation,
  ApiReconRun,
  ApiScreeningHit,
  ApiScreeningHitDetail,
  ApiScreeningImport,
  ApiScreeningList,
  ApiScreeningRun,
  ApiStatementPreview,
  ApiTokenCommand,
  ApprovalDecision,
  ApprovalStatus,
  BankAccountStatus,
  BankLineClassification,
  BankLineStatus,
  BankMatchKind,
  BankStatementStatus,
  BatchStatus,
  FreezeSource,
  HaltScope,
  KycOverrideStatus,
  PayoutStatus,
  RampDirection,
  RampEventFilter,
  RampOrderAction,
  RampStatus,
  ScreeningHitStatus,
  ScreeningListName,
  TokenCommandAction,
  TokenCommandSource,
  TokenCommandStatus,
} from "@/lib/rampAdminTypes";
import { RAMP_EVENT_CLOSE_ACTION } from "@/lib/rampAdminTypes";
import { checkApprovalHashes, type DecisionSigner, type SignedRequest } from "@/lib/rampAdmin";

interface Challenge {
  challengeId: string;
  message: string;
  expiresAt: string;
}

/** Whether the current backend session is an operator session. */
export async function fetchBackendAdminSession(): Promise<{
  authenticated: boolean;
  isAdmin: boolean;
  partyId: string | null;
}> {
  const s = await backendFetch<SessionResponse>("/api/v1/auth/session");
  if (!s.authenticated) return { authenticated: false, isAdmin: false, partyId: null };
  return { authenticated: true, isAdmin: s.kind === "admin", partyId: s.user?.partyId ?? null };
}

/**
 * Challenge → popup → session. The challenge is fetched before the popup so the signature is
 * the first thing the click awaits (one popup per user gesture, see auth/wallet.ts).
 */
export async function signInAsBackendAdmin(args: {
  partyId: string;
  publicKey: string | undefined;
  signMessage: SignMessage;
}): Promise<LoginResult> {
  const publicKey = requireWalletPublicKey(args.publicKey);
  const challenge = await backendFetch<Challenge>("/api/v1/auth/admin/challenge", {
    method: "POST",
    body: { partyId: args.partyId },
  });
  const signature = await args.signMessage(challenge.message, args.partyId);
  if (!signature) throw new Error("The wallet returned an empty signature.");
  return backendFetch<LoginResult>("/api/v1/auth/admin", {
    method: "POST",
    body: { challengeId: challenge.challengeId, partyId: args.partyId, publicKey, signature, kind: "cantor8" },
  });
}

export function signOutBackendAdmin(): Promise<{ ok: true }> {
  return backendFetch<{ ok: true }>("/api/v1/auth/logout", { method: "POST" });
}

// ── catalog ──

export interface SeriesInput {
  ticker: string;
  title: string;
  category?: string;
  frequency?: ApiSeries["frequency"];
  tags?: string[];
  settlementSources?: { name: string; url: string }[];
  contractUrl?: string | null;
  description?: string;
  reason?: string;
}

export function createSeries(body: SeriesInput): Promise<ApiSeries> {
  return backendFetch<{ series: ApiSeries }>("/api/v1/admin/series", { method: "POST", body }).then((r) => r.series);
}

export function updateSeries(
  ticker: string,
  body: Partial<Omit<SeriesInput, "ticker">> & { status?: "active" | "archived" },
): Promise<ApiSeries> {
  return backendFetch<{ series: ApiSeries }>(`/api/v1/admin/series/${encodeURIComponent(ticker)}`, {
    method: "PATCH",
    body,
  }).then((r) => r.series);
}

export interface EventInput {
  ticker: string;
  seriesTicker: string;
  title: string;
  subTitle?: string;
  imageUrl?: string;
  description?: string;
  mutuallyExclusive?: boolean;
  strikeDate?: string | null;
  strikePeriod?: string | null;
  settlementSources?: { name: string; url: string }[];
  reason?: string;
}

export function createEvent(body: EventInput): Promise<ApiEvent> {
  return backendFetch<{ event: ApiEvent }>("/api/v1/admin/events", { method: "POST", body }).then((r) => r.event);
}

export function updateEvent(
  ticker: string,
  body: Partial<Omit<EventInput, "ticker">> & { archived?: boolean },
): Promise<ApiEvent> {
  return backendFetch<{ event: ApiEvent }>(`/api/v1/admin/events/${encodeURIComponent(ticker)}`, {
    method: "PATCH",
    body,
  }).then((r) => r.event);
}

export interface CreateMarketInput {
  eventTicker: string;
  ticker: string;
  /**
   * The instrument the market is denominated in (docs/TOKENS.md §4.5): an enabled `collateral`
   * row of the instrument catalog, and the event's instrument when the event already has one —
   * anything else is `400 validation_failed` / `409 catalog_conflict`. The backend's default
   * collateral when omitted.
   */
  collateral?: { admin: string; id: string };
  question: string;
  yesSubTitle?: string;
  noSubTitle?: string;
  /** Presentation, kept by the backend as market metadata (not on the contract since v16). */
  imageUrl?: string;
  description?: string;
  resolutionDescription?: string;
  expiresAt: string;
  gracePeriodSecs?: number;
  isDynamic?: boolean;
  liquidityPeriodSecs?: number;
  initialProbability: string;
  /** Initial pool value V₀, in the collateral. */
  initialValue: string;
  feeBps?: number;
  prizeFeeShareBps?: number;
  policy?: {
    operatorResolution?: boolean;
    sources?: string[];
    reporters?: string[];
    quorum?: number;
    challengeSecs?: number;
    /** T3 bond, in the collateral. */
    bond?: string;
  };
  reason?: string;
}

/**
 * Treasury-signed `CreateMarket` for an event (docs/MARKETS.md §4); the market shows up once
 * indexed. The first market of an event fixes the event's collateral for every later one.
 */
export function createMarketViaBackend(body: CreateMarketInput): Promise<ApiCreateMarketResult> {
  return backendFetch<ApiCreateMarketResult>("/api/v1/admin/markets", { method: "POST", body });
}

export interface MarketMetadataInput {
  imageUrl?: string;
  description?: string;
  reason?: string;
}

/**
 * Operator override of a market's presentation (docs/MARKETS.md): image URL and description.
 * `market` is an id or a ticker. A blank `imageUrl` puts the market back on the event's image.
 */
export function updateMarketMetadata(market: string | number, body: MarketMetadataInput): Promise<ApiMarket> {
  return backendFetch<{ market: ApiMarket }>(`/api/v1/admin/markets/${encodeURIComponent(String(market))}/metadata`, {
    method: "PATCH",
    body,
  }).then((r) => r.market);
}

export function setTradingHalt(body: {
  active: boolean;
  reason: string;
  estimatedResumeAt?: string | null;
}): Promise<ApiExchangeStatus["halt"]> {
  return backendFetch<{ halt: ApiExchangeStatus["halt"] }>("/api/v1/admin/exchange/halt", {
    method: "POST",
    body,
  }).then((r) => r.halt);
}

// ── instruments (docs/TOKENS.md §4.1, §4.4) ──

const instrumentPath = (ref: InstrumentId) =>
  `/api/v1/admin/instruments/${encodeURIComponent(ref.admin)}/${encodeURIComponent(ref.id)}`;

/**
 * `POST /admin/instruments`. The `(admin, id)` pair IS the token on the ledger and never changes
 * afterwards; everything else is presentation and wiring. `decimals` is the token's own scale
 * (display and withdrawal quantisation — the ledger stays at 10). Unknown keys are refused by
 * the backend's validation, so this is the complete allow-list.
 */
export interface InstrumentInput {
  admin: string;
  id: string;
  symbol?: string;
  name?: string;
  decimals: number;
  kind: "collateral" | "rewards";
  enabled?: boolean;
  isDefaultCollateral?: boolean;
  registryUrl?: string | null;
  registryAuth?: RegistryAuth;
  /** null = the process default (`TREASURY_TRANSFER_MODE`). */
  transferMode?: TreasuryTransferMode | null;
  /** What the Cantor8 wallet SDK's `send()` expects for this token; blank = the token id. */
  walletInstrumentId?: string;
  setupChoices?: Record<string, string>;
  reason?: string;
}

/** `PATCH /admin/instruments/:admin/:id` — every field optional; the pair and the kind cannot change. */
export type InstrumentPatch = Partial<Omit<InstrumentInput, "admin" | "id" | "kind">>;

/** Every catalog row, disabled ones included — unlike the public `GET /exchange/instruments`. */
export function fetchAdminInstruments(): Promise<ApiAdminInstrument[]> {
  return backendFetch<{ instruments: ApiAdminInstrument[] }>("/api/v1/admin/instruments").then((r) => r.instruments);
}

export function createInstrument(body: InstrumentInput): Promise<ApiAdminInstrument> {
  return backendFetch<{ instrument: ApiAdminInstrument }>("/api/v1/admin/instruments", { method: "POST", body }).then(
    (r) => r.instrument,
  );
}

export function updateInstrument(ref: InstrumentId, body: InstrumentPatch): Promise<ApiAdminInstrument> {
  return backendFetch<{ instrument: ApiAdminInstrument }>(instrumentPath(ref), { method: "PATCH", body }).then(
    (r) => r.instrument,
  );
}

/**
 * `POST /admin/instruments/:admin/:id/setup` (docs/TOKENS.md §4.4): treasury-signed one-time
 * registry setup — `autoAccept` creates the token's AutoAccept for the treasury so inbound
 * transfers settle without a two-step accept, `mintDelegation` the MintDelegation that lets the
 * token-app's mints land on the treasury. Not applicable to Canton Coin (the Enterprise Wallet
 * account pre-approves Amulet transfers). The answer names the factory the registry disclosed
 * and, per action, the choice exercised on it with the treasury's command id and status.
 */
export interface InstrumentSetupInput {
  autoAccept?: boolean;
  mintDelegation?: boolean;
  reason?: string;
}

/** One action of the setup: `choice` is the instrument's `setupChoices` entry for it (or the default). */
export interface InstrumentSetupAction {
  kind: "autoAccept" | "mintDelegation";
  choice: string;
  commandId: string;
  status: string;
}

export interface InstrumentSetupResult {
  instrument: InstrumentRef;
  /** The factory contract the registry named for a self-transfer of 0, and its concrete template. */
  factoryId: string;
  factoryTemplateId: string;
  /** Only the actions the request asked for, in the order they ran. */
  actions: InstrumentSetupAction[];
}

export function setupInstrument(ref: InstrumentId, body: InstrumentSetupInput): Promise<InstrumentSetupResult> {
  return backendFetch<InstrumentSetupResult>(`${instrumentPath(ref)}/setup`, { method: "POST", body });
}

// ── tokens: Cantor8's token-app through the backend (docs/TOKENS.md §4.7) ──

export interface TokenAppStatus {
  configured: boolean;
  url: string | null;
  appName: string;
  reachable: boolean;
  raw: Record<string, unknown> | null;
}

/** `GET /admin/tokens/status`: the token-app's own status plus, per instrument, what the treasury holds against what the in-app wallets owe. */
export interface TokenStatus {
  tokenApp: TokenAppStatus;
  instruments: {
    instrument: InstrumentRef;
    treasuryHoldings: Money;
    /** Σ in-app wallet balances + Σ live PendingPayouts (owed, still held by the treasury). */
    liabilities: Money;
    /** The PendingPayout part of `liabilities`. */
    pendingPayouts: Money;
  }[];
}

export function fetchTokenStatus(): Promise<TokenStatus> {
  return backendFetch<TokenStatus>("/api/v1/admin/tokens/status");
}

/**
 * `POST /admin/tokens/mint`: a token-app mint to the treasury (default) or to a party; with
 * `creditUserId` the backend follows the treasury mint with `UserWallet.Deposit` for that user's
 * primary party — the DevNet faucet and the primitive a card on-ramp will call. Amounts are
 * decimal strings, like every Money on the wire. `reason` is required: money is created, and the
 * audit row (`token.mint`) carries why.
 */
export interface MintInput {
  instrument: InstrumentId;
  amount: string;
  to?: "treasury" | string;
  creditUserId?: string;
  reason: string;
}

/** `POST /admin/tokens/burn`: destroy `amount` of a party's holdings; `reason` lands on the `token.burn` audit row. */
export interface BurnInput {
  instrument: InstrumentId;
  amount: string;
  party: string;
  reason: string;
}

/** What a mint (or burn) answered: the token-app command and, for a mint-and-credit, the in-app credit that followed. */
export interface TokenMintResult {
  commandId: string;
  status: string;
  instrument: InstrumentRef;
  amount: Money;
  /** The party the tokens were minted to (the treasury unless `to` named another) or burned from. */
  party: string;
  /**
   * The `UserWallet.Deposit` of a mint-and-credit: `pending` until token-app records the mint (the
   * token sync submits it then), `submitted` until the confirm pass sees the ref in `creditRefs`.
   */
  credit: { commandId: string; txRef: string; status: "pending" | "confirmed" | "submitted" } | null;
}

/**
 * A mint or burn answers the command itself — except on mainnet for an instrument other than the
 * ramp's, where it becomes the four-eyes `token.admin_mint|burn` request: 202 `{approval}` (or 200
 * `{approval, result}` once executed).
 */
export type TokenOperationAnswer = TokenMintResult | ApiApprovalOutcome<TokenMintResult>;

export function isApprovalOutcome<R>(answer: R | ApiApprovalOutcome<R>): answer is ApiApprovalOutcome<R> {
  return Boolean(
    answer && typeof answer === "object" && "approval" in answer && (answer as { approval?: unknown }).approval,
  );
}

export function mintTokens(body: MintInput): Promise<TokenOperationAnswer> {
  return backendFetch<TokenOperationAnswer>("/api/v1/admin/tokens/mint", { method: "POST", body });
}

export function burnTokens(body: BurnInput): Promise<TokenOperationAnswer> {
  return backendFetch<TokenOperationAnswer>("/api/v1/admin/tokens/burn", { method: "POST", body });
}

// ── rewards (docs/TOKENS.md §4.6) ──

export function fetchRewardRules(): Promise<RewardRule[]> {
  return backendFetch<{ rules: RewardRule[] }>("/api/v1/admin/rewards/rules").then((r) => r.rules);
}

/**
 * `PUT /admin/rewards/rules/:id`: re-parameterise and/or enable a rule; `params` replaces the whole
 * object and its values are decimal strings. `reason` is required — the change is audited
 * (`reward.rule_updated`, before and after) with it.
 */
export function updateRewardRule(
  id: string,
  body: { params?: Record<string, string>; enabled?: boolean; reason: string },
): Promise<RewardRule> {
  return backendFetch<{ rule: RewardRule }>(`/api/v1/admin/rewards/rules/${encodeURIComponent(id)}`, {
    method: "PUT",
    body,
  }).then((r) => r.rule);
}

/** `POST /admin/rewards/grant`: an operator's `manual` grant to a user (by account id) or a party. */
export interface ManualGrantInput {
  userId?: string;
  party?: string;
  amount: string;
  reason: string;
}

export function grantReward(body: ManualGrantInput): Promise<RewardGrant> {
  return backendFetch<{ grant: RewardGrant }>("/api/v1/admin/rewards/grant", { method: "POST", body }).then(
    (r) => r.grant,
  );
}

/**
 * `GET /admin/rewards/grants`: a page of the grant log, newest first, optionally one status. The
 * backend pages at 25 and caps `limit` at 100; `total` counts every grant the filter matches.
 */
export function fetchRewardGrants(
  query: { status?: RewardGrantStatus | ""; page?: number; limit?: number } = {},
): Promise<ApiPage<RewardGrant>> {
  const params = new URLSearchParams();
  if (query.status) params.set("status", query.status);
  if (query.page !== undefined) params.set("page", String(query.page));
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  const qs = params.toString();
  return backendFetch<ApiPage<RewardGrant>>(`/api/v1/admin/rewards/grants${qs ? `?${qs}` : ""}`);
}

export function fetchRewardsFloat(): Promise<RewardsFloat> {
  return backendFetch<RewardsFloat>("/api/v1/admin/rewards/float");
}

// ── ramp operator API (truthoracle-backend docs/RAMP.md §12.2) ──
//
// Money-moving routes are approval-backed: they answer `{approval}` while a second person's
// decision is pending and `{approval, result}` once it executed (single control, or dual control
// off in dev). Every mutation carries the operator's `reason` for the audit row. The bodies below
// are exactly the backend DTOs (its ValidationPipe refuses any other key).

/** `?a=1&b=…` from the defined, non-empty entries; "" when there are none. */
function query(params: Record<string, string | number | boolean | null | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    qs.set(key, String(value));
  }
  const text = qs.toString();
  return text ? `?${text}` : "";
}

const id = (value: string) => encodeURIComponent(value);

/**
 * `GET /admin/session`: party, person, roles and how decisions are made. null when the backend
 * predates roles (404): the console then shows every control and lets the backend refuse.
 */
export async function fetchAdminSessionInfo(): Promise<ApiAdminSession | null> {
  try {
    return await backendFetch<ApiAdminSession>("/api/v1/admin/session");
  } catch (e) {
    if (e instanceof BackendError && e.status === 404) return null;
    throw e;
  }
}

// approvals (§6.5)

export async function fetchApprovals(
  q: { status?: ApprovalStatus | ""; action?: string; subjectType?: string; subjectId?: string } = {},
): Promise<ApiItems<ApiApproval>> {
  const res = await backendFetch<ApiItems<ApiApproval>>(`/api/v1/admin/approvals${query(q)}`);
  // R3-06: every listed hash is checked against its params before a decision on it can be signed.
  await checkApprovalHashes(Array.isArray(res?.items) ? res.items : []);
  return res;
}

export function fetchApproval(approvalId: string): Promise<ApiApproval> {
  return backendFetch<{ approval: ApiApproval }>(`/api/v1/admin/approvals/${id(approvalId)}`).then((r) => r.approval);
}

/** A decision; `signature` is the wallet's over `truthoracle-approval:<id>:<paramsHash>:<approve|reject>` (lib/rampAdmin.ts). */
export interface ApprovalDecisionInput {
  reason: string;
  signature?: string;
}

export function approveApproval(approvalId: string, body: ApprovalDecisionInput): Promise<ApiApprovalOutcome> {
  return backendFetch<ApiApprovalOutcome>(`/api/v1/admin/approvals/${id(approvalId)}/approve`, {
    method: "POST",
    body,
  });
}

/** Reject (another approver) or withdraw (the requester): `{approval}`, never executed. */
export function rejectApproval(approvalId: string, body: ApprovalDecisionInput): Promise<ApiApprovalOutcome> {
  return backendFetch<ApiApprovalOutcome>(`/api/v1/admin/approvals/${id(approvalId)}/reject`, { method: "POST", body });
}

/**
 * One decision, signed: the wallet signs FIRST — inside a click that is the one popup it may open —
 * and only then is the decision posted, with the signature when the backend requires one.
 */
export async function decideApproval(
  approval: Pick<ApiApproval, "id" | "paramsHash">,
  decision: ApprovalDecision,
  reason: string,
  sign: DecisionSigner,
): Promise<ApiApprovalOutcome> {
  const signature = await sign(approval, decision);
  const body = { reason, ...(signature ? { signature } : {}) };
  return decision === "approve" ? approveApproval(approval.id, body) : rejectApproval(approval.id, body);
}

/** One action type per call (else 400 validation_failed); `signatures` maps each id to its own signed message (omitted when signatures are off). */
export function approveManyApprovals(body: {
  ids: string[];
  reason: string;
  signatures?: Record<string, string>;
}): Promise<ApiApproveManyResult> {
  return backendFetch<ApiApproveManyResult>("/api/v1/admin/approvals/approve-many", { method: "POST", body });
}

// orders (§4.2)

/** A keyset page, newest first: pass `nextCursor` back as `cursor` (limit 1–100, default 25). */
export function fetchAdminRampOrders(
  q: {
    status?: RampStatus | "";
    direction?: RampDirection | "";
    userId?: string;
    cursor?: string | null;
    limit?: number;
  } = {},
): Promise<ApiCursorPage<ApiAdminRampOrder>> {
  return backendFetch<ApiCursorPage<ApiAdminRampOrder>>(`/api/v1/admin/ramp/orders${query(q)}`);
}

export function fetchAdminRampOrder(orderId: string): Promise<ApiAdminRampOrderDetail> {
  return backendFetch<ApiAdminRampOrderDetail>(`/api/v1/admin/ramp/orders/${id(orderId)}`);
}

/** Params per action: `refund_bank` names the user's proved account, `bank_unpaid` what follows; the rest take only the reason. */
export interface RampOrderActionInput {
  reason: string;
  bankAccountId?: string;
  then?: "requeue" | "reverse";
}

export function requestRampOrderAction(
  orderId: string,
  action: RampOrderAction,
  body: RampOrderActionInput,
): Promise<ApiApprovalOutcome> {
  return backendFetch<ApiApprovalOutcome>(`/api/v1/admin/ramp/orders/${id(orderId)}/${action}`, {
    method: "POST",
    body,
  });
}

/** `POST /admin/ramp/payment-methods/:id/unblock` → `ramp.payment_method.unblock` (409 `ramp_card_state` unless the card is blocked). */
export function requestPaymentMethodUnblock(
  paymentMethodId: string,
  body: { reason: string },
): Promise<ApiApprovalOutcome> {
  return backendFetch<ApiApprovalOutcome>(`/api/v1/admin/ramp/payment-methods/${id(paymentMethodId)}/unblock`, {
    method: "POST",
    body,
  });
}

// controls and reconciliation (§6.1, §6.2)

export function fetchRampControls(): Promise<ApiRampControls> {
  return backendFetch<{ controls: ApiRampControls }>("/api/v1/admin/ramp/controls").then((r) => r.controls);
}

/** Immediate (role `ops`): a halt only reduces risk. */
export function haltRamp(body: { scopes: HaltScope[]; reason: string }): Promise<ApiRampControls> {
  return backendFetch<{ controls: ApiRampControls }>("/api/v1/admin/ramp/controls/halt", { method: "POST", body }).then(
    (r) => r.controls,
  );
}

/** Lifting every halt is four-eyes (`ramp.controls.resume`); 409 `ramp_order_state` when nothing is halted. */
export function requestRampResume(body: { reason: string }): Promise<ApiApprovalOutcome> {
  return backendFetch<ApiApprovalOutcome>("/api/v1/admin/ramp/controls/resume", { method: "POST", body });
}

export function fetchRampReconciliation(): Promise<ApiRampReconciliation> {
  return backendFetch<ApiRampReconciliation>("/api/v1/admin/ramp/reconciliation");
}

/** Answers the run in progress, or one that finished under a minute ago, else a new one. */
export function runRampReconciliation(): Promise<{ run: ApiReconRun }> {
  return backendFetch<{ run: ApiReconRun }>("/api/v1/admin/ramp/reconciliation/run", { method: "POST", body: {} });
}

export function fetchRampProvider(): Promise<ApiRampProviderStatus> {
  return backendFetch<ApiRampProviderStatus>("/api/v1/admin/ramp/provider");
}

// webhook events (C31): the dead / unapplied acquirer events `events_dead` reports

/** A keyset page, oldest problem first as the backend orders it: pass `nextCursor` back as `cursor`. */
export async function fetchRampEvents(q: {
  status: RampEventFilter;
  cursor?: string | null;
}): Promise<ApiRampEventPage> {
  const page = await backendFetch<ApiRampEventPage>(`/api/v1/admin/ramp/events${query(q)}`);
  // Read strictly (a new route): any other envelope is invalid_response, never a half-rendered table.
  if (!page || !Array.isArray(page.items))
    throw new BackendError(200, "invalid_response", "The accounts service returned no list of events.");
  return {
    items: page.items,
    nextCursor: typeof page.nextCursor === "string" && page.nextCursor ? page.nextCursor : null,
  };
}

/**
 * Role `ops`, single control (200 `{event}`): re-arm the event with a fresh dead-after window; the
 * processor re-reads the provider and applies it. 409 `ramp_event_state` once applied or closed.
 */
export async function replayRampEvent(eventId: string, body: { reason: string }): Promise<{ event: ApiAdminRampEvent }> {
  const answer = await backendFetch<{ event?: ApiAdminRampEvent }>(`/api/v1/admin/ramp/events/${id(eventId)}/replay`, {
    method: "POST",
    body,
  });
  if (!answer?.event || typeof answer.event.id !== "string")
    throw new BackendError(200, "invalid_response", "The accounts service did not return the replayed event.");
  return { event: answer.event };
}

/**
 * Four-eyes `ramp.event.close` (RAMP_EVENT_CLOSE_ACTION; `ops` asks, `approver` approves under
 * Approvals): 202 `{approval}` pending, 200 `{approval, result: {event}}` executed. Closes the event
 * WITHOUT applying it — once its effects are applied by hand, or when it applies to nothing.
 */
export function requestRampEventClose(eventId: string, body: { reason: string }): Promise<ApiApprovalOutcome<{ event: ApiAdminRampEvent }>> {
  return backendFetch<ApiApprovalOutcome<{ event: ApiAdminRampEvent }>>(`/api/v1/admin/ramp/events/${id(eventId)}/close`, { method: "POST", body });
}

/** The pending close requests of webhook events, by event id (the console marks those rows). */
export async function fetchPendingEventCloses(): Promise<Map<string, ApiApproval>> {
  const { items } = await fetchApprovals({ status: "pending", action: RAMP_EVENT_CLOSE_ACTION });
  return new Map(items.map((a) => [a.subjectId, a]));
}

// token commands (§7)

/** At most 200 rows, newest first. */
export function fetchTokenCommands(
  q: { status?: TokenCommandStatus | ""; source?: TokenCommandSource | "" } = {},
): Promise<ApiItems<ApiTokenCommand>> {
  return backendFetch<ApiItems<ApiTokenCommand>>(`/api/v1/admin/tokens/commands${query(q)}`);
}

/**
 * `token.command.resend|abandon|compensate`. Abandon may state the treasury holdings expected
 * without the command (`expectedTreasuryHoldings`, a decimal); the backend defaults to the
 * indexed figure at request time, which the approval then binds.
 */
export function requestTokenCommandAction(
  commandId: string,
  action: TokenCommandAction,
  body: { reason: string; expectedTreasuryHoldings?: string },
): Promise<ApiApprovalOutcome> {
  return backendFetch<ApiApprovalOutcome>(`/api/v1/admin/tokens/commands/${id(commandId)}/${action}`, {
    method: "POST",
    body,
  });
}

/** `token.records.adopt`: legacy `recorded` rows for mirror records created before `before` (ISO instant); every instrument unless `instrumentId`. */
export function requestTokenRecordsAdopt(body: {
  before: string;
  reason: string;
  instrumentId?: string;
}): Promise<ApiApprovalOutcome> {
  return backendFetch<ApiApprovalOutcome>("/api/v1/admin/tokens/records/adopt", { method: "POST", body });
}

// treasury payouts

export function fetchAdminPayouts(status?: PayoutStatus): Promise<ApiItems<ApiAdminPayout>> {
  return backendFetch<ApiItems<ApiAdminPayout>>(`/api/v1/admin/payouts${query({ status })}`);
}

/**
 * `payout.mark_paid`: archive a PendingPayout that was paid out of band (replaces the relay's
 * paste-a-hash MarkPaid). `txHash` is the external payment's reference (lib/rampAdmin.ts
 * `markPaidReferenceProblem`); 409 `payout_blocked` for one bound to (or bindable by) a cash-out.
 */
export function requestPayoutMarkPaid(
  cid: string,
  body: { txHash: string; reason: string },
): Promise<ApiApprovalOutcome> {
  return backendFetch<ApiApprovalOutcome>(`/api/v1/admin/payouts/${id(cid)}/mark-paid`, { method: "POST", body });
}

/** `payout.force_settle`: settle a row blocked on KYC or a revoked wallet now (never the card exposure or a freeze). */
export function requestPayoutForceSettle(
  cid: string,
  body: { reason: string },
): Promise<ApiApprovalOutcome | { payout: ApiAdminPayout; mode: string }> {
  return backendFetch<ApiApprovalOutcome | { payout: ApiAdminPayout; mode: string }>(
    `/api/v1/admin/payouts/${id(cid)}/settle`,
    {
      method: "POST",
      body: { force: true, reason: body.reason },
    },
  );
}

// bank rail: payout batches (§10.3)

export function fetchPayoutBatches(q: { status?: BatchStatus | "" } = {}): Promise<ApiItems<ApiPayoutBatch>> {
  return backendFetch<ApiItems<ApiPayoutBatch>>(`/api/v1/admin/ramp/payout-batches${query(q)}`);
}

export function fetchPayoutBatch(batchId: string): Promise<{ batch: ApiPayoutBatch; items: ApiPayoutBatchItem[] }> {
  return backendFetch<{ batch: ApiPayoutBatch; items: ApiPayoutBatchItem[] }>(
    `/api/v1/admin/ramp/payout-batches/${id(batchId)}`,
  );
}

/**
 * Role `ops`: a draft of the oldest `payout_queued` orders not held and not in a batch, and the
 * orders left out with why (409 `batch_state` `{skipped}` when none is ready).
 */
export function createPayoutBatch(body: { reason: string }): Promise<ApiPayoutBatchDraft> {
  return backendFetch<ApiPayoutBatchDraft>("/api/v1/admin/ramp/payout-batches", { method: "POST", body });
}

/** `ramp.batch.approve` (approver ≠ creator); the backend runs a pre-batch reconciliation and the payout gate. */
export function requestBatchApproval(batchId: string, body: { reason: string }): Promise<ApiApprovalOutcome> {
  return backendFetch<ApiApprovalOutcome>(`/api/v1/admin/ramp/payout-batches/${id(batchId)}/approve`, {
    method: "POST",
    body,
  });
}

/**
 * Role `export`; a POST (the first export is gated and every export audited, 10/h). The file is
 * `ramp-payout-batch-<id>.csv` with an `X-Content-SHA256` header; a re-export must hash the same.
 */
export function exportPayoutBatch(batchId: string): Promise<BackendDownload> {
  return backendDownload(`/api/v1/admin/ramp/payout-batches/${id(batchId)}/export`, {
    body: {},
    fallbackName: `ramp-payout-batch-${batchId}.csv`,
  });
}

/** Role `ops`, runs even under a payouts halt: the file is at the bank, the orders become `payout_sent`. */
export function markBatchSubmitted(
  batchId: string,
  body: { bankReference: string; reason?: string },
): Promise<{ batch: ApiPayoutBatch }> {
  return backendFetch<{ batch: ApiPayoutBatch }>(`/api/v1/admin/ramp/payout-batches/${id(batchId)}/submitted`, {
    method: "POST",
    body,
  });
}

/** Draft or approved only (single `ops`): orders go back to the queue, items are voided. */
export function cancelPayoutBatch(batchId: string, body: { reason: string }): Promise<{ batch: ApiPayoutBatch }> {
  return backendFetch<{ batch: ApiPayoutBatch }>(`/api/v1/admin/ramp/payout-batches/${id(batchId)}/cancel`, {
    method: "POST",
    body,
  });
}

/** Exported only, four-eyes `ramp.batch.void`: statements prove no item was paid, or the bank rejected the file. */
export function requestBatchVoid(
  batchId: string,
  body: { reason: string; bankRejectionRef?: string },
): Promise<ApiApprovalOutcome> {
  return backendFetch<ApiApprovalOutcome>(`/api/v1/admin/ramp/payout-batches/${id(batchId)}/void`, {
    method: "POST",
    body,
  });
}

// bank rail: statements and lines (§10.4)

/** The statement file as uploaded: base64 content; account, period and balances are read from it, never from here. */
export interface StatementFileInput {
  format: "camt053" | "csv";
  content: string;
  charset?: "utf-8" | "windows-1251";
}

export function fetchBankStatements(
  q: { status?: BankStatementStatus | "" } = {},
): Promise<ApiItems<ApiBankStatement>> {
  return backendFetch<ApiItems<ApiBankStatement>>(`/api/v1/admin/ramp/bank-statements${query(q)}`);
}

export function fetchBankStatement(statementId: string): Promise<ApiStatementPreview> {
  return backendFetch<ApiStatementPreview>(`/api/v1/admin/ramp/bank-statements/${id(statementId)}`);
}

/** Role `ops`: parse and store a draft with PROPOSED matches and flags (422 `statement_*` when refused). */
export function uploadBankStatement(body: StatementFileInput): Promise<ApiStatementPreview> {
  return backendFetch<ApiStatementPreview>("/api/v1/admin/ramp/bank-statements", { method: "POST", body });
}

/** Request `ramp.statement.confirm`, optionally booking unmatched lines (non-zero lines are never ignored). */
export function requestStatementConfirm(
  statementId: string,
  body: { reason: string; classifications?: BankLineClassification[] },
): Promise<ApiApprovalOutcome> {
  return backendFetch<ApiApprovalOutcome>(`/api/v1/admin/ramp/bank-statements/${id(statementId)}/confirm`, {
    method: "POST",
    body,
  });
}

/** The second person's confirm, signed first (see decideApproval); the copy was encoded before the click. */
export async function approveStatementConfirmSigned(
  statementId: string,
  pending: Pick<ApiApproval, "id" | "paramsHash">,
  copy: StatementFileInput,
  reason: string,
  sign: DecisionSigner,
): Promise<ApiApprovalOutcome> {
  const signature = await sign(pending, "approve");
  return approveStatementConfirm(statementId, {
    format: copy.format,
    content: copy.content,
    ...(copy.charset ? { charset: copy.charset } : {}),
    reason,
    ...(signature ? { signature } : {}),
  });
}

/**
 * The second person's confirm: their OWN copy of the statement, which must parse identically
 * (else 409 `statement_mismatch`), plus the signed decision on the pending confirm approval. The
 * uploader cannot confirm (403 `approval_same_person`).
 */
export function approveStatementConfirm(
  statementId: string,
  body: StatementFileInput & { reason: string; signature?: string },
): Promise<ApiApprovalOutcome> {
  return backendFetch<ApiApprovalOutcome>(`/api/v1/admin/ramp/bank-statements/${id(statementId)}/confirm/approve`, {
    method: "POST",
    body,
  });
}

export function fetchBankLines(
  q: { status?: BankLineStatus | ""; statementId?: string } = {},
): Promise<ApiItems<ApiBankLine>> {
  return backendFetch<ApiItems<ApiBankLine>>(`/api/v1/admin/ramp/bank-lines${query(q)}`);
}

/** `ramp.bank_line.classify` for a line of an already-confirmed statement. */
export function requestBankLineClassify(
  lineId: string,
  body: { reason: string; matchKind: BankMatchKind; orderId?: string; batchId?: string },
): Promise<ApiApprovalOutcome> {
  return backendFetch<ApiApprovalOutcome>(`/api/v1/admin/ramp/bank-lines/${id(lineId)}/classify`, {
    method: "POST",
    body,
  });
}

// bank rail: user accounts awaiting proof (§10.2)

export function fetchAdminBankAccounts(
  q: { status?: BankAccountStatus | ""; userId?: string } = {},
): Promise<ApiItems<ApiAdminBankAccount>> {
  return backendFetch<ApiItems<ApiAdminBankAccount>>(`/api/v1/admin/ramp/bank-accounts${query(q)}`);
}

/**
 * Four-eyes `ramp.bank_account.verify` (cooling-off or pending-proof accounts): manual proof that
 * the IBAN is held in the user's verified name. 409 `bank_account_invalid` when manual proofs are off.
 */
export function requestBankAccountVerify(
  accountId: string,
  body: { reason: string; proofRef: string },
): Promise<ApiApprovalOutcome> {
  return backendFetch<ApiApprovalOutcome>(`/api/v1/admin/ramp/bank-accounts/${id(accountId)}/verify`, {
    method: "POST",
    body,
  });
}

/** Four-eyes `ramp.bank_account.unblock`: a blocked account goes back to pending proof and must be proved again. */
export function requestBankAccountUnblock(accountId: string, body: { reason: string }): Promise<ApiApprovalOutcome> {
  return backendFetch<ApiApprovalOutcome>(`/api/v1/admin/ramp/bank-accounts/${id(accountId)}/unblock`, {
    method: "POST",
    body,
  });
}

// compliance (§11.6)

/** Undecided first by legal due date, then newest; at most `limit` (≤ 200). `due`: overdue, or due within 2 h. */
export function fetchComplianceAlerts(
  q: {
    status?: AlertStatus | "";
    rule?: string;
    userId?: string;
    orderId?: string;
    severity?: AlertSeverity | "";
    due?: "overdue" | "soon" | "";
    limit?: number;
  } = {},
): Promise<ApiComplianceAlertList> {
  return backendFetch<ApiComplianceAlertList>(`/api/v1/admin/compliance/alerts${query(q)}`);
}

/**
 * `compliance.alert.decide` (role `aml`): a review / info alert is decided at once (200), a block
 * alert waits for a second person with `approver` (202). Open → any; escalated → clear | report |
 * return; reported → clear | return; cleared and returned are final; `return` only on an alert
 * that holds an order. With signatures on, a single-control clear or return carries `signature`
 * over the request message (C23: unsigned → 400 with the message; lib/rampAdmin.ts).
 */
export function decideComplianceAlert(
  alertId: string,
  body: { decision: AlertDecision; reason: string; reportRef?: string; signature?: string },
): Promise<ApiApprovalOutcome> {
  return backendFetch<ApiApprovalOutcome>(`/api/v1/admin/compliance/alerts/${id(alertId)}/decide`, {
    method: "POST",
    body,
  });
}

/** What `compliance.alert.decide` signs over (C23): the params exactly as the backend normalises them. */
export function alertDecisionRequest(alertId: string, decision: AlertDecision, reportRef?: string): SignedRequest {
  return {
    action: "compliance.alert.decide",
    subjectType: "compliance_alert",
    subjectId: alertId,
    params: { decision, reportRef: decision === "report" ? (reportRef ?? "").trim() : null },
  };
}

/** Role `aml`, on a TM-PRINCIPAL / TM-PEP alert: the declaration it was raised on, unsealed (audited, never cached; C13). */
export function fetchAlertDeclaration(alertId: string): Promise<ApiConsentDeclaration> {
  return backendFetch<{ declaration: ApiConsentDeclaration }>(
    `/api/v1/admin/compliance/alerts/${id(alertId)}/declaration`,
  ).then((r) => r.declaration);
}

/** Role `aml`, at most 31 days, CSV (human mode), audited, 10/h. */
export function exportComplianceAlerts(body: {
  from: string;
  to: string;
  status?: AlertStatus;
}): Promise<BackendDownload> {
  return backendDownload("/api/v1/admin/compliance/alerts/export", { body, fallbackName: "compliance-alerts.csv" });
}

/** Role `aml`. */
export function fetchScreeningLists(): Promise<ApiItems<ApiScreeningList>> {
  return backendFetch<ApiItems<ApiScreeningList>>("/api/v1/admin/compliance/screening-lists");
}

/**
 * Role `aml`: a normalised CSV (`kind,name_variants,birth_date,ids`), base64; every account is
 * re-screened on import. `hits`/`run` are null when another re-screen held the lock (the processor
 * follows up).
 */
export function importScreeningList(body: {
  list: ScreeningListName;
  version: string;
  deliveredAt: string;
  content: string;
  charset?: "utf-8" | "windows-1251";
}): Promise<ApiScreeningImport> {
  return backendFetch<ApiScreeningImport>("/api/v1/admin/compliance/screening-lists", { method: "POST", body });
}

/** Role `aml`. */
export function fetchScreeningHits(
  q: { status?: ScreeningHitStatus | ""; userId?: string; list?: ScreeningListName | "" } = {},
): Promise<ApiItems<ApiScreeningHit>> {
  return backendFetch<ApiItems<ApiScreeningHit>>(`/api/v1/admin/compliance/screening-hits${query(q)}`);
}

/** Role `aml`: the hit and the account's verified identity to compare it with (the read is audited). */
export function fetchScreeningHit(hitId: string): Promise<ApiScreeningHitDetail> {
  return backendFetch<ApiScreeningHitDetail>(`/api/v1/admin/compliance/screening-hits/${id(hitId)}`);
}

/**
 * `compliance.hit.decide` (single, role `aml`), on an open hit — or a confirmed foreign-list one,
 * which may still be cleared: confirm keeps the freeze (special form), clear lifts the provisional
 * one. With signatures on, a clear carries `signature` over the request message (C23).
 */
export function decideScreeningHit(
  hitId: string,
  body: { decision: "confirm" | "clear"; reason: string; signature?: string },
): Promise<ApiApprovalOutcome> {
  return backendFetch<ApiApprovalOutcome>(`/api/v1/admin/compliance/screening-hits/${id(hitId)}/decide`, {
    method: "POST",
    body,
  });
}

/** What `compliance.hit.decide` signs over (C23). */
export function hitDecisionRequest(hitId: string, decision: "confirm" | "clear"): SignedRequest {
  return { action: "compliance.hit.decide", subjectType: "screening_hit", subjectId: hitId, params: { decision } };
}

/** Role `aml`: the latest 50 re-screens, full and per account. */
export function fetchScreeningRuns(): Promise<ApiItems<ApiScreeningRun>> {
  return backendFetch<ApiItems<ApiScreeningRun>>("/api/v1/admin/compliance/screening-runs");
}

/** Role `aml`: a full re-screen now (409 `rescreen_running` while one runs), or one account with `userId`. */
export function requestRescreen(body: { reason: string; userId?: string }): Promise<{ run: ApiScreeningRun }> {
  return backendFetch<{ run: ApiScreeningRun }>("/api/v1/admin/compliance/screening-runs", { method: "POST", body });
}

/** Newest first, at most 200; readable by every operator (an approver deciding a lift needs it). */
export function fetchFreezes(q: { active?: boolean; userId?: string } = {}): Promise<ApiItems<ApiComplianceFreeze>> {
  return backendFetch<ApiItems<ApiComplianceFreeze>>(`/api/v1/admin/compliance/freezes${query(q)}`);
}

/** Role `aml`, immediate: no value leaves the user from now on. 409 `freeze_active` when one is active. */
export function createFreeze(body: {
  userId: string;
  reason: string;
  source: FreezeSource;
}): Promise<{ freeze: ApiComplianceFreeze }> {
  return backendFetch<{ freeze: ApiComplianceFreeze }>("/api/v1/admin/compliance/freezes", { method: "POST", body });
}

/** Four-eyes `compliance.freeze.lift` (aml requests, an approver approves); 409 `screening_hits_open` while a freezing-list hit is open. */
export function requestFreezeLift(freezeId: string, body: { reason: string }): Promise<ApiApprovalOutcome> {
  return backendFetch<ApiApprovalOutcome>(`/api/v1/admin/compliance/freezes/${id(freezeId)}/lift`, {
    method: "POST",
    body,
  });
}

/**
 * `POST /admin/users/:id/kyc/override` (role `aml`, C22). `approved` opens the KYC-gated ramp, so it
 * is the four-eyes `kyc.override`: 202 `{approval}` until another person with `approver` approves
 * it, 200 `{verification, approval}` once executed (dual control off). `rejected_final` / `expired`
 * close the gate at once: 200 `{verification}`.
 */
export async function overrideKyc(
  userId: string,
  body: { status: KycOverrideStatus; reason: string },
): Promise<ApiKycOverrideAnswer> {
  const answer = await backendFetch<ApiKycOverrideAnswer>(`/api/v1/admin/users/${id(userId)}/kyc/override`, {
    method: "POST",
    body,
  });
  if (!answer || typeof answer !== "object" || (!answer.verification && !answer.approval))
    throw new BackendError(
      200,
      "invalid_response",
      "The KYC override answered neither a verification nor an approval.",
    );
  return answer;
}

/** Role `export`, at most 31 days and 20 000 orders: every order with its facts and the KYC name, CSV (human mode), audited, 10/h. */
export function exportRampOperations(body: { from: string; to: string }): Promise<BackendDownload> {
  return backendDownload("/api/v1/admin/ramp/operations/export", { body, fallbackName: "ramp-operations.csv" });
}
