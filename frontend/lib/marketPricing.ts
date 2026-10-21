/**
 * pm-AMM pricing (Paradigm dynamic pm-AMM, Gaussian score dynamics).
 * Mirrors truthoracle-contracts/daml/daml/PmAmmMath.daml so frontend quotes match on-ledger
 * execution (slippage bounds absorb the residual drift).
 *
 *   Invariant:  (y - x)·Φ(z) + L·φ(z) - y = 0,  z = (y - x)/L
 *   Price:      P(YES) = Φ((y - x)/L_eff)
 *   Dynamic:    L_eff = L0·√((T - t)/(T - t0))
 *   Reserves:   y*(P) = L·(z·P + φ(z)),  x*(P) = y*(P) - L·z,  z = Φ⁻¹(P)
 *   Value:      V(P) = L·φ(Φ⁻¹(P))
 */

const ONE_OVER_SQRT_TWO_PI = 0.3989422804014327;

const clamp = (lo: number, hi: number, v: number) => Math.max(lo, Math.min(hi, v));
export const clampProb = (p: number) => clamp(0.0001, 0.9999, p);

/** Standard normal PDF. */
export function normPdf(z: number): number {
  const zc = clamp(-8, 8, z);
  return ONE_OVER_SQRT_TWO_PI * Math.exp(-(zc * zc) / 2);
}

/** Standard normal CDF (Abramowitz–Stegun 26.2.17, |err| < 7.5e-8). */
export function normCdf(z: number): number {
  if (z < 0) return 1 - normCdf(-z);
  if (z > 8) return 1;
  const t = 1 / (1 + 0.2316419 * z);
  const poly = t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return 1 - normPdf(z) * poly;
}

/** Inverse standard normal CDF (Acklam + 2 Newton refinements). */
export function normInvCdf(pRaw: number): number {
  const p = clampProb(pRaw);
  const pLow = 0.02425;
  let x: number;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    x =
      -(
        ((((-0.007784894 * q - 0.322396458) * q - 2.400758277) * q - 2.549732539) * q + 4.374664141) * q +
        2.938163983
      ) /
      ((((0.007784696 * q + 0.322467129) * q + 2.445134137) * q + 3.754408662) * q + 1);
  } else if (p > 1 - pLow) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x =
      (((((-0.007784894 * q - 0.322396458) * q - 2.400758277) * q - 2.549732539) * q + 4.374664141) * q + 2.938163983) /
      ((((0.007784696 * q + 0.322467129) * q + 2.445134137) * q + 3.754408662) * q + 1);
  } else {
    const q = p - 0.5;
    const r = q * q;
    x =
      ((((((-39.69683028665376 * r + 220.9460984245205) * r - 275.9285104469687) * r + 138.357751867269) * r -
        30.66479806614716) *
        r +
        2.506628277459239) *
        q) /
      (((((-54.47609879822406 * r + 161.5858368580409) * r - 155.6989798598866) * r + 66.80131188771972) * r -
        13.28068155288572) *
        r +
        1);
  }
  for (let i = 0; i < 2; i++) x -= (normCdf(x) - p) / Math.max(1e-10, normPdf(x));
  return x;
}

/** Closed-form optimal reserves (x = YES, y = NO) for price p at liquidity l. */
export function optimalReserves(p: number, l: number): { x: number; y: number } {
  const z = normInvCdf(p);
  const y = l * (z * p + normPdf(z));
  const x = y - l * z;
  return { x: Math.max(0, x), y: Math.max(0, y) };
}

/** Pool value V(P) = L·φ(Φ⁻¹(P)), in collateral units. */
export const poolValue = (p: number, l: number) => l * normPdf(normInvCdf(p));

/** Liquidity from a target pool value: L = V / φ(Φ⁻¹(P)). */
export const liquidityFromValue = (v: number, p: number) => v / Math.max(1e-10, normPdf(normInvCdf(p)));

/** Invariant residual I(x, y, L). */
export function invariantValue(x: number, y: number, l: number): number {
  const z = (y - x) / Math.max(1e-10, l);
  return (y - x) * normCdf(z) + l * normPdf(z) - y;
}

