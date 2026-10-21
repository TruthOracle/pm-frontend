/**
 * Bank payout batches (truthoracle-backend docs/RAMP.md §10.3): a draft from the queued bank
 * payouts and bank refunds, four-eyes approval (approver ≠ creator; a pre-batch reconciliation and
 * the payout gate run first), the bank file download (a POST: the first one is gated, every one is
 * audited, a re-download must hash the same), "submitted" with the bank's reference (orders become
 * payout_sent), cancel before export, and a four-eyes void after export when statements prove no
 * item was paid or the bank rejected the file.
 */
import { useCallback, useState } from "react";
import {
  cancelPayoutBatch,
  createPayoutBatch,
  exportPayoutBatch,
  fetchPayoutBatch,
  fetchPayoutBatches,
  markBatchSubmitted,
  requestBatchApproval,
  requestBatchVoid,
} from "@/lib/backendAdmin";
import { batchActions, fiatLabel } from "@/lib/rampAdmin";
import type { ApiPayoutBatch, BatchStatus } from "@/lib/rampAdminTypes";
import { ConfirmDialog, Pill, fmtDateTime } from "@/components/Account/accountUi";
import { btn, btnDanger, btnQuiet, Card, field } from "./adminUi";
import { useBackendOperator } from "./BackendOperatorSession";
import { ErrorLine, Field, Id, RoleNote, saveDownload, td, th, tableCls, theadCls, usePanelData, useRampRun, useRoleHint } from "./RampAdminUi";

type Act = "create" | "approve" | "export" | "submitted" | "cancel" | "void";

/** "3 held, 1 frozen": why a draft left queued orders out, grouped by the backend's reason. */
function skippedSummary(skipped: { orderId: string; reason: string }[]): string {
  const counts = new Map<string, number>();
  for (const s of skipped) counts.set(s.reason, (counts.get(s.reason) ?? 0) + 1);
  return [...counts].map(([reason, n]) => `${n} ${reason}`).join(", ");
}

const STATUS_TONE: Record<BatchStatus, "pending" | "ok" | "warn" | "neutral" | "info"> = {
  draft: "pending",
  approved: "info",
  exported: "warn",
  submitted: "info",
  settled: "ok",
  cancelled: "neutral",
  voided: "neutral",
};

