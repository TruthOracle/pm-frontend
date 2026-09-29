/**
 * Shared axis pieces so every chart keeps its labels inside the plot and ends its lines the
 * same way: x labels are centred under their tick and only pushed inward when they would spill
 * over an edge; every series ends in a "live" dot with a soft halo in its own colour.
 */
import { AXIS_TICK_STYLE } from "./chartTheme";

/** Plot margins shared by the price charts: the plot spans the card, Kalshi-style. */
export const CHART_MARGIN = { top: 12, right: 0, bottom: 0, left: 0 } as const;
/** The line starts a hair inside the card and ends short of the y labels. */
export const X_AXIS_PADDING = { left: 4, right: 12 } as const;
/** Compact right-hand gutter, just wide enough for "100%". */
export const Y_AXIS_WIDTH = 40;

/** Monospace 11 px: about 6.7 px per character. */
const CHAR_WIDTH = AXIS_TICK_STYLE.fontSize * 0.61;

interface InsideXTickProps {
  x?: number;
  y?: number;
  /** recharts passes the axis width; with the y axis on the right the x axis starts at 0. */
  width?: number;
  index?: number;
  payload?: { value: number };
  tickFormatter?: (value: number, index: number) => string;
}

export function InsideXTick({ x = 0, y = 0, width, index = 0, payload, tickFormatter }: InsideXTickProps) {
  const value = payload?.value ?? 0;
  const text = tickFormatter ? tickFormatter(value, index) : String(value);
  const half = (text.length * CHAR_WIDTH) / 2;
  let anchor: "start" | "middle" | "end" = "middle";
  if (x - half < 2) anchor = "start";
  else if (typeof width === "number" && width > 0 && x + half > width - 2) anchor = "end";
  return (
    <text x={x} y={y} dy={12} textAnchor={anchor} fontSize={AXIS_TICK_STYLE.fontSize} fill={AXIS_TICK_STYLE.fill} fontFamily={AXIS_TICK_STYLE.fontFamily}>
      {text}
    </text>
  );
}

/**
 * The last point of a series, Kalshi-style: a small solid dot in the series colour (no border)
 * that stays put, and a halo of the same colour that starts at the dot's size, emanates outward
 * to ~2.8× and fades to nothing, forever (`.chart-live-halo` in index.css). Used as a
 * `ReferenceDot` shape; recharts clones it with its own `cx`, `cy` and a default `r`, so the
 * size comes from `dotRadius`, not `r`.
 */
export function LiveDot({ cx, cy, color, dotRadius = 4 }: { cx?: number; cy?: number; color: string; dotRadius?: number }) {
  if (typeof cx !== "number" || typeof cy !== "number") return null;
  return (
    <g className="chart-live" pointerEvents="none">
      <circle cx={cx} cy={cy} r={dotRadius} fill={color} className="chart-live-halo" />
      <circle cx={cx} cy={cy} r={dotRadius} fill={color} />
    </g>
  );
}
