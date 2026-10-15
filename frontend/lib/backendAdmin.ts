/**
 * The backend's operator API from the browser (truthoracle-backend docs/API.md "Admin — catalog",
 * ARCHITECTURE §7.4): an operator signs a one-time challenge with their Cantor8 wallet and the
 * backend issues a `kind = "admin"` session cookie — the same proof the wallet-link flow uses,
 * with the `admin-sign-in` purpose. The catalog (series, events, market identity), the
 * treasury-signed market factory and the trading halt live behind it.
 *
 * This is separate from the older `to_admin` Vercel session (`lib/adminSession.ts`), which still
 * gates the browser-side ledger / wallet relays; ADMIN_AUTH.md lists porting that as the next step.
 */
import { backendFetch } from "@/lib/backend";
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
  instruments: { instrument: InstrumentRef; treasuryHoldings: Money; liabilities: Money }[];
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
  /** `submitted` until the backend's confirm pass sees the ref in the wallet's `creditRefs`. */
  credit: { commandId: string; txRef: string; status: "confirmed" | "submitted" } | null;
}

export function mintTokens(body: MintInput): Promise<TokenMintResult> {
  return backendFetch<TokenMintResult>("/api/v1/admin/tokens/mint", { method: "POST", body });
}

export function burnTokens(body: BurnInput): Promise<TokenMintResult> {
  return backendFetch<TokenMintResult>("/api/v1/admin/tokens/burn", { method: "POST", body });
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
