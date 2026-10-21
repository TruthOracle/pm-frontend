/**
 * Bank statements of the client-money account (truthoracle-backend docs/RAMP.md §10.4): upload the
 * bank's file (camt.053 or the bank CSV, sent base64; account, period and balances are read from
 * the FILE), review the parsed draft with its PROPOSED matches and flags, request the four-eyes
 * confirm (optionally booking unmatched lines), and — as the second person — approve it by
 * uploading your OWN copy, which must parse identically. Lines of confirmed statements that stayed
 * unmatched are classified later, also four-eyes. Non-zero lines are never ignored.
 *
 * While a confirm request is pending, the table shows the bookings that request makes (its params,
 * read-only) instead of the viewer's own selects, and the approve dialog lists each with its amount:
 * the second person approves what is booked, not a blank form (review F3 / F9). Another statement
 * starts with no classification and no picked copy.
 */
import { useCallback, useState } from "react";
import {
  approveStatementConfirmSigned,
  fetchApprovals,
  fetchBankLines,
  fetchBankStatement,
  fetchBankStatements,
  requestBankLineClassify,
  requestStatementConfirm,
  uploadBankStatement,
  type StatementFileInput,
} from "@/lib/backendAdmin";
import { approveBlocker, fiatLabel, fileToBase64, importFileProblem, statementFormatFor } from "@/lib/rampAdmin";
import { bookingSentence, statementBookings, type LineBooking } from "@/lib/rampApprovalFigures";
import {
  BANK_MATCH_KINDS,
  type ApiBankLine,
  type ApiBankStatement,
  type BankLineClassification,
  type BankLineFlag,
  type BankMatchKind,
  type BankStatementStatus,
} from "@/lib/rampAdminTypes";
import { ConfirmDialog, Pill, fmtDateTime } from "@/components/Account/accountUi";
import { btn, btnQuiet, Card, field } from "./adminUi";
import { useBackendOperator } from "./BackendOperatorSession";
import { useRampAdmin } from "./RampAdminSession";
import { ApprovalLine, ErrorLine, Field, Id, RoleNote, td, th, tableCls, theadCls, usePanelData, useRampRun, useRoleHint } from "./RampAdminUi";

type Charset = "utf-8" | "windows-1251";
/** A picked file, already encoded: encoding is async, and the approve click must open the wallet popup first. */
interface PickedFile extends StatementFileInput {
  name: string;
  size: number;
}

const FLAG_TONE: Record<BankLineFlag, "bad" | "warn"> = { iban_mismatch: "bad", payout_duplicate: "bad", reference_credit: "warn" };

function FilePick({ label, onPicked, disabled }: { label: string; onPicked: (f: PickedFile | null, problem: string | null) => void; disabled?: boolean }) {
  const [charset, setCharset] = useState<Charset | "">("");
  return (
    <div className="grid gap-2 sm:grid-cols-[2fr_1fr]">
      <Field label={label}>
        <input
          type="file"
          accept=".xml,.csv,text/csv,application/xml,text/xml"
          disabled={disabled}
          className="block w-full text-xs"
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null;
            const problem = importFileProblem(file);
            if (!file || problem) {
              onPicked(null, problem);
              return;
            }
            const format = statementFormatFor(file.name);
            // Belarusian bank CSV exports are usually windows-1251; camt.053 is UTF-8 XML.
            const chosen: Charset = charset || (format === "csv" ? "windows-1251" : "utf-8");
            fileToBase64(file)
              .then((content) => onPicked({ name: file.name, size: file.size, format, content, charset: chosen }, null))
              .catch(() => onPicked(null, `${file.name} could not be read.`));
          }}
        />
      </Field>
      <Field label="Charset">
        <select className={field} value={charset} onChange={(e) => setCharset(e.target.value as Charset | "")}>
          <option value="">by format (CSV: windows-1251)</option>
          <option value="utf-8">utf-8</option>
          <option value="windows-1251">windows-1251</option>
        </select>
      </Field>
    </div>
  );
}

