/**
 * The homepage trending board, modelled on Kalshi's event board: the three most traded events
 * of the day in a manual carousel. Left: series tile and name, the question, a Market / Pays out
 * / Odds table for the likeliest outcomes, the event's figures, and an About blurb. Right: a
 * static legend, the brand mark, and the week-long multi-line chart. Every colour on the board
 * (icon ring, underline, legend dot) is the colour the chart gives that market's line.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import EventPriceChart from "@/components/charts/EventPriceChart";
import { EVENT_CHART_TOP_N, SERIES_PALETTE, compactCC, formatPercent, marketColorMap, timeLeft } from "@/lib/chartData";
import { initialsOf, leadSentences, outcomeLabel, payoutMultiplier } from "@/lib/boardFormat";
import { fetchSeries } from "@/lib/marketsApi";
import { toNumber, type ApiEvent, type ApiMarket } from "@/lib/marketsTypes";

/** Outcome rows shown before the "+N more" link. */
const MAX_ROWS = 3;
/** The board is fixed to the past week: enough history to read, no range control. */
const BOARD_TIMEFRAME = "1W" as const;

function useSeriesTitle(ticker: string) {
  return useQuery({
    queryKey: ["series", ticker],
    queryFn: () => fetchSeries(ticker),
    staleTime: 5 * 60_000,
    select: (d) => d.series.title,
  });
}

function SeriesTile({ image, label }: { image: string; label: string }) {
  if (image) return <img src={image} alt="" className="board-tile" />;
  return (
    <div className="board-tile board-tile-initials" style={{ background: `linear-gradient(135deg, ${SERIES_PALETTE[0]} 0 50%, ${SERIES_PALETTE[1]} 50% 100%)` }} aria-hidden="true">
      {initialsOf(label)}
    </div>
  );
}

function OutcomeIcon({ market, fallbackImage, color }: { market: ApiMarket; fallbackImage: string; color: string }) {
  const image = market.imageUrl || fallbackImage;
  return (
    <span className="board-icon" style={{ borderColor: color }} aria-hidden="true">
      {image ? <img src={image} alt="" /> : <span className="board-icon-initials" style={{ color, background: `${color}1a` }}>{initialsOf(outcomeLabel(market))}</span>}
    </span>
  );
}

