/** Shared recharts styling so every chart reads as one system (light theme, slate greys). */
export const CHART_GRID = "#d5dbe3";
/** Dotted horizontal reference lines at the y ticks (Kalshi-style); false leaves only the right-hand labels. */
export const SHOW_GRID = true;
/** Round dots with a visible gap; no vertical lines, no axis lines. */
export const GRID_LINE_PROPS = {
  stroke: CHART_GRID,
  strokeWidth: 1,
  strokeDasharray: "1 5",
  strokeLinecap: "round" as const,
  vertical: false,
  syncWithTicks: true,
};
export const CHART_AXIS = "#8a9bb0";
export const CHART_CURSOR = "#334155";
export const YES_COLOR = "#16c784";
export const NO_COLOR = "#f23645";
export const AXIS_TICK_STYLE = {
  fontSize: 11,
  fill: CHART_AXIS,
  fontFamily: '"JetBrains Mono", "DM Mono", monospace',
} as const;

/** Y tick label for a fraction; the axis itself is scaled to the data by `niceYScale`. */
export const percentTick = (v: number): string => `${Math.round(v * 100)}%`;

/** Trim the x axis to roughly `n` labels regardless of point count. */
export function tickInterval(pointCount: number, n = 5): number {
  return Math.max(0, Math.floor(pointCount / n) - 1);
}
