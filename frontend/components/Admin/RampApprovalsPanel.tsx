/**
 * Four-eyes approvals (truthoracle-backend docs/RAMP.md §6.5): every money-moving request of the
 * console waits here for a second PERSON with the approver role. Approve is disabled for the
 * requester (who may withdraw their own request instead); a decision carries the wallet signature
 * of `truthoracle-approval:<id>:<params_hash>:<approve|reject>`, signed through the admin sign-in's
 * signMessage path as the first thing the confirm click does. Approve-many takes one action type;
 * with signatures on, each id is signed by its own click (one wallet popup per click), then one
 * request submits them all and each id is decided on its own.
 *
 * The approver decides on figures, not on the requester's words (review F2 / F8): every row and
 * every confirm shows what the request moves — for a ramp order action the figures its snapshot
 * recorded (amount, user, wallet, destination) with the order read as context, for a statement
 * confirm each booking with its line's figures, for a market resolution (`market.resolve`) its
 * choice, market, outcome and evidence, collateral and windows, else each parameter and snapshot
 * field — and the requester's reason sits apart as their claim. A ramp order action cannot be
 * approved until its order is read and agrees with the snapshot's figures (a disagreement, or a
 * snapshot without them, is shown on the row), a market resolution until every one of its figures
 * is on screen; approve-many lists every item and the total.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { approveManyApprovals, decideApproval, fetchAdminRampOrder, fetchApprovals } from "@/lib/backendAdmin";
import { MARKET_RESOLVE_ACTION, marketResolveView } from "@/lib/marketResolution";
import { approveBlocker, isExpired, isOwnRequest, rejectLabel } from "@/lib/rampAdmin";
import { RampAdminError, rampAdminErrorMessage } from "@/lib/rampAdminErrors";
import { approvalAmount, approvalFigures, approvalOrderId, approvalsTotal, marketResolveProblem, orderApprovalProblem } from "@/lib/rampApprovalFigures";
import type { ApiAdminRampOrder, ApiApproval, ApprovalStatus } from "@/lib/rampAdminTypes";
import { ConfirmDialog, fmtDateTime } from "@/components/Account/accountUi";
import { btn, btnDanger, btnQuiet, Card, field } from "./adminUi";
import { useBackendOperator } from "./BackendOperatorSession";
import { useRampAdmin } from "./RampAdminSession";
import { ApprovalLine, ErrorLine, Field, FigureList, JsonBlock, RequesterClaim, td, th, tableCls, theadCls, useDebounced, usePanelData, useRampRun } from "./RampAdminUi";
import RampOrderDetail from "./RampOrderDetail";

const STATUSES: (ApprovalStatus | "")[] = ["pending", "executed", "failed", "rejected", "cancelled", "expired", ""];
/** Decided where the extra input lives (the approver's own statement copy), not here. */
const DECIDED_ELSEWHERE: Record<string, string> = {
  "ramp.statement.confirm": "Approve under Bank → Statements: confirming needs your own copy of the statement.",
};

type Pending = { kind: "approve" | "reject"; approval: ApiApproval } | { kind: "many" } | null;

