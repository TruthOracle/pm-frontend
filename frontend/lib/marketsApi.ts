/**
 * Market data for the UI (truthoracle-backend/docs/MARKETS.md).
 *
 * The backend's ledger index is the primary source: it has history (candles, trades),
 * the catalog (series → events → markets) and per-account reads that work on mainnet,
 * where the browser's own participant reads come back empty for external parties. The
 * direct active-contracts read (`utils/activeContracts.ts`) stays as the fallback for a
 * deployment without an accounts backend, which is read-only by design (ARCHITECTURE §18).
 *
 * Everything here is free of React. Components go through `marketSource` for markets so
 * they never have to know which source answered.
 */
import { backendFetch, probeBackend, type BackendAvailability } from "@/lib/backend";
import {
  fetchAllPredictionMarkets,
  type OutcomeTag,
  type PredictionMarketRecord,
} from "@/utils/activeContracts";
import { setPrefetchedMarkets } from "@/utils/marketPrefetch";
import type {
  ApiCandlesticks,
  ApiEvent,
  ApiEventCandlesticks,
  ApiExchangeStatus,
  ApiMarket,
  ApiPage,
  ApiPreparedOrder,
  ApiQuote,
  ApiSeries,
  ApiTrade,
  ApiTradeList,
  CandlePeriod,
  EventSort,
  EventStatus,
  PrepareOrderRequest,
} from "@/lib/marketsTypes";
import { toNumber } from "@/lib/marketsTypes";

const secs = (iso: string | null | undefined): number | null =>
  iso ? Math.floor(Date.parse(iso) / 1000) : null;

/** The backend's market → the record every existing component renders (numbers, epoch seconds). */
export function toMarketRecord(m: ApiMarket): PredictionMarketRecord {
  return {
    contractId: m.contractId,
    marketId: m.marketId,
    question: m.question,
    imageUrl: m.imageUrl,
    description: m.description,
    resolutionDescription: m.resolutionDescription,
    category: m.category,
    metadata: m.metadata,
    createdAt: secs(m.createdAt) ?? 0,
    expiresAt: secs(m.expiresAt) ?? 0,
    gracePeriodSecs: m.gracePeriodSecs,
    isDynamic: m.isDynamic,
    liquidityPeriodSecs: m.liquidityPeriodSecs,
    reserveYes: toNumber(m.reserveYes),
    reserveNo: toNumber(m.reserveNo),
    liquidityL: toNumber(m.liquidityL),
    lpTokenSupply: toNumber(m.lpTokenSupply),
    currentPrice: toNumber(m.currentPrice),
    feeBps: m.feeBps,
    prizeFeeShareBps: m.prizeFeeShareBps,
    accumulatedFeesCC: toNumber(m.accumulatedFeesCC),
    prizePoolCC: toNumber(m.prizePoolCC),
    totalVolumeCC: toNumber(m.totalVolumeCC),
    status: m.status,
    outcome: (m.outcome as OutcomeTag | null) ?? null,
    resolvedAt: secs(m.resolvedAt),
    proposal: m.proposal
      ? {
          proposer: m.proposal.proposer,
          proposedOutcome: m.proposal.proposedOutcome as OutcomeTag,
          proposedAt: secs(m.proposal.proposedAt) ?? 0,
          bondCC: toNumber(m.proposal.bondCC),
          challenger: m.proposal.challenger,
          challengerOutcome: (m.proposal.challengerOutcome as OutcomeTag | null) ?? null,
        }
      : null,
    policy: {
      operatorResolution: m.policy.operatorResolution,
      sources: m.policy.sources,
      sourceKeys: m.policy.sourceKeys,
      reporters: m.policy.reporters,
      quorum: m.policy.quorum,
      challengeSecs: m.policy.challengeSecs,
      bondCC: toNumber(m.policy.bondCC),
    },
    createdEventBlob: m.createdEventBlob ?? undefined,
    synchronizerId: m.synchronizerId ?? undefined,
    // catalog + exchange figures (index only)
    ticker: m.ticker,
    eventTicker: m.eventTicker,
    seriesTicker: m.seriesTicker,
    yesSubTitle: m.yesSubTitle,
    noSubTitle: m.noSubTitle,
    templateId: m.templateId ?? undefined,
    previousPrice: m.previousPrice === null ? null : toNumber(m.previousPrice),
    priceChange24h: m.priceChange24h === null ? null : toNumber(m.priceChange24h),
    volume24hCC: toNumber(m.volume24hCC),
    openInterest: toNumber(m.openInterest.total),
    liquidityCC: toNumber(m.liquidityCC),
    book: m.book
      ? {
          yesBid: toNumber(m.book.yesBid),
          yesAsk: toNumber(m.book.yesAsk),
          noBid: toNumber(m.book.noBid),
          noAsk: toNumber(m.book.noAsk),
        }
      : null,
    tradeCount: m.tradeCount,
    updatedOffset: m.updatedOffset,
  };
}

