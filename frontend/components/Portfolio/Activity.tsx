import { useCantonWallet } from "@/wallets";
import { useCallback, useEffect, useState } from "react";
import {
  fetchAllPredictionMarkets,
  fetchAllResolvedMarkets,
  fetchAllUserMarketDataPositions,
  type PredictionMarketRecord,
  type ResolvedMarketRecord,
  type UserMarketPosition,
} from "@/utils/activeContracts";
import { Activity as ActivityIcon } from "lucide-react";

/**
 * One row per market the user has a position in. Combines on-ledger UserMarketData
 * with the active/resolved PredictionMarket so we can render the question + option labels.
 */
type ActivityRow = {
  position: UserMarketPosition;
  market: PredictionMarketRecord | ResolvedMarketRecord | null;
  /** "active" if PredictionMarket, "resolved" if ResolvedMarket, "unknown" if neither found. */
  state: "active" | "resolved" | "unknown";
  /** Resolved market result, only set when state === "resolved". */
  result?: string;
  /** Payout for this position if resolved (winning shares × payoutPerShareCC). */
  payout?: number;
};

function buildRows(
  positions: UserMarketPosition[],
  actives: PredictionMarketRecord[],
  resolved: ResolvedMarketRecord[],
): ActivityRow[] {
  const activeById = new Map(actives.map((m) => [m.marketId, m]));
  const resolvedById = new Map(resolved.map((m) => [m.marketId, m]));

  return positions.map((position) => {
    const active = activeById.get(position.marketId);
    if (active) {
      return { position, market: active, state: "active" as const };
    }
    const done = resolvedById.get(position.marketId);
    if (done) {
      const winningShares = done.result === "Yes" ? position.yesShares : done.result === "No" ? position.noShares : 0;
      return {
        position,
        market: done,
        state: "resolved" as const,
        result: done.result,
        payout: winningShares * done.payoutPerShareCC,
      };
    }
    return { position, market: null, state: "unknown" as const };
  });
}

function Activity() {
  const { account } = useCantonWallet();
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchBets = useCallback(async () => {
    if (!account?.address) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      const [positions, actives, resolved] = await Promise.all([
        fetchAllUserMarketDataPositions(account.address),
        fetchAllPredictionMarkets(),
        fetchAllResolvedMarkets(),
      ]);
      setRows(buildRows(positions, actives, resolved));
    } finally {
      setLoading(false);
    }
  }, [account?.address]);

  useEffect(() => {
    fetchBets();
  }, [fetchBets]);

  // Expose so MarketView.handleBuyClick can refresh us after a trade commits.
  useEffect(() => {
    (window as unknown as { refreshPortfolio?: () => void }).refreshPortfolio = fetchBets;
    return () => {
      delete (window as unknown as { refreshPortfolio?: () => void }).refreshPortfolio;
    };
  }, [fetchBets]);

  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl shadow-slate-200/60">
      <div className="border-b border-slate-200 px-5 py-4 sm:px-6">
        <div className="flex items-center gap-2">
          <ActivityIcon className="h-4 w-4 text-primary" />
          <h2 className="text-base font-extrabold text-slate-950">Trading Activity</h2>
        </div>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          Your active positions, resolved markets, invested CC, shares, and payouts.
        </p>
      </div>

      {loading ? (
        <div className="px-6 py-8 text-center text-sm text-slate-500">Loading positions...</div>
      ) : rows.length === 0 ? (
        <div className="px-6 py-8 text-center text-sm text-slate-500">
          {account ? "No positions yet. Place a bet on a market to see it here." : "Connect a wallet to see your bets."}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-5 py-3 font-bold sm:px-6">Question</th>
                <th className="px-5 py-3 font-bold sm:px-6">Status</th>
                <th className="px-5 py-3 text-right font-bold sm:px-6">Invested</th>
                <th className="px-5 py-3 text-right font-bold sm:px-6">Yes Shares</th>
                <th className="px-5 py-3 text-right font-bold sm:px-6">No Shares</th>
                <th className="px-5 py-3 text-right font-bold sm:px-6">Payout</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {rows.map((row) => {
                const m = row.market;
                const question = m && "question" in m ? m.question : `Market #${row.position.marketId}`;
                const statusLabel =
                  row.state === "active"
                    ? "Active"
                    : row.state === "resolved"
                      ? `Resolved (${row.result ?? "?"})`
                      : "Unknown";
                return (
                  <tr key={row.position.contractId} className="transition-colors hover:bg-slate-50">
                    <td className="max-w-[380px] px-5 py-4 font-semibold text-slate-950 sm:px-6">{question}</td>
                    <td className="px-5 py-4 sm:px-6">
                      <span className="rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-xs font-bold text-primary">
                        {statusLabel}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-right font-semibold sm:px-6">
                      {row.position.amountInvestedCC.toFixed(2)} CC
                    </td>
                    <td className="px-5 py-4 text-right sm:px-6">{row.position.yesShares}</td>
                    <td className="px-5 py-4 text-right sm:px-6">{row.position.noShares}</td>
                    <td className="px-5 py-4 text-right font-bold text-primary sm:px-6">
                      {row.state === "resolved" ? `${(row.payout ?? 0).toFixed(2)} CC` : "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default Activity;
