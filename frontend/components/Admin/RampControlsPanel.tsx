/**
 * Ramp controls (truthoracle-backend docs/RAMP.md §6.1–§6.4): the runtime halts — set at once by an
 * `ops` operator or automatically by reconciliation, lifted only by a four-eyes resume — and the
 * reconciliation that feeds the reserve gate (before every mint) and the payout gate (before every
 * fiat release): the latest full run, its checks, the reserve figures, and a rate-limited "run now".
 */
import { useCallback, useState } from "react";
import { fetchRampControls, fetchRampProvider, fetchRampReconciliation, haltRamp, requestRampResume, runRampReconciliation } from "@/lib/backendAdmin";
import { RECON_CHECKS, reconTone, reserveRows } from "@/lib/rampAdmin";
import { HALT_SCOPES, type HaltScope } from "@/lib/rampAdminTypes";
import { ConfirmDialog, Pill, fmtDateTime } from "@/components/Account/accountUi";
import { btn, btnDanger, btnQuiet, Card, field } from "./adminUi";
import { useBackendOperator } from "./BackendOperatorSession";
import { ErrorLine, Field, JsonBlock, RoleNote, td, th, tableCls, theadCls, usePanelData, useRampRun, useRoleHint } from "./RampAdminUi";

const SCOPE_TEXT: Record<HaltScope, string> = {
  orders: "no new orders (open ones stay visible and cancellable)",
  mints: "no mint starts (re-mints wait only for token-integrity failures)",
  payouts: "no MarkPaid, no card refund part or OCT, no batch approval or first download",
};

