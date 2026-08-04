import { useMemo } from "react";
import type { PredictionMarketRecord } from "@/utils/activeContracts";
import { cn } from "@/lib/utils";

type MarketRangeGraphProps = {
  market: PredictionMarketRecord;
  previewPrice?: number | null;
  compact?: boolean;
  className?: string;
};

const GRAPH_CONFIG = {
  compact: {
    height: 168,
    width: 760,
    svgClass: "h-[193px]",
    axisFontSize: 14,
    gridStroke: "#cbd5e1",
    gridWidth: "1",
    gridDash: "2 5",
  },
  detail: {
    height: 400,
    width: 860,
    svgClass: "h-[250px]",
    axisFontSize: 14,
    gridStroke: "#b6c2cf",
    gridWidth: "1.15",
    gridDash: "2 5",
  },
} as const;

const RIGHT_AXIS_PADDING = 76;

const PERCENTAGE_STOPS = [100, 75, 50, 25, 0] as const;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function rangeWidth(market: PredictionMarketRecord) {
  const reserveDepth = market.reserveYes + market.reserveNo;
  const liquidityDepth = market.liquidityL * 0.35;
  const volumeDepth = market.totalVolumeCC * 0.2;
  const depth = Math.max(1, reserveDepth + liquidityDepth + volumeDepth);
  return clamp(0.22 / Math.sqrt(depth / 25 + 1), 0.025, 0.095);
}

