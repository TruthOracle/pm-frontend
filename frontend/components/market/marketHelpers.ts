import type { PredictionMarketRecord } from "@/utils/activeContracts";
import type { AmmMarketState } from "@/lib/marketPricing";

export type MarketPhase = "liquidity_period" | "trading" | "expired" | "proposed" | "resolved" | "voided";

export function getMarketPhase(m: PredictionMarketRecord, nowSecs = Math.floor(Date.now() / 1000)): MarketPhase {
  if (m.status === "Resolved") return "resolved";
  if (m.status === "Voided") return "voided";
  if (m.status === "Proposed") return "proposed";
  if (nowSecs >= m.expiresAt) return "expired";
  if (nowSecs < m.createdAt + m.liquidityPeriodSecs) return "liquidity_period";
  return "trading";
}

export function ammState(m: PredictionMarketRecord): AmmMarketState & { lpTokenSupply: number } {
  return {
    currentPrice: m.currentPrice,
    liquidityL: m.liquidityL,
    isDynamic: m.isDynamic,
    createdAt: m.createdAt,
    expiresAt: m.expiresAt,
    feeBps: m.feeBps,
    liquidityPeriodSecs: m.liquidityPeriodSecs,
    lpTokenSupply: m.lpTokenSupply,
  };
}

/**
 * A plain figure — shares, LP tokens, reserves — with at most `dp` decimals and trailing zeros
 * trimmed. Money is formatted next to its instrument with `formatAmount` / `formatMoney`
 * (lib/instruments.ts), never here.
 */
export function fmtNum(v: number, dp = 4) {
  return v.toFixed(dp).replace(/\.?0+$/, "") || "0";
}

export function fmtCountdown(target: number, nowSecs: number): string {
  const s = Math.max(0, target - nowSecs);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const mnt = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${mnt}m`;
  return `${mnt}m ${s % 60}s`;
}
