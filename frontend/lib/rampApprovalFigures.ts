/**
 * What an approver decides on (review F2 / F8): the figures of a four-eyes request, read from the
 * approval the backend stored — its params, and the precondition snapshot taken at request time,
 * which must equal a fresh read when it executes (so a figure derived from it is the one that
 * moves). A ramp order action's snapshot carries the order's figures (amounts, user, wallet,
 * destination); the order read is the context and the check: a figure it disagrees with, or a
 * snapshot without them, blocks Approve. A statement confirm shows each booking with the line's
 * figures; a market resolution, the market, the outcome and its evidence, and the windows. The
 * requester's reason is never among the figures; it is their claim, shown apart.
 */
import type { Money } from "@/auth/types";
import { CHOICE_LABEL, MARKET_RESOLVE_ACTION, marketResolveView, utcSeconds, type MarketResolveView } from "@/lib/marketResolution";
import { RAMP_ACTIONS, exactMoney, fiatLabel, rampActionFigure } from "@/lib/rampAdmin";
import { fromUnits, toUnits } from "@/lib/rampLogic";
import type {
  ApiAdminRampOrder,
  ApiApproval,
  ApiBankLine,
  ApiRampOrderFigures,
  ApiRampSnapshotDestination,
  BankMatchKind,
  RampOrderAction,
} from "@/lib/rampAdminTypes";

export interface ApprovalFigure {
  label: string;
  value: string;
  /** The amount the approval moves: shown first and bold. */
  strong?: boolean;
}

/** One approval's money, for an approve-many total: a wire decimal and its unit. */
export interface ApprovalAmount {
  amount: Money;
  unit: string;
}

type Snapshot = Record<string, unknown>;
const ORDER_PREFIX = "ramp.order.";
const STATEMENT_CONFIRM_ACTION = "ramp.statement.confirm";
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const wire = (v: unknown): Money | null => (typeof v === "string" && toUnits(v) !== null ? v : null);

/** `ramp.order.refund` → `refund`; null for every other action. */
export function orderActionOf(a: Pick<ApiApproval, "action">): RampOrderAction | null {
  if (!a.action.startsWith(ORDER_PREFIX)) return null;
  const action = a.action.slice(ORDER_PREFIX.length);
  return action in RAMP_ACTIONS ? (action as RampOrderAction) : null;
}

/** The order to read for an approval's figures (a ramp order action), else null. */
export function approvalOrderId(a: Pick<ApiApproval, "action" | "subjectId">): string | null {
  return orderActionOf(a) ? a.subjectId : null;
}

/** The order as the approval would execute on it: captured / refunded as the precondition saw them. */
function asRequested(order: ApiAdminRampOrder, pre: Snapshot): ApiAdminRampOrder {
  return {
    ...order,
    capturedAmount: "capturedAmount" in pre ? wire(pre.capturedAmount) : order.capturedAmount,
    refundedAmount: wire(pre.refundedAmount) ?? order.refundedAmount,
  };
}

function destinationWords(order: ApiAdminRampOrder): string | null {
  const d = order.destination;
  if (d?.kind === "card") return `card ${d.brand ?? "Card"} •••• ${d.last4 ?? "????"}`;
  if (d?.kind === "bank") return `bank account ${d.bankName ?? ""} ${d.ibanMasked}`.replace("  ", " ");
  if (order.card) return `card ${order.card.brand ?? "Card"} •••• ${order.card.last4 ?? "????"}`;
  return null;
}

const isObj = (v: unknown): v is Snapshot => v !== null && typeof v === "object" && !Array.isArray(v);
const shortId = (v: string) => (v.length > 16 ? `${v.slice(0, 16)}…` : v);

function snapshotDestination(v: unknown): ApiRampSnapshotDestination | null | undefined {
  if (v === null) return null;
  if (!isObj(v)) return undefined;
  const pm = text(v.paymentMethodId);
  const bank = text(v.bankAccountId);
  if (v.kind === "card" && pm) return { kind: "card", paymentMethodId: pm, brand: text(v.brand), last4: text(v.last4) };
  if (v.kind === "bank" && bank) return { kind: "bank", bankAccountId: bank };
  return undefined;
}

