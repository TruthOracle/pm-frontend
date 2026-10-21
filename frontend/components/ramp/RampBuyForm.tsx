/**
 * Buy: pick card or ERIP, type the BYN amount, see the limits and the backend's quote, open the
 * order. A card order leaves for the acquirer's hosted page (https only — an http link is
 * allowed for localhost dev); an ERIP order, or any order whose link fails the check, opens the
 * order page, which shows the ERIP details or what went wrong.
 */
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { formatMoney } from "@/lib/instruments";
import {
  RAMP_METHOD_WORDS,
  amountInputSentence,
  fiatLabel,
  limitProblemSentence,
  openOrderIdOf,
  quoteLimitSentence,
  rampErrorMessage,
  rampFeeLabel,
  startOnramp,
  ttlLabel,
  type RampMethod,
  type RampOverview,
} from "@/lib/ramp";
import { checkAmountLimits, keepSelection, parseAmountInput, safeExternalUrl } from "@/lib/rampLogic";
import { isBackendError } from "@/lib/backend";
import { primaryBtn } from "@/components/Account/accountUi";
import { useAttemptKey, useRampQuote } from "./hooks";
import { ReasonList, inputCls } from "./rampUi";

export function RampBuyForm({ overview, paused }: { overview: RampOverview; paused: boolean }) {
  const navigate = useNavigate();
  const token = overview.instrument;
  const fiat = overview.fiat.currency;
  const dp = overview.fiat.decimals;
  const methods = overview.methods;
  const [picked, setPicked] = useState<RampMethod | "">("");
  const method = keepSelection(
    picked,
    methods.map((m) => m.method),
  ) as RampMethod | "";
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; orderId: string | null } | null>(null);

  const limits = overview.limits.onramp;
  const eligibility = overview.eligibility.onramp;
  const maxDecimals = Math.min(dp, token?.decimals ?? dp);
  const parsed = parseAmountInput(raw, maxDecimals);
  const amount = parsed.ok ? parsed.value : null;
  const limitProblem = amount ? checkAmountLimits(amount, limits) : null;
  const quotable = amount && !limitProblem && eligibility.allowed && !paused && method ? amount : null;
  const { quote, error: quoteError, loading, requote } = useRampQuote("onramp", quotable, method || null, "");
  const attemptKey = useAttemptKey(`onramp|${amount ?? ""}|${method}`);
  const info = methods.find((m) => m.method === method);

  if (!token || methods.length === 0) return null;

  const submit = async () => {
    if (!amount || !quote || !method) return;
    setBusy(true);
    setError(null);
    try {
      const order = await startOnramp({
        amount,
        method,
        expectedTokenAmount: quote.tokenAmount,
        idempotencyKey: attemptKey(),
      });
      const url = order.next?.kind === "redirect" ? safeExternalUrl(order.next.url) : null;
      // The acquirer's page takes over (card + 3-D Secure) and returns to /wallet/ramp/<order>.
      if (url) return window.location.assign(url);
      navigate(`/wallet/ramp/${encodeURIComponent(order.id)}`);
    } catch (e) {
      setError({ text: rampErrorMessage(e), orderId: openOrderIdOf(e) });
      // The figures moved on the server: fetch the new ones so the next click confirms them.
      if (isBackendError(e, "ramp_quote_changed")) requote();
      setBusy(false);
    }
  };

  const inputProblem = parsed.ok ? null : amountInputSentence(parsed.problem, maxDecimals);
  const quoteProblem = quote ? quoteLimitSentence(quote, fiat) : null;
  const canSubmit = !paused && !busy && eligibility.allowed && !!quote && !quoteProblem && !quoteError && !limitProblem;

  return (
    <div className="mt-3 space-y-3">
      {!eligibility.allowed && <ReasonList reasons={eligibility.reasons} />}
      {methods.length > 1 && (
        <fieldset className="grid gap-2 sm:grid-cols-2">
          <legend className="mb-1 text-xs text-slate-600">Pay with</legend>
          {methods.map((m) => (
            <label
              key={m.method}
              className={`flex cursor-pointer gap-2 rounded-lg border px-3 py-2 text-xs ${
                m.method === method ? "border-primary bg-emerald-50/60" : "border-slate-200 bg-white"
              }`}
            >
              <input
                type="radio"
                name="ramp-method"
                checked={m.method === method}
                onChange={() => {
                  setPicked(m.method);
                  setError(null);
                }}
              />
              <span>
                <span className="block text-sm font-semibold text-slate-900">{RAMP_METHOD_WORDS[m.method].label}</span>
                <span className="block text-slate-600">{RAMP_METHOD_WORDS[m.method].hint}</span>
                <span className="block text-slate-500">
                  Fee {rampFeeLabel(m.fee, fiat, dp)}
                  {m.ttlMinutes > 0 ? ` · pay within ${ttlLabel(m.ttlMinutes)}` : ""}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <label className="block text-xs text-slate-600">
          You pay ({fiat})
          <input
            inputMode="decimal"
            autoComplete="off"
            value={raw}
            onChange={(e) => {
              setRaw(e.target.value);
              setError(null);
            }}
            placeholder={`${fiatLabel(limits.min, fiat, dp)} – ${fiatLabel(limits.max, fiat, dp)}`}
            aria-invalid={!!inputProblem || !!limitProblem}
            className={inputCls}
            aria-label={`Amount to pay in ${fiat}`}
          />
        </label>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => void submit()}
          className={`${primaryBtn} justify-center px-4`}
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {method === "erip" ? "Get ERIP payment details" : "Continue to card payment"}
        </button>
      </div>
      <p className="text-[11px] text-slate-500">
        Per order {fiatLabel(limits.min, fiat, dp)} – {fiatLabel(limits.max, fiat, dp)} · left today{" "}
        {fiatLabel(limits.dailyRemaining, fiat, dp)} · this month {fiatLabel(limits.monthlyRemaining, fiat, dp)}
        {methods.length === 1 && info ? ` · fee ${rampFeeLabel(info.fee, fiat, dp)}` : ""}
      </p>
      <div className="min-h-[1.25rem] text-xs text-slate-600" aria-live="polite">
        {inputProblem || limitProblem ? (
          <span className="text-red-700">
            {inputProblem ?? (limitProblem ? limitProblemSentence(limitProblem, fiat) : "")}
          </span>
        ) : quoteError || quoteProblem ? (
          <span className="text-red-700">{quoteError ?? quoteProblem}</span>
        ) : quote ? (
          <>
            You pay <b>{fiatLabel(quote.fiatAmount, fiat, dp)}</b> · fee {fiatLabel(quote.fee, fiat, dp)} · you get{" "}
            <b>{formatMoney(quote.tokenAmount, token)}</b> in your in-app balance
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
              Open the waiting order
            </Link>
          )}
        </p>
      )}
    </div>
  );
}

export default RampBuyForm;
