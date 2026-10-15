/**
 * The portfolio's position rows and their per-instrument totals, as pure functions over what the
 * ledger shows: every `Position` the party holds joined with its `PredictionMarket`. Money here
 * is in the MARKET'S collateral — a position on a cBYN market and one on a Canton Coin market do
 * not add up to one figure — so the summary groups cost basis and redeemable value by instrument
 * (resolved against the catalog for its symbol and decimals) and never sums across them.
 * Rendering lives in Summary.tsx and Activity.tsx; this module is what the unit tests exercise.
 */
import type { PredictionMarketRecord, UserMarketPosition } from "@/utils/activeContracts";
import { instrumentKey, resolveInstrument, type ApiInstrument, type InstrumentRef } from "@/lib/instruments";

/** One row per market the user has a Position in. */
export interface ActivityRow {
  position: UserMarketPosition;
  market: PredictionMarketRecord | null;
  /** Redeemable collateral (winning shares 1:1 when Resolved; bounded cost basis when Voided). */
  redeemable: number;
}

export function buildRows(positions: UserMarketPosition[], markets: PredictionMarketRecord[]): ActivityRow[] {
  const byId = new Map(markets.map((m) => [m.marketId, m]));
  return positions.map((position) => {
    const market = byId.get(position.marketId) ?? null;
    let redeemable = 0;
    if (market?.status === "Resolved") {
      redeemable = market.outcome === "Yes" ? position.yesShares : market.outcome === "No" ? position.noShares : 0;
    } else if (market?.status === "Voided") {
      redeemable = Math.min(position.costBasis, Math.max(position.yesShares, position.noShares));
    }
    return { position, market, redeemable };
  });
}

export function statusLabel(market: PredictionMarketRecord | null, nowSecs = Math.floor(Date.now() / 1000)): string {
  if (!market) return "Unknown";
  switch (market.status) {
    case "Trading":
      return nowSecs >= market.expiresAt ? "Awaiting resolution" : "Active";
    case "Proposed":
      return "Outcome proposed";
    case "Resolved":
      return `Resolved (${market.outcome ?? "?"})`;
    case "Voided":
      return "Voided";
    default:
      return market.status;
  }
}

/** The rows of one instrument added up: lifetime cost basis, what is redeemable now, and how many markets. */
export interface InstrumentTotals {
  instrument: InstrumentRef;
  costBasis: number;
  redeemable: number;
  markets: number;
}

export interface PortfolioSummary {
  /** Markets the party holds a position in (rows whose market is unknown included). */
  markets: number;
  /** Markets still trading or awaiting resolution. */
  open: number;
  /** Markets with something to redeem now. */
  redeemableMarkets: number;
  /** Per collateral, first-seen order; rows whose market the ledger did not return have no instrument and are left out. */
  byInstrument: InstrumentTotals[];
}

export function summarizeRows(rows: ActivityRow[], instruments?: ApiInstrument[]): PortfolioSummary {
  const totals = new Map<string, InstrumentTotals>();
  let open = 0;
  let redeemableMarkets = 0;
  for (const row of rows) {
    if (row.market && (row.market.status === "Trading" || row.market.status === "Proposed")) open += 1;
    if (row.redeemable > 0) redeemableMarkets += 1;
    if (!row.market) continue;
    const instrument = resolveInstrument(instruments, row.market.collateral);
    const key = instrumentKey(instrument);
    const current = totals.get(key) ?? { instrument, costBasis: 0, redeemable: 0, markets: 0 };
    current.costBasis += row.position.costBasis;
    current.redeemable += row.redeemable;
    current.markets += 1;
    totals.set(key, current);
  }
  return { markets: rows.length, open, redeemableMarkets, byInstrument: [...totals.values()] };
}
