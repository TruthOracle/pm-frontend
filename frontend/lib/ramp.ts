/**
 * The BYN ramp (truthoracle-backend docs/RAMP.md, API §12.1): buy the ramp token (cBYN, 1 BYN =
 * 1 token) by card or ERIP, and cash it out back to the card it was bought with or to a bank
 * account in the person's own name. Nothing is decided in the browser: card details and 3-D
 * Secure stay on the acquirer's hosted page, ERIP is paid in the person's bank, and an order
 * moves only on the provider's API, the bank statement and the ledger, which the backend reads.
 *
 * This module is the client and ALL the ramp wording; the pure logic it leans on (exact
 * decimals, limits, link checks, polling) is lib/rampLogic.ts. Rules the wording keeps:
 *  - a compliance hold reads exactly like ordinary processing ("Processing"): the user API hides
 *    compliance review steps, and no sentence here may hint at one (no tipping-off);
 *  - an ineligibility reason the table does not know gets the neutral sentence, never its code;
 *  - fiat always prints with its own two decimals, from the string, never through a float.
 *
 * A cash-out is two clicks: "Review cash-out" opens the order, and the order page's "Sign in
 * wallet" calls the wallet FIRST (the popup must open inside the click), then finds the
 * PendingPayout that Withdraw created and calls `attach`; if that page dies after the signature,
 * the backend binds the withdrawal on its own scan. Every order creation carries an
 * `Idempotency-Key`, so a retried click answers the order the first attempt created.
 */
import { BackendError, backendFetch, isBackendError } from "@/lib/backend";
import { backendErrorMessage, type ErrorSentences } from "@/lib/backendErrors";
import type { PrepareExecuteParams } from "@/lib/cantonDapp";
import { fetchBackendPayouts, waitForFreshWithdrawPayout } from "@/lib/inAppWallet";
import { formatMoney, sameInstrument, type InstrumentRef } from "@/lib/instruments";
import {
  compareDecimal,
  damlDecimalString,
  formatFixed,
  isPositiveDecimal,
  ledgerAmountEquals,
  type AmountProblem,
  type ConsentBody,
  type LimitProblem,
} from "@/lib/rampLogic";
import { formatDateTimeUTC } from "@/lib/time";
import type { Money } from "@/auth/types";
import { APP_NETWORK, WALLET_DISPLAY_NAME } from "@/config";
import { fetchPendingPayouts, fetchUserWallet, type PendingPayoutRecord } from "@/utils/activeContracts";
import { buildWalletWithdrawParams } from "@/utils/cantonCommands";

export type RampDirection = "onramp" | "offramp";
export type RampMethod = "card" | "erip";
export type RampRail = "card" | "bank";

/** `to_ramp_orders.status` (docs/RAMP.md §3.2). */
export type RampOrderStatus =
  | "created"
  | "awaiting_payment"
  | "paid"
  | "minting"
  | "crediting"
  | "completed"
  | "refunding"
  | "refunded"
  | "chargeback"
  | "failed"
  | "expired"
  | "cancelled"
  | "needs_review"
  | "awaiting_withdrawal"
  | "withdrawing"
  | "burning"
  | "paying_out"
  | "payout_queued"
  | "payout_sent"
  | "reversing";

/** The review step the user API shows; a compliance review arrives as null (§11.5). */
export type RampReviewStep = "payment" | "mint" | "credit" | "withdrawal" | "burn" | "payout" | "refund" | "reversal";

/** The ramp token as GET /ramp and the orders carry it (the catalog name is optional there). */
export type RampInstrument = Pick<InstrumentRef, "admin" | "id" | "symbol" | "decimals"> & { name?: string };

export interface RampFee {
  bps: number;
  fixed: Money;
}

/** What the person does next to pay an on-ramp: the acquirer's hosted page, or ERIP by reference. */
export type RampPaymentNext =
  | { kind: "redirect"; url: string }
  | {
      kind: "erip";
      serviceCode: string;
      /** The order's payout-reference digits (12). */
      accountNumber: string;
      amount: Money;
      instructions: string[];
      /** Raw base64 PNG of the payment QR (≤ 64 KB decoded). */
      qrPng?: string;
      qrRaw?: string;
      /** Bank-app links: a scheme of RAMP_DEEPLINK_SCHEMES, or https on the acquirer's hosts (checked again here). */
      deeplinks?: { name: string; url: string }[];
    };

export type RampDestination =
  | { kind: "card"; paymentMethodId: string; brand: string | null; last4: string | null }
  | { kind: "bank"; bankAccountId: string; bankName: string | null; ibanMasked: string };

