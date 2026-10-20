/**
 * Compliance alerts (truthoracle-backend docs/RAMP.md §11.4–§11.6): what the monitoring rules
 * raised, undecided ones first by their legal due date (a refusal or freeze: end of the same
 * business day; a suspicious operation: the next one), with the AML decision — clear (releases the
 * held value), escalate or report (with the special-form number; the hold stays), or return (C25:
 * the held payment goes back, never minted or paid out). A review-severity decision is single
 * control with the `aml` role; a block-severity one is four-eyes. With signatures on, a
 * single-control clear or return is signed (C23): the first click asks, the backend answers with
 * the exact message, and a second click opens the wallet and decides. A TM-PRINCIPAL / TM-PEP
 * alert's declaration opens on demand (an audited read). CSV export of up to 31 days.
 */
import { useCallback, useMemo, useState } from "react";
import {
  alertDecisionRequest,
  decideComplianceAlert,
  exportComplianceAlerts,
  fetchAlertDeclaration,
  fetchComplianceAlerts,
} from "@/lib/backendAdmin";
import {
  alertDecisionBlocker,
  alertDecisions,
  alertDueState,
  alertHasDeclaration,
  alertStatusTone,
  declarationLines,
  exportRange,
  isSignatureStep,
  sendDecisionSigned,
  sendDecisionUnsigned,
  sortAlertsByDue,
} from "@/lib/rampAdmin";
import { RampAdminError } from "@/lib/rampAdminErrors";
import { ALERT_STATUSES, type AlertDecision, type AlertStatus, type ApiComplianceAlert, type ApiConsentDeclaration } from "@/lib/rampAdminTypes";
import { ConfirmDialog, Pill, fmtDateTime } from "@/components/Account/accountUi";
import { btn, btnQuiet, Card, field } from "./adminUi";
import { useBackendOperator } from "./BackendOperatorSession";
import { useRampAdmin } from "./RampAdminSession";
import { ErrorLine, Field, Id, JsonBlock, RoleNote, saveDownload, td, th, tableCls, theadCls, useDebounced, usePanelData, useRampRun, useRoleHint } from "./RampAdminUi";

const DUE_TONE = { overdue: "bad", soon: "warn", ok: "neutral", none: "neutral" } as const;
const DECISION_TEXT: Record<AlertDecision, string> = {
  clear: "clears it: a held order resumes where it stopped",
  escalate: "escalates it: the hold stays",
  report: "records the special-form report: the hold stays until cleared or frozen",
  return: "returns the held payment: the order goes to refund review and is never minted or paid out",
};

type DecideBody = { decision: AlertDecision; reason: string; reportRef?: string };

