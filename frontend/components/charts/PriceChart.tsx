/**
 * One market's Yes price over time, Kalshi-style: an area + line on a 0–100 % axis, a crosshair
 * tooltip, the live price as the last dot, and the range presets (1H · 6H · 1D · 1W · 1M · ALL).
 * Data is the backend's dense candlesticks (`GET /markets/:market/candlesticks`, one request per
 * preset, polled every 15 s); the live `currentPrice` is appended so the line ends at what the
 * pool quotes right now. Without the index (ledger-only deployment) there is no history to draw,
 * so the card says so instead of inventing a curve.
 */
import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { axisScale, candlesToPoints, formatAxisTime, formatPercent, formatPointTime, niceYScale, windowDelta, type PricePoint, type Timeframe } from "@/lib/chartData";
import { useMarketCandles } from "@/lib/marketQueries";
import { cn } from "@/lib/utils";
import TimeframeTabs from "./TimeframeTabs";
import { AXIS_TICK_STYLE, CHART_CURSOR, GRID_LINE_PROPS, NO_COLOR, SHOW_GRID, YES_COLOR, percentTick } from "./chartTheme";
import { CHART_MARGIN, InsideXTick, LiveDot, X_AXIS_PADDING, Y_AXIS_WIDTH } from "./axis";

export interface PriceChartProps {
  marketRef: string | number;
  createdAtSec?: number | null;
  /** The live pool price, drawn as the last point and in the headline. */
  currentPrice: number;
  /** Shown next to the headline, e.g. the Yes label ("Cut ≥ 25 bps"). */
  yesLabel?: string;
  /** False on a ledger-only deployment: no candles exist. */
  indexed?: boolean;
  /** `compact` drops the headline (the caller shows the price) and the tabs sit below. */
  variant?: "full" | "compact";
  /** False pins the chart to `defaultTimeframe` with no range control (homepage hero). */
  showTabs?: boolean;
  height?: number;
  defaultTimeframe?: Timeframe;
  /** Bumps when a trade of this tab landed, to refetch at once. */
  refreshKey?: number;
  className?: string;
}

function TooltipBody({ active, payload, tf }: { active?: boolean; payload?: Array<{ payload: PricePoint }>; tf: Timeframe }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="chart-tip">
      <div className="chart-tip-value">{formatPercent(p.price, 1)} <span>Yes</span></div>
      <div className="chart-tip-time">{formatPointTime(p.t, tf)}</div>
    </div>
  );
}

export default function PriceChart({ marketRef, createdAtSec, currentPrice, yesLabel, indexed = true, variant = "full", showTabs = true, height = 260, defaultTimeframe = "1D", refreshKey = 0, className }: PriceChartProps) {
  const [tf, setTf] = useState<Timeframe>(defaultTimeframe);
  const query = useMarketCandles(marketRef, tf, createdAtSec, indexed);
  const points = useMemo(() => {
    const base = candlesToPoints(query.data?.candlesticks ?? []);
    const last = base[base.length - 1];
    const now = Date.now();
    if (!last) return base;
    // The last candle closed a moment ago; end the line at the price the pool quotes now.
    if (Math.abs(last.price - currentPrice) > 0.0005 || now - last.t > 60_000) return [...base, { t: Math.max(now, last.t + 1), price: currentPrice }];
    return base;
    // refreshKey only forces the memo to re-run after a trade landed (the query refetches on its own key)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data, currentPrice, refreshKey]);
  const delta = windowDelta(points);
  const deltaColor = delta?.direction === "up" ? "text-oracle-yes" : delta?.direction === "down" ? "text-oracle-no" : "text-slate-500";
  const lineColor = delta?.direction === "down" ? NO_COLOR : YES_COLOR;
  const last = points[points.length - 1];
  const empty = indexed && !query.isLoading && points.length < 2;
  // Axis scaled to the window's data (Polymarket-style), recomputed per timeframe / refetch.
  const yScale = useMemo(() => niceYScale(points.map((p) => p.price)), [points]);
  // UTC-aligned ticks; the granularity decides the labels (clock, day or month).
  const xScale = useMemo(() => (points.length ? axisScale(points[0].t, points[points.length - 1].t, tf, variant === "compact" ? 4 : 6) : null), [points, tf, variant]);
  const xTicks = xScale?.ticks ?? [];

  return (
    <section className={cn("chart-card", className)}>
      {variant === "full" && (
        <header className="chart-head">
          <div>
            <div className="chart-headline">
              <span className="chart-headline-value">{formatPercent(currentPrice, currentPrice < 0.1 || currentPrice > 0.9 ? 1 : 0)}</span>
              <span className="chart-headline-label">
                chance
                {yesLabel && (
                  <>
                    {" · "}
                    <span className="font-bold text-slate-900">{yesLabel}</span>
                  </>
                )}
              </span>
            </div>
            <div className={cn("chart-delta", deltaColor)}>
              {delta ? `${delta.text} pts` : "—"} <span className="text-slate-400">{tf === "ALL" ? "all time" : `past ${tf.toLowerCase()}`}</span>
            </div>
          </div>
          {showTabs && <TimeframeTabs value={tf} onChange={setTf} className="hidden sm:flex" />}
        </header>
      )}
      <div className="chart-plot-area" style={{ height }}>
        {!indexed ? (
          <div className="chart-empty">
            <span className="chart-empty-value">{formatPercent(currentPrice)}</span>
            <span>Price history needs the accounts backend — this deployment reads the ledger directly.</span>
          </div>
        ) : query.isError ? (
          <div className="chart-empty">Could not load the price history.</div>
        ) : empty ? (
          <div className="chart-empty">
            <span className="chart-empty-value">{formatPercent(currentPrice)}</span>
            <span>No trades in this window yet.</span>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={CHART_MARGIN}>
              <defs>
                <linearGradient id={`price-fill-${String(marketRef)}`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={lineColor} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
                </linearGradient>
              </defs>
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
              <Tooltip content={<TooltipBody tf={tf} />} cursor={{ stroke: CHART_CURSOR, strokeDasharray: "3 4", strokeWidth: 1 }} isAnimationActive={false} />
              <Area type="monotone" dataKey="price" stroke={lineColor} strokeWidth={2.25} fill={`url(#price-fill-${String(marketRef)})`} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff", fill: lineColor }} isAnimationActive={false} />
              {last && <ReferenceDot x={last.t} y={last.price} shape={<LiveDot color={lineColor} />} />}
            </AreaChart>
          </ResponsiveContainer>
        )}
        {query.isLoading && indexed && <div className="chart-loading" aria-hidden="true" />}
        {indexed && !query.isError && !empty && (
          <span className="chart-tz" title="Times are in UTC">
            UTC
          </span>
        )}
      </div>
      {showTabs && <TimeframeTabs value={tf} onChange={setTf} className={cn("mt-3", variant === "full" && "sm:hidden")} />}
    </section>
  );
}
