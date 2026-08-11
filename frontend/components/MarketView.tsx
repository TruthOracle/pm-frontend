import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  Button,
  Skeleton,
  Text,
  useDisclosure,
  useToast,
} from "@chakra-ui/react";
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useCantonWallet } from "@/wallets";
import { useIsAdmin } from "@/lib/useIsAdmin";
import {
  buildBuyParams,
  buildSellParams,
  buildSwapSharesParams,
  buildSplitParams,
  buildMergeParams,
  buildProvideLiquidityParams,
  buildWithdrawLiquidityParams,
  buildResolveT0Params,
  buildResolveParams,
  buildProposeOutcomeParams,
  buildChallengeOutcomeParams,
  buildFinalizeOutcomeParams,
  buildVoidMarketParams,
  buildRedeemPositionParams,
  templateId,
  type DisclosedContractArg,
  type OutcomeArg,
} from "@/utils/cantonCommands";
import {
  fetchAllPredictionMarkets,
  fetchUserPosition,
  fetchUserLpPosition,
  fetchPendingPayouts,
  fetchAttestations,
  type PredictionMarketRecord,
  type UserMarketPosition,
  type LiquidityPositionRecord,
  type PendingPayoutRecord,
  type OutcomeAttestationRecord,
} from "@/utils/activeContracts";
import { getCantonCoinHoldings, type AmuletHoldings } from "@/view-functions/getAccountBalance";
import { runAdminAutoPayout } from "@/lib/adminAutoPayout";
import {
  enterpriseWalletPartyId,
  submitAdminTransaction,
} from "@/lib/enterpriseWalletSubmit";
import {
  quoteBuy,
  quoteSell,
  quoteSwapShares,
  quoteProvideLiquidity,
  marketEffectiveL,
  poolValue,
  type AmmMarketState,
} from "@/lib/marketPricing";

type MarketPhase = "liquidity_period" | "trading" | "expired" | "proposed" | "resolved" | "voided";
type MainTab = "trade" | "liquidity" | "resolve" | "settle";
type TradeSubTab = "swap" | "mint";
type LiquiditySubTab = "add" | "remove";

function getMarketPhase(m: PredictionMarketRecord, nowSecs = Math.floor(Date.now() / 1000)): MarketPhase {
  if (m.status === "Resolved") return "resolved";
  if (m.status === "Voided") return "voided";
  if (m.status === "Proposed") return "proposed";
  if (nowSecs >= m.expiresAt) return "expired";
  if (nowSecs < m.createdAt + m.liquidityPeriodSecs) return "liquidity_period";
  return "trading";
}

function ammState(m: PredictionMarketRecord): AmmMarketState & { lpTokenSupply: number } {
  return {
    currentPrice: m.currentPrice,
    liquidityL: m.liquidityL,
    isDynamic: m.isDynamic,
    createdAt: m.createdAt,
    expiresAt: m.expiresAt,
    feeBps: m.feeBps,
    liquidityPeriodSecs: m.liquidityPeriodSecs,
    lpTokenSupply: m.lpTokenSupply,
  };
}

const SLIPPAGE_OPTIONS = [0.005, 0.01, 0.02];

function fmtCC(v: number, dp = 4) {
  return v.toFixed(dp).replace(/\.?0+$/, "") || "0";
}

