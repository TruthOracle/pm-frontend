import { createParticipantClient } from "@/lib/cantonParticipant";
import { TRUTHORACLE_PACKAGE_ID, TRUTHORACLE_PACKAGE_NAME } from "@/constants";
import { ENTERPRISE_WALLET_PARTY_ID } from "@/config";
import { debugLog, debugWarn } from "@/lib/debugLog";
import { getC8Provider } from "@/wallets/cantor8/c8Provider";
import type { ScannerContract } from "@cantor8/wallet-connect-sdk";

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

/** Pull the optional disclosed-contract fields (blob only present when includeCreatedEventBlob was set). */
function getDisclosure(
  item: unknown,
): { templateId?: string; createdEventBlob?: string; synchronizerId?: string } {
  const c = item as Record<string, unknown>;
  return {
    templateId: typeof c.templateId === "string" ? c.templateId : undefined,
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

// ---------------------------------------------------------------------------
// Cantor8 Scanner reads (wallet SDK ≥0.6.0 `getActiveContracts`)
//
// The participant proxy authenticates as OUR Keycloak client, which can read as
// the Enterprise Wallet party but not as an external Cantor8 party — so a
// `filtersByParty[userParty]` query comes back empty for end users on mainnet.
// The wallet SDK reads the same contracts from the Cantor8 Scanner with the
// user's own wallet token, so anything the user is a stakeholder of (their
// UserWallet: `observer owner`) is returned wherever the party is hosted.
// ---------------------------------------------------------------------------

/** Scanner template filter — package-id form, per the SDK 0.6.0 README. */
function scannerTemplateId(moduleName: string, entityName: string): string {
  return `${TRUTHORACLE_PACKAGE_ID}:${moduleName}:${entityName}`;
}

/** Module:Entity match on either Scanner template column, whatever the package version. */
function scannerRowIsTemplate(row: ScannerContract, moduleName: string, entityName: string): boolean {
  const suffix = `:${moduleName}:${entityName}`;
  return (
    (typeof row.template_id === "string" && row.template_id.endsWith(suffix)) ||
    (typeof row.template_id_named === "string" && row.template_id_named.endsWith(suffix))
  );
}

/** Each distinct Scanner failure is warned once — these readers poll, and a stale session would otherwise spam the console. */
const scannerWarned = new Set<string>();

/**
 * Active `<module>:<entity>` contracts visible to `partyId`, read from the Cantor8
 * Scanner through the wallet SDK. Rows come back in the same `{ contractId, payload }`
 * shape as `queryActiveContracts` so the parsers are shared.
 *
 * Returns null (not []) when the Scanner path is unavailable so callers can fall
 * back to the participant: no Cantor8 provider mounted (VITE_WALLET_TYPE=canton),
 * wallet not connected, `partyId` isn't the connected primary account, the session
 * predates SDK 0.6.0 (no Scanner URL — the user must disconnect and reconnect), or
 * the request itself failed.
 */
async function scanActiveContracts(
  partyId: string,
  moduleName: string,
  entityName: string,
): Promise<ContractInfo[] | null> {
  const c8 = getC8Provider();
  if (!c8) return null;
  let rows: ScannerContract[];
  try {
    rows = await c8.getActiveContracts({
      partyId,
      templateIds: [scannerTemplateId(moduleName, entityName)],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!scannerWarned.has(msg)) {
      scannerWarned.add(msg);
      debugWarn(`[scanner] ${moduleName}:${entityName} read failed, falling back to the participant: ${msg}`, e);
    }
    return null;
  }
  debugLog(`[scanner] ${moduleName}:${entityName} rows=${rows.length}`, rows[0]);
  const out: ContractInfo[] = [];
  for (const row of rows) {
    if (typeof row?.contract_id !== "string" || !row.contract_id) continue;
    if (!scannerRowIsTemplate(row, moduleName, entityName)) continue;
    const args = row.create_args;
    if (!args || typeof args !== "object" || Array.isArray(args)) continue;
    out.push({ contractId: row.contract_id, payload: args as Record<string, unknown> });
  }
  return out;
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
  /**
   * Template id in package-id form, exactly as the ledger returned it — the package
   * the contract was CREATED under. A DisclosedContract must carry this id, not the
   * app's configured TRUTHORACLE_PACKAGE_ID: a market created under 1.0.0 is still a
   * 1.0.0 contract after the 2.0.0 upload, and the participant rejects a disclosure
   * whose templateId disagrees with the decoded blob ("Mismatch between
   * DisclosedContract.template_id and ... created_event_blob"). The exercise itself
   * keeps targeting the configured package (that is the upgrade path).
   */
  templateId?: string;
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
  const { templateId: actualTemplateId, createdEventBlob, synchronizerId } = getDisclosure(item);
  return {
    contractId: cid,
    templateId: actualTemplateId,
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

function parseUserWallet(contractId: string, p: Record<string, unknown>): UserWalletRecord {
  return {
    contractId,
    admin: asString(p.admin),
    owner: asString(p.owner),
    balanceCC: num(p.balanceCC),
    depositedCC: num(p.depositedCC),
    withdrawnCC: num(p.withdrawnCC),
  };
}

/**
 * Fetch the party's in-app UserWallet (or null if they never deposited).
 * The owner is an observer, so querying as the user surfaces their wallet;
 * querying as the admin surfaces every wallet (treasury reconciliation).
 *
 * Reads the Cantor8 Scanner through the wallet SDK first (see scanActiveContracts —
 * the participant proxy can't read as an external Cantor8 party, which left the
 * in-app balance blank on mainnet), then falls back to the participant when the
 * Scanner path is unavailable or has no wallet for the party.
 */
export async function fetchUserWallet(partyId: string): Promise<UserWalletRecord | null> {
  const scanned = await scanActiveContracts(partyId, TRUTHORACLE_MODULE, "UserWallet");
  if (scanned) {
    const mine = scanned.find((c) => c.payload?.owner === partyId);
    if (mine) return parseUserWallet(mine.contractId, mine.payload ?? {});
  }
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
      return parseUserWallet(cid, p);
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
