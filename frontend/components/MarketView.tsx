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
import React, { useState, useEffect, useCallback } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useCantonWallet } from "@/wallets";
import { useIsAdmin } from "@/lib/useIsAdmin";
import {
  buildBuyParams,
  buildSellParams,
  buildSplitParams,
  buildMergeParams,
  buildRecordResultParams,
  templateId,
  type DisclosedContractArg,
} from "@/utils/cantonCommands";
import {
  fetchAllPredictionMarkets,
  fetchAllResolvedMarkets,
  fetchUserMarketDataContractId,
  fetchUserMarketDataPosition,
  fetchPendingPayouts,
  type PredictionMarketRecord,
  type ResolvedMarketRecord,
  type UserMarketPosition,
  type PendingPayoutRecord,
} from "@/utils/activeContracts";
import { getCantonCoinHoldings, type AmuletHoldings } from "@/view-functions/getAccountBalance";
import { runAdminAutoPayout } from "@/lib/adminAutoPayout";
import {
  enterpriseWalletPartyId,
  submitAdminTransaction,
} from "@/lib/enterpriseWalletSubmit";
import { getCurrentPrice } from "@/lib/marketPricing";

type MarketViewModel = {
  marketId: number;
  question: string;
  description: string;
  resolutionDescription: string;
  imageUrl: string;
  yesShares: number;
  noShares: number;
  liquidityParam: number;
  status: 0 | 1;
  result?: "Yes" | "No" | "Draw" | string;
};

function toView(active?: PredictionMarketRecord, resolved?: ResolvedMarketRecord): MarketViewModel | null {
  if (active) {
    return {
      marketId: active.marketId,
      question: active.question,
      description: active.description,
      resolutionDescription: active.resolutionDescription,
      imageUrl: active.imageUrl,
      yesShares: active.yesShares,
      noShares: active.noShares,
      liquidityParam: active.liquidityParam,
      status: 0,
    };
  }
  if (resolved) {
    return {
      marketId: resolved.marketId,
      question: resolved.question,
      description: "",
      resolutionDescription: "",
      imageUrl: "",
      yesShares: 0,
      noShares: 0,
      liquidityParam: 1,
      status: 1,
      result: resolved.result,
    };
  }
  return null;
}

async function waitForPositionUpdate(
  partyId: string,
  marketId: number,
  expectedYes: number,
  expectedNo: number,
  timeoutMs = 30_000,
  intervalMs = 1500,
): Promise<UserMarketPosition | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pos = await fetchUserMarketDataPosition(partyId, marketId);
    if (pos && pos.yesShares >= expectedYes && pos.noShares >= expectedNo) {
      return pos;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}

