import { useCallback, useEffect, useState } from "react";
import { useCantonWallet } from "@/wallets";
import { fetchPendingPayouts, type PendingPayoutRecord } from "@/utils/activeContracts";
import { Clock3 } from "lucide-react";

/**
 * Lists CC payouts the admin owes the connected user. Each row comes from a
 * `PendingPayout` contract on-ledger — Sell, Merge, and resolved-winner shares
 * all flow through this queue. Admin marks each one paid after the actual CC
 * transfer goes out via the Enterprise Wallet.
 */
function PendingPayouts() {
  const { account } = useCantonWallet();
  const [rows, setRows] = useState<PendingPayoutRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!account?.address) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      const list = await fetchPendingPayouts(account.address);
      setRows(list.filter((r) => r.user === account.address));
    } finally {
      setLoading(false);
    }
  }, [account?.address]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!account) return null;

  const total = rows.reduce((sum, r) => sum + r.amountCC, 0);

  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl shadow-slate-200/60">
      <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <div className="flex items-center gap-2">
            <Clock3 className="h-4 w-4 text-primary" />
            <h2 className="text-base font-extrabold text-slate-950">Pending Payouts</h2>
          </div>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">
            CC owed after sells, merged pairs, or resolved winning shares. Admin pays asynchronously via the Enterprise
            Wallet.
          </p>
        </div>
        <div className="rounded-md border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm font-bold text-primary">
          {total.toFixed(4)} CC
        </div>
      </div>

      {loading && rows.length === 0 ? (
        <div className="px-6 py-8 text-center text-sm text-slate-500">Loading payouts...</div>
      ) : rows.length === 0 ? (
        <div className="px-6 py-8 text-center text-sm text-slate-500">No pending payouts.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-5 py-3 font-bold sm:px-6">Market</th>
                <th className="px-5 py-3 font-bold sm:px-6">Reason</th>
                <th className="px-5 py-3 text-right font-bold sm:px-6">Amount</th>
                <th className="px-5 py-3 font-bold sm:px-6">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {rows.map((r) => (
                <tr key={r.contractId} className="transition-colors hover:bg-slate-50">
                  <td className="px-5 py-4 font-bold text-slate-950 sm:px-6">#{r.marketId}</td>
                  <td className="px-5 py-4 sm:px-6">{r.reason}</td>
                  <td className="px-5 py-4 text-right font-bold text-primary sm:px-6">{r.amountCC.toFixed(4)} CC</td>
                  <td className="px-5 py-4 text-slate-500 sm:px-6">{new Date(r.createdAt * 1000).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default PendingPayouts;
