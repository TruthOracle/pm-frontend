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

/** Pull the optional disclosed-contract fields (only present when includeCreatedEventBlob was set). */
function getDisclosure(
  item: unknown,
): { createdEventBlob?: string; synchronizerId?: string } {
  const c = item as Record<string, unknown>;
  return {
    createdEventBlob: typeof c.createdEventBlob === "string" ? c.createdEventBlob : undefined,
    synchronizerId: typeof c.synchronizerId === "string" ? c.synchronizerId : undefined,
  };
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
  resolutionDescription: string;
  createdAt: number;
  yesShares: number;
  noShares: number;
  liquidityParam: number;
  /** Base64 created-event blob, needed to build a DisclosedContract for parties that can't see the cid directly. */
  createdEventBlob?: string;
  /** Synchronizer the contract lives on; required alongside createdEventBlob on a disclosed contract. */
  synchronizerId?: string;
}

export interface ResolvedMarketRecord {
  contractId: string;
  marketId: number;
  question: string;
  /** Daml `MarketResult` variant. The JSON Ledger API serializes `Yes | No | Draw` as a string tag. */
  result: "Yes" | "No" | "Draw" | string;
  payoutPerShareCC: number;
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
 * because that party is the template's `signatory admin`. End-user wallets reach
 * the market via disclosed contracts (the createdEventBlob captured here) — no
 * participants list is needed any more. The Keycloak service-account token has
 * read authority for any party.
 */
export async function fetchAllPredictionMarkets(): Promise<PredictionMarketRecord[]> {
  try {
    const client = createParticipantClient();
    // Fetch with createdEventBlob so handleBuyClick can pass the market as a DisclosedContract
    // to the wallet — external buyer participants don't see admin-only contracts directly.
    const list = await client.queryActiveContracts(
      adminParty(),
      templateId(TRUTHORACLE_MODULE, "PredictionMarket"),
      { includeCreatedEventBlob: true },
    );
    const out: PredictionMarketRecord[] = [];
    for (const item of list) {
      const cid = getContractId(item);
      if (!cid) continue;
      const p = getPayload(item);
      const { createdEventBlob, synchronizerId } = getDisclosure(item);
      out.push({
        contractId: cid,
        marketId: num(p.marketId),
        question: asString(p.question),
        imageUrl: asString(p.imageUrl),
        description: asString(p.description),
        resolutionDescription: asString(p.resolutionDescription),
        createdAt: num(p.createdAt),
        yesShares: num(p.yesShares),
        noShares: num(p.noShares),
        liquidityParam: num(p.liquidityParam),
        createdEventBlob,
        synchronizerId,
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
        result: typeof p.result === "string" ? p.result : "",
        payoutPerShareCC: num(p.payoutPerShareCC ?? p.payoutPerShare),
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

export interface UserMarketPosition {
  contractId: string;
  marketId: number;
  yesShares: number;
  noShares: number;
  /** Lifetime CC invested in this market (informational, not money authoritative). */
  amountInvestedCC: number;
}

/**
 * Fetch the buyer's UserMarketData payload for a given market. Used to detect
 * trade confirmation by polling for the new share counts.
 */
export async function fetchUserMarketDataPosition(
  partyId: string,
  marketId: number
): Promise<UserMarketPosition | null> {
  try {
    const client = createParticipantClient();
    const list = await client.queryActiveContracts(
      partyId,
      templateId(TRUTHORACLE_MODULE, "UserMarketData")
    );
    for (const item of list) {
      const cid = getContractId(item);
      const p = getPayload(item);
      const mid = p.marketId ?? p.market_id;
      if (cid && p.user === partyId && Number(mid) === marketId) {
        return {
          contractId: cid,
          marketId: Number(mid),
          yesShares: num(p.yesShares ?? p.yes_shares),
          noShares: num(p.noShares ?? p.no_shares),
          amountInvestedCC: num(p.amountInvestedCC ?? p.amount_invested_cc),
        };
      }
    }
    return null;
  } catch (e) {
    console.warn("fetchUserMarketDataPosition", e);
    return null;
  }
}

/**
 * List every UserMarketData position the buyer holds across all markets.
 */
export async function fetchAllUserMarketDataPositions(
  partyId: string
): Promise<UserMarketPosition[]> {
  try {
    const client = createParticipantClient();
    const list = await client.queryActiveContracts(
      partyId,
      templateId(TRUTHORACLE_MODULE, "UserMarketData")
    );
    const out: UserMarketPosition[] = [];
    for (const item of list) {
      const cid = getContractId(item);
      const p = getPayload(item);
      const mid = p.marketId ?? p.market_id;
      if (cid && p.user === partyId && mid != null) {
        out.push({
          contractId: cid,
          marketId: Number(mid),
          yesShares: num(p.yesShares ?? p.yes_shares),
          noShares: num(p.noShares ?? p.no_shares),
          amountInvestedCC: num(p.amountInvestedCC ?? p.amount_invested_cc),
        });
      }
    }
    out.sort((a, b) => b.marketId - a.marketId);
    return out;
  } catch (e) {
    console.warn("fetchAllUserMarketDataPositions", e);
    return [];
  }
}

export interface PendingPayoutRecord {
  contractId: string;
  admin: string;
  user: string;
  marketId: number;
  amountCC: number;
  reason: string;
  createdAt: number;
}

/**
 * Fetch pending payouts the admin owes the given party. The user is an observer
 * of PendingPayout, so querying as the user surfaces ones owed to them; querying
 * as admin surfaces all of them (for the admin payout queue).
 */
export async function fetchPendingPayouts(partyId: string): Promise<PendingPayoutRecord[]> {
  try {
    const client = createParticipantClient();
    const list = await client.queryActiveContracts(
      partyId,
      templateId(TRUTHORACLE_MODULE, "PendingPayout")
    );
    const out: PendingPayoutRecord[] = [];
    for (const item of list) {
      const cid = getContractId(item);
      if (!cid) continue;
      const p = getPayload(item);
      out.push({
        contractId: cid,
        admin: asString(p.admin),
        user: asString(p.user),
        marketId: num(p.marketId),
        amountCC: num(p.amountCC ?? p.amount_cc),
        reason: asString(p.reason),
        createdAt: num(p.createdAt),
      });
    }
    out.sort((a, b) => b.createdAt - a.createdAt);
    return out;
  } catch (e) {
    console.warn("fetchPendingPayouts", e);
    return [];
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
