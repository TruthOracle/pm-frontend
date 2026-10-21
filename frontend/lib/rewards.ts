/**
 * Rewards — the TRO grants the backend computes from its ledger index (truthoracle-backend
 * docs/TOKENS.md §4.6). Nothing is claimed in the browser: a rule fires on a trade, a redeem or
 * a first deposit, the backend writes a grant and credits it on-ledger with `UserWallet.Grant`
 * on the account's TRO wallet, and this module reads the result (`GET /me/rewards`) and names
 * the rule kinds and grant statuses in plain words. The operator's side (rules, manual grants,
 * the float) is in lib/backendAdmin.ts; the shapes below are shared by both.
 */
import { backendFetch, isBackendError } from "@/lib/backend";
import { backendErrorMessage } from "@/lib/backendErrors";
import { formatAmount, type InstrumentRef } from "@/lib/instruments";
import type { LedgerWallet, Money } from "@/auth/types";

/** The rule kinds the backend ships (`to_reward_rules.kind`); `manual` is the operator's grant. */
export const REWARD_KINDS = ["trade_volume_rebate", "winning_redeem_bonus", "first_deposit_bonus", "manual"] as const;
export type RewardKind = (typeof REWARD_KINDS)[number];

/**
 * `queued` (written, not yet submitted) → `submitted` (`UserWallet.Grant` sent) → `credited`
 * (`creditRefs` carries `reward:<grantId>`); `failed` (the ledger refused it) or `blocked_float`
 * (the treasury's TRO holdings do not cover Σ in-app balances + the grant) wait for an operator
 * or an auto-mint.
 */
export const REWARD_GRANT_STATUSES = ["queued", "submitted", "credited", "failed", "blocked_float"] as const;
export type RewardGrantStatus = (typeof REWARD_GRANT_STATUSES)[number];

/** `to_reward_grants` on the wire (`GET /me/rewards`, `GET /admin/rewards/grants`). */
export interface RewardGrant {
  id: string;
  userId: string | null;
  party: string;
  ruleId: string | null;
  kind: RewardKind;
  /** The wallet entry / market event the grant was earned on; null for a manual grant. */
  sourceEventId: string | null;
  instrument: InstrumentRef;
  amount: Money;
  reason: string;
  status: RewardGrantStatus;
  commandId: string | null;
  /** `reward:<grantId>` — what `UserWallet.creditRefs` carries once credited. */
  ref: string;
  error: string | null;
  createdAt: string;
  creditedAt: string | null;
}

/** `GET /me/rewards`: the account's TRO wallet (null until the first grant), its totals and every grant. */
export interface RewardsOverview {
  instrument: InstrumentRef;
  wallet: LedgerWallet | null;
  totals: { credited: Money; queued: Money };
  grants: RewardGrant[];
}

