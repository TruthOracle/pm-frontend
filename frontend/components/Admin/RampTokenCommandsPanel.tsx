/**
 * Token commands (truthoracle-backend docs/RAMP.md §7): the write-ahead ledger of every mint and
 * burn sent to Cantor8's token-app, and the four-eyes resolutions — resend (same id, only while the
 * mirror shows no record), abandon (declared never landed, after the dedup window and two clean
 * re-pages), compensate (a new command restoring the expected net after a mismatch) and adopting
 * legacy mirror records. Nothing re-sends on its own; these requests are the only way.
 */
import { useCallback, useState } from "react";
import { fetchTokenCommands, requestTokenCommandAction, requestTokenRecordsAdopt } from "@/lib/backendAdmin";
import { exactMoney } from "@/lib/rampAdmin";
import {
  TOKEN_COMMAND_SOURCES,
  TOKEN_COMMAND_STATUSES,
  type ApiTokenCommand,
  type TokenCommandAction,
  type TokenCommandSource,
  type TokenCommandStatus,
} from "@/lib/rampAdminTypes";
import { utcInputToIso } from "@/lib/time";
import { ConfirmDialog, Pill, fmtDateTime } from "@/components/Account/accountUi";
import { btnDanger, btnQuiet, Card, field } from "./adminUi";
import { useBackendOperator } from "./BackendOperatorSession";
import { ErrorLine, Field, Id, RoleNote, td, th, tableCls, theadCls, usePanelData, useRampRun, useRoleHint } from "./RampAdminUi";

const UNRESOLVED: TokenCommandStatus[] = ["pending", "submitted", "unknown"];

const ACTION_TEXT: Record<TokenCommandAction, string> = {
  resend: "re-POSTs the same command id (only while the token-app mirror shows no record, last POST within 144 h); the confirm timer restarts",
  abandon: "declares it never landed (last POST ≥ 8 days ago, two full re-pages ≥ 60 s apart miss it, holdings agree); refunds and credit-backs may then proceed",
  compensate: "sends a NEW command that restores the expected net; this row keeps `mismatch` with the new id as its resolution",
};

function actionsFor(c: ApiTokenCommand): TokenCommandAction[] {
  if (c.status === "mismatch") return c.resolvedBy ? [] : ["compensate"];
  if (UNRESOLVED.includes(c.status)) return ["resend", "abandon"];
  if (c.status === "rejected") return ["resend"];
  return [];
}

function tone(status: TokenCommandStatus) {
  if (status === "recorded") return "ok" as const;
  if (status === "mismatch") return "bad" as const;
  if (status === "rejected" || status === "abandoned") return "neutral" as const;
  return "pending" as const;
}