/**
 * The figures a `ramp.order.*` precondition carries (F2 / F8, backend RampOrderFigures), or null
 * when any is missing: a request stored before the backend recorded them, which cannot execute
 * (the backend compares the whole snapshot with a fresh one).
 */
export function orderSnapshotFigures(pre: Snapshot | null | undefined): ApiRampOrderFigures | null {
  const p: Snapshot = pre ?? {};
  const direction = p.direction === "onramp" || p.direction === "offramp" ? p.direction : null;
  const userId = text(p.userId);
  const partyId = text(p.partyId);
  const fiatAmount = wire(p.fiatAmount);
  const fiatCurrency = text(p.fiatCurrency);
  const tokenAmount = wire(p.tokenAmount);
  const admin = isObj(p.instrument) ? text(p.instrument.admin) : null;
  const id = isObj(p.instrument) ? text(p.instrument.id) : null;
  const destination = "destination" in p ? snapshotDestination(p.destination) : undefined;
  if (!direction || !userId || !partyId || !fiatAmount || !fiatCurrency || !tokenAmount || !admin || !id || destination === undefined)
    return null;
  return { direction, userId, partyId, fiatAmount, fiatCurrency, tokenAmount, instrument: { admin, id }, destination };
}

/** The destination the backend snapshots for this order (orderFigures): a cash-out's rail; an on-ramp's bank refund account, else its card. */
function orderDestination(order: ApiAdminRampOrder): { kind: "card" | "bank"; id: string } | null {
  const card = order.paymentMethodId ? { kind: "card" as const, id: order.paymentMethodId } : null;
  const bank = order.bankAccountId ? { kind: "bank" as const, id: order.bankAccountId } : null;
  if (order.direction === "offramp") return order.rail === "bank" ? bank : card;
  return bank ?? card;
}

const destinationRef = (d: { kind: "card" | "bank"; id: string } | null) => (d ? `${d.kind === "card" ? "card" : "bank account"} ${shortId(d.id)}` : "none");
const sameAmount = (x: Money, y: Money) => toUnits(x) !== null && toUnits(x) === toUnits(y);

/** Where the request's figures and the order read differ, each as `<figure> <requested> requested, <now> on the order`. */
export function orderFigureDifferences(s: ApiRampOrderFigures, order: ApiAdminRampOrder): string[] {
  const out: string[] = [];
  if (s.direction !== order.direction) out.push(`direction ${s.direction} requested, ${order.direction} on the order`);
  if (s.userId !== order.userId) out.push(`user ${s.userId} requested, ${order.userId} on the order`);
  if (s.partyId !== order.partyId) out.push(`wallet ${shortId(s.partyId)} requested, ${shortId(order.partyId)} on the order`);
  if (s.fiatCurrency !== order.fiatCurrency || !sameAmount(s.fiatAmount, order.fiatAmount))
    out.push(`fiat ${fiatLabel(s.fiatAmount, s.fiatCurrency)} requested, ${fiatLabel(order.fiatAmount, order.fiatCurrency)} on the order`);
  if (s.instrument.admin !== order.instrument.admin || s.instrument.id !== order.instrument.id)
    out.push(`instrument ${s.instrument.id} of ${shortId(s.instrument.admin)} requested, ${order.instrument.id} of ${shortId(order.instrument.admin)} on the order`);
  if (!sameAmount(s.tokenAmount, order.tokenAmount))
    out.push(`tokens ${exactMoney(s.tokenAmount, 2, s.instrument.id)} requested, ${exactMoney(order.tokenAmount, 2, order.instrument.id)} on the order`);
  const want = s.destination ? { kind: s.destination.kind, id: s.destination.kind === "card" ? s.destination.paymentMethodId : s.destination.bankAccountId } : null;
  const have = orderDestination(order);
  if (want?.kind !== have?.kind || want?.id !== have?.id) out.push(`destination ${destinationRef(want)} requested, ${destinationRef(have)} on the order`);
  return out;
}

/**
 * Why a `ramp.order.*` request cannot be approved once its order is read (F2 / F8): its snapshot
 * lacks the figures, names another order, or disagrees with the order read. Null when they agree.
 */