/** `to_reward_rules` on the wire (`GET /admin/rewards/rules`, `PUT /admin/rewards/rules/:id`). */
export interface RewardRule {
  id: string;
  kind: RewardKind;
  /** Decimal strings, never numbers: `{ perUnit, minTrade }`, `{ fraction }`, `{ amount }`. */
  params: Record<string, string>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * `GET /admin/rewards/float` — the treasury's TRO holdings against what the in-app wallets owe
 * and what is on its way to one (docs/TOKENS.md §10, "The float rule counts in-flight grants").
 */
export interface RewardsFloat {
  instrument: InstrumentRef;
  /** Σ of the treasury's active holdings in the rewards instrument (index). */
  treasuryHoldings: Money;
  /** Σ `UserWallet.balance` in the rewards instrument (index). */
  liabilities: Money;
  /** Σ grants submitted or credited that the index does not show in a balance yet — owed, but not in `liabilities` until the ledger lands. */
  pending: Money;
  /** `treasuryHoldings − liabilities − pending`; a grant is only submitted while it covers the grant. */
  headroom: Money;
}

export function fetchMyRewards(): Promise<RewardsOverview> {
  return backendFetch<RewardsOverview>("/api/v1/me/rewards");
}

/**
 * The backend answers `GET /me/rewards` with 404 when no rewards instrument is configured —
 * nobody computes rewards then, so the page says that instead of "not found".
 */
export function isRewardsUnconfigured(e: unknown): boolean {
  return isBackendError(e) && e.status === 404;
}

export const REWARDS_UNCONFIGURED_SENTENCE =
  "Rewards are not set up on this deployment yet: no rewards token is configured, so nothing accrues.";

export function rewardsErrorMessage(e: unknown): string {
  return isRewardsUnconfigured(e) ? REWARDS_UNCONFIGURED_SENTENCE : backendErrorMessage(e);
}

/** The parameter keys each rule kind reads (docs/TOKENS.md §4.6) — what the operator's editor shows. */
export const REWARD_RULE_PARAM_KEYS: Record<RewardKind, readonly string[]> = {
  trade_volume_rebate: ["perUnit", "minTrade"],
  winning_redeem_bonus: ["fraction"],
  first_deposit_bonus: ["amount"],
  manual: [],
};

export function isRewardKind(kind: string): kind is RewardKind {
  return (REWARD_KINDS as readonly string[]).includes(kind);
}

/** "Trade volume rebate" — the rule kind as a heading; an unknown kind reads as its token with the underscores gone. */
export function rewardKindLabel(kind: string): string {
  switch (kind) {
    case "trade_volume_rebate":
      return "Trade volume rebate";
    case "winning_redeem_bonus":
      return "Winning redeem bonus";
    case "first_deposit_bonus":
      return "First deposit bonus";
    case "manual":
      return "Operator grant";
    default:
      return kind.replace(/_/g, " ");
  }
}

/** `0.05` → `5%`, for the redeem bonus fraction; a non-number is shown as written. */
function percentOf(fraction: string | undefined): string | null {
  if (fraction === undefined) return null;
  const n = Number(fraction);
  return Number.isFinite(n) ? `${formatAmount(n * 100, { decimals: 4 })}%` : fraction;
}

/**
 * The rule in plain words, with its figures when the params are known: `symbol` is the rewards
 * token, `params` the rule's own (`GET /admin/rewards/rules`); without params the sentence
 * describes the mechanism alone, which is what the user-facing page shows.
 */
export function rewardKindDescription(kind: string, symbol: string, params?: Record<string, string>): string {
  switch (kind) {
    case "trade_volume_rebate": {
      const perUnit = params?.perUnit;
      const minTrade = params?.minTrade;
      const rate =
        perUnit !== undefined ? ` — ${formatAmount(perUnit, { decimals: 10 })} ${symbol} per unit traded` : "";
      const floor = minTrade !== undefined ? `, on trades of at least ${formatAmount(minTrade, { decimals: 10 })}` : "";
      return `Every buy and sell on a market in the default collateral earns ${symbol} in proportion to its size${rate}${floor}.`;
    }
    case "winning_redeem_bonus": {
      const pct = percentOf(params?.fraction);
      return `Redeeming winning shares pays a bonus on top of the payout${pct ? `: ${pct} of it` : ""}, in ${symbol}.`;
    }
    case "first_deposit_bonus": {
      const amount = params?.amount;
      return `A one-time ${amount !== undefined ? `${formatAmount(amount, { decimals: 10 })} ${symbol} ` : `${symbol} `}bonus when your first deposit is credited.`;
    }
    case "manual":
      return `${symbol} the operator credits by hand — promotions, compensation, corrections.`;
    default:
      return `Credited in ${symbol} by the operator's "${rewardKindLabel(kind)}" rule.`;
  }
}

export type RewardTone = "neutral" | "pending" | "ok" | "warn" | "bad";

/** Status pill per `RewardGrant.status`, in the recipient's words. */
export function rewardStatusView(status: string): { label: string; tone: RewardTone; detail: string } {
  switch (status) {
    case "queued":
      return { label: "Queued", tone: "pending", detail: "Recorded; the treasury credits it on its next pass." };
    case "submitted":
      return { label: "Crediting", tone: "pending", detail: "The treasury-signed grant is on its way to the ledger." };
    case "credited":
      return { label: "Credited", tone: "ok", detail: "In your in-app balance." };
    case "failed":
      return { label: "Failed", tone: "bad", detail: "The ledger refused the grant; an operator will look at it." };
    case "blocked_float":
      return {
        label: "Waiting for treasury float",
        tone: "warn",
        detail: "The treasury holds too little of the rewards token right now; it is credited once topped up.",
      };
    default:
      return { label: status.replace(/_/g, " "), tone: "neutral", detail: "" };
  }
}
