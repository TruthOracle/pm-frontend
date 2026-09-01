import { createParticipantClient } from "@/lib/cantonParticipant";
import { TRUTHORACLE_PACKAGE_ID, TRUTHORACLE_PACKAGE_NAME } from "@/constants";
import { ENTERPRISE_WALLET_PARTY_ID } from "@/config";
import { debugWarn } from "@/lib/debugLog";

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

function adminParty(): string {
  if (!ENTERPRISE_WALLET_PARTY_ID) {
    throw new Error(
      "VITE_ENTERPRISE_WALLET_PARTY_ID is not set. Set it in .env to the Enterprise Wallet party id (see wallet-deploy/README.md)."
    );
  }
  return ENTERPRISE_WALLET_PARTY_ID;
}

/** Daml Int/Decimal fields come back as numeric strings on the JSON Ledger API. */
function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return 0;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Daml enums serialize as their constructor tag; variants as {tag, value}. */
function enumTag(v: unknown): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "tag" in (v as Record<string, unknown>)) {
    return asString((v as Record<string, unknown>).tag);
  }
  return "";
}

/** Daml Optional serializes as null | value. */
function optionalEnum(v: unknown): string | null {
  if (v == null) return null;
  const tag = enumTag(v);
  return tag || null;
}

export type MarketStatus = "Trading" | "Proposed" | "Resolved" | "Voided";
export type OutcomeTag = "Yes" | "No" | "VoidOutcome";

export interface ResolutionPolicyRecord {
  operatorResolution: boolean;
  sources: string[];
  sourceKeys: { sourceUri: string; publicKey: string }[];
  reporters: string[];
  quorum: number;
  challengeSecs: number;
  bondCC: number;
}

export interface ProposalRecord {
  proposer: string;
  proposedOutcome: OutcomeTag;
  proposedAt: number;
  bondCC: number;
  challenger: string | null;
  challengerOutcome: OutcomeTag | null;
}

export interface PredictionMarketRecord {
  contractId: string;
  marketId: number;
  question: string;
  imageUrl: string;
  description: string;
  resolutionDescription: string;
  category: string;
  createdAt: number;
  expiresAt: number;
  gracePeriodSecs: number;
  isDynamic: boolean;
  liquidityPeriodSecs: number;
  reserveYes: number;
  reserveNo: number;
  liquidityL: number;
  lpTokenSupply: number;
  /** Cached pm-AMM YES price — the display probability. */
  currentPrice: number;
  feeBps: number;
  prizeFeeShareBps: number;
  accumulatedFeesCC: number;
  prizePoolCC: number;
  totalVolumeCC: number;
  status: MarketStatus;
  outcome: OutcomeTag | null;
  resolvedAt: number | null;
  proposal: ProposalRecord | null;
  policy: ResolutionPolicyRecord;
  /** Base64 created-event blob, needed to build a DisclosedContract for parties that can't see the cid directly. */
  createdEventBlob?: string;
  /** Synchronizer the contract lives on; required alongside createdEventBlob on a disclosed contract. */
  synchronizerId?: string;
}

function parsePolicy(v: unknown): ResolutionPolicyRecord {
  const p = (v ?? {}) as Record<string, unknown>;
  const sourceKeys = Array.isArray(p.sourceKeys)
    ? (p.sourceKeys as Record<string, unknown>[]).map((k) => ({
        sourceUri: asString(k.sourceUri),
        publicKey: asString(k.publicKey),
      }))
    : [];
  return {
    operatorResolution: p.operatorResolution === true,
    sources: Array.isArray(p.sources) ? (p.sources as unknown[]).map(asString) : [],
    sourceKeys,
    reporters: Array.isArray(p.reporters) ? (p.reporters as unknown[]).map(asString) : [],
    quorum: num(p.quorum),
    challengeSecs: num(p.challengeSecs),
    bondCC: num(p.bondCC),
  };
}

function parseProposal(v: unknown): ProposalRecord | null {
  if (v == null) return null;
  const p = v as Record<string, unknown>;
  return {
    proposer: asString(p.proposer),
    proposedOutcome: (enumTag(p.proposedOutcome) || "Yes") as OutcomeTag,
    proposedAt: num(p.proposedAt),
    bondCC: num(p.bondCC),
    challenger: p.challenger == null ? null : asString(p.challenger),
    challengerOutcome: optionalEnum(p.challengerOutcome) as OutcomeTag | null,
  };
}

