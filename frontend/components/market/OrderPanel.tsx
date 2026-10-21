/**
 * The order ticket of the market page's trade column and of the event page's trade dock, laid out
 * like Kalshi's: a tab row (BUY / SELL, or the current mode's own sub-toggle) with the order-type
 * menu on the right, the event and the outcome being traded, the Yes / No toggle with live prices,
 * the amount, the quote, what it costs and what it can pay, one full-width call to action, and the
 * in-app balance underneath. Every money figure is in the market's collateral and labelled with its
 * symbol (`market.collateral`, lib/instruments.ts) — a cBYN market reads cBYN, a Canton Coin one CC.
 *
 * Kalshi's order types map onto the pm-AMM's actions: Market (buy / sell outcome shares), Convert
 * (swap Yes ↔ No shares), Split / merge (mint or burn complete sets) and Liquidity (provide /
 * withdraw pool liquidity). Every action still goes through MarketView's handlers — quote,
 * prepare-then-sign, slippage bound, halt and wallet gates are unchanged; this is layout only.
 */
import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Tooltip } from "@chakra-ui/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { WALLET_DISPLAY_NAME } from "@/config";
import { cn } from "@/lib/utils";
import { formatDateTimeUTC, formatDateUTC } from "@/lib/time";
import { formatCents } from "@/lib/chartData";
import { formatMoney, type InstrumentRef } from "@/lib/instruments";
import { fmtNum, fmtCountdown } from "./marketHelpers";
import type { LiquiditySubTab, MainTab, TradeSubTab } from "./marketTypes";

const SLIPPAGE_OPTIONS = [0.005, 0.01, 0.02];

export type OrderMode = "market" | "convert" | "split" | "liquidity";

/** The order-type menu; the split hint names the collateral the sets are minted from. */
function orderModes(symbol: string): { mode: OrderMode; label: string; hint: string }[] {
  return [
    { mode: "market", label: "Market", hint: "Buy or sell outcome shares at the pool price" },
    { mode: "convert", label: "Convert", hint: "Swap Yes shares for No shares, or back" },
    { mode: "split", label: "Split / merge", hint: `Mint or burn complete Yes + No sets for ${symbol}` },
    { mode: "liquidity", label: "Liquidity", hint: "Provide or withdraw pool liquidity" },
  ];
}

type Side = "yes" | "no";
type WalletCta = { label: string; onClick?: () => void } | null;
// Shapes of the pm-AMM quotes MarketView computes (lib/marketPricing.ts).
type BuyQuote = { sharesOut: number; fee: number; avgPrice: number; priceImpact: number } | null;
type SellQuote = { netProceeds: number; fee: number; avgPrice: number } | null;
type SwapQuote = { sharesOut: number; fee: number; priceImpact: number } | null;
type LiquidityQuote = { cost: number; lpMinted: number; shareOfPool: number; newL: number } | null;

export interface OrderPanelContext {
  market: {
    question: string;
    yesSubTitle: string;
    noSubTitle: string;
    /** What every money figure on the ticket is in. */
    collateral: InstrumentRef;
    feeBps: number;
    /** Slice of each fee that funds the model prize pool (bps of the fee); the rest goes to the LPs. */
    prizeFeeShareBps?: number;
    expiresAt: number;
    createdAt: number;
    liquidityPeriodSecs: number;
    isDynamic: boolean;
    book?: { yesBid: number; yesAsk: number; noBid: number; noAsk: number } | null;
  };
  /** Grey line above the outcome: the event's title on the event page, the market's question on its own page. */
  contextTitle: string | null;
  /** The market's OWN image (never the event banner again); "" when it has none. */
  outcomeImage: string;
  phase: string;
  nowSecs: number;
  probYes: number;
  probNo: number;
  // Mode state (MarketView's existing tabs).
  mainTab: MainTab;
  setMainTab: (t: MainTab) => void;
  tradeSubTab: TradeSubTab;
  setTradeSubTab: (t: TradeSubTab) => void;
  tradeSide: "buy" | "sell" | "convert";
  setTradeSide: (s: "buy" | "sell" | "convert") => void;
  selectedSide: Side | null;
  setSelectedSide: (s: Side) => void;
  mintMode: "mint" | "merge";
  setMintMode: (m: "mint" | "merge") => void;
  liquiditySubTab: LiquiditySubTab;
  setLiquiditySubTab: (t: LiquiditySubTab) => void;
  // Inputs.
  collateralIn: number;
  setCollateralIn: (v: number) => void;
  sharesIn: number;
  setSharesIn: (v: number) => void;
  slippage: number;
  setSlippage: (v: number) => void;
  splitMergeAmount: number;
  setSplitMergeAmount: (v: number) => void;
  liquidityValue: number;
  setLiquidityValue: (v: number) => void;
  withdrawPct: number;
  setWithdrawPct: (v: number) => void;
  // Quotes.
  buyQuote: BuyQuote;
  sellQuote: SellQuote;
  swapQuote: SwapQuote;
  liquidityQuote: LiquidityQuote;
  canProvideLiquidity: boolean;
  // Account and gates.
  account: unknown;
  walletCta: WalletCta;
  tradeLockReason: string | null;
  busy: string | null;
  userPosition: { yesShares: number; noShares: number } | null;
  lpPosition: { lpTokens: number } | null;
  // Actions (MarketView's handlers, unchanged).
  handleTradeClick: () => void;
  handleSplitMerge: (action: "split" | "merge") => void;
  handleProvideLiquidity: () => void;
  handleWithdrawLiquidity: () => void;
}

