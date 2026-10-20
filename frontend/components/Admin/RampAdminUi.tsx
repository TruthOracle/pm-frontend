/**
 * Shared plumbing of the ramp console cards (Ramp*.tsx, Compliance*.tsx, PayoutQueue): the same
 * busy-state / reload / toast run as adminUi's `useRun`, but with the operator sentences of
 * lib/rampAdminErrors.ts and approval-aware toasts (a request that awaits a second person is news,
 * not success); a loader for a panel's data; file downloads; and the small views every card shows.
 */
import { Fragment, useCallback, useEffect, useState, type ReactNode } from "react";
import { useToast } from "@chakra-ui/react";
import type { BackendDownload } from "@/lib/backend";
import { approvalTone, isSignatureStep, outcomeSentence, roleHint } from "@/lib/rampAdmin";
import { rampAdminErrorMessage } from "@/lib/rampAdminErrors";
import type { ApprovalFigure } from "@/lib/rampApprovalFigures";
import type { AdminRole, ApiApproval, ApiApprovalOutcome } from "@/lib/rampAdminTypes";
import { Pill, fmtDateTime } from "@/components/Account/accountUi";
import { truncateId } from "./adminUi";
import { useRampAdmin } from "./RampAdminSession";

export const th = "py-1.5 pr-3 font-bold";
export const td = "py-1.5 pr-3 align-top";
export const tableCls = "w-full text-left text-sm";
export const theadCls = "text-xs uppercase text-slate-500";

/** Resolves to the action's result, or null when it failed (the failure is already toasted). */
export type RampRun = <T>(what: string, fn: () => Promise<T>, done?: string | ((result: T) => string)) => Promise<T | null>;

function isOutcome(value: unknown): value is ApiApprovalOutcome {
  return Boolean(value && typeof value === "object" && "approval" in value && (value as { approval?: unknown }).approval);
}

export function useRampRun(reload?: () => Promise<void>): { busy: string | null; run: RampRun } {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback<RampRun>(
    async (what, fn, done) => {
      setBusy(what);
      try {
        const result = await fn();
        try {
          await reload?.();
        } catch (e) {
          toast({ title: `${what} went through, but the console could not reload`, description: rampAdminErrorMessage(e), status: "warning", duration: 8000, isClosable: true });
        }
        // A request that waits for a second person, or for the operator's own signature (C23), is news, not success.
        const pending = (isOutcome(result) && result.approval.status === "pending") || isSignatureStep(result);
        const failed = isOutcome(result) && result.approval.status === "failed";
        const title =
          typeof done === "function"
            ? done(result)
            : done ??
              (isOutcome(result)
                ? outcomeSentence(what, result)
                : isSignatureStep(result)
                  ? `${what}: sign it with your wallet to decide (nothing was saved yet).`
                  : `${what}: done.`);
        toast({ title, status: failed ? "warning" : pending ? "info" : "success", duration: pending ? 9000 : 5000, isClosable: true });
        return result;
      } catch (e) {
        toast({ title: `${what} failed`, description: rampAdminErrorMessage(e), status: "error", duration: 9000, isClosable: true });
        return null;
      } finally {
        setBusy(null);
      }
    },
    [reload, toast],
  );
  return { busy, run };
}

/**
 * A panel's data: loaded once `ready`, reloadable, with the operator sentence of a failure. `load`
 * must be stable (useCallback) — it is the effect's dependency. Data is kept with the `load` that
 * read it and shown only while that `load` is current: another subject (a new order id, other
 * filters) reads as loading, never as the previous subject's figures under the new title.
 */
