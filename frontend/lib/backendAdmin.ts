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
import type { LoginResult, SessionResponse } from "@/auth/types";
import type { ApiCreateMarketResult, ApiEvent, ApiExchangeStatus, ApiMarket, ApiSeries } from "@/lib/marketsTypes";

interface Challenge {
  challengeId: string;
  message: string;
  expiresAt: string;
}

/** Whether the current backend session is an operator session. */
export async function fetchBackendAdminSession(): Promise<{ authenticated: boolean; isAdmin: boolean; partyId: string | null }> {
  const s = await backendFetch<SessionResponse>("/api/v1/auth/session");
  if (!s.authenticated) return { authenticated: false, isAdmin: false, partyId: null };
  return { authenticated: true, isAdmin: s.kind === "admin", partyId: s.user?.partyId ?? null };
}

/**
 * Challenge → popup → session. The challenge is fetched before the popup so the signature is
 * the first thing the click awaits (one popup per user gesture, see auth/wallet.ts).
 */
export async function signInAsBackendAdmin(args: { partyId: string; publicKey: string | undefined; signMessage: SignMessage }): Promise<LoginResult> {
  const publicKey = requireWalletPublicKey(args.publicKey);
  const challenge = await backendFetch<Challenge>("/api/v1/auth/admin/challenge", { method: "POST", body: { partyId: args.partyId } });
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

export function updateSeries(ticker: string, body: Partial<Omit<SeriesInput, "ticker">> & { status?: "active" | "archived" }): Promise<ApiSeries> {
  return backendFetch<{ series: ApiSeries }>(`/api/v1/admin/series/${encodeURIComponent(ticker)}`, { method: "PATCH", body }).then((r) => r.series);
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

export function updateEvent(ticker: string, body: Partial<Omit<EventInput, "ticker">> & { archived?: boolean }): Promise<ApiEvent> {
  return backendFetch<{ event: ApiEvent }>(`/api/v1/admin/events/${encodeURIComponent(ticker)}`, { method: "PATCH", body }).then((r) => r.event);
}


export interface CreateMarketInput {
  eventTicker: string;
  ticker: string;
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
  initialValueCC: string;
  feeBps?: number;
  prizeFeeShareBps?: number;
  policy?: {
    operatorResolution?: boolean;
    sources?: string[];
    reporters?: string[];
    quorum?: number;
    challengeSecs?: number;
    bondCC?: string;
  };
  reason?: string;
}

/** Treasury-signed `CreateMarket` for an event (docs/MARKETS.md §4); the market shows up once indexed. */
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
  return backendFetch<{ market: ApiMarket }>(`/api/v1/admin/markets/${encodeURIComponent(String(market))}/metadata`, { method: "PATCH", body }).then(
    (r) => r.market,
  );
}

export function setTradingHalt(body: { active: boolean; reason: string; estimatedResumeAt?: string | null }): Promise<ApiExchangeStatus["halt"]> {
  return backendFetch<{ halt: ApiExchangeStatus["halt"] }>("/api/v1/admin/exchange/halt", { method: "POST", body }).then((r) => r.halt);
}
