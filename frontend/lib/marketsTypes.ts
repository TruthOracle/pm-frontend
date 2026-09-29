/**
 * Wire shapes of the backend's market catalog, candles, quotes and orders
 * (truthoracle-backend/docs/API.md "Markets", "Candlesticks", "Quotes and orders", "Catalog",
 * "Exchange"; docs/MARKETS.md). Decimals are 10-dp STRINGS on the wire; `toNumber` converts them
 * for display and for the local pm-AMM mirror — never for anything the ledger executes.
 */

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
  referenceCC: Decimal;
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
  accumulatedFeesCC: Decimal;
  prizePoolCC: Decimal;
  totalVolumeCC: Decimal;
  status: ApiMarketStatus;
  outcome: ApiOutcome | null;
  resolvedAt: string | null;
  proposal: {
    proposer: string;
    proposedOutcome: ApiOutcome;
    proposedAt: string;
    bondCC: Decimal;
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
    bondCC: Decimal;
  };
  auditObservers: string[];
  phase: ApiPhase;
  archived: boolean;
  tradeCount: number;
  lastTradeAt: string | null;
  previousPrice: Decimal | null;
  priceChange24h: Decimal | null;
  volume24hCC: Decimal;
  openInterest: { yes: Decimal; no: Decimal; total: Decimal };
  liquidityCC: Decimal;
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
  eventCount: number;
  marketCount: number;
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
  marketCount: number;
  volumeCC: Decimal;
  closeTime: string | null;
  markets?: ApiMarket[];
  createdAt: string;
  updatedAt: string;
}

export type CandlePeriod = 1 | 60 | 1440;

export interface ApiCandle {
  startTs: number;
  endTs: number;
  price: { open: Decimal; high: Decimal; low: Decimal; close: Decimal; mean: Decimal; previous: Decimal | null };
  volumeCC: Decimal;
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
  minProceedsCC?: Decimal;
  maxCostCC?: Decimal;
}

export type ApiQuoteBody =
  | { action: "buy"; side: TradeSide; collateralCC: Decimal; feeCC: Decimal; netCC: Decimal; sharesOut: Decimal; avgPrice: Decimal; priceBefore: Decimal; priceAfter: Decimal; priceImpact: Decimal; maxPayoutCC: Decimal }
  | { action: "sell"; side: TradeSide; sharesIn: Decimal; grossCC: Decimal; feeCC: Decimal; netCC: Decimal; avgPrice: Decimal; priceBefore: Decimal; priceAfter: Decimal; priceImpact: Decimal }
  | { action: "swap"; fromSide: TradeSide; sharesIn: Decimal; feeShares: Decimal; sharesOut: Decimal; priceBefore: Decimal; priceAfter: Decimal; priceImpact: Decimal }
  | { action: "provide_liquidity"; valueIncreaseCC: Decimal; costCC: Decimal; lpMinted: Decimal; poolShare: Decimal; newL: Decimal };

export interface ApiQuote {
  marketId: number;
  ticker: string;
  contractId: string;
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
  amountCC?: string;
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
  expectedMarketId: number | null;
}

// ── the signed-in account's ledger view (docs/API.md "Portfolio", "In-app wallet ledger") ──

export interface ApiPosition {
  contractId: string;
  holder: string;
  marketId: number;
  yesShares: Decimal;
  noShares: Decimal;
  costBasisCC: Decimal;
  active: boolean;
  createdAt: string;
  createdOffset: number;
  archivedAt: string | null;
  valueCC: Decimal | null;
  redeemableCC: Decimal | null;
}

export interface ApiLiquidityPosition {
  contractId: string;
  provider: string;
  marketId: number;
  lpTokens: Decimal;
  depositedCC: Decimal;
  active: boolean;
  createdAt: string;
  createdOffset: number;
  archivedAt: string | null;
  poolShare: Decimal | null;
}

export interface ApiIndexedWallet {
  contractId: string;
  owner: string;
  balanceCC: Decimal;
  depositedCC: Decimal;
  withdrawnCC: Decimal;
  depositRefs: string[];
  updatedOffset: number;
  updatedAt: string;
}
