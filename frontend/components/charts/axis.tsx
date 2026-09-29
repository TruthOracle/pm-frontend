/**
 * Shared axis pieces so every chart keeps its labels inside the plot: the first x label is
 * anchored at its start, the last at its end, everything else centred — so "Sep 22" never hangs
 * off the left edge and "Sep 29" never runs into the right-hand percentage labels.
 */
import { AXIS_TICK_STYLE } from "./chartTheme";

/** Plot margins shared by the price charts: the plot spans the card, Kalshi-style. */
export const CHART_MARGIN = { top: 12, right: 0, bottom: 0, left: 0 } as const;
/** A few pixels so the line neither starts flush at the card edge nor ends under the y labels. */
export const X_AXIS_PADDING = { left: 10, right: 10 } as const;
/** Compact right-hand gutter, just wide enough for "100%". */
export const Y_AXIS_WIDTH = 40;

interface InsideXTickProps {
  x?: number;
  y?: number;
  index?: number;
  visibleTicksCount?: number;
  payload?: { value: number };
  tickFormatter?: (value: number, index: number) => string;
}

export function InsideXTick({ x = 0, y = 0, index = 0, visibleTicksCount = 0, payload, tickFormatter }: InsideXTickProps) {
  const anchor = visibleTicksCount > 1 && index === visibleTicksCount - 1 ? "end" : index === 0 ? "start" : "middle";
  const value = payload?.value ?? 0;
  const text = tickFormatter ? tickFormatter(value, index) : String(value);
  return (
    <text x={x} y={y} dy={12} textAnchor={anchor} fontSize={AXIS_TICK_STYLE.fontSize} fill={AXIS_TICK_STYLE.fill} fontFamily={AXIS_TICK_STYLE.fontFamily}>
      {text}
    </text>
  );
}
