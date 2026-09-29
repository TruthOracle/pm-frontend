/**
 * The homepage hero, event-based like the marketplace cards: the most traded event over the
 * last day (`GET /events?sort=trending&withNestedMarkets=true`, first item) with its outcomes,
 * the multi-line event chart and event-wide figures. A binary event (one market) keeps the big
 * single-percentage treatment with the single-market chart.
 */
import { Link } from "react-router-dom";
import { ArrowRight, Clock } from "lucide-react";
import EventPriceChart from "@/components/charts/EventPriceChart";
import PriceChart from "@/components/charts/PriceChart";
import { compactCC, formatCents, formatPercent, marketColorMap, priceDelta, timeLeft } from "@/lib/chartData";
import { toNumber, type ApiEvent, type ApiMarket } from "@/lib/marketsTypes";
import { cn } from "@/lib/utils";

const MAX_ROWS = 3;

function outcomeLabel(m: ApiMarket): string {
  return m.yesSubTitle && m.yesSubTitle.toLowerCase() !== "yes" ? m.yesSubTitle : m.question;
}

export default function TrendingEventHero({ event }: { event: ApiEvent }) {
  const markets = [...(event.markets ?? []).filter((m) => !m.archived)].sort((a, b) => toNumber(b.currentPrice) - toNumber(a.currentPrice));
  const binary = markets.length === 1;
  const lead = markets[0];
  // The same palette the chart assigns, so a row's figure matches its line.
  const colors = marketColorMap(markets);
  const shown = markets.slice(0, MAX_ROWS);
  const hidden = markets.length - shown.length;
  const leadPrice = lead ? toNumber(lead.currentPrice) : 0;
  const leadDelta = lead ? priceDelta(leadPrice, lead.previousPrice === null ? null : toNumber(lead.previousPrice)) : null;
  const volume24h = event.volume24hCC !== undefined ? toNumber(event.volume24hCC) : markets.reduce((acc, m) => acc + toNumber(m.volume24hCC), 0);

  return (
    <div className="featured-market-card">
      <div className="flex items-center justify-between">
        <div className="eyebrow !mb-0">
          <span className="live-dot" /> Trending event
        </div>
        <span className="soft-badge -mr-1 sm:-mr-2">{event.category || event.seriesTicker}</span>
      </div>
      <Link to={`/events/${event.ticker}`} className="group/title block">
        <h2 className="mt-3 max-w-xl text-2xl font-bold tracking-[-0.04em] text-slate-950 transition-colors group-hover/title:text-primary group-active/title:text-primary sm:text-3xl">{event.title}</h2>
      </Link>
      {event.subTitle && <p className="mt-1 text-sm text-slate-500">{event.subTitle}</p>}

      <div className="my-auto grid gap-5 pt-6 sm:grid-cols-[1fr_1.25fr] sm:items-center">
        {binary && lead ? (
          <div>
            <p className="text-sm font-medium text-slate-500">Chance of {outcomeLabel(lead) === lead.question ? "Yes" : outcomeLabel(lead)}</p>
            <p className="k-num mt-1 text-5xl font-bold tracking-[-0.07em] text-slate-950">{formatPercent(leadPrice)}</p>
            {leadDelta && <p className={cn("k-num mt-1 text-sm font-semibold", leadDelta.direction === "up" ? "delta-up" : leadDelta.direction === "down" ? "delta-down" : "delta-flat")}>{leadDelta.text} pts today</p>}
            <div className="mt-3 prob-bar h-2">
              <div className="prob-bar-yes" style={{ width: `${Math.round(leadPrice * 100)}%` }} />
            </div>
            <div className="mt-3 flex gap-2">
              <Link to={`/markets/${lead.ticker}?side=yes`} className="pill-yes pill-lg flex-1">Yes {formatCents(leadPrice)}</Link>
              <Link to={`/markets/${lead.ticker}?side=no`} className="pill-no pill-lg flex-1">No {formatCents(1 - leadPrice)}</Link>
            </div>
          </div>
        ) : (
          <ul className="space-y-1" aria-label="Top outcomes">
            {shown.map((m) => {
              const p = toNumber(m.currentPrice);
              const delta = priceDelta(p, m.previousPrice === null ? null : toNumber(m.previousPrice));
              const color = colors.get(m.ticker);
              return (
                <li key={m.marketId} className="flex items-center gap-2 rounded-lg px-1 py-2">
                  <div className="min-w-0 flex-1">
                    <Link to={`/markets/${m.ticker}`} className="outcome-link" title={m.question}>
                      <span className="truncate">{outcomeLabel(m)}</span>
                    </Link>
                    <div className="outcome-bar mt-1.5 max-w-[11rem]"><span style={{ width: `${Math.round(p * 100)}%`, background: color }} /></div>
                  </div>
                  <div className="w-14 shrink-0 text-right">
                    <div className="k-num text-base font-bold leading-none" style={{ color }}>{formatPercent(p)}</div>
                    {delta && delta.direction !== "flat" && <div className={cn("k-num mt-0.5 text-[10px] font-semibold", delta.direction === "up" ? "delta-up" : "delta-down")}>{delta.text}</div>}
                  </div>
                  <Link to={`/markets/${m.ticker}?side=yes`} className="pill-yes">Yes {formatCents(p)}</Link>
                  <Link to={`/markets/${m.ticker}?side=no`} className="pill-no">No {formatCents(1 - p)}</Link>
                </li>
              );
            })}
            {hidden > 0 && (
              <li className="px-1 pt-1 text-[11px] font-medium text-slate-500">
                <Link to={`/events/${event.ticker}`} className="hover:text-slate-950">+{hidden} more outcome{hidden === 1 ? "" : "s"}</Link>
              </li>
            )}
          </ul>
        )}
        {binary && lead ? (
          <PriceChart marketRef={lead.ticker} createdAtSec={Math.floor(Date.parse(lead.createdAt) / 1000)} currentPrice={leadPrice} variant="compact" showTabs={false} height={176} defaultTimeframe="1W" className="!p-3" />
        ) : (
          <EventPriceChart eventTicker={event.ticker} markets={markets} variant="compact" showTabs={false} legend="static" height={176} defaultTimeframe="1W" className="!p-3" />
        )}
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/80 pt-5 text-xs text-slate-500">
        <span className="k-num inline-flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>{compactCC(volume24h)} traded in 24h</span>
          <span>{compactCC(event.volumeCC)} lifetime</span>
          <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{event.status === "settled" ? "Settled" : `closes in ${timeLeft(event.closeTime)}`}</span>
        </span>
        <Link to={`/events/${event.ticker}`} className="inline-flex items-center gap-1 font-semibold text-slate-900 hover:text-primary">
          View event <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}