function BoardEvent({ event }: { event: ApiEvent }) {
  const markets = [...(event.markets ?? []).filter((m) => !m.archived)].sort((a, b) => toNumber(b.currentPrice) - toNumber(a.currentPrice));
  const colors = marketColorMap(markets);
  const shown = markets.slice(0, MAX_ROWS);
  const hidden = markets.length - shown.length;
  const lead = markets[0];
  const seriesTitle = useSeriesTitle(event.seriesTicker);
  const volume24h = event.volume24hCC !== undefined ? toNumber(event.volume24hCC) : markets.reduce((acc, m) => acc + toNumber(m.volume24hCC), 0);
  // Kalshi shows a news blurb here; we have no feed, so the event's own description is the honest
  // equivalent, and the likeliest market's resolution criteria stand in when the catalog has none.
  const about = event.description.trim() || (lead ? leadSentences(lead.resolutionDescription, 2) : "");
  // The legend mirrors the chart: the lines it draws, in the chart's colours.
  const legend = markets.slice(0, EVENT_CHART_TOP_N);

  return (
    <div className="board-grid">
      <div className="min-w-0">
        <div className="flex items-center gap-3">
          <SeriesTile image={event.imageUrl} label={seriesTitle.data ?? event.seriesTicker} />
          <Link to={`/marketplace?series=${encodeURIComponent(event.seriesTicker)}`} className="board-series hover:text-slate-950">
            {seriesTitle.data ?? event.seriesTicker}
          </Link>
        </div>
        <Link to={`/events/${event.ticker}`} className="block">
          <h2 className="board-title">{event.title}</h2>
        </Link>

        <div className="board-head">
          <span>Market</span>
          <span className="text-right">Pays out</span>
          <span className="text-right">Odds</span>
        </div>
        <ul aria-label="Likeliest outcomes">
          {shown.map((m) => {
            const price = toNumber(m.currentPrice);
            const color = colors.get(m.ticker) ?? SERIES_PALETTE[0];
            const label = outcomeLabel(m);
            return (
              <li key={m.marketId} className="board-row">
                <div className="flex min-w-0 items-center gap-3">
                  <OutcomeIcon market={m} fallbackImage={event.imageUrl} color={color} />
                  <span className="board-name">
                    <Link to={`/markets/${m.ticker}`} className="board-outcome" title={m.question}>
                      {label}
                    </Link>
                    <span className="board-underline" style={{ background: color }} />
                  </span>
                </div>
                <span className="board-payout">{payoutMultiplier(price)}</span>
                <Link to={`/markets/${m.ticker}?side=yes`} className="board-odds" aria-label={`${label}: ${formatPercent(price)} chance, trade Yes`}>
                  {formatPercent(price)}
                </Link>
              </li>
            );
          })}
        </ul>
        {hidden > 0 && (
          <Link to={`/events/${event.ticker}`} className="board-more">
            +{hidden} more outcome{hidden === 1 ? "" : "s"}
          </Link>
        )}

        <div className="board-stats">
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>
              <b>{compactCC(volume24h)}</b> traded in 24h
            </span>
            <span aria-hidden="true">·</span>
            <span>
              <b>{compactCC(event.volumeCC)}</b> lifetime
            </span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              {event.status === "settled" ? <b>Settled</b> : <>closes in <b>{timeLeft(event.closeTime)}</b></>}
            </span>
          </span>
          <Link to={`/events/${event.ticker}`} className="board-trade group/trade">
            Trade <ArrowRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover/trade:opacity-100" />
          </Link>
        </div>

        {about && (
          <>
            <hr className="board-divider" />
            <p className="board-about">
              <b>About</b> <span aria-hidden="true">·</span> {about}
            </p>
          </>
        )}
      </div>

      <div className="min-w-0">
        <div className="board-chart-head">
          <ul className="board-legend" aria-label="Markets on the chart">
            {legend.map((m) => (
              <li key={m.marketId}>
                <span className="board-legend-dot" style={{ background: colors.get(m.ticker) ?? SERIES_PALETTE[0] }} />
                <span className="truncate">{outcomeLabel(m)}</span>
                <b>{formatPercent(toNumber(m.currentPrice))}</b>
              </li>
            ))}
          </ul>
          <Link to="/" className="board-wordmark" aria-label="TruthOracle">
            Truth<span>Oracle</span>
          </Link>
        </div>
        <EventPriceChart key={event.ticker} eventTicker={event.ticker} markets={markets} variant="compact" showTabs={false} legend="none" height={264} defaultTimeframe={BOARD_TIMEFRAME} className="board-chart" />
      </div>
    </div>
  );
}

export default function TrendingEventBoard({ events }: { events: ApiEvent[] }) {
  const [index, setIndex] = useState(0);
  const count = events.length;
  useEffect(() => {
    if (index >= count) setIndex(0);
  }, [count, index]);
  const event = events[Math.min(index, Math.max(count - 1, 0))];
  if (!event) return <TrendingEventBoardEmpty />;
  const step = (delta: number) => setIndex((i) => (i + delta + count) % count);

  return (
    <section className="board" aria-roledescription="carousel" aria-label="Trending events">
      <div className="flex items-center justify-between gap-4">
        <p className="eyebrow !mb-0 min-w-0 truncate">
          <span className="live-dot" /> Trending events
        </p>
        {count > 1 && (
          <div className="board-nav">
            <button type="button" className="board-nav-btn" onClick={() => step(-1)} aria-label="Previous trending event">
              <ChevronLeft className="h-5 w-5" />
            </button>
            <span aria-live="polite">
              {index + 1} of {count}
            </span>
            <button type="button" className="board-nav-btn" onClick={() => step(1)} aria-label="Next trending event">
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        )}
      </div>
      <BoardEvent key={event.ticker} event={event} />
    </section>
  );
}

export function TrendingEventBoardSkeleton() {
  return (
    <div className="board-skeleton" aria-label="Loading trending events" aria-busy="true">
      <div className="flex items-center gap-3">
        <span className="skeleton h-11 w-11 rounded-[10px]" />
        <span className="skeleton h-3 w-24" />
      </div>
      <div className="skeleton mt-7 h-9 w-2/3" />
      <div className="board-grid">
        <div className="space-y-4 pt-4">
          <span className="skeleton block h-14" />
          <span className="skeleton block h-14" />
          <span className="skeleton block h-14" />
        </div>
        <span className="skeleton block h-[300px]" />
      </div>
    </div>
  );
}

export function TrendingEventBoardEmpty() {
  return (
    <div className="board-empty">
      <p className="font-semibold text-slate-700">No trending events yet</p>
      <p className="mt-1">Markets appear here once the first event has been traded.</p>
      <Link to="/marketplace" className="mt-4 inline-flex items-center gap-1 font-semibold text-slate-900 hover:text-primary">
        Browse markets <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}
