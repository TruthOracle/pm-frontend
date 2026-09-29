/**
 * Kalshi-style price chart of one market, drawn from the backend's candlesticks
 * (`GET /markets/:market/candlesticks`, truthoracle-backend docs/MARKETS.md §5): OHLC candles
 * or a close-price line, volume bars underneath, a hover tooltip, and Kalshi's range presets
 * (1H · 1D · 1W · 1M · ALL) which pick the period (1 min · 1 h · 1 d) that keeps the number
 * of candles readable. Hand-drawn SVG like the rest of the app — no charting dependency.
 */
import { useEffect, useMemo, useState, type PointerEvent } from "react";
import { fetchCandlesticks } from "@/lib/marketsApi";
import { toNumber, type ApiCandle, type CandlePeriod } from "@/lib/marketsTypes";

export type ChartRange = "1H" | "1D" | "1W" | "1M" | "ALL";
type ChartStyle = "candles" | "line";

/** Range → (window seconds, candle period). ALL spans from the market's creation at daily candles. */
const RANGES: Record<ChartRange, { seconds: number | null; period: CandlePeriod }> = {
  "1H": { seconds: 3600, period: 1 },
  "1D": { seconds: 86_400, period: 60 },
  "1W": { seconds: 7 * 86_400, period: 60 },
  "1M": { seconds: 30 * 86_400, period: 1440 },
  ALL: { seconds: null, period: 1440 },
};

const W = 940;
const PRICE_H = 178;
const VOL_H = 34;
const PLOT_W = 880;
const TOP = 2;

const yOf = (p: number): number => TOP + (1 - Math.min(1, Math.max(0, p))) * (PRICE_H - TOP);

export interface CandlestickChartProps {
  marketRef: string | number;
  createdAt: number;
  /** The live probability, drawn as the marker at the right edge. */
  probability: number;
  /** Bumps whenever a trade landed, so the chart refetches. */
  refreshKey?: number;
}