function parseMarket(item: unknown): PredictionMarketRecord | null {
  const cid = getContractId(item);
  if (!cid) return null;
  const p = getPayload(item);
  const { createdEventBlob, synchronizerId } = getDisclosure(item);
  return {
    contractId: cid,
    marketId: num(p.marketId),
    question: asString(p.question),
    imageUrl: asString(p.imageUrl),
    description: asString(p.description),
    resolutionDescription: asString(p.resolutionDescription),
    category: asString(p.category),
    createdAt: num(p.createdAt),
    expiresAt: num(p.expiresAt),
    gracePeriodSecs: num(p.gracePeriodSecs),
    isDynamic: p.isDynamic === true,
    liquidityPeriodSecs: num(p.liquidityPeriodSecs),
    reserveYes: num(p.reserveYes),
    reserveNo: num(p.reserveNo),
    liquidityL: num(p.liquidityL),
    lpTokenSupply: num(p.lpTokenSupply),
    currentPrice: num(p.currentPrice),
    feeBps: num(p.feeBps),
    prizeFeeShareBps: num(p.prizeFeeShareBps),
    accumulatedFeesCC: num(p.accumulatedFeesCC),
    prizePoolCC: num(p.prizePoolCC),
    totalVolumeCC: num(p.totalVolumeCC),
    status: (enumTag(p.status) || "Trading") as MarketStatus,
    outcome: optionalEnum(p.outcome) as OutcomeTag | null,
    resolvedAt: p.resolvedAt == null ? null : num(p.resolvedAt),
    proposal: parseProposal(p.proposal),
    policy: parsePolicy(p.policy),
    createdEventBlob,
    synchronizerId,
  };
}

/**
 * Fetch the active MarketCounter contract from the participant Ledger API.
 * MarketCounter's signatory is the Enterprise Wallet admin party.
 */
export async function fetchMarketCounterContractId(): Promise<string | null> {
  try {
    const client = createParticipantClient();
    const list = await client.queryActiveContracts(
      adminParty(),
      templateId(TRUTHORACLE_MODULE, "MarketCounter")
    );
    const forAdmin = list.filter((item) => {
      const payload = getPayload(item);
      const admin = payload.admin ?? payload.Admin;
      return admin === adminParty();
    });
    const first = forAdmin[0];
    return first ? getContractId(first) : null;
  } catch (e) {
    debugWarn("fetchMarketCounterContractId", e);
    return null;
  }
}

/**
 * List every active PredictionMarket (all lifecycle states — Trading, Proposed,
 * Resolved, Voided live on the same template; filter on `status`). Queries as
 * the Enterprise Wallet admin party (template signatory); end-user wallets
 * reach the market via disclosed contracts (createdEventBlob captured here).
 */
export async function fetchAllPredictionMarkets(): Promise<PredictionMarketRecord[]> {
  try {
    const client = createParticipantClient();
    const list = await client.queryActiveContracts(
      adminParty(),
      templateId(TRUTHORACLE_MODULE, "PredictionMarket"),
      { includeCreatedEventBlob: true },
    );
    const out: PredictionMarketRecord[] = [];
    for (const item of list) {
      const rec = parseMarket(item);
      if (rec) out.push(rec);
    }
    out.sort((a, b) => b.marketId - a.marketId);
    return out;
  } catch (e) {
    debugWarn("fetchAllPredictionMarkets", e);
    return [];
  }
}

/** Markets whose lifecycle has ended (Resolved or Voided). */
export async function fetchAllResolvedMarkets(): Promise<PredictionMarketRecord[]> {
  const all = await fetchAllPredictionMarkets();
  return all.filter((m) => m.status === "Resolved" || m.status === "Voided");
}

/**
 * Fetch active PredictionMarket contracts and return the one matching marketId.
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
    debugWarn("fetchPredictionMarketContractId", e);
    return null;
  }
}

export interface UserMarketPosition {
  contractId: string;
  marketId: number;
  yesShares: number;
  noShares: number;
  /** Lifetime CC spent on this market (void refunds / accounting). */
  costBasisCC: number;
}

