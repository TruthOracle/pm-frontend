import { useEffect, useState } from "react";
import { formatChartDate, probabilityHistoryPath, probabilityY, type ProbabilityPoint } from "@/lib/probabilityChart";

type ChartRange = "1D" | "1W" | "1M" | "ALL";

const RANGE_OPTIONS: Array<{ value: ChartRange; days?: number }> = [
  { value: "1D", days: 1 },
  { value: "1W", days: 7 },
  { value: "1M", days: 30 },
  { value: "ALL" },
];

export default function MarketHistoryChart({ probability, createdAt }: { probability: number; createdAt: number }) {
  const [range, setRange] = useState<ChartRange>("1D");
  const [history, setHistory] = useState<ProbabilityPoint[]>(() => [{ timestamp: createdAt, probability: 0.5 }]);
  const currentY = probabilityY(probability, 178);
  const chartEndX = 860;
  const nowSecs = Math.floor(Date.now() / 1000);
  const selectedRange = RANGE_OPTIONS.find((option) => option.value === range);
  const rangeStart = selectedRange?.days
    ? Math.max(createdAt, nowSecs - selectedRange.days * 24 * 60 * 60)
    : createdAt;
  const chartTrendPath = probabilityHistoryPath(history, rangeStart, nowSecs, chartEndX, 178);

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
        <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700">Live market</span>
      </div>
      <svg viewBox="0 0 940 230" className="mt-2 h-56 w-full" role="img" aria-label="Market probability history">
        <defs><linearGradient id="marketFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#138b61" stopOpacity=".18" /><stop offset="1" stopColor="#138b61" stopOpacity="0" /></linearGradient></defs>
        <path d="M0 178H880 M0 134H880 M0 90H880 M0 46H880 M0 2H880" className="chart-grid" />
        <path d={`${chartTrendPath} V178 H0Z`} fill="url(#marketFill)" />
        <path d={chartTrendPath} className="chart-line chart-line-edge-safe" />
        <circle cx={chartEndX} cy={currentY} r="5" fill="#138b61" />
        {[100, 75, 50, 25, 0].map((label, index) => (
          <text key={label} x="895" y={6 + index * 44} className="market-chart-axis-label">{label}%</text>
        ))}
        <text x="0" y="220" className="market-chart-axis-label">{formatChartDate(rangeStart, true)}</text>
        <text x="820" y="220" className="market-chart-axis-label">Now</text>
      </svg>
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
