/**
 * User bank accounts for bank payouts (truthoracle-backend docs/RAMP.md §10.2): a BYN IBAN is usable
 * only once proved held in the user's KYC name — by the bank's name check, by a matching ERIP payer,
 * or manually. This card lists the accounts awaiting proof (and blocked ones) and requests the
 * four-eyes manual verification with the evidence reference (cooling-off or pending-proof accounts;
 * only with RAMP_BANK_MANUAL_PROOF on), or an unblock — which sends the account back to pending
 * proof, to be proved again. The bank directory's sanctions flags are shown for the operator.
 */
import { useCallback, useState } from "react";
import { fetchAdminBankAccounts, requestBankAccountUnblock, requestBankAccountVerify } from "@/lib/backendAdmin";
import type { ApiAdminBankAccount, BankAccountStatus } from "@/lib/rampAdminTypes";
import { ConfirmDialog, Pill, fmtDateTime } from "@/components/Account/accountUi";
import { btn, btnQuiet, Card, field } from "./adminUi";
import { useBackendOperator } from "./BackendOperatorSession";
import { ErrorLine, Field, Id, RoleNote, td, th, tableCls, theadCls, useDebounced, usePanelData, useRampRun, useRoleHint } from "./RampAdminUi";

/** "Sanctions: EU, US": the bank directory's flags for the account's bank (informational). */
function sanctionsLine(a: Pick<ApiAdminBankAccount, "sanctions">): string | null {
  const s = a.sanctions;
  const lists = [s.eu.length ? `EU (${s.eu.join(", ")})` : "", s.us.length ? `US (${s.us.join(", ")})` : "", s.uk.length ? `UK (${s.uk.join(", ")})` : ""].filter(Boolean);
  return lists.length ? `Bank under sanctions: ${lists.join("; ")}` : null;
}

