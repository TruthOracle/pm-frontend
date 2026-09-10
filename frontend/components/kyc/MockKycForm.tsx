/**
 * Test-mode stand-in for the provider widget (KYC_PROVIDER=mock; the route is absent
 * in prod / mainnet). The same person/document fields a real provider would report are
 * sent once so the backend can exercise its duplicate detection; the form never stores
 * them (§9.7).
 */
import { useId, useState } from "react";
import { FlaskConical, LoaderCircle } from "lucide-react";
import { kycErrorMessage, submitMockKyc, type KycStatus, type MockDocType, type MockOutcome } from "@/lib/kyc";

const inputCls =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-primary";
const labelCls = "mb-1 block text-xs font-semibold text-slate-600";

export const DOC_TYPES: { value: MockDocType; label: string }[] = [
  { value: "PASSPORT", label: "Passport" },
  { value: "ID_CARD", label: "National ID card" },
  { value: "DRIVERS", label: "Driver's licence" },
  { value: "RESIDENCE_PERMIT", label: "Residence permit" },
];

export const OUTCOMES: { value: MockOutcome; label: string }[] = [
  { value: "approved", label: "Approve" },
  { value: "rejected_retry", label: "Reject (can retry)" },
  { value: "rejected_final", label: "Reject (final)" },
];

export default function MockKycForm({
  verificationId,
  onDone,
  onCancel,
}: {
  verificationId: string;
  onDone: (userKycStatus: KycStatus) => void;
  onCancel: () => void;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dob, setDob] = useState("");
  const [country, setCountry] = useState("");
  const [docType, setDocType] = useState<MockDocType>("PASSPORT");
  const [docCountry, setDocCountry] = useState("");
  const [docNumber, setDocNumber] = useState("");
  const [outcome, setOutcome] = useState<MockOutcome>("approved");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Unique per instance so the labels point at THIS form's controls even if two
  // panels ever mount at once.
  const id = useId();
  const f = (name: string) => `${id}-${name}`;

  const iso3 = (v: string) => v.trim().toUpperCase();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!/^[A-Z]{3}$/.test(iso3(country)) || !/^[A-Z]{3}$/.test(iso3(docCountry))) {
      setError("Countries must be 3-letter ISO codes, e.g. USA, DEU, IND.");
      return;
    }
    setBusy(true);
    try {
      const res = await submitMockKyc({
        verificationId,
        outcome,
        person: { firstName: firstName.trim(), lastName: lastName.trim(), dob, country: iso3(country) },
        documents: [{ docType, country: iso3(docCountry), number: docNumber.trim() }],
      });
      onDone(res.userKycStatus);
    } catch (err) {
      setError(kycErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="rounded-xl border-2 border-dashed border-amber-300 bg-amber-50/60 p-4">
      <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-amber-800">
        <FlaskConical className="h-4 w-4" /> Test mode — no real identity check
      </div>
      <p className="mb-4 text-xs text-amber-900/80">
        This deployment uses the mock verification provider. Pick an outcome and submit; the details below only
        feed the duplicate-identity check and are not stored.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={f("first")} className={labelCls}>First name</label>
          <input id={f("first")} className={inputCls} value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
        </div>
        <div>
          <label htmlFor={f("last")} className={labelCls}>Last name</label>
          <input id={f("last")} className={inputCls} value={lastName} onChange={(e) => setLastName(e.target.value)} required />
        </div>
        <div>
          <label htmlFor={f("dob")} className={labelCls}>Date of birth</label>
          <input id={f("dob")} className={inputCls} type="date" value={dob} onChange={(e) => setDob(e.target.value)} required />
        </div>
        <div>
          <label htmlFor={f("country")} className={labelCls}>Country (ISO3)</label>
          <input
            id={f("country")}
            className={inputCls}
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            placeholder="e.g. USA"
            maxLength={3}
            required
          />
        </div>
        <div>
          <label htmlFor={f("doctype")} className={labelCls}>Document type</label>
          <select id={f("doctype")} className={inputCls} value={docType} onChange={(e) => setDocType(e.target.value as MockDocType)}>
            {DOC_TYPES.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={f("doccountry")} className={labelCls}>Document country (ISO3)</label>
          <input
            id={f("doccountry")}
            className={inputCls}
            value={docCountry}
            onChange={(e) => setDocCountry(e.target.value)}
            placeholder="e.g. USA"
            maxLength={3}
            required
          />
        </div>
        <div>
          <label htmlFor={f("docnumber")} className={labelCls}>Document number</label>
          <input id={f("docnumber")} className={inputCls} value={docNumber} onChange={(e) => setDocNumber(e.target.value)} required />
        </div>
        <div>
          <label htmlFor={f("outcome")} className={labelCls}>Outcome</label>
          <select id={f("outcome")} className={inputCls} value={outcome} onChange={(e) => setOutcome(e.target.value as MockOutcome)}>
            {OUTCOMES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity disabled:opacity-50"
        >
          {busy && <LoaderCircle className="h-4 w-4 animate-spin" />}
          {busy ? "Submitting…" : "Submit test verification"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