export default function RampBatchesPanel() {
  const { ready } = useBackendOperator();
  const opsHint = useRoleHint("ops");
  const exportHint = useRoleHint("export");
  const [status, setStatus] = useState<BatchStatus | "">("");
  const load = useCallback(() => fetchPayoutBatches({ status }).then((r) => r.items), [status]);
  const { data, error, reload } = usePanelData(load, ready);
  const [selected, setSelected] = useState<string | null>(null);
  const loadItems = useCallback(() => (selected ? fetchPayoutBatch(selected) : Promise.resolve(null)), [selected]);
  const detail = usePanelData(loadItems, ready && selected !== null);
  const reloadBoth = useCallback(async () => {
    await reload();
    if (selected) await detail.reload();
  }, [reload, detail, selected]);
  const { busy, run } = useRampRun(reloadBoth);
  const [reason, setReason] = useState("");
  const [bankReference, setBankReference] = useState("");
  const [rejectionRef, setRejectionRef] = useState("");
  const [confirm, setConfirm] = useState<{ act: Act; batch: ApiPayoutBatch | null } | null>(null);

  if (!ready) return null;
  const rows = data ?? [];
  const batch = detail.data?.batch ?? null;
  const items = detail.data?.items ?? [];

  const go = async () => {
    if (!confirm) return;
    const { act, batch: b } = confirm;
    const r = reason.trim();
    if (act === "create") {
      const created = await run(
        "Create batch",
        () => createPayoutBatch({ reason: r }),
        (x) =>
          `Draft batch ${x.batch.id.slice(0, 8)}: ${x.batch.itemCount} items, ${fiatLabel(x.batch.totalAmount, x.batch.currency)}.${
            x.skipped.length ? ` Left out: ${x.skipped.length} (${skippedSummary(x.skipped)}).` : ""
          }`,
      );
      if (created) setSelected(created.batch.id);
    } else if (b && act === "approve") {
      await run("Batch approval", () => requestBatchApproval(b.id, { reason: r }));
    } else if (b && act === "export") {
      const file = await run("Bank file download", () => exportPayoutBatch(b.id), (f) => `Downloaded ${f.filename}.`);
      if (file) saveDownload(file);
    } else if (b && act === "submitted") {
      await run(
        "Batch submitted",
        () => markBatchSubmitted(b.id, { bankReference: bankReference.trim(), ...(r ? { reason: r } : {}) }),
        `Batch ${b.id.slice(0, 8)} submitted; its orders are payout_sent.`,
      );
    } else if (b && act === "cancel") {
      await run("Cancel batch", () => cancelPayoutBatch(b.id, { reason: r }), `Batch ${b.id.slice(0, 8)} cancelled; its orders are back in the queue.`);
    } else if (b && act === "void") {
      await run("Void batch", () => requestBatchVoid(b.id, { reason: r, ...(rejectionRef.trim() ? { bankRejectionRef: rejectionRef.trim() } : {}) }));
    }
    setConfirm(null);
  };

  const describe = (act: Act, b: ApiPayoutBatch | null): string => {
    const what = b ? `batch ${b.id.slice(0, 8)}: ${b.itemCount} item${b.itemCount === 1 ? "" : "s"}, ${fiatLabel(b.totalAmount, b.currency)}` : "";
    switch (act) {
      case "create":
        return `A draft from up to 500 of the oldest queued bank payouts and refunds not on hold. Reason: "${reason.trim()}".`;
      case "approve":
        return `Request approval of ${what}. A second person (not the creator) approves; the backend then runs a reconciliation and the payout gate. Reason: "${reason.trim()}".`;
      case "export":
        return `Download the bank file for ${what}. The first download needs the payout gate; a re-download must produce the same file. Send it to the bank unchanged.`;
      case "submitted":
        return `The bank accepted ${what} under reference "${bankReference.trim()}". Its orders become payout_sent and wait for the statement debits.${
          reason.trim() ? ` Note: "${reason.trim()}".` : ""
        }`;
      case "cancel":
        return `Cancel ${what} before export: its orders go back to the queue and the items are voided. Reason: "${reason.trim()}".`;
      case "void":
        return `Request voiding exported ${what}. Allowed only when confirmed statements cover the settle days with no debit for any item, or with the bank's rejection reference${
          rejectionRef.trim() ? ` ("${rejectionRef.trim()}")` : ""
        }. The orders go back to the queue. Reason: "${reason.trim()}".`;
    }
  };

  const button = (act: Act, label: string, b: ApiPayoutBatch, danger = false) => {
    const hint = act === "export" ? exportHint : opsHint;
    const needs = act === "submitted" ? !bankReference.trim() : act !== "export" && !reason.trim();
    return (
      <button
        key={act}
        type="button"
        className={`${danger ? btnDanger : act === "export" || act === "approve" ? btn : btnQuiet} ml-1`}
        disabled={busy !== null || hint !== null || needs}
        title={hint ?? (needs ? (act === "submitted" ? "Enter the bank's reference first." : "Write the reason first.") : undefined)}
        onClick={() => setConfirm({ act, batch: b })}
      >
        {label}
      </button>
    );
  };

  return (
    <Card
      title="Bank payout batches"
      aside={
        <div className="flex gap-2">
          <button type="button" className={btnQuiet} disabled={busy !== null} onClick={() => void reload().catch(() => undefined)}>
            Refresh
          </button>
          <button
            type="button"
            className={btn}
            disabled={busy !== null || opsHint !== null || !reason.trim()}
            title={opsHint ?? (reason.trim() ? undefined : "Write the reason first.")}
            onClick={() => setConfirm({ act: "create", batch: null })}
          >
            New draft…
          </button>
        </div>
      }
    >
      <ErrorLine error={error} />
      <RoleNote role="ops" />
      <div className="mb-3 grid gap-3 sm:grid-cols-4">
        <Field label="Status">
          <select className={field} value={status} onChange={(e) => setStatus(e.target.value as BatchStatus | "")}>
            {(["", "draft", "approved", "exported", "submitted", "settled", "cancelled", "voided"] as const).map((s) => (
              <option key={s || "all"} value={s}>
                {s || "all"}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Reason (audited)">
          <input className={field} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="ticket id / what was checked" />
        </Field>
        <Field label="Bank reference (for submitted)">
          <input className={field} value={bankReference} onChange={(e) => setBankReference(e.target.value)} placeholder="the bank's file / packet id" />
        </Field>
        <Field label="Bank rejection ref (void, optional)">
          <input className={field} value={rejectionRef} onChange={(e) => setRejectionRef(e.target.value)} placeholder="when the bank refused the file" />
        </Field>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">{data === null ? "Loading…" : "No batches."}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className={tableCls}>
            <thead className={theadCls}>
              <tr>
                <th className={th}>Batch</th>
                <th className={th}>Status</th>
                <th className={`${th} text-right`}>Items / total</th>
                <th className={th}>Exported / submitted</th>
                <th className={th}></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((b) => {
                const can = batchActions(b.status);
                return (
                  <tr key={b.id} className={selected === b.id ? "bg-sky-50" : undefined}>
                    <td className={td}>
                      <button type="button" className="text-left" onClick={() => setSelected(selected === b.id ? null : b.id)}>
                        <Id value={b.id} />
                        <div className="text-[11px] text-slate-400">{fmtDateTime(b.createdAt)}</div>
                      </button>
                    </td>
                    <td className={td}>
                      <Pill tone={STATUS_TONE[b.status]}>{b.status}</Pill>
                    </td>
                    <td className={`${td} text-right tabular-nums`}>
                      {b.itemCount} · {fiatLabel(b.totalAmount, b.currency)}
                    </td>
                    <td className={`${td} text-xs`}>
                      {b.exportedAt ? fmtDateTime(b.exportedAt) : "—"}
                      {b.submittedAt ? ` · ${fmtDateTime(b.submittedAt)}` : ""}
                      {b.bankReference ? <div className="font-mono text-[11px] text-slate-500">{b.bankReference}</div> : null}
                      {b.fileSha256 ? <div className="font-mono text-[11px] text-slate-400" title={b.fileSha256}>sha256 {b.fileSha256.slice(0, 12)}…</div> : null}
                    </td>
                    <td className={`${td} whitespace-nowrap text-right`}>
                      {can.approve && button("approve", "Request approval…", b)}
                      {can.export && button("export", b.status === "exported" ? "Download again…" : "Download file…", b)}
                      {can.submitted && button("submitted", "Submitted…", b)}
                      {can.cancel && button("cancel", "Cancel…", b, true)}
                      {can.void && button("void", "Void…", b, true)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <div className="mt-4 rounded-md border border-slate-200 px-3 py-3">
          <p className="mb-2 text-xs font-semibold text-slate-700">
            Batch {selected.slice(0, 8)} items{batch ? ` (${batch.status})` : ""}
          </p>
          <ErrorLine error={detail.error} />
          {items.length === 0 ? (
            <p className="text-xs text-slate-500">{detail.data === null ? "Loading…" : "No items."}</p>
          ) : (
            <table className={`${tableCls} text-xs`}>
              <thead className={theadCls}>
                <tr>
                  <th className={th}>Doc no</th>
                  <th className={th}>Order / user</th>
                  <th className={th}>Kind</th>
                  <th className={th}>Reference</th>
                  <th className={th}>Account</th>
                  <th className={`${th} text-right`}>Amount</th>
                  <th className={th}>Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((it) => (
                  <tr key={it.orderId}>
                    <td className={`${td} font-mono`}>{it.documentNo}</td>
                    <td className={td}>
                      <Id value={it.orderId} />
                      <div>
                        <Id value={it.userId} />
                      </div>
                    </td>
                    <td className={td}>{it.kind}</td>
                    <td className={`${td} font-mono`}>{it.payoutReference}</td>
                    <td className={td}>
                      <span className="font-mono">{it.ibanMasked ?? "—"}</span>
                      {it.bankName ? <div className="text-[11px] text-slate-500">{it.bankName}</div> : null}
                    </td>
                    <td className={`${td} text-right tabular-nums`}>{fiatLabel(it.amount, batch?.currency ?? "BYN")}</td>
                    <td className={td}>
                      {it.status}
                      {it.paidLineId ? <div className="text-[11px] text-slate-400">paid by a statement line</div> : null}
                      {it.returnedLineId ? <div className="text-[11px] text-amber-700">returned by the bank</div> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={
          confirm
            ? {
                create: "Create a draft batch?",
                approve: "Request batch approval?",
                export: "Download the bank file?",
                submitted: "Mark the batch submitted?",
                cancel: "Cancel the batch?",
                void: "Request voiding the batch?",
              }[confirm.act]
            : ""
        }
        description={confirm ? describe(confirm.act, confirm.batch) : ""}
        confirmLabel={confirm?.act === "export" ? "Download" : confirm?.act === "approve" || confirm?.act === "void" ? "Request" : "Confirm"}
        destructive={confirm?.act === "cancel" || confirm?.act === "void"}
        busy={busy !== null}
        onConfirm={() => void go()}
      />
    </Card>
  );
}
