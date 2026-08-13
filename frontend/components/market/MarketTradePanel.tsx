import MarketHistoryChart from "./MarketHistoryChart";
import { YourPositionBox } from "./MarketPositionCards";
import { fmtCC, fmtCountdown } from "./marketHelpers";

const SLIPPAGE_OPTIONS = [0.005, 0.01, 0.02];

type TradeContext = {
  setMainTab: any;
  subTabBtn: any;
  tradeSubTab: any;
  setTradeSubTab: any;
  phase: any;
  market: any;
  nowSecs: any;
  tradeSide: any;
  setTradeSide: any;
  selectedSide: any;
  setSelectedSide: any;
  probYes: any;
  probNo: any;
  collateralIn: any;
  sharesIn: any;
  setCollateralIn: any;
  setSharesIn: any;
  slippage: any;
  setSlippage: any;
  buyQuote: any;
  sellQuote: any;
  swapQuote: any;
  account: any;
  busy: any;
  handleTradeClick: any;
  mintMode: any;
  setMintMode: any;
  splitMergeAmount: any;
  setSplitMergeAmount: any;
  handleSplitMerge: any;
  userPosition: any;
  holdings: any;
};

export default function MarketTradePanel({ context }: { context: TradeContext }) {
  const { setMainTab, subTabBtn, tradeSubTab, setTradeSubTab, phase, market, nowSecs, tradeSide, setTradeSide, selectedSide, setSelectedSide, probYes, probNo, collateralIn, sharesIn, setCollateralIn, setSharesIn, slippage, setSlippage, buyQuote, sellQuote, swapQuote, account, busy, handleTradeClick, mintMode, setMintMode, splitMergeAmount, setSplitMergeAmount, handleSplitMerge, userPosition, holdings } = context;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,.8fr)] lg:items-start">
      <MarketHistoryChart probability={probYes} />
          <div className="space-y-4">
            <div className="flex overflow-hidden rounded-lg border border-border bg-white">
              <button onClick={() => setMainTab("trade")} className={`${subTabBtn(true)} rounded-l-md`}>Trade</button>
              <button onClick={() => setMainTab("liquidity")} className={`${subTabBtn(false)} rounded-r-md`}>Liquidity</button>
            </div>
            {/* Sub-toggle: Swap Tokens / Mint Set */}
            <div className="flex overflow-hidden rounded-lg border border-border">
              <button onClick={() => setTradeSubTab("swap")} className={subTabBtn(tradeSubTab === "swap")}>
                Swap Tokens
              </button>
              <button onClick={() => setTradeSubTab("mint")} className={subTabBtn(tradeSubTab === "mint")}>
                Mint Set
              </button>
            </div>

            {phase !== "trading" && phase !== "liquidity_period" ? (
              <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                Trading is closed — the market has {phase === "expired" || phase === "proposed" ? "expired and awaits resolution" : "settled"}.
              </div>
            ) : tradeSubTab === "swap" && phase === "liquidity_period" ? (
              <div className="rounded-xl border border-dashed border-oracle-blue/40 p-8 text-center text-sm text-muted-foreground">
                Swaps open when trading starts in{" "}
                <span className="font-semibold text-oracle-blue">
                  {fmtCountdown(market.createdAt + market.liquidityPeriodSecs, nowSecs)}
                </span>
                . Meanwhile you can mint complete sets and add liquidity.
              </div>
            ) : tradeSubTab === "swap" ? (
              <div className="trade-panel">
                <div className="mb-4 flex overflow-hidden rounded-lg border border-border">
                  <button onClick={() => setTradeSide("buy")} className={subTabBtn(tradeSide === "buy")}>
                    Buy
                  </button>
                  <button onClick={() => setTradeSide("sell")} className={subTabBtn(tradeSide === "sell")}>
                    Sell
                  </button>
                  <button onClick={() => setTradeSide("convert")} className={subTabBtn(tradeSide === "convert")}>
                    Convert
                  </button>
                </div>

                <div className="mb-4 flex flex-col gap-2">
                  <button
                    onClick={() => setSelectedSide("yes")}
                    className={
                      selectedSide === "yes"
                        ? "rounded-lg border-2 border-oracle-yes bg-oracle-yes/20 py-2.5 text-sm font-bold text-oracle-yes ring-2 ring-oracle-yes/30"
                        : "rounded-lg border border-oracle-yes/30 py-2.5 text-sm font-semibold text-oracle-yes hover:bg-oracle-yes/10"
                    }
                  >
                    Yes — {(probYes * 100).toFixed(1)}¢
                  </button>
                  <button
                    onClick={() => setSelectedSide("no")}
                    className={
                      selectedSide === "no"
                        ? "rounded-lg border-2 border-oracle-no bg-oracle-no/20 py-2.5 text-sm font-bold text-oracle-no ring-2 ring-oracle-no/30"
                        : "rounded-lg border border-oracle-no/30 py-2.5 text-sm font-semibold text-oracle-no hover:bg-oracle-no/10"
                    }
                  >
                    No — {(probNo * 100).toFixed(1)}¢
                  </button>
                </div>

                <div className="mb-3">
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    {tradeSide === "buy"
                      ? "Spend (CC)"
                      : tradeSide === "sell"
                        ? "Shares to sell"
                        : `Shares to convert (from ${selectedSide === "no" ? "NO" : "YES"})`}
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={tradeSide === "buy" ? (collateralIn || "") : (sharesIn || "")}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      const val = isNaN(v) || v < 0 ? 0 : v;
                      if (tradeSide === "buy") setCollateralIn(val);
                      else setSharesIn(val);
                    }}
                    placeholder="0.0"
                    className="input-field text-center"
                  />
                </div>

                <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Slippage</span>
                  <div className="flex gap-1">
                    {SLIPPAGE_OPTIONS.map((s) => (
                      <button
                        key={s}
                        onClick={() => setSlippage(s)}
                        className={`rounded px-2 py-0.5 ${slippage === s ? "bg-primary text-primary-foreground" : "bg-secondary"}`}
                      >
                        {(s * 100).toFixed(1)}%
                      </button>
                    ))}
                  </div>
                </div>

                {tradeSide === "buy" && buyQuote && (
                  <div className="mb-3 space-y-1 rounded-lg bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">
                    <div className="flex justify-between"><span>Est. shares</span><span className="text-foreground">{fmtCC(buyQuote.sharesOut, 3)}</span></div>
                    <div className="flex justify-between"><span>Min received</span><span>{fmtCC(buyQuote.sharesOut * (1 - slippage), 3)}</span></div>
                    <div className="flex justify-between"><span>Avg price</span><span>{(buyQuote.avgPrice * 100).toFixed(1)}¢</span></div>
                    <div className="flex justify-between"><span>Fee</span><span>{fmtCC(buyQuote.fee)} CC</span></div>
                    <div className={`flex justify-between ${buyQuote.priceImpact > 0.05 ? "text-oracle-no" : ""}`}>
                      <span>Price impact</span><span>{(buyQuote.priceImpact * 100).toFixed(2)}%</span>
                    </div>
                  </div>
                )}
                {tradeSide === "sell" && sellQuote && (
                  <div className="mb-3 space-y-1 rounded-lg bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">
                    <div className="flex justify-between"><span>Est. proceeds</span><span className="text-foreground">{fmtCC(sellQuote.netProceeds)} CC</span></div>
                    <div className="flex justify-between"><span>Min received</span><span>{fmtCC(sellQuote.netProceeds * (1 - slippage))} CC</span></div>
                    <div className="flex justify-between"><span>Avg price</span><span>{(sellQuote.avgPrice * 100).toFixed(1)}¢</span></div>
                    <div className="flex justify-between"><span>Fee</span><span>{fmtCC(sellQuote.fee)} CC</span></div>
                  </div>
                )}
                {tradeSide === "convert" && swapQuote && selectedSide && (
                  <div className="mb-3 space-y-1 rounded-lg bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">
                    <div className="flex justify-between">
                      <span>Est. {selectedSide === "yes" ? "NO" : "YES"} received</span>
                      <span className="text-foreground">{fmtCC(swapQuote.sharesOut, 3)}</span>
                    </div>
                    <div className="flex justify-between"><span>Min received</span><span>{fmtCC(swapQuote.sharesOut * (1 - slippage), 3)}</span></div>
                    <div className="flex justify-between"><span>Fee (input shares)</span><span>{fmtCC(swapQuote.fee, 3)}</span></div>
                    <div className={`flex justify-between ${swapQuote.priceImpact > 0.05 ? "text-oracle-no" : ""}`}>
                      <span>Price impact</span><span>{(swapQuote.priceImpact * 100).toFixed(2)}%</span>
                    </div>
                  </div>
                )}

                {(() => {
                  const reason = !account
                    ? "Connect wallet"
                    : busy !== null
                      ? "Submitting…"
                      : !selectedSide
                        ? tradeSide === "convert" ? "Select the side to convert from" : "Select Yes or No"
                        : tradeSide === "buy"
                          ? collateralIn <= 0 ? "Enter CC to spend" : null
                          : sharesIn <= 0
                            ? tradeSide === "convert" ? "Enter shares to convert" : "Enter shares to sell"
                            : null;
                  const disabled = reason !== null;
                  return (
                    <button
                      onClick={handleTradeClick}
                      disabled={disabled}
                      className={`w-full rounded-lg py-3 text-sm font-bold transition-all ${
                        disabled
                          ? "cursor-not-allowed bg-secondary text-muted-foreground"
                          : "bg-primary text-primary-foreground hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/20"
                      }`}
                    >
                      {reason ??
                        (tradeSide === "buy"
                          ? "Buy Shares"
                          : tradeSide === "sell"
                            ? "Sell Shares"
                            : `Convert ${selectedSide === "no" ? "NO → YES" : "YES → NO"}`)}
                    </button>
                  );
                })()}
                <p className="mt-2 text-center text-xs text-muted-foreground">
                  Executed on-ledger by the pm-AMM; your slippage bound protects the quote.
                </p>
              </div>
            ) : (
              <div className="trade-panel">
                <div className="mb-4 flex overflow-hidden rounded-lg border border-border">
                  <button onClick={() => setMintMode("mint")} className={subTabBtn(mintMode === "mint")}>
                    Mint
                  </button>
                  <button onClick={() => setMintMode("merge")} className={subTabBtn(mintMode === "merge")}>
                    Merge
                  </button>
                </div>
                <p className="mb-3 text-center text-xs text-muted-foreground">
                  {mintMode === "mint"
                    ? "Deposit CC to mint complete sets: 1 CC → 1 YES + 1 NO (no price impact)."
                    : "Burn equal YES + NO pairs back into CC: 1 pair → 1 CC."}
                </p>
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={splitMergeAmount || ""}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    setSplitMergeAmount(isNaN(v) || v < 0 ? 0 : v);
                  }}
                  placeholder={mintMode === "mint" ? "CC to deposit" : "Pairs to merge"}
                  className="input-field mb-3 text-center"
                />
                {splitMergeAmount > 0 && (
                  <div className="mb-3 space-y-1 rounded-lg bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">
                    {mintMode === "mint" ? (
                      <>
                        <div className="flex justify-between"><span>You deposit</span><span className="text-foreground">{fmtCC(splitMergeAmount)} CC</span></div>
                        <div className="flex justify-between"><span>You receive</span><span className="text-foreground">{fmtCC(splitMergeAmount, 2)} YES + {fmtCC(splitMergeAmount, 2)} NO</span></div>
                      </>
                    ) : (
                      <>
                        <div className="flex justify-between"><span>You burn</span><span className="text-foreground">{fmtCC(splitMergeAmount, 2)} YES + {fmtCC(splitMergeAmount, 2)} NO</span></div>
                        <div className="flex justify-between"><span>You receive</span><span className="text-foreground">{fmtCC(splitMergeAmount)} CC</span></div>
                      </>
                    )}
                  </div>
                )}
                <button
                  onClick={() => handleSplitMerge(mintMode === "mint" ? "split" : "merge")}
                  disabled={busy !== null || splitMergeAmount <= 0 || !account || (mintMode === "merge" && !userPosition)}
                  className="w-full rounded-lg bg-primary py-3 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-secondary disabled:text-muted-foreground"
                >
                  {busy === "splitmerge" ? "Submitting…" : mintMode === "mint" ? "Mint Complete Set" : "Merge Complete Set"}
                </button>
              </div>
            )}
            {/* Sidebar: Your Position */}
            <div className="w-full space-y-4"><YourPositionBox account={account} userPosition={userPosition} holdings={holdings} probYes={probYes} probNo={probNo} /></div>
          </div>

    </div>
  );
}
