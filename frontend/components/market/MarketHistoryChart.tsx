import { useEffect, useRef, useState, type PointerEvent } from "react";
import { formatChartDate, pointOnProbabilityPath, probabilityHistoryPath, probabilityY, type ProbabilityPoint } from "@/lib/probabilityChart";
import CandlestickChart from "./CandlestickChart";

type ChartRange = "1D" | "1W" | "1M" | "ALL";

const RANGE_OPTIONS: Array<{ value: ChartRange; days?: number }> = [
  { value: "1D", days: 1 },
  { value: "1W", days: 7 },
  { value: "1M", days: 30 },
  { value: "ALL" },
];

export interface MarketHistoryChartProps {
  probability: number;
  createdAt: number;
  /** Id or ticker; when the backend index is available the chart is the real candlestick history. */
  marketRef?: string | number;
  /** True when the market came from the backend index (candles exist). */
  indexed?: boolean;
  refreshKey?: number;
}

/**
 * The market's price chart. With the backend index this is the Kalshi-style candlestick chart
 * (`CandlestickChart`); on a ledger-only deployment it falls back to the points this tab has
 * observed — flat until a second price is seen, never invented.
 */
export default function MarketHistoryChart({ probability, createdAt, marketRef, indexed = false, refreshKey = 0 }: MarketHistoryChartProps) {
  if (indexed && marketRef !== undefined) {
    return <CandlestickChart marketRef={marketRef} createdAt={createdAt} probability={probability} refreshKey={refreshKey} />;
  }
  return <ObservedHistoryChart probability={probability} createdAt={createdAt} />;
}

function ObservedHistoryChart({ probability, createdAt }: { probability: number; createdAt: number }) {
  const [range, setRange] = useState<ChartRange>("1M");
  // The first observed point is the price this tab saw first — not an assumed 50%.
  const [history, setHistory] = useState<ProbabilityPoint[]>(() => [{ timestamp: Math.max(createdAt, Math.floor(Date.now() / 1000)), probability }]);
  const currentY = probabilityY(probability, 178);
  const chartEndX = 860;
  const nowSecs = Math.floor(Date.now() / 1000);
  const selectedRange = RANGE_OPTIONS.find((option) => option.value === range);
  const rangeStart = selectedRange?.days
    ? Math.max(createdAt, nowSecs - selectedRange.days * 24 * 60 * 60)
    : createdAt;
  const chartTrendPath = probabilityHistoryPath(history, rangeStart, nowSecs, chartEndX, 178);
  const chartPathRef = useRef<SVGPathElement>(null);
  const [hoveredPoint, setHoveredPoint] = useState<(ProbabilityPoint & { x: number; y: number }) | null>(null);
  const [hoveredX, setHoveredX] = useState<number | null>(null);

  const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const chartX = ((event.clientX - bounds.left) / bounds.width) * 940;
    const exactX = Math.max(0, Math.min(chartEndX, chartX));
    setHoveredX(exactX);
    if (chartPathRef.current) setHoveredPoint(pointOnProbabilityPath(chartPathRef.current, exactX, chartEndX, rangeStart, nowSecs, 178));
  };

  useEffect(() => {
    setHistory((previous) => {
      const last = previous.at(-1);
      if (last && Math.abs(last.probability - probability) < 0.0001) return previous;
      return [...previous, { timestamp: nowSecs, probability }];
    });
  }, [nowSecs, probability]);

  return (
    <section className="market-history-card">
      <div className="mb-5 flex items-start justify-between border-b border-slate-100 pb-4">
        <div>
          <p className="eyebrow !mb-1">Probability history</p>
          <p className="text-3xl font-bold tracking-[-0.05em] text-slate-950">{Math.round(probability * 100)}% <span className="text-sm font-semibold tracking-normal text-slate-500">Yes</span></p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600" title="Only the prices this tab has observed; the backend index provides the full history.">Observed in this session</span>
      </div>
      <div className="market-chart-wrap">
      <svg viewBox="0 0 940 230" className="mt-2 h-56 w-full" role="img" aria-label="Market probability history" onPointerMove={handlePointerMove} onPointerLeave={() => { setHoveredPoint(null); setHoveredX(null); }}>
        <defs><linearGradient id="marketFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#138b61" stopOpacity=".18" /><stop offset="1" stopColor="#138b61" stopOpacity="0" /></linearGradient></defs>
        <path d="M0 178H880 M0 134H880 M0 90H880 M0 46H880 M0 2H880" className="chart-grid" />
        <path d={`${chartTrendPath} V178 H0Z`} fill="url(#marketFill)" />
        <path ref={chartPathRef} d={chartTrendPath} className="chart-line chart-line-edge-safe" />
        <circle cx={chartEndX} cy={currentY} r="5" fill="#138b61" />
        {hoveredPoint && <>
          <line x1={hoveredX ?? hoveredPoint.x} x2={hoveredX ?? hoveredPoint.x} y1="2" y2="178" className="chart-crosshair" />
          <circle cx={hoveredPoint.x} cy={hoveredPoint.y} r="5" className="chart-hover-dot" />
        </>}
        {[100, 75, 50, 25, 0].map((label, index) => (
          <text key={label} x="895" y={6 + index * 44} className="market-chart-axis-label">{label}%</text>
        ))}
        <text x="0" y="220" className="market-chart-axis-label">{formatChartDate(rangeStart, true)}</text>
        <text x="820" y="220" className="market-chart-axis-label">Now</text>
      </svg>
      {hoveredPoint && <div className="chart-tooltip" style={{ left: `${Math.min(86, Math.max(8, ((hoveredX ?? hoveredPoint.x) / chartEndX) * 100))}%` }}>
        <strong>{(hoveredPoint.probability * 100).toFixed(2)}% Yes</strong>
        <span>{new Date(hoveredPoint.timestamp * 1000).toLocaleDateString(undefined, { day: "2-digit", month: "short" }).toUpperCase()}</span>
        <span>{new Date(hoveredPoint.timestamp * 1000).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: false })}</span>
      </div>}
      </div>
      <div className="mt-5 flex items-center gap-1 rounded-xl bg-slate-50 p-1 text-xs font-bold text-slate-400" role="tablist" aria-label="Chart time range">
        {RANGE_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={range === option.value}
            onClick={() => setRange(option.value)}
            className={`flex-1 rounded-lg py-2 transition-colors ${range === option.value ? "bg-white text-slate-900 shadow-sm" : "hover:text-slate-700"}`}
          >
            {option.value}
          </button>
        ))}
      </div>
    </section>
  );
}
