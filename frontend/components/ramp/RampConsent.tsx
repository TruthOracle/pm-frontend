/**
 * The consent step before the first order (and again whenever the terms version changes): the
 * operator of record's terms, "I act for myself" and the PEP self-declaration (docs/RAMP.md §11.2).
 * Both declarations start unanswered on purpose — a legal statement is never pre-ticked. The
 * backend decides what the answers mean; this form only records them.
 */
import { useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { primaryBtn } from "@/components/Account/accountUi";
import { isStaleTermsError, rampErrorMessage, submitRampConsent, type RampOverview } from "@/lib/ramp";
import { CONSENT_TEXT_MAX, consentBody, safeExternalUrl, type ConsentForm } from "@/lib/rampLogic";
import { inputCls } from "./rampUi";

const MISSING: Record<"terms" | "actsForSelf" | "principal" | "pep", string> = {
  terms: "Read and accept the terms to continue.",
  actsForSelf: "Say whether you act for yourself.",
  principal: "Name the person or company you act for.",
  pep: "Answer the question about politically exposed persons.",
};

function YesNo({
  name,
  value,
  onChange,
  yes,
  no,
}: {
  name: string;
  value: boolean | null;
  onChange: (v: boolean) => void;
  yes: string;
  no: string;
}) {
  const opt = (v: boolean, label: string) => (
    <label className="flex items-center gap-2 text-sm text-slate-700">
      <input type="radio" name={name} checked={value === v} onChange={() => onChange(v)} />
      {label}
    </label>
  );
  return (
    <div className="mt-1 flex flex-col gap-1 sm:flex-row sm:gap-5">
      {opt(true, yes)}
      {opt(false, no)}
    </div>
  );
}

export function RampConsent({ overview, onDone }: { overview: RampOverview; onDone: () => void }) {
  const [form, setForm] = useState<ConsentForm>({
    termsAccepted: false,
    actsForSelf: null,
    principal: "",
    pepDeclared: null,
    pepDetail: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const termsUrl = safeExternalUrl(overview.consent.termsUrl || overview.operator?.termsUrl);
  const operator = overview.operator?.name ?? "The operator";
  const check = consentBody(form, overview.consent.termsVersion);
  const set = (patch: Partial<ConsentForm>) => setForm((f) => ({ ...f, ...patch }));

  const submit = async () => {
    if (!check.ok) return setError(MISSING[check.missing]);
    setBusy(true);
    setError(null);
    try {
      await submitRampConsent(check.body);
      onDone();
    } catch (e) {
      setError(rampErrorMessage(e));
      if (isStaleTermsError(e)) {
        // The terms changed while the form was open: the acceptance was for the old version, so it
        // is cleared, and the overview reloads with the new version and its link.
        setForm((f) => ({ ...f, termsAccepted: false }));
        onDone();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 space-y-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="flex items-start gap-2 text-sm text-slate-700">
        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <p>
          {operator} runs buying and cashing out of {overview.instrument?.symbol ?? "the token"}. Before your first
          order, read the terms
          {overview.consent.termsVersion ? ` (version ${overview.consent.termsVersion})` : ""} and answer two questions.
        </p>
      </div>

      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          className="mt-1"
          checked={form.termsAccepted}
          onChange={(e) => set({ termsAccepted: e.target.checked })}
        />
        <span>
          I have read and accept the{" "}
          {termsUrl ? (
            <a
              href={termsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-primary underline"
            >
              terms
            </a>
          ) : (
            "terms"
          )}
          .
        </span>
      </label>

      <fieldset>
        <legend className="text-xs font-semibold text-slate-600">Who are you buying and cashing out for?</legend>
        <YesNo
          name="ramp-acts-for-self"
          value={form.actsForSelf}
          onChange={(v) => set({ actsForSelf: v })}
          yes="Myself — I act on my own behalf"
          no="Someone else"
        />
        {form.actsForSelf === false && (
          <input
            className={inputCls}
            maxLength={CONSENT_TEXT_MAX}
            value={form.principal}
            onChange={(e) => set({ principal: e.target.value })}
            placeholder="Name of the person or company you act for"
            aria-label="Name of the person or company you act for"
          />
        )}
      </fieldset>

      <fieldset>
        <legend className="text-xs font-semibold text-slate-600">
          Are you a politically exposed person (PEP), or a family member or close associate of one?
        </legend>
        <YesNo name="ramp-pep" value={form.pepDeclared} onChange={(v) => set({ pepDeclared: v })} yes="Yes" no="No" />
        {form.pepDeclared === true && (
          <input
            className={inputCls}
            maxLength={CONSENT_TEXT_MAX}
            value={form.pepDetail}
            onChange={(e) => set({ pepDetail: e.target.value })}
            placeholder="Position, or your relationship to the person (optional)"
            aria-label="Position, or your relationship to the person"
          />
        )}
      </fieldset>

      {error && <p className="text-xs text-red-700">{error}</p>}
      <button type="button" className={primaryBtn} disabled={busy || !check.ok} onClick={() => void submit()}>
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        Continue
      </button>
    </div>
  );
}

export default RampConsent;
