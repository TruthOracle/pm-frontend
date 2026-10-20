/**
 * The fiat ramp section of the operator console (truthoracle-backend docs/RAMP.md §12.2): who the
 * operator is (person and roles from `GET /admin/session`) and one tab bar over the ramp cards, so
 * only the open tab loads. Every card renders nothing until the backend operator session is ready;
 * money moves are four-eyes requests decided under Approvals.
 */
import { useState, type ReactNode } from "react";
import { ADMIN_ROLES } from "@/lib/rampAdminTypes";
import { Pill } from "@/components/Account/accountUi";
import { btnQuiet } from "./adminUi";
import { useBackendOperator } from "./BackendOperatorSession";
import { useRampAdmin } from "./RampAdminSession";
import RampApprovalsPanel from "./RampApprovalsPanel";
import RampOrdersPanel from "./RampOrdersPanel";
import RampControlsPanel from "./RampControlsPanel";
import RampTokenCommandsPanel from "./RampTokenCommandsPanel";
import RampBatchesPanel from "./RampBatchesPanel";
import RampStatementsPanel from "./RampStatementsPanel";
import RampBankAccountsPanel from "./RampBankAccountsPanel";
import RampExportsPanel from "./RampExportsPanel";
import RampEventsPanel from "./RampEventsPanel";
import ComplianceAlertsPanel from "./ComplianceAlertsPanel";
import ComplianceKycOverridePanel from "./ComplianceKycOverridePanel";
import ComplianceScreeningPanel from "./ComplianceScreeningPanel";
import ComplianceFreezesPanel from "./ComplianceFreezesPanel";

const TABS: { key: string; label: string; render: () => ReactNode }[] = [
  { key: "approvals", label: "Approvals", render: () => <RampApprovalsPanel /> },
  { key: "orders", label: "Orders", render: () => <RampOrdersPanel /> },
  { key: "controls", label: "Halts & reconciliation", render: () => <RampControlsPanel /> },
  { key: "tokens", label: "Token commands", render: () => <RampTokenCommandsPanel /> },
  { key: "events", label: "Webhook events", render: () => <RampEventsPanel /> },
  {
    key: "bank",
    label: "Bank",
    render: () => (
      <>
        <RampBatchesPanel />
        <RampStatementsPanel />
        <RampBankAccountsPanel />
      </>
    ),
  },
  {
    key: "compliance",
    label: "Compliance",
    render: () => (
      <>
        <ComplianceAlertsPanel />
        <ComplianceScreeningPanel />
        <ComplianceFreezesPanel />
        <ComplianceKycOverridePanel />
      </>
    ),
  },
  { key: "exports", label: "Exports", render: () => <RampExportsPanel /> },
];

export default function RampConsole() {
  const { ready } = useBackendOperator();
  const { session, loadError, signaturesRequired, reload } = useRampAdmin();
  const [tab, setTab] = useState(TABS[0].key);

  if (!ready) return null;
  const current = TABS.find((t) => t.key === tab) ?? TABS[0];

  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold text-slate-950">Fiat ramp (BYN ⇄ cBYN)</h2>
          <div className="flex flex-wrap items-center gap-1 text-xs text-slate-600">
            {session ? (
              <>
                <span>
                  {session.personId} ·
                </span>
                {ADMIN_ROLES.map((r) => (
                  <Pill key={r} tone={session.roles.includes(r) ? "ok" : "neutral"}>
                    {session.roles.includes(r) ? r : `no ${r}`}
                  </Pill>
                ))}
              </>
            ) : (
              <span>{loadError ? `Roles unavailable: ${loadError}` : "Roles unknown: every control shows; the backend enforces them."}</span>
            )}
            <span>· decisions {signaturesRequired ? "wallet-signed" : "unsigned (dev)"}</span>
            {session && <span>· {session.dualControl ? "four-eyes" : "dual control off: requests execute at once (dev)"}</span>}
            {loadError && (
              <button type="button" className={btnQuiet} onClick={() => void reload()}>
                Retry
              </button>
            )}
          </div>
        </div>
        <nav className="mt-4 flex flex-wrap gap-1" aria-label="Ramp console sections">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              aria-current={t.key === current.key ? "page" : undefined}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                t.key === current.key ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-700 hover:bg-slate-100"
              }`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>
      <div className="space-y-6">{current.render()}</div>
    </section>
  );
}
