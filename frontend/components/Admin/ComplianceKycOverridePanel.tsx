/**
 * KYC override (truthoracle-backend docs/API.md `POST /admin/users/:id/kyc/override`, C22; role
 * `aml`). Approving a KYC by hand opens the KYC-gated fiat ramp, so `approved` is the four-eyes
 * `kyc.override`: the request answers 202 with an approval that another person with `approver`
 * decides under Approvals (nobody linked to the account may), and the provider's own verdict is in
 * its description. `rejected_final` and `expired` close the gate at once (one aml decision).
 */
import { useState } from "react";
import { overrideKyc } from "@/lib/backendAdmin";
import { kycOverrideSentence } from "@/lib/rampAdmin";
import { KYC_OVERRIDE_STATUSES, type KycOverrideStatus } from "@/lib/rampAdminTypes";
import { ConfirmDialog } from "@/components/Account/accountUi";
import { btn, Card, field } from "./adminUi";
import { useBackendOperator } from "./BackendOperatorSession";
import { Field, RoleNote, useRampRun, useRoleHint } from "./RampAdminUi";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EFFECT: Record<KycOverrideStatus, string> = {
  approved:
    "approves the account's KYC by hand: a four-eyes request, executed once another person with the approver role approves it under Approvals",
  rejected_final: "rejects the account's KYC for good, at once (one aml decision)",
  expired: "expires the account's KYC at once (one aml decision): the user must verify again",
};

export default function ComplianceKycOverridePanel() {
  const { ready } = useBackendOperator();
  const amlHint = useRoleHint("aml");
  const { busy, run } = useRampRun();
  const [form, setForm] = useState({ userId: "", status: "approved" as KycOverrideStatus, reason: "" });
  const [confirm, setConfirm] = useState(false);

  if (!ready) return null;
  const userId = form.userId.trim();
  const formReady = UUID_RE.test(userId) && form.reason.trim() !== "";

  const submit = async () => {
    const answer = await run("KYC override", () => overrideKyc(userId, { status: form.status, reason: form.reason.trim() }), kycOverrideSentence);
    setConfirm(false);
    if (answer) setForm({ userId: "", status: "approved", reason: "" });
  };

  return (
    <Card title="KYC override">
      <RoleNote role="aml" />
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr_2fr_auto] sm:items-end">
        <Field label="User account id">
          <input className={field} value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })} placeholder="uuid" />
        </Field>
        <Field label="Set KYC to">
          <select className={field} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as KycOverrideStatus })}>
            {KYC_OVERRIDE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Reason (audited)">
          <input className={field} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="documents checked by hand, ticket" />
        </Field>
        <button
          type="button"
          className={btn}
          disabled={busy !== null || !formReady || amlHint !== null}
          title={amlHint ?? (formReady ? undefined : "A valid user id and a reason first.")}
          onClick={() => setConfirm(true)}
        >
          {form.status === "approved" ? "Request approval…" : "Override…"}
        </button>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={(open) => {
          if (!open) setConfirm(false);
        }}
        title={`Set the KYC of account ${userId.slice(0, 8)} to ${form.status}?`}
        description={`This ${EFFECT[form.status]}. Reason: "${form.reason.trim()}".`}
        confirmLabel={form.status === "approved" ? "Request" : "Override"}
        destructive={form.status !== "approved"}
        busy={busy !== null}
        onConfirm={() => void submit()}
      />
    </Card>
  );
}