function parsePosition(item: unknown, partyId: string): UserMarketPosition | null {
  const cid = getContractId(item);
  if (!cid) return null;
  const p = getPayload(item);
  if (p.holder !== partyId) return null;
  const mid = p.marketId ?? p.market_id;
  if (mid == null) return null;
  return {
    contractId: cid,
    marketId: Number(mid),
    yesShares: num(p.yesShares),
    noShares: num(p.noShares),
    costBasisCC: num(p.costBasisCC),
  };
}

/** Fetch the holder's Position for a given market (or null). */
export async function fetchUserPosition(
  partyId: string,
  marketId: number
): Promise<UserMarketPosition | null> {
  try {
    const client = createParticipantClient();
    const list = await client.queryActiveContracts(
      partyId,
      templateId(TRUTHORACLE_MODULE, "Position")
    );
    for (const item of list) {
      const pos = parsePosition(item, partyId);
      if (pos && pos.marketId === marketId) return pos;
    }
    return null;
  } catch (e) {
    debugWarn("fetchUserPosition", e);
    return null;
  }
}

/** List every Position the holder has across all markets. */
export async function fetchAllUserPositions(
  partyId: string
): Promise<UserMarketPosition[]> {
  try {
    const client = createParticipantClient();
    const list = await client.queryActiveContracts(
      partyId,
      templateId(TRUTHORACLE_MODULE, "Position")
    );
    const out: UserMarketPosition[] = [];
    for (const item of list) {
      const pos = parsePosition(item, partyId);
      if (pos) out.push(pos);
    }
    out.sort((a, b) => b.marketId - a.marketId);
    return out;
  } catch (e) {
    debugWarn("fetchAllUserPositions", e);
    return [];
  }
}

// Back-compat aliases (previous template was UserMarketData).
export const fetchUserMarketDataPosition = fetchUserPosition;
export const fetchAllUserMarketDataPositions = fetchAllUserPositions;
export async function fetchUserMarketDataContractId(
  partyId: string,
  marketId?: number
): Promise<string | null> {
  if (marketId != null) {
    const pos = await fetchUserPosition(partyId, marketId);
    return pos?.contractId ?? null;
  }
  const all = await fetchAllUserPositions(partyId);
  return all[0]?.contractId ?? null;
}

export interface LiquidityPositionRecord {
  contractId: string;
  marketId: number;
  provider: string;
  lpTokens: number;
  depositedCC: number;
}

/** Fetch the provider's LiquidityPosition for a market (or null). */
export async function fetchUserLpPosition(
  partyId: string,
  marketId: number
): Promise<LiquidityPositionRecord | null> {
  try {
    const client = createParticipantClient();
    const list = await client.queryActiveContracts(
      partyId,
      templateId(TRUTHORACLE_MODULE, "LiquidityPosition")
    );
    for (const item of list) {
      const cid = getContractId(item);
      if (!cid) continue;
      const p = getPayload(item);
      if (p.provider !== partyId) continue;
      if (Number(p.marketId) !== marketId) continue;
      return {
        contractId: cid,
        marketId: Number(p.marketId),
        provider: asString(p.provider),
        lpTokens: num(p.lpTokens),
        depositedCC: num(p.depositedCC),
      };
    }
    return null;
  } catch (e) {
    debugWarn("fetchUserLpPosition", e);
    return null;
  }
}

export interface OutcomeAttestationRecord {
  contractId: string;
  attester: string;
  marketId: number;
  sourceUri: string;
  fetchedAt: number;
  outcome: OutcomeTag;
  payloadHash: string;
  hasSourceSignature: boolean;
  responseExcerpt: string | null;
}

/**
 * List attestations for a market. Query as the admin (observer of every
 * attestation) for the resolution console, or as a reporter for their own.
 */