export function orderModeOf(c: Pick<OrderPanelContext, "mainTab" | "tradeSubTab" | "tradeSide">): OrderMode {
  if (c.mainTab === "liquidity") return "liquidity";
  if (c.tradeSubTab === "mint") return "split";
  return c.tradeSide === "convert" ? "convert" : "market";
}

const cents = (p: number) => `${(p * 100).toFixed(1).replace(/\.0$/, "")}¢`;
const pct = (x: number, dp = 1) => `${(x * 100).toFixed(dp).replace(/\.0$/, "")}%`;
const parseAmount = (value: string) => {
  const v = parseFloat(value);
  return isNaN(v) || v < 0 ? 0 : v;
};

/** A bordered input row: label left, the value right-aligned and large (Kalshi's Shares / Limit price rows). */
function FieldRow({ label, unit, value, onChange, placeholder = "0" }: { label: string; unit?: string; value: number; onChange: (v: number) => void; placeholder?: string }) {
  return (
    <label className="ticket-field">
      <span className="ticket-field-label">{label}</span>
      <span className="flex min-w-0 items-baseline justify-end gap-1.5">
        <input type="number" inputMode="decimal" min={0} step="any" value={value || ""} placeholder={placeholder} onChange={(e) => onChange(parseAmount(e.target.value))} aria-label={label} />
        {unit && <span className="ticket-field-unit">{unit}</span>}
      </span>
    </label>
  );
}

function SummaryRow({ label, sub, value, big = false, title }: { label: string; sub?: string; value: ReactNode; big?: boolean; title?: string }) {
  return (
    <div className="ticket-sum-row">
      <div className="min-w-0">
        <div className="ticket-sum-label">{label}</div>
        {sub && (
          <div className="ticket-sum-sub" title={title}>
            {sub}
          </div>
        )}
      </div>
      <div className={cn("shrink-0 text-right", big ? "ticket-sum-big" : "ticket-sum-value")}>{value}</div>
    </div>
  );
}