export function orderApprovalProblem(a: ApiApproval, order: ApiAdminRampOrder): string | null {
  const pre: Snapshot = a.precondition ?? {};
  const s = orderSnapshotFigures(pre);
  if (!s)
    return "The request does not carry the order's figures (amounts, user, wallet, destination), so the backend would fail it as changed. Reject it and request again.";
  const snapshotId = text(pre.id);
  if (snapshotId && snapshotId !== a.subjectId)
    return `The snapshot is of order ${snapshotId.slice(0, 8)}, the request of ${a.subjectId.slice(0, 8)}. Reject it and request again.`;
  const differ = orderFigureDifferences(s, order);
  return differ.length ? `The request's figures disagree with the order: ${differ.join("; ")}. Do not approve it: reject it and open the order.` : null;
}

/** The order as the snapshot recorded it, for `rampActionFigure`; the instrument's symbol and decimals from the order read when it is the same instrument. */
function snapshotOrder(s: ApiRampOrderFigures, pre: Snapshot, order: ApiAdminRampOrder | null | undefined): Parameters<typeof rampActionFigure>[1] {
  const same = order && order.instrument.admin === s.instrument.admin && order.instrument.id === s.instrument.id;
  return {
    direction: s.direction,
    fiatAmount: s.fiatAmount,
    fiatCurrency: s.fiatCurrency,
    tokenAmount: s.tokenAmount,
    instrument: same ? order.instrument : { admin: s.instrument.admin, id: s.instrument.id, symbol: s.instrument.id, decimals: 2 },
    capturedAmount: wire(pre.capturedAmount),
    refundedAmount: wire(pre.refundedAmount) ?? "0",
    reviewStep: text(pre.reviewStep) as ApiAdminRampOrder["reviewStep"],
    details: { reviewFrom: text(pre.reviewFrom) },
  };
}

/** The snapshot's destination; a bank account gets its bank and masked IBAN from the order read when it is the same account. */
function snapshotDestinationWords(d: ApiRampSnapshotDestination | null, order: ApiAdminRampOrder | null | undefined): string {
  if (!d) return "no card or bank account";
  if (d.kind === "card") return `card ${d.brand ?? "Card"} •••• ${d.last4 ?? "????"}`;
  const od = order?.destination;
  return od?.kind === "bank" && od.bankAccountId === d.bankAccountId
    ? `bank account ${od.bankName ?? ""} ${od.ibanMasked}`.replace("  ", " ")
    : `bank account ${d.bankAccountId}`;
}

function orderFigures(a: ApiApproval, action: RampOrderAction, order: ApiAdminRampOrder | null | undefined): ApprovalFigure[] {
  const pre: Snapshot = a.precondition ?? {};
  const then = a.params?.then === "reverse" || a.params?.then === "requeue" ? a.params.then : undefined;
  const bankAccountId = text(a.params?.bankAccountId);
  const s = orderSnapshotFigures(pre);
  const currency = s?.fiatCurrency ?? order?.fiatCurrency ?? "BYN";
  const out: ApprovalFigure[] = [];
  if (s) {
    // The figures the request was made on (what executes; the backend compares them whole). The order read is context.
    const view = snapshotOrder(s, pre, order);
    out.push({ label: "Moves", value: rampActionFigure(action, view, { then, bankAccountId: bankAccountId ?? undefined }), strong: true });
    const token = exactMoney(s.tokenAmount, view.instrument.decimals, view.instrument.symbol);
    out.push({ label: "Order", value: `${s.direction === "onramp" ? "buy" : "cash-out"} · ${fiatLabel(s.fiatAmount, currency)} · ${token}` });
    out.push({ label: "User", value: `${s.userId} · ${s.partyId}` });
    const label = s.direction === "offramp" ? "Pays to" : s.destination?.kind === "bank" ? "Refunds to" : "Paid with";
    out.push({ label, value: snapshotDestinationWords(s.destination, order) });
  } else if (order) {
    out.push({ label: "Moves", value: rampActionFigure(action, asRequested(order, pre), { then, bankAccountId: bankAccountId ?? undefined }), strong: true });
    const token = exactMoney(order.tokenAmount, order.instrument.decimals, order.instrument.symbol);
    out.push({ label: "Order", value: `${order.direction === "onramp" ? "buy" : "cash-out"} · ${fiatLabel(order.fiatAmount, currency)} · ${token}` });
    out.push({ label: "User", value: `${order.userId} · ${order.partyId}` });
    const dest = destinationWords(order);
    if (dest) out.push({ label: order.direction === "onramp" ? "Paid with" : "Pays to", value: dest });
  } else {
    out.push({ label: "Moves", value: "Reading the order's figures…", strong: true });
  }
  if (order && typeof pre.version === "number" && pre.version !== order.version)
    out.push({ label: "Changed since the request", value: `v${pre.version} → v${order.version}: approving fails unless the order is back as requested` });
  if (bankAccountId) out.push({ label: "To bank account", value: bankAccountId });
  if (then) out.push({ label: "Then", value: then === "reverse" ? "reverse (re-mint, credit back)" : "re-queue for the next batch" });
  const status = text(pre.status);
  if (status) out.push({ label: "Requested at", value: `${status}${text(pre.reviewStep) ? `, review ${text(pre.reviewStep)}` : ""}` });
  if ("capturedAmount" in pre) {
    const captured = wire(pre.capturedAmount);
    out.push({ label: "Captured / refunded then", value: `${captured ? fiatLabel(captured, currency) : "—"} / ${fiatLabel(wire(pre.refundedAmount) ?? "0", currency)}` });
  }
  return out;
}

