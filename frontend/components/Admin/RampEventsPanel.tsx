/**
 * Acquirer webhook events that never applied (truthoracle-backend docs/RAMP.md §8, `events_dead`;
 * C31). A stored event that kept failing for RAMP_EVENT_DEAD_AFTER_HOURS is dead: nothing retries
 * it, and a dead chargeback pages every hour. Replay (role `ops`, single control) re-arms it: the
 * processor re-reads the payment or payout from the provider, so a purged payload does not matter.
 * Close (four-eyes `ramp.event.close`: `ops` asks, `approver` approves under Approvals) ends it by
 * hand once its effects are applied by hand, or when it applies to nothing; a row with a pending
 * close says so and offers no second request. Fields, envelopes and roles follow the backend's
 * admin-ramp.controller.ts (`GET …/events`, `POST …/events/:id/replay|close`). Cursor paging, UTC times.
 */
import { useCallback, useEffect, useState } from "react";
import { fetchPendingEventCloses, fetchRampEvents, replayRampEvent, requestRampEventClose } from "@/lib/backendAdmin";
import { rampEventActions, rampEventState, rampEventTone } from "@/lib/rampAdmin";
import { rampAdminErrorMessage } from "@/lib/rampAdminErrors";
import type { ApiAdminRampEvent, ApiApproval, RampEventFilter } from "@/lib/rampAdminTypes";
import { ConfirmDialog, Pill, fmtDateTime } from "@/components/Account/accountUi";
import { btnDanger, btnQuiet, Card, field } from "./adminUi";
import { useBackendOperator } from "./BackendOperatorSession";
import { ErrorLine, Field, Id, RoleNote, td, th, tableCls, theadCls, useRampRun, useRoleHint } from "./RampAdminUi";

type Act = { kind: "replay" | "close"; event: ApiAdminRampEvent };

