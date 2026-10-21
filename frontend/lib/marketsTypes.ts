/**
 * Wire shapes of the backend's market catalog, candles, quotes and orders
 * (truthoracle-backend/docs/API.md "Markets", "Candlesticks", "Quotes and orders", "Catalog",
 * "Exchange"; docs/MARKETS.md). Decimals are 10-dp STRINGS on the wire; `toNumber` converts them
 * for display and for the local pm-AMM mirror — never for anything the ledger executes.
 *
 * Money carries no currency suffix (docs/TOKENS.md §2): every figure is read next to the instrument
 * it is in — a market's `collateral`, a position's / trade's / wallet's `instrument` — and the
 * instrument's `symbol` and `decimals` decide how it is shown (lib/instruments.ts).
 */
import type { InstrumentRef } from "@/lib/instruments";

export type Decimal = string;
export const toNumber = (v: Decimal | null | undefined): number => (v == null ? 0 : Number(v));

export type ApiMarketStatus = "Trading" | "Proposed" | "Resolved" | "Voided";
export type ApiOutcome = "Yes" | "No" | "VoidOutcome";
export type ApiPhase = "liquidity" | "trading" | "expired" | "proposed" | "resolved" | "voided";
/** Ticker shape the backend enforces for markets, events and series (docs/MARKETS.md §2); upper-case before testing. */
export const TICKER_PATTERN = /^[A-Z0-9][A-Z0-9._-]{1,63}$/;

export interface ApiImpliedBook {
  yesBid: Decimal;
  yesAsk: Decimal;
  noBid: Decimal;
  noAsk: Decimal;
  /** The order size (in the market's collateral) the bid / ask are quoted for. */
  reference: Decimal;
}

/**
 * Operator-owned presentation of a market (truthoracle-backend docs/MARKETS.md): the contract
 * carries no image, description or category since truthoracle-v16. `null` = no override, so the
 * market's `imageUrl` is the event's and its `description` is empty.
 */
export interface ApiMarketMetadata {
  imageUrl: string;
  description: string;
  updatedAt: string | null;
}

export interface ApiMarket {
  marketId: number;
  /** On-ledger identity (truthoracle-v16): every market carries all four, non-empty, from its contract. */
  ticker: string;
  eventTicker: string;
  seriesTicker: string | null;
  yesSubTitle: string;
  noSubTitle: string;
  contractId: string;
  templateId: string | null;
  admin: string;
  /**
   * The instrument this market is denominated in (truthoracle-v17): shares cost at most one unit of
   * it, a winning share pays exactly one, fees and bonds are in it. Fixed at creation.
   */
  collateral: InstrumentRef;
  question: string;
  /** Off-ledger: the metadata override, else the event's image, else "". */
  imageUrl: string;
  /** Off-ledger: the metadata override or "". */
  description: string;
  resolutionDescription: string;
  /** Off-ledger: the event's series category, else the event's category, else "". */
  category: string;
  metadata: ApiMarketMetadata | null;
  createdAt: string;
  expiresAt: string;
  tradingStartsAt: string;
  gracePeriodSecs: number;
  isDynamic: boolean;
  liquidityPeriodSecs: number;
  reserveYes: Decimal;
  reserveNo: Decimal;
  liquidityL: Decimal;
  lpTokenSupply: Decimal;
  currentPrice: Decimal;
  feeBps: number;
  prizeFeeShareBps: number;
  accumulatedFees: Decimal;
  prizePool: Decimal;
  totalVolume: Decimal;
  status: ApiMarketStatus;
  outcome: ApiOutcome | null;
  resolvedAt: string | null;
  proposal: {
    proposer: string;
    proposedOutcome: ApiOutcome;
    proposedAt: string;
    bond: Decimal;
    challenger: string | null;
    challengerOutcome: ApiOutcome | null;
    challengeEndsAt: string;
  } | null;
  policy: {
    operatorResolution: boolean;
    sources: string[];
    sourceKeys: { sourceUri: string; publicKey: string }[];
    reporters: string[];
    quorum: number;
    challengeSecs: number;
    bond: Decimal;
  };
  auditObservers: string[];
  phase: ApiPhase;
  archived: boolean;
  tradeCount: number;
  lastTradeAt: string | null;
  previousPrice: Decimal | null;
  priceChange24h: Decimal | null;
  volume24h: Decimal;
  openInterest: { yes: Decimal; no: Decimal; total: Decimal };
  liquidity: Decimal;
  book: ApiImpliedBook | null;
  updatedOffset: number;
  createdOffset: number;
  synchronizerId: string | null;
  /** `GET /markets/:market` only. */
  createdEventBlob?: string | null;
}

export interface ApiPage<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}

export type EventStatus = "unopened" | "open" | "closed" | "settled";

export interface ApiSettlementSource {
  name: string;
  url: string;
}