/** `capturedAmount` → `captured amount`. */
function words(key: string): string {
  return key.replace(/_/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
}

function valueText(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return /^-?\d+\.\d{10}$/.test(v) ? exactMoney(v, 2) : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v) && v.every((x) => x === null || typeof x !== "object")) return v.map(valueText).join(", ") || "none";
  const json = JSON.stringify(v);
  return json.length > 200 ? `${json.slice(0, 199)}…` : json;
}

/** What each classification books (backend ramp-bank-statements CLASSIFICATION_BOOKS, SPEC §5, §10.4). */
const CLASSIFICATION_BOOKS: Record<BankMatchKind, string> = {
  payout: "offramp.paid_bank / refund.paid_bank",
  payout_batch: "every item's offramp.paid_bank / refund.paid_bank",
  payout_return: "offramp.returned_bank (re-mint and credit back)",
  refund: "refund.paid_bank",
  refund_return: "refund.returned_bank",
  psp_settlement: "psp.settlement",
  psp_funding: "psp.funding",
  bank_fee: "bank.fee",
  operator_topup: "operator.topup",
  operator_sweep: "operator.sweep",
  suspense: "suspense.in / suspense.out",
};

/**
 * A statement confirm's bookings, one per classification. With the line the confirm's snapshot
 * fixed from the file (`classified`, F3 / F9: its first 50) it reads as the backend's description:
 * `line L-7 of 2026-10-19 (-1,500.00 BYN) as operator_sweep → operator.sweep`; without it, by the
 * line's id: `line 1a2b3c4d → payout_return (order 5e6f7a8b)`.
 */
export function classificationLines(params: Snapshot | null | undefined, precondition?: Snapshot | null): string[] {
  const list = Array.isArray(params?.classifications) ? (params.classifications as Snapshot[]) : [];
  const classified = Array.isArray(precondition?.classified) ? (precondition.classified as unknown[]).filter(isObj) : [];
  const byLine = new Map(classified.map((l) => [String(l.lineId ?? "").toLowerCase(), l]));
  return list.map((c) => {
    const kind = String(c.matchKind ?? "?");
    const l = byLine.get(String(c.lineId ?? "").toLowerCase());
    const amount = l ? wire(l.amount) : null;
    if (l && text(l.lineRef) && text(l.bookingDate) && amount) {
      const target = text(c.orderId) ? ` of order ${text(c.orderId)!.slice(0, 8)}` : text(c.batchId) ? ` of batch ${text(c.batchId)!.slice(0, 8)}` : "";
      const books = CLASSIFICATION_BOOKS[kind as BankMatchKind] ?? "?";
      return `line ${text(l.lineRef)} of ${text(l.bookingDate)!.slice(0, 10)} (${fiatLabel(amount, text(l.currency) ?? "BYN")}) as ${kind}${target} → ${books}`;
    }
    const ref = text(c.orderId) ? ` (order ${text(c.orderId)!.slice(0, 8)})` : text(c.batchId) ? ` (batch ${text(c.batchId)!.slice(0, 8)})` : "";
    return `line ${String(c.lineId ?? "?").slice(0, 8)} → ${kind}${ref}`;
  });
}

