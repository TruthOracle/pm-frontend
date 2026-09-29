/**
 * The outcome table shared by the homepage trending board and the event cards (Kalshi's layout):
 * which outcomes get a row, in what colour, with which image and where each links to.
 */
import { outcomeLabel } from "@/lib/boardFormat";
import { toNumber, type ApiEvent, type ApiMarket } from "@/lib/marketsTypes";

/** Underline of the No side of a single binary market (it has no line of its own on a chart). */
export const NO_SIDE_COLOR = "#cbd5e1";

export type OutcomeResult = "won" | "lost" | "void";

export interface OutcomeRow {
  key: string;
  ticker: string;
  label: string;
  /** Full question, for the hover title. */
  title: string;
  /** Chance of this row's side, 0..1. */
  price: number;
  color: string;
  /** The outcome's own image; "" when it has none (never the event banner again). */
  image: string;
  href: string;
  /** Set once the market is settled: the row shows the result instead of the odds. */
  result: OutcomeResult | null;
}

/** A market's own image: its metadata override, unless it is just the event's banner again. */
export function ownImage(m: Pick<ApiMarket, "metadata">, eventImage: string): string {
  const own = m.metadata?.imageUrl?.trim() ?? "";
  return own && own !== eventImage ? own : "";
}

function sideResult(m: Pick<ApiMarket, "status" | "outcome">, side: "Yes" | "No"): OutcomeResult | null {
  if (m.status === "Voided" || m.outcome === "VoidOutcome") return "void";
  if (m.status !== "Resolved" || !m.outcome) return null;
  return m.outcome === side ? "won" : "lost";
}

/**
 * Rows for an event whose markets are already sorted likeliest first.
 * - one market: its Yes and No sides (both sides of one market share its image, so none);
 * - up to `showAllUpTo` markets: every one;
 * - more: the top `maxRows`, with `hidden` counting the rest.
 */
export function outcomeRows(
  event: Pick<ApiEvent, "imageUrl">,
  sortedMarkets: ApiMarket[],
  colorOf: (ticker: string) => string,
  { maxRows, showAllUpTo = maxRows }: { maxRows: number; showAllUpTo?: number },
): { rows: OutcomeRow[]; hidden: number } {
  if (sortedMarkets.length === 1) {
    const m = sortedMarkets[0];
    const p = toNumber(m.currentPrice);
    return {
      rows: [
        { key: `${m.ticker}:yes`, ticker: m.ticker, label: m.yesSubTitle || "Yes", title: m.question, price: p, color: colorOf(m.ticker), image: "", href: `/markets/${m.ticker}?side=yes`, result: sideResult(m, "Yes") },
        { key: `${m.ticker}:no`, ticker: m.ticker, label: m.noSubTitle || "No", title: m.question, price: 1 - p, color: NO_SIDE_COLOR, image: "", href: `/markets/${m.ticker}?side=no`, result: sideResult(m, "No") },
      ],
      hidden: 0,
    };
  }
  const count = sortedMarkets.length <= showAllUpTo ? sortedMarkets.length : Math.min(maxRows, sortedMarkets.length);
  const rows = sortedMarkets.slice(0, count).map((m) => ({
    key: m.ticker,
    ticker: m.ticker,
    label: outcomeLabel(m),
    title: m.question,
    price: toNumber(m.currentPrice),
    color: colorOf(m.ticker),
    image: ownImage(m, event.imageUrl),
    href: `/markets/${m.ticker}?side=yes`,
    result: sideResult(m, "Yes"),
  }));
  return { rows, hidden: sortedMarkets.length - count };
}

/** Images only when every row has its own: a mix would leave the names ragged. */
export function rowsHaveOwnImages(rows: OutcomeRow[]): boolean {
  return rows.length > 0 && rows.every((r) => r.image);
}

/** Width of the probability underline, in percent of the name column (never invisible). */
export function barWidthPercent(price: number): number {
  return Math.max(3, Math.min(100, price * 100));
}

export function resultLabel(result: OutcomeResult): string {
  return result === "won" ? "Won" : result === "lost" ? "Lost" : "Void";
}
