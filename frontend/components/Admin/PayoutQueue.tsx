/**
 * The treasury's payout queue: every PendingPayout the treasury party sees on the ledger (Sell,
 * Merge, withdrawals, resolved-winner shares, bonds, prizes), read through the public ledger relay.
 *
 * Settlement is the accounts backend's job (its payout processor). The two operator overrides are
 * backend admin routes behind the operator session, and both are four-eyes approvals now
 * (truthoracle-backend docs/RAMP.md §6.5, X1): "Mark paid" — a payout genuinely settled out of band,
 * archived with the transfer reference (`payout.mark_paid`; it replaces the old paste-a-hash
 * MarkPaid the browser once signed through the wallet relay, now deleted) — and "Force
 * settle" for a stuck row (`payout.force_settle`). A PendingPayout bound to a ramp cash-out is never
 * marked paid by hand: only its order may consume it, or the cash-out would read as a user cancel.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchPendingPayouts, type PendingPayoutRecord } from "@/utils/activeContracts";
import { enterpriseWalletPartyId } from "@/lib/enterpriseWalletSubmit";
import { fetchAdminPayouts, requestPayoutForceSettle, requestPayoutMarkPaid } from "@/lib/backendAdmin";
import { exactMoney, markPaidReferenceProblem, outcomeSentence } from "@/lib/rampAdmin";
import type { ApiAdminPayout } from "@/lib/rampAdminTypes";
import { formatMoney, resolveInstrument, sumByInstrument, useInstruments } from "@/lib/instruments";
import { ConfirmDialog, Pill } from "@/components/Account/accountUi";
import { btnDanger, btnQuiet, Card, field } from "./adminUi";
import { useBackendOperator } from "./BackendOperatorSession";
import { ErrorLine, Field, Id, td, th, tableCls, theadCls, useRampRun, useRoleHint } from "./RampAdminUi";

type Pending = { act: "mark" | "force"; row: PendingPayoutRecord } | null;

function PayoutQueue() {
  const { ready } = useBackendOperator();
  const opsHint = useRoleHint("ops");
  const instruments = useInstruments().data;
  const adminParty = enterpriseWalletPartyId();
  const [rows, setRows] = useState<PendingPayoutRecord[]>([]);
  const [backendRows, setBackendRows] = useState<Map<string, ApiAdminPayout>>(new Map());
  const [backendError, setBackendError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [txHashes, setTxHashes] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState<Pending>(null);

  const refresh = useCallback(async () => {
    if (!adminParty) return;
    setLoading(true);
    try {
      setRows(await fetchPendingPayouts(adminParty));
      if (ready) {
        try {
          const page = await fetchAdminPayouts();
          setBackendRows(new Map(page.items.map((p) => [p.pendingPayoutCid, p])));
          setBackendError(null);
        } catch (e) {
          setBackendError(e instanceof Error ? e.message : String(e));
        }
      }
    } finally {
      setLoading(false);
    }
  }, [adminParty, ready]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const { busy, run } = useRampRun(refresh);
  const money = (r: PendingPayoutRecord) => formatMoney(r.amount, resolveInstrument(instruments, r.instrument));
  // The confirm dialog names the exact figure: the backend's decimal string when it indexed the row.
  const exact = (r: PendingPayoutRecord) => {
    const b = backendRows.get(r.contractId);
    const instrument = resolveInstrument(instruments, r.instrument);
    return b ? exactMoney(b.amount, instrument.decimals, instrument.symbol) : money(r);
  };
  const totals = useMemo(
    () => sumByInstrument(rows.map((r) => ({ instrument: resolveInstrument(instruments, r.instrument), amount: r.amount }))),
    [rows, instruments],
  );

  if (!adminParty) {
    return (
      <Card title="Payout queue">
        <p className="text-sm text-amber-700">VITE_ENTERPRISE_WALLET_PARTY_ID is not set, so the treasury&apos;s payout queue cannot load.</p>
      </Card>
    );
  }

  const submit = async () => {
    if (!confirm) return;
    const { act, row } = confirm;
    if (act === "mark") {
      const ok = await run("Mark paid", () => requestPayoutMarkPaid(row.contractId, { txHash: (txHashes[row.contractId] ?? "").trim(), reason: reason.trim() }));
      if (ok) setTxHashes((m) => ({ ...m, [row.contractId]: "" }));
    } else {
      await run(
        "Force settle",
        () => requestPayoutForceSettle(row.contractId, { reason: reason.trim() }),
        (r) => ("approval" in r ? outcomeSentence("Force settle", r) : `Settled (${r.mode}).`),
      );
    }
    setConfirm(null);
  };

  return (
    <Card
      title="Payout queue (treasury PendingPayouts)"
      aside={
        <button type="button" className={btnQuiet} disabled={loading || busy !== null} onClick={() => void refresh()}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      }
    >
      <p className="mb-2 text-xs text-slate-600">
        Outstanding: <strong>{totals.length === 0 ? "0" : totals.map((t) => formatMoney(t.amount, t.instrument)).join(" · ")}</strong> across{" "}
        <strong>{rows.length}</strong> row{rows.length === 1 ? "" : "s"}. The backend&apos;s processor settles them; the overrides below are
        four-eyes requests.
      </p>
      {!ready && <p className="mb-2 text-xs text-amber-700">Sign in to the backend as an operator to act on a payout.</p>}
      <ErrorLine error={backendError ? `The backend's payout index could not be read: ${backendError}` : null} />
      {ready && (
        <div className="mb-3 max-w-md">
          <Field label="Reason (kept on the approval and the audit row)">
            <input className={field} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="how it was paid / why it is stuck" />
          </Field>
        </div>
      )}
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">{loading ? "Loading…" : "No outstanding payouts."}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className={tableCls}>
            <thead className={theadCls}>
              <tr>
                <th className={th}>User</th>
                <th className={th}>Market</th>
                <th className={th}>Reason</th>
                <th className={`${th} text-right`}>Amount</th>
                <th className={th}>Contract</th>
                <th className={th}>Backend</th>
                {ready && <th className={th}>Out-of-band transfer reference</th>}
                {ready && <th className={th}></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => {
                const b = backendRows.get(r.contractId);
                const bound = Boolean(b?.offrampOrderId);
                const refProblem = markPaidReferenceProblem(txHashes[r.contractId] ?? "");
                const blocked = busy !== null || !reason.trim() || opsHint !== null;
                return (
                  <tr key={r.contractId}>
                    <td className={td}>
                      <Id value={r.user} />
                    </td>
                    <td className={td}>{r.marketId === 0 ? "—" : `#${r.marketId}`}</td>
                    <td className={`${td} text-xs`}>{r.reason}</td>
                    <td className={`${td} text-right tabular-nums`}>{money(r)}</td>
                    <td className={td}>
                      <Id value={r.contractId} />
                    </td>
                    <td className={`${td} text-xs`}>
                      {b ? <Pill tone={b.status.startsWith("blocked") || b.status === "failed" ? "warn" : "neutral"}>{b.status}</Pill> : ready ? "not indexed" : "—"}
                      {b?.lastError && <div className="max-w-[12rem] truncate text-[11px] text-red-700" title={b.lastError}>{b.lastError}</div>}
                      {bound && (
                        <div className="text-[11px] text-slate-500">
                          cash-out <Id value={b?.offrampOrderId ?? null} />
                        </div>
                      )}
                    </td>
                    {ready && (
                      <td className={td}>
                        <input
                          className={field}
                          value={txHashes[r.contractId] ?? ""}
                          disabled={bound}
                          onChange={(e) => setTxHashes((m) => ({ ...m, [r.contractId]: e.target.value }))}
                          placeholder={bound ? "bound to a cash-out" : "bank / chain reference"}
                        />
                      </td>
                    )}
                    {ready && (
                      <td className={`${td} whitespace-nowrap text-right`}>
                        <button
                          type="button"
                          className={btnDanger}
                          disabled={blocked || bound || refProblem !== null}
                          title={
                            bound
                              ? "Bound to a ramp cash-out: resolve it from the order, never by hand."
                              : (opsHint ?? (!reason.trim() ? "Write the reason first." : (refProblem ?? undefined)))
                          }
                          onClick={() => setConfirm({ act: "mark", row: r })}
                        >
                          Mark paid…
                        </button>
                        <button
                          type="button"
                          className={`${btnQuiet} ml-1`}
                          disabled={blocked}
                          title={opsHint ?? (!reason.trim() ? "Write the reason first." : undefined)}
                          onClick={() => setConfirm({ act: "force", row: r })}
                        >
                          Force settle…
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={confirm?.act === "mark" ? "Request marking this payout paid?" : "Request a forced settlement?"}
        description={
          confirm
            ? confirm.act === "mark"
              ? `${exact(confirm.row)} owed to ${confirm.row.user} was paid outside the platform under "${(txHashes[confirm.row.contractId] ?? "").trim()}". Once a second person approves, the PendingPayout is archived and nothing more is paid. Reason: "${reason.trim()}".`
              : `${exact(confirm.row)} owed to ${confirm.row.user} is settled now by the backend, past its own wait (KYC, revoked wallet). A second person approves. Reason: "${reason.trim()}".`
            : ""
        }
        confirmLabel="Request"
        destructive={confirm?.act === "mark"}
        busy={busy !== null}
        onConfirm={() => void submit()}
      />
    </Card>
  );
}

export default PayoutQueue;