export default function RampEventsPanel() {
  const { ready } = useBackendOperator();
  const opsHint = useRoleHint("ops");
  const [filter, setFilter] = useState<RampEventFilter>("dead");
  const [events, setEvents] = useState<ApiAdminRampEvent[] | null>(null);
  // Pending `ramp.event.close` requests by event id (null when Approvals could not be read).
  const [closes, setCloses] = useState<Map<string, ApiApproval> | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reason, setReason] = useState("");
  const [act, setAct] = useState<Act | null>(null);

  const load = useCallback(
    async (cursor: string | null) => {
      setLoading(true);
      try {
        const [page, pendingCloses] = await Promise.all([
          fetchRampEvents({ status: filter, cursor }),
          fetchPendingEventCloses().catch(() => null),
        ]);
        setEvents((prev) => (cursor && prev ? [...prev, ...page.items] : page.items));
        setCloses(pendingCloses);
        setNextCursor(page.nextCursor ?? null);
        setError(null);
      } catch (e) {
        setError(rampAdminErrorMessage(e));
      } finally {
        setLoading(false);
      }
    },
    [filter],
  );
  const reload = useCallback(() => load(null), [load]);
  const { busy, run } = useRampRun(reload);

  useEffect(() => {
    if (ready) void load(null);
  }, [ready, load]);

  if (!ready) return null;

  const doAct = async (a: Act) => {
    const why = reason.trim();
    const ok =
      a.kind === "replay"
        ? await run("Event replay", () => replayRampEvent(a.event.id, { reason: why }), "Event re-armed: the processor re-reads the provider and applies it.")
        : await run("Event close", () => requestRampEventClose(a.event.id, { reason: why }));
    setAct(null);
    if (ok) setReason("");
  };

  return (
    <Card
      title="Webhook events"
      aside={
        <button type="button" className={btnQuiet} disabled={loading} onClick={() => void load(null)}>
          Refresh
        </button>
      }
    >
      <ErrorLine error={error} />
      <RoleNote role="ops" />
      <div className="mb-3 grid gap-3 sm:grid-cols-[1fr_3fr]">
        <Field label="Show">
          <select className={field} value={filter} onChange={(e) => setFilter(e.target.value as RampEventFilter)}>
            <option value="dead">dead (nothing retries them)</option>
            <option value="unprocessed">every unapplied event</option>
          </select>
        </Field>
        <Field label="Reason (audited; replay or close)">
          <input className={field} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="PSP outage fixed; chargeback applied by hand, ticket" />
        </Field>
      </div>
      {events === null ? (
        <p className="text-sm text-slate-500">{loading ? "Loading…" : ""}</p>
      ) : events.length === 0 ? (
        <p className="text-sm text-slate-500">{filter === "dead" ? "No dead events." : "Every event is applied."}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className={tableCls}>
            <thead className={theadCls}>
              <tr>
                <th className={th}>Received (UTC)</th>
                <th className={th}>Event</th>
                <th className={th}>Order</th>
                <th className={th}>State</th>
                <th className={th}>Last error</th>
                <th className={th}></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {events.map((e) => {
                const state = rampEventState(e);
                const can = rampEventActions(e);
                const closing = closes?.get(e.id) ?? null;
                const blocked = busy !== null || !reason.trim() || opsHint !== null;
                const why = opsHint ?? (reason.trim() ? undefined : "Write the reason first.");
                return (
                  <tr key={e.id}>
                    <td className={`${td} whitespace-nowrap text-xs`}>
                      {fmtDateTime(e.receivedAt)}
                      <div className="text-[11px] text-slate-500">occurred {fmtDateTime(e.occurredAt)}</div>
                    </td>
                    <td className={`${td} text-xs`}>
                      <strong>{e.type}</strong> · {e.kind}
                      {e.sandbox ? " · sandbox" : ""}
                      <div className="text-[11px] text-slate-500">
                        {e.provider} · object <code className="font-mono">{e.objectId}</code>
                      </div>
                      <Id value={e.id} />
                    </td>
                    <td className={td}>
                      <Id value={e.orderId ?? null} />
                    </td>
                    <td className={`${td} text-xs`}>
                      <Pill tone={rampEventTone(state)}>{state}</Pill>
                      <div className="text-[11px] text-slate-500">
                        {e.attempts} attempt(s)
                        {e.lastAttemptAt ? ` · last ${fmtDateTime(e.lastAttemptAt)}` : ""}
                        {e.deadAt ? ` · dead ${fmtDateTime(e.deadAt)}` : e.nextAttemptAt ? ` · next ${fmtDateTime(e.nextAttemptAt)}` : ""}
                        {e.replayedAt ? ` · replayed ${fmtDateTime(e.replayedAt)}` : ""}
                      </div>
                      {closing && (
                        <div className="text-[11px] text-amber-700">
                          close requested by {closing.requestedByPerson ?? "?"} (#{closing.id.slice(0, 8)}): an approver decides it under Approvals
                        </div>
                      )}
                    </td>
                    <td className={`${td} max-w-[16rem] truncate text-xs text-red-700`} title={e.error ?? undefined}>
                      {e.error ?? ""}
                    </td>
                    <td className={`${td} whitespace-nowrap text-right`}>
                      {can.replay && (
                        <button type="button" className={btnQuiet} disabled={blocked} title={why} onClick={() => setAct({ kind: "replay", event: e })}>
                          Replay…
                        </button>
                      )}
                      {can.close && !closing && (
                        <button type="button" className={`${btnDanger} ml-1`} disabled={blocked} title={why} onClick={() => setAct({ kind: "close", event: e })}>
                          Close…
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {nextCursor && (
        <button type="button" className={`${btnQuiet} mt-3`} disabled={loading} onClick={() => void load(nextCursor)}>
          Load more
        </button>
      )}
      <ConfirmDialog
        open={act !== null}
        onOpenChange={(open) => {
          if (!open) setAct(null);
        }}
        title={act ? `${act.kind === "replay" ? "Replay" : "Close"} the ${act.event.type} event?` : ""}
        description={
          act
            ? act.kind === "replay"
              ? `Re-arms event ${act.event.id.slice(0, 8)} (object ${act.event.objectId}): the processor re-reads the provider and applies what it finds. Reason: "${reason.trim()}".`
              : `Closes event ${act.event.id.slice(0, 8)} by hand without applying it: only once its effects are applied by hand, or it applies to nothing. A second person with the approver role must approve it. Reason: "${reason.trim()}".`
            : ""
        }
        confirmLabel={act?.kind === "close" ? "Request close" : "Replay"}
        destructive={act?.kind === "close"}
        busy={busy !== null}
        onConfirm={() => {
          if (act) void doAct(act);
        }}
      />
    </Card>
  );
}
