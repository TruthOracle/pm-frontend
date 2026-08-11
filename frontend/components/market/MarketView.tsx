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
} from "@/lib/marketPricing";
import { ammState, fmtCC, fmtCountdown, getMarketPhase } from "./marketHelpers";
import MarketTradePanel from "./MarketTradePanel";
import MarketLiquidityPanel from "./MarketLiquidityPanel";
import MarketResolutionPanel from "./MarketResolutionPanel";
import MarketSettlementPanel from "./MarketSettlementPanel";
import type { MainTab, TradeSubTab, LiquiditySubTab } from "./marketTypes";

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

  const subTabBtn = (active: boolean) =>
    `flex-1 py-2 text-sm font-semibold transition-all ${active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"}`;

  const tradeContext = {
    setMainTab, subTabBtn, tradeSubTab, setTradeSubTab, phase, market, nowSecs,
    tradeSide, setTradeSide, selectedSide, setSelectedSide, probYes, probNo,
    collateralIn, sharesIn, setCollateralIn, setSharesIn, slippage, setSlippage,
    buyQuote, sellQuote, swapQuote, account, busy, handleTradeClick, mintMode,
    setMintMode, splitMergeAmount, setSplitMergeAmount, handleSplitMerge,
    userPosition, holdings,
  };
  const liquidityContext = {
    setMainTab, subTabBtn, liquiditySubTab, setLiquiditySubTab, canProvideLiquidity,
    liquidityValue, setLiquidityValue, liquidityQuote, busy, handleProvideLiquidity,
    lpPosition, market, phase, withdrawPct, setWithdrawPct, handleWithdrawLiquidity, account,
  };
  const resolutionContext = {
    market, phase, nowSecs, busy, account, setResolveOutcome, resolveOutcome,
    handleResolveT0, attestations, handleResolveWithAttestations, resolveSource,
    setResolveSource, handlePropose, handleChallenge, handleFinalize, userPosition,
    holdings, probYes, probNo, isAdmin, handleVoidMarket,
  };
  const settlementContext = {
    phase, market, redeemable, busy, account, handleRedeem, lpPosition,
    withdrawPct, setWithdrawPct, handleWithdrawLiquidity, userPosition,
    holdings, probYes, probNo,
  };

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

      {/* ---------------- Secondary tabs ---------------- */}
      {tabs.some((t) => t.visible && t.key !== "trade" && t.key !== "liquidity") && (
        <div className="flex gap-1 rounded-full bg-secondary p-1">
          {tabs.filter((t) => t.visible && t.key !== "trade" && t.key !== "liquidity").map((t) => (
            <button
              key={t.key}
              onClick={() => setMainTab(t.key)}
              className={`tab-pill ${mainTab === t.key ? "tab-pill-active" : "tab-pill-inactive"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* ================= TRADE TAB ================= */}
      {mainTab === "trade" && (
        <MarketTradePanel context={tradeContext} />
      )}
      {mainTab === "liquidity" && (
        <MarketLiquidityPanel context={liquidityContext} />
      )}
      {/* ================= RESOLVE TAB ================= */}
      {mainTab === "resolve" && showResolveTab && (
        <MarketResolutionPanel context={resolutionContext} />
      )}

      {/* ================= SETTLE TAB ================= */}
      {mainTab === "settle" && showSettleTab && (
        <MarketSettlementPanel context={settlementContext} />
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
