/**
 * One ramp order for the operator (truthoracle-backend docs/RAMP.md §4.2, §12.2): its facts, the
 * §4.2 actions it offers, and everything that touched it — approvals, token commands, journal,
 * webhook events, audit, compliance decisions (`order.risk`) and the order's compliance alerts
 * (`GET /admin/compliance/alerts?orderId=`). Every action needs a reason and is confirmed with
 * the exact figure it moves; the backend answers with the approval it created (pending a second
 * person) or executed (single control), and the approval shows up in the list below.
 */
import { useCallback, useState } from "react";
import { fetchAdminRampOrder, fetchComplianceAlerts, requestPaymentMethodUnblock, requestRampOrderAction } from "@/lib/backendAdmin";
import { exactMoney, fiatLabel, rampActionFigure, rampEventState, rampOrderActions, rampStatusTone, type RampActionInfo } from "@/lib/rampAdmin";
import type { ApiApproval } from "@/lib/rampAdminTypes";
import { ConfirmDialog, Pill, fmtDateTime } from "@/components/Account/accountUi";
import { btn, btnDanger, btnQuiet, Card, field } from "./adminUi";
import { useBackendOperator } from "./BackendOperatorSession";
import { ApprovalLine, ErrorLine, Field, Id, JsonBlock, RoleNote, td, th, tableCls, theadCls, usePanelData, useRampRun, useRoleHint } from "./RampAdminUi";

