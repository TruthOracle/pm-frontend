import type { AmuletHoldings } from "@/view-functions/getAccountBalance";
import type { LiquidityPositionRecord, PredictionMarketRecord, UserMarketPosition } from "@/utils/activeContracts";
import { fmtCC } from "./marketHelpers";

export function YourPositionBox({
  account,
  userPosition,
  holdings,
  probYes,
  probNo,
}: {
  account: unknown;
  userPosition: UserMarketPosition | null;
  holdings: AmuletHoldings | null;
  probYes: number;
  probNo: number;
}) {
  return (
    <div className="rounded-xl border border-primary/20 bg-primary/5 p-5">
      <h3 className="mb-3 text-sm font-semibold text-foreground">Your Position</h3>
      {!account ? <p className="text-xs text-muted-foreground">Connect a wallet to see your position.</p> : !userPosition ? <p className="text-xs text-muted-foreground">No position in this market yet.</p> : (
        <div className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">YES shares</span><span className="font-semibold text-oracle-yes">{fmtCC(userPosition.yesShares, 2)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">NO shares</span><span className="font-semibold text-oracle-no">{fmtCC(userPosition.noShares, 2)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Cost basis</span><span className="font-semibold text-foreground">{fmtCC(userPosition.costBasisCC, 2)} CC</span></div>
          <div className="flex justify-between border-t border-border pt-2"><span className="text-muted-foreground">Value at current price</span><span className="font-semibold text-foreground">{fmtCC(userPosition.yesShares * probYes + userPosition.noShares * probNo, 2)} CC</span></div>
        </div>
      )}
      {holdings && <p className="mt-3 border-t border-border pt-2 text-xs text-muted-foreground">Wallet balance: <span className="font-medium text-primary">{holdings.balance.toFixed(2)} CC</span></p>}
    </div>
  );
}

export function YourLpBox({ account, lpPosition, market }: { account: unknown; lpPosition: LiquidityPositionRecord | null; market: PredictionMarketRecord }) {
  return (
    <div className="rounded-xl border border-oracle-blue/20 bg-oracle-blue/5 p-5">
      <h3 className="mb-3 text-sm font-semibold text-foreground">Your LP Position</h3>
      {!account ? <p className="text-xs text-muted-foreground">Connect a wallet to see your LP position.</p> : !lpPosition || lpPosition.lpTokens <= 0 ? <p className="text-xs text-muted-foreground">No liquidity provided yet.</p> : (
        <div className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">LP tokens</span><span className="font-semibold text-foreground">{fmtCC(lpPosition.lpTokens, 4)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Share of pool</span><span className="font-semibold text-foreground">{market.lpTokenSupply > 0 ? ((lpPosition.lpTokens / market.lpTokenSupply) * 100).toFixed(2) : "0"}%</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Deposited</span><span className="font-semibold text-foreground">{fmtCC(lpPosition.depositedCC, 2)} CC</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">YES reserve share</span><span className="text-foreground">{fmtCC(market.lpTokenSupply > 0 ? (lpPosition.lpTokens / market.lpTokenSupply) * market.reserveYes : 0, 2)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">NO reserve share</span><span className="text-foreground">{fmtCC(market.lpTokenSupply > 0 ? (lpPosition.lpTokens / market.lpTokenSupply) * market.reserveNo : 0, 2)}</span></div>
          <div className="flex justify-between border-t border-border pt-2"><span className="text-muted-foreground">Fee pot (pool)</span><span className="text-foreground">{fmtCC(market.accumulatedFeesCC, 4)} CC</span></div>
        </div>
      )}
      {market.isDynamic && <p className="mt-3 rounded bg-oracle-purple/10 px-2 py-1.5 text-center text-[11px] text-oracle-purple">Dynamic pool: LP locked until resolution; expected total LVR ≈ V₀/2.</p>}
    </div>
  );
}
