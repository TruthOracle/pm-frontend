/**
 * Every ramp order of the account, newest first, paged by the server's cursor (`GET
 * /ramp/orders?cursor&limit`). Each line opens the order page; an order still waiting for the
 * person can be paid, signed or cancelled from here.
 */
import { useCallback, useEffect, useState } from "react";
import { History, Loader2 } from "lucide-react";
import { fetchRampOrders, rampErrorMessage, type RampOrder } from "@/lib/ramp";
import { SectionCard, smallBtn } from "@/components/Account/accountUi";
import { RampOrderLine } from "./RampOrderLine";

const PAGE = 20;

export function RampOrdersHistory() {
  const [orders, setOrders] = useState<RampOrder[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (from: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const page = await fetchRampOrders({ cursor: from, limit: PAGE });
      setOrders((prev) => {
        const base = from ? prev : [];
        const seen = new Set(base.map((o) => o.id));
        return [...base, ...(page.orders ?? []).filter((o) => !seen.has(o.id))];
      });
      setCursor(page.nextCursor ?? null);
    } catch (e) {
      setError(rampErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(null);
  }, [load]);

  const replace = (next: RampOrder) => setOrders((list) => list.map((o) => (o.id === next.id ? next : o)));

  return (
    <SectionCard
      id="orders"
      icon={<History className="h-4 w-4" />}
      title="Orders"
      description="Purchases and cash-outs. Times are in UTC."
    >
      {orders.length === 0 && !loading && !error && <p className="text-sm text-slate-500">No orders yet.</p>}
      <ul className="divide-y divide-slate-100">
        {orders.map((o) => (
          <RampOrderLine key={o.id} order={o} onChanged={replace} showDate />
        ))}
      </ul>
      {error && (
        <p className="mt-2 text-xs text-red-700">
          {error}{" "}
          <button
            type="button"
            className="font-semibold underline"
            onClick={() => void load(orders.length ? cursor : null)}
          >
            Retry
          </button>
        </p>
      )}
      {loading && (
        <p className="mt-2 flex items-center gap-2 text-xs text-slate-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
        </p>
      )}
      {!loading && cursor && (
        <button type="button" className={`${smallBtn} mt-3`} onClick={() => void load(cursor)}>
          Load more
        </button>
      )}
    </SectionCard>
  );
}

export default RampOrdersHistory;
