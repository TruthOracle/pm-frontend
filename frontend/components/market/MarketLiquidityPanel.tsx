import MarketHistoryChart from "./MarketHistoryChart";
import { YourLpBox } from "./MarketPositionCards";
import { fmtCC } from "./marketHelpers";

type LiquidityContext = {
  setMainTab: any;
  subTabBtn: any;
  liquiditySubTab: any;
  setLiquiditySubTab: any;
  canProvideLiquidity: any;
  liquidityValue: any;
  setLiquidityValue: any;
  liquidityQuote: any;
  busy: any;
  handleProvideLiquidity: any;
  lpPosition: any;
  market: any;
  phase: any;
  withdrawPct: any;
  setWithdrawPct: any;
  handleWithdrawLiquidity: any;
  account: any;
};

export default function MarketLiquidityPanel({ context }: { context: LiquidityContext }) {
  const { setMainTab, subTabBtn, liquiditySubTab, setLiquiditySubTab, canProvideLiquidity, liquidityValue, setLiquidityValue, liquidityQuote, busy, handleProvideLiquidity, lpPosition, market, phase, withdrawPct, setWithdrawPct, handleWithdrawLiquidity, account } = context;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,.8fr)] lg:items-start">
      <MarketHistoryChart probability={market.currentPrice} />
          <div className="space-y-4 lg:col-start-2 lg:row-start-1">
            <div className="flex overflow-hidden rounded-lg border border-border bg-white">
              <button onClick={() => setMainTab("trade")} className={`${subTabBtn(false)} rounded-l-md`}>Trade</button>
              <button onClick={() => setMainTab("liquidity")} className={`${subTabBtn(true)} rounded-r-md`}>Liquidity</button>
            </div>
            {/* Sub-toggle: Add / Remove */}
            <div className="flex overflow-hidden rounded-lg border border-border">
              <button onClick={() => setLiquiditySubTab("add")} className={subTabBtn(liquiditySubTab === "add")}>
                Add Liquidity
              </button>
              <button onClick={() => setLiquiditySubTab("remove")} className={subTabBtn(liquiditySubTab === "remove")}>
                Remove Liquidity
              </button>
            </div>

            {liquiditySubTab === "add" ? (
              !canProvideLiquidity ? (
                <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                  Liquidity can only be added before the market expires.
                </div>
              ) : (
                <div className="trade-panel">
                  <p className="mb-3 text-center text-xs text-muted-foreground">
                    Value-based deposit: name a pool-value increase ΔV; the pool scales reserves and L
                    by (V+ΔV)/V so the price is untouched. ΔL = ΔV / φ(Φ⁻¹(P)).
                  </p>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    Desired pool-value increase (CC)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={liquidityValue || ""}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      setLiquidityValue(isNaN(v) || v < 0 ? 0 : v);
                    }}
                    placeholder="0.0"
                    className="input-field mb-3 text-center"
                  />
                  {liquidityQuote && (
                    <div className="mb-3 space-y-1 rounded-lg bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">
                      <div className="flex justify-between"><span>Collateral cost</span><span className="text-foreground">{fmtCC(liquidityQuote.costCC)} CC</span></div>
                      <div className="flex justify-between"><span>LP tokens minted</span><span>{fmtCC(liquidityQuote.lpMinted, 4)}</span></div>
                      <div className="flex justify-between"><span>Share of pool</span><span>{(liquidityQuote.shareOfPool * 100).toFixed(2)}%</span></div>
                      <div className="flex justify-between"><span>New L₀</span><span>{fmtCC(liquidityQuote.newL, 2)}</span></div>
                    </div>
                  )}
                  <button
                    onClick={handleProvideLiquidity}
                    disabled={busy !== null || liquidityValue <= 0 || !account}
                    className="w-full rounded-lg bg-primary py-3 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-secondary disabled:text-muted-foreground"
                  >
                    {busy === "liquidity" ? "Submitting…" : "Add Liquidity"}
                  </button>
                </div>
              )
            ) : (
              <div className="trade-panel">
                {!lpPosition || lpPosition.lpTokens <= 0 ? (
                  <div className="p-4 text-center text-sm text-muted-foreground">No LP position to remove.</div>
                ) : (
                  <>
                    <p className="mb-3 text-center text-xs text-muted-foreground">
                      {market.isDynamic && phase !== "resolved" && phase !== "voided"
                        ? "Dynamic pool — removal unlocks after resolution/void (uniform-LVR design)."
                        : phase === "resolved"
                          ? "Pool is settled: you receive your share of the winning reserve + accrued fees as CC."
                          : phase === "voided"
                            ? "Market voided: you receive your deposit share + accrued fees as CC."
                            : "Static pool: early removal returns proportional YES/NO shares + fee share."}
                    </p>
                    <div className="mb-2 flex items-center gap-2">
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={withdrawPct}
                        onChange={(e) => setWithdrawPct(Number(e.target.value))}
                        className="flex-1"
                      />
                      <span className="w-12 text-right text-sm text-foreground">{withdrawPct}%</span>
                    </div>
                    <div className="mb-3 flex gap-1">
                      {[25, 50, 75, 100].map((p) => (
                        <button
                          key={p}
                          onClick={() => setWithdrawPct(p)}
                          className={`flex-1 rounded px-2 py-1 text-xs ${withdrawPct === p ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"}`}
                        >
                          {p}%
                        </button>
                      ))}
                    </div>
                    <div className="mb-3 space-y-1 rounded-lg bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">
                      <div className="flex justify-between">
                        <span>LP to burn</span>
                        <span className="text-foreground">{fmtCC(lpPosition.lpTokens * (withdrawPct / 100), 4)}</span>
                      </div>
                    </div>
                    <button
                      onClick={handleWithdrawLiquidity}
                      disabled={busy !== null || withdrawPct <= 0 || (market.isDynamic && phase !== "resolved" && phase !== "voided")}
                      className="w-full rounded-lg border border-oracle-blue/30 bg-oracle-blue/10 py-3 text-sm font-bold text-oracle-blue hover:bg-oracle-blue/20 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {busy === "withdraw"
                        ? "Withdrawing…"
                        : market.isDynamic && phase !== "resolved" && phase !== "voided"
                          ? "Locked until resolution"
                          : "Remove Liquidity"}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Sidebar: Your LP Position */}
          <div className="w-full space-y-4 lg:col-start-2 lg:row-start-2"><YourLpBox account={account} lpPosition={lpPosition} market={market} /></div>

    </div>
  );
}