export function usePanelData<T>(load: () => Promise<T>, ready: boolean): { data: T | null; error: string | null; reload: () => Promise<void> } {
  const [loaded, setLoaded] = useState<{ load: () => Promise<T>; data: T } | null>(null);
  const [failed, setFailed] = useState<{ load: () => Promise<T>; error: string } | null>(null);
  const reload = useCallback(async () => {
    try {
      setLoaded({ load, data: await load() });
      setFailed(null);
    } catch (e) {
      setFailed({ load, error: rampAdminErrorMessage(e) });
      throw e;
    }
  }, [load]);
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    load()
      .then((value) => {
        if (!cancelled) {
          setLoaded({ load, data: value });
          setFailed(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setFailed({ load, error: rampAdminErrorMessage(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [ready, load]);
  return {
    data: loaded !== null && loaded.load === load ? loaded.data : null,
    error: failed !== null && failed.load === load ? failed.error : null,
    reload,
  };
}

/** `value`, settled for `ms`: a typed filter refetches once the operator pauses, not on every keystroke. */
export function useDebounced<T>(value: T, ms = 400): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/** Hand a downloaded file to the browser's save flow. */
export function saveDownload(file: BackendDownload): void {
  const url = URL.createObjectURL(file.blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** One approval in a line: status, action, id, who asked and until when. */
export function ApprovalLine({ approval }: { approval: ApiApproval }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
      <Pill tone={approvalTone(approval.status)}>{approval.status}</Pill>
      <code className="font-mono text-slate-800">{approval.action}</code>
      <span title={approval.id}>#{approval.id.slice(0, 8)}</span>
      <span>
        by {approval.requestedByPerson ?? (approval.requestedByParty ? truncateId(approval.requestedByParty) : "?")} · {fmtDateTime(approval.requestedAt)}
      </span>
      {approval.status === "pending" && approval.expiresAt && <span>expires {fmtDateTime(approval.expiresAt)}</span>}
      {approval.error && <span className="text-red-700">{approval.error}</span>}
    </div>
  );
}

/**
 * An approval's figures (lib/rampApprovalFigures.ts), what the decision moves first. Spans only, so
 * it also sits inside a confirm dialog's description paragraph.
 */
export function FigureList({ figures }: { figures: readonly ApprovalFigure[] }) {
  if (figures.length === 0) return null;
  return (
    <span className="mt-1 grid gap-x-3 gap-y-0.5 text-left text-xs sm:grid-cols-[auto_1fr]">
      {figures.map((f, i) => (
        <Fragment key={`${f.label}-${i}`}>
          <span className="text-slate-500">{f.label}</span>
          <span className={f.strong ? "font-semibold text-slate-950" : "text-slate-800"}>{f.value}</span>
        </Fragment>
      ))}
    </span>
  );
}

/** The requester's own words, set apart from the system's figures: their claim, not a fact. */
export function RequesterClaim({ approval }: { approval: ApiApproval }) {
  const who = approval.requestedByPerson ?? (approval.requestedByParty ? truncateId(approval.requestedByParty) : "?");
  return (
    <span className="mt-2 block border-l-2 border-slate-300 pl-2 text-left text-xs text-slate-600">
      <span className="font-semibold text-slate-500">{who}&apos;s reason (their words):</span> <q className="italic">{approval.reason}</q>
    </span>
  );
}

/** The role a control needs, when the operator lacks it (the control is disabled with this as its reason). */
export function useRoleHint(role: AdminRole): string | null {
  return roleHint(useRampAdmin().session, role);
}

export function RoleNote({ role }: { role: AdminRole }) {
  const hint = useRoleHint(role);
  return hint ? <p className="mb-2 text-[11px] text-amber-700">{hint} The controls below stay disabled.</p> : null;
}

export function ErrorLine({ error }: { error: string | null }) {
  return error ? <p className="mb-3 text-xs text-red-700">{error}</p> : null;
}

/** Collapsible raw JSON for the fields the console does not render one by one (details, figures, params). */
export function JsonBlock({ label, value }: { label: string; value: unknown }) {
  if (value === undefined || value === null || (typeof value === "object" && Object.keys(value as object).length === 0)) return null;
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer font-semibold text-slate-600">{label}</summary>
      <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-slate-50 p-2 font-mono text-[11px] text-slate-700">{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

export function Field({ label: text, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold text-slate-600">{text}</label>
      {children}
    </div>
  );
}

/** The short form of an id in a cell, the full value on hover. */
export function Id({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-slate-400">—</span>;
  return (
    <code className="font-mono text-xs" title={value}>
      {truncateId(value, 8, 4)}
    </code>
  );
}
