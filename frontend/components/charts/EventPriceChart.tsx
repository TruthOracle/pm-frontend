/**
 * Every market of an event on one chart — the Kalshi event view. One line per market on a
 * 0–100 % axis, the five most traded coloured and the rest greyed until toggled in the legend,
 * a shared tooltip that lists every visible market at the hovered time, and the same range
 * presets as the market chart. One request per preset (`GET /events/:ticker/candlesticks`
 * returns every market dense on one grid), polled every 15 s.
 */
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EVENT_CHART_TOP_N, MUTED_SERIES_COLOR, OPENING_TIMEFRAME, alignSeries, axisScale, formatAxisTime, formatPercent, formatPointTime, niceYScale, rankMarketsForChart, seriesColor, type AlignedRow, type Timeframe } from "@/lib/chartData";
import { useEventCandles } from "@/lib/marketQueries";
import { toNumber, type ApiMarket } from "@/lib/marketsTypes";
import { cn } from "@/lib/utils";
import TimeframeTabs from "./TimeframeTabs";
import { AXIS_TICK_STYLE, CHART_CURSOR, GRID_LINE_PROPS, SHOW_GRID, percentTick } from "./chartTheme";
import { CHART_MARGIN, InsideXTick, LiveDot, X_AXIS_PADDING, Y_AXIS_WIDTH } from "./axis";
import { useChartRange } from "./useChartRange";

export interface EventPriceChartProps {
  eventTicker: string;
  markets: ApiMarket[];
  /** Highlighted (the market selected in the trade dock); clicking a legend row selects it. */
  selectedTicker?: string | null;
  onSelect?: (ticker: string) => void;
  /** Plot height in px, or a CSS length ("100%" fills a parent with a definite height). */
  height?: number | string;
  /** The range the chart opens on (1W); one with nothing to draw gives way to 1D (useChartRange). */
  defaultTimeframe?: Timeframe;
  /** `compact` drops the header and shows the legend as a single row of chips (homepage hero). */
  variant?: "full" | "compact";
  /** False drops the range control: the chart stays on its opening range (homepage hero). */
  showTabs?: boolean;
  /** `static` renders the legend as plain indicators: no select, no hide / show, no hover; `none` renders no legend (the trending board draws its own). */
  legend?: "interactive" | "static" | "none";
  className?: string;
}

const NO_ROWS: AlignedRow[] = [];

interface SeriesMeta {
  ticker: string;
  label: string;
  color: string;
  rank: number;
  currentPrice: number;
}

