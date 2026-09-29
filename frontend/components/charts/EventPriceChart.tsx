/**
 * Every market of an event on one chart — the Kalshi event view. One line per market on a
 * 0–100 % axis, the five most traded coloured and the rest greyed until toggled in the legend,
 * a shared tooltip that lists every visible market at the hovered time, and the same range
 * presets as the market chart. One request per preset (`GET /events/:ticker/candlesticks`
 * returns every market dense on one grid), polled every 15 s.
 */
import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EVENT_CHART_TOP_N, MUTED_SERIES_COLOR, alignSeries, formatAxisTime, formatPercent, formatPointTime, rankMarketsForChart, seriesColor, type AlignedRow, type Timeframe } from "@/lib/chartData";
import { useEventCandles } from "@/lib/marketQueries";
import { toNumber, type ApiMarket } from "@/lib/marketsTypes";
import { cn } from "@/lib/utils";
import TimeframeTabs from "./TimeframeTabs";
import { AXIS_TICK_STYLE, CHART_CURSOR, CHART_GRID, PERCENT_TICKS, SHOW_GRID, percentTick } from "./chartTheme";
import { CHART_MARGIN, InsideXTick, X_AXIS_PADDING, Y_AXIS_WIDTH } from "./axis";

export interface EventPriceChartProps {
  eventTicker: string;
  markets: ApiMarket[];
  /** Highlighted (the market selected in the trade dock); clicking a legend row selects it. */
  selectedTicker?: string | null;
  onSelect?: (ticker: string) => void;
  height?: number;
  defaultTimeframe?: Timeframe;
  /** `compact` drops the header and shows the legend as a single row of chips (homepage hero). */
  variant?: "full" | "compact";
  className?: string;
}

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

export default function EventPriceChart({ eventTicker, markets, selectedTicker = null, onSelect, height = 300, defaultTimeframe = "1W", variant = "full", className }: EventPriceChartProps) {
  const [tf, setTf] = useState<Timeframe>(defaultTimeframe);
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

  const rows: AlignedRow[] = useMemo(() => alignSeries(query.data?.markets ?? []), [query.data]);
  const drawn = ranked.filter((m) => visible.has(m.ticker));
  const empty = !query.isLoading && rows.length < 2;

  const toggle = (ticker: string) => {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(ticker)) next.delete(ticker);
      else next.add(ticker);
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
          <TimeframeTabs value={tf} onChange={setTf} className="hidden sm:flex" />
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
              {SHOW_GRID && <CartesianGrid stroke={CHART_GRID} strokeWidth={1} vertical={false} />}
              <XAxis
                dataKey="t"
                type="number"
                domain={["dataMin", "dataMax"]}
                scale="time"
                padding={X_AXIS_PADDING}
                tickFormatter={(v: number) => formatAxisTime(v, tf)}
                tick={<InsideXTick />}
                tickMargin={6}
                axisLine={false}
                tickLine={false}
                minTickGap={56}
                interval="preserveStartEnd"
              />
              <YAxis domain={[0, 1]} ticks={PERCENT_TICKS} tickFormatter={percentTick} tick={AXIS_TICK_STYLE} tickMargin={4} axisLine={false} tickLine={false} width={Y_AXIS_WIDTH} orientation="right" />
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
            </LineChart>
          </ResponsiveContainer>
        )}
        {query.isLoading && <div className="chart-loading" aria-hidden="true" />}
      </div>
      <TimeframeTabs value={tf} onChange={setTf} className={cn("mt-3", variant === "full" && "sm:hidden")} />
      <ul className={cn("chart-legend", variant === "compact" && "chart-legend-compact")} aria-label="Markets on this chart">
        {ranked.map((m) => {
          const meta = series.get(m.ticker)!;
          const on = visible.has(m.ticker);
          return (
            <li key={m.ticker}>
              <button
                type="button"
                className={cn("chart-legend-item", !on && "chart-legend-item-off", selectedTicker === m.ticker && "chart-legend-item-selected")}
                onClick={() => (onSelect ? onSelect(m.ticker) : toggle(m.ticker))}
                onDoubleClick={() => toggle(m.ticker)}
                title={on ? "Click to select · double-click to hide" : "Click to show"}
              >
                <span className="chart-legend-swatch" style={{ background: on ? meta.color : MUTED_SERIES_COLOR }} />
                <span className="chart-legend-name">{meta.label}</span>
                <span className="chart-legend-value">{formatPercent(meta.currentPrice)}</span>
                {onSelect && variant === "full" && (
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
    </section>
  );
}
