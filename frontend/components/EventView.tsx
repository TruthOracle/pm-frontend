/**
 * Event page (`/events/:ticker`), laid out like Kalshi: header, the chart with every market's
 * Yes price, the outcome rows with their prices, a sticky trade column bound to the selected
 * market (the full market page's trade logic in its `dock` variant — prepare-then-sign, halt
 * and KYC gates included), the rules, and the event's trade feed
 * (truthoracle-backend docs/MARKETS.md §3, §5).
 */
import { TradeColumn } from "@/components/TradeColumn";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowUpRight, ChevronRight, Clock, Gavel, Layers, ShieldCheck } from "lucide-react";
import EventPriceChart from "@/components/charts/EventPriceChart";
import Sparkline from "@/components/charts/Sparkline";
import TradeFeed from "@/components/TradeFeed";
import MarketView from "@/components/market/MarketView";
import { compactCC, formatCents, formatPercent, priceDelta, timeLeft } from "@/lib/chartData";
import { useEvent, useEventTrades } from "@/lib/marketQueries";
import { toNumber, type ApiEvent, type ApiMarket } from "@/lib/marketsTypes";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<ApiEvent["status"], string> = {
  unopened: "Opens soon",
  open: "Trading",
  closed: "Awaiting resolution",
  settled: "Settled",
};

function outcomeLabel(m: ApiMarket): string {
  return m.yesSubTitle && m.yesSubTitle.toLowerCase() !== "yes" ? m.yesSubTitle : m.question;
}

