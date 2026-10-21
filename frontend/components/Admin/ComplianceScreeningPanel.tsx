/**
 * Belarusian list screening (truthoracle-backend docs/RAMP.md §11.6): import a delivered list (the
 * normalised CSV `kind,name_variants,birth_date,ids`, sent base64 with its charset; role `aml`) —
 * every identity, dormant ones included, is re-screened on import — and decide the hits. A hit on
 * by_terror / un / decree48 has already frozen the user provisionally: confirm keeps the freeze
 * (special form), clear lifts it. A foreign-list hit only denies new orders, and a confirmed one
 * may still be cleared. Before deciding, "Compare" reads the account's verified identity (an
 * audited read). With signatures on, a clear is signed (C23): the first click asks, the backend
 * answers with the exact message, a second click opens the wallet and decides. Re-screens run on
 * import and on schedule; one can be started here.
 */
import { useCallback, useState } from "react";
import {
  decideScreeningHit,
  fetchScreeningHit,
  hitDecisionRequest,
  fetchScreeningHits,
  fetchScreeningLists,
  fetchScreeningRuns,
  importScreeningList,
  requestRescreen,
} from "@/lib/backendAdmin";
import {
  fileToBase64,
  importFileProblem,
  isSignatureStep,
  screeningHitDecisions,
  screeningMatchLine,
  sendDecisionSigned,
  sendDecisionUnsigned,
} from "@/lib/rampAdmin";
import { RampAdminError } from "@/lib/rampAdminErrors";
import {
  FREEZING_LISTS,
  SCREENING_LISTS,
  type ApiScreeningHit,
  type ApiScreeningHitDetail,
  type ApiScreeningImport,
  type ScreeningHitStatus,
  type ScreeningListName,
} from "@/lib/rampAdminTypes";
import { utcInputToIso } from "@/lib/time";
import { ConfirmDialog, Pill, fmtDateTime } from "@/components/Account/accountUi";
import { btn, btnDanger, btnQuiet, Card, field } from "./adminUi";
import { useBackendOperator } from "./BackendOperatorSession";
import { useRampAdmin } from "./RampAdminSession";
import { ErrorLine, Field, Id, RoleNote, td, th, tableCls, theadCls, usePanelData, useRampRun, useRoleHint } from "./RampAdminUi";

type Charset = "utf-8" | "windows-1251";
type Decision = "confirm" | "clear";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const freezes = (list: ScreeningListName) => FREEZING_LISTS.includes(list);

function importSentence(r: ApiScreeningImport): string {
  const head = `Imported ${r.list.list} ${r.list.version}: ${r.list.entryCount} entries`;
  return r.hits === null ? `${head}; another re-screen was running, so the processor re-screens with it next.` : `${head}, ${r.hits} hit(s) after the re-screen.`;
}

function decisionText(hit: ApiScreeningHit, decision: Decision, reason: string): string {
  const user = hit.userId.slice(0, 8);
  if (decision === "confirm")
    return freezes(hit.list)
      ? `The freeze of user ${user} becomes final (no longer provisional); file the special form. Reason: "${reason}".`
      : `The foreign-list hit is confirmed: user ${user} stays refused for new orders (nothing is frozen). Reason: "${reason}".`;
  return freezes(hit.list)
    ? `A false match: the provisional freeze of user ${user} is lifted once no other open list hit holds it. Reason: "${reason}".`
    : `A false match: user ${user} may order again (no freeze was placed). Reason: "${reason}".`;
}