// ---------------------------------------------------------------------------
// Backend reads
// ---------------------------------------------------------------------------

export interface MarketListQuery {
  status?: "Trading" | "Proposed" | "Resolved" | "Voided" | "active" | "settled";
  category?: string;
  event?: string;
  series?: string;
  q?: string;
  sort?: "newest" | "oldest" | "volume" | "expiry" | "activity";
  page?: number;
  limit?: number;
}

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "") continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

export function fetchMarketsPage(query: MarketListQuery = {}): Promise<ApiPage<ApiMarket>> {
  return backendFetch<ApiPage<ApiMarket>>(`/api/v1/markets${qs({ ...query, limit: query.limit ?? 100 })}`);
}

/** Every non-archived market the index knows (pages of 100, like the ledger read returned everything). */
export async function fetchAllIndexedMarkets(query: Omit<MarketListQuery, "page" | "limit"> = {}): Promise<ApiMarket[]> {
  const out: ApiMarket[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const res = await fetchMarketsPage({ ...query, page, limit: 100 });
    out.push(...res.items);
    if (out.length >= res.total || res.items.length === 0) break;
  }
  return out;
}

/** `:market` is a numeric id or a ticker. */
export function fetchIndexedMarket(ref: string | number): Promise<ApiMarket> {
  return backendFetch<{ market: ApiMarket }>(`/api/v1/markets/${encodeURIComponent(String(ref))}`).then((r) => r.market);
}

export function fetchCandlesticks(
  ref: string | number,
  opts: { startTs?: number; endTs?: number; periodInterval: CandlePeriod },
): Promise<ApiCandlesticks> {
  return backendFetch<ApiCandlesticks>(`/api/v1/markets/${encodeURIComponent(String(ref))}/candlesticks${qs(opts)}`);
}

/** Every market of an event on one aligned grid (docs/MARKETS.md §5) — the event chart's single request. */
export function fetchEventCandlesticks(
  ticker: string,
  opts: { startTs?: number; endTs?: number; periodInterval: CandlePeriod },
): Promise<ApiEventCandlesticks> {
  return backendFetch<ApiEventCandlesticks>(`/api/v1/events/${encodeURIComponent(ticker)}/candlesticks${qs(opts)}`);
}

/** The backend answers `{ items, nextCursor }`; an older shape (`trades` / bare array) is tolerated. */
function asTradeList(raw: unknown): ApiTradeList {
  if (Array.isArray(raw)) return { items: raw as ApiTrade[], nextCursor: null };
  const r = (raw ?? {}) as { items?: ApiTrade[]; trades?: ApiTrade[]; nextCursor?: string | null };
  return { items: r.items ?? r.trades ?? [], nextCursor: r.nextCursor ?? null };
}

export function fetchMarketTrades(ref: string | number, opts: { limit?: number; cursor?: string } = {}): Promise<ApiTradeList> {
  return backendFetch<unknown>(`/api/v1/markets/${encodeURIComponent(String(ref))}/trades${qs({ limit: opts.limit ?? 30, cursor: opts.cursor })}`).then(asTradeList);
}

export function fetchEventTrades(ticker: string, opts: { limit?: number; cursor?: string } = {}): Promise<ApiTradeList> {
  return backendFetch<unknown>(`/api/v1/events/${encodeURIComponent(ticker)}/trades${qs({ limit: opts.limit ?? 30, cursor: opts.cursor })}`).then(asTradeList);
}

