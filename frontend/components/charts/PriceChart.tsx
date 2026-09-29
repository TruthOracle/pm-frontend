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
import { candlesToPoints, formatAxisTime, formatPercent, formatPointTime, windowDelta, type PricePoint, type Timeframe } from "@/lib/chartData";
import { useMarketCandles } from "@/lib/marketQueries";
import { cn } from "@/lib/utils";
import TimeframeTabs from "./TimeframeTabs";
import { AXIS_TICK_STYLE, CHART_CURSOR, CHART_GRID, NO_COLOR, PERCENT_TICKS, YES_COLOR, percentTick, tickInterval } from "./chartTheme";

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

export default function PriceChart({ marketRef, createdAtSec, currentPrice, yesLabel, indexed = true, variant = "full", height = 260, defaultTimeframe = "1D", refreshKey = 0, className }: PriceChartProps) {
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

  return (
    <section className={cn("chart-card", className)}>
      {variant === "full" && (
        <header className="chart-head">
          <div>
            <div className="chart-headline">
              <span className="chart-headline-value">{formatPercent(currentPrice, currentPrice < 0.1 || currentPrice > 0.9 ? 1 : 0)}</span>
              <span className="chart-headline-label">chance{yesLabel ? ` · ${yesLabel}` : ""}</span>
            </div>
            <div className={cn("chart-delta", deltaColor)}>
              {delta ? `${delta.text} pts` : "—"} <span className="text-slate-400">{tf === "ALL" ? "all time" : `past ${tf.toLowerCase()}`}</span>
            </div>
          </div>
          <TimeframeTabs value={tf} onChange={setTf} className="hidden sm:flex" />
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
            <AreaChart data={points} margin={{ top: 12, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={`price-fill-${String(marketRef)}`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={lineColor} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={CHART_GRID} vertical={false} strokeDasharray="0" />
              <XAxis
                dataKey="t"
                type="number"
                domain={["dataMin", "dataMax"]}
                scale="time"
                tickFormatter={(v: number) => formatAxisTime(v, tf)}
                tick={AXIS_TICK_STYLE}
                axisLine={false}
                tickLine={false}
                minTickGap={48}
                interval={tickInterval(points.length)}
              />
              <YAxis domain={[0, 1]} ticks={PERCENT_TICKS} tickFormatter={percentTick} tick={AXIS_TICK_STYLE} axisLine={false} tickLine={false} width={40} orientation="right" />
              <Tooltip content={<TooltipBody tf={tf} />} cursor={{ stroke: CHART_CURSOR, strokeDasharray: "3 4", strokeWidth: 1 }} isAnimationActive={false} />
              <Area type="monotone" dataKey="price" stroke={lineColor} strokeWidth={2.25} fill={`url(#price-fill-${String(marketRef)})`} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff", fill: lineColor }} isAnimationActive={false} />
              {last && <ReferenceDot x={last.t} y={last.price} r={4.5} fill={lineColor} stroke="#fff" strokeWidth={2} />}
            </AreaChart>
          </ResponsiveContainer>
        )}
        {query.isLoading && indexed && <div className="chart-loading" aria-hidden="true" />}
      </div>
      <TimeframeTabs value={tf} onChange={setTf} className={cn("mt-3", variant === "full" && "sm:hidden")} />
    </section>
  );
}