export default function RampControlsPanel() {
  const { ready } = useBackendOperator();
  const opsHint = useRoleHint("ops");
  const loadAll = useCallback(async () => {
    const [controls, recon] = await Promise.all([fetchRampControls(), fetchRampReconciliation()]);
    return { controls, recon };
  }, []);
  const { data, error, reload } = usePanelData(loadAll, ready);
  const loadProvider = useCallback(() => fetchRampProvider(), []);
  const provider = usePanelData(loadProvider, ready);
  const { busy, run } = useRampRun(reload);
  const [scopes, setScopes] = useState<HaltScope[]>([]);
  const [haltReason, setHaltReason] = useState("");
  const [resumeReason, setResumeReason] = useState("");
  const [confirm, setConfirm] = useState<"halt" | "resume" | null>(null);

  if (!ready) return null;
  const controls = data?.controls ?? null;
  const recon = data?.recon ?? null;
  const halted = controls?.haltedScopes ?? [];
  const reserve = reserveRows(recon?.reserve ?? null);

  const toggle = (s: HaltScope) => setScopes((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  const halt = async () => {
    const ok = await run("Halt", () => haltRamp({ scopes, reason: haltReason.trim() }), `Halted: ${scopes.join(", ")}.`);
    setConfirm(null);
    if (ok) {
      setScopes([]);
      setHaltReason("");
    }
  };
  const resume = async () => {
    const ok = await run("Resume request", () => requestRampResume({ reason: resumeReason.trim() }));
    setConfirm(null);
    if (ok) setResumeReason("");
  };

  return (
    <div className="space-y-6">
      <Card
        title="Ramp halts"
        aside={
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${halted.length ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-700"}`}>
            {halted.length ? `Halted: ${halted.join(", ")}` : "Running"}
          </span>
        }
      >
        <ErrorLine error={error} />
        <RoleNote role="ops" />
        {controls && halted.length > 0 && (
          <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <p>
              {controls.source === "auto" ? "Halted automatically by reconciliation" : "Halted by an operator"}
              {controls.since ? ` since ${fmtDateTime(controls.since)}` : ""}: {controls.reason ?? "no reason recorded"}
            </p>
            {controls.failingChecks && controls.failingChecks.length > 0 && (
              <ul className="mt-1 list-disc pl-4">
                {controls.failingChecks.map((c) => (
                  <li key={c.name}>
                    <code className="font-mono">{c.name}</code>
                    {c.detail ? `: ${c.detail}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-xs font-semibold text-slate-700">Halt now (immediate)</p>
            <div className="mb-2 space-y-1">
              {HALT_SCOPES.map((s) => (
                <label key={s} className="flex items-start gap-2 text-xs text-slate-700">
                  <input type="checkbox" checked={scopes.includes(s)} disabled={halted.includes(s)} onChange={() => toggle(s)} />
                  <span>
                    <strong>{s}</strong>: {SCOPE_TEXT[s]}
                    {halted.includes(s) ? " (already halted)" : ""}
                  </span>
                </label>
              ))}
            </div>
            <Field label="Reason (audited)">
              <input className={field} value={haltReason} onChange={(e) => setHaltReason(e.target.value)} placeholder="what is wrong, ticket id" />
            </Field>
            <button
              type="button"
              className={`${btnDanger} mt-2`}
              disabled={busy !== null || scopes.length === 0 || !haltReason.trim() || opsHint !== null}
              title={opsHint ?? undefined}
              onClick={() => setConfirm("halt")}
            >
              Halt…
            </button>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold text-slate-700">Resume (four-eyes, lifts every halt)</p>
            <p className="mb-2 text-[11px] text-slate-500">
              Burns, refunds of unminted captures, cancels, expiries, credits of recorded mints, batch submission and statement
              imports run during a halt: they record facts or reduce risk.
            </p>
            <Field label="Reason (audited)">
              <input className={field} value={resumeReason} onChange={(e) => setResumeReason(e.target.value)} placeholder="what was fixed and checked" />
            </Field>
            <button
              type="button"
              className={`${btn} mt-2`}
              disabled={busy !== null || halted.length === 0 || !resumeReason.trim() || opsHint !== null}
              title={halted.length === 0 ? "Nothing is halted." : (opsHint ?? undefined)}
              onClick={() => setConfirm("resume")}
            >
              Request resume…
            </button>
          </div>
        </div>
      </Card>

      <Card
        title="Reconciliation and reserves"
        aside={
          <div className="flex items-center gap-2">
            {recon?.run && <Pill tone={reconTone(recon.run.status)}>{recon.run.status}</Pill>}
            <button
              type="button"
              className={btnQuiet}
              disabled={busy !== null}
              onClick={() => void run("Reconciliation run", () => runRampReconciliation(), (r) => `Reconciliation ${r.run.status} (${r.run.trigger}, ${fmtDateTime(r.run.startedAt)}).`)}
            >
              Run now
            </button>
          </div>
        }
      >
        {!recon?.run ? (
          <p className="text-sm text-slate-500">{recon ? "No full run yet." : "Loading…"}</p>
        ) : (
          <>
            <p className="mb-3 text-xs text-slate-500">
              Latest full run: {recon.run.trigger} · started {fmtDateTime(recon.run.startedAt)} · finished {fmtDateTime(recon.run.finishedAt)}
              {recon.run.halted ? " · this run halted the ramp" : ""}
              {recon.running ? " · a run is in progress" : ""}
            </p>
            <table className={`${tableCls} mb-4`}>
              <thead className={theadCls}>
                <tr>
                  <th className={th}>Check</th>
                  <th className={th}>Status</th>
                  <th className={th}>Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recon.run.checks.map((c) => (
                  <tr key={c.name}>
                    <td className={`${td} font-mono text-xs`} title={RECON_CHECKS[c.name]}>
                      {c.name}
                      <div className="font-sans text-[11px] text-slate-400">
                        {c.haltScopes.length > 0 ? `red halts: ${c.haltScopes.join(", ")}` : "never halts"}
                      </div>
                    </td>
                    <td className={td}>
                      <Pill tone={reconTone(c.status)}>{c.status}</Pill>
                    </td>
                    <td className={`${td} text-xs text-slate-700`}>
                      {c.detail ?? RECON_CHECKS[c.name] ?? ""}
                      <JsonBlock label="Figures" value={c.figures} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        {reserve.length > 0 && (
          <>
            <p className="mb-1 text-xs font-semibold text-slate-700">Reserve figures (client money, BYN)</p>
            <table className={`${tableCls} mb-2`}>
              <tbody className="divide-y divide-slate-100">
                {reserve.map((r) => (
                  <tr key={r.key}>
                    <td className={`${td} text-xs text-slate-600`}>{r.label}</td>
                    <td className={`${td} text-right font-mono text-xs tabular-nums`}>{r.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        <JsonBlock label="Journal balances" value={recon?.journal} />
        {provider.data && (
          <p className="mt-3 text-xs text-slate-500">
            Provider {provider.data.provider}: {provider.data.configured ? "configured" : "not configured"}
            {provider.data.webhookUrl ? ` · webhooks to ${provider.data.webhookUrl}` : ""}
          </p>
        )}
        {provider.data && <JsonBlock label="Provider capabilities and health" value={{ capabilities: provider.data.capabilities, health: provider.data.health }} />}
      </Card>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={confirm === "halt" ? `Halt ${scopes.join(", ")}?` : "Request resuming the ramp?"}
        description={
          confirm === "halt"
            ? `Takes effect at once: ${scopes.map((s) => SCOPE_TEXT[s]).join("; ")}. Lifting it later needs a second person. Reason: "${haltReason.trim()}".`
            : `Lifts every halt (${halted.join(", ")}) once a second person approves. Make sure the failing checks are green first. Reason: "${resumeReason.trim()}".`
        }
        confirmLabel={confirm === "halt" ? "Halt" : "Request"}
        destructive={confirm === "halt"}
        busy={busy !== null}
        onConfirm={() => void (confirm === "halt" ? halt() : resume())}
      />
    </div>
  );
}
