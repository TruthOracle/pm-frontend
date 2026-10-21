/**
 * Freezes (truthoracle-backend docs/RAMP.md §11.6): an `aml` operator freezes a user at once — no
 * fiat leaves them (refunds, payouts, batches, bank refunds), captured money waits in review, plain
 * withdrawals and every server-prepared value movement are refused — and lifting a freeze is
 * four-eyes. Screening hits freeze provisionally on their own; those are decided under Screening.
 */
import { useCallback, useState } from "react";
import { createFreeze, fetchFreezes, requestFreezeLift } from "@/lib/backendAdmin";
import { FREEZE_SOURCES, type ApiComplianceFreeze, type FreezeSource } from "@/lib/rampAdminTypes";
import { ConfirmDialog, Pill, fmtDateTime } from "@/components/Account/accountUi";
import { btnDanger, btnQuiet, Card, field } from "./adminUi";
import { useBackendOperator } from "./BackendOperatorSession";
import { ErrorLine, Field, Id, RoleNote, td, th, tableCls, theadCls, usePanelData, useRampRun, useRoleHint } from "./RampAdminUi";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function ComplianceFreezesPanel() {
  const { ready } = useBackendOperator();
  const amlHint = useRoleHint("aml");
  const [showLifted, setShowLifted] = useState(false);
  const load = useCallback(() => fetchFreezes(showLifted ? {} : { active: true }).then((r) => r.items), [showLifted]);
  const { data, error, reload } = usePanelData(load, ready);
  const { busy, run } = useRampRun(reload);
  const [form, setForm] = useState({ userId: "", source: "manual" as FreezeSource, reason: "" });
  const [liftReason, setLiftReason] = useState("");
  const [confirm, setConfirm] = useState<"freeze" | ApiComplianceFreeze | null>(null);

  if (!ready) return null;
  const freezeReady = UUID_RE.test(form.userId.trim()) && form.reason.trim() !== "";

  const freeze = async () => {
    const ok = await run(
      "Freeze",
      () => createFreeze({ userId: form.userId.trim(), source: form.source, reason: form.reason.trim() }),
      (r) => `User ${r.freeze.userId.slice(0, 8)} frozen.`,
    );
    setConfirm(null);
    if (ok) setForm({ userId: "", source: "manual", reason: "" });
  };

  const lift = async (f: ApiComplianceFreeze) => {
    await run("Freeze lift", () => requestFreezeLift(f.id, { reason: liftReason.trim() }));
    setConfirm(null);
  };

  return (
    <Card
      title="Freezes"
      aside={
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-slate-600">
            <input type="checkbox" checked={showLifted} onChange={(e) => setShowLifted(e.target.checked)} /> lifted too
          </label>
          <button type="button" className={btnQuiet} disabled={busy !== null} onClick={() => void reload().catch(() => undefined)}>
            Refresh
          </button>
        </div>
      }
    >
      <ErrorLine error={error} />
      <RoleNote role="aml" />
      <div className="mb-4 grid gap-3 rounded-md border border-slate-200 px-3 py-3 sm:grid-cols-[2fr_1fr_2fr_auto] sm:items-end">
        <Field label="User account id">
          <input className={field} value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })} placeholder="uuid" />
        </Field>
        <Field label="Source">
          <select className={field} value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value as FreezeSource })}>
            {FREEZE_SOURCES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Reason (kept with the freeze)">
          <input className={field} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="order / letter / alert reference" />
        </Field>
        <button
          type="button"
          className={btnDanger}
          disabled={busy !== null || !freezeReady || amlHint !== null}
          title={amlHint ?? (freezeReady ? undefined : "A user account id (uuid) and a reason.")}
          onClick={() => setConfirm("freeze")}
        >
          Freeze…
        </button>
      </div>

      <div className="mb-3 max-w-md">
        <Field label="Lift reason (four-eyes)">
          <input className={field} value={liftReason} onChange={(e) => setLiftReason(e.target.value)} placeholder="why the freeze can end" />
        </Field>
      </div>
      {(data ?? []).length === 0 ? (
        <p className="text-sm text-slate-500">{data === null ? "Loading…" : "No freezes."}</p>
      ) : (
        <table className={tableCls}>
          <thead className={theadCls}>
            <tr>
              <th className={th}>User</th>
              <th className={th}>Source</th>
              <th className={th}>Reason</th>
              <th className={th}>Since (UTC)</th>
              <th className={th}></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(data ?? []).map((f) => (
              <tr key={f.id}>
                <td className={td}>
                  <Id value={f.userId} />
                </td>
                <td className={td}>
                  <Pill tone={f.active ? "bad" : "neutral"}>{f.active ? (f.provisional ? `${f.source} · provisional` : f.source) : "lifted"}</Pill>
                </td>
                <td className={`${td} max-w-[18rem] text-xs`}>
                  {f.reason}
                  {f.liftReason ? <div className="text-[11px] text-slate-500">lifted: {f.liftReason}</div> : null}
                </td>
                <td className={`${td} whitespace-nowrap text-xs`}>
                  {fmtDateTime(f.createdAt)}
                  <div className="text-slate-400">{f.createdByPerson ? `by ${f.createdByPerson}` : f.createdByUserId ? "by an operator" : "by screening"}</div>
                  {f.liftedAt ? <div className="text-slate-400">lifted {fmtDateTime(f.liftedAt)}</div> : null}
                </td>
                <td className={`${td} whitespace-nowrap text-right`}>
                  {f.active && (
                    // A repeated request answers the pending one; the backend refuses a lift while a freezing-list hit is open.
                    <button
                      type="button"
                      className={btnQuiet}
                      disabled={busy !== null || !liftReason.trim() || amlHint !== null}
                      title={amlHint ?? (liftReason.trim() ? undefined : "Write the lift reason first.")}
                      onClick={() => setConfirm(f)}
                    >
                      Request lift…
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={confirm === "freeze" ? `Freeze user ${form.userId.trim().slice(0, 8)}?` : "Request lifting the freeze?"}
        description={
          confirm === "freeze"
            ? `Immediate: no fiat leaves this user, captured money waits in review, withdrawals and server-prepared value movements are refused. Lifting needs a second person. Source ${form.source}; reason "${form.reason.trim()}".`
            : confirm
              ? `User ${confirm.userId.slice(0, 8)} (${confirm.source}${confirm.provisional ? ", provisional" : ""}) can move value again once a second person with the approver role approves. Open list hits must be decided first. Reason: "${liftReason.trim()}".`
              : ""
        }
        confirmLabel={confirm === "freeze" ? "Freeze" : "Request"}
        destructive={confirm === "freeze"}
        busy={busy !== null}
        onConfirm={() => {
          if (confirm === "freeze") void freeze();
          else if (confirm) void lift(confirm);
        }}
      />
    </Card>
  );
}
