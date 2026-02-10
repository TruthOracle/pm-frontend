import { getLoopProvider } from "@/lib/loopSdk";

const TRUTHORACLE_MODULE = "Truthoracle";
const INCENTIVES_MODULE = "Incentives";

/** Template id format for Loop getActiveContracts (module:entity; package may be inferred). */
function templateKey(moduleName: string, entityName: string): string {
  return `${moduleName}:${entityName}`;
}

export interface ContractInfo {
  contractId: string;
  payload?: Record<string, unknown>;
}

/**
 * Fetch the active MarketCounter contract (there should be one per admin).
 * Returns the first one found; the app assumes a single counter.
 */
export async function fetchMarketCounterContractId(): Promise<string | null> {
  const provider = getLoopProvider();
  if (!provider?.getActiveContracts) return null;
  try {
    const list = await provider.getActiveContracts({
      templateId: templateKey(TRUTHORACLE_MODULE, "MarketCounter"),
    });
    const arr = Array.isArray(list) ? list : [];
    const first = arr[0] as { contractId?: string; contract_id?: string } | undefined;
    if (!first) return null;
    return first.contractId ?? first.contract_id ?? null;
  } catch (e) {
    console.warn("fetchMarketCounterContractId", e);
    return null;
  }
}

/**
 * Fetch active PredictionMarket contracts and return the one matching marketId.
 */
export async function fetchPredictionMarketContractId(
  marketId: number
): Promise<{ contractId: string; payload?: Record<string, unknown> } | null> {
  const provider = getLoopProvider();
  if (!provider?.getActiveContracts) return null;
  try {
    const list = await provider.getActiveContracts({
      templateId: templateKey(TRUTHORACLE_MODULE, "PredictionMarket"),
    });
    const arr = Array.isArray(list) ? list : [];
    for (const item of arr) {
      const c = item as { contractId?: string; contract_id?: string; marketId?: number; market_id?: number };
      const cid = c.contractId ?? c.contract_id;
      const mid = c.marketId ?? c.market_id;
      if (cid && Number(mid) === marketId) return { contractId: cid, payload: c as Record<string, unknown> };
    }
    return null;
  } catch (e) {
    console.warn("fetchPredictionMarketContractId", e);
    return null;
  }
}

/**
 * Fetch UserMarketData for the given party and marketId (optional).
 */
export async function fetchUserMarketDataContractId(
  partyId: string,
  marketId?: number
): Promise<string | null> {
  const provider = getLoopProvider();
  if (!provider?.getActiveContracts) return null;
  try {
    const list = await provider.getActiveContracts({
      templateId: templateKey(TRUTHORACLE_MODULE, "UserMarketData"),
    });
    const arr = Array.isArray(list) ? list : [];
    for (const item of arr) {
      const c = item as { contractId?: string; contract_id?: string; user?: string; marketId?: number; market_id?: number };
      const cid = c.contractId ?? c.contract_id;
      const user = c.user;
      const mid = c.marketId ?? c.market_id;
      if (cid && user === partyId && (marketId == null || Number(mid) === marketId)) return cid;
    }
    return null;
  } catch (e) {
    console.warn("fetchUserMarketDataContractId", e);
    return null;
  }
}

/**
 * Fetch UserRewardsSummary contract for the given party.
 */
export async function fetchUserRewardsSummaryContractId(partyId: string): Promise<string | null> {
  const provider = getLoopProvider();
  if (!provider?.getActiveContracts) return null;
  try {
    const list = await provider.getActiveContracts({
      templateId: templateKey(INCENTIVES_MODULE, "UserRewardsSummary"),
    });
    const arr = Array.isArray(list) ? list : [];
    for (const item of arr) {
      const c = item as { contractId?: string; contract_id?: string; user?: string };
      const cid = c.contractId ?? c.contract_id;
      if (cid && c.user === partyId) return cid;
    }
    const first = arr[0] as { contractId?: string; contract_id?: string } | undefined;
    if (first) return first.contractId ?? first.contract_id ?? null;
    return null;
  } catch (e) {
    console.warn("fetchUserRewardsSummaryContractId", e);
    return null;
  }
}