/** Effective (time-decayed) liquidity: L_eff = L0·√((T - now)/(T - t0)). */
export function effectiveLiquidity(
  isDynamic: boolean,
  l0: number,
  createdAt: number,
  expiresAt: number,
  nowSecs: number,
): number {
  if (!isDynamic) return l0;
  if (nowSecs <= createdAt) return l0;
  const total = expiresAt - createdAt;
  const left = expiresAt - nowSecs;
  if (left <= 0 || total <= 0) return 0;
  return l0 * Math.sqrt(left / total);
}

/** YES shares received for net collateral c (Newton on the invariant). */
export function solveBuyShares(x: number, y: number, l: number, c: number): number {
  const target = invariantValue(x, y, l);
  const p0 = Math.max(0.01, normCdf((y - x) / Math.max(1e-10, l)));
  let n = c / p0;
  for (let i = 0; i < 30; i++) {
    const z = (y - x + n) / Math.max(1e-10, l);
    const f = (y - x + n) * normCdf(z) + l * normPdf(z) - (y + c) - target;
    const deriv = Math.max(0.0001, normCdf(z));
    const next = Math.max(0, n - f / deriv);
    if (Math.abs(next - n) < 1e-7) return next;
    n = next;
  }
  return n;
}

/**
 * Direct outcome-token swap (mirrors PredictionMarket.SwapShares): deposit
 * sIn into the x side, receive shares from the y side. dI/dm = 1 - Φ(z).
 */
export function solveSwapOut(x: number, y: number, l: number, sIn: number): number {
  const target = invariantValue(x, y, l);
  const pIn = Math.max(0.01, normCdf((y - x) / Math.max(1e-10, l)));
  const pOut = Math.max(0.01, 1 - pIn);
  let m = (sIn * pIn) / pOut;
  for (let i = 0; i < 30; i++) {
    const z = (y - m - (x + sIn)) / Math.max(1e-10, l);
    const f = (y - m - x - sIn) * normCdf(z) + l * normPdf(z) - (y - m) - target;
    const deriv = Math.max(0.0001, 1 - normCdf(z));
    const next = Math.max(0, m - f / deriv);
    if (Math.abs(next - m) < 1e-7) return next;
    m = next;
  }
  return m;
}

/** Collateral received for selling s YES shares (closed form). */
export function solveSellProceeds(x: number, y: number, l: number, s: number): number {
  const i0 = invariantValue(x, y, l);
  const zBar = (y - x - s) / Math.max(1e-10, l);
  const a = (y - x - s) * normCdf(zBar) + l * normPdf(zBar) - y;
  return clamp(0, s, i0 - a);
}

// ---------------------------------------------------------------------------
// Market-level quoting (virtual-reserve model, mirrors on-ledger choices)
// ---------------------------------------------------------------------------

export interface AmmMarketState {
  currentPrice: number; // cached YES price from the contract
  liquidityL: number; // L0
  isDynamic: boolean;
  createdAt: number; // epoch seconds
  expiresAt: number; // epoch seconds
  feeBps: number;
  liquidityPeriodSecs?: number; // pre-trading collection window (decay anchor offset)
}

const feeFraction = (bps: number) => bps / 10000;

/** Trading opens (and L starts decaying) after the liquidity-collection window. */
export const tradingStartsAt = (m: AmmMarketState) => m.createdAt + (m.liquidityPeriodSecs ?? 0);

export function marketEffectiveL(m: AmmMarketState, nowSecs = Math.floor(Date.now() / 1000)) {
  return effectiveLiquidity(m.isDynamic, m.liquidityL, tradingStartsAt(m), m.expiresAt, nowSecs);
}

export interface BuyQuote {
  sharesOut: number;
  fee: number;
  avgPrice: number;
  newPrice: number;
  priceImpact: number; // |P' - P| / P
}

/** Quote a Buy: collateral in (`amount`, in the market's instrument) → shares out (mirrors PredictionMarket.Buy). */
export function quoteBuy(
  m: AmmMarketState,
  side: "Yes" | "No",
  amount: number,
  nowSecs = Math.floor(Date.now() / 1000),
): BuyQuote | null {
  const l = marketEffectiveL(m, nowSecs);
  if (l <= 0 || amount <= 0) return null;
  const { x, y } = optimalReserves(m.currentPrice, l);
  const fee = amount * feeFraction(m.feeBps);
  const net = amount - fee;
  const sharesOut = side === "Yes" ? solveBuyShares(x, y, l, net) : solveBuyShares(y, x, l, net);
  if (sharesOut <= 0) return null;
  const diff = y - x;
  const newDiff = side === "Yes" ? diff + sharesOut : diff - sharesOut;
  const newPrice = clampProb(normCdf(newDiff / l));
  const sidePrice = side === "Yes" ? m.currentPrice : 1 - m.currentPrice;
  const newSidePrice = side === "Yes" ? newPrice : 1 - newPrice;
  return {
    sharesOut,
    fee,
    avgPrice: amount / sharesOut,
    newPrice,
    priceImpact: Math.abs(newSidePrice - sidePrice) / Math.max(1e-9, sidePrice),
  };
}

