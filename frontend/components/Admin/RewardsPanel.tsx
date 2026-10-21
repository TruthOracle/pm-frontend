/**
 * Operator console for rewards (truthoracle-backend docs/TOKENS.md §4.6, §10): the float — what
 * the treasury holds in the rewards token against what every in-app TRO wallet is owed and what
 * is on its way to one, since a grant is only submitted while the holdings cover all of it — the
 * rules the processor applies (enable / disable each, edit its decimal-string parameters; every
 * change carries a reason for the audit row), a manual grant to an account or a party, and the
 * grant log filtered by status. Rules fire off the ledger index, so a change here applies to
 * activity from the next scan on; nothing is recomputed backwards.
 */
import { useCallback, useEffect, useState } from "react";
import { fetchRewardGrants, fetchRewardRules, fetchRewardsFloat, grantReward, updateRewardRule } from "@/lib/backendAdmin";
import { formatMoney, rewardsInstrument, useInstruments, type InstrumentRef } from "@/lib/instruments";
import {
  REWARD_GRANT_STATUSES,
  REWARD_RULE_PARAM_KEYS,
  isRewardKind,
  isRewardsUnconfigured,
  rewardKindDescription,
  rewardKindLabel,
  rewardStatusView,
  rewardsErrorMessage,
  type RewardGrant,
  type RewardGrantStatus,
  type RewardRule,
  type RewardsFloat,
} from "@/lib/rewards";
import { formatDateTimeUTC } from "@/lib/time";
import { ConfirmDialog, Pill } from "@/components/Account/accountUi";
import { btn, btnQuiet, Card, field, label, truncateId, useRun, type Run } from "./adminUi";
import { useBackendOperator } from "./BackendOperatorSession";

const AMOUNT_RE = /^\d+(\.\d{1,10})?$/;
const validAmount = (s: string) => AMOUNT_RE.test(s.trim()) && Number(s.trim()) > 0;
/** The backend's page cap: the log shows the newest hundred grants and says how many more match. */
const GRANTS_PAGE_LIMIT = 100;

type Target = "userId" | "party";

