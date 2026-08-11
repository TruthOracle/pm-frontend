export type { PredictionMarketRecord, UserMarketPosition, LiquidityPositionRecord, PendingPayoutRecord, OutcomeAttestationRecord } from "@/utils/activeContracts";
export type { AmuletHoldings } from "@/view-functions/getAccountBalance";

export type MainTab = "trade" | "liquidity" | "resolve" | "settle";
export type TradeSubTab = "swap" | "mint";
export type LiquiditySubTab = "add" | "remove";
