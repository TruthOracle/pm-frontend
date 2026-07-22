import { useCantonWallet } from "@/wallets";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchAllPredictionMarkets,
  fetchAllUserPositions,
  type PredictionMarketRecord,
  type UserMarketPosition,
} from "@/utils/activeContracts";
import { Activity as ActivityIcon } from "lucide-react";

/**
 * One row per market the user has a Position in. Joins the on-ledger Position
 * with the PredictionMarket (single template; status field carries lifecycle).
 */
type ActivityRow = {
  position: UserMarketPosition;
  market: PredictionMarketRecord | null;
  /** Redeemable CC (winning shares 1:1 when Resolved; bounded cost basis when Voided). */
  redeemable: number;
};

function buildRows(
  positions: UserMarketPosition[],
  markets: PredictionMarketRecord[],
): ActivityRow[] {
  const byId = new Map(markets.map((m) => [m.marketId, m]));
  return positions.map((position) => {
    const market = byId.get(position.marketId) ?? null;
    let redeemable = 0;
    if (market?.status === "Resolved") {
      redeemable =
        market.outcome === "Yes"
          ? position.yesShares
          : market.outcome === "No"
            ? position.noShares
            : 0;
    } else if (market?.status === "Voided") {
      redeemable = Math.min(
        position.costBasisCC,
        Math.max(position.yesShares, position.noShares),
      );
    }
    return { position, market, redeemable };
  });
}

function statusLabel(market: PredictionMarketRecord | null): string {
  if (!market) return "Unknown";
  switch (market.status) {
    case "Trading":
      return Math.floor(Date.now() / 1000) >= market.expiresAt ? "Awaiting resolution" : "Active";
    case "Proposed":
      return "Outcome proposed";
    case "Resolved":
      return `Resolved (${market.outcome ?? "?"})`;
    case "Voided":
      return "Voided";
    default:
      return market.status;
  }
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
      const [positions, markets] = await Promise.all([
        fetchAllUserPositions(account.address),
        fetchAllPredictionMarkets(),
      ]);
      setRows(buildRows(positions, markets));
    } finally {
      setLoading(false);
    }
  }, [account?.address]);

  useEffect(() => {
    fetchBets();
  }, [fetchBets]);

  // Expose so MarketView can refresh us after a trade commits.
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
          Your positions across markets: cost basis, shares, and what's redeemable. Redeem from the
          market page after resolution.
        </p>
      </div>

      {loading ? (
        <div className="px-6 py-8 text-center text-sm text-slate-500">Loading positions...</div>
      ) : rows.length === 0 ? (
        <div className="px-6 py-8 text-center text-sm text-slate-500">
          {account ? "No positions yet. Trade on a market to see it here." : "Connect a wallet to see your positions."}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-5 py-3 font-bold sm:px-6">Question</th>
                <th className="px-5 py-3 font-bold sm:px-6">Status</th>
                <th className="px-5 py-3 text-right font-bold sm:px-6">Cost basis</th>
                <th className="px-5 py-3 text-right font-bold sm:px-6">Yes Shares</th>
                <th className="px-5 py-3 text-right font-bold sm:px-6">No Shares</th>
                <th className="px-5 py-3 text-right font-bold sm:px-6">Redeemable</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {rows.map((row) => {
                const question = row.market?.question ?? `Market #${row.position.marketId}`;
                return (
                  <tr key={row.position.contractId} className="transition-colors hover:bg-slate-50">
                    <td className="max-w-[380px] px-5 py-4 font-semibold text-slate-950 sm:px-6">
                      <Link to={`/market/${row.position.marketId}`} className="hover:text-primary">
                        {question}
                      </Link>
                    </td>
                    <td className="px-5 py-4 sm:px-6">
                      <span className="rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-xs font-bold text-primary">
                        {statusLabel(row.market)}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-right font-semibold sm:px-6">
                      {row.position.costBasisCC.toFixed(2)} CC
                    </td>
                    <td className="px-5 py-4 text-right sm:px-6">{row.position.yesShares.toFixed(2)}</td>
                    <td className="px-5 py-4 text-right sm:px-6">{row.position.noShares.toFixed(2)}</td>
                    <td className="px-5 py-4 text-right font-bold text-primary sm:px-6">
                      {row.redeemable > 0 ? (
                        <Link
                          to={`/market/${row.position.marketId}`}
                          className="underline decoration-dotted hover:text-emerald-700"
                        >
                          {row.redeemable.toFixed(2)} CC — redeem
                        </Link>
                      ) : (
                        "-"
                      )}
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
