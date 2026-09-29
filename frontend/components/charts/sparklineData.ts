import { sparklineTrend as trendOf, type Trend } from "@/lib/chartData";

export function toNumberArray(values: Array<string | number> | null | undefined): number[] {
  if (!values) return [];
  return values.map((v) => (typeof v === "number" ? v : Number(v))).filter((v) => Number.isFinite(v));
}

export function sparklineTrend(values: number[]): Trend {
  return trendOf(values);
}