export default function RampOrderDetail({ orderId, onClose, onChanged }: { orderId: string; onClose: () => void; onChanged: () => void }) {
  const { ready } = useBackendOperator();
  const opsHint = useRoleHint("ops");
  const load = useCallback(() => fetchAdminRampOrder(orderId), [orderId]);
  const { data, error, reload } = usePanelData(load, ready);
  const loadAlerts = useCallback(() => fetchComplianceAlerts({ orderId }).then((r) => r.items), [orderId]);
  const alerts = usePanelData(loadAlerts, ready);
  const reloadAll = useCallback(async () => {
    await reload();
    onChanged();
  }, [reload, onChanged]);
  const { busy, run } = useRampRun(reloadAll);
  const [reason, setReason] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [then, setThen] = useState<"requeue" | "reverse">("requeue");
  const [confirm, setConfirm] = useState<RampActionInfo | "unblock" | null>(null);
  // What the last request created, shown even when the detail payload carries no approvals list.
  const [lastApproval, setLastApproval] = useState<ApiApproval | null>(null);

  if (!ready) return null;
  const order = data?.order ?? null;
  const actions = order ? rampOrderActions(order) : [];
  // The on-ramp's funding card, or a card cash-out's destination: `ramp.payment_method.unblock` (blocked cards only).
  const paymentMethodId = order?.paymentMethodId ?? null;
  const cardWord = order?.direction === "offramp" ? "destination card" : "funding card";

  const paramsMissing = (info: RampActionInfo) =>
    (info.params === "bankAccount" && !bankAccountId.trim()) || (info.params === "then" && order?.direction === "onramp" && then === "reverse");

  const submit = async (info: RampActionInfo) => {
    if (!order) return;
    const outcome = await run(info.label, () =>
      requestRampOrderAction(order.id, info.action, {
        reason: reason.trim(),
        ...(info.params === "bankAccount" ? { bankAccountId: bankAccountId.trim() } : {}),
        ...(info.params === "then" ? { then } : {}),
      }),
    );
    setConfirm(null);
    if (outcome) setLastApproval(outcome.approval);
  };

  const unblock = async () => {
    if (!paymentMethodId) return;
    const outcome = await run(`Unblock the ${cardWord}`, () => requestPaymentMethodUnblock(paymentMethodId, { reason: reason.trim() }));
    setConfirm(null);
    if (outcome) setLastApproval(outcome.approval);
  };

  const fact = (label: string, value: React.ReactNode) => (
    <div>
      <dt className="text-[11px] font-semibold uppercase text-slate-400">{label}</dt>
      <dd className="text-xs text-slate-800">{value ?? "—"}</dd>
    </div>
  );

  return (
    <Card
      title={`Order ${orderId.slice(0, 8)}`}
      aside={
        <div className="flex gap-2">
          <button type="button" className={btnQuiet} disabled={busy !== null} onClick={() => void reload().catch(() => undefined)}>
            Refresh
          </button>
          <button type="button" className={btnQuiet} onClick={onClose}>
            Close
          </button>
        </div>
      }
    >
      <ErrorLine error={error} />
      {!order ? (
        <p className="text-sm text-slate-500">{error ? "" : "Loading…"}</p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Pill tone={rampStatusTone(order.status)}>{order.status}</Pill>
            {order.reviewStep && <Pill tone="warn">review: {order.reviewStep}</Pill>}
            {typeof order.details.hold === "object" && order.details.hold !== null && <Pill tone="warn">hold: {String((order.details.hold as { reason?: unknown }).reason ?? "")}</Pill>}
            <span className="text-xs text-slate-500">
              {order.direction === "onramp" ? "Buy" : "Cash-out"} · {order.method ?? order.rail ?? "—"} · v{order.version ?? "?"}
            </span>
          </div>
          {order.details.reviewReason !== undefined && (
            <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              In review from <strong>{String(order.details.reviewFrom ?? "?")}</strong>: {String(order.details.reviewReason)}
            </p>
          )}
          <dl className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {fact("Fiat", fiatLabel(order.fiatAmount, order.fiatCurrency))}
            {fact("Token", exactMoney(order.tokenAmount, order.instrument.decimals, order.instrument.symbol))}
            {fact("Fee", fiatLabel(order.feeAmount, order.fiatCurrency))}
            {fact("Captured / refunded", order.capturedAmount ? `${fiatLabel(order.capturedAmount, order.fiatCurrency)} / ${fiatLabel(order.refundedAmount ?? "0", order.fiatCurrency)}` : "—")}
            {fact("Reference", order.payoutReference ? <code className="font-mono">{order.payoutReference}</code> : "—")}
            {fact("User", <Id value={order.userId} />)}
            {fact("Party", <Id value={order.partyId} />)}
            {fact("Provider", `${order.provider} · ${order.providerPaymentId ?? order.providerPayoutId ?? "—"}`)}
            {fact("Mint / burn command", <span><Id value={order.mintCommandId ?? null} /> / <Id value={order.burnCommandId ?? null} /></span>)}
            {fact("Re-mint command", <Id value={order.remintCommandId ?? null} />)}
            {fact("Bank account / batch", <span><Id value={order.bankAccountId ?? null} /> / <Id value={order.payoutBatchId ?? null} /></span>)}
            {fact("Attempts", order.attempts ?? "—")}
            {fact("Created", fmtDateTime(order.createdAt))}
            {fact("Updated", fmtDateTime(order.updatedAt))}
            {fact("Completed", fmtDateTime(order.completedAt))}
            {fact("Last error", order.lastError ? <span className="text-red-700">{order.lastError}</span> : "—")}
          </dl>

          <div className="mb-4 rounded-md border border-slate-200 px-3 py-3">
            <p className="mb-2 text-xs font-semibold text-slate-700">Actions (§4.2; money moves need a second person)</p>
            <RoleNote role="ops" />
            {actions.length === 0 && !paymentMethodId ? (
              <p className="text-xs text-slate-500">No operator action applies in this status.</p>
            ) : (
              <>
                <div className="mb-3 grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
                  <Field label="Reason (kept on the approval and the audit row)">
                    <input className={field} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="what you verified, ticket id" />
                  </Field>
                  {actions.some((a) => a.params === "bankAccount") && (
                    <Field label="Bank account id (refund by bank)">
                      <input className={field} value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)} placeholder="the user's active, proved account" />
                    </Field>
                  )}
                  {actions.some((a) => a.params === "then") && (
                    <Field label="Bank unpaid, then">
                      <select className={field} value={then} onChange={(e) => setThen(e.target.value as "requeue" | "reverse")}>
                        <option value="requeue">re-queue for the next batch</option>
                        {order.direction === "offramp" && <option value="reverse">reverse (re-mint, credit back)</option>}
                      </select>
                    </Field>
                  )}
                </div>
                <ul className="space-y-2">
                  {actions.map((info) => (
                    <li key={info.action} className="flex flex-wrap items-start justify-between gap-2">
                      <div className="max-w-xl">
                        <p className="text-sm font-semibold text-slate-900">{info.label}</p>
                        <p className="text-[11px] text-slate-500">{info.when}</p>
                      </div>
                      <button
                        type="button"
                        className={info.destructive ? btnDanger : btn}
                        disabled={busy !== null || !reason.trim() || paramsMissing(info) || opsHint !== null}
                        title={opsHint ?? (!reason.trim() ? "Write the reason first." : undefined)}
                        onClick={() => setConfirm(info)}
                      >
                        Request…
                      </button>
                    </li>
                  ))}
                  {paymentMethodId && (
                    <li className="flex flex-wrap items-start justify-between gap-2">
                      <div className="max-w-xl">
                        <p className="text-sm font-semibold text-slate-900">Unblock the {cardWord}</p>
                        <p className="text-[11px] text-slate-500">
                          Four-eyes `ramp.payment_method.unblock` for a blocked card, e.g. after a dispute was won; its cash-out eligibility is recomputed.
                        </p>
                      </div>
                      <button type="button" className={btnQuiet} disabled={busy !== null || !reason.trim() || opsHint !== null} onClick={() => setConfirm("unblock")}>
                        Request…
                      </button>
                    </li>
                  )}
                </ul>
              </>
            )}
            {lastApproval && (
              <div className="mt-3 rounded-md bg-slate-50 px-2 py-2">
                <p className="mb-1 text-[11px] font-semibold text-slate-600">Your last request</p>
                <ApprovalLine approval={lastApproval} />
              </div>
            )}
          </div>

          <Section title={`Approvals (${data?.approvals?.length ?? 0})`}>
            {(data?.approvals ?? []).length === 0 ? (
              <p className="text-xs text-slate-500">None yet.</p>
            ) : (
              <ul className="space-y-1">
                {(data?.approvals ?? []).map((a) => (
                  <li key={a.id}>
                    <ApprovalLine approval={a} />
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title={`Token commands (${data?.tokenCommands?.length ?? 0})`}>
            <SmallTable
              head={["Command", "Kind", "Amount", "Status", "Attempts", "Last POST", "Error"]}
              rows={(data?.tokenCommands ?? []).map((c) => [
                <Id key="c" value={c.commandId} />,
                c.kind,
                c.amount,
                c.status,
                String(c.attempts),
                fmtDateTime(c.lastPostAt),
                c.lastError ?? "",
              ])}
            />
          </Section>

          <Section title={`Journal (${data?.journal?.length ?? 0})`}>
            <SmallTable
              head={["Kind", "Account", "Amount (+debit −credit)", "At"]}
              rows={(data?.journal ?? []).map((j) => [j.kind, j.account, exactMoney(j.amount, 2, j.currency), fmtDateTime(j.createdAt)])}
            />
          </Section>

          <Section title={`Webhook events (${data?.events?.length ?? 0})`}>
            <SmallTable
              head={["Type", "Received", "Processed", "Attempts", "Error"]}
              rows={(data?.events ?? []).map((ev) => [
                ev.type,
                fmtDateTime(ev.receivedAt),
                ev.deadAt ? `dead ${fmtDateTime(ev.deadAt)}` : fmtDateTime(ev.processedAt),
                String(ev.attempts),
                ev.error ?? "",
              ])}
            />
            {(data?.events ?? []).some((ev) => rampEventState(ev) !== "processed") && (
              <p className="mt-1 text-[11px] text-slate-400">An unapplied event is replayed or closed under Webhook events.</p>
            )}
          </Section>

          <Section title={`Audit (${data?.audit?.length ?? 0})`}>
            <SmallTable
              head={["Action", "Actor", "At"]}
              rows={(data?.audit ?? []).map((a) => [a.action, `${a.actorType}${a.actorUserId ? ` ${a.actorUserId.slice(0, 8)}` : ""}`, fmtDateTime(a.createdAt)])}
            />
          </Section>

          <Section title={`Compliance alerts (${alerts.data?.length ?? 0})`}>
            {alerts.error ? (
              <p className="text-xs text-red-700">{alerts.error}</p>
            ) : (
              <SmallTable
                head={["Rule", "Severity", "Point", "Status", "Due (UTC)"]}
                rows={(alerts.data ?? []).map((a) => [a.rule, a.severity, a.point ?? "—", a.status, fmtDateTime(a.dueAt)])}
              />
            )}
            <p className="mt-1 text-[11px] text-slate-400">Decided under Compliance → alerts.</p>
          </Section>

          <JsonBlock label="Compliance decisions (by point)" value={order.risk} />
          <JsonBlock label="Details (raw)" value={order.details} />

          <ConfirmDialog
            open={confirm !== null}
            onOpenChange={(open) => {
              if (!open) setConfirm(null);
            }}
            title={confirm === "unblock" ? `Request unblocking the ${cardWord}?` : confirm ? `Request: ${confirm.label}?` : ""}
            description={
              confirm === "unblock"
                ? `The ${cardWord} of order ${order.id.slice(0, 8)} can be used again once a second person approves (the backend refuses a card that is not blocked). Reason: "${reason.trim()}".`
                : confirm
                  ? `${rampActionFigure(confirm.action, order, { then, bankAccountId })} Order ${order.id.slice(0, 8)} (${order.payoutReference ?? "no reference"}). The backend re-checks "${confirm.when}" with fresh reads when it executes. Reason: "${reason.trim()}".`
                  : ""
            }
            confirmLabel="Request"
            destructive={confirm !== "unblock" && confirm?.destructive === true}
            busy={busy !== null}
            onConfirm={() => {
              if (confirm === "unblock") void unblock();
              else if (confirm) void submit(confirm);
            }}
          />
        </>
      )}
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="mb-3" open={title.startsWith("Approvals")}>
      <summary className="cursor-pointer text-xs font-semibold text-slate-700">{title}</summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

function SmallTable({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  if (rows.length === 0) return <p className="text-xs text-slate-500">None.</p>;
  return (
    <div className="overflow-x-auto">
      <table className={`${tableCls} text-xs`}>
        <thead className={theadCls}>
          <tr>
            {head.map((h) => (
              <th key={h} className={th}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((cells, i) => (
            <tr key={i}>
              {cells.map((cell, j) => (
                <td key={j} className={`${td} break-all`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
