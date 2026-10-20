/**
 * The ramp operations export (truthoracle-backend docs/RAMP.md §11.6): every order of up to 31 UTC
 * days with its facts, provider ids, payout reference and the KYC name — the file of record for the
 * operator's own books and an inspection. Role `export`; a POST download, rate-limited and audited
 * by the backend (row count, operator). The file holds personal data: store it accordingly.
 */
import { useState } from "react";
import { exportRampOperations } from "@/lib/backendAdmin";
import { exportRange } from "@/lib/rampAdmin";
import { RampAdminError } from "@/lib/rampAdminErrors";
import { ConfirmDialog } from "@/components/Account/accountUi";
import { btn, Card, field } from "./adminUi";
import { useBackendOperator } from "./BackendOperatorSession";
import { Field, RoleNote, saveDownload, useRampRun, useRoleHint } from "./RampAdminUi";

export default function RampExportsPanel() {
  const { ready } = useBackendOperator();
  const exportHint = useRoleHint("export");
  const { busy, run } = useRampRun();
  const [range, setRange] = useState({ from: "", to: "" });
  const [confirm, setConfirm] = useState(false);

  if (!ready) return null;
  const window_ = exportRange(range.from, range.to);

  const download = async () => {
    const file = await run(
      "Operations export",
      async () => {
        if ("problem" in window_) throw new RampAdminError(window_.problem);
        return exportRampOperations(window_);
      },
      (f) => `Downloaded ${f.filename}.`,
    );
    setConfirm(false);
    if (file) saveDownload(file);
  };

  return (
    <Card title="Operations export">
      <RoleNote role="export" />
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Field label="From (UTC day)">
          <input className={field} type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
        </Field>
        <Field label="To (UTC day, inclusive)">
          <input className={field} type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
        </Field>
        <button
          type="button"
          className={btn}
          disabled={busy !== null || "problem" in window_ || exportHint !== null}
          title={exportHint ?? ("problem" in window_ ? window_.problem : undefined)}
          onClick={() => setConfirm(true)}
        >
          Export…
        </button>
      </div>
      <p className="mt-2 text-[11px] text-slate-400">At most 31 days per file and 10 exports an hour per operator. The CSV is in human mode (formula-safe cells).</p>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Export ramp operations?"
        description={`${"problem" in window_ ? window_.problem : `${window_.from} → ${window_.to}`}. The file includes verified names and payment facts; the export is audited.`}
        confirmLabel="Download"
        busy={busy !== null}
        onConfirm={() => void download()}
      />
    </Card>
  );
}
