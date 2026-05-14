import { createParticipantClient } from "@/lib/cantonParticipant";
import { TRUTHORACLE_PACKAGE_ID, TRUTHORACLE_PACKAGE_NAME } from "@/constants";

const TRUTHORACLE_MODULE = "Truthoracle";
const INCENTIVES_MODULE = "Incentives";

function templateId(moduleName: string, entityName: string) {
  return {
    // The JSON Ledger API active-contracts filter REQUIRES a package-name reference
    // ("#name:Module:Entity"). The participant rejects package-id with INVALID_FIELD:
    // "Received an identifier with package ID, but expected a package name."
    // (The response *returns* templateId in package-id form — that asymmetry is normal.)
    packageName: TRUTHORACLE_PACKAGE_NAME,
    packageId: TRUTHORACLE_PACKAGE_ID,
    moduleName,
    entityName,
  };
}

export interface ContractInfo {
  contractId: string;
  payload?: Record<string, unknown>;
}

/** Get contract ID from a response item (handles various field naming conventions). */
function getContractId(item: unknown): string | null {
  const c = item as Record<string, unknown>;
  return (c.contractId ?? c.contract_id ?? c.contract_id_value) as string | null;
}

/** Get payload from a response item. */
function getPayload(item: unknown): Record<string, unknown> {
  const c = item as Record<string, unknown>;
  return (c.payload ?? c.contract ?? c) as Record<string, unknown>;
}

/**
 * Fetch the active MarketCounter contract from the participant Ledger API.
 *
 * MarketCounter's signatory is the Enterprise Wallet admin party (created via wallet-deploy/),
 * not the connected end-user wallet — so we always query as that party. The id is
 * read from VITE_ENTERPRISE_WALLET_PARTY_ID; an unset env is a configuration bug
 * (no contract could be visible to anyone else), so we throw rather than return null.
 */
export async function fetchMarketCounterContractId(): Promise<string | null> {
  const adminParty = String(import.meta.env.VITE_ENTERPRISE_WALLET_PARTY_ID ?? "").trim();
  if (!adminParty) {
    throw new Error(
      "VITE_ENTERPRISE_WALLET_PARTY_ID is not set. Set it in .env to the Enterprise Wallet party id (see wallet-deploy/README.md)."
    );
  }
  try {
    const client = createParticipantClient();
    const list = await client.queryActiveContracts(
      adminParty,
      templateId(TRUTHORACLE_MODULE, "MarketCounter")
    );
    // API may return up to 200 contracts; keep only the one signed by the admin we asked about.
    const forAdmin = list.filter((item) => {
      const payload = getPayload(item);
      const admin = payload.admin ?? payload.Admin;
      return admin === adminParty;
    });
    const first = forAdmin[0];
    return first ? getContractId(first) : null;
  } catch (e) {
    console.warn("fetchMarketCounterContractId", e);
    return null;
  }
}

export interface PredictionMarketRecord {
  contractId: string;
  marketId: number;
  question: string;
  imageUrl: string;
  description: string;
  option1: string;
  option2: string;
  createdAt: number;
  optionShares1: number;
  optionShares2: number;
  liquidityParam: number;
  participants: string[];
}

export interface ResolvedMarketRecord {
  contractId: string;
  marketId: number;
  question: string;
  option1: string;
  option2: string;
  /** Daml `MarketResult` variant. The JSON Ledger API serializes `Option1 | Option2 | Draw` as a string tag. */
  result: "Option1" | "Option2" | "Draw" | string;
  payoutPerShare: number;
}

function adminParty(): string {
  const p = String(import.meta.env.VITE_ENTERPRISE_WALLET_PARTY_ID ?? "").trim();
  if (!p) {
    throw new Error(
      "VITE_ENTERPRISE_WALLET_PARTY_ID is not set. Set it in .env to the Enterprise Wallet party id (see wallet-deploy/README.md)."
    );
  }
  return p;
}

/** Daml Int fields come back as numeric strings on the JSON Ledger API. */
function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return 0;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * List every active PredictionMarket. Queries as the Enterprise Wallet admin party
 * because that party is the template's `signatory admin` — end users only see contracts
 * they've been added to via `AddParticipant`, so they cannot enumerate the marketplace
 * directly. The Keycloak service-account token has read authority for any party.
 */
