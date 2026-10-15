import { holdingFor, type WalletHolding } from "@/lib/walletHoldings";
import type { LiquidityPositionRecord, PredictionMarketRecord, UserMarketPosition } from "@/utils/activeContracts";
import { WALLET_DISPLAY_NAME } from "@/config";
import { findInstrument, formatMoney, useInstruments, walletInstrumentId, type InstrumentRef } from "@/lib/instruments";
import { fmtNum } from "./marketHelpers";

export function YourPositionBox({
  account,
  signInFirst = false,
  userPosition,
  holdings,
  collateral,
  probYes,
  probNo,
}: {
  account: unknown;
  /** Anonymous visitor: there is no connect control for them, so point at sign-in. */
  signInFirst?: boolean;
  userPosition: UserMarketPosition | null;
  /** Every token the external wallet reports; the box shows the one in the market's collateral. */
  holdings: WalletHolding[] | null;
  /** The market's collateral: what the cost basis and the value are in. */
  collateral: InstrumentRef;
  probYes: number;
  probNo: number;
}) {
  const instruments = useInstruments().data;
  // The external wallet reports its holdings under its own token ids; the row that matters on this
  // page is the market's collateral — what a deposit from that wallet would fund — found through the
  // catalog's mapping of the collateral to the wallet's id (the token id itself when the catalog does
  // not know the instrument). No row means the wallet holds none of it, shown as 0.
  const collateralEntry = findInstrument(instruments, collateral);
  const external = holdings ? holdingFor(holdings, collateralEntry ? walletInstrumentId(collateralEntry) : collateral.id) : null;
  return (
    <div className="rounded-xl border border-primary/20 bg-primary/5 p-5">
      <h3 className="mb-3 text-sm font-semibold text-foreground">Your Position</h3>
      {!account ? <p className="text-xs text-muted-foreground">{signInFirst ? "Sign in to see your position." : `Connect your ${WALLET_DISPLAY_NAME} wallet to see your position.`}</p> : !userPosition ? <p className="text-xs text-muted-foreground">No position in this market yet.</p> : (
        <div className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">YES shares</span><span className="font-semibold text-oracle-yes">{fmtNum(userPosition.yesShares, 2)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">NO shares</span><span className="font-semibold text-oracle-no">{fmtNum(userPosition.noShares, 2)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Cost basis</span><span className="font-semibold text-foreground">{formatMoney(userPosition.costBasis, collateral, 2)}</span></div>
          <div className="flex justify-between border-t border-border pt-2"><span className="text-muted-foreground">Value at current price</span><span className="font-semibold text-foreground">{formatMoney(userPosition.yesShares * probYes + userPosition.noShares * probNo, collateral, 2)}</span></div>
        </div>
      )}
      {holdings && <p className="mt-3 border-t border-border pt-2 text-xs text-muted-foreground">{WALLET_DISPLAY_NAME} wallet (external): <span className="font-medium text-primary">{formatMoney(external?.balance ?? 0, collateral, 2)}</span></p>}
    </div>
  );
}

export function YourLpBox({ account, signInFirst = false, lpPosition, market }: { account: unknown; signInFirst?: boolean; lpPosition: LiquidityPositionRecord | null; market: PredictionMarketRecord }) {
  return (
    <div className="rounded-xl border border-oracle-blue/20 bg-oracle-blue/5 p-5">
      <h3 className="mb-3 text-sm font-semibold text-foreground">Your LP Position</h3>
      {!account ? <p className="text-xs text-muted-foreground">{signInFirst ? "Sign in to see your LP position." : `Connect your ${WALLET_DISPLAY_NAME} wallet to see your LP position.`}</p> : !lpPosition || lpPosition.lpTokens <= 0 ? <p className="text-xs text-muted-foreground">No liquidity provided yet.</p> : (
        <div className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">LP tokens</span><span className="font-semibold text-foreground">{fmtNum(lpPosition.lpTokens, 4)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Share of pool</span><span className="font-semibold text-foreground">{market.lpTokenSupply > 0 ? ((lpPosition.lpTokens / market.lpTokenSupply) * 100).toFixed(2) : "0"}%</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Deposited</span><span className="font-semibold text-foreground">{formatMoney(lpPosition.deposited, market.collateral, 2)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">YES reserve share</span><span className="text-foreground">{fmtNum(market.lpTokenSupply > 0 ? (lpPosition.lpTokens / market.lpTokenSupply) * market.reserveYes : 0, 2)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">NO reserve share</span><span className="text-foreground">{fmtNum(market.lpTokenSupply > 0 ? (lpPosition.lpTokens / market.lpTokenSupply) * market.reserveNo : 0, 2)}</span></div>
          <div className="flex justify-between border-t border-border pt-2"><span className="text-muted-foreground">Fee pot (pool)</span><span className="text-foreground">{formatMoney(market.accumulatedFees, market.collateral, 4)}</span></div>
        </div>
      )}
      {market.isDynamic && <p className="mt-3 rounded bg-oracle-purple/10 px-2 py-1.5 text-center text-[11px] text-oracle-purple">Dynamic pool: LP locked until resolution; expected total LVR ≈ V₀/2.</p>}
    </div>
  );
}