export function fetchQuote(
  ref: string | number,
  query: { action: "buy" | "sell" | "swap" | "provide_liquidity"; side?: "Yes" | "No"; amountCC?: string; shares?: string; slippageBps?: number },
): Promise<ApiQuote> {
  return backendFetch<ApiQuote>(`/api/v1/markets/${encodeURIComponent(String(ref))}/quote${qs(query)}`);
}

export function prepareOrder(ref: string | number, body: PrepareOrderRequest): Promise<ApiPreparedOrder> {
  return backendFetch<ApiPreparedOrder>(`/api/v1/markets/${encodeURIComponent(String(ref))}/orders/prepare`, {
    method: "POST",
    body,
  });
}

export function fetchSeriesList(query: { category?: string; q?: string; status?: "active" | "archived" | "all" } = {}): Promise<ApiPage<ApiSeries>> {
  return backendFetch<ApiPage<ApiSeries>>(`/api/v1/series${qs({ ...query, limit: 100 })}`);
}

export function fetchSeries(ticker: string): Promise<{ series: ApiSeries; events: ApiEvent[] }> {
  return backendFetch<{ series: ApiSeries; events: ApiEvent[] }>(`/api/v1/series/${encodeURIComponent(ticker)}`);
}

export interface EventListQuery {
  series?: string;
  status?: EventStatus | "all";
  category?: string;
  q?: string;
  sort?: EventSort;
  withNestedMarkets?: boolean;
  page?: number;
  limit?: number;
}

export function fetchEvents(query: EventListQuery = {}): Promise<ApiPage<ApiEvent>> {
  return backendFetch<ApiPage<ApiEvent>>(`/api/v1/events${qs({ ...query, limit: query.limit ?? 100 })}`);
}

export function fetchEvent(ticker: string): Promise<ApiEvent> {
  return backendFetch<{ event: ApiEvent }>(`/api/v1/events/${encodeURIComponent(ticker)}`).then((r) => r.event);
}

export function fetchExchangeStatus(): Promise<ApiExchangeStatus> {
  return backendFetch<ApiExchangeStatus>("/api/v1/exchange/status");
}

/** Long-poll the index until it has applied `offset` (or the server's timeout passes). */
export async function waitForLedgerOffset(offset: number, timeoutMs = 10_000): Promise<boolean> {
  const res = await backendFetch<{ reached: boolean; offset: number }>(
    `/api/v1/ledger/wait${qs({ offset, timeoutMs: Math.min(30_000, Math.max(0, timeoutMs)) })}`,
  );
  return res.reached;
}

// ---------------------------------------------------------------------------
// The one source components read markets from
// ---------------------------------------------------------------------------

export type MarketSourceKind = "index" | "ledger";

async function indexAvailable(): Promise<boolean> {
  const availability: BackendAvailability = await probeBackend();
  return availability === "ok";
}

/**
 * Backend index first, participant read second. The two never mix inside one answer, and
 * `source` says which one it was so a component can hide index-only features (candles,
 * events) on a ledger-only deployment.
 */
export const marketSource = {
  async all(): Promise<{ markets: PredictionMarketRecord[]; source: MarketSourceKind }> {
    if (await indexAvailable()) {
      try {
        const markets = (await fetchAllIndexedMarkets()).map(toMarketRecord);
        setPrefetchedMarkets(markets);
        return { markets, source: "index" };
      } catch {
        // fall through to the ledger read below
      }
    }
    const markets = await fetchAllPredictionMarkets();
    return { markets, source: "ledger" };
  },

  /** One market by id or ticker — on the ledger path a ticker cannot be resolved. */
  async one(ref: string): Promise<{ market: PredictionMarketRecord | null; source: MarketSourceKind }> {
    if (await indexAvailable()) {
      try {
        return { market: toMarketRecord(await fetchIndexedMarket(ref)), source: "index" };
      } catch (e) {
        if ((e as { status?: number }).status === 404) return { market: null, source: "index" };
      }
    }
    const id = Number(ref);
    if (!Number.isFinite(id)) return { market: null, source: "ledger" };
    const all = await fetchAllPredictionMarkets();
    return { market: all.find((m) => m.marketId === id) ?? null, source: "ledger" };
  },

  indexAvailable,
};