export default function OrderPanel({ context: c, walletFooter }: { context: OrderPanelContext; walletFooter?: ReactNode }) {
  const mode = orderModeOf(c);
  const setMode = (m: OrderMode) => {
    if (m === "liquidity") {
      c.setMainTab("liquidity");
      return;
    }
    c.setMainTab("trade");
    if (m === "split") {
      c.setTradeSubTab("mint");
      return;
    }
    c.setTradeSubTab("swap");
    if (m === "convert") c.setTradeSide("convert");
    else if (c.tradeSide === "convert") c.setTradeSide("buy");
  };

  const m = c.market;
  const collateral = m.collateral;
  const sym = collateral.symbol;
  const modes = orderModes(sym);
  const yesName = m.yesSubTitle && m.yesSubTitle.toLowerCase() !== "yes" ? m.yesSubTitle : null;
  const outcomeName = yesName ?? m.question;
  const contextLine = c.contextTitle && c.contextTitle !== outcomeName ? c.contextTitle : null;
  const side: Side = c.selectedSide ?? "yes";
  const sideWord = side === "yes" ? "Yes" : "No";
  const closeMs = m.expiresAt * 1000;
  const feePct = pct(m.feeBps / 10_000, 2);
  // What the contract charges, per action (Truthoracle.daml): Buy takes feeBps of the collateral
  // spent, Sell of the collateral the shares fetch, SwapShares of the shares converted; split /
  // merge and liquidity carry none (the label only shows in Market and Convert modes).
  const prizeShareBps = m.prizeFeeShareBps ?? 0;
  const feeBase =
    mode === "convert"
      ? "of the shares you convert"
      : c.tradeSide === "sell"
        ? `of the ${sym} your shares sell for`
        : `of the ${sym} you spend, taken before your shares are bought`;
  const feeSplit =
    prizeShareBps > 0
      ? `${pct(prizeShareBps / 10_000, 0)} of it funds the model prize pool; the rest goes to this market's liquidity providers.`
      : "It goes to this market's liquidity providers.";
  const feeHelp = `Trading fee: ${feePct} ${feeBase}. ${feeSplit} Split, merge and liquidity carry no fee.`;
  const tradingOpen = c.phase === "trading";
  const beforeTrading = c.phase === "liquidity_period";
  const closed = !tradingOpen && !beforeTrading;
  const ask = m.book ? (side === "yes" ? m.book.yesAsk : m.book.noAsk) : null;
  const bid = m.book ? (side === "yes" ? m.book.yesBid : m.book.noBid) : null;

  // ── Tab row: BUY / SELL in Market mode, the mode's own sub-toggle otherwise ──
  const tab = (active: boolean, label: string, onClick: () => void) => (
    <button key={label} type="button" onClick={onClick} className={cn("ticket-tab", active && "ticket-tab-active")} aria-pressed={active}>
      {label}
    </button>
  );
  const tabs =
    mode === "market"
      ? [tab(c.tradeSide === "buy", "Buy", () => c.setTradeSide("buy")), tab(c.tradeSide === "sell", "Sell", () => c.setTradeSide("sell"))]
      : mode === "convert"
        ? [tab(side === "yes", "Yes → No", () => c.setSelectedSide("yes")), tab(side === "no", "No → Yes", () => c.setSelectedSide("no"))]
        : mode === "split"
          ? [tab(c.mintMode === "mint", "Split", () => c.setMintMode("mint")), tab(c.mintMode === "merge", "Merge", () => c.setMintMode("merge"))]
          : [tab(c.liquiditySubTab === "add", "Add", () => c.setLiquiditySubTab("add")), tab(c.liquiditySubTab === "remove", "Remove", () => c.setLiquiditySubTab("remove"))];

  // ── Call to action: the next step when trading is not possible yet, else the action ──
  const cta = (actionLabel: string, onClick: () => void, blockReason: string | null, busyKey: string) => {
    if (c.walletCta?.onClick) {
      return { label: c.walletCta.label, onClick: c.walletCta.onClick, disabled: false, helper: null as string | null };
    }
    const reason = c.walletCta?.label ?? c.tradeLockReason ?? (!c.account ? `Connect ${WALLET_DISPLAY_NAME} wallet` : null) ?? blockReason;
    return {
      label: c.busy === busyKey ? "Submitting…" : actionLabel,
      onClick,
      disabled: reason !== null || c.busy !== null,
      helper: reason,
    };
  };

  let body: ReactNode;
  let action: { label: string; onClick: () => void; disabled: boolean; helper: string | null } | null = null;
  let note: string | null = null;

  if (mode === "market" || mode === "convert") {
    if (closed) {
      body = <div className="ticket-notice">Trading is closed — the market has {c.phase === "expired" || c.phase === "proposed" ? "expired and awaits resolution" : "settled"}.</div>;
    } else if (beforeTrading) {
      body = (
        <div className="ticket-notice">
          {mode === "market" ? "Buying and selling" : "Converting"} opens when trading starts in{" "}
          <span className="font-semibold text-slate-950">{fmtCountdown(m.createdAt + m.liquidityPeriodSecs, c.nowSecs)}</span>. Meanwhile you can split sets and add liquidity.
        </div>
      );
    } else if (mode === "market" && c.tradeSide === "buy") {
      const q = c.buyQuote;
      const shares = q?.sharesOut ?? 0;
      body = (
        <>
          <FieldRow label="Amount" unit={sym} value={c.collateralIn} onChange={c.setCollateralIn} />
          <p className="ticket-muted">
            {q ? <>Avg {cents(q.avgPrice)}</> : <>Price {cents(side === "yes" ? c.probYes : c.probNo)}</>}
            {ask !== null && bid !== null && (
              <>
                {" "}· Ask {cents(ask)} · Bid {cents(bid)}
              </>
            )}
            {q && q.priceImpact > 0.0005 && <span className={q.priceImpact > 0.05 ? "text-oracle-no" : undefined}> · impact {pct(q.priceImpact, 2)}</span>}
          </p>
          <div className="ticket-sum">
            <SummaryRow label="Cost" value={formatMoney(c.collateralIn, collateral, 2)} />
            <SummaryRow label="Max payout" sub={formatDateUTC(closeMs)} title={`Pays 1 ${sym} per share if the market resolves ${sideWord}; it closes ${formatDateTimeUTC(closeMs)}`} value={formatMoney(shares, collateral, 2)} big />
            {q && c.collateralIn > 0 && <SummaryRow label="Potential return" value={<span className="text-oracle-yes">+{pct(shares / c.collateralIn - 1, 1)}</span>} />}
          </div>
        </>
      );
      action = cta(`Buy ${sideWord}`, c.handleTradeClick, c.collateralIn <= 0 ? `Enter the ${sym} to spend` : null, "trade");
      note = q ? `${fmtNum(q.sharesOut * (1 - c.slippage), 2)} shares at least, or the order does not fill (max slippage ${pct(c.slippage, 1)}).` : null;
    } else if (mode === "market") {
      const q = c.sellQuote;
      const held = c.userPosition ? (side === "yes" ? c.userPosition.yesShares : c.userPosition.noShares) : null;
      body = (
        <>
          <FieldRow label="Shares" unit={sideWord} value={c.sharesIn} onChange={c.setSharesIn} />
          <p className="ticket-muted">
            {q ? <>Avg {cents(q.avgPrice)}</> : <>Price {cents(side === "yes" ? c.probYes : c.probNo)}</>}
            {ask !== null && bid !== null && (
              <>
                {" "}· Ask {cents(ask)} · Bid {cents(bid)}
              </>
            )}
            {held !== null && (
              <>
                {" "}· you hold{" "}
                <button type="button" className="ticket-inline-link" onClick={() => c.setSharesIn(held)}>
                  {fmtNum(held, 2)}
                </button>
              </>
            )}
          </p>
          <div className="ticket-sum">
            <SummaryRow label="Fee" value={formatMoney(q?.fee ?? 0, collateral, 2)} />
            <SummaryRow label="You receive" sub="credited to your in-app balance" value={formatMoney(q?.netProceeds ?? 0, collateral, 2)} big />
          </div>
        </>
      );
      action = cta(`Sell ${sideWord}`, c.handleTradeClick, c.sharesIn <= 0 ? "Enter the shares to sell" : null, "trade");
      note = q ? `${formatMoney(q.netProceeds * (1 - c.slippage), collateral, 2)} at least, or the order does not fill (max slippage ${pct(c.slippage, 1)}).` : null;
    } else {
      const q = c.swapQuote;
      const to = side === "yes" ? "No" : "Yes";
      body = (
        <>
          <FieldRow label="Shares" unit={sideWord} value={c.sharesIn} onChange={c.setSharesIn} />
          <p className="ticket-muted">
            Converts {sideWord} shares into {to} shares through the pool
            {q && q.priceImpact > 0.0005 && <span className={q.priceImpact > 0.05 ? "text-oracle-no" : undefined}> · impact {pct(q.priceImpact, 2)}</span>}
          </p>
          <div className="ticket-sum">
            <SummaryRow label={`Fee (${sideWord} shares)`} value={fmtNum(q?.fee ?? 0, 3)} />
            <SummaryRow label="You receive" sub={`${to} shares`} value={fmtNum(q?.sharesOut ?? 0, 2)} big />
          </div>
        </>
      );
      action = cta(`Convert ${sideWord} → ${to}`, c.handleTradeClick, c.sharesIn <= 0 ? "Enter the shares to convert" : null, "trade");
      note = q ? `${fmtNum(q.sharesOut * (1 - c.slippage), 2)} ${to} shares at least (max slippage ${pct(c.slippage, 1)}).` : null;
    }
  } else if (mode === "split") {
    const mint = c.mintMode === "mint";
    if (closed) {
      body = <div className="ticket-notice">Sets can be split or merged only while the market is open.</div>;
    } else {
      const amt = c.splitMergeAmount;
      body = (
        <>
          <FieldRow label={mint ? "Amount" : "Pairs"} unit={mint ? sym : "sets"} value={amt} onChange={c.setSplitMergeAmount} />
          <p className="ticket-muted">{mint ? `1 ${sym} mints 1 Yes + 1 No — no price impact, no fee.` : `1 Yes + 1 No burn back into 1 ${sym} — no price impact, no fee.`}</p>
          <div className="ticket-sum">
            {mint ? (
              <>
                <SummaryRow label="You pay" value={formatMoney(amt, collateral, 2)} />
                <SummaryRow label="You receive" sub="complete sets" value={`${fmtNum(amt, 2)} Yes + No`} big />
              </>
            ) : (
              <>
                <SummaryRow label="You burn" value={`${fmtNum(amt, 2)} Yes + ${fmtNum(amt, 2)} No`} />
                <SummaryRow label="You receive" sub="credited to your in-app balance" value={formatMoney(amt, collateral, 2)} big />
              </>
            )}
          </div>
        </>
      );
      action = cta(
        mint ? "Split into Yes + No" : `Merge into ${sym}`,
        () => c.handleSplitMerge(mint ? "split" : "merge"),
        amt <= 0 ? (mint ? `Enter the ${sym} to split` : "Enter the pairs to merge") : !mint && !c.userPosition ? "You hold no Yes + No pairs to merge" : null,
        "splitmerge",
      );
    }
  } else if (c.liquiditySubTab === "add") {
    if (!c.canProvideLiquidity) {
      body = <div className="ticket-notice">Liquidity can only be added before the market expires.</div>;
    } else {
      const q = c.liquidityQuote;
      body = (
        <>
          <FieldRow label="Pool value +" unit={sym} value={c.liquidityValue} onChange={c.setLiquidityValue} />
          <p className="ticket-muted">The pool scales its reserves and L by (V+ΔV)/V, so the price does not move.</p>
          <div className="ticket-sum">
            <SummaryRow label="LP tokens" value={fmtNum(q?.lpMinted ?? 0, 4)} />
            <SummaryRow label="Share of pool" value={q ? pct(q.shareOfPool, 2) : "—"} />
            <SummaryRow label="Cost" sub={q ? `new L₀ ${fmtNum(q.newL, 2)}` : undefined} value={formatMoney(q?.cost ?? 0, collateral, 2)} big />
          </div>
        </>
      );
      action = cta("Add liquidity", c.handleProvideLiquidity, c.liquidityValue <= 0 ? "Enter the pool-value increase" : null, "liquidity");
    }
  } else {
    const lp = c.lpPosition;
    const locked = m.isDynamic && c.phase !== "resolved" && c.phase !== "voided";
    if (!lp || lp.lpTokens <= 0) {
      body = <div className="ticket-notice">You have no liquidity in this market.</div>;
    } else {
      body = (
        <>
          <div className="ticket-field">
            <span className="ticket-field-label">Withdraw</span>
            <span className="ticket-field-value">{c.withdrawPct}%</span>
          </div>
          <input type="range" min={0} max={100} value={c.withdrawPct} onChange={(e) => c.setWithdrawPct(Number(e.target.value))} className="ticket-range" aria-label="Share of your liquidity to withdraw" />
          <div className="ticket-seg mt-2">
            {[25, 50, 75, 100].map((p) => (
              <button key={p} type="button" onClick={() => c.setWithdrawPct(p)} className={cn("ticket-seg-btn", c.withdrawPct === p && "ticket-seg-btn-active")}>
                {p}%
              </button>
            ))}
          </div>
          <p className="ticket-muted">
            {locked
              ? "Dynamic pool: withdrawal unlocks after resolution or void (uniform-LVR design)."
              : c.phase === "resolved"
                ? `Settled pool: you receive your share of the winning reserve plus fees, as ${sym}.`
                : c.phase === "voided"
                  ? `Voided market: you receive your deposit share plus fees, as ${sym}.`
                  : "Static pool: early withdrawal returns proportional Yes / No shares plus your fee share."}
          </p>
          <div className="ticket-sum">
            <SummaryRow label="LP tokens to burn" value={fmtNum(lp.lpTokens * (c.withdrawPct / 100), 4)} big />
          </div>
        </>
      );
      action = cta(locked ? "Locked until resolution" : "Withdraw liquidity", c.handleWithdrawLiquidity, locked ? "Dynamic pools unlock after resolution" : c.withdrawPct <= 0 ? "Choose how much to withdraw" : null, "withdraw");
    }
  }

  const showSideToggle = (mode === "market" || mode === "convert") && !closed && !beforeTrading;
  const showSlippage = (mode === "market" || mode === "convert" || (mode === "liquidity" && c.liquiditySubTab === "add")) && action !== null;

  return (
    <div className="ticket">
      <div className="ticket-top">
        <div className="flex items-center gap-4" role="group" aria-label="Order side">
          {tabs}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="ticket-mode" aria-label={`Order type: ${modes.find((x) => x.mode === mode)?.label}`}>
              {modes.find((x) => x.mode === mode)?.label}
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64 rounded-xl p-1.5">
            <DropdownMenuRadioGroup value={mode} onValueChange={(v) => setMode(v as OrderMode)}>
              {modes.map((x) => (
                <DropdownMenuRadioItem key={x.mode} value={x.mode} className="flex-col items-start gap-0.5 rounded-lg py-2">
                  <span className="text-sm font-semibold text-slate-950">{x.label}</span>
                  <span className="text-xs text-slate-500">{x.hint}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="ticket-body">
        {contextLine && <div className="ticket-context" title={contextLine}>{contextLine}</div>}
        <div className="ticket-outcome">
          {c.outcomeImage && <img src={c.outcomeImage} alt="" className="ticket-outcome-img" />}
          <span className="min-w-0 truncate" title={outcomeName}>
            {outcomeName}
          </span>
        </div>

        {showSideToggle && (
          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="ticket-toggle" role="radiogroup" aria-label={mode === "convert" ? "Convert from" : "Outcome side"}>
              <button type="button" role="radio" aria-checked={side === "yes"} onClick={() => c.setSelectedSide("yes")} className={cn("ticket-toggle-btn", side === "yes" && "ticket-toggle-yes")}>
                Yes {formatCents(c.probYes)}
              </button>
              <button type="button" role="radio" aria-checked={side === "no"} onClick={() => c.setSelectedSide("no")} className={cn("ticket-toggle-btn", side === "no" && "ticket-toggle-no")}>
                No {formatCents(c.probNo)}
              </button>
            </div>
            <Tooltip label={feeHelp} hasArrow placement="top-end" openDelay={80} maxW="18rem" fontSize="xs" lineHeight="short" px={3} py={2} borderRadius="md">
              <button type="button" className="ticket-fee" aria-label={feeHelp}>
                {feePct} fee
              </button>
            </Tooltip>
          </div>
        )}

        <div className="mt-4 space-y-3">{body}</div>

        {showSlippage && (
          <div className="mt-3 flex items-center justify-between gap-3 text-[13px] text-slate-500">
            <span>Max slippage</span>
            <div className="ticket-seg" role="radiogroup" aria-label="Max slippage">
              {SLIPPAGE_OPTIONS.map((s) => (
                <button key={s} type="button" role="radio" aria-checked={c.slippage === s} onClick={() => c.setSlippage(s)} className={cn("ticket-seg-btn", c.slippage === s && "ticket-seg-btn-active")}>
                  {pct(s, 1)}
                </button>
              ))}
            </div>
          </div>
        )}

        {action && (
          <div className="mt-4">
            <button type="button" onClick={action.onClick} disabled={action.disabled} className="ticket-cta">
              {action.label}
            </button>
            {action.helper ? <p className="ticket-helper">{action.helper}</p> : note ? <p className="ticket-helper">{note}</p> : null}
          </div>
        )}

        {c.tradeLockReason && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
            <span className="font-semibold">{c.tradeLockReason}.</span> The connected wallet is linked to your account but is not its primary wallet, so it can deposit into the in-app balance but cannot trade from it.
          </p>
        )}
      </div>

      {walletFooter && <div className="ticket-foot">{walletFooter}</div>}
    </div>
  );
}
