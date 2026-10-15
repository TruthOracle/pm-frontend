/**
 * Recent pool trades of a market or a whole event (`GET /markets/:market/trades`,
 * `GET /events/:ticker/trades`): side-coloured, newest first, relative times, the taker masked
 * by the backend. Polled with the page.
 */
import { Link } from "react-router-dom";
import { compactAmount, formatCents, maskParty, relativeTime } from "@/lib/chartData";
import { toNumber, type ApiTrade } from "@/lib/marketsTypes";
import { cn } from "@/lib/utils";

/** The backend spells the side like the Daml outcome (`Yes` / `No`); accept either case. */
export const isYesSide = (side: string): boolean => String(side).toLowerCase() === "yes";

export default function TradeFeed({ trades, loading = false, showMarket = false, emptyText = "No trades yet.", limit }: { trades: ApiTrade[]; loading?: boolean; showMarket?: boolean; emptyText?: string; limit?: number }) {
  const rows = limit ? trades.slice(0, limit) : trades;
  if (loading && rows.length === 0) {
    return (
      <div className="space-y-2 p-4">
        {[0, 1, 2].map((i) => <div key={i} className="skeleton h-5 w-full" />)}
      </div>
    );
  }
  if (rows.length === 0) return <div className="px-4 py-8 text-center text-xs text-slate-500">{emptyText}</div>;
  return (
    <ul>
      {rows.map((t) => {
        const yes = isYesSide(t.side);
        const price = yes ? toNumber(t.yesPrice) : toNumber(t.noPrice);
        const verb = t.action === "buy" ? "Bought" : t.action === "sell" ? "Sold" : "Swapped";
        return (
          <li key={t.tradeId} className="trade-feed-row">
            <span className={cn("trade-feed-side", yes ? "trade-feed-side-yes" : "trade-feed-side-no")}>{yes ? "Yes" : "No"}</span>
            <span className="min-w-0 flex-1 truncate text-slate-700">
              <span className="font-mono text-[11px] text-slate-400">{maskParty(t.takerParty)}</span> {verb.toLowerCase()}{" "}
              <span className="k-num font-semibold text-slate-950">{toNumber(t.shares).toFixed(1)}</span> shares at{" "}
              <span className="k-num font-semibold text-slate-950">{formatCents(price)}</span>
              {showMarket && (
                <>
                  {" "}·{" "}
                  <Link to={`/markets/${t.ticker}`} className="font-mono text-[11px] text-slate-500 hover:text-slate-950">{t.ticker}</Link>
                </>
              )}
            </span>
            <span className="k-num hidden text-slate-500 sm:inline">{compactAmount(t.notional, t.instrument)}</span>
            <span className="k-num shrink-0 text-slate-400">{relativeTime(t.createdAt)}</span>
          </li>
        );
      })}
    </ul>
  );
}