function TooltipBody({ active, payload, label, series, tf }: { active?: boolean; payload?: Array<{ dataKey: string; value: number; color: string }>; label?: number; series: Map<string, SeriesMeta>; tf: Timeframe }) {
  if (!active || !payload?.length) return null;
  const rows = [...payload].filter((p) => typeof p.value === "number").sort((a, b) => b.value - a.value);
  return (
    <div className="chart-tip chart-tip-multi">
      <div className="chart-tip-time">{formatPointTime(label ?? 0, tf)}</div>
      {rows.map((p) => {
        const meta = series.get(String(p.dataKey));
        return (
          <div key={String(p.dataKey)} className="chart-tip-row">
            <span className="chart-tip-swatch" style={{ background: meta?.color ?? p.color }} />
            <span className="chart-tip-name">{meta?.label ?? p.dataKey}</span>
            <span className="chart-tip-num">{formatPercent(p.value, 1)}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function EventPriceChart({ eventTicker, markets, selectedTicker = null, onSelect, height = 300, defaultTimeframe = OPENING_TIMEFRAME, variant = "full", showTabs = true, legend = "interactive", className }: EventPriceChartProps) {
  const { tf, pick, settle } = useChartRange(defaultTimeframe);
  const ranked = useMemo(() => rankMarketsForChart(markets.filter((m) => !m.archived)), [markets]);
  const createdAt = useMemo(() => {
    const secs = ranked.map((m) => Math.floor(Date.parse(m.createdAt) / 1000)).filter((n) => Number.isFinite(n));
    return secs.length ? Math.min(...secs) : null;
  }, [ranked]);
  const query = useEventCandles(eventTicker, tf, createdAt, ranked.length > 0);

  const series = useMemo(() => {
    const map = new Map<string, SeriesMeta>();
    ranked.forEach((m, i) => map.set(m.ticker, { ticker: m.ticker, label: m.yesSubTitle || m.question, color: seriesColor(i), rank: i, currentPrice: toNumber(m.currentPrice) }));
    return map;
  }, [ranked]);

  const [visible, setVisible] = useState<Set<string>>(() => new Set(ranked.slice(0, EVENT_CHART_TOP_N).map((m) => m.ticker)));
  // A newly listed market joins the default set when it lands in the top N.
  useEffect(() => {
    setVisible((prev) => {
      const next = new Set(prev);
      ranked.slice(0, EVENT_CHART_TOP_N).forEach((m) => { if (!prev.has(m.ticker) && prev.size < EVENT_CHART_TOP_N) next.add(m.ticker); });
      for (const t of prev) if (!series.has(t)) next.delete(t);
      return next.size === prev.size && [...next].every((t) => prev.has(t)) ? prev : next;
    });
  }, [ranked, series]);
  useEffect(() => {
    if (selectedTicker && series.has(selectedTicker)) setVisible((prev) => (prev.has(selectedTicker) ? prev : new Set(prev).add(selectedTicker)));
  }, [selectedTicker, series]);

  const answer: AlignedRow[] = useMemo(() => alignSeries(query.data?.markets ?? []), [query.data]);
  // Candle periods in the answer (every market sits on one grid): what the opening range is judged on.
  const periods = useMemo(() => Math.max(0, ...(query.data?.markets ?? []).map((m) => m.candlesticks.length)), [query.data]);
  // While a range loads, react-query keeps the previous range's lines; when those drew nothing
  // (the opening week gave way to the day), the chart shows it is loading, not a stale "no trades".
  const stale = query.isPlaceholderData && answer.length < 2;
  const rows = stale ? NO_ROWS : answer;
  const loading = query.isLoading || stale;
  const drawn = ranked.filter((m) => visible.has(m.ticker));
  const empty = !loading && rows.length < 2;
  // A layout effect, so a fallback to the day lands before the week's empty state is painted.
  useLayoutEffect(() => {
    if (query.isSuccess && !query.isPlaceholderData) settle(tf, periods);
  }, [query.isSuccess, query.isPlaceholderData, tf, periods, settle]);
  // Axis scaled to the visible lines (floor stays at 0 %: these are chances), recomputed when the
  // window or the visible set changes.
  const yScale = useMemo(() => {
    const values: number[] = [];
    for (const row of rows) for (const m of drawn) { const v = row[m.ticker]; if (typeof v === "number") values.push(v); }
    return niceYScale(values, { floorAtZero: true });
    // drawn is derived from `visible` + `ranked`; listing those keeps the memo honest without a new array identity each render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, visible, ranked]);
  // Ticks on the viewer's clock (lib/time.ts); the granularity decides the labels (clock, day or month).
  const xScale = useMemo(() => (rows.length ? axisScale(rows[0].t, rows[rows.length - 1].t, tf, variant === "compact" ? 4 : 6) : null), [rows, tf, variant]);
  const xTicks = xScale?.ticks ?? [];
  /** Where each drawn line ends: its last row with a value. */
  const lineEnds = useMemo(() => {
    const ends = new Map<string, { t: number; v: number }>();
    for (const m of drawn) {
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        const v = rows[i][m.ticker];
        if (typeof v === "number") { ends.set(m.ticker, { t: rows[i].t, v }); break; }
      }
    }
    return ends;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, visible, ranked]);

  // Hiding only makes sense with something left to look at: no hide control for a single market,
  // and the last visible line can never be hidden (an empty chart reads as broken).
  const canHide = ranked.length > 1;
  const toggle = (ticker: string) => {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(ticker)) {
        if (next.size <= 1) return prev;
        next.delete(ticker);
      } else next.add(ticker);
      return next;
    });
  };

  return (
    <section className={cn("chart-card", className)}>
      {variant === "full" && (
        <header className="chart-head">
          <div>
            <div className="chart-title">Chance of each outcome</div>
            <div className="chart-subtitle">{ranked.length} market{ranked.length === 1 ? "" : "s"} · Yes price · {tf === "ALL" ? "all time" : `past ${tf.toLowerCase()}`}</div>
          </div>
          {showTabs && <TimeframeTabs value={tf} onChange={pick} className="hidden sm:flex" />}
        </header>
      )}
      <div className="chart-plot-area" style={{ height }}>
        {query.isError ? (
          <div className="chart-empty">Could not load the price history.</div>
        ) : empty ? (
          <div className="chart-empty">No trades in this window yet.</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={CHART_MARGIN}>
              {SHOW_GRID && <CartesianGrid {...GRID_LINE_PROPS} />}
              <XAxis
                dataKey="t"
                type="number"
                domain={["dataMin", "dataMax"]}
                scale="time"
                padding={X_AXIS_PADDING}
                tickFormatter={(v: number) => formatAxisTime(v, tf, xScale?.granularity)}
                ticks={xTicks}
                interval={0}
                tick={<InsideXTick />}
                tickMargin={6}
                axisLine={false}
                tickLine={false}
              />
              <YAxis domain={yScale.domain} ticks={yScale.ticks} allowDataOverflow tickFormatter={percentTick} tick={AXIS_TICK_STYLE} tickMargin={4} axisLine={false} tickLine={false} width={Y_AXIS_WIDTH} orientation="right" />
              <Tooltip content={<TooltipBody series={series} tf={tf} />} cursor={{ stroke: CHART_CURSOR, strokeDasharray: "3 4", strokeWidth: 1 }} isAnimationActive={false} />
              {drawn.map((m) => {
                const meta = series.get(m.ticker)!;
                // Every drawn line keeps its colour; the selected market is only drawn thicker, since a
                // selection always exists on the event page and dimming the rest would hide the chart.
                return (
                  <Line
                    key={m.ticker}
                    type="monotone"
                    dataKey={m.ticker}
                    name={meta.label}
                    stroke={meta.color}
                    strokeWidth={selectedTicker === m.ticker ? 3 : 2}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }}
                    connectNulls
                    isAnimationActive={false}
                  />
                );
              })}
              {drawn.map((m) => {
                const end = lineEnds.get(m.ticker);
                return end ? <ReferenceDot key={`${m.ticker}-live`} x={end.t} y={end.v} shape={<LiveDot color={series.get(m.ticker)!.color} />} /> : null;
              })}
            </LineChart>
          </ResponsiveContainer>
        )}
        {loading && <div className="chart-loading" aria-hidden="true" />}
      </div>
      {showTabs && <TimeframeTabs value={tf} onChange={pick} className={cn("mt-3", variant === "full" && "sm:hidden")} />}
      {legend !== "none" && (
      <ul className={cn("chart-legend", variant === "compact" && "chart-legend-compact")} aria-label="Markets on this chart">
        {ranked.map((m) => {
          const meta = series.get(m.ticker)!;
          const on = visible.has(m.ticker);
          if (legend === "static") {
            return (
              <li key={m.ticker}>
                <span className="chart-legend-item chart-legend-item-static">
                  <span className="chart-legend-swatch" style={{ background: meta.color }} />
                  <span className="chart-legend-name">{meta.label}</span>
                  <span className="chart-legend-value">{formatPercent(meta.currentPrice)}</span>
                </span>
              </li>
            );
          }
          return (
            <li key={m.ticker}>
              <button
                type="button"
                className={cn("chart-legend-item", !on && "chart-legend-item-off", selectedTicker === m.ticker && "chart-legend-item-selected")}
                onClick={() => (onSelect ? onSelect(m.ticker) : canHide && toggle(m.ticker))}
                onDoubleClick={() => canHide && toggle(m.ticker)}
                title={!canHide ? (onSelect ? "Click to select" : undefined) : on ? "Click to select · double-click to hide" : "Click to show"}
              >
                <span className="chart-legend-swatch" style={{ background: on ? meta.color : MUTED_SERIES_COLOR }} />
                <span className="chart-legend-name">{meta.label}</span>
                <span className="chart-legend-value">{formatPercent(meta.currentPrice)}</span>
                {onSelect && variant === "full" && canHide && (!on || visible.size > 1) && (
                  <span
                    role="button"
                    tabIndex={0}
                    className="chart-legend-eye"
                    onClick={(e) => { e.stopPropagation(); toggle(m.ticker); }}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); toggle(m.ticker); } }}
                    aria-label={on ? `Hide ${meta.label}` : `Show ${meta.label}`}
                  >
                    {on ? "hide" : "show"}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      )}
    </section>
  );
}
