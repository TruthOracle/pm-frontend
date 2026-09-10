import { YourLpBox, YourPositionBox } from "./MarketPositionCards";
import { fmtCC } from "./marketHelpers";

type SettlementContext = {
  phase: any;
  market: any;
  redeemable: any;
  busy: any;
  account: any;
  /** State B (§16): the connected wallet is linked but not primary — money CTAs are off with this label. */
  tradeLockReason?: string | null;
  handleRedeem: any;
  lpPosition: any;
  setWithdrawPct: any;
  handleWithdrawLiquidity: any;
  userPosition: any;
  holdings: any;
  probYes: any;
  probNo: any;
};

export default function MarketSettlementPanel({ context }: { context: SettlementContext }) {
  const { phase, market, redeemable, busy, account, tradeLockReason = null, handleRedeem, lpPosition, setWithdrawPct, handleWithdrawLiquidity, userPosition, holdings, probYes, probNo } = context;
  return (
    <div className="flex flex-col gap-6 lg:flex-row">
          <div className="flex-1 space-y-4">
            <div className="trade-panel text-center">
              <h2 className="mb-2 text-base font-bold text-foreground">Market Result</h2>
              <div className="text-2xl font-bold text-primary">
                {phase === "voided" ? "Voided" : market.outcome === "Yes" ? "Winner: Yes" : market.outcome === "No" ? "Winner: No" : "Void"}
              </div>
              <div className="mt-4 space-y-2 text-sm text-muted-foreground">
                <div className="flex justify-between"><span>Final probability</span><span>{(probYes * 100).toFixed(1)}% Yes</span></div>
                <div className="flex justify-between"><span>Total volume</span><span>{fmtCC(market.totalVolumeCC, 2)} CC</span></div>
                {market.resolvedAt && (
                  <div className="flex justify-between"><span>Settled</span><span>{new Date(market.resolvedAt * 1000).toLocaleString()}</span></div>
                )}
              </div>
            </div>

            <div className="trade-panel">
              <h3 className="mb-3 text-center text-sm font-bold text-foreground">Redeem Position</h3>
              {!userPosition ? (
                <p className="text-center text-sm text-muted-foreground">No position to redeem.</p>
              ) : (
                <>
                  <div className="mb-3 space-y-1 rounded-lg bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">
                    <div className="flex justify-between"><span>YES held</span><span className="text-oracle-yes">{fmtCC(userPosition.yesShares, 2)}</span></div>
                    <div className="flex justify-between"><span>NO held</span><span className="text-oracle-no">{fmtCC(userPosition.noShares, 2)}</span></div>
                    <div className="flex justify-between border-t border-border pt-1">
                      <span>{phase === "voided" ? "Refund (cost basis)" : "Payout (1 CC / winning share)"}</span>
                      <span className="font-bold text-primary">{fmtCC(redeemable)} CC</span>
                    </div>
                  </div>
                  <button
                    onClick={handleRedeem}
                    disabled={busy !== null || redeemable <= 0 || !account || tradeLockReason !== null}
                    title={tradeLockReason ?? undefined}
                    className="trade-cta"
                  >
                    {busy === "redeem"
                      ? "Redeeming…"
                      : redeemable > 0
                        ? phase === "voided"
                          ? `Redeem refund — ${fmtCC(redeemable)} CC`
                          : `Redeem winnings — ${fmtCC(redeemable)} CC`
                        : "Nothing to redeem"}
                  </button>
                </>
              )}
            </div>

            {lpPosition && lpPosition.lpTokens > 0 && (
              <div className="trade-panel">
                <h3 className="mb-3 text-center text-sm font-bold text-foreground">Withdraw Liquidity</h3>
                <p className="mb-3 text-center text-xs text-muted-foreground">
                  {phase === "voided"
                    ? "Deposit share + accrued fees returned as CC."
                    : "Your share of the winning reserve + accrued fees, paid as CC."}
                </p>
                <button
                  onClick={() => {
                    setWithdrawPct(100);
                    handleWithdrawLiquidity();
                  }}
                  disabled={busy !== null || !account || tradeLockReason !== null}
                  title={tradeLockReason ?? undefined}
                  className="w-full rounded-lg border border-oracle-blue/30 bg-oracle-blue/10 py-3 text-sm font-bold text-oracle-blue hover:bg-oracle-blue/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy === "withdraw" ? "Withdrawing…" : "Withdraw all liquidity"}
                </button>
              </div>
            )}
          </div>
          <div className="w-full space-y-4 lg:w-80 lg:shrink-0">
            <YourPositionBox account={account} userPosition={userPosition} holdings={holdings} probYes={probYes} probNo={probNo} />
            {lpPosition && lpPosition.lpTokens > 0 && <YourLpBox account={account} lpPosition={lpPosition} market={market} />}
          </div>

    </div>
  );
}