/**
 * What a `ramp.statement.confirm` decides (F3 / F9): each booking with its line's figures and what
 * it books, then the statement it confirms, from the params and the snapshot (period, lines,
 * balances, the file's hash). Decided under Bank → Statements with the approver's own copy.
 */
export function statementConfirmFigures(a: ApiApproval): ApprovalFigure[] {
  const pre: Snapshot = a.precondition ?? {};
  const lines = classificationLines(a.params, pre);
  const out: ApprovalFigure[] = [{ label: "Books", value: lines.length ? lines.join("; ") : "no unmatched line", strong: true }];
  const count = typeof pre.lineCount === "number" ? `${pre.lineCount} lines` : "? lines";
  out.push({
    label: "Statement",
    value: `${text(pre.periodFrom) ?? "?"} … ${text(pre.periodTo) ?? "?"} · ${count} · opening ${valueText(pre.opening)} · closing ${valueText(pre.closing)}`,
  });
  const sha = text(pre.fileSha256);
  if (sha) out.push({ label: "File sha-256", value: `${sha.slice(0, 16)}…` });
  const status = text(pre.status);
  if (status) out.push({ label: "Requested at", value: status });
  return out;
}

// ── market resolution (`market.resolve`, lib/marketResolution.ts) ──

const shortParty = (p: string | null) => (p ? `${p.slice(0, 16)}…` : "?");

function resolveHeadline(v: MarketResolveView, market: string): string {
  if (v.choice === "ResolveT0")
    return v.outcome === "Void"
      ? `Market ${market} is voided by the operator (T0, source ${v.sourceUri ?? "?"}): traders redeem their cost basis`
      : `Market ${market} resolves ${v.outcome ?? "?"} (T0 operator, source ${v.sourceUri ?? "?"})`;
  if (v.choice === "Resolve") {
    const outcomes = [...new Set(v.attestations.map((x) => x.outcome ?? "?"))];
    const n = `${v.attestations.length} attestation${v.attestations.length === 1 ? "" : "s"}`;
    return outcomes.length === 1
      ? `Market ${market} resolves ${outcomes[0]} from ${n}`
      : `Market ${market} from ${n} that disagree (${outcomes.join(" / ")}): the ledger refuses it`;
  }
  if (v.choice === "VoidMarket") return `Market ${market} is voided (no tier resolved it in the grace period): traders redeem their cost basis`;
  return `Market ${market}: unknown choice`;
}

/** What a `market.resolve` decides, from its params and the precondition snapshot (review F0). */
export function marketResolveFigures(a: ApiApproval): ApprovalFigure[] {
  const v = marketResolveView(a);
  const market = `#${v.marketId ?? "?"}${v.ticker ? ` (${v.ticker})` : ""}`;
  const out: ApprovalFigure[] = [{ label: "Resolves", value: resolveHeadline(v, market), strong: true }];
  out.push({ label: "Choice", value: v.choice ? `${v.choice} (${CHOICE_LABEL[v.choice]})` : "— (not in the request)" });
  out.push({ label: "Market", value: `#${v.marketId ?? "?"} · ${v.ticker ?? "— (no ticker in the snapshot)"} · ${v.question ?? "— (no question in the snapshot)"}` });
  if (v.choice === "ResolveT0") {
    out.push({ label: "Outcome", value: v.outcome ?? "— (not in the request)" });
    out.push({ label: "Source", value: v.sourceUri ?? "— (not in the request)" });
  }
  v.attestations.forEach((x, i) =>
    out.push({
      label: `Attestation ${i + 1}`,
      value: `${x.outcome ?? "?"} · ${x.sourceUri ?? "? source"} · fetched ${utcSeconds(x.fetchedAt)} · ${x.contractId.slice(0, 12)}…`,
    }),
  );
  // The backend refuses a source (T0) or an attestation's source outside a non-empty allowlist.
  if (v.choice === "ResolveT0" || v.choice === "Resolve")
    out.push({ label: "Source allowlist", value: v.sources === null ? "— (not in the snapshot)" : v.sources.join(", ") || "none: any http(s) URL" });
  const c = v.collateral;
  out.push({ label: "Collateral", value: c ? `${c.symbol ?? c.id}${c.symbol && c.symbol !== c.id ? ` (${c.id})` : ""} · registry ${shortParty(c.admin)}` : "— (not in the snapshot)" });
  out.push({ label: "Expiry", value: utcSeconds(v.expiresAt) });
  out.push({
    label: "Grace",
    value:
      v.gracePeriodSecs === null
        ? "— (not in the snapshot)"
        : `${Math.round((v.gracePeriodSecs / 3600) * 100) / 100} h: T0 ${utcSeconds(v.windows.resolveT0From)} – ${utcSeconds(v.windows.resolveT0To)}; ` +
          `attestations from ${utcSeconds(v.windows.resolveFrom)}; void from ${utcSeconds(v.windows.voidFrom)}`,
  });
  if (v.status) out.push({ label: "At request", value: `${v.status}${v.currentOutcome ? `, outcome ${v.currentOutcome}` : ""}` });
  return out;
}

