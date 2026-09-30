/**
 * The homepage trending board, modelled on Kalshi's event board: the three most traded events
 * of the day in a manual carousel. Top: series tile and name, the carousel controls, the event
 * title. Left: a Market / Pays out / Odds table, the event's figures and an About blurb. Right:
 * a static legend, the brand mark and the multi-line chart (the past week, or the past day when
 * the week has nothing to draw), which fills the column down to the About's last line. Every slide has the same geometry (three row slots, one-line
 * title, three-line About), so paging through the carousel never changes the card's height.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import EventPriceChart from "@/components/charts/EventPriceChart";
import { EVENT_CHART_TOP_N, SERIES_PALETTE, compactCC, formatPercent, marketColorMap, timeLeft } from "@/lib/chartData";
import { initialsOf, leadSentences, outcomeLabel, payoutMultiplier } from "@/lib/boardFormat";
import { fetchSeries } from "@/lib/marketsApi";
import { toNumber, type ApiEvent } from "@/lib/marketsTypes";
import { barWidthPercent, outcomeRows, rowsHaveOwnImages } from "@/lib/outcomeRows";

/** Row slots on every slide, as on Kalshi's board; events with more outcomes link to the rest. */
const MAX_ROWS = 2;

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

function BoardEvent({ event, nav }: { event: ApiEvent; nav: ReactNode }) {
  const markets = [...(event.markets ?? []).filter((m) => !m.archived)].sort((a, b) => toNumber(b.currentPrice) - toNumber(a.currentPrice));
  const colors = marketColorMap(markets);
  const { rows, hidden } = outcomeRows(event, markets, (t) => colors.get(t) ?? SERIES_PALETTE[0], { maxRows: MAX_ROWS });
  const showImages = rowsHaveOwnImages(rows);
  const lead = markets[0];
  const seriesTitle = useSeriesTitle(event.seriesTicker);
  const volume24h = event.volume24hCC !== undefined ? toNumber(event.volume24hCC) : markets.reduce((acc, m) => acc + toNumber(m.volume24hCC), 0);
  // Kalshi shows a news blurb here; we have no feed, so the event's own description is the honest
  // equivalent, and the likeliest market's resolution criteria stand in when the catalog has none.
  const about = event.description.trim() || (lead ? leadSentences(lead.resolutionDescription, 2) : "");
  // The legend mirrors the chart: the lines it draws, in the chart's colours.
  const legend = markets.slice(0, EVENT_CHART_TOP_N);

  return (
    <>
      <div className="board-top">
        <div className="flex min-w-0 items-center gap-3">
          <SeriesTile image={event.imageUrl} label={seriesTitle.data ?? event.seriesTicker} />
          <Link to={`/marketplace?series=${encodeURIComponent(event.seriesTicker)}`} className="board-series hover:text-slate-950">
            {seriesTitle.data ?? event.seriesTicker}
          </Link>
        </div>
        {nav}
      </div>
      <Link to={`/events/${event.ticker}`} className="block min-w-0" title={event.title}>
        <h2 className="board-title">{event.title}</h2>
      </Link>

      <div className="board-grid">
        <div className="board-left">
          <div className="board-table-head">
            <span>Market</span>
            <span className="text-right">Pays out</span>
            <span className="text-center">Odds</span>
          </div>
          <ul className="board-rows" aria-label="Likeliest outcomes">
            {rows.map((r) => (
              <li key={r.key} className="board-row">
                <div className="flex min-w-0 items-center gap-3">
                  {showImages && <img src={r.image} alt="" className="board-icon" />}
                  <div className="board-name">
                    <Link to={r.href} className="board-outcome" title={r.title}>
                      {r.label}
                    </Link>
                    {/* Kalshi's underline is a probability bar: its length is the chance, across the name column. */}
                    <span className="board-bar" aria-hidden="true">
                      <span style={{ width: `${barWidthPercent(r.price)}%`, background: r.color }} />
                    </span>
                  </div>
                </div>
                <span className="board-payout">{payoutMultiplier(r.price)}</span>
                <Link to={r.href} className="board-odds" aria-label={`${r.label}: ${formatPercent(r.price)} chance`}>
                  {formatPercent(r.price)}
                </Link>
              </li>
            ))}
          </ul>

          <div className="board-stats">
            <span className="board-stats-line">
              <b>{compactCC(event.volumeCC)}</b> vol <span aria-hidden="true">·</span> <b>{compactCC(volume24h)}</b> 24h <span aria-hidden="true">·</span>{" "}
              {event.status === "settled" ? (
                <b>Settled</b>
              ) : (
                <span title="Time until the event closes" aria-label={`closes in ${timeLeft(event.closeTime)}`}>
                  <Clock className="inline h-3.5 w-3.5 -translate-y-px" aria-hidden="true" /> <b>{timeLeft(event.closeTime)}</b>
                </span>
              )}
            </span>
            <Link to={`/events/${event.ticker}`} className="board-trade group/trade">
              {hidden > 0 ? `${hidden} more` : "Trade"} <ArrowRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover/trade:opacity-100" />
            </Link>
          </div>
          <hr className="board-divider" />
          <p className="board-about">
            {about ? (
              <>
                <b>About</b> <span aria-hidden="true">·</span> {about}
              </>
            ) : (
              " "
            )}
          </p>
        </div>

        <div className="board-right">
          <div className="board-chart-head">
            <ul className="board-legend" aria-label="Markets on the chart">
              {legend.map((m) => (
                <li key={m.marketId}>
                  <span className="board-legend-dot" style={{ background: colors.get(m.ticker) ?? SERIES_PALETTE[0] }} />
                  <span>{outcomeLabel(m)}</span>
                  <b>{formatPercent(toNumber(m.currentPrice))}</b>
                </li>
              ))}
            </ul>
            <Link to="/" className="board-wordmark" aria-label="TruthOracle">
              Truth<span>Oracle</span>
            </Link>
          </div>
          <div className="board-chart-wrap">
            <EventPriceChart key={event.ticker} eventTicker={event.ticker} markets={markets} variant="compact" showTabs={false} legend="none" height="100%" className="board-chart" />
          </div>
        </div>
      </div>
    </>
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

  const nav = (
    <div className="board-nav">
      <span className="board-live">
        <span className="live-dot" /> Trending
      </span>
      {count > 1 && (
        <>
          <button type="button" className="board-nav-btn" onClick={() => step(-1)} aria-label="Previous trending event">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span aria-live="polite">
            {index + 1} of {count}
          </span>
          <button type="button" className="board-nav-btn" onClick={() => step(1)} aria-label="Next trending event">
            <ChevronRight className="h-4 w-4" />
          </button>
        </>
      )}
    </div>
  );

  return (
    <section className="board" aria-roledescription="carousel" aria-label="Trending events">
      {/* Not keyed by event: the arrows stay mounted (keyboard focus survives paging); the chart keys itself. */}
      <BoardEvent event={event} nav={nav} />
    </section>
  );
}

export function TrendingEventBoardSkeleton() {
  return (
    <div className="board" aria-label="Loading trending events" aria-busy="true">
      <div className="board-top">
        <div className="flex items-center gap-3">
          <span className="skeleton h-8 w-8 rounded-[7px]" />
          <span className="skeleton h-3 w-28" />
        </div>
        <span className="skeleton h-9 w-36 rounded-full" />
      </div>
      <div className="skeleton mt-4 h-7 w-3/5" />
      <div className="board-grid">
        <div className="space-y-3 pt-7">
          <span className="skeleton block h-8" />
          <span className="skeleton block h-8" />
          <span className="skeleton block h-8" />
          <span className="skeleton mt-6 block h-16" />
        </div>
        <span className="skeleton block h-[17rem]" />
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
