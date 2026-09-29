/** Shared recharts styling so every chart reads as one system (light theme, slate greys). */
export const CHART_GRID = "#eef2f6";
/** Faint horizontal reference lines at the y ticks; false leaves only the right-hand labels. */
export const SHOW_GRID = true;
export const CHART_AXIS = "#8a9bb0";
export const CHART_CURSOR = "#334155";
export const YES_COLOR = "#16c784";
export const NO_COLOR = "#f23645";
export const AXIS_TICK_STYLE = { fontSize: 11, fill: CHART_AXIS, fontFamily: '"JetBrains Mono", "DM Mono", monospace' } as const;

/** Nice y ticks for a 0–100 % axis: always the ends plus the middle. */
export const PERCENT_TICKS = [0, 0.25, 0.5, 0.75, 1];
export const percentTick = (v: number): string => `${Math.round(v * 100)}%`;

/** Trim the x axis to roughly `n` labels regardless of point count. */
export function tickInterval(pointCount: number, n = 5): number {
  return Math.max(0, Math.floor(pointCount / n) - 1);
}
