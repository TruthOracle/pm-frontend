import { Line, LineChart, ResponsiveContainer, YAxis } from "recharts";
import { sparklineTrend, toNumberArray } from "./sparklineData";
import { NO_COLOR, YES_COLOR } from "./chartTheme";

/**
 * The tiny 24 h line on a card: green when the last close is above the first, red below, grey
 * when flat or unknown. Renders nothing for fewer than two points so a card never shows an
 * invented movement.
 */
export default function Sparkline({ closes, width = 72, height = 24, className }: { closes: Array<string | number> | null | undefined; width?: number; height?: number; className?: string }) {
  const values = toNumberArray(closes);
  if (values.length < 2) return <span className={className} style={{ display: "inline-block", width, height }} aria-hidden="true" />;
  const trend = sparklineTrend(values);
  const color = trend === "up" ? YES_COLOR : trend === "down" ? NO_COLOR : "#94a3b8";
  const data = values.map((v, i) => ({ i, v }));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max(0.01, (max - min) * 0.15);
  return (
    <span className={className} style={{ display: "inline-block", width, height }} aria-label={`24 hour trend: ${trend}`} role="img">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 2, right: 1, bottom: 2, left: 1 }}>
          <YAxis hide domain={[min - pad, max + pad]} />
          <Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.75} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </span>
  );
}
