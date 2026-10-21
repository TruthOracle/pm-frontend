/**
 * Payout bank accounts (docs/RAMP.md §10.2): a BYN IBAN in the person's own verified name. The
 * IBAN is checked here first (lib/iban.ts: BY, 28 characters, mod-97) so a typo is caught while
 * the bank app is still open; the server re-checks it against the bank directory. The person
 * picks which verified spelling of their name the account is held under (the name itself never
 * reaches the browser before the account exists). Each account shows its status, when it becomes
 * usable, and how it was confirmed; one with a payout on its way cannot be removed.
 */
import { useState } from "react";
import { Landmark, Loader2, Trash2 } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { isBackendError } from "@/lib/backend";
import { BY_IBAN_LENGTH, checkByIban, formatIbanGroups, ibanProblemSentence } from "@/lib/iban";
import {
  RAMP_NAME_FORMS,
  addBankAccount,
  bankAccountStatusView,
  rampErrorMessage,
  removeBankAccount,
  type RampBankAccount,
  type RampNameForm,
} from "@/lib/ramp";
import { ConfirmDialog, Pill, SectionCard, primaryBtn, smallBtn } from "@/components/Account/accountUi";
import { inputCls } from "./rampUi";

/** What removing an account can answer, worded for an account rather than an order. */
const REMOVE_SENTENCES = { not_found: "This bank account was already removed. Reload the page." };

function AddBankAccount({ onAdded }: { onAdded: () => void }) {
  const auth = useAuth();
  const [iban, setIban] = useState("");
  const [touched, setTouched] = useState(false);
  const [nameForm, setNameForm] = useState<RampNameForm | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; reauth: boolean } | null>(null);
  const check = checkByIban(iban);
  const showProblem = !check.ok && (touched || check.iban.length >= BY_IBAN_LENGTH);
  const problem = !check.ok && showProblem ? ibanProblemSentence(check.problem, check.iban) : null;

  const submit = async () => {
    if (!check.ok || !nameForm) return;
    setBusy(true);
    setError(null);
    try {
      await addBankAccount({ iban: check.iban, nameForm });
      setIban("");
      setTouched(false);
      setNameForm("");
      onAdded();
    } catch (e) {
      setError({ text: rampErrorMessage(e), reauth: isBackendError(e, "recent_auth_required") });
    } finally {
      setBusy(false);
    }
  };

  const signInAgain = async () => {
    try {
      await auth.signOut();
    } finally {
      auth.openLogin("login");
    }
  };

  return (
    <div className="mt-4 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <h3 className="text-sm font-semibold text-slate-900">Add a bank account</h3>
      <label className="block text-xs text-slate-600">
        IBAN of a BYN account in your own name
        <input
          className={`${inputCls} font-mono uppercase`}
          value={iban}
          onChange={(e) => setIban(e.target.value)}
          onBlur={() => setTouched(true)}
          placeholder="BY00 XXXX 0000 0000 0000 0000 0000"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={!!problem}
          aria-describedby="ramp-iban-problem"
        />
      </label>
      {problem ? (
        <p id="ramp-iban-problem" className="text-xs text-red-700">
          {problem}
        </p>
      ) : (
        check.ok && <p className="font-mono text-xs text-emerald-700">{formatIbanGroups(check.iban)}</p>
      )}
      <fieldset>
        <legend className="text-xs text-slate-600">The account is held under your name in</legend>
        <div className="mt-1 flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:gap-4">
          {RAMP_NAME_FORMS.map((f) => (
            <label key={f.form} className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="radio"
                name="ramp-name-form"
                checked={nameForm === f.form}
                onChange={() => setNameForm(f.form)}
              />
              {f.label}
            </label>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-slate-500">
          Pick the spelling your bank uses for the account holder; payouts carry your verified name in that spelling.
        </p>
      </fieldset>
      {error && (
        <p className="text-xs text-red-700">
          {error.text}{" "}
          {error.reauth && (
            <button type="button" className="font-semibold underline" onClick={() => void signInAgain()}>
              Sign in again
            </button>
          )}
        </p>
      )}
      <button
        type="button"
        className={primaryBtn}
        disabled={busy || !check.ok || !nameForm}
        onClick={() => void submit()}
      >
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        Add account
      </button>
    </div>
  );
}

export function RampBankAccounts({
  accounts,
  failed,
  onChanged,
}: {
  accounts: RampBankAccount[];
  failed: boolean;
  onChanged: () => void;
}) {
  const [target, setTarget] = useState<RampBankAccount | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const visible = accounts.filter((a) => a.status !== "removed");

  const remove = async () => {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      await removeBankAccount(target.id);
      setTarget(null);
      onChanged();
    } catch (e) {
      setError(rampErrorMessage(e, REMOVE_SENTENCES));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard
      id="bank-accounts"
      icon={<Landmark className="h-4 w-4" />}
      title="Bank accounts"
      description="Cash-outs to a bank account go by bank transfer to a BYN account in your own name."
    >
      {failed && <p className="text-xs text-red-700">Your bank accounts could not be loaded. Reload to try again.</p>}
      {!failed && visible.length === 0 && <p className="text-sm text-slate-500">No bank accounts yet.</p>}
      <ul className="divide-y divide-slate-100">
        {visible.map((a) => {
          const view = bankAccountStatusView(a);
          return (
            <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm">
              <div className="space-y-0.5">
                <div className="font-semibold text-slate-900">
                  {a.bankName ?? "Bank account"} <span className="font-mono text-slate-600">{a.ibanMasked}</span>
                </div>
                <div className="text-xs text-slate-500">
                  {a.bic ? `BIC ${a.bic}` : ""}
                  {a.bic && a.holderName ? " · " : ""}
                  {a.holderName ? `Holder ${a.holderName}` : ""}
                </div>
                {view.detail && <div className="text-xs text-slate-600">{view.detail}</div>}
              </div>
              <div className="flex items-center gap-2">
                <Pill tone={view.tone}>{view.label}</Pill>
                <button
                  type="button"
                  className={smallBtn}
                  onClick={() => {
                    setError(null);
                    setTarget(a);
                  }}
                  aria-label={`Remove ${a.ibanMasked}`}
                >
                  <Trash2 className="h-3 w-3" /> Remove
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <AddBankAccount onAdded={onChanged} />
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(open) => !open && setTarget(null)}
        title="Remove this bank account?"
        description={
          target
            ? `${target.bankName ?? "Bank account"} ${target.ibanMasked} can no longer receive cash-outs. Adding it again starts a new waiting period.`
            : ""
        }
        confirmLabel="Remove"
        destructive
        busy={busy}
        error={error}
        onConfirm={() => void remove()}
      />
    </SectionCard>
  );
}

export default RampBankAccounts;