// ---------------------------------------------------------------------------
// The signed-in account's own ledger view, read from the index as the treasury — the reads
// that come back empty when a browser asks the participant as an external party on mainnet.
// ---------------------------------------------------------------------------

import type { ApiIndexedWallet, ApiLiquidityPosition, ApiPosition } from "@/lib/marketsTypes";
import type { LiquidityPositionRecord, UserMarketPosition, UserWalletRecord } from "@/utils/activeContracts";

export function fetchMyPositions(status: "open" | "all" = "open"): Promise<{ parties: string[]; positions: ApiPosition[] }> {
  return backendFetch<{ parties: string[]; positions: ApiPosition[] }>(`/api/v1/me/positions?status=${status}`);
}

export function fetchMyLiquidity(status: "open" | "all" = "open"): Promise<{ parties: string[]; positions: ApiLiquidityPosition[] }> {
  return backendFetch<{ parties: string[]; positions: ApiLiquidityPosition[] }>(`/api/v1/me/liquidity?status=${status}`);
}

export function fetchMyLedgerWallet(): Promise<{ partyId: string | null; wallet: ApiIndexedWallet | null }> {
  return backendFetch<{ partyId: string | null; wallet: ApiIndexedWallet | null }>("/api/v1/in-app-wallet/ledger");
}

/** The account's position, LP position and in-app wallet for one market, in the shapes the market page renders. */
export async function fetchMyMarketView(marketId: number): Promise<{
  position: UserMarketPosition | null;
  lpPosition: LiquidityPositionRecord | null;
  wallet: UserWalletRecord | null;
  party: string | null;
}> {
  const [pos, lp, w] = await Promise.all([fetchMyPositions("open"), fetchMyLiquidity("open"), fetchMyLedgerWallet()]);
  const p = pos.positions.find((x) => x.marketId === marketId && x.active) ?? null;
  const l = lp.positions.find((x) => x.marketId === marketId && x.active) ?? null;
  return {
    position: p
      ? { contractId: p.contractId, marketId: p.marketId, yesShares: toNumber(p.yesShares), noShares: toNumber(p.noShares), costBasisCC: toNumber(p.costBasisCC) }
      : null,
    lpPosition: l
      ? { contractId: l.contractId, marketId: l.marketId, provider: l.provider, lpTokens: toNumber(l.lpTokens), depositedCC: toNumber(l.depositedCC) }
      : null,
    wallet: w.wallet
      ? {
          contractId: w.wallet.contractId,
          admin: "",
          owner: w.wallet.owner,
          balanceCC: toNumber(w.wallet.balanceCC),
          depositedCC: toNumber(w.wallet.depositedCC),
          withdrawnCC: toNumber(w.wallet.withdrawnCC),
        }
      : null,
    party: w.partyId,
  };
}

/**
 * After the wallet accepted a prepared order: wait until the index reflects it. A consuming
 * choice (buy, sell, swap, liquidity) produces a new market version, so the market's
 * `updatedOffset` moves past the offset the order was prepared at; a non-consuming one
 * (split, merge, redeem) shows up as a new Position version. Bounded; false = still pending.
 */
export async function waitForTradeLanding(prepared: ApiPreparedOrder, timeoutMs = 20_000): Promise<boolean> {
  const consuming = !["split", "merge", "redeem"].includes(prepared.action);
  const deadline = Date.now() + timeoutMs;
  let floor = prepared.ledgerOffset;
  while (Date.now() < deadline) {
    await waitForLedgerOffset(floor + 1, Math.min(5_000, Math.max(500, deadline - Date.now()))).catch(() => false);
    try {
      if (consuming) {
        const m = await fetchIndexedMarket(prepared.marketId);
        if (m.updatedOffset > prepared.ledgerOffset) return true;
        floor = Math.max(floor, m.updatedOffset);
      } else {
        const { positions } = await fetchMyPositions("all");
        if (positions.some((p) => p.marketId === prepared.marketId && (p.createdOffset > prepared.ledgerOffset || (p.archivedAt !== null && !p.active && p.createdOffset <= prepared.ledgerOffset && prepared.action === "redeem"))))
          return true;
        floor += 1;
      }
    } catch {
      // transient; keep waiting until the deadline
    }
  }
  return false;
}