/**
 * After Sell / Merge creates a PendingPayout, poll until we see it for this user
 * + market. Returns the new payout cid if found, null on timeout (caller should
 * leave it queued for manual admin processing).
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

const MarketView = () => {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const preferResolved = searchParams.get("status") === "resolved";
  const marketIdNum = id != null && id !== "" ? Number(id) : NaN;

  const [view, setView] = useState<MarketViewModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState<number>(0);
  const [selectedSide, setSelectedSide] = useState<"yes" | "no" | null>(null);
  const [tradeSide, setTradeSide] = useState<"buy" | "sell">("buy");
  const [predictionMarketCid, setPredictionMarketCid] = useState<string | null>(null);
  const [predictionMarketDisclosure, setPredictionMarketDisclosure] = useState<{
    createdEventBlob: string;
    synchronizerId?: string;
  } | null>(null);
  const [userMarketDataCid, setUserMarketDataCid] = useState<string | null>(null);
  const [userPosition, setUserPosition] = useState<UserMarketPosition | null>(null);
  const [holdings, setHoldings] = useState<AmuletHoldings | null>(null);
  const [splitMergeAmount, setSplitMergeAmount] = useState<number>(0);
  const [resolveResult, setResolveResult] = useState<"Yes" | "No" | "Draw">("Yes");
  const [payoutPerShare, setPayoutPerShare] = useState<number>(0);
  const [resolving, setResolving] = useState(false);
  const [submittingBet, setSubmittingBet] = useState(false);
  const [splittingMerging, setSplittingMerging] = useState(false);
  const { account, signAndSubmitTransaction, transferCC } = useCantonWallet();
  const adminPartyForCC = enterpriseWalletPartyId();

  // Step-2 confirm dialog: after the CC transfer (popup #1) succeeds, we can't
  // chain a second popup automatically — browsers block sequential window.open
  // calls without a fresh user gesture. So we open this dialog instead, and the
  // user explicitly clicks "Confirm Shares" which provides the gesture for popup #2.
  const stepTwoDialog = useDisclosure();
  const stepTwoCancelRef = React.useRef<HTMLButtonElement>(null);
  const [pendingStepTwo, setPendingStepTwo] = useState<{
    kind: "buy" | "split";
    description: string;
    run: () => Promise<void>;
  } | null>(null);

  const openStepTwo = (kind: "buy" | "split", description: string, run: () => Promise<void>) => {
    setPendingStepTwo({ kind, description, run });
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
      title: "Step 2 canceled — shares not recorded",
      description: "Your CC transfer is final; the share-record step was skipped. Contact admin for a refund.",
      status: "warning",
      duration: 10000,
      isClosable: true,
    });
  };
  const isAdmin = useIsAdmin();
  const toast = useToast();

  const refreshMarket = useCallback(
    async (opts?: { silent?: boolean }): Promise<PredictionMarketRecord | null> => {
      if (isNaN(marketIdNum)) return null;
      if (!opts?.silent) setLoading(true);
      try {
        const [actives, resolved] = await Promise.all([
          fetchAllPredictionMarkets(),
          fetchAllResolvedMarkets(),
        ]);
        const active = actives.find((m) => m.marketId === marketIdNum);
        const done = resolved.find((m) => m.marketId === marketIdNum);
        const useResolved = preferResolved && done;
        setView(useResolved ? toView(undefined, done) : toView(active, done));
        setPredictionMarketCid(useResolved ? null : active?.contractId ?? null);
        setPredictionMarketDisclosure(
          useResolved || !active?.createdEventBlob
            ? null
            : { createdEventBlob: active.createdEventBlob, synchronizerId: active.synchronizerId },
        );
        return useResolved ? null : active ?? null;
      } finally {
        if (!opts?.silent) setLoading(false);
      }
    },
    [marketIdNum, preferResolved]
  );

  useEffect(() => {
    refreshMarket();
  }, [refreshMarket]);

  useEffect(() => {
    const side = searchParams.get("side");
    if (side === "yes" || side === "no") {
      setSelectedSide(side);
    }
  }, [searchParams]);

  const refreshUserData = useCallback(async () => {
    if (!account?.address || isNaN(marketIdNum)) {
      setUserMarketDataCid(null);
      setUserPosition(null);
      setHoldings(null);
      return;
    }
    const [posCid, pos, h] = await Promise.all([
      fetchUserMarketDataContractId(account.address, marketIdNum),
      fetchUserMarketDataPosition(account.address, marketIdNum),
      getCantonCoinHoldings(),
    ]);
    setUserMarketDataCid(posCid);
    setUserPosition(pos);
    setHoldings(h);
  }, [account?.address, marketIdNum]);

  useEffect(() => {
    refreshUserData();
  }, [refreshUserData]);

  const currentPrice = view ? getCurrentPrice(view.yesShares, view.noShares, view.liquidityParam) : null;

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value);
    if (!isNaN(value) && value >= 0) {
      setAmount(Math.round(value * 100) / 100);
    }
  };

  const incrementAmount = () => setAmount((prev) => Math.round((prev + 1) * 100) / 100);
  const decrementAmount = () => setAmount((prev) => Math.max(Math.round((prev - 1) * 100) / 100, 0));

  const disclosedForMarket = (): DisclosedContractArg[] =>
    predictionMarketCid && predictionMarketDisclosure?.createdEventBlob
      ? [
          {
            templateId: templateId("Truthoracle", "PredictionMarket"),
            contractId: predictionMarketCid,
            createdEventBlob: predictionMarketDisclosure.createdEventBlob,
            synchronizerId: predictionMarketDisclosure.synchronizerId,
          },
        ]
      : [];

  /**
   * Exercise the Buy/Sell choice and poll for the resulting position. Used by:
   *   - Buy step-2 (after CC transfer + Confirm Shares dialog) — popup #2 here
   *     IS the share-record popup, allowed because it's inside the dialog's
   *     onClick (fresh user gesture).
   *   - Sell — single popup, called directly from handleTradeClick.
   */
  const runChoiceExerciseAndPoll = async (opts: {
    kind: "buy" | "sell";
    sideInt: number;
    selectedSideLabel: "yes" | "no";
    numShares: number;
    costCC: number;
    expectedYes: number;
    expectedNo: number;
    beforePayoutCids: Set<string>;
  }) => {
    if (!account || !predictionMarketCid) return;
    setSubmittingBet(true);
    const submittingToastId = toast({
      title: opts.kind === "buy" ? "Recording position on-ledger…" : "Submitting sell…",
      description: opts.kind === "buy"
        ? "Approve the share-record transaction in the wallet popup."
        : "Approve the transaction in the wallet popup. Admin will payout shortly.",
      status: "info",
      duration: null,
      isClosable: false,
    });
    try {
      const disclosed = disclosedForMarket();
      const params = opts.kind === "buy"
        ? buildBuyParams(
            account.address,
            predictionMarketCid,
            opts.sideInt,
            opts.numShares,
            opts.costCC,
            userMarketDataCid,
            disclosed.length > 0 ? disclosed : undefined,
          )
        : buildSellParams(
            account.address,
            predictionMarketCid,
            opts.sideInt,
            opts.numShares,
            opts.costCC,
            userMarketDataCid!,
            disclosed.length > 0 ? disclosed : undefined,
          );

      let txId = "";
      try {
        const committed = await signAndSubmitTransaction(params);
        txId = committed.hash;
      } catch (e) {
        if (submittingToastId !== undefined) toast.close(submittingToastId);
        console.error(e);
        toast({
          title: opts.kind === "buy" ? "Share-record failed — CC was already sent" : "Sell failed",
          description: e instanceof Error ? e.message : "Wallet could not submit the transaction.",
          status: "error",
          duration: 7000,
          isClosable: true,
        });
        return;
      }

      if (submittingToastId !== undefined) {
        toast.update(submittingToastId, {
          title: "Confirming on-ledger…",
          description: "Waiting for the participant to reflect the trade.",
          status: "info",
        });
      }

      const verified = await waitForPositionUpdate(
        account.address,
        marketIdNum,
        Math.max(opts.expectedYes, 0),
        Math.max(opts.expectedNo, 0),
      );

      if (submittingToastId !== undefined) toast.close(submittingToastId);

      const w = window as unknown as { refreshPortfolio?: () => void; refreshMarketplace?: () => void };
      w.refreshPortfolio?.();
      w.refreshMarketplace?.();
      await refreshMarket();
      await refreshUserData();

      if (opts.kind === "sell") {
        try {
          const fresh = await waitForNewPendingPayout(account.address, marketIdNum, opts.beforePayoutCids);
          if (fresh) {
            toast({
              title: "Settling payout…",
              description: `Admin sending ${fresh.amountCC.toFixed(4)} CC to your wallet.`,
              status: "info",
              duration: 4000,
              isClosable: true,
            });
            await runAdminAutoPayout({
              toUser: account.address,
              amountCC: fresh.amountCC,
              pendingPayoutCid: fresh.contractId,
              reason: "sell",
              signAndSubmitTransaction,
            });
          }
        } catch (e) {
          console.warn("[sell auto-payout failed]", e);
          toast({
            title: "Sell recorded — payout pending",
            description: "Admin couldn't auto-settle the payout. It's queued; refresh shortly or admin can settle from the Payout Queue.",
            status: "warning",
            duration: 8000,
            isClosable: true,
          });
        }
      }

      if (verified) {
        toast({
          title: opts.kind === "buy" ? "Bet Placed" : "Shares Sold",
          description: `Position now ${verified.yesShares} Yes / ${verified.noShares} No (Δ ${opts.kind === "buy" ? "+" : "-"}${opts.numShares} on ${opts.selectedSideLabel === "yes" ? "Yes" : "No"}).`,
          status: "success",
          duration: 7000,
          isClosable: true,
        });
      } else {
        toast({
          title: "Trade submitted — confirmation pending",
          description: `Wallet accepted the transaction${txId ? ` (id ${txId})` : ""}, but the participant hasn't shown the new position yet. If this persists, the share-record step may have been rejected on-ledger — refresh in a moment or check the Portfolio.`,
          status: "warning",
          duration: 12000,
          isClosable: true,
        });
      }
    } finally {
      setSubmittingBet(false);
    }
  };

  const handleTradeClick = async () => {
    if (!view || view.status !== 0) return;
    if (!account) {
      toast({ title: "Connect a wallet to trade", status: "info", duration: 4000, isClosable: true });
      return;
    }
    if (!predictionMarketCid) {
      toast({
        title: "Market contract not found",
        description: "Could not locate the PredictionMarket contract.",
        status: "warning",
        duration: 5000,
        isClosable: true,
      });
      return;
    }
    if (!selectedSide) return;
    const sideInt = selectedSide === "yes" ? 1 : 2;
    const numShares = Math.max(0, Math.floor(amount));
    if (numShares <= 0) {
      toast({ title: "Enter shares to trade", status: "info", duration: 3000, isClosable: true });
      return;
    }
    // 1 pair = 1 CC, per-share price comes from current LMSR probability.
    // costCC = numShares * spotPrice (e.g. 10 shares * 0.3 = 3 CC).
    const spot = selectedSide === "yes" ? (currentPrice?.yes ?? 0.5) : (currentPrice?.no ?? 0.5);
    const costCC = Number((numShares * spot).toFixed(4));

    if (tradeSide === "buy" && holdings && holdings.balance < costCC) {
      toast({
        title: "Insufficient CC balance",
        description: `Need ${costCC.toFixed(2)} CC but wallet has ${holdings.balance.toFixed(2)} CC.`,
        status: "warning",
        duration: 5000,
        isClosable: true,
      });
      return;
    }
    if (tradeSide === "sell") {
      if (!userMarketDataCid || !userPosition) {
        toast({ title: "No position to sell", status: "warning", duration: 4000, isClosable: true });
        return;
      }
      const owned = selectedSide === "yes" ? userPosition.yesShares : userPosition.noShares;
      if (owned < numShares) {
        toast({
          title: "Not enough shares to sell",
          description: `You own ${owned} ${selectedSide === "yes" ? "Yes" : "No"} shares.`,
          status: "warning",
          duration: 4000,
          isClosable: true,
        });
        return;
      }
    }

    const expectedYes = (userPosition?.yesShares ?? 0) +
      (tradeSide === "buy" && selectedSide === "yes" ? numShares : 0) -
      (tradeSide === "sell" && selectedSide === "yes" ? numShares : 0);
    const expectedNo = (userPosition?.noShares ?? 0) +
      (tradeSide === "buy" && selectedSide === "no" ? numShares : 0) -
      (tradeSide === "sell" && selectedSide === "no" ? numShares : 0);

    // Snapshot existing PendingPayout cids so we can detect the new one a Sell creates.
    const beforePayoutCids = new Set(
      tradeSide === "sell"
        ? (await fetchPendingPayouts(account.address)).filter((p) => p.user === account.address).map((p) => p.contractId)
        : [],
    );

    setSubmittingBet(true);
    const submittingToastId = toast({
      title: tradeSide === "buy" ? "Sending CC to market…" : "Submitting sell…",
      description: tradeSide === "buy"
        ? `Confirm the ${costCC.toFixed(4)} CC transfer in the wallet popup.`
        : "Confirm the transaction in the wallet popup. Admin will payout shortly.",
      status: "info",
      duration: null,
      isClosable: false,
    });

    try {
      // Step 1 (Buy only): transfer CC to the market admin. If this fails, abort
      // before exercising Buy so the contract state doesn't drift from CC flows.
      if (tradeSide === "buy") {
        if (!adminPartyForCC) {
          throw new Error("VITE_ENTERPRISE_WALLET_PARTY_ID is not set — can't address the market admin to transfer CC to.");
        }
        try {
          const transferResult = await transferCC({
            to: adminPartyForCC,
            amount: costCC,
            memo: `truthoracle: buy ${numShares} ${selectedSide.toUpperCase()} on market #${marketIdNum}`,
            metadata: {
              kind: "truthoracle_buy",
              market_id: String(marketIdNum),
              side: selectedSide,
              shares: String(numShares),
            },
          });
          console.log("[CC transfer for Buy]", transferResult);
        } catch (e) {
          if (submittingToastId !== undefined) toast.close(submittingToastId);
          toast({
            title: "CC transfer failed — buy aborted",
            description: e instanceof Error ? e.message : String(e),
            status: "error",
            duration: 6000,
            isClosable: true,
          });
          return;
        }
        if (submittingToastId !== undefined) toast.close(submittingToastId);
        setSubmittingBet(false);
        // Open step-2 dialog. Browsers block the second window.open unless it
        // happens inside a fresh user gesture — the dialog's "Confirm Shares"
        // click provides exactly that.
        openStepTwo(
          "buy",
          `${costCC.toFixed(4)} CC sent to the market. Click Confirm to mint ${numShares} ${selectedSide.toUpperCase()} shares on-ledger.`,
          async () => {
            await runChoiceExerciseAndPoll({
              kind: "buy",
              sideInt,
              selectedSideLabel: selectedSide,
              numShares,
              costCC,
              expectedYes,
              expectedNo,
              beforePayoutCids: new Set(),
            });
          },
        );
        return;
      }

      if (submittingToastId !== undefined) toast.close(submittingToastId);
      setSubmittingBet(false);
      await runChoiceExerciseAndPoll({
        kind: "sell",
        sideInt,
        selectedSideLabel: selectedSide,
        numShares,
        costCC,
        expectedYes,
        expectedNo,
        beforePayoutCids,
      });
    } finally {
      setSubmittingBet(false);
    }
  };

  const handleSplitMerge = async (action: "split" | "merge") => {
    if (!view || view.status !== 0) return;
    if (!account || !predictionMarketCid) {
      toast({ title: "Connect wallet first", status: "info", duration: 4000, isClosable: true });
      return;
    }
    const amt = Math.max(0, Math.floor(splitMergeAmount));
    if (amt <= 0) {
      toast({ title: "Enter an amount", status: "info", duration: 3000, isClosable: true });
      return;
    }
    if (action === "split" && holdings && holdings.balance < amt) {
      toast({
        title: "Insufficient CC balance",
        description: `Need ${amt} CC to split into ${amt} Yes + ${amt} No pairs.`,
        status: "warning",
        duration: 5000,
        isClosable: true,
      });
      return;
    }
    if (action === "merge") {
      if (!userMarketDataCid || !userPosition) {
        toast({ title: "No position to merge", status: "warning", duration: 4000, isClosable: true });
        return;
      }
      if (userPosition.yesShares < amt || userPosition.noShares < amt) {
        toast({
          title: "Not enough Yes + No pairs",
          description: `You own ${userPosition.yesShares} Yes / ${userPosition.noShares} No.`,
          status: "warning",
          duration: 5000,
          isClosable: true,
        });
        return;
      }
    }

    // Snapshot pending payouts so we can detect what Merge creates.
    const beforePayoutCids = new Set(
      action === "merge"
        ? (await fetchPendingPayouts(account.address)).filter((p) => p.user === account.address).map((p) => p.contractId)
        : [],
    );

    /** Step that exercises Split / Merge on-ledger and (for Merge) triggers admin auto-payout. */
    const runSplitMergeChoice = async () => {
      setSplittingMerging(true);
      try {
        const disclosed = disclosedForMarket();
        const params = action === "split"
          ? buildSplitParams(
              account.address,
              predictionMarketCid,
              amt,
              userMarketDataCid,
              disclosed.length > 0 ? disclosed : undefined,
            )
          : buildMergeParams(
              account.address,
              predictionMarketCid,
              amt,
              userMarketDataCid!,
              disclosed.length > 0 ? disclosed : undefined,
            );
        const committedTxn = await signAndSubmitTransaction(params);
        void committedTxn.hash;

        if (action === "merge") {
          try {
            const fresh = await waitForNewPendingPayout(account.address, marketIdNum, beforePayoutCids);
            if (fresh) {
              await runAdminAutoPayout({
                toUser: account.address,
                amountCC: fresh.amountCC,
                pendingPayoutCid: fresh.contractId,
                reason: "merge",
                signAndSubmitTransaction,
              });
            }
          } catch (e) {
            console.warn("[merge auto-payout failed]", e);
            toast({
              title: "Merge recorded — payout pending",
              description: "Admin couldn't auto-settle the payout. It's queued; refresh shortly.",
              status: "warning",
              duration: 8000,
              isClosable: true,
            });
          }
        }

        await refreshUserData();
        const w = window as unknown as { refreshPortfolio?: () => void };
        w.refreshPortfolio?.();
        toast({
          title: action === "split" ? "Split complete" : "Merge requested",
          description: action === "split"
            ? `Minted ${amt} Yes + ${amt} No shares for ${amt} CC.`
            : `Burned ${amt} pairs — pending payout for ${amt} CC from admin.`,
          status: "success",
          duration: 6000,
          isClosable: true,
        });
      } catch (e) {
        console.error(e);
        toast({
          title: `${action} failed`,
          description: e instanceof Error ? e.message : `Could not submit ${action}.`,
          status: "error",
          duration: 5000,
          isClosable: true,
        });
      } finally {
        setSplittingMerging(false);
      }
    };

    if (action === "merge") {
      // Single popup — no CC transfer needed; admin auto-pays after.
      await runSplitMergeChoice();
      return;
    }

    // Split: popup #1 = CC transfer, popup #2 (gated by dialog) = Split choice.
    setSplittingMerging(true);
    try {
      if (!adminPartyForCC) {
        throw new Error("VITE_ENTERPRISE_WALLET_PARTY_ID is not set.");
      }
      await transferCC({
        to: adminPartyForCC,
        amount: amt,
        memo: `truthoracle: split ${amt} pairs on market #${marketIdNum}`,
        metadata: {
          kind: "truthoracle_split",
          market_id: String(marketIdNum),
          pairs: String(amt),
        },
      });
    } catch (e) {
      console.error(e);
      toast({
        title: "Split CC transfer failed",
        description: e instanceof Error ? e.message : String(e),
        status: "error",
        duration: 6000,
        isClosable: true,
      });
      setSplittingMerging(false);
      return;
    }
    setSplittingMerging(false);
    openStepTwo(
      "split",
      `${amt} CC sent to the market. Click Confirm to mint ${amt} Yes + ${amt} No shares on-ledger.`,
      runSplitMergeChoice,
    );
  };

  const getResultText = () => {
    if (!view || view.status === 0) return null;
    if (view.result === "Yes") return "Winner: Yes";
    if (view.result === "No") return "Winner: No";
    if (view.result === "Draw") return "Draw";
    return "Market Resolved";
  };

  const handleResolveClick = async () => {
    if (!view || view.status !== 0) return;
    if (!account || !isAdmin) {
      toast({ title: "Admin wallet required", status: "warning", duration: 3000, isClosable: true });
      return;
    }
    if (!predictionMarketCid) {
      toast({
        title: "Market contract not found",
        description: "Could not locate the PredictionMarket contract for this market.",
        status: "warning",
        duration: 5000,
        isClosable: true,
      });
      return;
    }
    const payout = Math.max(0, Math.floor(payoutPerShare));
    setResolving(true);
    try {
      const adminParty = enterpriseWalletPartyId() || account.address;
      const params = buildRecordResultParams(adminParty, predictionMarketCid, resolveResult, payout);
      const committedTxn = await submitAdminTransaction(params, signAndSubmitTransaction);
      void committedTxn.hash;

      const w = window as unknown as { refreshPortfolio?: () => void; refreshMarketplace?: () => void };
      w.refreshMarketplace?.();
      w.refreshPortfolio?.();
      await refreshMarket();

      toast({
        title: "Market Resolved",
        description: `Recorded ${resolveResult} with payout ${payout}/share.`,
        status: "success",
        duration: 7000,
        isClosable: true,
      });
    } catch (e) {
      console.error(e);
      toast({
        title: "Resolve failed",
        description: e instanceof Error ? e.message : "Could not submit RecordResult.",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setResolving(false);
    }
  };

  if (loading && !view) {
    return (
      <div className="space-y-4 py-8">
        <Skeleton height="32px" borderRadius="lg" />
        <Skeleton height="20px" borderRadius="lg" />
        <Skeleton height="120px" borderRadius="xl" />
      </div>
    );
  }

  if (!view) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-2">
        <Text fontSize="lg" color="gray.400">Market #{id} not found.</Text>
      </div>
    );
  }

  return (
    <div className="flex min-h-[80vh] flex-col gap-8 lg:flex-row lg:gap-10">
      {/* Left: market info */}
      <div className="flex-1 space-y-6">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-secondary px-3 py-1 text-xs font-medium text-muted-foreground">
            Market #{view.marketId}
            {view.status === 0 ? (
              <span className="flex items-center gap-1 text-oracle-yes">
                <span className="h-1.5 w-1.5 rounded-full bg-oracle-yes animate-pulse" />
                Live
              </span>
            ) : (
              <span className="text-muted-foreground">Resolved</span>
            )}
          </div>
          <h1 className="text-2xl font-bold leading-tight text-foreground sm:text-3xl">
            {view.question}
          </h1>
        </div>

        {view.description && (
          <p className="text-base text-muted-foreground">{view.description}</p>
        )}
        {view.resolutionDescription && (
          <p className="rounded-lg border border-border bg-secondary/50 px-4 py-3 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Resolution criteria: </span>
            {view.resolutionDescription}
          </p>
        )}

        {/* Probability section */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Current Odds
          </h2>

          <div className="mb-4">
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-3xl font-bold text-oracle-yes">
                {((currentPrice?.yes ?? 0) * 100).toFixed(0)}%
              </span>
              <span className="text-sm text-muted-foreground">chance of Yes</span>
            </div>
            <div className="prob-bar mb-1">
              <div
                className="prob-bar-yes"
                style={{ width: `${(currentPrice?.yes ?? 0) * 100}%` }}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-lg bg-oracle-yes/10 px-4 py-3 ring-1 ring-oracle-yes/20">
              <div className="text-xs font-medium text-oracle-yes">Yes</div>
              <div className="text-2xl font-bold text-oracle-yes">
                {((currentPrice?.yes ?? 0) * 100).toFixed(0)}¢
              </div>
              <div className="text-xs text-muted-foreground">{view.yesShares} shares</div>
            </div>
            <div className="rounded-lg bg-oracle-no/10 px-4 py-3 ring-1 ring-oracle-no/20">
              <div className="text-xs font-medium text-oracle-no">No</div>
              <div className="text-2xl font-bold text-oracle-no">
                {((currentPrice?.no ?? 0) * 100).toFixed(0)}¢
              </div>
              <div className="text-xs text-muted-foreground">{view.noShares} shares</div>
            </div>
          </div>
        </div>

        {userPosition && view.status === 0 && (
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-5">
            <h3 className="mb-3 text-sm font-semibold text-foreground">Your Position</h3>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">Yes shares</div>
                <div className="font-semibold text-oracle-yes">{userPosition.yesShares}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">No shares</div>
                <div className="font-semibold text-oracle-no">{userPosition.noShares}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Invested</div>
                <div className="font-semibold text-foreground">
                  {userPosition.amountInvestedCC.toFixed(2)} CC
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="rounded-xl border border-border bg-card/50 p-5">
          <h2 className="mb-2 text-sm font-semibold text-foreground">
            About LMSR Pricing
          </h2>
          <p className="text-sm text-muted-foreground">
            The Logarithmic Market Scoring Rule (LMSR) is a mathematical tool used to evaluate
            the accuracy of predictions. It encourages honesty and precision when making
            predictions about uncertain events.
          </p>
        </div>
      </div>

      {/* Right: trade panel */}
      {view.status === 0 ? (
        <div className="w-full space-y-4 lg:w-80 lg:shrink-0">
          <div className="trade-panel">
            <div className="mb-4 text-center">
              <h2 className="text-base font-bold text-foreground">
                {tradeSide === "buy" ? "Place a Bet" : "Sell Position"}
              </h2>
              {holdings && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Balance:{" "}
                  <span className="font-medium text-primary">{holdings.balance.toFixed(2)} CC</span>
                  <span className="text-muted-foreground/60">
                    {" "}(≈ ${holdings.balanceUsd.toFixed(2)})
                  </span>
                </p>
              )}
            </div>

            <div className="mb-4 flex overflow-hidden rounded-lg border border-border">
              <button
                onClick={() => setTradeSide("buy")}
                className={`flex-1 py-2 text-sm font-semibold transition-all ${
                  tradeSide === "buy"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-secondary"
                }`}
              >
                Buy
              </button>
              <button
                onClick={() => setTradeSide("sell")}
                className={`flex-1 py-2 text-sm font-semibold transition-all ${
                  tradeSide === "sell"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-secondary"
                }`}
              >
                Sell
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
                Yes — {((currentPrice?.yes ?? 0) * 100).toFixed(0)}¢
              </button>
              <button
                onClick={() => setSelectedSide("no")}
                className={
                  selectedSide === "no"
                    ? "rounded-lg border-2 border-oracle-no bg-oracle-no/20 py-2.5 text-sm font-bold text-oracle-no ring-2 ring-oracle-no/30"
                    : "rounded-lg border border-oracle-no/30 py-2.5 text-sm font-semibold text-oracle-no hover:bg-oracle-no/10"
                }
              >
                No — {((currentPrice?.no ?? 0) * 100).toFixed(0)}¢
              </button>
            </div>

            <div className="mb-4">
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Shares
              </label>
              <div className="flex overflow-hidden rounded-lg border border-border">
                <button
                  onClick={decrementAmount}
                  className="bg-secondary px-4 py-2.5 text-foreground hover:bg-secondary/80"
                >
                  −
                </button>
                <input
                  type="number"
                  value={amount.toFixed(2)}
                  onChange={handleInputChange}
                  className="flex-1 bg-background py-2.5 text-center text-foreground focus:outline-none"
                />
                <button
                  onClick={incrementAmount}
                  className="bg-secondary px-4 py-2.5 text-foreground hover:bg-secondary/80"
                >
                  +
                </button>
              </div>
            </div>

            {(() => {
              const tradeDisabledReason = !account
                ? "Connect wallet"
                : !predictionMarketCid
                  ? "Loading market…"
                  : submittingBet
                    ? "Submitting…"
                    : !selectedSide
                      ? "Select Yes or No"
                      : amount <= 0
                        ? "Enter shares to trade"
                        : null;
              const isDisabled = tradeDisabledReason !== null;
              return (
                <button
                  onClick={handleTradeClick}
                  disabled={isDisabled}
                  className={`w-full rounded-lg py-3 text-sm font-bold transition-all ${
                    isDisabled
                      ? "cursor-not-allowed bg-secondary text-muted-foreground"
                      : "bg-primary text-primary-foreground hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/20"
                  }`}
                >
                  {tradeDisabledReason ?? (tradeSide === "buy" ? "Place Bet" : "Sell Shares")}
                </button>
              );
            })()}
            <p className="mt-2 text-center text-xs text-muted-foreground">
              Price may vary due to slippage.
            </p>
          </div>

          <div className="trade-panel">
            <div className="mb-3 text-center">
              <h2 className="text-sm font-bold text-foreground">Split / Merge</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Split: 1 CC → 1 Yes + 1 No. Merge: reverse.
              </p>
            </div>
            <input
              type="number"
              min={1}
              value={splitMergeAmount}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                setSplitMergeAmount(isNaN(v) || v < 0 ? 0 : v);
              }}
              placeholder="Pairs"
              className="input-field mb-3 text-center"
            />
            <div className="flex gap-2">
              <button
                onClick={() => handleSplitMerge("split")}
                className="flex-1 rounded-lg border border-border bg-secondary py-2 text-sm font-semibold text-foreground hover:bg-secondary/80 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={splittingMerging || !predictionMarketCid || splitMergeAmount <= 0}
              >
                {splittingMerging ? "…" : "Split"}
              </button>
              <button
                onClick={() => handleSplitMerge("merge")}
                className="flex-1 rounded-lg border border-border bg-secondary py-2 text-sm font-semibold text-foreground hover:bg-secondary/80 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={splittingMerging || !predictionMarketCid || splitMergeAmount <= 0 || !userPosition}
              >
                {splittingMerging ? "…" : "Merge"}
              </button>
            </div>
          </div>

          {isAdmin && (
            <div className="trade-panel border-oracle-no/20">
              <div className="mb-4 text-center">
                <h2 className="text-sm font-bold text-foreground">Resolve Market</h2>
                <p className="mt-1 text-xs text-muted-foreground">Admin only — irreversible.</p>
              </div>

              <div className="mb-4 flex flex-col gap-2">
                {(["Yes", "No", "Draw"] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => setResolveResult(r)}
                    className={`rounded-lg py-2 text-sm font-semibold transition-all ${
                      resolveResult === r
                        ? r === "Yes"
                          ? "border-2 border-oracle-yes bg-oracle-yes/20 text-oracle-yes"
                          : r === "No"
                            ? "border-2 border-oracle-no bg-oracle-no/20 text-oracle-no"
                            : "border-2 border-border bg-secondary text-foreground"
                        : "border border-border text-muted-foreground hover:bg-secondary"
                    }`}
                  >
                    {r === "Yes" ? "Yes wins" : r === "No" ? "No wins" : "Draw"}
                  </button>
                ))}
              </div>

              <div className="mb-3">
                <label className="mb-1 block text-xs text-muted-foreground">Payout per share</label>
                <input
                  type="number"
                  min={0}
                  value={payoutPerShare}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    setPayoutPerShare(isNaN(v) || v < 0 ? 0 : v);
                  }}
                  placeholder="0"
                  className="input-field text-center"
                />
              </div>

              <button
                onClick={handleResolveClick}
                className="w-full rounded-lg bg-oracle-no/20 py-2.5 text-sm font-bold text-oracle-no ring-1 ring-oracle-no/30 hover:bg-oracle-no/30 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={resolving || !predictionMarketCid || !account}
              >
                {resolving
                  ? "Resolving…"
                  : !account
                    ? "Connect wallet"
                    : !predictionMarketCid
                      ? "Loading market…"
                      : "Record Result"}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="w-full lg:w-80 lg:shrink-0">
          <div className="trade-panel text-center">
            <h2 className="mb-2 text-base font-bold text-foreground">Market Result</h2>
            <div className="text-2xl font-bold text-primary">{getResultText()}</div>
            <div className="mt-4 space-y-2 text-sm text-muted-foreground">
              <div className="flex justify-between">
                <span>Yes</span>
                <span>{view.yesShares} ({((currentPrice?.yes ?? 0) * 100).toFixed(1)}%)</span>
              </div>
              <div className="flex justify-between">
                <span>No</span>
                <span>{view.noShares} ({((currentPrice?.no ?? 0) * 100).toFixed(1)}%)</span>
              </div>
            </div>
          </div>
        </div>
      )}
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
                Confirm Shares
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>
    </div>
  );
};

export default MarketView;