export default function RampTokenCommandsPanel() {
  const { ready } = useBackendOperator();
  const opsHint = useRoleHint("ops");
  const [filters, setFilters] = useState({ status: "" as TokenCommandStatus | "", source: "" as TokenCommandSource | "" });
  const load = useCallback(() => fetchTokenCommands({ status: filters.status, source: filters.source }).then((r) => r.items), [filters]);
  const { data, error, reload } = usePanelData(load, ready);
  const { busy, run } = useRampRun(reload);
  const [reason, setReason] = useState("");
  const [before, setBefore] = useState("");
  const [confirm, setConfirm] = useState<{ command: ApiTokenCommand; action: TokenCommandAction } | "adopt" | null>(null);

  if (!ready) return null;
  const rows = data ?? [];
  const beforeIso = utcInputToIso(before);

  const submit = async () => {
    if (confirm === "adopt") {
      if (!beforeIso) return;
      await run("Adopt legacy records", () => requestTokenRecordsAdopt({ before: beforeIso, reason: reason.trim() }));
    } else if (confirm) {
      await run(`${confirm.action} ${confirm.command.commandId.slice(0, 12)}`, () =>
        requestTokenCommandAction(confirm.command.commandId, confirm.action, { reason: reason.trim() }),
      );
    }
    setConfirm(null);
  };

  const figure = (c: ApiTokenCommand) => `${c.kind} of ${exactMoney(c.amount, 0, c.instrumentId)} ${c.kind === "mint" ? "to" : "from"} ${c.partyId}`;

  return (
    <Card
      title="Token commands (token-app)"
      aside={
        <button type="button" className={btnQuiet} disabled={busy !== null} onClick={() => void reload().catch(() => undefined)}>
          Refresh
        </button>
      }
    >
      <ErrorLine error={error} />
      <RoleNote role="ops" />
      <div className="mb-3 grid gap-3 sm:grid-cols-3">
        <Field label="Status">
          <select className={field} value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value as TokenCommandStatus | "" })}>
            <option value="">all</option>
            {TOKEN_COMMAND_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Source">
          <select className={field} value={filters.source} onChange={(e) => setFilters({ ...filters, source: e.target.value as TokenCommandSource | "" })}>
            {(["", ...TOKEN_COMMAND_SOURCES] as const).map((s) => (
              <option key={s || "all"} value={s}>
                {s || "all"}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Reason (audited)">
          <input className={field} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="what the mirror and holdings show" />
        </Field>
      </div>

      {rows.length === 0 ? (
        <p className="mb-4 text-sm text-slate-500">{data === null ? "Loading…" : "No commands match."}</p>
      ) : (
        <div className="mb-4 overflow-x-auto">
          <table className={tableCls}>
            <thead className={theadCls}>
              <tr>
                <th className={th}>Command</th>
                <th className={th}>Kind / amount</th>
                <th className={th}>Party</th>
                <th className={th}>Source</th>
                <th className={th}>Status</th>
                <th className={th}>Last POST</th>
                <th className={th}></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((c) => (
                <tr key={c.commandId}>
                  <td className={td}>
                    <Id value={c.commandId} />
                    <div className="text-[11px] text-slate-400">{fmtDateTime(c.createdAt)}</div>
                  </td>
                  <td className={`${td} text-xs`}>
                    {c.kind} {exactMoney(c.amount, 0)} <span className="text-slate-400">{c.instrumentId}</span>
                    {c.recordedAmount && c.recordedAmount !== c.amount && <div className="text-red-700">recorded {exactMoney(c.recordedAmount, 0)}</div>}
                  </td>
                  <td className={td}>
                    <Id value={c.partyId} />
                  </td>
                  <td className={`${td} text-xs`}>
                    {c.source}
                    {c.ref ? <div className="text-slate-400" title={c.ref}>{c.ref.slice(0, 12)}</div> : null}
                  </td>
                  <td className={td}>
                    <Pill tone={tone(c.status)}>{c.status}</Pill>
                    <div className="text-[11px] text-slate-500">
                      {c.attempts} attempt{c.attempts === 1 ? "" : "s"}
                      {c.lastHttpStatus ? ` · HTTP ${c.lastHttpStatus}` : ""}
                    </div>
                    {c.lastError && <div className="max-w-[14rem] truncate text-[11px] text-red-700" title={c.lastError}>{c.lastError}</div>}
                    {c.resolvedBy && <div className="text-[11px] text-slate-500">resolved by {c.resolvedBy.slice(0, 12)}</div>}
                  </td>
                  <td className={`${td} whitespace-nowrap text-xs`}>{fmtDateTime(c.lastPostAt)}</td>
                  <td className={`${td} whitespace-nowrap text-right`}>
                    {actionsFor(c).map((action) => (
                      <button
                        key={action}
                        type="button"
                        className={`${action === "resend" ? btnQuiet : btnDanger} ml-1`}
                        disabled={busy !== null || !reason.trim() || opsHint !== null}
                        title={opsHint ?? (reason.trim() ? ACTION_TEXT[action] : "Write the reason first.")}
                        onClick={() => setConfirm({ command: c, action })}
                      >
                        {action}…
                      </button>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="rounded-md border border-slate-200 px-3 py-3">
        <p className="mb-2 text-xs font-semibold text-slate-700">Adopt legacy mirror records (after a database re-creation)</p>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field label="Records created before (UTC)">
            <input className={field} type="datetime-local" value={before} onChange={(e) => setBefore(e.target.value)} />
          </Field>
          <button
            type="button"
            className={btnDanger}
            disabled={busy !== null || !beforeIso || !reason.trim() || opsHint !== null}
            onClick={() => setConfirm("adopt")}
          >
            Request adoption…
          </button>
        </div>
        <p className="mt-1 text-[11px] text-slate-400">`npm run tokenapp:check` prints the would-be adoption set first; compare before approving.</p>
      </div>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={confirm === "adopt" ? "Request adopting legacy records?" : confirm ? `Request ${confirm.action} of ${confirm.command.commandId.slice(0, 12)}?` : ""}
        description={
          confirm === "adopt"
            ? `Every token-app mirror record created before ${beforeIso ?? "?"} without a command row becomes a recorded \`legacy\` command (counted in issuance). Reason: "${reason.trim()}".`
            : confirm
              ? `The ${figure(confirm.command)}: ${ACTION_TEXT[confirm.action]}. A second person must approve. Reason: "${reason.trim()}".`
              : ""
        }
        confirmLabel="Request"
        destructive={confirm !== null && (confirm === "adopt" || confirm.action !== "resend")}
        busy={busy !== null}
        onConfirm={() => void submit()}
      />
    </Card>
  );
}