function LinesTable({
  lines,
  currency,
  classify,
  onClassify,
  booked,
}: {
  lines: ApiBankLine[];
  currency: string;
  classify?: Record<string, BankLineClassification>;
  onClassify?: (line: ApiBankLine, c: BankLineClassification | null) => void;
  /** A pending confirm's bookings, shown read-only in place of the selects. */
  booked?: Map<string, LineBooking>;
}) {
  if (lines.length === 0) return <p className="text-xs text-slate-500">No lines.</p>;
  return (
    <div className="overflow-x-auto">
      <table className={`${tableCls} text-xs`}>
        <thead className={theadCls}>
          <tr>
            <th className={th}>Booked</th>
            <th className={`${th} text-right`}>Amount</th>
            <th className={th}>Counterparty</th>
            <th className={th}>Reference</th>
            <th className={th}>Match</th>
            {(onClassify || booked) && <th className={th}>{booked ? "Booked by the request" : "Book as"}</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {lines.map((l) => {
            const c = classify?.[l.id];
            return (
              <tr key={l.id}>
                <td className={`${td} whitespace-nowrap`}>
                  {l.bookingDate.slice(0, 10)}
                  <div className="font-mono text-[11px] text-slate-400" title={l.lineRef}>
                    {l.lineRef.slice(0, 14)}
                  </div>
                </td>
                <td className={`${td} text-right tabular-nums ${l.amount.trim().startsWith("-") ? "text-red-700" : "text-emerald-700"}`}>{fiatLabel(l.amount, l.currency || currency)}</td>
                <td className={td}>
                  {l.counterpartyName ?? "—"}
                  <div className="font-mono text-[11px] text-slate-500">
                    {l.counterpartyIbanLast4 ? `…${l.counterpartyIbanLast4}` : "no IBAN"} {l.counterpartyBic ?? ""} {l.bankTxCode ?? ""}
                  </div>
                </td>
                <td className={`${td} font-mono`}>
                  {l.reference ?? "—"}
                  {l.documentNo ? <div className="text-[11px] text-slate-400">doc {l.documentNo}</div> : null}
                  {l.returnInfo ? (
                    <div className="font-sans text-[11px] text-amber-700">bank return{l.returnCode ? ` (${l.returnCode})` : ""}</div>
                  ) : null}
                </td>
                <td className={td}>
                  <Pill tone={l.status === "matched" ? "ok" : l.status === "proposed" ? "info" : "pending"}>{l.matchKind ? `${l.status}: ${l.matchKind}` : l.status}</Pill>
                  {(l.matchedOrderId || l.matchedBatchId) && (
                    <div className="mt-0.5">
                      <Id value={l.matchedOrderId ?? l.matchedBatchId ?? null} />
                    </div>
                  )}
                  {l.flags.map((f) => (
                    <div key={f} className="mt-0.5">
                      <Pill tone={FLAG_TONE[f] ?? "warn"}>{f}</Pill>
                    </div>
                  ))}
                </td>
                {booked && (
                  <td className={td}>
                    {booked.get(l.id.toLowerCase()) ? (
                      <span className="font-semibold text-slate-900">{bookingSentence(booked.get(l.id.toLowerCase())!, currency)}</span>
                    ) : l.status === "unmatched" ? (
                      <span className="text-slate-500">stays unmatched</span>
                    ) : null}
                  </td>
                )}
                {onClassify && !booked && (
                  <td className={td}>
                    {l.status === "unmatched" && (
                      <div className="grid gap-1">
                        <select
                          className={field}
                          value={c?.matchKind ?? ""}
                          onChange={(e) => onClassify(l, e.target.value ? { lineId: l.id, matchKind: e.target.value as BankMatchKind, orderId: c?.orderId, batchId: c?.batchId } : null)}
                        >
                          <option value="">leave unmatched</option>
                          {BANK_MATCH_KINDS.map((k) => (
                            <option key={k} value={k}>
                              {k}
                            </option>
                          ))}
                        </select>
                        {c && (
                          <input
                            className={field}
                            value={c.orderId ?? c.batchId ?? ""}
                            onChange={(e) =>
                              onClassify(l, { ...c, ...(c.matchKind === "payout_batch" ? { batchId: e.target.value.trim() || undefined } : { orderId: e.target.value.trim() || undefined }) })
                            }
                            placeholder={c.matchKind === "payout_batch" ? "batch id" : "order id (if any)"}
                          />
                        )}
                      </div>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function RampStatementsPanel() {
  const { ready } = useBackendOperator();
  const { session, operatorParty, signDecision } = useRampAdmin();
  const opsHint = useRoleHint("ops");
  const [status, setStatus] = useState<BankStatementStatus | "">("");
  const loadList = useCallback(() => fetchBankStatements({ status }).then((r) => r.items), [status]);
  const list = usePanelData(loadList, ready);
  const [selected, setSelected] = useState<string | null>(null);
  const loadDetail = useCallback(async () => {
    if (!selected) return null;
    const [preview, pending] = await Promise.all([
      fetchBankStatement(selected),
      fetchApprovals({ action: "ramp.statement.confirm", subjectId: selected, status: "pending" }).then((r) => r.items[0] ?? null),
    ]);
    return { ...preview, pending };
  }, [selected]);
  const detail = usePanelData(loadDetail, ready && selected !== null);
  const reloadAll = useCallback(async () => {
    await list.reload();
    if (selected) await detail.reload();
  }, [list, detail, selected]);
  const { busy, run } = useRampRun(reloadAll);
  const [upload, setUpload] = useState<{ file: PickedFile | null; problem: string | null }>({ file: null, problem: null });
  const [copy, setCopy] = useState<{ file: PickedFile | null; problem: string | null }>({ file: null, problem: null });
  const [reason, setReason] = useState("");
  const [classify, setClassify] = useState<Record<string, BankLineClassification>>({});
  const [confirm, setConfirm] = useState<"upload" | "request" | "approve" | null>(null);

  if (!ready) return null;
  const statement = detail.data?.statement ?? null;
  const lines = detail.data?.lines ?? [];
  const pending = detail.data?.pending ?? null;
  const approveHint = pending ? approveBlocker(pending, session, operatorParty) : "No confirm request is pending for this statement.";
  const classifications = Object.values(classify);
  // What the pending request books (its params), and what this viewer's own request would book.
  const pendingBookings = statementBookings(pending, lines);
  const ownBookings = statementBookings({ params: { classifications } }, lines);
  // Another statement starts clean: no classification and no picked copy carry over (F9).
  const select = (id: string | null) => {
    setSelected(id);
    setClassify({});
    setCopy({ file: null, problem: null });
  };

  const doUpload = async () => {
    const f = upload.file;
    if (!f) return;
    const preview = await run(
      "Statement upload",
      () => uploadBankStatement({ format: f.format, content: f.content, charset: f.charset }),
      (p) => `Parsed ${p.statement.lineCount} lines for ${p.statement.periodFrom.slice(0, 10)}…${p.statement.periodTo.slice(0, 10)}; review the proposals.`,
    );
    setConfirm(null);
    if (preview) {
      setUpload({ file: null, problem: null });
      select(preview.statement.id);
    }
  };

  const doRequest = async () => {
    if (!statement) return;
    await run("Statement confirm request", () =>
      requestStatementConfirm(statement.id, { reason: reason.trim(), ...(classifications.length ? { classifications } : {}) }),
    );
    setConfirm(null);
  };

  const doApprove = async () => {
    const f = copy.file;
    if (!statement || !pending || !f) return;
    // Signs first (the click's one popup); the copy was encoded when it was picked.
    const ok = await run("Statement confirm", () =>
      approveStatementConfirmSigned(statement.id, pending, { format: f.format, content: f.content, charset: f.charset }, reason.trim(), signDecision),
    );
    setConfirm(null);
    if (ok) setCopy({ file: null, problem: null });
  };

  const header = (s: ApiBankStatement) =>
    `${s.format} · ${s.periodFrom.slice(0, 10)} → ${s.periodTo.slice(0, 10)} · opening ${fiatLabel(s.openingBalance, s.currency)} · closing ${fiatLabel(s.closingBalance, s.currency)} · ${s.lineCount} lines`;

  return (
    <div className="space-y-6">
      <Card
        title="Bank statements (client-money account)"
        aside={
          <button type="button" className={btnQuiet} disabled={busy !== null} onClick={() => void list.reload().catch(() => undefined)}>
            Refresh
          </button>
        }
      >
        <ErrorLine error={list.error} />
        <RoleNote role="ops" />
        <div className="mb-4 rounded-md border border-slate-200 px-3 py-3">
          <p className="mb-2 text-xs font-semibold text-slate-700">Import a statement</p>
          <FilePick label="Statement file (camt.053 XML or the bank CSV, at most 5 MB)" disabled={opsHint !== null} onPicked={(file, problem) => setUpload({ file, problem })} />
          {upload.problem && <p className="mt-1 text-xs text-red-700">{upload.problem}</p>}
          <button
            type="button"
            className={`${btn} mt-2`}
            disabled={busy !== null || !upload.file || opsHint !== null}
            title={opsHint ?? undefined}
            onClick={() => setConfirm("upload")}
          >
            Upload and preview…
          </button>
        </div>

        <div className="mb-3 grid gap-3 sm:grid-cols-[auto_1fr]">
          <Field label="Status">
            <select className={field} value={status} onChange={(e) => setStatus(e.target.value as BankStatementStatus | "")}>
              {(["", "draft", "confirmed", "rejected"] as const).map((s) => (
                <option key={s || "all"} value={s}>
                  {s || "all"}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {(list.data ?? []).length === 0 ? (
          <p className="text-sm text-slate-500">{list.data === null ? "Loading…" : "No statements."}</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {(list.data ?? []).map((s) => (
              <li key={s.id} className={`flex flex-wrap items-center justify-between gap-2 py-1.5 ${selected === s.id ? "bg-sky-50" : ""}`}>
                <button type="button" className="text-left" onClick={() => select(selected === s.id ? null : s.id)}>
                  <Pill tone={s.status === "confirmed" ? "ok" : s.status === "draft" ? "pending" : "neutral"}>{s.status}</Pill>{" "}
                  <span className="text-xs text-slate-700">{header(s)}</span>
                </button>
                <span className="text-[11px] text-slate-400">imported {fmtDateTime(s.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {selected && (
        <Card
          key={selected}
          title={`Statement ${selected.slice(0, 8)}`}
          aside={
            <button type="button" className={btnQuiet} onClick={() => select(null)}>
              Close
            </button>
          }
        >
          <ErrorLine error={detail.error} />
          {!statement ? (
            <p className="text-sm text-slate-500">{detail.error ? "" : "Loading…"}</p>
          ) : (
            <>
              <p className="mb-1 text-xs text-slate-700">{header(statement)}</p>
              <p className="mb-3 font-mono text-[11px] text-slate-400" title={statement.fileSha256}>
                {statement.accountIban ?? ""} · sha256 {statement.fileSha256.slice(0, 16)}… · {statement.status}
                {statement.confirmedAt ? ` · confirmed ${fmtDateTime(statement.confirmedAt)}` : ""}
              </p>
              <LinesTable
                lines={lines}
                currency={statement.currency}
                booked={statement.status === "draft" && pending ? pendingBookings : undefined}
                classify={statement.status === "draft" && !pending ? classify : undefined}
                onClassify={
                  statement.status === "draft" && !pending
                    ? (line, c) =>
                        setClassify((cur) => {
                          const next = { ...cur };
                          if (c) next[line.id] = c;
                          else delete next[line.id];
                          return next;
                        })
                    : undefined
                }
              />
              {statement.status === "draft" && (
                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <div className="rounded-md border border-slate-200 px-3 py-3">
                    <p className="mb-2 text-xs font-semibold text-slate-700">1 · Request the confirm (books the proposals)</p>
                    <Field label="Reason (audited)">
                      <input className={field} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="checked against the bank portal" />
                    </Field>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {pending
                        ? `The pending request books ${pendingBookings.size} unmatched line(s), shown in the table; others stay unmatched.`
                        : `${classifications.length} unmatched line(s) booked in this request; others stay unmatched.`}
                    </p>
                    {pending && (
                      <div className="mt-2">
                        <ApprovalLine approval={pending} />
                      </div>
                    )}
                    <button
                      type="button"
                      className={`${btn} mt-2`}
                      disabled={busy !== null || !reason.trim() || opsHint !== null || pending !== null}
                      title={pending ? "A confirm request is already pending." : (opsHint ?? undefined)}
                      onClick={() => setConfirm("request")}
                    >
                      Request confirm…
                    </button>
                  </div>
                  <div className="rounded-md border border-slate-200 px-3 py-3">
                    <p className="mb-2 text-xs font-semibold text-slate-700">2 · Second person: approve with your own copy</p>
                    <FilePick label="Your own copy, downloaded from the bank yourself" onPicked={(file, problem) => setCopy({ file, problem })} />
                    {copy.problem && <p className="mt-1 text-xs text-red-700">{copy.problem}</p>}
                    <button
                      type="button"
                      className={`${btn} mt-2`}
                      disabled={busy !== null || !copy.file || !reason.trim() || approveHint !== null}
                      title={approveHint ?? (reason.trim() ? undefined : "Write the reason first.")}
                      onClick={() => setConfirm("approve")}
                    >
                      Approve with my copy…
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </Card>
      )}

      <UnmatchedLinesCard />

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={confirm === "upload" ? "Upload this statement?" : confirm === "request" ? "Request the statement confirm?" : "Approve the statement confirm?"}
        description={
          confirm === "upload" && upload.file ? (
            `${upload.file.name} (${upload.file.format}, ${upload.file.charset}, ${upload.file.size} bytes). The backend checks the account, the period's continuity and that the lines add up to closing − opening; matches are only proposed.`
          ) : confirm === "request" && statement ? (
            <>
              Confirm {header(statement)}, booking {classifications.length} unmatched line(s). A second person approves with their own copy.
              <BookingList bookings={ownBookings} currency={statement.currency} />
              <span className="mt-2 block">Reason: &quot;{reason.trim()}&quot;.</span>
            </>
          ) : confirm === "approve" && statement && copy.file ? (
            <>
              Your copy {copy.file.name} must parse to exactly this statement (closing {fiatLabel(statement.closingBalance, statement.currency)}).
              Approving books every line in one transaction, completes the matched orders and books the unmatched lines the request names:
              <BookingList bookings={pendingBookings} currency={statement.currency} />
              <span className="mt-2 block">Your wallet asks you to sign the decision. Reason: &quot;{reason.trim()}&quot;.</span>
            </>
          ) : (
            ""
          )
        }
        confirmLabel={confirm === "upload" ? "Upload" : confirm === "request" ? "Request" : "Approve"}
        busy={busy !== null}
        onConfirm={() => void (confirm === "upload" ? doUpload() : confirm === "request" ? doRequest() : doApprove())}
      />
    </div>
  );
}

/** The unmatched lines a confirm books, one per line with its amount (spans: it sits in a dialog's paragraph). */
function BookingList({ bookings, currency }: { bookings: Map<string, LineBooking>; currency: string }) {
  if (bookings.size === 0) return <span className="mt-2 block text-left text-xs">No unmatched line is booked; they stay unmatched.</span>;
  return (
    <span className="mt-2 block text-left text-xs">
      {[...bookings.values()].map((b) => (
        <span key={b.lineId} className="block font-semibold text-slate-900">
          {bookingSentence(b, currency)}
        </span>
      ))}
    </span>
  );
}

/** Lines of confirmed statements still unmatched: each is booked by a four-eyes `ramp.bank_line.classify`. */
function UnmatchedLinesCard() {
  const { ready } = useBackendOperator();
  const opsHint = useRoleHint("ops");
  const load = useCallback(() => fetchBankLines({ status: "unmatched" }).then((r) => r.items), []);
  const { data, error, reload } = usePanelData(load, ready);
  const { busy, run } = useRampRun(reload);
  const [classify, setClassify] = useState<Record<string, BankLineClassification>>({});
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState<ApiBankLine | null>(null);

  const submit = async (line: ApiBankLine) => {
    const c = classify[line.id];
    if (!c) return;
    await run("Line classification", () =>
      requestBankLineClassify(line.id, { reason: reason.trim(), matchKind: c.matchKind, ...(c.orderId ? { orderId: c.orderId } : {}), ...(c.batchId ? { batchId: c.batchId } : {}) }),
    );
    setConfirm(null);
  };

  const rows = data ?? [];
  return (
    <Card
      title="Unmatched bank lines"
      aside={
        <button type="button" className={btnQuiet} disabled={busy !== null} onClick={() => void reload().catch(() => undefined)}>
          Refresh
        </button>
      }
    >
      <ErrorLine error={error} />
      <p className="mb-2 text-[11px] text-slate-500">
        Unexplained credits sit in suspense (a client liability) until booked; a credit quoting a TO- reference is never auto-matched (flag
        reference_credit).
      </p>
      <div className="mb-3 max-w-md">
        <Field label="Reason (audited)">
          <input className={field} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="what the line is, evidence" />
        </Field>
      </div>
      <LinesTable
        lines={rows}
        currency="BYN"
        classify={classify}
        onClassify={(line, c) =>
          setClassify((cur) => {
            const next = { ...cur };
            if (c) next[line.id] = c;
            else delete next[line.id];
            return next;
          })
        }
      />
      {rows.some((l) => classify[l.id]) && (
        <div className="mt-2 flex flex-wrap gap-2">
          {rows
            .filter((l) => classify[l.id])
            .map((l) => (
              <button
                key={l.id}
                type="button"
                className={btnQuiet}
                disabled={busy !== null || !reason.trim() || opsHint !== null}
                title={opsHint ?? (reason.trim() ? undefined : "Write the reason first.")}
                onClick={() => setConfirm(l)}
              >
                Request {classify[l.id].matchKind} for {fiatLabel(l.amount, l.currency || "BYN")}…
              </button>
            ))}
        </div>
      )}
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title="Request booking this line?"
        description={
          confirm
            ? `Book ${fiatLabel(confirm.amount, confirm.currency || "BYN")} (${confirm.lineRef}, ${confirm.bookingDate.slice(0, 10)}) as ${classify[confirm.id]?.matchKind ?? "?"}. The backend accepts a kind only when its conditions hold; a second person approves. Reason: "${reason.trim()}".`
            : ""
        }
        confirmLabel="Request"
        busy={busy !== null}
        onConfirm={() => {
          if (confirm) void submit(confirm);
        }}
      />
    </Card>
  );
}