/**
 * Why a `market.resolve` cannot be approved yet: a figure the approver must see is missing from
 * the request or its snapshot (Approve stays disabled, as for a ramp order whose figures are not
 * read), or the snapshot is of another market. Null when every figure is on screen.
 */
export function marketResolveProblem(a: ApiApproval): string | null {
  const v = marketResolveView(a);
  if (v.snapshotMarketId) return `The snapshot is of market #${v.snapshotMarketId}, the request of #${v.marketId}. Reject it and request again.`;
  const missing: string[] = [];
  if (!v.choice) missing.push("a known choice");
  if (!v.marketId) missing.push("the market id");
  if (!v.ticker) missing.push("the ticker");
  if (!v.question) missing.push("the question");
  if (v.choice === "ResolveT0" && !v.outcome) missing.push("the outcome");
  if (v.choice === "ResolveT0" && !v.sourceUri) missing.push("the source");
  if (v.choice === "Resolve" && v.attestations.length === 0) missing.push("the attestations");
  v.attestations.forEach((x, i) => {
    if (!x.outcome || !x.sourceUri || x.fetchedAt === null) missing.push(`attestation ${i + 1}'s outcome, source and fetch time`);
  });
  if ((v.choice === "ResolveT0" || v.choice === "Resolve") && v.sources === null) missing.push("the source allowlist");
  if (!v.collateral) missing.push("the collateral");
  if (v.expiresAt === null) missing.push("the expiry");
  if (v.gracePeriodSecs === null) missing.push("the grace period");
  return missing.length
    ? `The request does not show ${missing.join(", ")}, so it cannot be approved from the console. Reject it, or refresh once the backend records them.`
    : null;
}

/**
 * Every figure the approver decides on, most important first. A ramp order action: what it moves
 * (from the order and the precondition), the order, the user, the destination. A market
 * resolution: the choice, the market, the outcome and its evidence, the collateral and the
 * windows. Anything else: each parameter, then each field of the precondition snapshot, labelled.
 */
export function approvalFigures(a: ApiApproval, order?: ApiAdminRampOrder | null): ApprovalFigure[] {
  if (a.action === MARKET_RESOLVE_ACTION) return marketResolveFigures(a);
  if (a.action === STATEMENT_CONFIRM_ACTION) return statementConfirmFigures(a);
  const action = orderActionOf(a);
  if (action) return orderFigures(a, action, order);
  const out: ApprovalFigure[] = [];
  for (const [key, v] of Object.entries(a.params ?? {})) {
    if (key === "classifications") {
      const lines = classificationLines(a.params);
      out.push({ label: "Books", value: lines.length ? lines.join("; ") : "no unmatched line", strong: true });
    } else {
      out.push({ label: words(key), value: valueText(v), strong: /amount/i.test(key) });
    }
  }
  for (const [key, v] of Object.entries(a.precondition ?? {})) out.push({ label: `${words(key)} (at request)`, value: valueText(v), strong: /^amount$/i.test(key) });
  return out;
}

