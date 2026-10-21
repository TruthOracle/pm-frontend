/**
 * Cash out, step 1 of 2: pick where the money goes — back to the card it was bought with (a
 * refund of that card's own purchases, up to what they can still refund) or a bank account in
 * the person's name — type the amount, read the quote, and open the order ("Review cash-out").
 * Nothing moves yet: the order page asks for the wallet signature (step 2), so the wallet popup
 * opens on its own click instead of after a network round trip.
 *
 * Card-bought BYN may go to a bank account only after the card dispute window (exposure,
 * docs/RAMP.md §9.3); the form says so and caps the bank amount at what is withdrawable now.
 */
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Info, Loader2 } from "lucide-react";
import { WALLET_DISPLAY_NAME } from "@/config";
import { formatMoney } from "@/lib/instruments";
import {
  RAMP_EXPOSURE_SENTENCE,
  amountInputSentence,
  bankAccountLabel,
  bankAccountStatusView,
  bankEtaPhrase,
  cardLabel,
  fiatLabel,
  limitProblemSentence,
  openOrderIdOf,
  quoteLimitSentence,
  rampErrorMessage,
  rampFeeLabel,
  startOfframp,
  type RampBankAccount,
  type RampCard,
  type RampDestinationInput,
  type RampOverview,
} from "@/lib/ramp";
import { checkAmountLimits, checkCap, isPositiveDecimal, keepSelection, parseAmountInput } from "@/lib/rampLogic";
import { isBackendError } from "@/lib/backend";
import { primaryBtn } from "@/components/Account/accountUi";
import { destinationKey, useAttemptKey, useRampQuote } from "./hooks";
import { ReasonList, inputCls } from "./rampUi";

interface Option {
  key: string;
  destination: RampDestinationInput;
  title: string;
  detail: string;
  /** A refund to the card is capped in fiat (after the fee); every other exit by exposure, in tokens. */
  cap: { kind: "card" | "bank"; on: "fiat" | "amount"; bound: string };
}

