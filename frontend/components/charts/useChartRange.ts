import { useCallback, useState } from "react";
import { OPENING_TIMEFRAME, settleRange, type ChartRange, type Timeframe } from "@/lib/chartData";

/**
 * A chart's selected range (`settleRange` in lib/chartData.ts): opens on `opening`, gives way to
 * the past day when that range's first answer has nothing to draw, then follows the reader. Feed
 * `settle` every answer that belongs to the current range (never react-query placeholder data).
 */
export function useChartRange(opening: Timeframe = OPENING_TIMEFRAME) {
  const [range, setRange] = useState<ChartRange>({ tf: opening, settled: false });
  const pick = useCallback((tf: Timeframe) => setRange({ tf, settled: true }), []);
  const settle = useCallback(
    (answered: Timeframe, candles: number) => setRange((r) => settleRange(r, answered, candles)),
    [],
  );
  return { tf: range.tf, pick, settle };
}