/** `ApiRampOrder` (§12.1). */
export interface RampOrder {
  id: string;
  direction: RampDirection;
  status: RampOrderStatus;
  /**
   * `processing` while an operator, a review or a hold has the order — one word for every reason
   * (no tipping-off), else null. The backend's single mapping; the words below follow it.
   */
  statusText: string | null;
  reviewStep: RampReviewStep | null;
  method: RampMethod | null;
  rail: RampRail | null;
  instrument: RampInstrument;
  fiatCurrency: string;
  /** On-ramp: what is paid. Cash-out: what the card or bank account receives. */
  fiatAmount: Money;
  /** On-ramp: credited in-app. Cash-out: withdrawn from the in-app balance. */
  tokenAmount: Money;
  feeAmount: Money;
  /** Only while `awaiting_payment`. */
  next: RampPaymentNext | null;
  /** Only while `awaiting_withdrawal`: sign `UserWallet.Withdraw { amount }` on this wallet. */
  withdraw: { walletContractId: string; amount: Money } | null;
  destination: RampDestination | null;
  /** The card that paid an on-ramp. */
  card: { brand: string | null; last4: string | null } | null;
  /** `TO-` + 12 digits: the ERIP account number, the bank transfer's purpose, the refund description. */
  payoutReference: string | null;
  expiresAt: string | null;
  /** Compliance steps are hidden by the server. */
  timeline: { status: RampOrderStatus; at: string }[];
  operator: { name: string } | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

/** Limits for one direction; `amount` is what the person gives (BYN on-ramp, tokens off-ramp). */
export interface RampLimits {
  min: Money;
  max: Money;
  dailyMax: Money;
  monthlyMax: Money;
  dailyRemaining: Money;
  monthlyRemaining: Money;
}

/**
 * The reasons `GET /ramp.eligibility[*].reasons` can name. Every compliance cause (a freeze, a
 * screening hit, an open alert, the vendor flags…) arrives as the one word `compliance`.
 */
export type RampIneligibility =
  | "ramp_disabled"
  | "provider_unconfigured"
  | "token_app_unconfigured"
  | "instrument_unconfigured"
  | "payouts_unsupported"
  | "user_suspended"
  | "no_primary_wallet"
  | "kyc_required"
  | "kyc_duplicate_identity"
  | "consent_required"
  | "additional_info_required"
  | "compliance"
  | "no_payout_card";

export interface RampEligibility {
  allowed: boolean;
  /** `RampIneligibility` codes; an unknown one still reads as the neutral sentence. */
  reasons: string[];
}

/** `GET /ramp` — everything the buy / cash-out card renders. */
export interface RampOverview {
  enabled: boolean;
  /** A runtime halt: no new orders; orders in flight keep going and stay cancellable. The reason stays internal. */
  paused: { orders: boolean; reason: null };
  provider: string | null;
  /** The operator of record and its terms. */
  operator: { name: string; termsUrl: string; termsVersion: string } | null;
  consent: { required: boolean; termsVersion: string; termsUrl: string };
  instrument: RampInstrument | null;
  fiat: { currency: string; decimals: number };
  methods: { method: RampMethod; ttlMinutes: number; fee: RampFee }[];
  rails: { rail: RampRail; fee: RampFee; eta: { businessDays: number } }[];
  limits: Record<RampDirection, RampLimits>;
  /** Card purchases still inside the dispute window, and what may go to a bank account now. */
  exposure: { amount: Money; withdrawableToBank: Money };
  eligibility: Record<RampDirection, RampEligibility>;
  openOrders: RampOrder[];
}

/** The limit a quote or an order ran into. */
export type RampLimitName = "min" | "max" | "daily" | "monthly" | "card_cashout" | "exposure";

/** `POST /ramp/quote`. */
export interface RampQuote {
  direction: RampDirection;
  instrument: RampInstrument;
  fiatCurrency: string;
  fiatAmount: Money;
  tokenAmount: Money;
  fee: Money;
  /** false = an order with these inputs would be refused now; `limit` says which one. */
  withinLimits: boolean;
  /** `card_cashout` / `exposure` only when a destination was given. */
  limit: { name: RampLimitName; min?: Money; max?: Money; available?: Money } | null;
}

/** A saved card (`GET /ramp/payment-methods`) and how much can go back to it. */
export interface RampCard {
  id: string;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  issuerCountry: string | null;
  status: "active" | "removed" | "blocked";
  /** Funded a completed, 3-D Secure on-ramp of this account: a valid cash-out destination. */
  payoutEligible: boolean;
  cashout: { mode: "refund" | "oct" | "none"; available: Money };
  createdAt: string;
  lastUsedAt: string | null;
}

/** `POST /ramp/consent`. */
export interface RampConsentResult {
  consent: { required: boolean; termsVersion: string };
}

export type RampBankAccountStatus = "cooling_off" | "pending_proof" | "active" | "removed" | "blocked";
export type RampNameForm = "be" | "ru" | "lat";

/** A payout bank account (`/ramp/bank-accounts`): a BYN IBAN in the person's verified name. */
export interface RampBankAccount {
  id: string;
  ibanMasked: string;
  bankName: string | null;
  bic: string | null;
  holderName: string | null;
  status: RampBankAccountStatus;
  usableFrom: string | null;
  proof: "bank_name_check" | "payer_match" | "manual" | null;
}

export type RampTone = "neutral" | "pending" | "ok" | "warn" | "bad";

// ---------------------------------------------------------------------------
// Words: order status
// ---------------------------------------------------------------------------

type StatusSubject = Pick<RampOrder, "status" | "direction"> &
  Partial<Pick<RampOrder, "rail" | "method" | "statusText">>;

/** The steps that wait on the person keep their own words even while held: the next action is still theirs. */
const PERSON_STEPS: ReadonlySet<string> = new Set(["awaiting_payment", "awaiting_withdrawal"]);

/**
 * The backend says an operator, a review or a hold has the order (`statusText: "processing"`,
 * whatever the reason — compliance, card exposure, the payout gate, a freeze): it reads as plain
 * processing, never as the step it stopped in (§11.5, no tipping-off).
 */
export function isHeldOrder(order: Pick<StatusSubject, "status" | "statusText">): boolean {
  return order.statusText === "processing" && !PERSON_STEPS.has(order.status);
}

const PROCESSING_SENTENCE =
  "This order is taking longer than usual. Nothing is lost: it either completes or the money is returned to you. This page updates by itself.";

/**
 * One label and tone per status, worded for the direction the person took. Every review step,
 * every hold and the processing steps a hold can stop in read "Processing": a compliance hold
 * must look like any other wait (§11.5).
 */
export function rampStatusView(order: StatusSubject): { label: string; tone: RampTone } {
  const buy = order.direction === "onramp";
  if (isHeldOrder(order)) return { label: "Processing", tone: "pending" };
  switch (order.status) {
    case "created":
      return { label: "Starting", tone: "pending" };
    case "awaiting_payment":
      return { label: "Waiting for payment", tone: "pending" };
    case "paid":
    case "minting":
    case "crediting":
      return { label: "Payment received", tone: "pending" };
    case "awaiting_withdrawal":
      return { label: "Waiting for your signature", tone: "pending" };
    case "withdrawing":
    case "burning":
    case "needs_review":
      return { label: "Processing", tone: "pending" };
    case "paying_out":
      return { label: "Paying to your card", tone: "pending" };
    case "payout_queued":
      return { label: buy ? "Refund queued" : "Queued for bank transfer", tone: "pending" };
    case "payout_sent":
      return { label: buy ? "Refund sent" : "Sent by bank transfer", tone: "pending" };
    case "reversing":
      return { label: "Returning to your balance", tone: "warn" };
    case "refunding":
      return { label: "Refunding", tone: "warn" };
    case "completed":
      return { label: buy ? "Credited" : "Paid out", tone: "ok" };
    case "refunded":
      return { label: buy ? "Refunded" : "Returned to your balance", tone: "neutral" };
    case "failed":
      return { label: "Failed", tone: "bad" };
    case "expired":
      return { label: "Expired", tone: "neutral" };
    case "cancelled":
      return { label: "Cancelled", tone: "neutral" };
    case "chargeback":
      return { label: "Disputed by your bank", tone: "bad" };
    default:
      return { label: "Processing", tone: "pending" };
  }
}

/**
 * A timeline entry's label: the status label, with "created" spelled as the order opening. Past
 * entries are words for their status alone: the order's current hold (`statusText`) is not theirs.
 */
export function rampTimelineLabel(
  order: Pick<RampOrder, "direction" | "rail" | "method">,
  status: RampOrderStatus,
): string {
  return status === "created"
    ? "Order opened"
    : rampStatusView({ direction: order.direction, rail: order.rail, method: order.method, status }).label;
}

/** "within 2 business days", or "within a few business days" when the rail names no figure. */
export function bankEtaPhrase(days: number | null | undefined): string {
  return days && days > 0 ? `within ${days} business day${days === 1 ? "" : "s"}` : "within a few business days";
}

/**
 * The sentence under the status: what happens next, in the person's terms. `bankDays` = the bank
 * rail's ETA; `signedAt` = this tab saw the cash-out's withdrawal signed (readRampSignedAt).
 */
export function rampStatusSentence(order: RampOrder, opts: { bankDays?: number | null; signedAt?: number | null } = {}): string {
  const token = order.instrument.symbol;
  const buy = order.direction === "onramp";
  const erip = order.method === "erip";
  const toCard = order.rail === "card";
  if (isHeldOrder(order)) return PROCESSING_SENTENCE;
  switch (order.status) {
    case "created":
      return "Your order is being prepared. This page updates by itself.";
    case "awaiting_payment":
      return erip
        ? "Pay this order in ERIP with the details below before the deadline. This page updates by itself once the payment arrives."
        : "Complete the payment on the card page. This page updates by itself once your bank confirms it.";
    case "paid":
    case "minting":
    case "crediting":
      return `Your payment arrived. ${token} is being credited to your in-app balance.`;
    case "awaiting_withdrawal":
      return `Sign the withdrawal in your ${WALLET_DISPLAY_NAME} wallet to start the cash-out. Nothing leaves your balance until you sign.`;
    case "withdrawing":
    case "burning":
      return "Your withdrawal is signed and the cash-out is being processed. This page updates by itself.";
    case "needs_review":
      return PROCESSING_SENTENCE;
    case "paying_out":
      return "The money is going back to your card. Banks usually show it within minutes, sometimes only after a few days.";
    case "payout_queued":
      return buy
        ? "Your refund goes to your bank account with our next bank transfer."
        : "Your cash-out goes to your bank account with our next bank transfer.";
    case "payout_sent":
      return `The bank transfer was sent and usually arrives ${bankEtaPhrase(opts.bankDays)}. This page updates once our bank confirms it.`;
    case "reversing":
      return `The payout did not go through. The ${token} is being returned to your in-app balance.`;
    case "refunding":
      return order.card ? "The payment is being refunded to your card." : "The payment is being refunded.";
    case "completed":
      if (buy) return `${token} was credited to your in-app balance.`;
      return toCard ? "The money was sent back to your card." : "The money was sent to your bank account.";
    case "refunded":
      if (!buy) return `The payout did not go through, so the ${token} is back in your in-app balance.`;
      return order.card ? "The payment was refunded to your card." : "The payment was refunded.";
    case "failed":
      return buy
        ? `This order did not complete and no ${token} was credited. If money left your account for it, it is returned to you.`
        : "This cash-out did not complete. A withdrawal you signed for it shows under Pending payouts, where you can cancel it back into your in-app balance.";
    case "expired":
      if (buy)
        return erip
          ? "This order expired. Do not pay it any more; open a new order instead."
          : "This order expired before a payment arrived.";
      // A signature that reached the network after the deadline is not this cash-out's: the backend
      // pays it out as a plain withdrawal, to the person's own wallet (review F5).
      return opts.signedAt != null
        ? `This cash-out expired before your signature reached it, so nothing goes to your ${toCard ? "card" : "bank account"}. ${LATE_WITHDRAWAL_SENTENCE}`
        : "This cash-out expired before it was signed. Nothing was paid out.";
    case "cancelled":
      if (buy) return "You cancelled this order. No money moved.";
      return opts.signedAt != null
        ? `This cash-out was cancelled, so nothing goes to your ${toCard ? "card" : "bank account"}. ${LATE_WITHDRAWAL_SENTENCE}`
        : `This cash-out was cancelled. Your ${token} stays in your in-app balance.`;
    case "chargeback":
      return "Your bank reversed this payment. Contact support about this order.";
    default:
      return "This order is being processed. This page updates by itself.";
  }
}

/** What happens to a withdrawal signed for a cash-out that ended first (F5): it is a plain withdrawal now. */
export const LATE_WITHDRAWAL_SENTENCE = `The withdrawal you signed is sent to your ${WALLET_DISPLAY_NAME} wallet as a normal withdrawal instead; Pending payouts shows where it stands.`;

/** The order page's title. */
export function rampOrderTitle(order: Pick<RampOrder, "direction" | "method" | "rail"> | null): string {
  if (!order) return "Order";
  if (order.direction === "onramp") return order.method === "erip" ? "ERIP purchase" : "Card purchase";
  return order.rail === "bank" ? "Cash-out to bank account" : "Cash-out to card";
}

// ---------------------------------------------------------------------------
// Words: eligibility, fees, cards, bank accounts, limits, errors
// ---------------------------------------------------------------------------

/** The one sentence every compliance reason, suspension or unknown code gets (no tipping-off, §11.3). */
export const RAMP_NEUTRAL_SENTENCE = "Buying and cashing out are not available for this account at the moment.";

/** Reasons that link to identity verification on the Account page. */
export function rampReasonNeedsVerification(reason: string): boolean {
  return reason === "kyc_required" || reason === "additional_info_required";
}

/** Why the account cannot use a direction (`GET /ramp.eligibility[*].reasons`), one sentence each. */
export function rampReasonSentence(reason: string): string {
  switch (reason) {
    case "kyc_required":
      return "Verify your identity first.";
    case "additional_info_required":
      return "Your identity details need a refresh. Complete the verification again.";
    case "consent_required":
      return "Accept the terms first.";
    case "no_primary_wallet":
      return "Link your wallet first.";
    case "ramp_disabled":
    case "provider_unconfigured":
    case "token_app_unconfigured":
    case "instrument_unconfigured":
      return "Buying and cashing out are not available right now.";
    case "payouts_unsupported":
      return "Cash-outs are not available right now.";
    case "no_payout_card":
      return "Cash-outs go back to a card you bought with, or to a bank account in your name. Buy once by card or add a bank account first.";
    default:
      return RAMP_NEUTRAL_SENTENCE;
  }
}

/** "30 min", "24 h", "2 d": how long an order waits for its payment. */
export function ttlLabel(minutes: number): string {
  if (!(minutes > 0)) return "";
  if (minutes % 1440 === 0) return `${minutes / 1440} d`;
  if (minutes % 60 === 0) return `${minutes / 60} h`;
  return `${minutes} min`;
}

/** What is wrong with a typed amount (null for an empty field: nothing to say yet). */
export function amountInputSentence(problem: AmountProblem, maxDecimals: number): string | null {
  switch (problem) {
    case "empty":
      return null;
    case "format":
      return "Enter an amount like 50 or 12.50.";
    case "ambiguous":
      return "Write thousands without a comma (1500) and decimals with a point or a comma (12.50 or 12,50).";
    case "decimals":
      return maxDecimals === 0 ? "Enter a whole amount." : `Use at most ${maxDecimals} decimals.`;
    case "zero":
      return "Enter an amount above zero.";
  }
}

/** Distinct sentences only: several neutral reasons collapse into one line. */
export function rampReasonSentences(reasons: readonly string[]): { reason: string; sentence: string }[] {
  const seen = new Set<string>();
  const out: { reason: string; sentence: string }[] = [];
  for (const reason of reasons) {
    const sentence = rampReasonSentence(reason);
    if (seen.has(sentence)) continue;
    seen.add(sentence);
    out.push({ reason, sentence });
  }
  return out;
}

/** A fiat figure with its currency: `1,250.50 BYN`, always the fiat's own decimals. */
export function fiatLabel(value: Money | null | undefined, currency: string, decimals = 2): string {
  return `${formatFixed(value, decimals)} ${currency}`;
}

/** `fee` as the person reads it: "free", "1.5%", "0.30 BYN", "1.5% + 0.30 BYN". */
export function rampFeeLabel(fee: RampFee | null | undefined, currency: string, decimals = 2): string {
  if (!fee) return "free";
  const pct = fee.bps > 0 ? `${(fee.bps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%` : "";
  const fixed =
    /[1-9]/.test(fee.fixed ?? "") && !String(fee.fixed).trim().startsWith("-")
      ? fiatLabel(fee.fixed, currency, decimals)
      : "";
  return [pct, fixed].filter(Boolean).join(" + ") || "free";
}

/** "VISA •••• 4242 (03/30)". */
export function cardLabel(
  card: Partial<Pick<RampCard, "expMonth" | "expYear">> & Pick<RampCard, "brand" | "last4">,
): string {
  const exp =
    card.expMonth && card.expYear
      ? ` (${String(card.expMonth).padStart(2, "0")}/${String(card.expYear).slice(-2)})`
      : "";
  return `${card.brand ?? "Card"} •••• ${card.last4 ?? "????"}${exp}`;
}

export function bankAccountLabel(account: Pick<RampBankAccount, "bankName" | "ibanMasked">): string {
  return `${account.bankName ?? "Bank account"} ${account.ibanMasked}`;
}

export const RAMP_METHOD_WORDS: Record<RampMethod, { label: string; hint: string }> = {
  card: { label: "Bank card", hint: "Pay now on the card page (Visa, Mastercard, Belkart)." },
  erip: { label: "ERIP", hint: "Pay from your bank app, internet banking or at a cashier." },
};

/** The name forms a bank account can be held under; the verified name itself stays on the server. */
export const RAMP_NAME_FORMS: { form: RampNameForm; label: string }[] = [
  { form: "be", label: "Belarusian (Cyrillic)" },
  { form: "ru", label: "Russian (Cyrillic)" },
  { form: "lat", label: "Latin, as in your passport" },
];

/** Where a bank account stands, with what the person can do about it. */
export function bankAccountStatusView(account: Pick<RampBankAccount, "status" | "usableFrom" | "proof">): {
  label: string;
  tone: RampTone;
  detail: string;
} {
  switch (account.status) {
    case "cooling_off":
      return {
        label: account.usableFrom ? `Usable from ${formatDateTimeUTC(account.usableFrom)}` : "Waiting period",
        tone: "pending",
        detail:
          "A new account waits a short period before its first payout. This protects you if someone else gets into your account.",
      };
    case "pending_proof":
      return {
        label: "Waiting for confirmation",
        tone: "pending",
        detail:
          "We still need to confirm this account is in your name. Paying once by ERIP from this account confirms it; otherwise our team checks it.",
      };
    case "active":
      return {
        label: "Ready",
        tone: "ok",
        detail:
          account.proof === "bank_name_check"
            ? "Confirmed by the bank's name check."
            : account.proof === "payer_match"
              ? "Confirmed by a payment from this account."
              : account.proof === "manual"
                ? "Confirmed by our team."
                : "Confirmed.",
      };
    case "blocked":
      return { label: "Not available", tone: "bad", detail: "This account cannot receive payouts at the moment." };
    case "removed":
      return { label: "Removed", tone: "neutral", detail: "" };
    default:
      return { label: "Not available", tone: "neutral", detail: "" };
  }
}

/** The sentence for a limit an amount breaks (`unit` is BYN or the token, 1:1). */
export function limitProblemSentence(problem: LimitProblem, unit: string): string {
  const x = `${formatFixed(problem.bound, 2)} ${unit}`;
  switch (problem.kind) {
    case "min":
      return `The smallest amount is ${x}.`;
    case "max":
      return `The largest amount per order is ${x}.`;
    case "daily":
      return `This is above what is left of your daily limit: ${x}.`;
    case "monthly":
      return `This is above what is left of your monthly limit: ${x}.`;
    case "card":
      return `Up to ${x} can go back to this card. Send the rest to a bank account.`;
    case "bank":
      return `Up to ${x} can go to a bank account now. ${RAMP_EXPOSURE_SENTENCE}`;
  }
}

/** Why card-bought value cannot go everywhere at once (card exposure, §9.3). */
export const RAMP_EXPOSURE_SENTENCE =
  "BYN bought by card can go to a bank account after the card dispute window; back to your card at any time.";

/**
 * The card exposure a plain in-app withdrawal of the ramp token runs into (`GET /ramp.exposure`,
 * I5): what may leave the platform now (`withdrawableToBank` = balance − exposure) — a withdrawal
 * above it waits as `blocked_ramp_exposure` until the dispute window has passed. Null for any
 * other instrument, or with no card-bought value inside the window.
 */
export interface WithdrawExposure {
  exposure: Money;
  withdrawable: Money;
}

export function withdrawExposureFor(
  overview: Pick<RampOverview, "instrument" | "exposure"> | null | undefined,
  instrument: Pick<InstrumentRef, "admin" | "id">,
): WithdrawExposure | null {
  if (!overview?.instrument || !sameInstrument(overview.instrument, instrument)) return null;
  if (!isPositiveDecimal(overview.exposure.amount)) return null;
  return { exposure: overview.exposure.amount, withdrawable: overview.exposure.withdrawableToBank };
}

/**
 * The open cash-out an in-app withdrawal of `amount` would be used for (review F7): the backend
 * binds a signed `withdraw` PendingPayout of exactly a waiting cash-out's amount, instrument and
 * party to that cash-out, so the money goes to its card or bank account, not to the wallet.
 */
export function openCashOutFor(
  orders: readonly RampOrder[] | null | undefined,
  instrument: Pick<InstrumentRef, "admin" | "id" | "decimals">,
  amount: number,
): RampOrder | null {
  if (!(amount > 0)) return null;
  return (
    (orders ?? []).find(
      (o) =>
        o.direction === "offramp" &&
        o.status === "awaiting_withdrawal" &&
        sameInstrument(o.instrument, instrument) &&
        ledgerAmountEquals(amount, o.tokenAmount, instrument.decimals),
    ) ?? null
  );
}

/** Where a cash-out pays, in a few words: `card Visa •••• 4242` / `bank account <bank> <masked IBAN>`. */
export function cashOutDestinationWords(order: Pick<RampOrder, "destination" | "rail">): string {
  const d = order.destination;
  if (d?.kind === "card") return `card ${cardLabel({ brand: d.brand, last4: d.last4 })}`;
  if (d?.kind === "bank") return `bank account ${bankAccountLabel(d)}`;
  return order.rail === "bank" ? "bank account" : "card";
}

/** The warning before a withdrawal that an open cash-out would consume (F7). */
export function cashOutMatchSentence(order: Pick<RampOrder, "destination" | "rail" | "tokenAmount" | "instrument">): string {
  return `This amount matches your open cash-out of ${formatMoney(order.tokenAmount, order.instrument)}: the withdrawal is used for that cash-out and the money goes to your ${cashOutDestinationWords(order)}, not to your ${WALLET_DISPLAY_NAME} wallet. Cancel the cash-out first to withdraw to the wallet.`;
}

/** Whether `amount` (a decimal string) is above what may leave now; false when either side is unreadable. */
export function withdrawExceedsExposure(x: WithdrawExposure, amount: string): boolean {
  return compareDecimal(amount, x.withdrawable) === 1;
}

/** A quote's own verdict (`withinLimits: false`) as a sentence. */
export function quoteLimitSentence(quote: RampQuote, unit: string): string | null {
  if (quote.withinLimits) return null;
  const l = quote.limit;
  const kind = l?.name === "card_cashout" ? "card" : l?.name === "exposure" ? "bank" : l?.name;
  if (
    l &&
    (kind === "min" || kind === "max" || kind === "daily" || kind === "monthly" || kind === "card" || kind === "bank")
  ) {
    const bound = kind === "min" ? l.min : kind === "max" ? l.max : l.available;
    if (bound) return limitProblemSentence({ kind, bound }, unit);
  }
  return "This amount is above what this order can take right now. Try a smaller amount.";
}

function detailsOf(e: BackendError): Record<string, unknown> {
  return e.details && typeof e.details === "object" ? (e.details as Record<string, unknown>) : {};
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

const RAMP_SENTENCES: ErrorSentences = {
  kyc_required: "Verify your identity before buying or cashing out.",
  insufficient_balance: "Your in-app balance is below this amount.",
  no_in_app_wallet: "You have no in-app balance in this token yet.",
  not_found: "This order does not exist, or it belongs to another account.",
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** "Russian (Cyrillic) or Latin, as in your passport": the name forms an error lists, in words. */
function nameFormsPhrase(forms: unknown): string | null {
  const labels = (Array.isArray(forms) ? forms : [])
    .map((f) => RAMP_NAME_FORMS.find((n) => n.form === f)?.label)
    .filter((l): l is string => !!l);
  if (labels.length === 0) return null;
  return labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}`;
}

/** `ramp_rail_unavailable`: why this destination cannot take a payout now (a bank account not usable yet, a blocked bank). */
function railSentence(d: Record<string, unknown>): string | null {
  switch (str(d.reason)) {
    case "bank_account_cooling_off": {
      const from = str(d.usableFrom);
      return from
        ? `This bank account can receive payouts from ${formatDateTimeUTC(from)}.`
        : "This bank account cannot receive payouts yet: a new account waits a short period first.";
    }
    case "bank_account_pending_proof":
      return "This bank account is not confirmed as yours yet. Paying once by ERIP from it confirms it; otherwise our team checks it.";
    case "bank_account_blocked":
      return "This bank account cannot receive payouts at the moment. Use another account in your name.";
    case "bank_blocked":
      return "Payouts to this bank are not available. Use an account at another bank.";
  }
  if (d.rail === "bank") return "Cash-outs to a bank account are not available right now.";
  if (d.rail === "card") return "Cash-outs to a card are not available right now.";
  return null;
}

/**
 * One sentence for whatever a ramp call threw; limits, caps and exposure name their figure.
 * `overrides` words a code for the screen that called (removing a card is not an order).
 */
export function rampErrorMessage(e: unknown, overrides?: ErrorSentences): string {
  if (e instanceof BackendError) {
    const own = overrides?.[e.code as keyof ErrorSentences];
    if (own) return own;
    const d = detailsOf(e);
    if (e.code === "ramp_limit_exceeded") {
      const limit = str(d.limit);
      const available = str(d.available);
      if (limit === "bank_first_payout") {
        const max = str(d.max);
        return `Until a first payout to this bank account has arrived, it can take ${
          max ? `at most ${formatFixed(max, 2)}` : "only a limited amount"
        } in total${available ? ` (${formatFixed(available, 2)} left)` : ""}. Send less, or use another account.`;
      }
      const which = limit === "daily" || limit === "monthly" ? `${limit} ` : "";
      return `This is above what is left of your ${which}limit${available ? ` (${formatFixed(available, 2)} left)` : ""}.`;
    }
    if (e.code === "validation_failed") {
      if (str(d.min) && str(d.max))
        return `Enter an amount between ${formatFixed(str(d.min), 2)} and ${formatFixed(str(d.max), 2)}.`;
      if (Array.isArray(d.nameForms)) {
        const forms = nameFormsPhrase(d.nameForms);
        return forms
          ? `Your verified name is not on file in that spelling. Choose ${forms}.`
          : "Your verified name is not on file in that spelling. Complete the identity verification again.";
      }
      if (str(d.termsVersion))
        return "The terms were updated while you were reading them. Read the new version and accept it again.";
    }
    if (e.code === "ramp_exposure" && str(d.withdrawableToBank))
      return `Up to ${formatFixed(str(d.withdrawableToBank), 2)} can go to a bank account now. ${RAMP_EXPOSURE_SENTENCE}`;
    if (e.code === "ramp_card_cashout_limit" && str(d.available))
      return `Up to ${formatFixed(str(d.available), 2)} can go back to this card. Send the rest to a bank account.`;
    if (e.code === "ramp_rail_unavailable") {
      const sentence = railSentence(d);
      if (sentence) return sentence;
    }
    if (e.code === "ramp_unavailable" && d.reason === "method_unavailable")
      return "This payment method is not available right now. Choose another one.";
    if (e.code === "bank_account_limit") {
      const max = num(d.max);
      const perDay = num(d.perDay);
      if (max !== null) return `You can keep at most ${max} bank accounts. Remove one first.`;
      if (perDay !== null) return `You can add at most ${perDay} bank accounts a day. Try again tomorrow.`;
    }
    if (e.code === "ramp_not_eligible") {
      const reasons = Array.isArray(d.reasons) ? d.reasons.filter((r): r is string => typeof r === "string") : [];
      return reasons.length > 0 ? rampReasonSentence(reasons[0]) : RAMP_NEUTRAL_SENTENCE;
    }
  }
  return backendErrorMessage(e, RAMP_SENTENCES);
}

/** The terms changed under the consent form (`400 validation_failed {termsVersion}`): reload and accept the new version. */
export function isStaleTermsError(e: unknown): boolean {
  return isBackendError(e, "validation_failed") && !!str(detailsOf(e).termsVersion);
}

/** The open order a `409 ramp_order_open` points at, to link it instead of a dead end. */
export function openOrderIdOf(e: unknown): string | null {
  return isBackendError(e, "ramp_order_open") ? str(detailsOf(e).orderId) : null;
}

// ---------------------------------------------------------------------------
// Calls (§12.1)
// ---------------------------------------------------------------------------

export { newIdempotencyKey } from "@/lib/rampLogic";

const RAMP = "/api/v1/ramp";
const path = (...parts: string[]) => `${RAMP}/${parts.map(encodeURIComponent).join("/")}`;

function unwrapOrder(res: { order?: RampOrder } | null | undefined): RampOrder {
  if (!res?.order) throw new BackendError(200, "invalid_response", "The accounts service returned no order.");
  return res.order;
}

const isStr = (v: unknown): v is string => typeof v === "string";
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const money = (v: unknown): Money => (isStr(v) && v ? v : "0");

function eligibilityOf(v: unknown): RampEligibility {
  const o = Array.isArray(v) ? {} : obj(v);
  return { allowed: o.allowed === true, reasons: Array.isArray(o.reasons) ? o.reasons.filter(isStr) : [] };
}

function limitsOf(v: unknown): RampLimits {
  const o = obj(v);
  return {
    min: money(o.min),
    max: money(o.max),
    dailyMax: money(o.dailyMax),
    monthlyMax: money(o.monthlyMax),
    dailyRemaining: money(o.dailyRemaining),
    monthlyRemaining: money(o.monthlyRemaining),
  };
}

/**
 * `GET /ramp` with every field the screens read made present. The app has no error boundary, so
 * a partial or broken answer must degrade (no buy / cash-out controls, limits at zero,
 * eligibility closed) instead of blanking /portfolio. Missing figures fail closed; the operator's
 * halt reason is never kept (it is internal, and the banner is fixed text).
 */
export function normalizeOverview(raw: unknown): RampOverview {
  const o = obj(raw);
  const fiat = obj(o.fiat);
  const consent = obj(o.consent);
  const paused = obj(o.paused);
  const limits = obj(o.limits);
  const eligibility = obj(o.eligibility);
  const exposure = obj(o.exposure);
  const operator = o.operator && typeof o.operator === "object" ? (o.operator as RampOverview["operator"]) : null;
  return {
    enabled: o.enabled === true,
    paused: { orders: paused.orders === true, reason: null },
    provider: isStr(o.provider) ? o.provider : null,
    operator,
    consent: {
      required: consent.required === true,
      termsVersion: isStr(consent.termsVersion) ? consent.termsVersion : "",
      termsUrl: isStr(consent.termsUrl) ? consent.termsUrl : "",
    },
    instrument: o.instrument && typeof o.instrument === "object" ? (o.instrument as RampInstrument) : null,
    fiat: {
      currency: isStr(fiat.currency) ? fiat.currency : "BYN",
      decimals: typeof fiat.decimals === "number" ? fiat.decimals : 2,
    },
    methods: Array.isArray(o.methods)
      ? (o.methods as RampOverview["methods"]).filter((m) => m && (m.method === "card" || m.method === "erip"))
      : [],
    rails: Array.isArray(o.rails)
      ? (o.rails as RampOverview["rails"])
          .filter((r) => r && (r.rail === "card" || r.rail === "bank"))
          .map((r) => ({ ...r, eta: { businessDays: Number(obj(r.eta).businessDays) || 0 } }))
      : [],
    limits: { onramp: limitsOf(limits.onramp), offramp: limitsOf(limits.offramp) },
    exposure: { amount: money(exposure.amount), withdrawableToBank: money(exposure.withdrawableToBank) },
    eligibility: { onramp: eligibilityOf(eligibility.onramp), offramp: eligibilityOf(eligibility.offramp) },
    openOrders: Array.isArray(o.openOrders) ? (o.openOrders as RampOrder[]) : [],
  };
}

export async function fetchRampOverview(): Promise<RampOverview> {
  return normalizeOverview(await backendFetch<unknown>(RAMP));
}

export function submitRampConsent(body: ConsentBody): Promise<RampConsentResult> {
  return backendFetch<RampConsentResult>(`${RAMP}/consent`, { method: "POST", body });
}

export type RampDestinationInput = { kind: "card"; paymentMethodId: string } | { kind: "bank"; bankAccountId: string };

export function quoteRamp(
  args: { direction: RampDirection; amount: string; method?: RampMethod; destination?: RampDestinationInput },
  signal?: AbortSignal,
): Promise<RampQuote> {
  return backendFetch<RampQuote>(`${RAMP}/quote`, { method: "POST", body: args, signal });
}

export async function fetchRampOrder(id: string): Promise<RampOrder> {
  return unwrapOrder(await backendFetch<{ order: RampOrder }>(path("orders", id)));
}

/** `{key: [...]}` of a list route; anything else is `invalid_response` (the screen shows it could not load). */
function listOf<T>(res: unknown, key: string, what: string): T[] {
  const list = obj(res)[key];
  if (!Array.isArray(list))
    throw new BackendError(200, "invalid_response", `The accounts service returned no ${what}.`);
  return list as T[];
}

/** `GET /ramp/orders?cursor&limit` → `{orders, nextCursor}`, newest first (limit 1–100). */
export async function fetchRampOrders(args: { cursor?: string | null; limit?: number } = {}): Promise<{
  orders: RampOrder[];
  nextCursor: string | null;
}> {
  const q = new URLSearchParams({ limit: String(args.limit ?? 20) });
  if (args.cursor) q.set("cursor", args.cursor);
  const res = await backendFetch<unknown>(`${RAMP}/orders?${q.toString()}`);
  const nextCursor = obj(res).nextCursor;
  return {
    orders: listOf<RampOrder>(res, "orders", "orders"),
    nextCursor: isStr(nextCursor) && nextCursor ? nextCursor : null,
  };
}

/** Saved cards (`{cards}`); a card without a cash-out figure takes no cash-outs (fail closed). */
export async function fetchRampCards(): Promise<RampCard[]> {
  const cards = listOf<RampCard>(await backendFetch<unknown>(`${RAMP}/payment-methods`), "cards", "cards");
  return cards.map((c) => {
    const cashout = obj(c.cashout);
    const mode = cashout.mode === "refund" || cashout.mode === "oct" ? cashout.mode : "none";
    return { ...c, cashout: { mode, available: money(cashout.available) } };
  });
}

/** `DELETE /ramp/payment-methods/:id` → 204; `409 ramp_order_state` while a cash-out to it is in progress. */
export async function removeRampCard(id: string): Promise<void> {
  await backendFetch<unknown>(path("payment-methods", id), { method: "DELETE" });
}

/** `GET /ramp/bank-accounts` → `{accounts}` (removed ones are left out). */
export async function fetchBankAccounts(): Promise<RampBankAccount[]> {
  return listOf<RampBankAccount>(await backendFetch<unknown>(`${RAMP}/bank-accounts`), "accounts", "bank accounts");
}

function unwrapAccount(res: { account?: RampBankAccount } | null | undefined): RampBankAccount {
  if (!res?.account) throw new BackendError(200, "invalid_response", "The accounts service returned no account.");
  return res.account;
}

export async function addBankAccount(args: { iban: string; nameForm: RampNameForm }): Promise<RampBankAccount> {
  return unwrapAccount(
    await backendFetch<{ account?: RampBankAccount }>(`${RAMP}/bank-accounts`, { method: "POST", body: args }),
  );
}

/** `DELETE /ramp/bank-accounts/:id` → `{account}` (status `removed`); `409 bank_account_in_use` while a payout to it is in progress. */
export async function removeBankAccount(id: string): Promise<RampBankAccount> {
  return unwrapAccount(
    await backendFetch<{ account?: RampBankAccount }>(path("bank-accounts", id), { method: "DELETE" }),
  );
}

export async function cancelRampOrder(id: string): Promise<RampOrder> {
  return unwrapOrder(await backendFetch(path("orders", id, "cancel"), { method: "POST", body: {} }));
}

/**
 * `POST /ramp/orders/:id/attach` (F6): the order, and whether the signed withdrawal matched it but
 * is not bound yet (`bindPending`: it stays this order's signature, is attached again later and is
 * never signed twice) and why (`bindReason`: `settlement_in_progress`, `in_flight`, the payee's
 * payout status such as `blocked_kyc` or `processing`, or `not_bound`; null once bound).
 */
export interface RampAttachResult {
  order: RampOrder;
  bindPending: boolean;
  bindReason: string | null;
}

/** Hand the backend the PendingPayout the person's Withdraw created (it checks payee, instrument and exact amount). */
export async function attachWithdrawal(orderId: string, pendingPayoutCid: string): Promise<RampAttachResult> {
  const res = obj(await backendFetch<unknown>(path("orders", orderId, "attach"), { method: "POST", body: { pendingPayoutCid } }));
  // The answer says whether it is bound; an answer that does not is no answer (the page attaches again).
  if (typeof res.bindPending !== "boolean")
    throw new BackendError(200, "invalid_response", "The accounts service did not say whether the withdrawal is bound.");
  return {
    order: unwrapOrder(res as { order?: RampOrder }),
    bindPending: res.bindPending,
    bindReason: res.bindPending && isStr(res.bindReason) && res.bindReason ? res.bindReason : null,
  };
}

/** Open a purchase; `order.next` says where the payment happens (hosted card page or ERIP details). */
export async function startOnramp(args: {
  amount: string;
  method: RampMethod;
  expectedTokenAmount?: string;
  idempotencyKey: string;
}): Promise<RampOrder> {
  const body = {
    amount: args.amount,
    method: args.method,
    ...(args.expectedTokenAmount ? { expectedTokenAmount: args.expectedTokenAmount } : {}),
  };
  return unwrapOrder(
    await backendFetch(`${RAMP}/onramp`, { method: "POST", body, headers: { "idempotency-key": args.idempotencyKey } }),
  );
}

/** Open a cash-out (step 1 of 2): nothing moves until the Withdraw is signed on the order page. */
export async function startOfframp(args: {
  amount: string;
  destination: RampDestinationInput;
  expectedFiatAmount?: string;
  idempotencyKey: string;
}): Promise<RampOrder> {
  const body = {
    amount: args.amount,
    destination: args.destination,
    ...(args.expectedFiatAmount ? { expectedFiatAmount: args.expectedFiatAmount } : {}),
  };
  return unwrapOrder(
    await backendFetch(`${RAMP}/offramp`, {
      method: "POST",
      body,
      headers: { "idempotency-key": args.idempotencyKey },
    }),
  );
}

/**
 * The mock acquirer's test pages exist only where a mock acquirer can (the backend refuses it on
 * mainnet); each page also checks that the backend really runs it before offering anything.
 */
export const RAMP_MOCK_PAGES = APP_NETWORK.trim().toLowerCase() !== "mainnet";

/** The mock page for an order: a card checkout carries its payment id, an ERIP order its own id. */
export function mockCheckoutHref(orderId: string, opts: { paymentId?: string; method?: RampMethod } = {}): string {
  const q = new URLSearchParams({ payment: opts.paymentId ?? orderId, order: orderId });
  if (opts.method === "erip") q.set("method", "erip");
  return `/wallet/ramp/mock-checkout?${q.toString()}`;
}

export type MockOutcome = "succeeded" | "declined" | "no_3ds";

/** `POST /ramp/mock/payments/:id/complete`: the mock acquirer's knobs (every one but `outcome` optional). */
export interface MockCompleteBody {
  outcome: MockOutcome;
  /** Which test card pays (card limits, cash-out to a card). */
  cardSeed?: string;
  /** ISO alpha-2 issuer country (default BY). */
  cardCountry?: string;
  /** ERIP: how the money came in. */
  channel?: "online" | "cash" | "card" | "unknown";
  payerName?: string;
  payerNameSource?: "bank" | "checkout";
  capturedAmount?: string;
  payerIban?: string;
  payerBankBic?: string;
}

/**
 * The mock acquirer's page (dev / test deployments): finish a payment the way a cardholder (or an
 * ERIP payer) would. `paymentId` may be the ORDER id: an ERIP order shows no payment id.
 */
export function completeMockPayment(paymentId: string, body: MockCompleteBody): Promise<{ delivered: true }> {
  return backendFetch<{ delivered: true }>(path("mock", "payments", paymentId, "complete"), { method: "POST", body });
}

// ---------------------------------------------------------------------------
// Cash-out step 2: sign the Withdraw, then attach it
// ---------------------------------------------------------------------------

/** `UserWallet.Withdraw` for exactly `amount`: the order's own decimal string, never a float. */
export function rampWithdrawParams(party: string, walletContractId: string, amount: string): PrepareExecuteParams {
  const exact = damlDecimalString(amount);
  // The shared builder owns the template, choice and clock; only its float amount is replaced.
  const params = buildWalletWithdrawParams(party, walletContractId, 0);
  const [command] = params.commands as { exercise: { choiceArgument: Record<string, unknown> } }[];
  command.exercise.choiceArgument = { ...command.exercise.choiceArgument, amount: exact };
  return params;
}

/** The wallet refused, or the click never reached it: nothing left the balance and signing again is safe. */
export class RampNotSignedError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause ?? "The withdrawal was not signed."));
    this.name = "RampNotSignedError";
    this.cause = cause;
  }
}

/** What the order page reads from the participant BEFORE offering "Sign in wallet" (never inside the click). */
export interface WithdrawalContext {
  /** The party's PendingPayout ids now: a fresh one after signing is the one to attach. */
  payoutCids: Set<string>;
  /** A `withdraw` PendingPayout of exactly this order's amount that is not known to belong elsewhere: already signed. */
  signed: PendingPayoutRecord | null;
  /** The party's current UserWallet id for the order's instrument (it changes with every trade). */
  walletContractId: string | null;
}

/**
 * The withdrawals the backend's payouts list binds to another cash-out than `orderId`: only that
 * order may consume one, and a failed order keeps its binding, so attaching it here would wait on
 * an operator until this order expires (review R3-03). Unreadable: none known.
 */
function boundElsewhere(orderId: string): Promise<Set<string>> {
  return fetchBackendPayouts()
    .then((rows) => new Set(rows.filter((r) => !!r.offrampOrderId && r.offrampOrderId !== orderId).map((r) => r.pendingPayoutCid)))
    .catch(() => new Set<string>());
}

export async function readWithdrawalContext(
  party: string,
  order: Pick<RampOrder, "id" | "instrument" | "withdraw">,
  exclude: ReadonlySet<string> = new Set(),
): Promise<WithdrawalContext> {
  const [payouts, wallet] = await Promise.all([
    fetchPendingPayouts(party),
    fetchUserWallet(party, order.instrument).catch(() => null),
  ]);
  const amount = order.withdraw?.amount ?? null;
  const matching =
    amount === null
      ? []
      : payouts.filter(
          (p) =>
            p.user === party &&
            p.reason === "withdraw" &&
            sameInstrument(p.instrument, order.instrument) &&
            ledgerAmountEquals(p.amount, amount, order.instrument.decimals) &&
            !exclude.has(p.contractId),
        );
  // Asked only when a withdrawal of the amount is there: the backend names the cash-out it is bound to.
  const elsewhere = matching.length > 0 ? await boundElsewhere(order.id) : new Set<string>();
  const signed = matching.find((p) => !elsewhere.has(p.contractId)) ?? null;
  return {
    payoutCids: new Set(payouts.filter((p) => p.user === party).map((p) => p.contractId)),
    signed,
    walletContractId: wallet && wallet.owner === party ? wallet.contractId : null,
  };
}

/** The wallet popup waits at most this long for the person (Cantor8WalletContext signAndExecute's bound). */
export const WALLET_POPUP_MAX_WAIT_MS = 5 * 60_000;
/** How long after a signature on this device the page waits for the network before offering "Sign" again. */
export const SIGNED_GRACE_MS = 120_000;

/**
 * The last moment a cash-out opens the wallet popup (review F5). The backend expires an unsigned
 * order at `expiresAt` without looking for a late signature, which then leaves as a plain
 * withdrawal to the wallet. The popup may wait 5 minutes, so the page stops offering it that long
 * before the deadline — at most a third of the order's window, so a short window still signs.
 */
export function rampSignBy(order: Partial<Pick<RampOrder, "createdAt" | "expiresAt">>): number | null {
  const end = Date.parse(order.expiresAt ?? "");
  if (!Number.isFinite(end)) return null;
  const start = Date.parse(order.createdAt ?? "");
  const window = Number.isFinite(start) && end > start ? end - start : 3 * WALLET_POPUP_MAX_WAIT_MS;
  return end - Math.min(WALLET_POPUP_MAX_WAIT_MS, Math.floor(window / 3));
}

const signedKey = (orderId: string) => `truthoracle:ramp-signed:${orderId}`;

/** When this tab saw the cash-out's withdrawal signed: sessionStorage, null when unknown or storage is off. */
export function readRampSignedAt(orderId: string): number | null {
  try {
    const v = Number(globalThis.sessionStorage?.getItem(signedKey(orderId)));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

export function rememberRampSigned(orderId: string, at: number): void {
  try {
    globalThis.sessionStorage?.setItem(signedKey(orderId), String(at));
  } catch {
    // Private mode / storage off: the page's own state still covers this page's life.
  }
}

/**
 * Whether the app offers "Cancel" on an order (F5): only what waits on the person, and never a
 * cash-out whose withdrawal is being signed or linked, or was signed here moments ago — that
 * signature is on its way, and cancelling the order would turn it into a plain withdrawal.
 */
export function rampCancelOffered(
  order: Pick<RampOrder, "direction" | "status">,
  opts: { busy?: boolean; signedAt?: number | null; now: number },
): boolean {
  if (order.status !== "awaiting_payment" && order.status !== "awaiting_withdrawal") return false;
  if (order.direction !== "offramp") return true;
  if (opts.busy) return false;
  return opts.signedAt == null || opts.now - opts.signedAt >= SIGNED_GRACE_MS;
}

/**
 * What an attach answer means for the signed withdrawal (F6). Only 409 `ramp_order_state` says it
 * is not this order's (another payee, amount or instrument, or another withdrawal bound). A 200
 * with `bindPending` says it matched but is not bound yet (its settlement is held or in flight): it
 * stays this order's signature and is attached again later — never signed twice.
 */
export type AttachOutcome = "bound" | "pending" | "not_this_order" | "retry";

export function attachOutcome(answer: Pick<RampAttachResult, "bindPending"> | { error: unknown }): AttachOutcome {
  if ("bindPending" in answer) return answer.bindPending ? "pending" : "bound";
  return isBackendError(answer.error, "ramp_order_state") ? "not_this_order" : "retry";
}

/**
 * What the cash-out page says while a matched withdrawal waits to be bound (F6 `bindReason`), in
 * the payee's words: a settlement already running, a hold the payee sees anyway (identity
 * verification, the card dispute window, an operator's look), and one sentence for every other
 * hold — `processing` covers compliance and gate holds alike (C11: no tipping-off).
 */
export function attachWaitSentence(bindReason: string | null): string {
  const matched = "Your withdrawal is signed and matched to this cash-out";
  switch (bindReason) {
    case "settlement_in_progress":
    case "in_flight":
      return `${matched}; its settlement is already running. This page updates by itself.`;
    case "blocked_kyc":
      return `${matched}. It continues once your identity is verified; this page updates by itself.`;
    case "blocked_ramp_exposure":
      return `${matched}. Part of this balance was bought by card and can leave only after the card dispute window; the cash-out continues by itself once it can.`;
    case "blocked_unknown_reason":
    case "failed":
      // Nothing here knows that support was told (R3-03): the page says what the payee can do.
      return `${matched}, but it needs an operator to look at it. Contact support if it does not move; this page updates by itself.`;
    default:
      return `${matched} and is being processed. This page updates by itself.`;
  }
}

/** The wait before asking the backend again to attach a matched withdrawal: 10 s, 20 s, 40 s, then every 60 s. */
export function attachRetryDelayMs(tries: number): number {
  return Math.min(60_000, 10_000 * 2 ** Math.max(0, tries - 1));
}

export interface SignWithdrawalArgs {
  order: Pick<RampOrder, "id" | "status" | "instrument" | "withdraw"> & Partial<Pick<RampOrder, "createdAt" | "expiresAt">>;
  /** The connected party; it must be the account's primary party, which owns the order's UserWallet. */
  userParty: string;
  primaryParty: string | null;
  /** From `readWithdrawalContext`, read before the click. */
  context: Pick<WithdrawalContext, "payoutCids" | "walletContractId"> | null;
  signAndSubmitTransaction: (p: PrepareExecuteParams) => Promise<{ hash: string }>;
  /** Called the moment the wallet signed, before the PendingPayout is looked for (the page remembers it). */
  onSigned?: () => void;
  /** How long to look for the new PendingPayout after the signature (15 s). */
  waitMs?: number;
}

export type SignWithdrawalResult =
  | ({ attached: true } & RampAttachResult)
  /** `unanswered`: the wallet did not answer in time, and its popup may still sign (R3-04). */
  | { attached: false; order: null; error?: unknown; unanswered?: true };

/**
 * The wallet's own wait ran out (Cantor8WalletContext gives the popup 5 minutes): that settles
 * nothing, since the popup may still be open and approving it executes the Withdraw (R3-04).
 */
export function isWalletTimeout(e: unknown): boolean {
  return e instanceof Error && /timed out/i.test(e.message);
}

/** The cash-out page's sentence while such a wallet may still sign: never "nothing left your balance". */
export const RAMP_WALLET_UNANSWERED_SENTENCE =
  "Your wallet did not answer in time, and its window may still be open. Approve or close it there before signing again: an approved withdrawal is linked to this cash-out by itself.";

/**
 * Sign the order's Withdraw and attach it. The wallet call is the FIRST await: everything before
 * it is synchronous, so the popup opens inside the click's user activation
 * (wallets/cantor8/popupGesture.ts rule 2). Before the signature every failure throws
 * `RampNotSignedError`; after it nothing throws — the withdrawal is on its way and the backend
 * binds it by itself, so the caller must never offer a second signature on an error from here. A
 * wallet that did not answer in time is neither: `attached: false, unanswered: true`.
 */
export async function signRampWithdrawal(args: SignWithdrawalArgs): Promise<SignWithdrawalResult> {
  const { order } = args;
  let params: PrepareExecuteParams;
  try {
    if (order.status !== "awaiting_withdrawal" || !order.withdraw)
      throw new Error("This cash-out is no longer waiting for a signature.");
    const signBy = rampSignBy(order);
    if (signBy !== null && Date.now() > signBy)
      throw new Error(
        "This cash-out is too close to its deadline to sign safely: a signature arriving after it would not reach it. Cancel it and start a new one.",
      );
    if (!args.primaryParty || args.userParty !== args.primaryParty)
      throw new Error(`Connect your account's primary ${WALLET_DISPLAY_NAME} wallet to sign the cash-out.`);
    params = rampWithdrawParams(
      args.userParty,
      args.context?.walletContractId || order.withdraw.walletContractId,
      order.withdraw.amount,
    );
  } catch (e) {
    throw new RampNotSignedError(e);
  }
  try {
    await args.signAndSubmitTransaction(params);
  } catch (e) {
    if (isWalletTimeout(e)) return { attached: false, order: null, error: e, unanswered: true };
    throw new RampNotSignedError(e);
  }
  try {
    args.onSigned?.();
    const fresh = await waitForFreshWithdrawPayout(
      args.userParty,
      order.instrument,
      new Set(args.context?.payoutCids ?? []),
      {
        amount: order.withdraw.amount,
        timeoutMs: args.waitMs,
      },
    );
    if (!fresh) return { attached: false, order: null };
    return { attached: true, ...(await attachWithdrawal(order.id, fresh.contractId)) };
  } catch (error) {
    return { attached: false, order: null, error };
  }
}