export function RampCashOutForm({
  overview,
  paused,
  cards,
  accounts,
  listsFailed,
}: {
  overview: RampOverview;
  paused: boolean;
  cards: RampCard[];
  accounts: RampBankAccount[];
  listsFailed: boolean;
}) {
  const navigate = useNavigate();
  const token = overview.instrument;
  const fiat = overview.fiat.currency;
  const dp = overview.fiat.decimals;
  const rail = (r: "card" | "bank") => overview.rails.find((x) => x.rail === r) ?? null;
  const cardRail = rail("card");
  const bankRail = rail("bank");
  const withdrawable = overview.exposure.withdrawableToBank;

  // Only an active card that funded a 3-D Secure purchase takes cash-outs (`payoutEligible`); a
  // refund-mode card with nothing left to refund, like an ineligible one, is listed, not offered.
  const usable = (c: RampCard) => c.status === "active" && c.payoutEligible;
  const spent = (c: RampCard) => c.cashout.mode === "refund" && !isPositiveDecimal(c.cashout.available);
  const options: Option[] = [
    ...(cardRail
      ? cards
          .filter((c) => usable(c) && c.cashout.mode !== "none" && !spent(c))
          .map((c): Option => {
            const refund = c.cashout.mode === "refund";
            return {
              key: `card:${c.id}`,
              destination: { kind: "card", paymentMethodId: c.id },
              title: cardLabel(c),
              detail: refund
                ? `Back to the card you paid with, up to ${fiatLabel(c.cashout.available, fiat, dp)}`
                : `Card payout, up to ${fiatLabel(withdrawable, fiat, dp)} now`,
              cap: refund
                ? { kind: "card", on: "fiat", bound: c.cashout.available }
                : { kind: "bank", on: "amount", bound: withdrawable },
            };
          })
      : []),
    ...(bankRail
      ? accounts
          .filter((a) => a.status === "active")
          .map(
            (a): Option => ({
              key: `bank:${a.id}`,
              destination: { kind: "bank", bankAccountId: a.id },
              title: bankAccountLabel(a),
              detail: `Bank transfer, usually ${bankEtaPhrase(bankRail.eta.businessDays)}`,
              cap: { kind: "bank", on: "amount", bound: withdrawable },
            }),
          )
      : []),
  ];
  const unavailable = [
    ...(cardRail
      ? cards
          .filter((c) => c.cashout.mode !== "none" && (!usable(c) || spent(c)))
          .map((c) => ({
            key: `card:${c.id}`,
            title: cardLabel(c),
            note: usable(c) ? "nothing left to refund to this card" : "this card cannot take cash-outs",
          }))
      : []),
    ...(bankRail
      ? accounts
          .filter((a) => a.status === "cooling_off" || a.status === "pending_proof" || a.status === "blocked")
          .map((a) => ({ key: `bank:${a.id}`, title: bankAccountLabel(a), note: bankAccountStatusView(a).label }))
      : []),
  ];

  const [picked, setPicked] = useState("");
  const selectedKey = keepSelection(
    picked,
    options.map((o) => o.key),
  );
  const selected = options.find((o) => o.key === selectedKey) ?? null;
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; orderId: string | null } | null>(null);

  const limits = overview.limits.offramp;
  const eligibility = overview.eligibility.offramp;
  const maxDecimals = Math.min(dp, token?.decimals ?? dp);
  const parsed = parseAmountInput(raw, maxDecimals);
  const amount = parsed.ok ? parsed.value : null;
  const preCap =
    selected && selected.cap.on === "amount" && amount ? checkCap(amount, selected.cap.bound, selected.cap.kind) : null;
  const limitProblem = amount ? (checkAmountLimits(amount, limits) ?? preCap) : null;
  const destKey = selected ? destinationKey(selected.destination) : "";
  const quotable = amount && !limitProblem && eligibility.allowed && !paused && selected ? amount : null;
  const { quote, error: quoteError, loading, requote } = useRampQuote("offramp", quotable, null, destKey);
  const attemptKey = useAttemptKey(`offramp|${amount ?? ""}|${destKey}`);

  if (!token || (!cardRail && !bankRail)) return null;

  const postCap =
    quote && selected?.cap.on === "fiat" ? checkCap(quote.fiatAmount, selected.cap.bound, selected.cap.kind) : null;
  const inputProblem = parsed.ok ? null : amountInputSentence(parsed.problem, maxDecimals);
  const quoteProblem = quote ? (postCap ? limitProblemSentence(postCap, fiat) : quoteLimitSentence(quote, fiat)) : null;
  const canSubmit =
    !paused && !busy && eligibility.allowed && !!selected && !!quote && !quoteProblem && !quoteError && !limitProblem;

  const submit = async () => {
    if (!amount || !quote || !selected) return;
    setBusy(true);
    setError(null);
    try {
      const order = await startOfframp({
        amount,
        destination: selected.destination,
        expectedFiatAmount: quote.fiatAmount,
        idempotencyKey: attemptKey(),
      });
      navigate(`/wallet/ramp/${encodeURIComponent(order.id)}`);
    } catch (e) {
      setError({ text: rampErrorMessage(e), orderId: openOrderIdOf(e) });
      // The figures moved on the server: fetch the new ones so the next click confirms them.
      if (isBackendError(e, "ramp_quote_changed")) requote();
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 space-y-3">
      {!eligibility.allowed && <ReasonList reasons={eligibility.reasons} />}
      {isPositiveDecimal(overview.exposure.amount) && (
        <div className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {RAMP_EXPOSURE_SENTENCE} Can go to a bank account now: <b>{fiatLabel(withdrawable, fiat, dp)}</b>.
          </span>
        </div>
      )}
      <fieldset className="space-y-2">
        <legend className="mb-1 text-xs text-slate-600">Send to</legend>
        {options.map((o) => (
          <label
            key={o.key}
            className={`flex cursor-pointer gap-2 rounded-lg border px-3 py-2 text-xs ${
              o.key === selectedKey ? "border-primary bg-emerald-50/60" : "border-slate-200 bg-white"
            }`}
          >
            <input
              type="radio"
              name="ramp-destination"
              checked={o.key === selectedKey}
              onChange={() => {
                setPicked(o.key);
                setError(null);
              }}
            />
            <span>
              <span className="block text-sm font-semibold text-slate-900">{o.title}</span>
              <span className="block text-slate-600">{o.detail}</span>
            </span>
          </label>
        ))}
        {unavailable.map((u) => (
          <div
            key={u.key}
            className="flex flex-wrap gap-x-2 rounded-lg border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-500"
          >
            <span className="font-semibold">{u.title}</span>
            <span>· {u.note}</span>
          </div>
        ))}
        {options.length === 0 && (
          <p className="text-xs text-slate-600">
            {listsFailed
              ? "Your cards and bank accounts could not be loaded. Reload to try again."
              : "Cash-outs go back to a card you bought with, or to a bank account in your name."}
          </p>
        )}
        {bankRail && (
          <Link to="/wallet/ramp#bank-accounts" className="inline-block text-xs font-semibold text-primary underline">
            Add a bank account
          </Link>
        )}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <label className="block text-xs text-slate-600">
          You cash out ({token.symbol})
          <input
            inputMode="decimal"
            autoComplete="off"
            value={raw}
            onChange={(e) => {
              setRaw(e.target.value);
              setError(null);
            }}
            placeholder={`${fiatLabel(limits.min, token.symbol, dp)} – ${fiatLabel(limits.max, token.symbol, dp)}`}
            aria-invalid={!!inputProblem || !!limitProblem}
            className={inputCls}
            aria-label={`Amount of ${token.symbol} to cash out`}
          />
        </label>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => void submit()}
          className={`${primaryBtn} justify-center px-4`}
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Review cash-out
        </button>
      </div>
      <p className="text-[11px] text-slate-500">
        Per order {fiatLabel(limits.min, token.symbol, dp)} – {fiatLabel(limits.max, token.symbol, dp)} · left today{" "}
        {fiatLabel(limits.dailyRemaining, token.symbol, dp)} · this month{" "}
        {fiatLabel(limits.monthlyRemaining, token.symbol, dp)}
        {cardRail ? ` · card fee ${rampFeeLabel(cardRail.fee, fiat, dp)}` : ""}
        {bankRail ? ` · bank fee ${rampFeeLabel(bankRail.fee, fiat, dp)}` : ""}
      </p>
      <div className="min-h-[1.25rem] text-xs text-slate-600" aria-live="polite">
        {inputProblem || limitProblem ? (
          <span className="text-red-700">
            {inputProblem ?? (limitProblem ? limitProblemSentence(limitProblem, token.symbol) : "")}
          </span>
        ) : quoteError || quoteProblem ? (
          <span className="text-red-700">{quoteError ?? quoteProblem}</span>
        ) : quote ? (
          <>
            You withdraw <b>{formatMoney(quote.tokenAmount, token)}</b> · fee {fiatLabel(quote.fee, fiat, dp)} · you
            receive <b>{fiatLabel(quote.fiatAmount, fiat, dp)}</b>. Next you sign the withdrawal in your{" "}
            {WALLET_DISPLAY_NAME} wallet.
          </>
        ) : loading ? (
          <span className="text-slate-400">Getting a quote…</span>
        ) : null}
      </div>
      {error && (
        <p className="text-xs text-red-700">
          {error.text}{" "}
          {error.orderId && (
            <Link to={`/wallet/ramp/${encodeURIComponent(error.orderId)}`} className="font-semibold underline">
              Open the waiting cash-out
            </Link>
          )}
        </p>
      )}
    </div>
  );
}

export default RampCashOutForm;
