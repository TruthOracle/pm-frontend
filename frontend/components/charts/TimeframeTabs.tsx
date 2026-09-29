import { TIMEFRAMES, type Timeframe } from "@/lib/chartData";
import { cn } from "@/lib/utils";

/** Kalshi's chart range presets as a segmented control. */
export default function TimeframeTabs({ value, onChange, className }: { value: Timeframe; onChange: (tf: Timeframe) => void; className?: string }) {
  return (
    <div className={cn("timeframe-tabs", className)} role="tablist" aria-label="Chart time range">
      {TIMEFRAMES.map((tf) => (
        <button key={tf} type="button" role="tab" aria-selected={value === tf} onClick={() => onChange(tf)} className={cn("timeframe-tab", value === tf && "timeframe-tab-active")}>
          {tf}
        </button>
      ))}
    </div>
  );
}