export default function EventView() {
  const { ticker = "" } = useParams<{ ticker: string }>();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const query = useEvent(ticker);
  const event = query.data ?? null;
  const markets = useMemo(() => {
    const all = (event?.markets ?? []).filter((m) => !m.archived);
    return [...all].sort((a, b) => toNumber(b.currentPrice) - toNumber(a.currentPrice));
  }, [event]);

  const [selected, setSelected] = useState<string | null>(params.get("market"));
  const [side, setSide] = useState<"yes" | "no" | null>((params.get("side") as "yes" | "no" | null) ?? null);
  useEffect(() => {
    if (markets.length === 0) return;
    if (!selected || !markets.some((m) => m.ticker === selected)) setSelected(markets[0].ticker);
  }, [markets, selected]);
  const select = (t: string, s: "yes" | "no" | null = null) => {
    setSelected(t);
    setSide(s);
    const next = new URLSearchParams(params);
    next.set("market", t);
    if (s) next.set("side", s);
    else next.delete("side");
    setParams(next, { replace: true });
  };
  const selectedMarket = markets.find((m) => m.ticker === selected) ?? null;
  const trades = useEventTrades(event ? event.ticker : null, 40, !!event);

  if (query.isLoading && !event) {
    return (
      <div className="page-container space-y-5 py-6">
        <div className="skeleton h-4 w-48" />
        <div className="skeleton h-9 w-2/3" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
          <div className="space-y-4">
            <div className="skeleton h-80 w-full rounded-xl" />
            <div className="skeleton h-48 w-full rounded-xl" />
          </div>
          <div className="skeleton h-96 w-full rounded-xl" />
        </div>
      </div>
    );
  }
  if (!event) {
    const notFound = (query.error as { status?: number } | null)?.status === 404;
    return (
      <div className="page-container py-16 text-center text-sm text-slate-500">
        {notFound ? "This event does not exist." : "Could not load the event."}{" "}
        <Link to="/marketplace" className="quiet-link">Back to markets</Link>
      </div>
    );
  }

  const close = event.closeTime ? new Date(event.closeTime) : null;
  const settled = event.status === "settled";
  const yesSum = markets.filter((m) => m.status === "Trading").reduce((acc, m) => acc + toNumber(m.currentPrice), 0);
  // Event-wide figures: the backend's aggregates when it sends them, else summed over the markets.
  const sum = (pick: (m: ApiMarket) => number) => markets.reduce((acc, m) => acc + pick(m), 0);
  const stats = {
    volume: toNumber(event.volumeCC),
    volume24h: event.volume24hCC !== undefined ? toNumber(event.volume24hCC) : sum((m) => toNumber(m.volume24hCC)),
    openInterest: event.openInterestCC !== undefined ? toNumber(event.openInterestCC) : sum((m) => toNumber(m.openInterest.total)),
    liquidity: event.liquidityCC !== undefined ? toNumber(event.liquidityCC) : sum((m) => toNumber(m.liquidityCC)),
    trades: sum((m) => m.tradeCount ?? 0),
    trading: markets.filter((m) => m.status === "Trading").length,
  };

  return (
    <div className="page-container space-y-5 py-6">
      <nav className="k-breadcrumb" aria-label="Breadcrumb">
        <Link to="/marketplace">Markets</Link>
        {event.category && (
          <>
            <ChevronRight className="k-breadcrumb-sep h-3.5 w-3.5" />
            <Link to={`/marketplace?category=${encodeURIComponent(event.category)}`}>{event.category}</Link>
          </>
        )}
        <ChevronRight className="k-breadcrumb-sep h-3.5 w-3.5" />
        <Link to={`/marketplace?series=${encodeURIComponent(event.seriesTicker)}`}>{event.seriesTicker}</Link>
        <ChevronRight className="k-breadcrumb-sep h-3.5 w-3.5" />
        <span className="font-mono text-slate-700">{event.ticker}</span>
      </nav>

      <header className="flex items-start gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-100 ring-1 ring-slate-200/70 sm:h-16 sm:w-16">
          {event.imageUrl ? (
            <img src={event.imageUrl} alt="" className="h-full w-full object-cover" onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
          ) : (
            <Layers className="h-5 w-5 text-slate-400" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            <span className={cn("k-chip-soft", event.status === "open" && "text-emerald-700")}>{STATUS_LABEL[event.status]}</span>
            {event.mutuallyExclusive && markets.length > 1 && <span className="k-chip-soft text-violet-700">one outcome wins</span>}
            {event.strikeDate && <span className="k-chip-soft">strike {new Date(event.strikeDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>}
          </div>
          <h1 className="text-2xl font-bold leading-tight tracking-[-0.02em] text-slate-950 sm:text-[28px]">{event.title}</h1>
          {event.subTitle && <p className="mt-1 text-base text-slate-600">{event.subTitle}</p>}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <div className="min-w-0 space-y-5">
          {markets.length > 0 && <EventPriceChart eventTicker={event.ticker} markets={markets} selectedTicker={selected} onSelect={(t) => select(t)} height={300} />}

          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6" aria-label="Event statistics">
            <div className="k-stat">
              <div className="k-stat-label">Volume</div>
              <div className="k-stat-value k-num">{compactCC(stats.volume, "")}</div>
              <div className="k-stat-sub">CC lifetime · {markets.length} market{markets.length === 1 ? "" : "s"}</div>
            </div>
            <div className="k-stat">
              <div className="k-stat-label">Volume 24h</div>
              <div className="k-stat-value k-num">{compactCC(stats.volume24h, "")}</div>
              <div className="k-stat-sub">CC across the event</div>
            </div>
            <div className="k-stat">
              <div className="k-stat-label">Open interest</div>
              <div className="k-stat-value k-num">{compactCC(stats.openInterest, "")}</div>
              <div className="k-stat-sub">shares outstanding</div>
            </div>
            <div className="k-stat">
              <div className="k-stat-label">Liquidity</div>
              <div className="k-stat-value k-num">{compactCC(stats.liquidity, "")}</div>
              <div className="k-stat-sub">pool value, all markets</div>
            </div>
            <div className="k-stat">
              <div className="k-stat-label">Trades</div>
              <div className="k-stat-value k-num">{stats.trades}</div>
              <div className="k-stat-sub">{stats.trading} market{stats.trading === 1 ? "" : "s"} trading</div>
            </div>
            <div className="k-stat">
              <div className="k-stat-label">{settled ? "Settled" : "Closes"}</div>
              <div className="k-stat-value k-num">{close ? close.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—"}</div>
              <div className="k-stat-sub"><Clock className="mr-1 inline h-3 w-3" />{settled ? "all markets settled" : close ? `${timeLeft(event.closeTime)} left` : "no markets yet"}</div>
            </div>
          </div>

          <section className="k-card overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h2 className="k-section-title">Outcomes</h2>
              <span className="text-xs text-slate-500">
                {markets.length} market{markets.length === 1 ? "" : "s"}
                {event.mutuallyExclusive && markets.length > 1 && <> · Σ Yes <span className="k-num">{formatPercent(yesSum)}</span></>}
              </span>
            </div>
            {markets.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-slate-500">No markets listed yet.</div>
            ) : (
              <ul>
                {markets.map((m) => {
                  const p = toNumber(m.currentPrice);
                  const delta = priceDelta(p, m.previousPrice === null ? null : toNumber(m.previousPrice));
                  const done = m.status === "Resolved" || m.status === "Voided";
                  const active = selected === m.ticker;
                  return (
                    <li key={m.marketId} className={cn("outcome-row flex-wrap sm:flex-nowrap border-t border-slate-100 first:border-t-0", active && "outcome-row-selected")} onClick={() => select(m.ticker)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") select(m.ticker); }}>
                      <div className="min-w-0 basis-full sm:basis-auto sm:flex-1">
                        <div className="flex items-center gap-2">
                          <Link to={`/markets/${m.ticker}`} onClick={(e) => e.stopPropagation()} className="outcome-link" title={`Open the ${outcomeLabel(m)} market page`}>
                            <span className="truncate">{outcomeLabel(m)}</span>
                            <ArrowUpRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          </Link>
                          <span className="hidden font-mono text-[11px] text-slate-400 lg:inline">{m.ticker}</span>
                        </div>
                        {outcomeLabel(m) !== m.question && <div className="truncate text-xs text-slate-500">{m.question}</div>}
                        <div className="mt-1.5 flex items-center gap-2">
                          <div className="outcome-bar max-w-[12rem]"><span style={{ width: `${Math.round(p * 100)}%` }} /></div>
                          <span className="k-num text-[11px] text-slate-500">{compactCC(m.totalVolumeCC)}</span>
                        </div>
                      </div>
                      <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end">
                        <div className="w-14 shrink-0 text-right">
                          <div className="k-num text-lg font-bold leading-none text-slate-950">{done ? (m.status === "Voided" || m.outcome === "VoidOutcome" ? "Void" : m.outcome) : formatPercent(p)}</div>
                          {delta && !done && <div className={cn("k-num mt-0.5 text-[11px] font-semibold", delta.direction === "up" ? "delta-up" : delta.direction === "down" ? "delta-down" : "delta-flat")}>{delta.text}</div>}
                        </div>
                        <Sparkline closes={m.sparkline?.closes} className="hidden md:inline-block" />
                        {!done && (
                          <div className="flex shrink-0 gap-1.5">
                            <button type="button" className={cn("pill-yes", active && side === "yes" && "ring-2 ring-oracle-yes/40")} onClick={(e) => { e.stopPropagation(); select(m.ticker, "yes"); }}>Yes {formatCents(p)}</button>
                            <button type="button" className={cn("pill-no", active && side === "no" && "ring-2 ring-oracle-no/40")} onClick={(e) => { e.stopPropagation(); select(m.ticker, "no"); }}>No {formatCents(1 - p)}</button>
                          </div>
                        )}
                        <Link to={`/markets/${m.ticker}`} onClick={(e) => e.stopPropagation()} className="outcome-market-link" aria-label={`Open the ${outcomeLabel(m)} market page`}>
                          Market <ChevronRight className="h-3.5 w-3.5" />
                        </Link>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="k-criteria">
            <div className="mb-2 flex items-center gap-2">
              <Gavel className="h-4 w-4 text-primary" />
              <h2 className="k-section-title">Resolution criteria</h2>
            </div>
            {event.description && <p className="k-criteria-text mb-1">{event.description}</p>}
            {markets.length > 0 ? (
              <ul className="divide-y divide-emerald-100/80">
                {markets.map((m) => (
                  <li key={m.marketId} className="py-3">
                    <div className="flex items-center justify-between gap-3">
                      <Link to={`/markets/${m.ticker}`} className="outcome-link text-sm font-semibold text-slate-950">
                        <span className="truncate">{outcomeLabel(m)}</span>
                        <ArrowUpRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      </Link>
                      <span className="k-num shrink-0 text-[11px] text-slate-500">closes {new Date(m.expiresAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                    </div>
                    <p className="k-criteria-text mt-1">{m.resolutionDescription || "No resolution criteria were written for this market."}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">Resolution criteria appear with the first market.</p>
            )}
            {event.settlementSources.length > 0 && (
              <div className="k-criteria-meta">
                <span className="inline-flex items-center gap-1 font-semibold text-slate-950"><ShieldCheck className="h-3.5 w-3.5 text-primary" /> Settlement sources</span>
                {event.settlementSources.map((s) => (
                  <span key={`${s.name}-${s.url}`}>
                    {s.url ? <a href={s.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">{s.name}</a> : s.name}
                  </span>
                ))}
              </div>
            )}
          </section>

          <section className="k-card overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h2 className="k-section-title">Activity</h2>
              <span className="text-xs text-slate-500">latest trades across the event</span>
            </div>
            <TradeFeed trades={trades.data?.items ?? []} loading={trades.isLoading} showMarket limit={25} emptyText="No trades on this event yet." />
          </section>
        </div>

        <TradeColumn className="space-y-3">
          {selectedMarket ? (
            <>
              <MarketView key={selectedMarket.ticker} marketRef={selectedMarket.ticker} variant="dock" initialSide={side} />
              <button type="button" className="quiet-link text-xs" onClick={() => navigate(`/markets/${selectedMarket.ticker}`)}>
                Open the market page <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </>
          ) : (
            <div className="k-card p-6 text-center text-sm text-slate-500">Select an outcome to trade.</div>
          )}
        </TradeColumn>
      </div>
    </div>
  );
}