export default function RampBankAccountsPanel() {
  const { ready } = useBackendOperator();
  const opsHint = useRoleHint("ops");
  const [status, setStatus] = useState<BankAccountStatus | "">("pending_proof");
  const [userId, setUserId] = useState("");
  const appliedUserId = useDebounced(userId);
  const load = useCallback(() => fetchAdminBankAccounts({ status, userId: appliedUserId.trim() }).then((r) => r.items), [status, appliedUserId]);
  const { data, error, reload } = usePanelData(load, ready);
  const { busy, run } = useRampRun(reload);
  const [reason, setReason] = useState("");
  const [proofRef, setProofRef] = useState("");
  const [confirm, setConfirm] = useState<{ account: ApiAdminBankAccount; act: "verify" | "unblock" } | null>(null);

  if (!ready) return null;
  const rows = data ?? [];

  const submit = async () => {
    if (!confirm) return;
    const { account, act } = confirm;
    const ok =
      act === "verify"
        ? await run("Account verification", () => requestBankAccountVerify(account.id, { reason: reason.trim(), proofRef: proofRef.trim() }))
        : await run("Account unblock", () => requestBankAccountUnblock(account.id, { reason: reason.trim() }));
    setConfirm(null);
    if (ok) setProofRef("");
  };

  return (
    <Card
      title="User bank accounts"
      aside={
        <button type="button" className={btnQuiet} disabled={busy !== null} onClick={() => void reload().catch(() => undefined)}>
          Refresh
        </button>
      }
    >
      <ErrorLine error={error} />
      <RoleNote role="ops" />
      <div className="mb-3 grid gap-3 sm:grid-cols-4">
        <Field label="Status">
          <select className={field} value={status} onChange={(e) => setStatus(e.target.value as BankAccountStatus | "")}>
            {(["pending_proof", "cooling_off", "blocked", "active", "removed", ""] as const).map((s) => (
              <option key={s || "all"} value={s}>
                {s || "all"}
              </option>
            ))}
          </select>
        </Field>
        <Field label="User account id">
          <input className={field} value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="uuid (optional)" />
        </Field>
        <Field label="Proof reference (verify)">
          <input className={field} value={proofRef} onChange={(e) => setProofRef(e.target.value)} placeholder="bank letter no. / ticket" />
        </Field>
        <Field label="Reason (audited)">
          <input className={field} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="what proves the holder" />
        </Field>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">{data === null ? "Loading…" : "No accounts match."}</p>
      ) : (
        <table className={tableCls}>
          <thead className={theadCls}>
            <tr>
              <th className={th}>Account</th>
              <th className={th}>Bank</th>
              <th className={th}>User</th>
              <th className={th}>Status</th>
              <th className={th}>Proof</th>
              <th className={th}></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((a) => (
              <tr key={a.id}>
                <td className={`${td} font-mono text-xs`}>
                  {a.ibanMasked}
                  <div className="text-[11px] text-slate-400">added {fmtDateTime(a.createdAt)}</div>
                </td>
                <td className={`${td} text-xs`}>
                  {a.bankName ?? "—"} <span className="font-mono text-slate-400">{a.bic ?? a.bankCode}</span>
                  <div className="text-[11px] text-slate-400">name form: {a.nameForm}</div>
                  {sanctionsLine(a) && <div className="text-[11px] text-amber-700">{sanctionsLine(a)}</div>}
                </td>
                <td className={td}>
                  <Id value={a.userId} />
                </td>
                <td className={td}>
                  <Pill tone={a.status === "active" ? "ok" : a.status === "blocked" ? "bad" : a.status === "removed" ? "neutral" : "pending"}>{a.status}</Pill>
                  {a.status === "cooling_off" && a.coolingOffUntil && <div className="text-[11px] text-slate-500">until {fmtDateTime(a.coolingOffUntil)}</div>}
                </td>
                <td className={`${td} text-xs`}>
                  {a.proof ?? "—"}
                  {a.proofRef ? <div className="text-[11px] text-slate-400">{a.proofRef}</div> : null}
                  {a.firstPayoutOrderId ? <div className="text-[11px] text-slate-400">first payout done</div> : null}
                </td>
                <td className={`${td} whitespace-nowrap text-right`}>
                  {(a.status === "pending_proof" || a.status === "cooling_off") && !a.proof && (
                    <button
                      type="button"
                      className={btn}
                      disabled={busy !== null || !reason.trim() || !proofRef.trim() || opsHint !== null}
                      title={opsHint ?? (!proofRef.trim() ? "Enter the proof reference first." : !reason.trim() ? "Write the reason first." : undefined)}
                      onClick={() => setConfirm({ account: a, act: "verify" })}
                    >
                      Verify…
                    </button>
                  )}
                  {a.status === "blocked" && (
                    <button
                      type="button"
                      className={btnQuiet}
                      disabled={busy !== null || !reason.trim() || opsHint !== null}
                      title={opsHint ?? (reason.trim() ? undefined : "Write the reason first.")}
                      onClick={() => setConfirm({ account: a, act: "unblock" })}
                    >
                      Unblock…
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
        title={confirm?.act === "unblock" ? "Request unblocking the account?" : "Request manual verification?"}
        description={
          confirm
            ? confirm.act === "verify"
              ? `${confirm.account.ibanMasked} at ${confirm.account.bankName ?? "the bank"} becomes a payout destination for user ${confirm.account.userId.slice(0, 8)} once a second person approves${
                  confirm.account.status === "cooling_off" ? " and its waiting period ends" : ""
                }. Only verify with evidence that the account is held in the user's verified name (proof "${proofRef.trim()}"). Reason: "${reason.trim()}".`
              : `${confirm.account.ibanMasked} goes back to pending proof once a second person approves: it receives payouts only after it is proved again (a matching ERIP payment, the bank's name check, or a manual verification). Reason: "${reason.trim()}".`
            : ""
        }
        confirmLabel="Request"
        busy={busy !== null}
        onConfirm={() => void submit()}
      />
    </Card>
  );
}