export interface ApiSeries {
  ticker: string;
  title: string;
  category: string;
  frequency: "one_off" | "daily" | "weekly" | "monthly" | "quarterly" | "annual" | "custom";
  tags: string[];
  settlementSources: ApiSettlementSource[];
  contractUrl: string | null;
  description: string;
  status: "active" | "archived";
  productMetadata: Record<string, unknown>;
  /**
   * What the three figures below are computed over: the query's `?instrument=`, else the default
   * collateral; null when the platform has no collateral configured (docs/TOKENS.md §10).
   */
  instrument: InstrumentRef | null;
  /** Events of the series in that instrument, those without a market yet included. */
  eventCount: number;
  /** Their member markets in it. */
  marketCount: number;
  /** Σ `totalVolume` of those markets. */
  volume: Decimal;
  createdAt: string;
  updatedAt: string;
}

export interface ApiEvent {
  ticker: string;
  seriesTicker: string;
  title: string;
  subTitle: string;
  category: string;
  imageUrl: string;
  description: string;
  mutuallyExclusive: boolean;
  strikeDate: string | null;
  strikePeriod: string | null;
  settlementSources: ApiSettlementSource[];
  productMetadata: Record<string, unknown>;
  archived: boolean;
  status: EventStatus;
  /**
   * The event's one collateral — fixed by its first market, or by that market's accepted
   * submission (docs/TOKENS.md §2 decision 9; a second market in another instrument is refused).
   * Null until then; every aggregate below is a sum over the member markets in it.
   */
  instrument: InstrumentRef | null;
  marketCount: number;
  volume: Decimal;
  closeTime: string | null;
  /** `?withNestedMarkets=true`: ordered by current price, highest first. */
  markets?: ApiMarket[];
  /** Aggregates over the event's markets (list + detail). */
  volume24h?: Decimal;
  openInterest?: Decimal;
  liquidity?: Decimal;
  topMarket?: { ticker: string; currentPrice: Decimal } | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * The instrument an event's money figures are in. An event that has no market yet has no collateral,
 * and a figure of zero needs no label — so this may be null, and the formatters accept that.
 */
export function eventInstrument(event: Pick<ApiEvent, "instrument">): InstrumentRef | null {
  return event.instrument;
}

export type EventSort = "trending" | "newest" | "closing" | "volume";

export type CandlePeriod = 1 | 60 | 1440;

export interface ApiCandle {
  startTs: number;
  endTs: number;
  price: { open: Decimal; high: Decimal; low: Decimal; close: Decimal; mean: Decimal; previous: Decimal | null };
  /** Traded in the market's collateral over the period. */
  volume: Decimal;
  trades: number;
  openInterest: Decimal;
  liquidityL: Decimal | null;
  empty: boolean;
}

export interface ApiCandlesticks {
  marketId: number;
  ticker: string;
  periodInterval: CandlePeriod;
  startTs: number;
  endTs: number;
  candlesticks: ApiCandle[];
}

/** `GET /events/:ticker/candlesticks`: every market of the event, dense and aligned on one `[startTs, endTs)` grid. */
export interface ApiEventCandlesticks {
  eventTicker: string;
  periodInterval: CandlePeriod;
  startTs: number;
  endTs: number;
  markets: ApiEventMarketCandles[];
}

export interface ApiEventMarketCandles {
  marketId: number;
  ticker: string;
  yesSubTitle: string;
  noSubTitle: string;
  status: ApiMarketStatus;
  currentPrice: Decimal;
  candlesticks: ApiCandle[];
}

/** One pool trade (`GET /markets/:market/trades`, `GET /events/:ticker/trades`), newest first. */
export interface ApiTrade {
  tradeId: string;
  marketId: number;
  ticker: string;
  /** The market's collateral: what `notional` and `fee` are in. */
  instrument: InstrumentRef;
  /** Spelled like the Daml outcome (`Yes` / `No`); compare case-insensitively. */
  side: "Yes" | "No" | "yes" | "no";
  action: "buy" | "sell" | "swap";
  shares: Decimal;
  priceBefore: Decimal;
  priceAfter: Decimal;
  yesPrice: Decimal;
  noPrice: Decimal;
  notional: Decimal;
  fee: Decimal;
  /** Masked by the backend (`abcd…1234`). */
  takerParty: string;
  createdAt: string;
}

export interface ApiTradeList {
  items: ApiTrade[];
  nextCursor: string | null;
}

export type OrderAction =
  | "buy"
  | "sell"
  | "swap"
  | "split"
  | "merge"
  | "provide_liquidity"
  | "withdraw_liquidity"
  | "redeem";
export type TradeSide = "Yes" | "No";

export interface ApiQuoteBounds {
  slippageBps: number;
  minSharesOut?: Decimal;
  minProceeds?: Decimal;
  maxCost?: Decimal;
}

export type ApiQuoteBody =
  | {
      action: "buy";
      side: TradeSide;
      amount: Decimal;
      fee: Decimal;
      net: Decimal;
      sharesOut: Decimal;
      avgPrice: Decimal;
      priceBefore: Decimal;
      priceAfter: Decimal;
      priceImpact: Decimal;
      maxPayout: Decimal;
    }
  | {
      action: "sell";
      side: TradeSide;
      sharesIn: Decimal;
      gross: Decimal;
      fee: Decimal;
      net: Decimal;
      avgPrice: Decimal;
      priceBefore: Decimal;
      priceAfter: Decimal;
      priceImpact: Decimal;
    }
  | {
      action: "swap";
      fromSide: TradeSide;
      sharesIn: Decimal;
      feeShares: Decimal;
      sharesOut: Decimal;
      priceBefore: Decimal;
      priceAfter: Decimal;
      priceImpact: Decimal;
    }
  | {
      action: "provide_liquidity";
      valueIncrease: Decimal;
      cost: Decimal;
      lpMinted: Decimal;
      poolShare: Decimal;
      newL: Decimal;
    };

export interface ApiQuote {
  marketId: number;
  ticker: string;
  contractId: string;
  /** The market's collateral: every money figure in `quote` and `bounds` is in it. */
  instrument: InstrumentRef;
  updatedOffset: number;
  nowSeconds: number;
  phase: ApiPhase;
  effectiveL: Decimal;
  quote: ApiQuoteBody;
  bounds: ApiQuoteBounds;
}

export interface ApiExerciseCommand {
  ExerciseCommand: { templateId: string; contractId: string; choice: string; choiceArgument: Record<string, unknown> };
}

export interface ApiDisclosedContract {
  templateId: string;
  contractId: string;
  createdEventBlob: string;
  synchronizerId: string | null;
}

export interface ApiPreparedOrder {
  action: OrderAction;
  marketId: number;
  ticker: string;
  actAs: string;
  command: ApiExerciseCommand;
  disclosedContracts: ApiDisclosedContract[];
  quote: ApiQuote | null;
  inputs: {
    marketContractId: string;
    /** The account's UserWallet for the market's collateral. */
    walletContractId: string | null;
    positionContractId: string | null;
    lpPositionContractId: string | null;
  };
  ledgerOffset: number;
  nowSeconds: number;
  expiresAt: string;
}

export interface PrepareOrderRequest {
  action: OrderAction;
  side?: TradeSide;
  /** Collateral in (buy, split, provide_liquidity), in the market's instrument. */
  amount?: string;
  shares?: string;
  lpTokens?: string;
  slippageBps?: number;
}

export interface ApiExchangeStatus {
  exchangeActive: boolean;
  tradingActive: boolean;
  halt: { active: boolean; reason: string | null; since: string | null; estimatedResumeAt: string | null };
  ledger: {
    indexEnabled: boolean;
    indexRunning: boolean;
    offset: number;
    ledgerEnd: number | null;
    lag: number | null;
    lastRecordTime: string | null;
    lastError: string | null;
    stale: boolean;
  };
  network: string;
  packageName: string;
  serverTime: string;
}

export interface ApiCreateMarketResult {
  commandId: string;
  status: string;
  ticker: string;
  eventTicker: string;
  /** The collateral the market was created in (the request's, else the default collateral). */
  collateral: InstrumentRef;
  /** `MarketCounter.value + 1` at submission — the id the market will carry once indexed. */
  expectedMarketId: number | null;
}

// ── the signed-in account's ledger view (docs/API.md "Portfolio", "In-app wallet") ──

/** The market a position belongs to, as the portfolio routes embed it (`MarketSummary` in docs/API.md). */
export interface ApiMarketSummary {
  marketId: number;
  ticker: string;
  eventTicker: string;
  yesSubTitle: string;
  noSubTitle: string;
  contractId: string;
  collateral: InstrumentRef;
  question: string;
  /** Same fallback as `ApiMarket.imageUrl` (own, else the event's). */
  imageUrl: string;
  /** The series' category through the event. */
  category: string;
  status: ApiMarketStatus;
  outcome: ApiOutcome | null;
  currentPrice: Decimal;
  expiresAt: string;
  resolvedAt: string | null;
  phase: ApiPhase;
  archived: boolean;
}

export interface ApiPosition {
  contractId: string;
  holder: string;
  marketId: number;
  /** The market's collateral: what `costBasis`, `value` and `redeemable` are in. Null only when the market is not indexed (then `market` is null too). */
  instrument: InstrumentRef | null;
  yesShares: Decimal;
  noShares: Decimal;
  costBasis: Decimal;
  active: boolean;
  createdAt: string;
  createdOffset: number;
  archivedAt: string | null;
  market: ApiMarketSummary | null;
  /** Mark-to-market while Trading, the redeemable amount once settled, null when the market is unknown. */
  value: Decimal | null;
  /** Resolved: winning shares · Voided: `min(costBasis, max(yes, no))` · otherwise null. */
  redeemable: Decimal | null;
}

export interface ApiLiquidityPosition {
  contractId: string;
  provider: string;
  marketId: number;
  /** The market's collateral: what `deposited` is in. Null only when the market is not indexed. */
  instrument: InstrumentRef | null;
  lpTokens: Decimal;
  deposited: Decimal;
  active: boolean;
  createdAt: string;
  createdOffset: number;
  archivedAt: string | null;
  market: ApiMarketSummary | null;
  /** `lpTokens / market.lpTokenSupply`, 10-dp fraction; null without a market. */
  poolShare: Decimal | null;
}