export default function RampApprovalsPanel() {
  const { ready } = useBackendOperator();
  const { session, operatorParty, signaturesRequired, signDecision } = useRampAdmin();
  const [filters, setFilters] = useState({ status: "pending" as ApprovalStatus | "", action: "", subjectId: "" });
  const [reason, setReason] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [signatures, setSignatures] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<Pending>(null);

  const applied = useDebounced(filters);
  const load = useCallback(
    () => fetchApprovals({ status: applied.status, action: applied.action.trim(), subjectId: applied.subjectId.trim() }).then((r) => r.items),
    [applied],
  );
  const { data, error, reload } = usePanelData(load, ready);
  const { busy, run } = useRampRun(reload);
  const rows = useMemo(() => data ?? [], [data]);
  // The orders behind ramp.order.* requests, re-read with every list load: their figures are what
  // the approver decides on (F2 / F8).
  const [orders, setOrders] = useState<Record<string, ApiAdminRampOrder | { error: string }>>({});
  const [shownOrder, setShownOrder] = useState<string | null>(null);
  useEffect(() => {
    const ids = [...new Set(rows.map(approvalOrderId).filter((x): x is string => x !== null))];
    if (ids.length === 0) return;
    let cancelled = false;
    void Promise.all(
      ids.map((id) =>
        fetchAdminRampOrder(id).then(
          (d): [string, ApiAdminRampOrder | { error: string }] => [id, d.order],
          (e: unknown): [string, ApiAdminRampOrder | { error: string }] => [id, { error: rampAdminErrorMessage(e) }],
        ),
      ),
    ).then((entries) => {
      if (!cancelled) setOrders(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [rows]);

  const chosen = rows.filter((a) => selected.includes(a.id));
  const manyAction = chosen[0]?.action ?? null;
  const unsigned = signaturesRequired ? chosen.filter((a) => !signatures[a.id]) : [];

  if (!ready) return null;

  const orderOf = (a: ApiApproval): ApiAdminRampOrder | null => {
    const id = approvalOrderId(a);
    const o = id ? orders[id] : undefined;
    return o && !("error" in o) ? o : null;
  };
  // A ramp order action is decided only once its order is read and agrees with the figures the
  // request recorded; a market resolution only with every figure of its request and snapshot
  // (choice, market, outcome, evidence, windows).
  const figuresBlocker = (a: ApiApproval): string | null => {
    if (a.action === MARKET_RESOLVE_ACTION) return marketResolveProblem(a);
    const id = approvalOrderId(a);
    if (!id) return null;
    const o = orders[id];
    if (!o) return "Reading the order's figures…";
    return "error" in o ? `The order's figures could not be read: ${o.error} Refresh before deciding.` : orderApprovalProblem(a, o);
  };
  const headline = (a: ApiApproval) =>
    approvalFigures(a, orderOf(a)).find((f) => f.strong)?.value ?? a.description ?? `${a.subjectType} ${a.subjectId}`;
  const manyBlocked = chosen.some((a) => figuresBlocker(a) !== null);

  const toggle = (a: ApiApproval) => {
    setSignatures((s) => {
      const next = { ...s };
      delete next[a.id];
      return next;
    });
    setSelected((ids) => (ids.includes(a.id) ? ids.filter((x) => x !== a.id) : [...ids, a.id]));
  };
  // Approve-many is one action type at a time; a row of another type cannot join the selection.
  const selectable = (a: ApiApproval) =>
    !DECIDED_ELSEWHERE[a.action] &&
    approveBlocker(a, session, operatorParty) === null &&
    figuresBlocker(a) === null &&
    (manyAction === null || a.action === manyAction);

  const decide = async (kind: "approve" | "reject", approval: ApiApproval) => {
    const what = kind === "approve" ? `Approve ${approval.action}` : `${rejectLabel(approval, session, operatorParty)} ${approval.action}`;
    // decideApproval signs first: the wallet popup is the first thing this click awaits.
    await run(what, () => decideApproval(approval, kind, reason.trim(), signDecision));
    setConfirm(null);
  };

  const signNext = async () => {
    const next = unsigned[0];
    if (!next) return;
    await run(
      `Sign approval ${next.id.slice(0, 8)}`,
      async () => {
        const signature = await signDecision(next, "approve");
        if (!signature) throw new RampAdminError("Signatures are off on this backend; nothing to sign.");
        setSignatures((s) => ({ ...s, [next.id]: signature }));
        return signature;
      },
      () => `Signed ${chosen.length - unsigned.length + 1} of ${chosen.length}.`,
    );
  };

  const approveMany = async () => {
    const ids = chosen.map((a) => a.id);
    const result = await run(
      `Approve ${ids.length} × ${manyAction}`,
      () => approveManyApprovals({ ids, reason: reason.trim(), ...(signaturesRequired ? { signatures: pickSignatures(signatures, ids) } : {}) }),
      (r) => {
        const failed = r.results.filter((x) => x.error);
        return failed.length === 0
          ? `Approved ${ids.length} × ${manyAction}.`
          : `Approved ${ids.length - failed.length} of ${ids.length}; refused: ${failed.map((x) => `${x.id.slice(0, 8)} (${x.error?.error})`).join(", ")}.`;
      },
    );
    setConfirm(null);
    if (result) {
      setSelected([]);
      setSignatures({});
    }
  };

  const reasonOk = reason.trim() !== "";

  return (
    <Card
      title="Approvals (four-eyes)"
      aside={
        <button type="button" className={btnQuiet} disabled={busy !== null} onClick={() => void reload().catch(() => undefined)}>
          Refresh
        </button>
      }
    >
      <ErrorLine error={error} />
      <div className="mb-3 grid gap-3 sm:grid-cols-[auto_1fr_1fr]">
        <Field label="Status">
          <select className={field} value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value as ApprovalStatus | "" })}>
            {STATUSES.map((s) => (
              <option key={s || "all"} value={s}>
                {s || "all"}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Action (exact, optional)">
          <input className={field} value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value })} placeholder="ramp.order.refund" />
        </Field>
        <Field label="Subject id (optional)">
          <input className={field} value={filters.subjectId} onChange={(e) => setFilters({ ...filters, subjectId: e.target.value })} placeholder="order / batch / alert / market id" />
        </Field>
      </div>
      <div className="mb-3">
        <Field label="Decision reason (kept on the approval and the audit row)">
          <input className={field} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="what you checked before deciding" />
        </Field>
        <p className="mt-1 text-[11px] text-slate-400">
          {signaturesRequired
            ? "Each decision is signed with your operator wallet (a message, not a transaction): one popup per click."
            : "This backend does not require signed decisions (dev)."}
        </p>
      </div>

      {selected.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
          <span>
            {chosen.length} × <code className="font-mono">{manyAction}</code> selected
            {signaturesRequired ? ` · signed ${chosen.length - unsigned.length} of ${chosen.length}` : ""}
          </span>
          {signaturesRequired && unsigned.length > 0 && (
            <button type="button" className={btnQuiet} disabled={busy !== null || manyBlocked} onClick={() => void signNext()}>
              Sign next ({chosen.length - unsigned.length + 1} of {chosen.length}): #{unsigned[0].id.slice(0, 8)} · {headline(unsigned[0])}
            </button>
          )}
          <button
            type="button"
            className={btn}
            disabled={busy !== null || !reasonOk || unsigned.length > 0 || manyBlocked}
            onClick={() => setConfirm({ kind: "many" })}
          >
            Approve {chosen.length} selected…
          </button>
          <button
            type="button"
            className={btnQuiet}
            onClick={() => {
              setSelected([]);
              setSignatures({});
            }}
          >
            Clear
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">{data === null ? "Loading…" : "No approvals match."}</p>
      ) : (
        <table className={tableCls}>
          <thead className={theadCls}>
            <tr>
              <th className={th}></th>
              <th className={th}>Request</th>
              <th className={th}>Requester&apos;s reason</th>
              <th className={th}></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((a) => {
              const blocker = approveBlocker(a, session, operatorParty);
              const elsewhere = DECIDED_ELSEWHERE[a.action];
              const own = isOwnRequest(a, session, operatorParty);
              const open = a.status === "pending" && !isExpired(a);
              const market = a.action === MARKET_RESOLVE_ACTION ? marketResolveView(a) : null;
              const marketRef = market ? (market.ticker ?? market.marketId) : null;
              const marketProblem = market && open ? marketResolveProblem(a) : null;
              const read = open ? orderOf(a) : null;
              const orderProblem = read ? orderApprovalProblem(a, read) : null;
              return (
                <tr key={a.id}>
                  <td className={td}>
                    {open && (
                      <input
                        type="checkbox"
                        aria-label={`Select approval ${a.id.slice(0, 8)}`}
                        checked={selected.includes(a.id)}
                        disabled={!selected.includes(a.id) && !selectable(a)}
                        onChange={() => toggle(a)}
                      />
                    )}
                  </td>
                  <td className={td}>
                    <ApprovalLine approval={a} />
                    <p className="mt-1 text-xs text-slate-700">
                      {a.description ?? `${a.subjectType} ${a.subjectId}`}
                      {a.description ? <span className="text-slate-400"> · {a.subjectType} {a.subjectId.slice(0, 8)}</span> : null}
                    </p>
                    {a.decidedAt && (
                      <p className="mt-1 text-[11px] text-slate-500">
                        decided by {a.decidedByPerson ?? a.decidedByParty ?? "?"} · {fmtDateTime(a.decidedAt)}
                        {a.decisionReason ? ` · "${a.decisionReason}"` : ""}
                      </p>
                    )}
                    <FigureList figures={approvalFigures(a, orderOf(a))} />
                    {marketProblem && <p className="mt-1 text-[11px] text-amber-700">{marketProblem}</p>}
                    {orderProblem && <p className="mt-1 text-[11px] text-amber-700">{orderProblem}</p>}
                    {approvalOrderId(a) && (
                      <button type="button" className={`${btnQuiet} mt-1`} onClick={() => setShownOrder(shownOrder === a.subjectId ? null : a.subjectId)}>
                        {shownOrder === a.subjectId ? "Hide the order" : "Open the order"}
                      </button>
                    )}
                    {marketRef && (
                      <Link className={`${btnQuiet} mt-1 inline-block`} to={`/markets/${encodeURIComponent(marketRef)}`} target="_blank" rel="noopener">
                        Open the market
                      </Link>
                    )}
                    <JsonBlock label="Raw request (params, precondition)" value={{ params: a.params, precondition: a.precondition }} />
                    <JsonBlock label="Result" value={a.result} />
                  </td>
                  <td className={`${td} max-w-[16rem] text-xs text-slate-700`}>{a.reason}</td>
                  <td className={`${td} whitespace-nowrap text-right`}>
                    {open && (
                      <div className="flex flex-col items-end gap-1">
                        {elsewhere ? (
                          <span className="max-w-[14rem] text-right text-[11px] text-slate-500">{elsewhere}</span>
                        ) : (
                          <button
                            type="button"
                            className={btn}
                            disabled={busy !== null || blocker !== null || figuresBlocker(a) !== null || !reasonOk}
                            title={blocker ?? figuresBlocker(a) ?? (reasonOk ? undefined : "Write the decision reason first.")}
                            onClick={() => setConfirm({ kind: "approve", approval: a })}
                          >
                            Approve…
                          </button>
                        )}
                        <button
                          type="button"
                          className={btnDanger}
                          disabled={busy !== null || !reasonOk}
                          title={reasonOk ? undefined : "Write the decision reason first."}
                          onClick={() => setConfirm({ kind: "reject", approval: a })}
                        >
                          {own ? "Withdraw…" : "Reject…"}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {shownOrder && (
        <div className="mt-4">
          <RampOrderDetail key={shownOrder} orderId={shownOrder} onClose={() => setShownOrder(null)} onChanged={() => void reload().catch(() => undefined)} />
        </div>
      )}

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={
          confirm?.kind === "many"
            ? `Approve ${chosen.length} × ${manyAction}?`
            : confirm
              ? `${confirm.kind === "approve" ? "Approve" : rejectLabel(confirm.approval, session, operatorParty)}: ${confirm.approval.action}?`
              : ""
        }
        description={
          confirm?.kind === "many" ? (
            <>
              <span className="block">
                Each of the {chosen.length} requests is re-validated with fresh reads and executed on its own; any that no longer holds is
                refused.
              </span>
              <span className="mt-2 block text-left text-xs">
                {chosen.map((a) => (
                  <span key={a.id} className="block">
                    #{a.id.slice(0, 8)} · {headline(a)}
                  </span>
                ))}
              </span>
              <span className="mt-2 block font-semibold text-slate-950">
                Total: {approvalsTotal(chosen.map((a) => approvalAmount(a, orderOf(a))))}
              </span>
              <span className="mt-2 block">Your reason: &quot;{reason.trim()}&quot;.</span>
            </>
          ) : confirm ? (
            <>
              <span className="block">{confirm.approval.description ?? `${confirm.approval.subjectType} ${confirm.approval.subjectId}`}.</span>
              <FigureList figures={approvalFigures(confirm.approval, orderOf(confirm.approval))} />
              <RequesterClaim approval={confirm.approval} />
              <span className="mt-2 block">
                {confirm.kind === "approve" ? "Approving executes it now, after fresh checks." : "The request ends here; nothing is executed."}
                {signaturesRequired ? " Your wallet asks you to sign the decision." : ""} Your reason: &quot;{reason.trim()}&quot;.
              </span>
            </>
          ) : (
            ""
          )
        }
        confirmLabel={confirm?.kind === "reject" ? rejectLabel(confirm.approval, session, operatorParty) : "Approve"}
        destructive={confirm?.kind === "reject"}
        busy={busy !== null}
        onConfirm={() => {
          if (!confirm) return;
          void (confirm.kind === "many" ? approveMany() : decide(confirm.kind, confirm.approval));
        }}
      />
    </Card>
  );
}

function pickSignatures(all: Record<string, string>, ids: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of ids) if (all[id]) out[id] = all[id];
  return out;
}
