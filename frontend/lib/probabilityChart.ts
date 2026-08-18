const SECOND = 1000;

export function clampProbability(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0.5));
}

export function probabilityY(probability: number, height: number, topPadding = 2): number {
  // The chart grids run from topPadding to height, so keep points on that
  // same coordinate range (there is no matching bottom padding).
  return topPadding + (1 - clampProbability(probability)) * (height - topPadding);
}

export type ProbabilityPoint = { timestamp: number; probability: number };

function smoothPath(points: Array<{ x: number; y: number }>): string {
  if (points.length < 2) return "";
  let path = `M${points[0].x} ${points[0].y}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const previous = points[index - 1] ?? current;
    const following = points[index + 2] ?? next;
    path += ` C${current.x + (next.x - previous.x) / 6} ${current.y + (next.y - previous.y) / 6}, ${next.x - (following.x - current.x) / 6} ${next.y - (following.y - current.y) / 6}, ${next.x} ${next.y}`;
  }
  return path;
}

/** Draws only the probability snapshots that have actually been observed. */
export function probabilityHistoryPath(
  points: ProbabilityPoint[],
  rangeStart: number,
  rangeEnd: number,
  width: number,
  height: number,
  topPadding = 2,
): string {
  const beforeRange = points.filter((point) => point.timestamp < rangeStart).at(-1);
  const inRange = points.filter((point) => point.timestamp >= rangeStart && point.timestamp <= rangeEnd);
  const visible = beforeRange ? [beforeRange, ...inRange] : inRange;
  const source = visible.length ? visible : [points.at(-1) ?? { timestamp: rangeEnd, probability: 0.5 }];
  const plotted = source.map((point) => ({
    x: Math.max(0, Math.min(width, ((point.timestamp - rangeStart) / Math.max(1, rangeEnd - rangeStart)) * width)),
    y: probabilityY(point.probability, height, topPadding),
  }));
  if (plotted.length === 1) plotted.unshift({ x: 0, y: plotted[0].y });
  if (plotted[plotted.length - 1].x < width) plotted.push({ x: width, y: plotted[plotted.length - 1].y });
  return smoothPath(plotted);
}

export function formatChartDate(timestamp: number, includeDay = false): string {
  const date = new Date(timestamp * SECOND);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, includeDay
    ? { month: "short", day: "numeric" }
    : { month: "short" });
}

export function formatChartNow(now = Date.now()): string {
  return formatChartDate(Math.floor(now / SECOND), true);
}