export default function ComplianceAlertsPanel() {
  const { ready } = useBackendOperator();
  const amlHint = useRoleHint("aml");
  const [filters, setFilters] = useState({ status: "open" as AlertStatus | "", rule: "", userId: "", due: "" as "overdue" | "soon" | "" });
  const applied = useDebounced(filters);
  const load = useCallback(
    () =>
      fetchComplianceAlerts({ status: applied.status, rule: applied.rule.trim(), userId: applied.userId.trim(), due: applied.due }).then(
        (r) => r.items,
      ),
    [applied],
  );
  const { data, error, reload } = usePanelData(load, ready);
  const { busy, run } = useRampRun(reload);
  const rows = useMemo(() => sortAlertsByDue(data ?? []), [data]);
  const [decision, setDecision] = useState<AlertDecision>("clear");
  const [reportRef, setReportRef] = useState("");
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState<ApiComplianceAlert | "export" | null>(null);
  const [range, setRange] = useState({ from: "", to: "", status: "" as AlertStatus | "" });
  const { signRequest } = useRampAdmin();
  // C23: the backend asked for the officer's signature over this exact request (nothing saved yet).
  const [signing, setSigning] = useState<{ alertId: string; message: string; body: DecideBody } | null>(null);
  const [declarations, setDeclarations] = useState<Record<string, ApiConsentDeclaration>>({});

  if (!ready) return null;
  const decisionReady = reason.trim() !== "" && (decision !== "report" || reportRef.trim() !== "");
  const exportWindow = exportRange(range.from, range.to);
  const closeDialog = () => {
    setConfirm(null);
    setSigning(null);
  };

  const decide = async (alert: ApiComplianceAlert) => {
    const what = `Alert ${alert.rule}: ${signing?.body.decision ?? decision}`;
    if (signing && signing.alertId === alert.id) {
      // The second click: the wallet popup is the first thing it awaits, then the same request goes out signed.
      const signed = signing;
      await run(what, () =>
        sendDecisionSigned((signature) => decideComplianceAlert(alert.id, { ...signed.body, ...(signature ? { signature } : {}) }), signed.message, signRequest),
      );
      closeDialog();
      return;
    }
    const body: DecideBody = { decision, reason: reason.trim(), ...(decision === "report" ? { reportRef: reportRef.trim() } : {}) };
    const result = await run(what, () =>
      sendDecisionUnsigned(
        (signature) => decideComplianceAlert(alert.id, { ...body, ...(signature ? { signature } : {}) }),
        alertDecisionRequest(alert.id, body.decision, body.reportRef),
      ),
    );
    if (isSignatureStep(result)) setSigning({ alertId: alert.id, message: result.signatureMessage, body });
    else closeDialog();
  };

  /** The audited declaration read, on demand only; kept in this view, never stored. */
  const openDeclaration = async (alert: ApiComplianceAlert) => {
    const d = await run("Declaration", () => fetchAlertDeclaration(alert.id), "Declaration opened (the read is audited).");
    if (d) setDeclarations((all) => ({ ...all, [alert.id]: d }));
  };

  const doExport = async () => {
    const file = await run(
      "Alerts export",
      async () => {
        if ("problem" in exportWindow) throw new RampAdminError(exportWindow.problem);
        return exportComplianceAlerts({ ...exportWindow, ...(range.status ? { status: range.status } : {}) });
      },
      (f) => `Downloaded ${f.filename}.`,
    );
    setConfirm(null);
    if (file) saveDownload(file);
  };

  return (
    <Card
      title="Compliance alerts"
      aside={
        <button type="button" className={btnQuiet} disabled={busy !== null} onClick={() => void reload().catch(() => undefined)}>
          Refresh
        </button>
      }
    >
      <ErrorLine error={error} />
      <RoleNote role="aml" />
      <div className="mb-3 grid gap-3 sm:grid-cols-4">
        <Field label="Status">
          <select className={field} value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value as AlertStatus | "" })}>
            {[...ALERT_STATUSES, ""].map((s) => (
              <option key={s || "all"} value={s}>
                {s || "all"}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Due">
          <select className={field} value={filters.due} onChange={(e) => setFilters({ ...filters, due: e.target.value as "overdue" | "soon" | "" })}>
            <option value="">any</option>
            <option value="overdue">overdue</option>
            <option value="soon">due within 2 h (or overdue)</option>
          </select>
        </Field>
        <Field label="Rule">
          <input className={field} value={filters.rule} onChange={(e) => setFilters({ ...filters, rule: e.target.value })} placeholder="TM-STRUCT, TM-LIST, …" />
        </Field>
        <Field label="User account id">
          <input className={field} value={filters.userId} onChange={(e) => setFilters({ ...filters, userId: e.target.value })} placeholder="uuid (optional)" />
        </Field>
      </div>
      <div className="mb-3 grid gap-3 rounded-md border border-slate-200 px-3 py-3 sm:grid-cols-[auto_1fr_2fr]">
        <Field label="Decision">
          <select className={field} value={decision} onChange={(e) => setDecision(e.target.value as AlertDecision)}>
            <option value="clear">clear</option>
            <option value="escalate">escalate</option>
            <option value="report">report</option>
            <option value="return">return (give the payment back)</option>
          </select>
        </Field>
        <Field label="Special-form number (report)">
          <input className={field} value={reportRef} disabled={decision !== "report"} onChange={(e) => setReportRef(e.target.value)} placeholder="DFM form no." />
        </Field>
        <Field label="Reason (kept with the decision)">
          <input className={field} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="the analysis behind the decision" />
        </Field>
      </div>

      {rows.length === 0 ? (
        <p className="mb-4 text-sm text-slate-500">{data === null ? "Loading…" : "No alerts match."}</p>
      ) : (
        <div className="mb-4 overflow-x-auto">
          <table className={tableCls}>
            <thead className={theadCls}>
              <tr>
                <th className={th}>Due (UTC)</th>
                <th className={th}>Rule</th>
                <th className={th}>User / order</th>
                <th className={th}>Status</th>
                <th className={th}></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((a) => {
                const due = alertDueState(a);
                const allowed = alertDecisions(a);
                const blocker = alertDecisionBlocker(a, decision);
                const declaration = declarations[a.id];
                return (
                  <tr key={a.id}>
                    <td className={`${td} whitespace-nowrap`}>
                      <Pill tone={DUE_TONE[due]}>{due === "none" ? fmtDateTime(a.dueAt) : `${due} · ${fmtDateTime(a.dueAt)}`}</Pill>
                    </td>
                    <td className={`${td} text-xs`}>
                      <strong>{a.rule}</strong> · {a.severity}
                      <div className="text-[11px] text-slate-500">
                        {a.point ?? "—"} · rules {a.rulesVersion}
                        {a.bvByn ? ` · BV ${a.bvByn}` : ""}
                      </div>
                      <JsonBlock label="Figures" value={a.figures} />
                      {declaration && (
                        <div className="mt-1 rounded bg-slate-50 px-2 py-1 text-[11px] text-slate-700">
                          {declarationLines(declaration).map((line) => (
                            <div key={line}>{line}</div>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className={td}>
                      <Id value={a.userId} />
                      {a.orderId && (
                        <div>
                          <Id value={a.orderId} />
                        </div>
                      )}
                    </td>
                    <td className={`${td} text-xs`}>
                      <Pill tone={alertStatusTone(a.status)}>{a.status}</Pill>
                      {a.decidedAt && (
                        <div className="text-[11px] text-slate-500">
                          {fmtDateTime(a.decidedAt)}
                          {a.reportRef ? ` · form ${a.reportRef}` : ""}
                          {a.decisionReason ? ` · "${a.decisionReason}"` : ""}
                        </div>
                      )}
                    </td>
                    <td className={`${td} whitespace-nowrap text-right`}>
                      {alertHasDeclaration(a) && !declaration && (
                        <button type="button" className={`${btnQuiet} mr-1`} disabled={busy !== null || amlHint !== null} onClick={() => void openDeclaration(a)}>
                          Declaration
                        </button>
                      )}
                      {allowed.length > 0 && (
                        <button
                          type="button"
                          className={btn}
                          disabled={busy !== null || !decisionReady || amlHint !== null || blocker !== null}
                          title={amlHint ?? blocker ?? (decisionReady ? undefined : "Write the reason (and the form number for a report) first.")}
                          onClick={() => {
                            setSigning(null);
                            setConfirm(a);
                          }}
                        >
                          {decision}…
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="rounded-md border border-slate-200 px-3 py-3">
        <p className="mb-2 text-xs font-semibold text-slate-700">Export (CSV, at most 31 days, audited)</p>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
          <Field label="From (UTC day)">
            <input className={field} type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
          </Field>
          <Field label="To (UTC day, inclusive)">
            <input className={field} type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
          </Field>
          <Field label="Status">
            <select className={field} value={range.status} onChange={(e) => setRange({ ...range, status: e.target.value as AlertStatus | "" })}>
              {["", ...ALERT_STATUSES].map((s) => (
                <option key={s || "all"} value={s}>
                  {s || "all"}
                </option>
              ))}
            </select>
          </Field>
          <button
            type="button"
            className={btnQuiet}
            disabled={busy !== null || "problem" in exportWindow || amlHint !== null}
            title={amlHint ?? ("problem" in exportWindow ? exportWindow.problem : undefined)}
            onClick={() => setConfirm("export")}
          >
            Export…
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
        title={
          confirm === "export"
            ? "Export the alerts?"
            : confirm
              ? signing?.alertId === confirm.id
                ? `Sign the ${signing.body.decision} of alert ${confirm.rule}`
                : `${decision} alert ${confirm.rule}?`
              : ""
        }
        description={
          confirm === "export"
            ? `${"problem" in exportWindow ? exportWindow.problem : `${exportWindow.from} → ${exportWindow.to}`}${range.status ? `, status ${range.status}` : ""}. The file holds personal data; the export is audited.`
            : confirm
              ? signing?.alertId === confirm.id
                ? `This ${DECISION_TEXT[signing.body.decision]}, so your operator wallet must sign this exact request. Nothing is saved yet: the next click opens the wallet, then the decision goes out signed. Reason: "${signing.body.reason}".`
                : `${confirm.rule} (${confirm.severity}) for user ${confirm.userId.slice(0, 8)}: this ${DECISION_TEXT[decision]}. ${
                    confirm.severity === "block"
                      ? "Block severity: a second person (approver) must approve the decision."
                      : `${confirm.severity === "info" ? "Info" : "Review"} severity: it takes effect now${
                          decision === "clear" || decision === "return" ? " (signed with your wallet when the backend requires it)" : ""
                        }.`
                  }${decision === "report" ? ` Form ${reportRef.trim()}.` : ""} Reason: "${reason.trim()}".`
              : ""
        }
        confirmLabel={confirm === "export" ? "Download" : confirm && signing?.alertId === confirm.id ? "Sign with wallet and decide" : "Decide"}
        destructive={confirm !== null && confirm !== "export" && (signing?.body.decision ?? decision) === "return"}
        busy={busy !== null}
        onConfirm={() => {
          if (confirm === "export") void doExport();
          else if (confirm) void decide(confirm);
        }}
      />
    </Card>
  );
}