function pathFrom(points: number[], width: number, height: number) {
  const step = width / Math.max(1, points.length - 1);
  return points
    .map((p, i) => {
      const x = i * step;
      const y = height - clamp(p, 0.01, 0.99) * height;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

function marketPath(market: PredictionMarketRecord, finalPrice: number) {
  const seed = (market.marketId % 11) / 100;
  const start = clamp(finalPrice - 0.08 + seed, 0.06, 0.94);
  const points = Array.from({ length: 10 }, (_, i) => {
    const t = i / 9;
    const wave =
      (Math.sin((market.marketId + i) * 1.37) * 0.032 + Math.cos((market.marketId - i) * 0.83) * 0.014) *
      (1 - t * 0.35);
    return clamp(start + (finalPrice - start) * t + wave, 0.04, 0.96);
  });
  points[points.length - 1] = clamp(finalPrice, 0.01, 0.99);
  return points;
}

function fmtPct(value: number) {
  return `${Math.round(value * 100)}%`;
}

function monthLabels() {
  const now = new Date();
  return [3, 2, 1, 0].map((monthsAgo) => {
    const month = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1);
    return month.toLocaleDateString(undefined, { month: "short" });
  });
}

const MarketRangeGraph = ({ market, previewPrice, compact = false, className }: MarketRangeGraphProps) => {
  const currentPrice = clamp(market.currentPrice || 0.5, 0.01, 0.99);
  const projectedPrice = previewPrice == null ? null : clamp(previewPrice, 0.01, 0.99);
  const displayPrice = projectedPrice ?? currentPrice;
  const width = rangeWidth(market);
  const lower = clamp(displayPrice - width / 2, 0.01, 0.99);
  const upper = clamp(displayPrice + width / 2, 0.01, 0.99);
  const rangeLabel = `${fmtPct(lower)}-${fmtPct(upper)}`;
  const months = monthLabels();
  const graphConfig = compact ? GRAPH_CONFIG.compact : GRAPH_CONFIG.detail;
  const monthAxisOffset = graphConfig.height * 0.25 - 4;
  const monthTextOffset = monthAxisOffset + (compact ? 2 : 4);
  const viewBoxBottom = monthTextOffset + 5;

  const chart = useMemo(() => {
    const h = graphConfig.height;
    const w = graphConfig.width;
    const midPoints = marketPath(market, displayPrice);
    const lastX = w;
    const lastY = h - displayPrice * h;
    const currentY = h - currentPrice * h;

    return {
      h,
      w,
      midPath: pathFrom(midPoints, w, h),
      lastX,
      lastY,
      currentY,
    };
  }, [currentPrice, displayPrice, graphConfig.height, graphConfig.width, market]);
  const percentageY = (percentage: number) =>
    percentage === 0 ? chart.h - 2 : chart.h - (percentage / 100) * chart.h;

  return (
    <section
      className={cn(
        compact ? "w-full rounded-md bg-transparent" : "w-full rounded-lg border border-border bg-card p-5",
        compact && "p-0",
        className,
      )}
    >
      <div className={cn("flex items-start justify-between gap-3", compact ? "mb-1" : "mb-2")}>
        <div className="min-w-0">
          {!compact && (
            <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
              {market.status === "Trading" ? "Live market" : market.status}
            </div>
          )}
          <div className={cn("font-bold leading-none text-foreground", compact ? "text-lg" : "text-3xl")}>
            {rangeLabel}
          </div>
          <div className={cn("mt-1 text-muted-foreground", compact ? "text-xs" : "text-sm")}>
            market range
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className={cn("font-bold text-oracle-yes", compact ? "text-base" : "text-2xl")}>
            {fmtPct(currentPrice)}
          </div>
          <div className="text-[11px] text-muted-foreground">YES</div>
        </div>
      </div>

      <div className={cn("relative w-full min-w-0", compact && "pt-3")}>
        <svg
          viewBox={`0 0 ${chart.w + RIGHT_AXIS_PADDING} ${chart.h + viewBoxBottom}`}
          className={cn("block min-w-full w-full overflow-visible", graphConfig.svgClass)}
          width="100%"
          preserveAspectRatio="none"
          role="img"
          aria-label={`Market probability range ${rangeLabel}`}
        >
          {PERCENTAGE_STOPS.map((percentage) => (
            <line
              key={percentage}
              x1="0"
              y1={percentageY(percentage)}
              x2={chart.w}
              y2={percentageY(percentage)}
              stroke={graphConfig.gridStroke}
              strokeDasharray={graphConfig.gridDash}
              strokeWidth={graphConfig.gridWidth}
            />
          ))}
          {PERCENTAGE_STOPS.map((percentage) => (
            <text
              key={`label-${percentage}`}
              x={chart.w + 10}
              y={percentageY(percentage)}
              dominantBaseline="middle"
              fill="#64748b"
              fontSize={graphConfig.axisFontSize}
            >
              {percentage}%
            </text>
          ))}
          <line
            x1="0"
            y1={chart.h + monthAxisOffset - (compact ? 0 : 8)}
            x2={chart.w}
            y2={chart.h + monthAxisOffset - (compact ? 0 : 8)}
            stroke="#e5e7eb"
            strokeWidth="1"
          />
          <path d={chart.midPath} fill="none" stroke="#159b73" strokeLinecap="round" strokeLinejoin="round" strokeWidth={compact ? "3" : "3.5"} />
          {projectedPrice != null && (
            <line
              x1={chart.w - 36}
              y1={chart.currentY}
              x2={chart.lastX}
              y2={chart.lastY}
              stroke="#f97316"
              strokeDasharray="5 5"
              strokeWidth="2"
            />
          )}
          <circle cx={chart.lastX} cy={chart.lastY} r={compact ? "4" : "5"} fill={projectedPrice == null ? "#159b73" : "#f97316"} />
        </svg>
        <div className="pointer-events-none absolute inset-0 text-muted-foreground" style={{ fontSize: `${graphConfig.axisFontSize}px` }}>
          <div
            className={cn("absolute left-0 flex justify-between", compact ? "px-2" : "")}
            style={{
              width: `${(chart.w / (chart.w + RIGHT_AXIS_PADDING)) * 100}%`,
              top: `${((chart.h + monthTextOffset) / (chart.h + viewBoxBottom)) * 100}%`,
            }}
          >
            {months.map((month) => <span key={month}>{month}</span>)}
          </div>
        </div>
      </div>

      {!compact && (
          <div className="mt-8 rounded-md border border-border/70 bg-card px-4 py-3">
          <div className="flex items-center justify-between text-sm font-extrabold">
            <span className="text-emerald-700">Yes {(displayPrice * 100).toFixed(1)}%</span>
            <span className="text-red-600">No {((1 - displayPrice) * 100).toFixed(1)}%</span>
          </div>
          <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-slate-200">
            <div className="h-full rounded-full bg-oracle-yes transition-all" style={{ width: `${displayPrice * 100}%` }} />
          </div>
        </div>
      )}

    </section>
  );
};

export default MarketRangeGraph;