export interface SellQuote {
  grossProceeds: number;
  fee: number;
  netProceeds: number;
  avgPrice: number;
  newPrice: number;
}

/** Quote a Sell: shares in → net collateral out (mirrors PredictionMarket.Sell). */
export function quoteSell(
  m: AmmMarketState,
  side: "Yes" | "No",
  sharesIn: number,
  nowSecs = Math.floor(Date.now() / 1000),
): SellQuote | null {
  const l = marketEffectiveL(m, nowSecs);
  if (l <= 0 || sharesIn <= 0) return null;
  const { x, y } = optimalReserves(m.currentPrice, l);
  const gross = side === "Yes" ? solveSellProceeds(x, y, l, sharesIn) : solveSellProceeds(y, x, l, sharesIn);
  if (gross <= 0) return null;
  const fee = gross * feeFraction(m.feeBps);
  const diff = y - x;
  const newDiff = side === "Yes" ? diff - sharesIn : diff + sharesIn;
  return {
    grossProceeds: gross,
    fee,
    netProceeds: gross - fee,
    avgPrice: gross / sharesIn,
    newPrice: clampProb(normCdf(newDiff / l)),
  };
}

export interface SwapQuote {
  sharesOut: number;
  fee: number; // in input shares
  newPrice: number;
  priceImpact: number;
}

/** Quote a direct YES<->NO swap (mirrors PredictionMarket.SwapShares). */
export function quoteSwapShares(
  m: AmmMarketState,
  fromSide: "Yes" | "No",
  sharesIn: number,
  nowSecs = Math.floor(Date.now() / 1000),
): SwapQuote | null {
  const l = marketEffectiveL(m, nowSecs);
  if (l <= 0 || sharesIn <= 0) return null;
  const { x, y } = optimalReserves(m.currentPrice, l);
  const fee = sharesIn * feeFraction(m.feeBps);
  const net = sharesIn - fee;
  const sharesOut = fromSide === "Yes" ? solveSwapOut(x, y, l, net) : solveSwapOut(y, x, l, net);
  if (sharesOut <= 0) return null;
  const diff = y - x;
  const newDiff = fromSide === "Yes" ? diff - sharesOut - net : diff + sharesOut + net;
  const newPrice = clampProb(normCdf(newDiff / l));
  const toPrice = fromSide === "Yes" ? 1 - m.currentPrice : m.currentPrice;
  const newToPrice = fromSide === "Yes" ? 1 - newPrice : newPrice;
  return {
    sharesOut,
    fee,
    newPrice,
    priceImpact: Math.abs(newToPrice - toPrice) / Math.max(1e-9, toPrice),
  };
}

export interface LiquidityQuote {
  /** Collateral debited: max(dx, dy), in the market's instrument. */
  cost: number;
  lpMinted: number;
  shareOfPool: number; // after the deposit
  newL: number;
}

/** Quote ProvideLiquidity: desired value increase → collateral cost + LP minted. */
export function quoteProvideLiquidity(
  m: AmmMarketState & { lpTokenSupply: number },
  valueIncrease: number,
  nowSecs = Math.floor(Date.now() / 1000),
): LiquidityQuote | null {
  const l = marketEffectiveL(m, nowSecs);
  if (l <= 0 || valueIncrease <= 0) return null;
  const v = poolValue(m.currentPrice, l);
  const ratio = valueIncrease / v;
  const { x, y } = optimalReserves(m.currentPrice, l);
  const cost = Math.max(x * ratio, y * ratio);
  const lpMinted = m.lpTokenSupply * ratio;
  return {
    cost,
    lpMinted,
    shareOfPool: lpMinted / (m.lpTokenSupply + lpMinted),
    newL: m.liquidityL * (1 + ratio),
  };
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

export function formatCents(price: number) {
  return `${Math.round(price * 100)}¢`;
}

export function formatProbability(p: number) {
  return `${(p * 100).toFixed(1)}%`;
}