export default function RewardsPanel() {
  const { ready } = useBackendOperator();
  const catalogToken = rewardsInstrument(useInstruments().data);
  const [rules, setRules] = useState<RewardRule[]>([]);
  const [grants, setGrants] = useState<RewardGrant[]>([]);
  /** Every grant the status filter matches, not only the page shown. */
  const [grantsTotal, setGrantsTotal] = useState(0);
  const [float, setFloat] = useState<RewardsFloat | null>(null);
  const [floatError, setFloatError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<RewardGrantStatus | "">("");
  const [loadError, setLoadError] = useState<{ message: string; unconfigured: boolean } | null>(null);
  const [grant, setGrant] = useState({ target: "userId" as Target, id: "", amount: "", reason: "" });
  const [confirmGrant, setConfirmGrant] = useState(false);

  const reload = useCallback(async () => {
    // The float can be missing on its own (404 while no rewards instrument is configured) without
    // taking the rules and the grant log down with it.
    const [r, g, f] = await Promise.all([
      fetchRewardRules(),
      fetchRewardGrants({ status: statusFilter, limit: GRANTS_PAGE_LIMIT }),
      fetchRewardsFloat().then(
        (x) => ({ ok: true as const, x }),
        (e: unknown) => ({ ok: false as const, e }),
      ),
    ]);
    setRules(r);
    setGrants(g.items);
    setGrantsTotal(g.total);
    if (f.ok) {
      setFloat(f.x);
      setFloatError(null);
    } else {
      setFloat(null);
      setFloatError(rewardsErrorMessage(f.e));
    }
    setLoadError(null);
  }, [statusFilter]);
  const { busy, run } = useRun(reload);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    reload().catch((e: unknown) => {
      if (!cancelled) setLoadError({ message: rewardsErrorMessage(e), unconfigured: isRewardsUnconfigured(e) });
    });
    return () => {
      cancelled = true;
    };
  }, [ready, reload]);

  if (!ready) return null;

  const token: InstrumentRef | null = float?.instrument ?? grants[0]?.instrument ?? catalogToken;
  const sym = token?.symbol ?? "TRO";
  const grantReady = grant.id.trim() !== "" && validAmount(grant.amount) && grant.reason.trim() !== "";

  const submitGrant = async () => {
    const ok = await run(
      "Manual grant",
      () =>
        grantReward({
          ...(grant.target === "userId" ? { userId: grant.id.trim() } : { party: grant.id.trim() }),
          amount: grant.amount.trim(),
          reason: grant.reason.trim(),
        }),
      (g) => `${formatMoney(g.amount, g.instrument)} queued for ${truncateId(g.party)} (${rewardStatusView(g.status).label})`,
    );
    setConfirmGrant(false);
    if (ok) setGrant({ ...grant, id: "", amount: "", reason: "" });
  };

  return (
    <Card
      title={`Rewards (${sym})`}
      aside={
        <button type="button" className={btnQuiet} disabled={busy !== null} onClick={() => void reload().catch((e: unknown) => setLoadError({ message: rewardsErrorMessage(e), unconfigured: isRewardsUnconfigured(e) }))}>
          Refresh
        </button>
      }
    >
      {loadError && (
        <p className={`mb-3 text-xs ${loadError.unconfigured ? "text-amber-700" : "text-red-700"}`}>
          {loadError.unconfigured ? loadError.message : `Could not load the rewards console: ${loadError.message}`}
        </p>
      )}

      <div className="mb-4 rounded-md border border-slate-200 px-3 py-3">
        <p className="mb-2 text-xs font-semibold text-slate-700">Treasury float</p>
        {float ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Treasury holds" value={formatMoney(float.treasuryHoldings, float.instrument)} />
            <Stat label="In-app wallets owe" value={formatMoney(float.liabilities, float.instrument)} />
            <Stat label="Grants in flight" value={formatMoney(float.pending, float.instrument)} />
            <Stat
              label="Headroom"
              value={formatMoney(float.headroom, float.instrument)}
              pill={<Pill tone={float.headroom.trim().startsWith("-") ? "bad" : "ok"}>{float.headroom.trim().startsWith("-") ? "short — grants block" : "covered"}</Pill>}
            />
          </div>
        ) : (
          <p className="text-xs text-slate-500">{floatError ?? "Loading…"}</p>
        )}
        <p className="mt-2 text-[11px] text-slate-400">
          A grant is submitted only while the treasury&apos;s {sym} holdings cover every in-app {sym} balance, the grants in flight (submitted or
          credited, but not yet in a balance the index shows) and the grant itself; otherwise it waits as &quot;blocked_float&quot; until the float is
          topped up (Tokens → Mint to the treasury, or <code className="font-mono">REWARDS_AUTO_MINT</code> on DevNet).
        </p>
      </div>

      <div className="mb-4">
        <p className="mb-2 text-xs font-semibold text-slate-700">Rules</p>
        <ul className="space-y-1 text-sm">
          {rules.map((rule) => (
            <RuleRow key={rule.id} rule={rule} symbol={sym} busy={busy} run={run} />
          ))}
          {rules.length === 0 && <li className="text-xs text-slate-400">No rule rows yet — the backend seeds its rule kinds at boot.</li>}
        </ul>
      </div>

      <div className="mb-4 rounded-md border border-dashed border-slate-300 px-3 py-3">
        <p className="mb-2 text-xs font-semibold text-slate-700">Manual grant ({rewardKindLabel("manual")})</p>
        <div className="grid gap-2 sm:grid-cols-[auto_1fr_8rem]">
          <div>
            <label className={label}>Recipient by</label>
            <select className={field} value={grant.target} onChange={(e) => setGrant({ ...grant, target: e.target.value as Target })}>
              <option value="userId">account id</option>
              <option value="party">party id</option>
            </select>
          </div>
          <div>
            <label className={label}>{grant.target === "userId" ? "User account id" : "Party"}</label>
            <input className={field} value={grant.id} onChange={(e) => setGrant({ ...grant, id: e.target.value })} placeholder={grant.target === "userId" ? "uuid" : "hint::1220…"} />
          </div>
          <div>
            <label className={label}>Amount ({sym})</label>
            <input className={field} inputMode="decimal" value={grant.amount} onChange={(e) => setGrant({ ...grant, amount: e.target.value })} placeholder="10" />
          </div>
          <div className="sm:col-span-3">
            <label className={label}>Reason (shown to the recipient, kept on the audit row)</label>
            <input className={field} value={grant.reason} onChange={(e) => setGrant({ ...grant, reason: e.target.value })} placeholder="promotion / compensation / correction" />
          </div>
        </div>
        <button type="button" className={`${btn} mt-3`} disabled={busy !== null || !grantReady} onClick={() => setConfirmGrant(true)}>
          Grant…
        </button>
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold text-slate-700">Grants ({grantsTotal > grants.length ? `newest ${grants.length} of ${grantsTotal}` : grants.length})</p>
          <select className={`${field} !w-auto`} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as RewardGrantStatus | "")} aria-label="Filter grants by status">
            <option value="">every status</option>
            {REWARD_GRANT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {rewardStatusView(s).label}
              </option>
            ))}
          </select>
        </div>
        {grants.length === 0 ? (
          <p className="text-xs text-slate-400">No grants{statusFilter ? ` with status "${rewardStatusView(statusFilter).label}"` : ""}.</p>
        ) : (
          <div className="max-h-[28rem] overflow-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-1.5 pr-3 font-bold">When (UTC)</th>
                  <th className="py-1.5 pr-3 font-bold">Recipient</th>
                  <th className="py-1.5 pr-3 font-bold">Rule</th>
                  <th className="py-1.5 pr-3 text-right font-bold">Amount</th>
                  <th className="py-1.5 font-bold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {grants.map((g) => {
                  const view = rewardStatusView(g.status);
                  return (
                    <tr key={g.id}>
                      <td className="py-1.5 pr-3 text-slate-500">{formatDateTimeUTC(g.createdAt)}</td>
                      <td className="py-1.5 pr-3 font-mono text-xs" title={`${g.party}${g.userId ? ` · account ${g.userId}` : ""}`}>
                        {truncateId(g.party)}
                      </td>
                      <td className="py-1.5 pr-3">
                        <span className="font-medium text-slate-900">{rewardKindLabel(g.kind)}</span>
                        {g.reason && g.reason !== g.kind && <span className="ml-1 text-xs text-slate-500">{g.reason}</span>}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(g.amount, g.instrument)}</td>
                      <td className="py-1.5">
                        <Pill tone={view.tone} title={g.error ?? view.detail}>
                          {view.label}
                        </Pill>
                        {g.error && (
                          <div className="mt-0.5 max-w-[20rem] truncate text-[11px] text-red-700" title={g.error}>
                            {g.error}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmGrant}
        onOpenChange={setConfirmGrant}
        title="Grant rewards by hand?"
        description={`Credit ${validAmount(grant.amount) && token ? formatMoney(grant.amount.trim(), token) : grant.amount} ${sym} to ${
          grant.target === "userId" ? `account ${grant.id.trim()}` : grant.id.trim()
        } as an operator grant ("${grant.reason.trim()}"). It is queued and credited on-ledger by the rewards processor while the float covers it.`}
        confirmLabel="Grant"
        busy={busy === "Manual grant"}
        onConfirm={() => void submitGrant()}
      />
    </Card>
  );
}

function Stat({ label: text, value, pill }: { label: string; value: string; pill?: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{text}</div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-lg font-extrabold tabular-nums text-slate-950">{value}</span>
        {pill}
      </div>
    </div>
  );
}

/**
 * One rule: its kind in plain words with the current figures, an enable toggle and the parameter
 * editor. Both changes ask for a reason — the backend refuses a rule update without one and keeps
 * it on the audit row — the toggle in its confirm dialog, the editor next to the parameters.
 */
function RuleRow({ rule, symbol, busy, run }: { rule: RewardRule; symbol: string; busy: string | null; run: Run }) {
  const keys = Array.from(new Set([...(isRewardKind(rule.kind) ? REWARD_RULE_PARAM_KEYS[rule.kind] : []), ...Object.keys(rule.params)]));
  const [params, setParams] = useState<Record<string, string>>(() => Object.fromEntries(keys.map((k) => [k, rule.params[k] ?? ""])));
  const [editing, setEditing] = useState(false);
  const [editReason, setEditReason] = useState("");
  /** The toggle's dialog is open while this is a string — the reason typed so far. */
  const [toggleReason, setToggleReason] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const dirty = keys.some((k) => (params[k] ?? "") !== (rule.params[k] ?? ""));
  const valid = keys.every((k) => (params[k] ?? "").trim() === "" || AMOUNT_RE.test((params[k] ?? "").trim()));
  const labelText = rewardKindLabel(rule.kind);
  const toggleVerb = rule.enabled ? "Disable" : "Enable";

  const save = async () => {
    // Blank parameters are dropped rather than sent as "", which the backend would refuse.
    const next = Object.fromEntries(keys.filter((k) => (params[k] ?? "").trim() !== "").map((k) => [k, params[k].trim()]));
    const ok = await run("Update rule", () => updateRewardRule(rule.id, { params: next, reason: editReason.trim() }), `${labelText} updated`);
    if (ok) {
      setEditing(false);
      setEditReason("");
    }
  };

  const toggle = async () => {
    const reason = (toggleReason ?? "").trim();
    if (reason === "") {
      setToggleError("A reason is required; it is kept on the audit row.");
      return;
    }
    const ok = await run("Update rule", () => updateRewardRule(rule.id, { enabled: !rule.enabled, reason }), `${labelText} ${rule.enabled ? "disabled" : "enabled"}`);
    if (ok) setToggleReason(null);
  };

  return (
    <li className="rounded-md bg-slate-50 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-semibold text-slate-950">{labelText}</span>
          <Pill tone={rule.enabled ? "ok" : "neutral"}>{rule.enabled ? "Enabled" : "Disabled"}</Pill>
        </span>
        <span className="flex gap-1.5">
          <button
            type="button"
            className={btnQuiet}
            disabled={busy !== null}
            onClick={() => {
              setToggleError(null);
              setToggleReason("");
            }}
          >
            {toggleVerb}
          </button>
          {keys.length > 0 && (
            <button type="button" className={btnQuiet} disabled={busy !== null} onClick={() => setEditing((v) => !v)}>
              {editing ? "Close" : "Edit params"}
            </button>
          )}
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-600">{rewardKindDescription(rule.kind, symbol, rule.params)}</p>
      {editing && (
        <div className="mt-2 rounded-md border border-slate-200 bg-white px-3 py-2">
          <div className="grid gap-2 sm:grid-cols-3">
            {keys.map((k) => (
              <div key={k}>
                <label className={label}>{k}</label>
                <input className={field} inputMode="decimal" value={params[k] ?? ""} onChange={(e) => setParams({ ...params, [k]: e.target.value })} placeholder="decimal string" />
              </div>
            ))}
            <div className="sm:col-span-3">
              <label className={label}>Reason (kept on the audit row)</label>
              <input className={field} value={editReason} onChange={(e) => setEditReason(e.target.value)} placeholder="why the figures change / ticket id" />
            </div>
          </div>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className={btn}
              disabled={busy !== null || !dirty || !valid || editReason.trim() === ""}
              title={!valid ? "Parameters are decimal strings (digits, up to ten decimals)" : editReason.trim() === "" ? "A reason is required" : undefined}
              onClick={() => void save()}
            >
              {busy === "Update rule" ? "Saving…" : "Save"}
            </button>
            <button type="button" className={btnQuiet} disabled={busy !== null} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={toggleReason !== null}
        onOpenChange={(open) => {
          if (!open) setToggleReason(null);
        }}
        title={`${toggleVerb} ${labelText}?`}
        description={
          <span className="block space-y-3 text-left">
            <span className="block">
              {rule.enabled
                ? "Activity from the next scan on earns nothing under this rule; grants already written are not touched."
                : "Activity from the next scan on earns under this rule; nothing is recomputed backwards."}
            </span>
            <span className="block">
              <span className={label}>Reason (kept on the audit row)</span>
              <input
                className={field}
                value={toggleReason ?? ""}
                onChange={(e) => {
                  setToggleError(null);
                  setToggleReason(e.target.value);
                }}
                placeholder="why / ticket id"
              />
            </span>
          </span>
        }
        confirmLabel={toggleVerb}
        busy={busy === "Update rule"}
        error={toggleError}
        onConfirm={() => void toggle()}
      />
    </li>
  );
}