/** The money one approval moves, when the console can name it exactly (approve-many totals). */
export function approvalAmount(a: ApiApproval, order?: ApiAdminRampOrder | null): ApprovalAmount | null {
  const action = orderActionOf(a);
  const pre: Snapshot = a.precondition ?? {};
  // The snapshot's figures (what executes); the order read only for a request stored without them.
  const s = orderSnapshotFigures(pre);
  const currency = s?.fiatCurrency ?? order?.fiatCurrency ?? "BYN";
  const captured = wire(pre.capturedAmount);
  const tokens: ApprovalAmount | null = s
    ? { amount: s.tokenAmount, unit: order && order.instrument.admin === s.instrument.admin && order.instrument.id === s.instrument.id ? order.instrument.symbol : s.instrument.id }
    : order
      ? { amount: order.tokenAmount, unit: order.instrument.symbol }
      : null;
  const direction = s?.direction ?? order?.direction ?? null;
  const fiat = s?.fiatAmount ?? order?.fiatAmount ?? null;
  switch (action) {
    case "refund": {
      if (!captured) return null;
      const left = (toUnits(captured) ?? 0n) - (toUnits(wire(pre.refundedAmount) ?? "0") ?? 0n);
      return left > 0n ? { amount: fromUnits(left), unit: currency } : null;
    }
    case "refund_bank":
      return captured ? { amount: captured, unit: currency } : null;
    case "bank_unpaid":
      if (!direction || !fiat) return null;
      return { amount: direction === "offramp" ? fiat : (captured ?? fiat), unit: currency };
    case "reverse":
    case "credit_back":
    case "burn_uncredited":
      return tokens;
    default:
      return null;
  }
}

/** `150.00 BYN`, or one sum per unit (`150.00 BYN + 20.00 cBYN`), and how many had no exact figure. */
export function approvalsTotal(amounts: readonly (ApprovalAmount | null)[]): string {
  const sums = new Map<string, bigint>();
  let unnamed = 0;
  for (const x of amounts) {
    const units = x ? toUnits(x.amount) : null;
    if (!x || units === null) {
      unnamed += 1;
      continue;
    }
    sums.set(x.unit, (sums.get(x.unit) ?? 0n) + units);
  }
  const parts = [...sums].map(([unit, total]) => exactMoney(fromUnits(total), 2, unit));
  const head = parts.length ? parts.join(" + ") : "no exact figure";
  return unnamed && parts.length ? `${head} (+ ${unnamed} without an exact figure)` : head;
}

/** One booking of a pending statement confirm, joined to its line (null when the line is not in this statement). */
export interface LineBooking {
  lineId: string;
  matchKind: string;
  orderId: string | null;
  batchId: string | null;
  line: Pick<ApiBankLine, "amount" | "currency" | "lineRef" | "bookingDate"> | null;
}

/**
 * What a pending `ramp.statement.confirm` books besides the proposals (review F3 / F9): the
 * requester's classifications from the approval's params, by line id — what the approver approves.
 */
export function statementBookings(
  pending: Pick<ApiApproval, "params"> | null | undefined,
  lines: readonly ApiBankLine[],
): Map<string, LineBooking> {
  const byId = new Map(lines.map((l) => [l.id.toLowerCase(), l]));
  const out = new Map<string, LineBooking>();
  const list = Array.isArray(pending?.params?.classifications) ? (pending.params.classifications as Snapshot[]) : [];
  for (const c of list) {
    const lineId = String(c.lineId ?? "").toLowerCase();
    if (!lineId) continue;
    out.set(lineId, { lineId, matchKind: String(c.matchKind ?? "?"), orderId: text(c.orderId), batchId: text(c.batchId), line: byId.get(lineId) ?? null });
  }
  return out;
}

/** `-1,500.00 BYN (L-7, 2026-10-19) as operator_sweep, order 5e6f7a8b`; a line not in this statement says so. */
export function bookingSentence(b: LineBooking, currency = "BYN"): string {
  const ref = b.orderId ? `, order ${b.orderId.slice(0, 8)}` : b.batchId ? `, batch ${b.batchId.slice(0, 8)}` : "";
  const what = b.line
    ? `${fiatLabel(b.line.amount, b.line.currency || currency)} (${b.line.lineRef}, ${b.line.bookingDate.slice(0, 10)})`
    : `line ${b.lineId.slice(0, 8)} (not in this statement)`;
  return `${what} as ${b.matchKind}${ref}`;
}