export async function fetchAllPredictionMarkets(): Promise<PredictionMarketRecord[]> {
  try {
    const client = createParticipantClient();
    const list = await client.queryActiveContracts(
      adminParty(),
      templateId(TRUTHORACLE_MODULE, "PredictionMarket")
    );
    const out: PredictionMarketRecord[] = [];
    for (const item of list) {
      const cid = getContractId(item);
      if (!cid) continue;
      const p = getPayload(item);
      out.push({
        contractId: cid,
        marketId: num(p.marketId),
        question: asString(p.question),
        imageUrl: asString(p.imageUrl),
        description: asString(p.description),
        option1: asString(p.option1),
        option2: asString(p.option2),
        createdAt: num(p.createdAt),
        optionShares1: num(p.optionShares1),
        optionShares2: num(p.optionShares2),
        liquidityParam: num(p.liquidityParam),
        participants: Array.isArray(p.participants) ? (p.participants as string[]) : [],
      });
    }
    out.sort((a, b) => b.marketId - a.marketId);
    return out;
  } catch (e) {
    console.warn("fetchAllPredictionMarkets", e);
    return [];
  }
}

/**
 * List every ResolvedMarket (closed, with recorded result). Same query strategy as
 * fetchAllPredictionMarkets — admin is signatory.
 */
export async function fetchAllResolvedMarkets(): Promise<ResolvedMarketRecord[]> {
  try {
    const client = createParticipantClient();
    const list = await client.queryActiveContracts(
      adminParty(),
      templateId(TRUTHORACLE_MODULE, "ResolvedMarket")
    );
    const out: ResolvedMarketRecord[] = [];
    for (const item of list) {
      const cid = getContractId(item);
      if (!cid) continue;
      const p = getPayload(item);
      out.push({
        contractId: cid,
        marketId: num(p.marketId),
        question: asString(p.question),
        option1: asString(p.option1),
        option2: asString(p.option2),
        result: typeof p.result === "string" ? p.result : "",
        payoutPerShare: num(p.payoutPerShare),
      });
    }
    out.sort((a, b) => b.marketId - a.marketId);
    return out;
  } catch (e) {
    console.warn("fetchAllResolvedMarkets", e);
    return [];
  }
}

/**
 * Fetch active PredictionMarket contracts from the participant and return the one matching marketId.
 */
export async function fetchPredictionMarketContractId(
  marketId: number,
  partyId: string
): Promise<{ contractId: string; payload?: Record<string, unknown> } | null> {
  try {
    const client = createParticipantClient();
    const list = await client.queryActiveContracts(
      partyId,
      templateId(TRUTHORACLE_MODULE, "PredictionMarket")
    );
    for (const item of list) {
      const cid = getContractId(item);
      const payload = getPayload(item);
      const mid = payload.marketId ?? payload.market_id;
      if (cid && Number(mid) === marketId) return { contractId: cid, payload };
    }
    return null;
  } catch (e) {
    console.warn("fetchPredictionMarketContractId", e);
    return null;
  }
}

/**
 * Fetch UserMarketData for the given party and marketId (optional) from the participant.
 */
export async function fetchUserMarketDataContractId(
  partyId: string,
  marketId?: number
): Promise<string | null> {
  try {
    const client = createParticipantClient();
    const list = await client.queryActiveContracts(
      partyId,
      templateId(TRUTHORACLE_MODULE, "UserMarketData")
    );
    for (const item of list) {
      const cid = getContractId(item);
      const payload = getPayload(item);
      const user = payload.user;
      const mid = payload.marketId ?? payload.market_id;
      if (cid && user === partyId && (marketId == null || Number(mid) === marketId)) return cid;
    }
    return null;
  } catch (e) {
    console.warn("fetchUserMarketDataContractId", e);
    return null;
  }
}

/**
 * Fetch UserRewardsSummary contract for the given party from the participant.
 */
export async function fetchUserRewardsSummaryContractId(
  partyId: string
): Promise<string | null> {
  try {
    const client = createParticipantClient();
    const list = await client.queryActiveContracts(
      partyId,
      templateId(INCENTIVES_MODULE, "UserRewardsSummary")
    );
    for (const item of list) {
      const cid = getContractId(item);
      const payload = getPayload(item);
      if (cid && payload.user === partyId) return cid;
    }
    const first = list[0];
    return first ? getContractId(first) : null;
  } catch (e) {
    console.warn("fetchUserRewardsSummaryContractId", e);
    return null;
  }
}
