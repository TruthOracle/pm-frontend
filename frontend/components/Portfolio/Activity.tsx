/**
 * Trading activity: one row per market the connected party holds a Position in (portfolioRows.ts),
 * every money figure labelled with that market's collateral, and a footer that adds cost basis
 * and redeemable value up PER INSTRUMENT — positions in different collaterals never share a total.
 * The rows are loaded once by the Portfolio page and shared with the Summary above.
 */
import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Activity as ActivityIcon } from "lucide-react";
import { useCantonWallet } from "@/wallets";
import { useAccountWallet } from "@/auth/AuthContext";
import { WALLET_DISPLAY_NAME } from "@/config";
import { formatMoney, useInstruments } from "@/lib/instruments";
import { statusLabel, summarizeRows, type ActivityRow } from "./portfolioRows";

function Activity({ rows, loading, refresh }: { rows: ActivityRow[]; loading: boolean; refresh: () => void | Promise<void> }) {
  const { account } = useCantonWallet();
  const { signInRequired } = useAccountWallet();
  const instruments = useInstruments().data;

  // Expose so MarketView can refresh us after a trade commits.
  useEffect(() => {
    (window as unknown as { refreshPortfolio?: () => void }).refreshPortfolio = () => void refresh();
    return () => {
      delete (window as unknown as { refreshPortfolio?: () => void }).refreshPortfolio;
    };
  }, [refresh]);

  const totals = summarizeRows(rows, instruments).byInstrument;

  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl shadow-slate-200/60">
      <div className="border-b border-slate-200 px-5 py-4 sm:px-6">
        <div className="flex items-center gap-2">
          <ActivityIcon className="h-4 w-4 text-primary" />
          <h2 className="text-base font-extrabold text-slate-950">Trading Activity</h2>
        </div>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          Your positions across markets: cost basis, shares, and what's redeemable, each in the market's collateral. Redeem
          from the market page after resolution.
        </p>
      </div>

      {loading && rows.length === 0 ? (
        <div className="px-6 py-8 text-center text-sm text-slate-500">Loading positions...</div>
      ) : rows.length === 0 ? (
        <div className="px-6 py-8 text-center text-sm text-slate-500">
          {account
            ? "No positions yet. Trade on a market to see it here."
            : signInRequired
              ? `Sign in, then connect your ${WALLET_DISPLAY_NAME} wallet to see your positions.`
              : `Connect your ${WALLET_DISPLAY_NAME} wallet to see your positions.`}
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
                const collateral = row.market?.collateral ?? null;
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
                    <td className="px-5 py-4 text-right font-semibold sm:px-6">{formatMoney(row.position.costBasis, collateral, 2)}</td>
                    <td className="px-5 py-4 text-right sm:px-6">{row.position.yesShares.toFixed(2)}</td>
                    <td className="px-5 py-4 text-right sm:px-6">{row.position.noShares.toFixed(2)}</td>
                    <td className="px-5 py-4 text-right font-bold text-primary sm:px-6">
                      {row.redeemable > 0 ? (
                        <Link to={`/market/${row.position.marketId}`} className="underline decoration-dotted hover:text-emerald-700">
                          {formatMoney(row.redeemable, collateral, 2)} — redeem
                        </Link>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {totals.length > 0 && (
              <tfoot className="border-t border-slate-200 bg-slate-50 text-xs text-slate-600">
                {totals.map((t) => (
                  <tr key={t.instrument.symbol}>
                    <td className="px-5 py-2 font-semibold sm:px-6" colSpan={2}>
                      Total in {t.instrument.symbol} · {t.markets} market{t.markets === 1 ? "" : "s"}
                    </td>
                    <td className="px-5 py-2 text-right font-semibold tabular-nums sm:px-6">{formatMoney(t.costBasis, t.instrument, 2)}</td>
                    <td className="px-5 py-2 sm:px-6" colSpan={2} />
                    <td className="px-5 py-2 text-right font-semibold tabular-nums text-primary sm:px-6">
                      {t.redeemable > 0 ? formatMoney(t.redeemable, t.instrument, 2) : "-"}
                    </td>
                  </tr>
                ))}
              </tfoot>
            )}
          </table>
        </div>
      )}
    </section>
  );
}

export default Activity;