export default function CandlestickChart({ marketRef, createdAt, probability, refreshKey = 0 }: CandlestickChartProps) {
  const [range, setRange] = useState<ChartRange>("1D");
  const [style, setStyle] = useState<ChartStyle>("line");
  const [candles, setCandles] = useState<ApiCandle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<{ index: number; x: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const nowSec = Math.floor(Date.now() / 1000);
    const { seconds, period } = RANGES[range];
    const startTs = seconds === null ? createdAt : Math.max(createdAt, nowSec - seconds);
    setLoading(true);
    fetchCandlesticks(marketRef, { startTs, endTs: nowSec, periodInterval: period })
      .then((res) => {
        if (cancelled) return;
        setCandles(res.candlesticks);
        setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Could not load the price history.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [marketRef, range, createdAt, refreshKey]);

  const geometry = useMemo(() => {
    const n = candles.length;
    if (n === 0) return null;
    const slot = PLOT_W / n;
    const bodyW = Math.max(1.5, Math.min(14, slot * 0.6));
    const maxVolume = Math.max(1e-9, ...candles.map((c) => toNumber(c.volumeCC)));
    const closes = candles.map((c) => toNumber(c.price.close));
    const linePath = closes
      .map((close, i) => `${i === 0 ? "M" : "L"}${(i + 0.5) * slot} ${yOf(close)}`)
      .join(" ");
    const first = toNumber(candles[0].price.open);
    const last = closes[n - 1];
    return { n, slot, bodyW, maxVolume, linePath, change: last - first, last };
  }, [candles]);

  const onMove = (event: PointerEvent<SVGSVGElement>) => {
    if (!geometry) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * W;
    const index = Math.min(geometry.n - 1, Math.max(0, Math.floor(x / geometry.slot)));
    setHover({ index, x: (index + 0.5) * geometry.slot });
  };

  const hovered = hover && candles[hover.index] ? candles[hover.index] : null;
  const shown = hovered ?? candles[candles.length - 1] ?? null;
  const changePct = geometry && geometry.n > 1 ? geometry.change * 100 : null;

  return (
    <section className="market-history-card">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <p className="eyebrow !mb-1">Price history</p>
          <p className="text-3xl font-bold tracking-[-0.05em] text-slate-950">
            {Math.round(probability * 100)}% <span className="text-sm font-semibold tracking-normal text-slate-500">Yes</span>
            {changePct !== null && (
              <span className={`ml-3 text-sm font-semibold tracking-normal ${changePct >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                {changePct >= 0 ? "+" : ""}
                {changePct.toFixed(1)} pts over {range === "ALL" ? "all time" : range}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-slate-50 p-1 text-xs font-bold text-slate-400" role="tablist" aria-label="Chart style">
          {(["line", "candles"] as ChartStyle[]).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={style === s}
              onClick={() => setStyle(s)}
              className={`rounded-md px-3 py-1.5 capitalize transition-colors ${style === s ? "bg-white text-slate-900 shadow-sm" : "hover:text-slate-700"}`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="market-chart-wrap">
        <svg
          viewBox={`0 0 ${W} ${PRICE_H + VOL_H + 40}`}
          className="mt-2 h-64 w-full"
          role="img"
          aria-label="Market price history"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          <path d={`M0 ${PRICE_H}H${PLOT_W} M0 134H${PLOT_W} M0 90H${PLOT_W} M0 46H${PLOT_W} M0 ${TOP}H${PLOT_W}`} className="chart-grid" />
          {geometry && style === "line" && (
            <>
              <path d={`${geometry.linePath} V${PRICE_H} H${geometry.slot / 2}Z`} className="chart-fill" />
              <path d={geometry.linePath} className="chart-line chart-line-edge-safe" />
            </>
          )}
          {geometry &&
            style === "candles" &&
            candles.map((c, i) => {
              const open = toNumber(c.price.open);
              const close = toNumber(c.price.close);
              const high = toNumber(c.price.high);
              const low = toNumber(c.price.low);
              const up = close >= open;
              const x = (i + 0.5) * geometry.slot;
              const top = yOf(Math.max(open, close));
              const bottom = yOf(Math.min(open, close));
              const color = c.empty ? "#cbd5e1" : up ? "#138b61" : "#d94848";
              return (
                <g key={c.startTs}>
                  <line x1={x} x2={x} y1={yOf(high)} y2={yOf(low)} stroke={color} strokeWidth={1} />
                  <rect x={x - geometry.bodyW / 2} y={top} width={geometry.bodyW} height={Math.max(1, bottom - top)} fill={color} />
                </g>
              );
            })}
          {geometry &&
            candles.map((c, i) => {
              const v = toNumber(c.volumeCC);
              if (v <= 0) return null;
              const h = Math.max(1, (v / geometry.maxVolume) * VOL_H);
              const x = (i + 0.5) * geometry.slot;
              return (
                <rect
                  key={`v-${c.startTs}`}
                  x={x - geometry.bodyW / 2}
                  y={PRICE_H + 6 + (VOL_H - h)}
                  width={geometry.bodyW}
                  height={h}
                  fill="#94a3b8"
                  opacity={0.6}
                />
              );
            })}
          {geometry && <circle cx={(geometry.n - 0.5) * geometry.slot} cy={yOf(probability)} r="5" fill="#138b61" />}
          {hover && hovered && (
            <>
              <line x1={hover.x} x2={hover.x} y1={TOP} y2={PRICE_H + VOL_H + 6} className="chart-crosshair" />
              <circle cx={hover.x} cy={yOf(toNumber(hovered.price.close))} r="5" className="chart-hover-dot" />
            </>
          )}
          {[100, 75, 50, 25, 0].map((label, index) => (
            <text key={label} x="895" y={6 + index * 44} className="market-chart-axis-label">
              {label}%
            </text>
          ))}
          {candles.length > 0 && (
            <>
              <text x="0" y={PRICE_H + VOL_H + 34} className="market-chart-axis-label">
                {formatTs(candles[0].startTs, range)}
              </text>
              <text x="820" y={PRICE_H + VOL_H + 34} className="market-chart-axis-label">
                Now
              </text>
            </>
          )}
          {!loading && candles.length === 0 && (
            <text x={W / 2 - 80} y={PRICE_H / 2} className="market-chart-axis-label">
              {error ?? "No trades in this range yet."}
            </text>
          )}
        </svg>
        {shown && hover && (
          <div className="chart-tooltip" style={{ left: `${Math.min(86, Math.max(8, (hover.x / PLOT_W) * 100))}%` }}>
            <strong>{(toNumber(shown.price.close) * 100).toFixed(1)}% Yes</strong>
            <span>
              O {(toNumber(shown.price.open) * 100).toFixed(1)} · H {(toNumber(shown.price.high) * 100).toFixed(1)} · L{" "}
              {(toNumber(shown.price.low) * 100).toFixed(1)}
            </span>
            <span>
              Vol {toNumber(shown.volumeCC).toFixed(2)} CC · {shown.trades} trade{shown.trades === 1 ? "" : "s"} · OI {toNumber(shown.openInterest).toFixed(1)}
            </span>
            <span>{new Date(shown.startTs * 1000).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit", hour12: false })}</span>
          </div>
        )}
      </div>

      <div className="mt-5 flex items-center gap-1 rounded-xl bg-slate-50 p-1 text-xs font-bold text-slate-400" role="tablist" aria-label="Chart time range">
        {(Object.keys(RANGES) as ChartRange[]).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={range === value}
            onClick={() => setRange(value)}
            className={`flex-1 rounded-lg py-2 transition-colors ${range === value ? "bg-white text-slate-900 shadow-sm" : "hover:text-slate-700"}`}
          >
            {value}
          </button>
        ))}
      </div>
      <p className="mt-2 text-right text-[11px] text-slate-400">
        {RANGES[range].period === 1 ? "1-minute" : RANGES[range].period === 60 ? "hourly" : "daily"} candles · pm-AMM Yes price · volume in CC
      </p>
    </section>
  );
}

function formatTs(ts: number, range: ChartRange): string {
  const d = new Date(ts * 1000);
  if (range === "1H" || range === "1D") return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: false });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