function fmtCountdown(target: number, nowSecs: number): string {
  const s = Math.max(0, target - nowSecs);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const mnt = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${mnt}m`;
  return `${mnt}m ${s % 60}s`;
}

async function waitForPositionUpdate(
  partyId: string,
  marketId: number,
  check: (pos: UserMarketPosition | null) => boolean,
  timeoutMs = 30_000,
  intervalMs = 1500,
): Promise<UserMarketPosition | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pos = await fetchUserPosition(partyId, marketId);
    if (check(pos)) return pos;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}

/**
 * After Sell / Merge / Redeem / Withdraw creates a PendingPayout, poll until we
 * see it for this user + market. Returns the new payout if found, null on
 * timeout (caller should leave it queued for manual admin processing).
 */
async function waitForNewPendingPayout(
  partyId: string,
  marketId: number,
  beforeCids: Set<string>,
  timeoutMs = 15_000,
  intervalMs = 1000,
): Promise<PendingPayoutRecord | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const list = await fetchPendingPayouts(partyId);
    const fresh = list.find(
      (p) => p.user === partyId && p.marketId === marketId && !beforeCids.has(p.contractId),
    );
    if (fresh) return fresh;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}

/** Market-header stat box. */
function StatBox({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 text-xl font-bold ${accent ?? "text-foreground"}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function MarketHistoryChart({ probability }: { probability: number }) {
  const base = Math.max(0.18, Math.min(0.82, probability));
  const values = [0.22, 0.28, 0.24, 0.44, 0.39, 0.51, 0.47, 0.66, 0.59, base];
  const points = values.map((value, index) => ({ x: index * (100 / (values.length - 1)), y: 100 - value * 100 }));
  const line = points.map(({ x, y }) => `${x},${y}`).join(" ");

  return (
    <section className="market-history-card">
      <div className="mb-5 flex items-start justify-between border-b border-slate-100 pb-4">
        <div>
          <p className="eyebrow !mb-1">Probability history</p>
          <p className="text-3xl font-bold tracking-[-0.05em] text-slate-950">{Math.round(probability * 100)}% <span className="text-sm font-semibold tracking-normal text-slate-500">Yes</span></p>
        </div>
        <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700">Live market</span>
      </div>
      <div className="market-history-plot">
        <div className="market-history-y-axis"><span>100%</span><span>75%</span><span>50%</span><span>25%</span><span>0%</span></div>
        <div className="market-history-canvas">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Probability history chart">
            <defs><linearGradient id="market-history-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#10b981" stopOpacity=".28" /><stop offset="1" stopColor="#10b981" stopOpacity="0" /></linearGradient></defs>
            <polygon points={`0,100 ${line} 100,100`} fill="url(#market-history-fill)" />
            <polyline points={line} fill="none" stroke="#10b981" strokeWidth="1.8" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
            {points.map(({ x, y }) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.25" fill="#fff" stroke="#10b981" strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
          </svg>
          <div className="market-history-x-axis"><span>12:00</span><span>16:00</span><span>20:00</span><span>Now</span></div>
        </div>
      </div>
      <div className="mt-5 flex items-center gap-1 rounded-xl bg-slate-50 p-1 text-xs font-bold text-slate-400"><button className="flex-1 rounded-lg bg-white py-2 text-slate-900 shadow-sm">1D</button><button className="flex-1 py-2">1W</button><button className="flex-1 py-2">1M</button><button className="flex-1 py-2">ALL</button></div>
    </section>
  );
}

const MarketView = () => {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const marketIdNum = id != null && id !== "" ? Number(id) : NaN;

  const [market, setMarket] = useState<PredictionMarketRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [nowSecs, setNowSecs] = useState(Math.floor(Date.now() / 1000));
  const [mainTab, setMainTab] = useState<MainTab>("trade");
  const [tradeSubTab, setTradeSubTab] = useState<TradeSubTab>("swap");
  const [liquiditySubTab, setLiquiditySubTab] = useState<LiquiditySubTab>("add");
  const [collateralIn, setCollateralIn] = useState<number>(0); // Buy: CC in
  const [sharesIn, setSharesIn] = useState<number>(0); // Sell: shares in
  const [selectedSide, setSelectedSide] = useState<"yes" | "no" | null>(null);
  const [tradeSide, setTradeSide] = useState<"buy" | "sell" | "convert">("buy");
  const [slippage, setSlippage] = useState<number>(0.01);
  const [userPosition, setUserPosition] = useState<UserMarketPosition | null>(null);
  const [lpPosition, setLpPosition] = useState<LiquidityPositionRecord | null>(null);
  const [holdings, setHoldings] = useState<AmuletHoldings | null>(null);
  const [splitMergeAmount, setSplitMergeAmount] = useState<number>(0);
  const [mintMode, setMintMode] = useState<"mint" | "merge">("mint");
  const [liquidityValue, setLiquidityValue] = useState<number>(0);
  const [withdrawPct, setWithdrawPct] = useState<number>(100);
  const [resolveOutcome, setResolveOutcome] = useState<OutcomeArg>("Yes");
  const [resolveSource, setResolveSource] = useState<string>("");
  const [attestations, setAttestations] = useState<OutcomeAttestationRecord[]>([]);
  const [busy, setBusy] = useState<string | null>(null); // which action is running
  const { account, signAndSubmitTransaction, transferCC } = useCantonWallet();
  const adminPartyForCC = enterpriseWalletPartyId();
  const isAdmin = useIsAdmin();
  const toast = useToast();

  // Live clock for the dynamic-L countdown / phase transitions.
  useEffect(() => {
    const t = setInterval(() => setNowSecs(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  // Step-2 confirm dialog: after the CC transfer (popup #1) succeeds, we can't
  // chain a second popup automatically — browsers block sequential window.open
  // calls without a fresh user gesture. So we open this dialog instead, and the
  // user explicitly clicks Confirm which provides the gesture for popup #2.
  const stepTwoDialog = useDisclosure();
  const stepTwoCancelRef = React.useRef<HTMLButtonElement>(null);
  const [pendingStepTwo, setPendingStepTwo] = useState<{
    description: string;
    run: () => Promise<void>;
  } | null>(null);

  const openStepTwo = (description: string, run: () => Promise<void>) => {
    setPendingStepTwo({ description, run });
    stepTwoDialog.onOpen();
  };
  const confirmStepTwo = async () => {
    const pending = pendingStepTwo;
    if (!pending) return;
    stepTwoDialog.onClose();
    setPendingStepTwo(null);
    await pending.run();
  };
  const cancelStepTwo = () => {
    stepTwoDialog.onClose();
    setPendingStepTwo(null);
    toast({
      title: "Step 2 canceled — action not recorded",
      description: "Your CC transfer is final; the on-ledger step was skipped. Contact admin for a refund.",
      status: "warning",
      duration: 10000,
      isClosable: true,
    });
  };

  const refreshMarket = useCallback(
    async (opts?: { silent?: boolean }): Promise<PredictionMarketRecord | null> => {
      if (isNaN(marketIdNum)) return null;
      if (!opts?.silent) setLoading(true);
      try {
        const all = await fetchAllPredictionMarkets();
        const m = all.find((x) => x.marketId === marketIdNum) ?? null;
        setMarket(m);
        return m;
      } finally {
        if (!opts?.silent) setLoading(false);
      }
    },
    [marketIdNum]
  );

  useEffect(() => {
    refreshMarket();
  }, [refreshMarket]);

  useEffect(() => {
    const side = searchParams.get("side");
    if (side === "yes" || side === "no") setSelectedSide(side);
  }, [searchParams]);

  const refreshUserData = useCallback(async () => {
    if (!account?.address || isNaN(marketIdNum)) {
      setUserPosition(null);
      setLpPosition(null);
      setHoldings(null);
      return;
    }
    const [pos, lp, h] = await Promise.all([
      fetchUserPosition(account.address, marketIdNum),
      fetchUserLpPosition(account.address, marketIdNum),
      getCantonCoinHoldings(),
    ]);
    setUserPosition(pos);
    setLpPosition(lp);
    setHoldings(h);
  }, [account?.address, marketIdNum]);

  useEffect(() => {
    refreshUserData();
  }, [refreshUserData]);

  // Admin: load attestations for the T1/T2 resolution console.
  useEffect(() => {
    if (!isAdmin || !adminPartyForCC || isNaN(marketIdNum)) return;
    fetchAttestations(adminPartyForCC, marketIdNum).then(setAttestations).catch(() => {});
  }, [isAdmin, adminPartyForCC, marketIdNum, market?.status]);

  const phase = market ? getMarketPhase(market, nowSecs) : "trading";

  // Auto-route to the Settle tab once the market is settled.
  useEffect(() => {
    if (phase === "resolved" || phase === "voided") setMainTab((t) => (t === "trade" || t === "liquidity" ? "settle" : t));
  }, [phase]);

  const probYes = market?.currentPrice ?? 0.5;
  const probNo = 1 - probYes;

  const buyQuote = useMemo(() => {
    if (!market || !selectedSide || collateralIn <= 0 || phase !== "trading") return null;
    return quoteBuy(ammState(market), selectedSide === "yes" ? "Yes" : "No", collateralIn, nowSecs);
  }, [market, selectedSide, collateralIn, phase, nowSecs]);

  const sellQuote = useMemo(() => {
    if (!market || !selectedSide || sharesIn <= 0 || phase !== "trading") return null;
    return quoteSell(ammState(market), selectedSide === "yes" ? "Yes" : "No", sharesIn, nowSecs);
  }, [market, selectedSide, sharesIn, phase, nowSecs]);

  // Convert: selectedSide is the *from* side of the YES<->NO swap.
  const swapQuote = useMemo(() => {
    if (!market || !selectedSide || sharesIn <= 0 || phase !== "trading") return null;
    return quoteSwapShares(ammState(market), selectedSide === "yes" ? "Yes" : "No", sharesIn, nowSecs);
  }, [market, selectedSide, sharesIn, phase, nowSecs]);

  const canProvideLiquidity = phase === "trading" || phase === "liquidity_period";

  const liquidityQuote = useMemo(() => {
    if (!market || liquidityValue <= 0 || !canProvideLiquidity) return null;
    return quoteProvideLiquidity(ammState(market), liquidityValue, nowSecs);
  }, [market, liquidityValue, canProvideLiquidity, nowSecs]);

  const effectiveL = market ? marketEffectiveL(ammState(market), nowSecs) : 0;
  const currentPoolValue = market ? poolValue(market.currentPrice, effectiveL) : 0;

  const disclosedForMarket = (): DisclosedContractArg[] =>
    market?.contractId && market.createdEventBlob
      ? [
          {
            templateId: templateId("Truthoracle", "PredictionMarket"),
            contractId: market.contractId,
            createdEventBlob: market.createdEventBlob,
            synchronizerId: market.synchronizerId,
          },
        ]
      : [];

  const refreshAllViews = async () => {
    const w = window as unknown as { refreshPortfolio?: () => void; refreshMarketplace?: () => void };
    w.refreshPortfolio?.();
    w.refreshMarketplace?.();
    await refreshMarket({ silent: true });
    await refreshUserData();
  };

  /** Exercise a choice via the user's wallet, standard error toasts. */
  const runUserChoice = async (label: string, params: ReturnType<typeof buildBuyParams>): Promise<boolean> => {
    try {
      await signAndSubmitTransaction(params);
      return true;
    } catch (e) {
      console.error(e);
      toast({
        title: `${label} failed`,
        description: e instanceof Error ? e.message : "Wallet could not submit the transaction.",
        status: "error",
        duration: 7000,
        isClosable: true,
      });
      return false;
    }
  };

  /** Settle a fresh PendingPayout via the admin Enterprise Wallet. */
  const settleFreshPayout = async (beforeCids: Set<string>, reason: string) => {
    if (!account) return;
    try {
      const fresh = await waitForNewPendingPayout(account.address, marketIdNum, beforeCids);
      if (fresh) {
        toast({
          title: "Settling payout…",
          description: `Admin sending ${fmtCC(fresh.amountCC)} CC to your wallet.`,
          status: "info",
          duration: 4000,
          isClosable: true,
        });
        await runAdminAutoPayout({
          toUser: account.address,
          amountCC: fresh.amountCC,
          pendingPayoutCid: fresh.contractId,
          reason,
          signAndSubmitTransaction,
        });
      }
    } catch (e) {
      console.warn(`[${reason} auto-payout failed]`, e);
      toast({
        title: "Recorded — payout pending",
        description: "Admin couldn't auto-settle the payout. It's queued; refresh shortly or admin can settle from the Payout Queue.",
        status: "warning",
        duration: 8000,
        isClosable: true,
      });
    }
  };

  const snapshotPayoutCids = async (): Promise<Set<string>> => {
    if (!account) return new Set();
    const list = await fetchPendingPayouts(account.address);
    return new Set(list.filter((p) => p.user === account.address).map((p) => p.contractId));
  };

  // -------------------------------------------------------------------------
  // Trade (Buy: two-popup CC-first; Sell: single popup + auto payout)
  // -------------------------------------------------------------------------

  const handleTradeClick = async () => {
    if (!market || phase !== "trading") return;
    if (!account) {
      toast({ title: "Connect a wallet to trade", status: "info", duration: 4000, isClosable: true });
      return;
    }
    if (!selectedSide) return;
    const sideArg: OutcomeArg = selectedSide === "yes" ? "Yes" : "No";

    if (tradeSide === "buy") {
      if (!buyQuote || collateralIn <= 0) {
        toast({ title: "Enter CC amount to spend", status: "info", duration: 3000, isClosable: true });
        return;
      }
      if (holdings && holdings.balance < collateralIn) {
        toast({
          title: "Insufficient CC balance",
          description: `Need ${fmtCC(collateralIn)} CC but wallet has ${holdings.balance.toFixed(2)} CC.`,
          status: "warning",
          duration: 5000,
          isClosable: true,
        });
        return;
      }
      const minSharesOut = buyQuote.sharesOut * (1 - slippage);
      setBusy("trade");
      const t = toast({
        title: "Sending CC to market…",
        description: `Confirm the ${fmtCC(collateralIn)} CC transfer in the wallet popup.`,
        status: "info",
        duration: null,
        isClosable: false,
      });
      try {
        if (!adminPartyForCC) throw new Error("VITE_ENTERPRISE_WALLET_PARTY_ID is not set — can't address the market admin.");
        await transferCC({
          to: adminPartyForCC,
          amount: collateralIn,
          memo: `truthoracle: buy ${sideArg} with ${fmtCC(collateralIn)} CC on market #${marketIdNum}`,
          metadata: {
            kind: "truthoracle_buy",
            market_id: String(marketIdNum),
            side: selectedSide,
            collateral_cc: String(collateralIn),
          },
        });
      } catch (e) {
        if (t !== undefined) toast.close(t);
        setBusy(null);
        toast({
          title: "CC transfer failed — buy aborted",
          description: e instanceof Error ? e.message : String(e),
          status: "error",
          duration: 6000,
          isClosable: true,
        });
        return;
      }
      if (t !== undefined) toast.close(t);
      setBusy(null);
      const prevSideShares = selectedSide === "yes" ? (userPosition?.yesShares ?? 0) : (userPosition?.noShares ?? 0);
      openStepTwo(
        `${fmtCC(collateralIn)} CC sent to the market. Click Confirm to execute the pm-AMM buy — est. ${fmtCC(buyQuote.sharesOut, 2)} ${sideArg.toUpperCase()} shares (min ${fmtCC(minSharesOut, 2)}).`,
        async () => {
          setBusy("trade");
          try {
            const ok = await runUserChoice(
              "Buy",
              buildBuyParams(
                account.address,
                market.contractId,
                sideArg,
                collateralIn,
                minSharesOut,
                userPosition?.contractId ?? null,
                disclosedForMarket().length > 0 ? disclosedForMarket() : undefined,
              ),
            );
            if (!ok) {
              toast({
                title: "Share-record failed — CC was already sent",
                description: "The pm-AMM rejected the buy (slippage or expiry). Contact admin for reconciliation.",
                status: "error",
                duration: 9000,
                isClosable: true,
              });
              return;
            }
            const verified = await waitForPositionUpdate(
              account.address,
              marketIdNum,
              (pos) => {
                const cur = selectedSide === "yes" ? (pos?.yesShares ?? 0) : (pos?.noShares ?? 0);
                return cur >= prevSideShares + minSharesOut * 0.99;
              },
            );
            await refreshAllViews();
            toast({
              title: verified ? "Position updated" : "Trade submitted — confirmation pending",
              description: verified
                ? `Now holding ${fmtCC(verified.yesShares, 2)} YES / ${fmtCC(verified.noShares, 2)} NO.`
                : "Wallet accepted the transaction but the participant hasn't shown the new position yet.",
              status: verified ? "success" : "warning",
              duration: 8000,
              isClosable: true,
            });
          } finally {
            setBusy(null);
          }
        },
      );
      return;
    }

    // Convert (direct YES<->NO share swap — single popup, no CC involved)
    if (tradeSide === "convert") {
      if (!swapQuote || sharesIn <= 0) {
        toast({ title: "Enter shares to convert", status: "info", duration: 3000, isClosable: true });
        return;
      }
      if (!userPosition) {
        toast({ title: "No position to convert", status: "warning", duration: 4000, isClosable: true });
        return;
      }
      const ownedFrom = selectedSide === "yes" ? userPosition.yesShares : userPosition.noShares;
      if (ownedFrom < sharesIn) {
        toast({
          title: "Not enough shares to convert",
          description: `You own ${fmtCC(ownedFrom, 2)} ${sideArg} shares.`,
          status: "warning",
          duration: 4000,
          isClosable: true,
        });
        return;
      }
      const minOut = swapQuote.sharesOut * (1 - slippage);
      setBusy("trade");
      try {
        const ok = await runUserChoice(
          "Convert",
          buildSwapSharesParams(
            account.address,
            market.contractId,
            sideArg,
            sharesIn,
            minOut,
            userPosition.contractId,
            disclosedForMarket().length > 0 ? disclosedForMarket() : undefined,
          ),
        );
        if (!ok) return;
        await refreshAllViews();
        toast({
          title: "Shares converted",
          description: `Swapped ${fmtCC(sharesIn, 2)} ${sideArg} → ~${fmtCC(swapQuote.sharesOut, 2)} ${sideArg === "Yes" ? "NO" : "YES"}.`,
          status: "success",
          duration: 7000,
          isClosable: true,
        });
      } finally {
        setBusy(null);
      }
      return;
    }

    // Sell
    if (!sellQuote || sharesIn <= 0) {
      toast({ title: "Enter shares to sell", status: "info", duration: 3000, isClosable: true });
      return;
    }
    if (!userPosition) {
      toast({ title: "No position to sell", status: "warning", duration: 4000, isClosable: true });
      return;
    }
    const owned = selectedSide === "yes" ? userPosition.yesShares : userPosition.noShares;
    if (owned < sharesIn) {
      toast({
        title: "Not enough shares to sell",
        description: `You own ${fmtCC(owned, 2)} ${sideArg} shares.`,
        status: "warning",
        duration: 4000,
        isClosable: true,
      });
      return;
    }
    const minProceeds = sellQuote.netProceeds * (1 - slippage);
    const beforeCids = await snapshotPayoutCids();
    setBusy("trade");
    try {
      const ok = await runUserChoice(
        "Sell",
        buildSellParams(
          account.address,
          market.contractId,
          sideArg,
          sharesIn,
          minProceeds,
          userPosition.contractId,
          disclosedForMarket().length > 0 ? disclosedForMarket() : undefined,
        ),
      );
      if (!ok) return;
      await settleFreshPayout(beforeCids, "sell");
      await refreshAllViews();
      toast({
        title: "Shares sold",
        description: `Sold ${fmtCC(sharesIn, 2)} ${sideArg} for ~${fmtCC(sellQuote.netProceeds)} CC (after ${(market.feeBps / 100).toFixed(2)}% fee).`,
        status: "success",
        duration: 7000,
        isClosable: true,
      });
    } finally {
      setBusy(null);
    }
  };

  // -------------------------------------------------------------------------
  // Mint / Merge complete sets
  // -------------------------------------------------------------------------

  const handleSplitMerge = async (action: "split" | "merge") => {
    if (!market || (phase !== "trading" && phase !== "liquidity_period")) return;
    if (!account) {
      toast({ title: "Connect wallet first", status: "info", duration: 4000, isClosable: true });
      return;
    }
    const amt = splitMergeAmount;
    if (amt <= 0) {
      toast({ title: "Enter an amount", status: "info", duration: 3000, isClosable: true });
      return;
    }
    if (action === "split" && holdings && holdings.balance < amt) {
      toast({
        title: "Insufficient CC balance",
        description: `Need ${fmtCC(amt)} CC to mint ${fmtCC(amt, 2)} complete sets.`,
        status: "warning",
        duration: 5000,
        isClosable: true,
      });
      return;
    }
    if (action === "merge") {
      if (!userPosition || userPosition.yesShares < amt || userPosition.noShares < amt) {
        toast({
          title: "Not enough Yes + No pairs",
          description: `You own ${fmtCC(userPosition?.yesShares ?? 0, 2)} Yes / ${fmtCC(userPosition?.noShares ?? 0, 2)} No.`,
          status: "warning",
          duration: 5000,
          isClosable: true,
        });
        return;
      }
    }

    const beforeCids = action === "merge" ? await snapshotPayoutCids() : new Set<string>();

    const runChoice = async () => {
      setBusy("splitmerge");
      try {
        const disclosed = disclosedForMarket();
        const params = action === "split"
          ? buildSplitParams(account.address, market.contractId, amt, userPosition?.contractId ?? null, disclosed.length > 0 ? disclosed : undefined)
          : buildMergeParams(account.address, market.contractId, amt, userPosition!.contractId, disclosed.length > 0 ? disclosed : undefined);
        const ok = await runUserChoice(action === "split" ? "Mint set" : "Merge", params);
        if (!ok) return;
        if (action === "merge") await settleFreshPayout(beforeCids, "merge");
        await refreshAllViews();
        toast({
          title: action === "split" ? "Complete sets minted" : "Merge requested",
          description: action === "split"
            ? `Minted ${fmtCC(amt, 2)} Yes + ${fmtCC(amt, 2)} No for ${fmtCC(amt)} CC.`
            : `Burned ${fmtCC(amt, 2)} pairs — payout of ${fmtCC(amt)} CC from admin.`,
          status: "success",
          duration: 6000,
          isClosable: true,
        });
      } finally {
        setBusy(null);
      }
    };

    if (action === "merge") {
      await runChoice();
      return;
    }

    // Mint: popup #1 = CC transfer, popup #2 (gated by dialog) = Split choice.
    setBusy("splitmerge");
    try {
      if (!adminPartyForCC) throw new Error("VITE_ENTERPRISE_WALLET_PARTY_ID is not set.");
      await transferCC({
        to: adminPartyForCC,
        amount: amt,
        memo: `truthoracle: mint ${fmtCC(amt, 2)} complete sets on market #${marketIdNum}`,
        metadata: { kind: "truthoracle_split", market_id: String(marketIdNum), pairs: String(amt) },
      });
    } catch (e) {
      console.error(e);
      setBusy(null);
      toast({
        title: "Mint CC transfer failed",
        description: e instanceof Error ? e.message : String(e),
        status: "error",
        duration: 6000,
        isClosable: true,
      });
      return;
    }
    setBusy(null);
    openStepTwo(
      `${fmtCC(amt)} CC sent to the market. Click Confirm to mint ${fmtCC(amt, 2)} Yes + ${fmtCC(amt, 2)} No on-ledger.`,
      runChoice,
    );
  };

  // -------------------------------------------------------------------------
  // Liquidity (value-based provide; withdraw locked for dynamic pools)
  // -------------------------------------------------------------------------

  const handleProvideLiquidity = async () => {
    if (!market || !canProvideLiquidity || !account) return;
    if (!liquidityQuote || liquidityValue <= 0) {
      toast({ title: "Enter a pool-value increase", status: "info", duration: 3000, isClosable: true });
      return;
    }
    const cost = liquidityQuote.costCC;
    const maxCost = cost * (1 + slippage);
    if (holdings && holdings.balance < cost) {
      toast({
        title: "Insufficient CC balance",
        description: `Providing ${fmtCC(liquidityValue)} CC of pool value costs ${fmtCC(cost)} CC.`,
        status: "warning",
        duration: 5000,
        isClosable: true,
      });
      return;
    }
    setBusy("liquidity");
    try {
      if (!adminPartyForCC) throw new Error("VITE_ENTERPRISE_WALLET_PARTY_ID is not set.");
      await transferCC({
        to: adminPartyForCC,
        amount: cost,
        memo: `truthoracle: provide ${fmtCC(liquidityValue)} CC liquidity on market #${marketIdNum}`,
        metadata: { kind: "truthoracle_liquidity", market_id: String(marketIdNum), value_cc: String(liquidityValue) },
      });
    } catch (e) {
      setBusy(null);
      toast({
        title: "CC transfer failed — liquidity aborted",
        description: e instanceof Error ? e.message : String(e),
        status: "error",
        duration: 6000,
        isClosable: true,
      });
      return;
    }
    setBusy(null);
    openStepTwo(
      `${fmtCC(cost)} CC sent. Click Confirm to add ${fmtCC(liquidityValue)} CC of pool value (≈${fmtCC(liquidityQuote.lpMinted, 4)} LP tokens).`,
      async () => {
        setBusy("liquidity");
        try {
          const ok = await runUserChoice(
            "Provide liquidity",
            buildProvideLiquidityParams(
              account.address,
              market.contractId,
              liquidityValue,
              maxCost,
              lpPosition?.contractId ?? null,
              disclosedForMarket().length > 0 ? disclosedForMarket() : undefined,
            ),
          );
          if (ok) {
            await refreshAllViews();
            toast({ title: "Liquidity added", status: "success", duration: 5000, isClosable: true });
          }
        } finally {
          setBusy(null);
        }
      },
    );
  };

  const handleWithdrawLiquidity = async () => {
    if (!market || !account || !lpPosition) return;
    const burn = lpPosition.lpTokens * (withdrawPct / 100);
    if (burn <= 0) return;
    if (market.isDynamic && phase !== "resolved" && phase !== "voided") {
      toast({
        title: "Dynamic-pool LP is locked",
        description: "Uniform-LVR design: liquidity exits after resolution or void.",
        status: "info",
        duration: 6000,
        isClosable: true,
      });
      return;
    }
    const beforeCids = await snapshotPayoutCids();
    setBusy("withdraw");
    try {
      const ok = await runUserChoice(
        "Withdraw liquidity",
        buildWithdrawLiquidityParams(
          account.address,
          market.contractId,
          burn,
          lpPosition.contractId,
          userPosition?.contractId ?? null,
          disclosedForMarket().length > 0 ? disclosedForMarket() : undefined,
        ),
      );
      if (!ok) return;
      await settleFreshPayout(beforeCids, "liquidity");
      await refreshAllViews();
      toast({ title: "Liquidity withdrawn", status: "success", duration: 5000, isClosable: true });
    } finally {
      setBusy(null);
    }
  };

  // -------------------------------------------------------------------------
  // Resolution (T0 admin; T3 propose/finalize; void) and redemption
  // -------------------------------------------------------------------------

  const handleResolveT0 = async () => {
    if (!market || !account || !isAdmin) return;
    const source = resolveSource || market.policy.sources[0] || market.resolutionDescription || "operator";
    setBusy("resolve");
    try {
      const adminParty = enterpriseWalletPartyId() || account.address;
      const params = buildResolveT0Params(adminParty, market.contractId, resolveOutcome, source);
      await submitAdminTransaction(params, signAndSubmitTransaction);
      await refreshAllViews();
      toast({
        title: "Market resolved",
        description: `Recorded ${resolveOutcome} (T0 operator resolution from ${source}).`,
        status: "success",
        duration: 7000,
        isClosable: true,
      });
    } catch (e) {
      console.error(e);
      toast({
        title: "Resolve failed",
        description: e instanceof Error ? e.message : "Could not submit ResolveT0.",
        status: "error",
        duration: 6000,
        isClosable: true,
      });
    } finally {
      setBusy(null);
    }
  };

  const handleResolveWithAttestations = async () => {
    if (!market || !account || !isAdmin || attestations.length === 0) return;
    setBusy("resolve");
    try {
      const adminParty = enterpriseWalletPartyId() || account.address;
      const params = buildResolveParams(adminParty, market.contractId, attestations.map((a) => a.contractId));
      await submitAdminTransaction(params, signAndSubmitTransaction);
      await refreshAllViews();
      toast({ title: "Market resolved from attestations", status: "success", duration: 7000, isClosable: true });
    } catch (e) {
      console.error(e);
      toast({
        title: "Resolve failed",
        description: e instanceof Error ? e.message : "Quorum/signature requirements not met.",
        status: "error",
        duration: 7000,
        isClosable: true,
      });
    } finally {
      setBusy(null);
    }
  };

  const handleVoidMarket = async () => {
    if (!market || !account || !isAdmin) return;
    setBusy("void");
    try {
      const adminParty = enterpriseWalletPartyId() || account.address;
      await submitAdminTransaction(buildVoidMarketParams(adminParty, market.contractId), signAndSubmitTransaction);
      await refreshAllViews();
      toast({ title: "Market voided", description: "Traders can redeem their cost basis.", status: "success", duration: 6000, isClosable: true });
    } catch (e) {
      toast({
        title: "Void failed",
        description: e instanceof Error ? e.message : "Grace period may not have elapsed.",
        status: "error",
        duration: 6000,
        isClosable: true,
      });
    } finally {
      setBusy(null);
    }
  };

  const handlePropose = async (outcome: OutcomeArg) => {
    if (!market || !account) return;
    const bond = market.policy.bondCC;
    const doPropose = async () => {
      setBusy("propose");
      try {
        const ok = await runUserChoice(
          "Propose outcome",
          buildProposeOutcomeParams(account.address, market.contractId, outcome, disclosedForMarket().length > 0 ? disclosedForMarket() : undefined),
        );
        if (ok) {
          await refreshAllViews();
          toast({
            title: `Proposed ${outcome}`,
            description: `Challenge window: ${fmtCountdown(nowSecs + market.policy.challengeSecs, nowSecs)}.`,
            status: "success",
            duration: 6000,
            isClosable: true,
          });
        }
      } finally {
        setBusy(null);
      }
    };
    if (bond > 0) {
      setBusy("propose");
      try {
        if (!adminPartyForCC) throw new Error("VITE_ENTERPRISE_WALLET_PARTY_ID is not set.");
        await transferCC({
          to: adminPartyForCC,
          amount: bond,
          memo: `truthoracle: T3 proposal bond on market #${marketIdNum}`,
          metadata: { kind: "truthoracle_bond", market_id: String(marketIdNum), role: "proposer" },
        });
      } catch (e) {
        setBusy(null);
        toast({ title: "Bond transfer failed", description: e instanceof Error ? e.message : String(e), status: "error", duration: 6000, isClosable: true });
        return;
      }
      setBusy(null);
      openStepTwo(`${fmtCC(bond)} CC bond posted. Click Confirm to propose ${outcome} on-ledger.`, doPropose);
    } else {
      await doPropose();
    }
  };

  const handleChallenge = async (outcome: OutcomeArg) => {
    if (!market || !account) return;
    const bond = market.policy.bondCC;
    const doChallenge = async () => {
      setBusy("challenge");
      try {
        const ok = await runUserChoice(
          "Challenge",
          buildChallengeOutcomeParams(account.address, market.contractId, outcome, disclosedForMarket().length > 0 ? disclosedForMarket() : undefined),
        );
        if (ok) {
          await refreshAllViews();
          toast({
            title: `Challenged with ${outcome}`,
            description: "Escalates objectively to the reporter quorum / signed source — never a vote.",
            status: "success",
            duration: 7000,
            isClosable: true,
          });
        }
      } finally {
        setBusy(null);
      }
    };
    if (bond > 0) {
      setBusy("challenge");
      try {
        if (!adminPartyForCC) throw new Error("VITE_ENTERPRISE_WALLET_PARTY_ID is not set.");
        await transferCC({
          to: adminPartyForCC,
          amount: bond,
          memo: `truthoracle: T3 challenge bond on market #${marketIdNum}`,
          metadata: { kind: "truthoracle_bond", market_id: String(marketIdNum), role: "challenger" },
        });
      } catch (e) {
        setBusy(null);
        toast({ title: "Bond transfer failed", description: e instanceof Error ? e.message : String(e), status: "error", duration: 6000, isClosable: true });
        return;
      }
      setBusy(null);
      openStepTwo(`${fmtCC(bond)} CC bond posted. Click Confirm to challenge with ${outcome}.`, doChallenge);
    } else {
      await doChallenge();
    }
  };

  const handleFinalize = async () => {
    if (!market || !account) return;
    setBusy("finalize");
    try {
      const ok = await runUserChoice(
        "Finalize",
        buildFinalizeOutcomeParams(account.address, market.contractId, disclosedForMarket().length > 0 ? disclosedForMarket() : undefined),
      );
      if (ok) {
        await refreshAllViews();
        toast({ title: "Proposal finalized", status: "success", duration: 6000, isClosable: true });
      }
    } finally {
      setBusy(null);
    }
  };

  const handleRedeem = async () => {
    if (!market || !account || !userPosition) return;
    const beforeCids = await snapshotPayoutCids();
    setBusy("redeem");
    try {
      const ok = await runUserChoice(
        "Redeem",
        buildRedeemPositionParams(
          account.address,
          market.contractId,
          userPosition.contractId,
          disclosedForMarket().length > 0 ? disclosedForMarket() : undefined,
        ),
      );
      if (!ok) return;
      await settleFreshPayout(beforeCids, market.status === "Voided" ? "void-refund" : "resolve");
      await refreshAllViews();
      toast({ title: "Position redeemed", status: "success", duration: 6000, isClosable: true });
    } finally {
      setBusy(null);
    }
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (loading && !market) {
    return (
      <div className="space-y-4 py-8">
        <Skeleton height="32px" borderRadius="lg" />
        <Skeleton height="20px" borderRadius="lg" />
        <Skeleton height="120px" borderRadius="xl" />
      </div>
    );
  }

  if (!market) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-2">
        <Text fontSize="lg" color="gray.400">Market #{id} not found.</Text>
      </div>
    );
  }

  const redeemable = (phase === "resolved" || phase === "voided") && userPosition
    ? phase === "voided"
      ? Math.min(userPosition.costBasisCC, Math.max(userPosition.yesShares, userPosition.noShares))
      : market.outcome === "Yes"
        ? userPosition.yesShares
        : market.outcome === "No"
          ? userPosition.noShares
          : 0
    : 0;

  const reserveInventory = market.reserveYes + market.reserveNo;

  const tiers: string[] = [];
  if (market.policy.operatorResolution) tiers.push("T0 operator");
  if (market.policy.sourceKeys.length > 0) tiers.push("T1 signed source");
  if (market.policy.reporters.length > 0) tiers.push(`T2 ${market.policy.quorum}-of-${market.policy.reporters.length} reporters`);
  if (market.policy.challengeSecs > 0) tiers.push(`T3 optimistic (${Math.round(market.policy.challengeSecs / 3600)}h window, ${fmtCC(market.policy.bondCC)} CC bond)`);

  const showResolveTab = (isAdmin || market.policy.challengeSecs > 0) && (phase === "expired" || phase === "proposed");
  const showSettleTab = phase === "resolved" || phase === "voided";

  const tabs: { key: MainTab; label: string; visible: boolean }[] = [
    { key: "trade", label: "Trade", visible: true },
    { key: "liquidity", label: "Liquidity", visible: true },
    { key: "resolve", label: "Resolve", visible: showResolveTab },
    { key: "settle", label: "Settle", visible: showSettleTab },
  ];

  // ---- Phase banner (MarketPhaseIndicator) ----
  const phaseBanner = (() => {
    switch (phase) {
      case "liquidity_period":
        return {
          cls: "border-oracle-blue/30 bg-oracle-blue/10 text-oracle-blue",
          text: `Liquidity collection — trading opens in ${fmtCountdown(market.createdAt + market.liquidityPeriodSecs, nowSecs)} (mint sets & add liquidity now; swaps open at trading start)`,
        };
      case "trading":
        return {
          cls: "border-oracle-yes/30 bg-oracle-yes/10 text-oracle-yes",
          text: `Trading live — expires in ${fmtCountdown(market.expiresAt, nowSecs)}${market.isDynamic ? ` · liquidity decaying √(T−t), L_eff ${fmtCC(effectiveL, 2)}` : ""}`,
        };
      case "expired":
        return {
          cls: "border-yellow-500/30 bg-yellow-500/10 text-yellow-600",
          text: `Trading ended — awaiting resolution (grace ends in ${fmtCountdown(market.expiresAt + market.gracePeriodSecs, nowSecs)})`,
        };
      case "proposed":
        return {
          cls: "border-oracle-purple/30 bg-oracle-purple/10 text-oracle-purple",
          text: market.proposal
            ? `Outcome ${market.proposal.proposedOutcome} proposed — ${market.proposal.challenger ? "challenged, awaiting objective escalation" : `challenge window closes in ${fmtCountdown(market.proposal.proposedAt + market.policy.challengeSecs, nowSecs)}`}`
            : "Outcome proposed",
        };
      case "resolved":
        return {
          cls: "border-primary/30 bg-primary/10 text-primary",
          text: `Resolved: ${market.outcome === "Yes" ? "Yes wins" : market.outcome === "No" ? "No wins" : "Void"} — winning shares redeem 1:1 in the Settle tab`,
        };
      case "voided":
        return {
          cls: "border-border bg-secondary text-muted-foreground",
          text: "Voided — cost-basis refunds available in the Settle tab",
        };
    }
  })();

  // ---- Sidebar: Your Position (Trade tab) ----
  const yourPositionBox = (
    <div className="rounded-xl border border-primary/20 bg-primary/5 p-5">
      <h3 className="mb-3 text-sm font-semibold text-foreground">Your Position</h3>
      {!account ? (
        <p className="text-xs text-muted-foreground">Connect a wallet to see your position.</p>
      ) : !userPosition ? (
        <p className="text-xs text-muted-foreground">No position in this market yet.</p>
      ) : (
        <>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">YES shares</span>
              <span className="font-semibold text-oracle-yes">{fmtCC(userPosition.yesShares, 2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">NO shares</span>
              <span className="font-semibold text-oracle-no">{fmtCC(userPosition.noShares, 2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Cost basis</span>
              <span className="font-semibold text-foreground">{fmtCC(userPosition.costBasisCC, 2)} CC</span>
            </div>
            <div className="flex justify-between border-t border-border pt-2">
              <span className="text-muted-foreground">Value at current price</span>
              <span className="font-semibold text-foreground">
                {fmtCC(userPosition.yesShares * probYes + userPosition.noShares * probNo, 2)} CC
              </span>
            </div>
          </div>
        </>
      )}
      {holdings && (
        <p className="mt-3 border-t border-border pt-2 text-xs text-muted-foreground">
          Wallet balance: <span className="font-medium text-primary">{holdings.balance.toFixed(2)} CC</span>
        </p>
      )}
    </div>
  );

  // ---- Sidebar: Your LP Position (Liquidity tab) ----
  const yourLpBox = (
    <div className="rounded-xl border border-oracle-blue/20 bg-oracle-blue/5 p-5">
      <h3 className="mb-3 text-sm font-semibold text-foreground">Your LP Position</h3>
      {!account ? (
        <p className="text-xs text-muted-foreground">Connect a wallet to see your LP position.</p>
      ) : !lpPosition || lpPosition.lpTokens <= 0 ? (
        <p className="text-xs text-muted-foreground">No liquidity provided yet.</p>
      ) : (
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">LP tokens</span>
            <span className="font-semibold text-foreground">{fmtCC(lpPosition.lpTokens, 4)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Share of pool</span>
            <span className="font-semibold text-foreground">
              {market.lpTokenSupply > 0 ? ((lpPosition.lpTokens / market.lpTokenSupply) * 100).toFixed(2) : "0"}%
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Deposited</span>
            <span className="font-semibold text-foreground">{fmtCC(lpPosition.depositedCC, 2)} CC</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">YES reserve share</span>
            <span className="text-foreground">
              {fmtCC(market.lpTokenSupply > 0 ? (lpPosition.lpTokens / market.lpTokenSupply) * market.reserveYes : 0, 2)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">NO reserve share</span>
            <span className="text-foreground">
              {fmtCC(market.lpTokenSupply > 0 ? (lpPosition.lpTokens / market.lpTokenSupply) * market.reserveNo : 0, 2)}
            </span>
          </div>
          <div className="flex justify-between border-t border-border pt-2">
            <span className="text-muted-foreground">Fee pot (pool)</span>
            <span className="text-foreground">{fmtCC(market.accumulatedFeesCC, 4)} CC</span>
          </div>
        </div>
      )}
      {market.isDynamic && (
        <p className="mt-3 rounded bg-oracle-purple/10 px-2 py-1.5 text-center text-[11px] text-oracle-purple">
          Dynamic pool: LP locked until resolution; expected total LVR ≈ V₀/2.
        </p>
      )}
    </div>
  );

  const subTabBtn = (active: boolean) =>
    `flex-1 py-2 text-sm font-semibold transition-all ${active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"}`;

  return (
    <div className="space-y-6">
      {/* ---------------- Market header ---------------- */}
      <div>
        <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-secondary px-3 py-1 text-xs font-medium text-muted-foreground">
          Market #{market.marketId}
          {market.category && <span className="text-oracle-blue">{market.category}</span>}
          {market.isDynamic && <span className="text-oracle-purple">dynamic pm-AMM</span>}
        </div>
        <h1 className="text-2xl font-bold leading-tight text-foreground sm:text-3xl">{market.question}</h1>
        {market.description && <p className="mt-2 text-base text-muted-foreground">{market.description}</p>}
      </div>

      {/* ---------------- Market stat boxes ---------------- */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatBox
          label="Current Probability"
          value={`${(probYes * 100).toFixed(1)}%`}
          sub="chance of Yes"
          accent="text-oracle-yes"
        />
        <StatBox
          label="Cumulative Token Volume"
          value={`${fmtCC(market.totalVolumeCC, 2)} CC`}
          sub="lifetime traded collateral"
        />
        <StatBox
          label="Reserve Inventory"
          value={fmtCC(reserveInventory, 2)}
          sub={`${fmtCC(market.reserveYes, 2)} YES · ${fmtCC(market.reserveNo, 2)} NO`}
        />
        <StatBox
          label="Trading Fee"
          value={`${(market.feeBps / 100).toFixed(2)}%`}
          sub={`pool value ${fmtCC(currentPoolValue, 2)} CC`}
        />
      </div>

      {/* ---------------- Phase indicator ---------------- */}
      <div className={`rounded-xl border px-4 py-3 text-sm font-medium ${phaseBanner.cls}`}>
        {phase === "trading" && <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-oracle-yes" />}
        {phaseBanner.text}
      </div>

      {/* Probability bar */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-1.5 flex items-baseline justify-between text-sm">
          <span className="font-bold text-oracle-yes">Yes {(probYes * 100).toFixed(1)}¢</span>
          <span className="font-bold text-oracle-no">No {(probNo * 100).toFixed(1)}¢</span>
        </div>
        <div className="prob-bar">
          <div className="prob-bar-yes" style={{ width: `${probYes * 100}%` }} />
        </div>
      </div>

      {market.resolutionDescription && (
        <p className="rounded-lg border border-border bg-secondary/50 px-4 py-3 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Resolution criteria: </span>
          {market.resolutionDescription}
          {tiers.length > 0 && (
            <span className="block pt-1 text-xs">
              <span className="font-medium text-foreground">Policy: </span>
              {tiers.join(" · ")}
              {market.policy.sources.length > 0 && ` · Sources: ${market.policy.sources.join(", ")}`}
            </span>
          )}
        </p>
      )}

      {/* ---------------- Main tabs ---------------- */}
      <div className="flex gap-1 rounded-full bg-secondary p-1">
        {tabs.filter((t) => t.visible).map((t) => (
          <button
            key={t.key}
            onClick={() => setMainTab(t.key)}
            className={`tab-pill ${mainTab === t.key ? "tab-pill-active" : "tab-pill-inactive"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ================= TRADE TAB ================= */}
      {mainTab === "trade" && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,.8fr)] lg:items-start">
          <MarketHistoryChart probability={probYes} />
          <div className="space-y-4">
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
            <div className="w-full space-y-4">{yourPositionBox}</div>
          </div>
        </div>
      )}

      {/* ================= LIQUIDITY TAB ================= */}
      {mainTab === "liquidity" && (
        <div className="flex flex-col gap-6 lg:flex-row">
          <div className="flex-1 space-y-4">
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
          <div className="w-full space-y-4 lg:w-80 lg:shrink-0">{yourLpBox}</div>
        </div>
      )}

      {/* ================= RESOLVE TAB ================= */}
      {mainTab === "resolve" && showResolveTab && (
        <div className="flex flex-col gap-6 lg:flex-row">
          <div className="flex-1 space-y-4">
            {/* T3 optimistic flow */}
            {market.policy.challengeSecs > 0 && (
              <div className="trade-panel border-oracle-purple/30">
                <div className="mb-3 text-center">
                  <h2 className="text-sm font-bold text-foreground">Optimistic Resolution (T3)</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Bond {fmtCC(market.policy.bondCC)} CC · challenges escalate to the objective tier, never a vote.
                  </p>
                </div>
                {phase === "expired" && (
                  <div className="flex gap-2">
                    {(["Yes", "No"] as OutcomeArg[]).map((o) => (
                      <button
                        key={o}
                        onClick={() => handlePropose(o)}
                        disabled={busy !== null || !account}
                        className={`flex-1 rounded-lg border py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${
                          o === "Yes"
                            ? "border-oracle-yes/30 text-oracle-yes hover:bg-oracle-yes/10"
                            : "border-oracle-no/30 text-oracle-no hover:bg-oracle-no/10"
                        }`}
                      >
                        Propose {o}
                      </button>
                    ))}
                  </div>
                )}
                {phase === "proposed" && market.proposal && (
                  <div className="space-y-3">
                    <div className="rounded-lg bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">
                      <div className="flex justify-between"><span>Proposed</span><span className="text-foreground">{market.proposal.proposedOutcome}</span></div>
                      <div className="flex justify-between"><span>Window closes</span><span>{fmtCountdown(market.proposal.proposedAt + market.policy.challengeSecs, nowSecs)}</span></div>
                      {market.proposal.challenger && (
                        <div className="flex justify-between text-oracle-no"><span>Challenged with</span><span>{market.proposal.challengerOutcome}</span></div>
                      )}
                    </div>
                    {!market.proposal.challenger && nowSecs <= market.proposal.proposedAt + market.policy.challengeSecs && (
                      <button
                        onClick={() => handleChallenge(market.proposal!.proposedOutcome === "Yes" ? "No" : "Yes")}
                        disabled={busy !== null || !account}
                        className="w-full rounded-lg border border-oracle-no/30 py-2 text-sm font-semibold text-oracle-no hover:bg-oracle-no/10 disabled:opacity-50"
                      >
                        Challenge with {market.proposal.proposedOutcome === "Yes" ? "No" : "Yes"} (+bond)
                      </button>
                    )}
                    {!market.proposal.challenger && nowSecs > market.proposal.proposedAt + market.policy.challengeSecs && (
                      <button
                        onClick={handleFinalize}
                        disabled={busy !== null || !account}
                        className="w-full rounded-lg bg-primary py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                      >
                        {busy === "finalize" ? "Finalizing…" : "Finalize proposal"}
                      </button>
                    )}
                    {market.proposal.challenger && (
                      <p className="text-center text-xs text-muted-foreground">
                        Awaiting objective escalation (reporter quorum / signed source).
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Admin resolution console */}
            {isAdmin && (
              <div className="trade-panel border-oracle-no/20">
                <div className="mb-4 text-center">
                  <h2 className="text-sm font-bold text-foreground">Operator Resolution</h2>
                  <p className="mt-1 text-xs text-muted-foreground">Admin only — irreversible.</p>
                </div>

                {market.policy.operatorResolution && phase === "expired" && (
                  <>
                    <div className="mb-3 flex flex-col gap-2">
                      {(["Yes", "No", "VoidOutcome"] as OutcomeArg[]).map((r) => (
                        <button
                          key={r}
                          onClick={() => setResolveOutcome(r)}
                          className={`rounded-lg py-2 text-sm font-semibold transition-all ${
                            resolveOutcome === r
                              ? r === "Yes"
                                ? "border-2 border-oracle-yes bg-oracle-yes/20 text-oracle-yes"
                                : r === "No"
                                  ? "border-2 border-oracle-no bg-oracle-no/20 text-oracle-no"
                                  : "border-2 border-border bg-secondary text-foreground"
                              : "border border-border text-muted-foreground hover:bg-secondary"
                          }`}
                        >
                          {r === "Yes" ? "Yes wins" : r === "No" ? "No wins" : "Void market"}
                        </button>
                      ))}
                    </div>
                    {market.policy.sources.length > 0 && (
                      <select
                        value={resolveSource || market.policy.sources[0]}
                        onChange={(e) => setResolveSource(e.target.value)}
                        className="input-field mb-3 text-sm"
                      >
                        {market.policy.sources.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    )}
                    <button
                      onClick={handleResolveT0}
                      className="mb-3 w-full rounded-lg bg-oracle-no/20 py-2.5 text-sm font-bold text-oracle-no ring-1 ring-oracle-no/30 hover:bg-oracle-no/30 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={busy !== null || !account}
                    >
                      {busy === "resolve" ? "Resolving…" : "Resolve (T0 operator)"}
                    </button>
                  </>
                )}

                {(market.policy.reporters.length > 0 || market.policy.sourceKeys.length > 0) && (
                  <div className="mb-3 rounded-lg bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">
                    <div className="mb-1 font-medium text-foreground">
                      Attestations ({attestations.length})
                      {market.policy.quorum > 0 && ` — need ${market.policy.quorum} agreeing`}
                    </div>
                    {attestations.slice(0, 5).map((a) => (
                      <div key={a.contractId} className="flex justify-between">
                        <span className="truncate pr-2">{a.attester.slice(0, 18)}…</span>
                        <span className={a.outcome === "Yes" ? "text-oracle-yes" : a.outcome === "No" ? "text-oracle-no" : ""}>
                          {a.outcome}{a.hasSourceSignature ? " ✓T1" : ""}
                        </span>
                      </div>
                    ))}
                    <button
                      onClick={handleResolveWithAttestations}
                      disabled={busy !== null || attestations.length === 0}
                      className="mt-2 w-full rounded border border-border py-1.5 font-semibold text-foreground hover:bg-secondary disabled:opacity-50"
                    >
                      Resolve from attestations (T1/T2)
                    </button>
                  </div>
                )}

                {nowSecs > market.expiresAt + market.gracePeriodSecs && (
                  <button
                    onClick={handleVoidMarket}
                    disabled={busy !== null}
                    className="w-full rounded-lg border border-border py-2 text-sm font-semibold text-muted-foreground hover:bg-secondary disabled:opacity-50"
                  >
                    {busy === "void" ? "Voiding…" : "Void market (grace elapsed)"}
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="w-full space-y-4 lg:w-80 lg:shrink-0">{yourPositionBox}</div>
        </div>
      )}

      {/* ================= SETTLE TAB ================= */}
      {mainTab === "settle" && showSettleTab && (
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
                    disabled={busy !== null || redeemable <= 0 || !account}
                    className="w-full rounded-lg bg-primary py-3 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-secondary disabled:text-muted-foreground"
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
                  disabled={busy !== null || !account}
                  className="w-full rounded-lg border border-oracle-blue/30 bg-oracle-blue/10 py-3 text-sm font-bold text-oracle-blue hover:bg-oracle-blue/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy === "withdraw" ? "Withdrawing…" : "Withdraw all liquidity"}
                </button>
              </div>
            )}
          </div>
          <div className="w-full space-y-4 lg:w-80 lg:shrink-0">
            {yourPositionBox}
            {lpPosition && lpPosition.lpTokens > 0 && yourLpBox}
          </div>
        </div>
      )}

      {/* About pm-AMM */}
      <div className="rounded-xl border border-border bg-card/50 p-5">
        <h2 className="mb-2 text-sm font-semibold text-foreground">About pm-AMM pricing</h2>
        <p className="text-sm text-muted-foreground">
          This market runs Paradigm's prediction-market AMM: the YES price is the normal CDF
          Φ((y−x)/L) of the pool's reserve imbalance, so quotes are calibrated probabilities that
          always stay between 0 and 1. {market.isDynamic && "Liquidity decays as L·√(T−t) toward expiry, holding LP loss-versus-rebalancing uniform over the market's life."}
        </p>
      </div>

      <AlertDialog
        isOpen={stepTwoDialog.isOpen}
        leastDestructiveRef={stepTwoCancelRef}
        onClose={cancelStepTwo}
        closeOnOverlayClick={false}
      >
        <AlertDialogOverlay>
          <AlertDialogContent bg="#141419" color="white" borderColor="hsl(240 4% 16%)" borderWidth="1px" borderRadius="xl">
            <AlertDialogHeader fontSize="lg" fontWeight="bold" color="hsl(235 89% 64%)">
              Step 2 of 2 — Confirm on-ledger
            </AlertDialogHeader>
            <AlertDialogBody>
              {pendingStepTwo?.description ?? ""}
              <Text fontSize="xs" color="gray.400" mt={3}>
                Your browser blocks back-to-back wallet popups. Click Confirm to open the second popup — only this click counts as a fresh user gesture.
              </Text>
            </AlertDialogBody>
            <AlertDialogFooter>
              <Button
                ref={stepTwoCancelRef}
                onClick={cancelStepTwo}
                variant="outline"
                borderColor="red.400"
                color="red.200"
                _hover={{ bg: "red.900", color: "white" }}
              >
                Cancel (CC stays with admin)
              </Button>
              <Button colorScheme="green" onClick={confirmStepTwo} ml={3}>
                Confirm
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>
    </div>
  );
};

export default MarketView;