export async function fetchAttestations(
  partyId: string,
  marketId?: number
): Promise<OutcomeAttestationRecord[]> {
  try {
    const client = createParticipantClient();
    const list = await client.queryActiveContracts(
      partyId,
      templateId(TRUTHORACLE_MODULE, "OutcomeAttestation")
    );
    const out: OutcomeAttestationRecord[] = [];
    for (const item of list) {
      const cid = getContractId(item);
      if (!cid) continue;
      const p = getPayload(item);
      if (marketId != null && Number(p.marketId) !== marketId) continue;
      out.push({
        contractId: cid,
        attester: asString(p.attester),
        marketId: num(p.marketId),
        sourceUri: asString(p.sourceUri),
        fetchedAt: num(p.fetchedAt),
        outcome: (enumTag(p.outcome) || "Yes") as OutcomeTag,
        payloadHash: asString(p.payloadHash),
        hasSourceSignature: p.sourceSignature != null,
        responseExcerpt: p.responseExcerpt == null ? null : asString(p.responseExcerpt),
      });
    }
    out.sort((a, b) => b.fetchedAt - a.fetchedAt);
    return out;
  } catch (e) {
    debugWarn("fetchAttestations", e);
    return [];
  }
}

export interface ModelForecastRecord {
  contractId: string;
  author: string;
  marketId: number;
  modelId: string;
  probabilityYes: number;
  committedAt: number;
  marketPriceAtCommit: number;
}

/** List committed model forecasts (query as admin for all, or as the author). */
export async function fetchModelForecasts(
  partyId: string,
  marketId?: number
): Promise<ModelForecastRecord[]> {
  try {
    const client = createParticipantClient();
    const list = await client.queryActiveContracts(
      partyId,
      templateId(TRUTHORACLE_MODULE, "ModelForecast")
    );
    const out: ModelForecastRecord[] = [];
    for (const item of list) {
      const cid = getContractId(item);
      if (!cid) continue;
      const p = getPayload(item);
      if (marketId != null && Number(p.marketId) !== marketId) continue;
      out.push({
        contractId: cid,
        author: asString(p.author),
        marketId: num(p.marketId),
        modelId: asString(p.modelId),
        probabilityYes: num(p.probabilityYes),
        committedAt: num(p.committedAt),
        marketPriceAtCommit: num(p.marketPriceAtCommit),
      });
    }
    out.sort((a, b) => b.committedAt - a.committedAt);
    return out;
  } catch (e) {
    debugWarn("fetchModelForecasts", e);
    return [];
  }
}

export interface UserWalletRecord {
  contractId: string;
  admin: string;
  owner: string;
  /** Spendable in-app balance in CC. */
  balanceCC: number;
  /** Lifetime external deposits. */
  depositedCC: number;
  /** Lifetime external withdrawals. */
  withdrawnCC: number;
}

/**
 * Fetch the party's in-app UserWallet (or null if they never deposited).
 * The owner is an observer, so querying as the user surfaces their wallet;
 * querying as the admin surfaces every wallet (treasury reconciliation).
 */
export async function fetchUserWallet(partyId: string): Promise<UserWalletRecord | null> {
  try {
    const client = createParticipantClient();
    const list = await client.queryActiveContracts(
      partyId,
      templateId(TRUTHORACLE_MODULE, "UserWallet")
    );
    for (const item of list) {
      const cid = getContractId(item);
      if (!cid) continue;
      const p = getPayload(item);
      if (p.owner !== partyId) continue;
      return {
        contractId: cid,
        admin: asString(p.admin),
        owner: asString(p.owner),
        balanceCC: num(p.balanceCC),
        depositedCC: num(p.depositedCC),
        withdrawnCC: num(p.withdrawnCC),
      };
    }
    return null;
  } catch (e) {
    debugWarn("fetchUserWallet", e);
    return null;
  }
}

/**
 * Poll until the user's wallet satisfies `predicate` (e.g. balance credited
 * after a deposit) or the timeout elapses. Returns the latest record either way.
 */
export async function waitForUserWallet(
  partyId: string,
  predicate: (w: UserWalletRecord | null) => boolean,
  opts?: { timeoutMs?: number; intervalMs?: number },
): Promise<UserWalletRecord | null> {
  const timeoutMs = opts?.timeoutMs ?? 30_000;
  const intervalMs = opts?.intervalMs ?? 1_500;
  const deadline = Date.now() + timeoutMs;
  let latest: UserWalletRecord | null = null;
  for (;;) {
    latest = await fetchUserWallet(partyId);
    if (predicate(latest) || Date.now() >= deadline) return latest;
    await new Promise((r) => setTimeout(r, intervalMs));
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
    debugWarn("fetchPendingPayouts", e);
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
    debugWarn("fetchUserRewardsSummaryContractId", e);
    return null;
  }
}
