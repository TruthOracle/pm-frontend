import { Link, useNavigate } from "react-router-dom";
import { formatCents } from "@/lib/marketPricing";
import { formatMoney } from "@/lib/instruments";
import { cn } from "@/lib/utils";
import { TrendingUp, CheckCircle2, Clock } from "lucide-react";
import type { PredictionMarketRecord } from "@/utils/activeContracts";

export type MarketCardProps = {
  market: PredictionMarketRecord;
};

function expiresLabel(expiresAt: number): string {
  const s = expiresAt - Math.floor(Date.now() / 1000);
  if (s <= 0) return "Expired";
  const d = Math.floor(s / 86400);
  if (d > 0) return `${d}d left`;
  const h = Math.floor(s / 3600);
  if (h > 0) return `${h}h left`;
  return `${Math.floor(s / 60)}m left`;
}

const MarketCard = ({ market }: MarketCardProps) => {
  const navigate = useNavigate();
  const settled = market.status === "Resolved" || market.status === "Voided";
  const ref = market.ticker ?? String(market.marketId);
  const handleCardClick = () => navigate(`/market/${ref}`);
  const change = market.priceChange24h == null ? null : market.priceChange24h * 100;

  const probYes = market.currentPrice;
  const yesPct = Math.round(probYes * 100);

  const resultLabel = (() => {
    if (!settled) return null;
    if (market.status === "Voided" || market.outcome === "VoidOutcome") return "Voided";
    if (market.outcome === "Yes") return "Yes Won";
    if (market.outcome === "No") return "No Won";
    return "Resolved";
  })();

  const handleOutcomeClick = (e: React.MouseEvent, side: "yes" | "no") => {
    e.stopPropagation();
    navigate(`/market/${ref}?side=${side}`);
  };

  return (
    <article className="market-card cursor-pointer p-4" onClick={handleCardClick}>
      {/* Header row */}
      <div className="mb-3 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-secondary ring-1 ring-border">
          {market.imageUrl ? (
            <img
              src={market.imageUrl}
              alt=""
              className="h-full w-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <TrendingUp className="h-4 w-4 text-primary" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">
            {market.question}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span className="font-mono">{market.ticker}</span>
            <Link to={`/events/${market.eventTicker}`} onClick={(e) => e.stopPropagation()} className="text-oracle-purple hover:underline">
              {market.eventTicker}
            </Link>
            {market.category && <span className="text-oracle-blue">{market.category}</span>}
            {!settled && (
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {expiresLabel(market.expiresAt)}
              </span>
            )}
            {market.status === "Proposed" && (
              <span className="text-oracle-purple">Proposed</span>
            )}
            {market.status === "Trading" &&
              Math.floor(Date.now() / 1000) < market.createdAt + market.liquidityPeriodSecs && (
                <span className="text-oracle-blue">Liquidity period</span>
              )}
          </div>
        </div>
      </div>

      {!settled ? (
        <>
          {/* Yes / No buttons */}
          <div className="flex gap-2">
            <button className="btn-yes" onClick={(e) => handleOutcomeClick(e, "yes")} title={market.yesSubTitle || undefined}>
              {market.yesSubTitle ? `${market.yesSubTitle} ` : "Yes "}
              {formatCents(probYes)}
            </button>
            <button className="btn-no" onClick={(e) => handleOutcomeClick(e, "no")} title={market.noSubTitle || undefined}>
              {market.noSubTitle ? `${market.noSubTitle} ` : "No "}
              {formatCents(1 - probYes)}
            </button>
          </div>
          {change !== null && (
            <div className={cn("mt-2 text-right text-[11px] font-semibold", change >= 0 ? "text-emerald-600" : "text-rose-600")}>
              {change >= 0 ? "+" : ""}
              {change.toFixed(1)} pts · 24h
            </div>
          )}
          {/* Stats row: volume · reserves · fee · expiry */}
          <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-border pt-2 text-[11px] text-muted-foreground">
            <div className="flex justify-between">
              <span>{market.volume24h !== undefined ? "24h volume" : "Volume"}</span>
              <span className="font-medium text-foreground">{formatMoney(market.volume24h ?? market.totalVolume, market.collateral, 1)}</span>
            </div>
            <div className="flex justify-between">
              <span>{market.openInterest !== undefined ? "Open interest" : "Reserves"}</span>
              <span className="font-medium text-foreground">
                {(market.openInterest ?? market.reserveYes + market.reserveNo).toFixed(1)}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Fee</span>
              <span className="font-medium text-foreground">{(market.feeBps / 100).toFixed(2)}%</span>
            </div>
            <div className="flex justify-between">
              <span>Expires</span>
              <span className="font-medium text-foreground">{expiresLabel(market.expiresAt)}</span>
            </div>
          </div>
          {market.isDynamic && (
            <div className="mt-1 text-right text-[11px] text-oracle-purple">dynamic pm-AMM</div>
          )}
        </>
      ) : (
        <div className="flex items-center gap-2 rounded-lg bg-secondary px-3 py-2.5">
          <CheckCircle2
            className={cn(
              "h-4 w-4 shrink-0",
              market.outcome === "Yes" && "text-oracle-yes",
              market.outcome === "No" && "text-oracle-no",
              (market.status === "Voided" || market.outcome === "VoidOutcome") && "text-muted-foreground"
            )}
          />
          <span className="text-sm font-medium text-foreground">{resultLabel}</span>
          <span className="ml-auto text-xs text-muted-foreground">Final: {yesPct}% Yes</span>
        </div>
      )}
    </article>
  );
};

export default MarketCard;
