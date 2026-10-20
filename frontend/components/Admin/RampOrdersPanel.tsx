/**
 * The ramp order queue (truthoracle-backend docs/RAMP.md §4, §12.2): `needs_review` first by
 * default, filters by status, direction and user, cursor paging. Picking an order opens its detail
 * (RampOrderDetail) with the §4.2 actions; every money-moving action there is a four-eyes request.
 */
import { useCallback, useEffect, useState } from "react";
import { fetchAdminRampOrders } from "@/lib/backendAdmin";
import { fiatLabel, rampStatusTone } from "@/lib/rampAdmin";
import { RAMP_STATUSES, type ApiAdminRampOrder, type RampDirection, type RampStatus } from "@/lib/rampAdminTypes";
import { formatMoney } from "@/lib/instruments";
import { Pill, fmtDateTime } from "@/components/Account/accountUi";
import { btnQuiet, Card, field } from "./adminUi";
import { useBackendOperator } from "./BackendOperatorSession";
import { ErrorLine, Field, Id, td, th, tableCls, theadCls, useDebounced } from "./RampAdminUi";
import { rampAdminErrorMessage } from "@/lib/rampAdminErrors";
import RampOrderDetail from "./RampOrderDetail";

export default function RampOrdersPanel() {
  const { ready } = useBackendOperator();
  const [filters, setFilters] = useState({ status: "needs_review" as RampStatus | "", direction: "" as RampDirection | "", userId: "" });
  const [orders, setOrders] = useState<ApiAdminRampOrder[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const applied = useDebounced(filters);
  const load = useCallback(
    async (cursor: string | null) => {
      setLoading(true);
      try {
        const page = await fetchAdminRampOrders({ status: applied.status, direction: applied.direction, userId: applied.userId.trim(), cursor });
        setOrders((prev) => (cursor && prev ? [...prev, ...page.items] : page.items));
        setNextCursor(page.nextCursor ?? null);
        setError(null);
      } catch (e) {
        setError(rampAdminErrorMessage(e));
      } finally {
        setLoading(false);
      }
    },
    [applied],
  );

  useEffect(() => {
    if (ready) void load(null);
  }, [ready, load]);

  if (!ready) return null;

  return (
    <div className="space-y-6">
      <Card
        title="Ramp orders"
        aside={
          <button type="button" className={btnQuiet} disabled={loading} onClick={() => void load(null)}>
            Refresh
          </button>
        }
      >
        <ErrorLine error={error} />
        <div className="mb-3 grid gap-3 sm:grid-cols-3">
          <Field label="Status">
            <select className={field} value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value as RampStatus | "" })}>
              <option value="">all</option>
              {RAMP_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Direction">
            <select className={field} value={filters.direction} onChange={(e) => setFilters({ ...filters, direction: e.target.value as RampDirection | "" })}>
              <option value="">both</option>
              <option value="onramp">on-ramp (buy)</option>
              <option value="offramp">off-ramp (cash-out)</option>
            </select>
          </Field>
          <Field label="User account id">
            <input className={field} value={filters.userId} onChange={(e) => setFilters({ ...filters, userId: e.target.value })} placeholder="uuid (optional)" />
          </Field>
        </div>
        {orders === null ? (
          <p className="text-sm text-slate-500">{loading ? "Loading…" : ""}</p>
        ) : orders.length === 0 ? (
          <p className="text-sm text-slate-500">No orders match.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className={tableCls}>
              <thead className={theadCls}>
                <tr>
                  <th className={th}>Created (UTC)</th>
                  <th className={th}>Order</th>
                  <th className={th}>Status</th>
                  <th className={th}>Method / rail</th>
                  <th className={`${th} text-right`}>Fiat</th>
                  <th className={`${th} text-right`}>Token</th>
                  <th className={th}>User</th>
                  <th className={th}>Last error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {orders.map((o) => (
                  <tr
                    key={o.id}
                    className={`cursor-pointer hover:bg-slate-50 ${selected === o.id ? "bg-sky-50" : ""}`}
                    onClick={() => setSelected(o.id)}
                  >
                    <td className={`${td} whitespace-nowrap text-xs`}>{fmtDateTime(o.createdAt)}</td>
                    <td className={td}>
                      <Id value={o.id} />
                      {o.payoutReference && <div className="font-mono text-[11px] text-slate-500">{o.payoutReference}</div>}
                    </td>
                    <td className={td}>
                      <Pill tone={rampStatusTone(o.status)}>{o.status}</Pill>
                      {o.reviewStep && <div className="text-[11px] text-slate-500">step: {o.reviewStep}</div>}
                    </td>
                    <td className={`${td} text-xs`}>
                      {o.direction === "onramp" ? "buy" : "cash-out"} · {o.method ?? o.rail ?? "—"}
                    </td>
                    <td className={`${td} text-right tabular-nums`}>{fiatLabel(o.fiatAmount, o.fiatCurrency)}</td>
                    <td className={`${td} text-right tabular-nums`}>{formatMoney(o.tokenAmount, o.instrument)}</td>
                    <td className={td}>
                      <Id value={o.userId} />
                    </td>
                    <td className={`${td} max-w-[14rem] truncate text-xs text-red-700`} title={o.lastError ?? undefined}>
                      {o.lastError ?? ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {nextCursor && (
          <button type="button" className={`${btnQuiet} mt-3`} disabled={loading} onClick={() => void load(nextCursor)}>
            Load more
          </button>
        )}
      </Card>
      {selected && (
        // Keyed: another order starts with no reason, account id, choice or "last request" of the previous one.
        <RampOrderDetail key={selected} orderId={selected} onClose={() => setSelected(null)} onChanged={() => void load(null)} />
      )}
    </div>
  );
}