export default function ComplianceScreeningPanel() {
  const { ready } = useBackendOperator();
  const amlHint = useRoleHint("aml");
  const loadLists = useCallback(() => fetchScreeningLists().then((r) => r.items), []);
  const lists = usePanelData(loadLists, ready);
  const [hitStatus, setHitStatus] = useState<ScreeningHitStatus | "">("open");
  const loadHits = useCallback(() => fetchScreeningHits({ status: hitStatus }).then((r) => r.items), [hitStatus]);
  const hits = usePanelData(loadHits, ready);
  const loadRuns = useCallback(() => fetchScreeningRuns().then((r) => r.items), []);
  const runs = usePanelData(loadRuns, ready);
  const reloadAll = useCallback(async () => {
    await Promise.all([lists.reload(), hits.reload(), runs.reload()]);
  }, [lists, hits, runs]);
  const { busy, run } = useRampRun(reloadAll);
  const [form, setForm] = useState({ list: "by_terror" as ScreeningListName, version: "", deliveredAt: "", charset: "utf-8" as Charset });
  const [file, setFile] = useState<{ name: string; size: number; content: string } | null>(null);
  const [fileProblem, setFileProblem] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [rescreen, setRescreen] = useState({ reason: "", userId: "" });
  const [compare, setCompare] = useState<Record<string, ApiScreeningHitDetail>>({});
  const [confirm, setConfirm] = useState<"import" | "rescreen" | { hit: ApiScreeningHit; decision: Decision } | null>(null);
  const { signRequest } = useRampAdmin();
  // C23: the backend asked for the officer's signature over this exact clear (nothing saved yet).
  const [signing, setSigning] = useState<{ hitId: string; message: string; reason: string } | null>(null);

  if (!ready) return null;
  const deliveredIso = utcInputToIso(form.deliveredAt);
  const importReady = file !== null && form.version.trim() !== "" && deliveredIso !== null;
  const rescreenUser = rescreen.userId.trim();
  const rescreenReady = rescreen.reason.trim() !== "" && (rescreenUser === "" || UUID_RE.test(rescreenUser));

  const doImport = async () => {
    const ok = await run(
      "List import",
      async () => {
        if (!file || !deliveredIso) throw new RampAdminError("Pick the file and fill in the version and delivery time.");
        return importScreeningList({ list: form.list, version: form.version.trim(), deliveredAt: deliveredIso, content: file.content, charset: form.charset });
      },
      importSentence,
    );
    setConfirm(null);
    if (ok) {
      setFile(null);
      setForm({ ...form, version: "", deliveredAt: "" });
    }
  };

  const closeDialog = () => {
    setConfirm(null);
    setSigning(null);
  };

  const decide = async (hit: ApiScreeningHit, decision: Decision) => {
    if (signing && signing.hitId === hit.id) {
      // The second click: the wallet popup is the first thing it awaits, then the same clear goes out signed.
      const signed = signing;
      await run(`Hit ${decision}`, () =>
        sendDecisionSigned((signature) => decideScreeningHit(hit.id, { decision, reason: signed.reason, ...(signature ? { signature } : {}) }), signed.message, signRequest),
      );
      closeDialog();
      return;
    }
    const why = reason.trim();
    const result = await run(`Hit ${decision}`, () =>
      sendDecisionUnsigned((signature) => decideScreeningHit(hit.id, { decision, reason: why, ...(signature ? { signature } : {}) }), hitDecisionRequest(hit.id, decision)),
    );
    if (isSignatureStep(result)) setSigning({ hitId: hit.id, message: result.signatureMessage, reason: why });
    else closeDialog();
  };

  const doRescreen = async () => {
    const ok = await run(
      rescreenUser ? "Account re-screen" : "Full re-screen",
      () => requestRescreen({ reason: rescreen.reason.trim(), ...(rescreenUser ? { userId: rescreenUser } : {}) }),
      (r) =>
        `Re-screen ${r.run.status}: ${r.run.subjects} account(s), ${r.run.hits} hit(s), ${r.run.failures} failure(s)${
          r.run.unreadable ? `, ${r.run.unreadable} identit${r.run.unreadable === 1 ? "y" : "ies"} unreadable (refused until read)` : ""
        }.`,
    );
    setConfirm(null);
    if (ok) setRescreen({ reason: "", userId: "" });
  };

  /** The audited identity read, on demand only. */
  const loadCompare = async (hit: ApiScreeningHit) => {
    const detail = await run("Identity read", () => fetchScreeningHit(hit.id), "Verified identity loaded (the read is audited).");
    if (detail) setCompare((c) => ({ ...c, [hit.id]: detail }));
  };

  return (
    <div className="space-y-6">
      <Card
        title="Screening lists"
        aside={
          <button type="button" className={btnQuiet} disabled={busy !== null} onClick={() => void reloadAll().catch(() => undefined)}>
            Refresh
          </button>
        }
      >
        <ErrorLine error={lists.error} />
        <RoleNote role="aml" />
        <div className="mb-4 grid gap-3 rounded-md border border-slate-200 px-3 py-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="List">
            <select className={field} value={form.list} onChange={(e) => setForm({ ...form, list: e.target.value as ScreeningListName })}>
              {SCREENING_LISTS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Version (as delivered)">
            <input className={field} value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} placeholder="e.g. 2026-10-18 / letter no." />
          </Field>
          <Field label="Delivered at (UTC)">
            <input className={field} type="datetime-local" value={form.deliveredAt} onChange={(e) => setForm({ ...form, deliveredAt: e.target.value })} />
          </Field>
          <Field label="Normalised CSV (at most 5 MB)">
            <input
              type="file"
              accept=".csv,text/csv"
              className="block w-full text-xs"
              disabled={amlHint !== null}
              onChange={(e) => {
                const picked = e.target.files?.[0] ?? null;
                const problem = importFileProblem(picked);
                setFileProblem(problem);
                setFile(null);
                if (!picked || problem) return;
                fileToBase64(picked)
                  .then((content) => setFile({ name: picked.name, size: picked.size, content }))
                  .catch(() => setFileProblem(`${picked.name} could not be read.`));
              }}
            />
          </Field>
          <Field label="Charset">
            <select className={field} value={form.charset} onChange={(e) => setForm({ ...form, charset: e.target.value as Charset })}>
              <option value="utf-8">utf-8</option>
              <option value="windows-1251">windows-1251</option>
            </select>
          </Field>
          <div className="flex items-end">
            <button
              type="button"
              className={btn}
              disabled={busy !== null || !importReady || amlHint !== null}
              title={amlHint ?? (importReady ? undefined : "Pick the file and fill in the version and delivery time.")}
              onClick={() => setConfirm("import")}
            >
              Import…
            </button>
          </div>
          {fileProblem && <p className="text-xs text-red-700 sm:col-span-2 lg:col-span-3">{fileProblem}</p>}
        </div>
        {(lists.data ?? []).length === 0 ? (
          <p className="text-sm text-slate-500">{lists.data === null ? "Loading…" : "No list imported yet."}</p>
        ) : (
          <table className={tableCls}>
            <thead className={theadCls}>
              <tr>
                <th className={th}>List</th>
                <th className={th}>Version</th>
                <th className={th}>Delivered / imported (UTC)</th>
                <th className={`${th} text-right`}>Entries</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(lists.data ?? []).map((l) => (
                <tr key={l.id}>
                  <td className={`${td} font-semibold`}>{l.list}</td>
                  <td className={`${td} text-xs`}>
                    {l.version}
                    <div className="font-mono text-[11px] text-slate-400" title={l.sha256}>
                      {l.charset} · sha256 {l.sha256.slice(0, 12)}…
                    </div>
                  </td>
                  <td className={`${td} text-xs`}>
                    {fmtDateTime(l.deliveredAt)} / {fmtDateTime(l.importedAt)}
                    {l.importedByPerson ? <div className="text-[11px] text-slate-400">by {l.importedByPerson}</div> : null}
                  </td>
                  <td className={`${td} text-right tabular-nums`}>{l.entryCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Screening hits">
        <ErrorLine error={hits.error} />
        <div className="mb-3 grid gap-3 sm:grid-cols-[auto_1fr]">
          <Field label="Status">
            <select className={field} value={hitStatus} onChange={(e) => setHitStatus(e.target.value as ScreeningHitStatus | "")}>
              {(["open", "confirmed", "cleared", ""] as const).map((s) => (
                <option key={s || "all"} value={s}>
                  {s || "all"}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Reason (kept with the decision)">
            <input className={field} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="documents compared, date of birth, ids" />
          </Field>
        </div>
        {(hits.data ?? []).length === 0 ? (
          <p className="text-sm text-slate-500">{hits.data === null ? "Loading…" : "No hits match."}</p>
        ) : (
          <table className={tableCls}>
            <thead className={theadCls}>
              <tr>
                <th className={th}>User</th>
                <th className={th}>List</th>
                <th className={th}>Match</th>
                <th className={th}></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(hits.data ?? []).map((h) => {
                const detail = compare[h.id];
                return (
                  <tr key={h.id}>
                    <td className={td}>
                      <Id value={h.userId} />
                      <div className="text-[11px] text-slate-400">{fmtDateTime(h.createdAt)}</div>
                    </td>
                    <td className={`${td} text-xs`}>
                      <Pill tone={h.list === "foreign" ? "warn" : "bad"}>{h.list}</Pill>
                      <div className="text-[11px] text-slate-500">
                        {h.listVersion} · {h.entryKind}
                        {h.freezeId ? " · froze the account" : ""}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {h.status}
                        {h.decidedAt ? ` · ${h.decidedByPerson ?? "?"} ${fmtDateTime(h.decidedAt)}` : ""}
                      </div>
                    </td>
                    <td className={`${td} max-w-[24rem] text-xs`}>
                      {screeningMatchLine(h)}
                      {h.decisionReason ? <div className="text-[11px] text-slate-500">&quot;{h.decisionReason}&quot;</div> : null}
                      {detail &&
                        (detail.identity ? (
                          <div className="mt-1 rounded bg-slate-50 px-2 py-1 text-[11px] text-slate-700">
                            Verified:{" "}
                            {detail.identity.names.map((n) => `${n.last} ${n.first}${n.middle ? ` ${n.middle}` : ""} (${n.script})`).join(" · ")}
                            {detail.identity.birthDate ? ` · born ${detail.identity.birthDate}` : ""}
                            {detail.identity.citizenship ? ` · citizen of ${detail.identity.citizenship}` : ""}
                            {detail.identity.residenceCountry ? ` · resident in ${detail.identity.residenceCountry}` : ""}
                          </div>
                        ) : (
                          <div className="mt-1 text-[11px] text-amber-700">
                            {detail.identityError ? `The verified identity could not be read: ${detail.identityError}` : "No verified identity on file."}
                          </div>
                        ))}
                    </td>
                    <td className={`${td} whitespace-nowrap text-right`}>
                      {!detail && h.match.basis === "name" && (
                        <button type="button" className={`${btnQuiet} ml-1`} disabled={busy !== null || amlHint !== null} onClick={() => void loadCompare(h)}>
                          Compare
                        </button>
                      )}
                      {screeningHitDecisions(h).map((d) => (
                        <button
                          key={d}
                          type="button"
                          className={`${d === "confirm" ? btnDanger : btnQuiet} ml-1`}
                          disabled={busy !== null || !reason.trim() || amlHint !== null}
                          title={amlHint ?? (reason.trim() ? undefined : "Write the reason first.")}
                          onClick={() => {
                            setSigning(null);
                            setConfirm({ hit: h, decision: d });
                          }}
                        >
                          {d}…
                        </button>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Re-screens">
        <ErrorLine error={runs.error} />
        <div className="mb-3 grid gap-3 sm:grid-cols-[2fr_2fr_auto] sm:items-end">
          <Field label="Reason (audited)">
            <input className={field} value={rescreen.reason} onChange={(e) => setRescreen({ ...rescreen, reason: e.target.value })} placeholder="why now" />
          </Field>
          <Field label="One account only (user id, optional)">
            <input className={field} value={rescreen.userId} onChange={(e) => setRescreen({ ...rescreen, userId: e.target.value })} placeholder="uuid; empty = everyone" />
          </Field>
          <button
            type="button"
            className={btnQuiet}
            disabled={busy !== null || !rescreenReady || amlHint !== null}
            title={amlHint ?? (rescreenReady ? undefined : "A reason, and a valid user id when one is given.")}
            onClick={() => setConfirm("rescreen")}
          >
            Re-screen now…
          </button>
        </div>
        {(runs.data ?? []).length === 0 ? (
          <p className="text-sm text-slate-500">{runs.data === null ? "Loading…" : "No re-screen yet."}</p>
        ) : (
          <table className={`${tableCls} text-xs`}>
            <thead className={theadCls}>
              <tr>
                <th className={th}>Started (UTC)</th>
                <th className={th}>Trigger / scope</th>
                <th className={th}>Status</th>
                <th className={`${th} text-right`}>Accounts / hits / failures / unreadable</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(runs.data ?? []).slice(0, 10).map((r) => (
                <tr key={r.id}>
                  <td className={`${td} whitespace-nowrap`}>{fmtDateTime(r.startedAt)}</td>
                  <td className={td}>
                    {r.trigger} · {r.scope}
                    {r.userId ? (
                      <div>
                        <Id value={r.userId} />
                      </div>
                    ) : null}
                  </td>
                  <td className={td}>
                    <Pill tone={r.status === "done" ? "ok" : r.status === "running" ? "pending" : "warn"}>{r.status}</Pill>
                    {r.error ? <div className="max-w-[14rem] truncate text-[11px] text-red-700" title={r.error}>{r.error}</div> : null}
                  </td>
                  <td className={`${td} text-right tabular-nums`}>
                    {r.subjects} / {r.hits} / {r.failures} / {r.unreadable ?? 0}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
        title={
          confirm === "import"
            ? `Import ${form.list} ${form.version.trim()}?`
            : confirm === "rescreen"
              ? rescreenUser
                ? `Re-screen account ${rescreenUser.slice(0, 8)}?`
                : "Re-screen every account now?"
              : confirm
                ? signing?.hitId === confirm.hit.id
                  ? "Sign the clear of this hit"
                  : `${confirm.decision === "confirm" ? "Confirm" : "Clear"} this hit?`
                : ""
        }
        description={
          confirm === "import"
            ? `${file?.name ?? "?"} (${file?.size ?? 0} bytes, ${form.charset}), delivered ${deliveredIso ?? "?"}. Every identity and party is re-screened; a hit on by_terror, un or decree48 freezes the user provisionally at once.`
            : confirm === "rescreen"
              ? `Every latest list version against ${rescreenUser ? "this account's" : "every account's"} verified identity and parties; new hits freeze provisionally (domestic lists) and raise alerts. Reason: "${rescreen.reason.trim()}".`
              : confirm
                ? signing?.hitId === confirm.hit.id
                  ? `${decisionText(confirm.hit, confirm.decision, signing.reason)} A clear lifts what the hit holds, so your operator wallet must sign this exact request: nothing is saved yet; the next click opens the wallet, then the clear goes out signed.`
                  : decisionText(confirm.hit, confirm.decision, reason.trim())
                : ""
        }
        confirmLabel={
          confirm === "import"
            ? "Import"
            : confirm === "rescreen"
              ? "Re-screen"
              : confirm && signing?.hitId === confirm.hit.id
                ? "Sign with wallet and clear"
                : "Decide"
        }
        destructive={confirm !== null && confirm !== "import" && confirm !== "rescreen" && confirm.decision === "confirm"}
        busy={busy !== null}
        onConfirm={() => {
          if (confirm === "import") void doImport();
          else if (confirm === "rescreen") void doRescreen();
          else if (confirm) void decide(confirm.hit, confirm.decision);
        }}
      />
    </div>
  );
}
