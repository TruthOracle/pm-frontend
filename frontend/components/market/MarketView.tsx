import { useToast } from "@chakra-ui/react";
import { ChevronRight, Gavel } from "lucide-react";
import { useState, useEffect, useCallback, useMemo } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useCantonWallet } from "@/wallets";
import { useAccountWallet, useAuth } from "@/auth/AuthContext";
import { authErrorMessage } from "@/auth/wallet";
import { TRUTHORACLE_PACKAGE_ID, WALLET_DISPLAY_NAME } from "@/config";
import { backendErrorMessage } from "@/lib/backendErrors";
import { fetchMyMarketView, marketSource, prepareOrder, waitForTradeLanding } from "@/lib/marketsApi";
import { useMarketTrades } from "@/lib/marketQueries";
import { compactCC, formatCents, formatPercent, priceDelta } from "@/lib/chartData";
import PriceChart from "@/components/charts/PriceChart";
import TradeFeed from "@/components/TradeFeed";
import { YourLpBox, YourPositionBox } from "./MarketPositionCards";
import type { ApiPreparedOrder, PrepareOrderRequest } from "@/lib/marketsTypes";
import type { PrepareExecuteParams } from "@/lib/cantonDapp";
import { useExchangeStatus } from "@/components/ExchangeStatusBanner";
import { useIsAdmin } from "@/lib/useIsAdmin";
import { shortPartyId } from "@/lib/party";
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
  fetchUserPosition,
  fetchUserLpPosition,
  fetchUserWallet,
  fetchAttestations,
  type PredictionMarketRecord,
  type UserMarketPosition,
  type LiquidityPositionRecord,
  type UserWalletRecord,
  type OutcomeAttestationRecord,
} from "@/utils/activeContracts";
import { getCantonCoinHoldings, type AmuletHoldings } from "@/view-functions/getAccountBalance";
import InAppWalletCard from "@/components/InAppWalletCard";
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
import { getPrefetchedMarkets } from "@/utils/marketPrefetch";
import { debugError } from "@/lib/debugLog";

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

/** `/market/:id` takes a numeric market id or a ticker (truthoracle-backend docs/MARKETS.md §2). */
function matchesRef(m: PredictionMarketRecord, ref: string): boolean {
  if (/^\d+$/.test(ref)) return m.marketId === Number(ref);
  return (m.ticker ?? "").toUpperCase() === ref.toUpperCase();
}

export interface MarketViewProps {
  /** Id or ticker; defaults to the route's `:id`. The event page passes the selected market. */
  marketRef?: string;
  /** `dock` = the trade panel alone (event page's sticky column); `page` = the full market page. */
  variant?: "page" | "dock";
  /** Preselects Yes / No (the event page's price pills); the page variant reads `?side=` instead. */
  initialSide?: "yes" | "no" | null;
}

const MarketView = ({ marketRef: refProp, variant = "page", initialSide = null }: MarketViewProps = {}) => {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const marketRef = refProp ?? id ?? "";

  const [market, setMarket] = useState<PredictionMarketRecord | null>(() => {
    const prefetched = getPrefetchedMarkets();
    return prefetched?.find((item) => matchesRef(item, marketRef)) ?? null;
  });
  // True when the market came from the backend index: candles, the catalog and prepared
  // orders exist; the account's own contracts are read from the index too.
  const [indexed, setIndexed] = useState<boolean>(() => Boolean(getPrefetchedMarkets()?.find((item) => matchesRef(item, marketRef))?.ticker));
  const marketIdNum = market?.marketId ?? NaN;
  const [chartRefreshKey, setChartRefreshKey] = useState(0);
  const [loading, setLoading] = useState(() => market === null);
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
  const [wallet, setWallet] = useState<UserWalletRecord | null>(null);
  const [holdings, setHoldings] = useState<AmuletHoldings | null>(null);
  const [splitMergeAmount, setSplitMergeAmount] = useState<number>(0);
  const [mintMode, setMintMode] = useState<"mint" | "merge">("mint");
  const [liquidityValue, setLiquidityValue] = useState<number>(0);
  const [withdrawPct, setWithdrawPct] = useState<number>(100);
  const [resolveOutcome, setResolveOutcome] = useState<OutcomeArg>("Yes");
  const [resolveSource, setResolveSource] = useState<string>("");
  const [attestations, setAttestations] = useState<OutcomeAttestationRecord[]>([]);
  const [busy, setBusy] = useState<string | null>(null); // which action is running
  const { account, connect, signAndSubmitTransaction } = useCantonWallet();
  const { primaryPartyId: primaryParty, walletState, signInRequired } = useAccountWallet();
  const auth = useAuth();
  const { tradingActive } = useExchangeStatus();
  // Prepared orders: the index knows the active market version and the account's contracts.
  const usePrepared = indexed && auth.status === "authenticated";
  const adminPartyForCC = enterpriseWalletPartyId();
  const isAdmin = useIsAdmin();
  const toast = useToast();
  // Recent pool trades (index only); refetched with the page's 15 s cadence.
  const tradesQuery = useMarketTrades(indexed && market ? market.ticker || market.marketId : null, 30, variant === "page");

  // Account signed in with a linked, NON-primary wallet connected (ARCHITECTURE §16
  // state B): the in-app balance lives on the primary party's UserWallet, and every
  // market choice asserts the wallet's owner is the signer — so this wallet can look at
  // the account's balance and deposit into it, but not trade from it.
  const linkedNonPrimary = primaryParty !== null && walletState === "linked";
  const walletParty = linkedNonPrimary ? primaryParty : (account?.address ?? null);
  const tradeLockReason = linkedNonPrimary ? `Connect ${shortPartyId(primaryParty)} to trade` : null;

  // The trade CTA is the next step, not a dead button — and it never opens a wallet popup
  // for someone whose account state is unknown. The account comes first (a UserWallet
  // exists only for an account that deposited, ARCHITECTURE §18), then the wallet.
  // Ordered by what has to be true first; `disabled` states say why rather than inviting
  // a click that cannot work.
  const walletCta: { label: string; onClick?: () => void } | null =
    auth.status === "loading"
      ? { label: "Checking your account…" }
      : auth.status === "unavailable"
        ? { label: "Trading is disabled on this deployment" }
        : !tradingActive
          ? { label: "Trading is paused by the operator" }
        : signInRequired
          ? { label: "Sign in to trade", onClick: () => auth.openLogin() }
          : auth.status === "unreachable" && !auth.me
            ? { label: "Accounts service unreachable" }
            : account
              ? null
              : {
                  label: `Connect ${WALLET_DISPLAY_NAME} wallet`,
                  onClick: () =>
                    void connect().catch((e: unknown) =>
                      toast({ title: "Could not connect the wallet", description: authErrorMessage(e), status: "error", duration: 8000, isClosable: true }),
                    ),
                };
  const noWalletToast = () => {
    if (walletCta?.onClick) {
      walletCta.onClick();
      return;
    }
    toast({ title: walletCta?.label ?? `Connect ${WALLET_DISPLAY_NAME} wallet to trade`, status: "info", duration: 4000, isClosable: true });
  };
  // False until the first per-party read settles, so the wallet card does not show
  // "your first deposit …" for an account whose wallet is merely still loading.
  const [userDataLoaded, setUserDataLoaded] = useState(false);

  // Live clock for the dynamic-L countdown / phase transitions.
  useEffect(() => {
    const t = setInterval(() => setNowSecs(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const refreshMarket = useCallback(
    async (opts?: { silent?: boolean }): Promise<PredictionMarketRecord | null> => {
      if (!marketRef) return null;
      if (!opts?.silent) setLoading(true);
      try {
        const { market: m, source } = await marketSource.one(marketRef);
        setMarket(m);
        setIndexed(source === "index");
        return m;
      } finally {
        if (!opts?.silent) setLoading(false);
      }
    },
    [marketRef]
  );

  useEffect(() => {
    refreshMarket();
    const timer = window.setInterval(() => {
      refreshMarket({ silent: true }).catch(() => {});
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [refreshMarket]);

  useEffect(() => {
    const side = searchParams.get("side");
    if (side === "yes" || side === "no") setSelectedSide(side);
  }, [searchParams]);
  useEffect(() => {
    if (initialSide) setSelectedSide(initialSide);
  }, [initialSide, marketRef]);

  const refreshUserData = useCallback(async () => {
    if (!account?.address || isNaN(marketIdNum)) {
      setUserPosition(null);
      setLpPosition(null);
      setWallet(null);
      setHoldings(null);
      setUserDataLoaded(false);
      return;
    }
    setUserDataLoaded(false);
    // With the index and an account, the account's contracts come from the backend (read as the
    // treasury — the participant answers an external party's own reads with nothing on mainnet);
    // the ledger reads stay as the fallback and for anonymous wallets.
    const viaIndex = usePrepared ? await fetchMyMarketView(marketIdNum).catch(() => null) : null;
    const [pos, lp, w, h] = await Promise.all([
      viaIndex ? Promise.resolve(viaIndex.position) : fetchUserPosition(account.address, marketIdNum),
      viaIndex ? Promise.resolve(viaIndex.lpPosition) : fetchUserLpPosition(account.address, marketIdNum),
      viaIndex ? Promise.resolve(viaIndex.wallet) : fetchUserWallet(walletParty ?? account.address),
      getCantonCoinHoldings(),
    ]);
    setUserPosition(pos);
    setLpPosition(lp);
    setWallet(w);
    setHoldings(h);
    setUserDataLoaded(true);
  }, [account?.address, walletParty, marketIdNum, usePrepared]);

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
    setChartRefreshKey((k) => k + 1);
  };

  /**
   * Submit a market choice. With the index and a signed-in account the command comes from
   * `POST /markets/:market/orders/prepare` (docs/MARKETS.md §7): the backend assembles the exact
   * ExerciseCommand with the active market version, its disclosed blob and the account's
   * UserWallet / Position contract ids, pre-checks every rule the Daml choice asserts, and the
   * wallet signs it as-is; the page then waits for the index to reflect the trade. Otherwise the
   * legacy builder assembles the command from what this tab read itself.
   */
  const runPrepared = async (
    label: string,
    request: PrepareOrderRequest,
    legacy: () => ReturnType<typeof buildBuyParams> | null,
  ): Promise<boolean> => {
    if (usePrepared && market) {
      let prepared: ApiPreparedOrder;
      try {
        prepared = await prepareOrder(market.marketId, request);
      } catch (e) {
        debugError("Order preparation refused", e);
        toast({ title: `${label} not possible`, description: backendErrorMessage(e), status: "warning", duration: 7000, isClosable: true });
        return false;
      }
      const params: PrepareExecuteParams = {
        actAs: [prepared.actAs],
        commands: [prepared.command],
        disclosedContracts: prepared.disclosedContracts.map((d) => ({
          templateId: d.templateId,
          contractId: d.contractId,
          createdEventBlob: d.createdEventBlob,
          ...(d.synchronizerId ? { synchronizerId: d.synchronizerId } : {}),
        })),
        packageIdSelectionPreference: [TRUTHORACLE_PACKAGE_ID],
      };
      const ok = await runUserChoice(label, params);
      if (ok) await waitForTradeLanding(prepared);
      return ok;
    }
    const params = legacy();
    if (!params) return false;
    return runUserChoice(label, params);
  };
  const slippageBps = Math.round(slippage * 10_000);

  /** Exercise a choice via the user's wallet, standard error toasts. */
  const runUserChoice = async (label: string, params: ReturnType<typeof buildBuyParams>): Promise<boolean> => {
    try {
      await signAndSubmitTransaction(params);
      return true;
    } catch (e) {
      debugError("Market action failed", e);
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

  /** Guard: every money choice spends from / pays into the in-app wallet. */
  const requireWallet = (needCC?: number): UserWalletRecord | null => {
    if (tradeLockReason) {
      toast({
        title: tradeLockReason,
        description: "This wallet is linked to your account, but your in-app balance belongs to your primary wallet.",
        status: "info",
        duration: 6000,
        isClosable: true,
      });
      return null;
    }
    if (!wallet) {
      toast({
        title: "Deposit to your in-app wallet first",
        description: "One deposit funds every trade — use the In-app balance card above.",
        status: "info",
        duration: 6000,
        isClosable: true,
      });
      return null;
    }
    if (needCC != null && wallet.balanceCC < needCC) {
      toast({
        title: "Insufficient in-app balance",
        description: `Need ${fmtCC(needCC)} CC but the in-app balance is ${fmtCC(wallet.balanceCC)} CC. Top up via Deposit.`,
        status: "warning",
        duration: 6000,
        isClosable: true,
      });
      return null;
    }
    return wallet;
  };

  // -------------------------------------------------------------------------
  // Trade (single wallet signature per action — the market choice debits or
  // credits the in-app UserWallet atomically)
  // -------------------------------------------------------------------------

  const handleTradeClick = async () => {
    if (!market || phase !== "trading") return;
    // walletCta is non-null for every state that cannot trade yet (probe in flight,
    // anonymous, no wallet connected, no accounts backend) — including an anonymous
    // visitor whose wallet the SDK restored from a previous session.
    if (walletCta) {
      noWalletToast();
      return;
    }
    if (!account) return;
    if (!selectedSide) return;
    const sideArg: OutcomeArg = selectedSide === "yes" ? "Yes" : "No";

    if (tradeSide === "buy") {
      if (!buyQuote || collateralIn <= 0) {
        toast({ title: "Enter CC amount to spend", status: "info", duration: 3000, isClosable: true });
        return;
      }
      const spendWallet = usePrepared ? null : requireWallet(collateralIn);
      if (!usePrepared && !spendWallet) return;
      const minSharesOut = buyQuote.sharesOut * (1 - slippage);
      const prevSideShares = selectedSide === "yes" ? (userPosition?.yesShares ?? 0) : (userPosition?.noShares ?? 0);
      setBusy("trade");
      try {
        const ok = await runPrepared(
          "Buy",
          { action: "buy", side: sideArg === "Yes" ? "Yes" : "No", amountCC: collateralIn.toFixed(10), slippageBps },
          () =>
            buildBuyParams(
              account.address,
              market.contractId,
              sideArg,
              collateralIn,
              minSharesOut,
              userPosition?.contractId ?? null,
              spendWallet!.contractId,
              disclosedForMarket().length > 0 ? disclosedForMarket() : undefined,
            ),
        );
        if (!ok) return;
        const verified = usePrepared
          ? await fetchMyMarketView(marketIdNum).then((v) => v.position).catch(() => null)
          : await waitForPositionUpdate(
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
      return;
    }

    // Convert (direct YES<->NO share swap — single popup, no CC involved)
    if (tradeSide === "convert") {
      if (!swapQuote || sharesIn <= 0) {
        toast({ title: "Enter shares to convert", status: "info", duration: 3000, isClosable: true });
        return;
      }
      if (!usePrepared && !userPosition) {
        toast({ title: "No position to convert", status: "warning", duration: 4000, isClosable: true });
        return;
      }
      const ownedFrom = selectedSide === "yes" ? (userPosition?.yesShares ?? 0) : (userPosition?.noShares ?? 0);
      if (!usePrepared && ownedFrom < sharesIn) {
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
        const ok = await runPrepared(
          "Convert",
          { action: "swap", side: sideArg === "Yes" ? "Yes" : "No", shares: sharesIn.toFixed(10), slippageBps },
          () =>
            userPosition
              ? buildSwapSharesParams(
                  account.address,
                  market.contractId,
                  sideArg,
                  sharesIn,
                  minOut,
                  userPosition.contractId,
                  disclosedForMarket().length > 0 ? disclosedForMarket() : undefined,
                )
              : null,
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
    if (!usePrepared && !userPosition) {
      toast({ title: "No position to sell", status: "warning", duration: 4000, isClosable: true });
      return;
    }
    const owned = selectedSide === "yes" ? (userPosition?.yesShares ?? 0) : (userPosition?.noShares ?? 0);
    if (!usePrepared && owned < sharesIn) {
      toast({
        title: "Not enough shares to sell",
        description: `You own ${fmtCC(owned, 2)} ${sideArg} shares.`,
        status: "warning",
        duration: 4000,
        isClosable: true,
      });
      return;
    }
    const proceedsWallet = usePrepared ? null : requireWallet();
    if (!usePrepared && !proceedsWallet) return;
    const minProceeds = sellQuote.netProceeds * (1 - slippage);
    setBusy("trade");
    try {
      const ok = await runPrepared(
        "Sell",
        { action: "sell", side: sideArg === "Yes" ? "Yes" : "No", shares: sharesIn.toFixed(10), slippageBps },
        () =>
          userPosition && proceedsWallet
            ? buildSellParams(
                account.address,
                market.contractId,
                sideArg,
                sharesIn,
                minProceeds,
                userPosition.contractId,
                proceedsWallet.contractId,
                disclosedForMarket().length > 0 ? disclosedForMarket() : undefined,
              )
            : null,
      );
      if (!ok) return;
      await refreshAllViews();
      toast({
        title: "Shares sold",
        description: `Sold ${fmtCC(sharesIn, 2)} ${sideArg} for ~${fmtCC(sellQuote.netProceeds)} CC (after ${(market.feeBps / 100).toFixed(2)}% fee) — credited to your in-app balance.`,
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
    // walletCta is non-null for every state that cannot trade yet (probe in flight,
    // anonymous, no wallet connected, no accounts backend) — including an anonymous
    // visitor whose wallet the SDK restored from a previous session.
    if (walletCta) {
      noWalletToast();
      return;
    }
    if (!account) return;
    const amt = splitMergeAmount;
    if (amt <= 0) {
      toast({ title: "Enter an amount", status: "info", duration: 3000, isClosable: true });
      return;
    }
    if (action === "merge" && !usePrepared) {
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
    const setWallet = usePrepared ? null : requireWallet(action === "split" ? amt : undefined);
    if (!usePrepared && !setWallet) return;

    setBusy("splitmerge");
    try {
      const disclosed = disclosedForMarket();
      const ok = await runPrepared(action === "split" ? "Mint set" : "Merge", { action, amountCC: amt.toFixed(10) }, () =>
        !setWallet
          ? null
          : action === "split"
            ? buildSplitParams(account.address, market.contractId, amt, userPosition?.contractId ?? null, setWallet.contractId, disclosed.length > 0 ? disclosed : undefined)
            : userPosition
              ? buildMergeParams(account.address, market.contractId, amt, userPosition.contractId, setWallet.contractId, disclosed.length > 0 ? disclosed : undefined)
              : null,
      );
      if (!ok) return;
      await refreshAllViews();
      toast({
        title: action === "split" ? "Complete sets minted" : "Pairs merged",
        description: action === "split"
          ? `Minted ${fmtCC(amt, 2)} Yes + ${fmtCC(amt, 2)} No for ${fmtCC(amt)} CC from your in-app balance.`
          : `Burned ${fmtCC(amt, 2)} pairs — ${fmtCC(amt)} CC credited to your in-app balance.`,
        status: "success",
        duration: 6000,
        isClosable: true,
      });
    } finally {
      setBusy(null);
    }
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
    const lpWallet = usePrepared ? null : requireWallet(maxCost);
    if (!usePrepared && !lpWallet) return;
    setBusy("liquidity");
    try {
      const ok = await runPrepared(
        "Provide liquidity",
        { action: "provide_liquidity", amountCC: liquidityValue.toFixed(10), slippageBps },
        () =>
          lpWallet
            ? buildProvideLiquidityParams(
                account.address,
                market.contractId,
                liquidityValue,
                maxCost,
                lpPosition?.contractId ?? null,
                lpWallet.contractId,
                disclosedForMarket().length > 0 ? disclosedForMarket() : undefined,
              )
            : null,
      );
      if (ok) {
        await refreshAllViews();
        toast({
          title: "Liquidity added",
          description: `${fmtCC(cost)} CC debited from your in-app balance (≈${fmtCC(liquidityQuote.lpMinted, 4)} LP tokens).`,
          status: "success",
          duration: 5000,
          isClosable: true,
        });
      }
    } finally {
      setBusy(null);
    }
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
    const lpWallet = usePrepared ? null : requireWallet();
    if (!usePrepared && !lpWallet) return;
    setBusy("withdraw");
    try {
      const ok = await runPrepared(
        "Withdraw liquidity",
        { action: "withdraw_liquidity", lpTokens: burn.toFixed(10) },
        () =>
          lpWallet
            ? buildWithdrawLiquidityParams(
                account.address,
                market.contractId,
                burn,
                lpPosition.contractId,
                userPosition?.contractId ?? null,
                lpWallet.contractId,
                disclosedForMarket().length > 0 ? disclosedForMarket() : undefined,
              )
            : null,
      );
      if (!ok) return;
      await refreshAllViews();
      toast({
        title: "Liquidity withdrawn",
        description: "CC proceeds were credited to your in-app balance.",
        status: "success",
        duration: 5000,
        isClosable: true,
      });
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
      debugError("Market action failed", e);
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
      debugError("Market action failed", e);
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
    const bondWallet = requireWallet(bond > 0 ? bond : undefined);
    if (!bondWallet) return;
    setBusy("propose");
    try {
      const ok = await runUserChoice(
        "Propose outcome",
        buildProposeOutcomeParams(account.address, market.contractId, outcome, bondWallet.contractId, disclosedForMarket().length > 0 ? disclosedForMarket() : undefined),
      );
      if (ok) {
        await refreshAllViews();
        toast({
          title: `Proposed ${outcome}`,
          description: `${bond > 0 ? `${fmtCC(bond)} CC bond debited from your in-app balance. ` : ""}Challenge window: ${fmtCountdown(nowSecs + market.policy.challengeSecs, nowSecs)}.`,
          status: "success",
          duration: 6000,
          isClosable: true,
        });
      }
    } finally {
      setBusy(null);
    }
  };

  const handleChallenge = async (outcome: OutcomeArg) => {
    if (!market || !account) return;
    const bond = market.policy.bondCC;
    const bondWallet = requireWallet(bond > 0 ? bond : undefined);
    if (!bondWallet) return;
    setBusy("challenge");
    try {
      const ok = await runUserChoice(
        "Challenge",
        buildChallengeOutcomeParams(account.address, market.contractId, outcome, bondWallet.contractId, disclosedForMarket().length > 0 ? disclosedForMarket() : undefined),
      );
      if (ok) {
        await refreshAllViews();
        toast({
          title: `Challenged with ${outcome}`,
          description: `${bond > 0 ? `${fmtCC(bond)} CC bond debited from your in-app balance. ` : ""}Escalates objectively to the reporter quorum / signed source — never a vote.`,
          status: "success",
          duration: 7000,
          isClosable: true,
        });
      }
    } finally {
      setBusy(null);
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
    if (!market || !account || (!usePrepared && !userPosition)) return;
    const redeemWallet = usePrepared ? null : requireWallet();
    if (!usePrepared && !redeemWallet) return;
    setBusy("redeem");
    try {
      const ok = await runPrepared("Redeem", { action: "redeem" }, () =>
        userPosition && redeemWallet
          ? buildRedeemPositionParams(
              account.address,
              market.contractId,
              userPosition.contractId,
              redeemWallet.contractId,
              disclosedForMarket().length > 0 ? disclosedForMarket() : undefined,
            )
          : null,
      );
      if (!ok) return;
      await refreshAllViews();
      toast({
        title: "Position redeemed",
        description: "The payout was credited to your in-app balance.",
        status: "success",
        duration: 6000,
        isClosable: true,
      });
    } finally {
      setBusy(null);
    }
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (loading && !market) {
    return variant === "dock" ? (
      <div className="k-card space-y-3 p-4">
        <div className="skeleton h-5 w-2/3" />
        <div className="skeleton h-10 w-full" />
        <div className="skeleton h-40 w-full" />
      </div>
    ) : (
      <div className="space-y-5 py-2">
        <div className="skeleton h-4 w-40" />
        <div className="skeleton h-8 w-3/4" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
          <div className="skeleton h-80 w-full rounded-xl" />
          <div className="skeleton h-80 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  if (!market) {
    return (
      <div className="k-card flex min-h-[40vh] flex-col items-center justify-center gap-2 p-8 text-center">
        <p className="text-base font-semibold text-slate-950">Market {marketRef} not found</p>
        <Link to="/marketplace" className="quiet-link text-xs">Back to markets</Link>
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

  const subTabBtn = (active: boolean) =>
    `flex-1 rounded-md py-1.5 text-sm font-semibold transition-all ${
      active ? "bg-slate-950 text-white shadow-sm" : "text-slate-500 hover:text-slate-950"
    }`;
  // Trade / Liquidity header tabs of the panel: the active one underlined in the brand colour.
  const tabHeaderBtn = (active: boolean) =>
    `flex-1 border-b-[3px] pl-3 pr-1 pt-2.5 pb-2 text-left transition-colors ${
      active ? "border-primary text-slate-950" : "border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-950"
    }`;
  const pillBtn = (active: boolean) =>
    `flex-1 rounded-lg py-2 text-sm font-semibold transition-all ${
      active ? "bg-slate-950 text-white shadow-sm" : "border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-950"
    }`;

  const tradeContext = {
    setMainTab, subTabBtn, tabHeaderBtn, pillBtn, tradeSubTab, setTradeSubTab, phase, market, nowSecs,
    tradeSide, setTradeSide, selectedSide, setSelectedSide, probYes, probNo,
    collateralIn, sharesIn, setCollateralIn, setSharesIn, slippage, setSlippage,
    // The real account stays in the contexts so the position cards show what the
    // connected party holds; `tradeLockReason` (state B) is what disables the money
    // CTAs and labels them — requireWallet() blocks the submit itself either way.
    buyQuote, sellQuote, swapQuote, account, signInFirst: signInRequired, tradeLockReason, walletCta, busy, handleTradeClick, mintMode,
    setMintMode, splitMergeAmount, setSplitMergeAmount, handleSplitMerge,
    userPosition, holdings,
  };
  const liquidityContext = {
    setMainTab, subTabBtn, tabHeaderBtn, pillBtn, liquiditySubTab, setLiquiditySubTab, canProvideLiquidity,
    liquidityValue, setLiquidityValue, liquidityQuote, busy, handleProvideLiquidity,
    lpPosition, market, phase, withdrawPct, setWithdrawPct, handleWithdrawLiquidity,
    account, signInFirst: signInRequired, tradeLockReason,
  };
  const resolutionContext = {
    market, phase, nowSecs, busy, account, setResolveOutcome, resolveOutcome,
    handleResolveT0, attestations, handleResolveWithAttestations, resolveSource,
    setResolveSource, handlePropose, handleChallenge, handleFinalize, userPosition,
    holdings, probYes, probNo, isAdmin, handleVoidMarket, signInFirst: signInRequired,
  };
  const settlementContext = {
    phase, market, redeemable, busy, account, signInFirst: signInRequired, tradeLockReason, handleRedeem, lpPosition,
    withdrawPct, setWithdrawPct, handleWithdrawLiquidity, userPosition,
    holdings, probYes, probNo,
  };

  // Rendered at the top of the trade column, next to the actions it funds. The card itself
  // decides what a visitor without a wallet sees (sign in, or connect).
  const walletSlot = (
    <>
      {tradeLockReason && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
          <span className="font-semibold">{tradeLockReason}.</span> The connected wallet is linked to your account
          but is not its primary wallet, so it can deposit into the in-app balance below but cannot trade from it.
        </div>
      )}
      <InAppWalletCard wallet={wallet} walletLoaded={userDataLoaded} onChanged={refreshAllViews} variant="compact" />
    </>
  );

  const panel = mainTab === "liquidity" ? <MarketLiquidityPanel context={liquidityContext} walletSlot={walletSlot} /> : <MarketTradePanel context={tradeContext} walletSlot={walletSlot} />;

  const delta24 = priceDelta(probYes, market.previousPrice ?? null);
  const phaseLabel: Record<typeof phase, string> = {
    liquidity_period: "Liquidity period",
    trading: "Trading",
    expired: "Awaiting resolution",
    proposed: "Outcome proposed",
    resolved: "Resolved",
    voided: "Voided",
  };
  const yesLabel = market.yesSubTitle && market.yesSubTitle.toLowerCase() !== "yes" ? market.yesSubTitle : "Yes";
  const noLabel = market.noSubTitle && market.noSubTitle.toLowerCase() !== "no" ? market.noSubTitle : "No";
  const expires = new Date(market.expiresAt * 1000);

  // ── Dock: the trade panel alone, for the event page's sticky column ──
  if (variant === "dock") {
    return (
      <div className="space-y-3">
        <div className="k-card px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="k-eyebrow">{phaseLabel[phase]}</div>
              <div className="mt-0.5 truncate text-sm font-bold text-slate-950" title={market.question}>{yesLabel === "Yes" ? market.question : yesLabel}</div>
              {yesLabel !== "Yes" && <div className="truncate text-xs text-slate-500">{market.question}</div>}
            </div>
            <div className="shrink-0 text-right">
              <div className="k-num text-2xl font-bold leading-none tracking-[-0.03em] text-slate-950">{formatPercent(probYes)}</div>
              {delta24 && <div className={`k-num mt-0.5 text-[11px] font-semibold ${delta24.direction === "up" ? "delta-up" : delta24.direction === "down" ? "delta-down" : "delta-flat"}`}>{delta24.text} today</div>}
            </div>
          </div>
        </div>
        {panel}
        {(showResolveTab || showSettleTab) && (
          <Link to={`/markets/${market.ticker || market.marketId}`} className="quiet-link text-xs">
            {showSettleTab ? "Redeem and settle on the market page" : "Resolution on the market page"} <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>
    );
  }

  // ── Page ──
  return (
    <div className="space-y-5">
      <nav className="k-breadcrumb" aria-label="Breadcrumb">
        <Link to="/marketplace">Markets</Link>
        {market.seriesTicker && (
          <>
            <ChevronRight className="k-breadcrumb-sep h-3.5 w-3.5" />
            <Link to={`/marketplace?series=${encodeURIComponent(market.seriesTicker)}`}>{market.seriesTicker}</Link>
          </>
        )}
        <ChevronRight className="k-breadcrumb-sep h-3.5 w-3.5" />
        <Link to={`/events/${market.eventTicker}`}>{market.eventTicker}</Link>
        <ChevronRight className="k-breadcrumb-sep h-3.5 w-3.5" />
        <span className="font-mono text-slate-700">{market.ticker}</span>
      </nav>

      <header className="flex items-start gap-4">
        {market.imageUrl && (
          <div className="hidden h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-slate-100 ring-1 ring-slate-200/70 sm:block">
            <img src={market.imageUrl} alt="" className="h-full w-full object-cover" onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            {market.category && <span className="k-chip-soft">{market.category}</span>}
            <span className={`k-chip-soft ${phase === "trading" ? "text-emerald-700" : ""}`}>{phaseLabel[phase]}</span>
            {market.isDynamic && <span className="k-chip-soft text-violet-700">dynamic pm-AMM</span>}
          </div>
          <h1 className="text-2xl font-bold leading-tight tracking-[-0.02em] text-slate-950 sm:text-[28px]">{market.question}</h1>
          <p className="mt-1.5 text-sm text-slate-500">
            <span className="font-semibold text-oracle-yes">Yes</span> {yesLabel !== "Yes" ? `= ${yesLabel}` : ""} · <span className="font-semibold text-oracle-no">No</span> {noLabel !== "No" ? `= ${noLabel}` : ""}
            {yesLabel === "Yes" && noLabel === "No" && <span> — binary market</span>}
          </p>
          {market.description && <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{market.description}</p>}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <div className="min-w-0 space-y-5">
          <PriceChart marketRef={market.ticker || market.marketId} createdAtSec={market.createdAt} currentPrice={probYes} yesLabel={yesLabel !== "Yes" ? yesLabel : undefined} indexed={indexed} refreshKey={chartRefreshKey} height={280} />

          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
            <div className="k-stat">
              <div className="k-stat-label">24h change</div>
              <div className={`k-stat-value k-num ${delta24 ? (delta24.direction === "up" ? "delta-up" : delta24.direction === "down" ? "delta-down" : "") : ""}`}>{delta24 ? `${delta24.text} pts` : "—"}</div>
              <div className="k-stat-sub">from {market.previousPrice != null ? formatPercent(market.previousPrice) : "—"}</div>
            </div>
            <div className="k-stat">
              <div className="k-stat-label">Volume 24h</div>
              <div className="k-stat-value k-num">{compactCC(market.volume24hCC ?? 0, "")}</div>
              <div className="k-stat-sub">{compactCC(market.totalVolumeCC)} lifetime</div>
            </div>
            <div className="k-stat">
              <div className="k-stat-label">Open interest</div>
              <div className="k-stat-value k-num">{compactCC(market.openInterest ?? reserveInventory, "")}</div>
              <div className="k-stat-sub">shares outstanding</div>
            </div>
            <div className="k-stat">
              <div className="k-stat-label">Liquidity</div>
              <div className="k-stat-value k-num">{compactCC(market.liquidityCC ?? currentPoolValue, "")}</div>
              <div className="k-stat-sub">pool value · {(market.feeBps / 100).toFixed(2)}% fee</div>
            </div>
            <div className="k-stat">
              <div className="k-stat-label">Trades</div>
              <div className="k-stat-value k-num">{market.tradeCount ?? "—"}</div>
              <div className="k-stat-sub">{market.book ? `bid ${formatCents(market.book.yesBid)} · ask ${formatCents(market.book.yesAsk)}` : "on the pool"}</div>
            </div>
            <div className="k-stat">
              <div className="k-stat-label">{phase === "resolved" || phase === "voided" ? "Settled" : "Closes"}</div>
              <div className="k-stat-value k-num">{expires.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</div>
              <div className="k-stat-sub">{phase === "trading" || phase === "liquidity_period" ? `${fmtCountdown(market.expiresAt, nowSecs)} left` : expires.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</div>
            </div>
          </div>

          {mainTab === "liquidity" ? (
            <YourLpBox account={account} signInFirst={signInRequired} lpPosition={lpPosition} market={market} />
          ) : (
            <YourPositionBox account={account} signInFirst={signInRequired} userPosition={userPosition} holdings={holdings} probYes={probYes} probNo={probNo} />
          )}

          {showResolveTab && <MarketResolutionPanel context={resolutionContext} />}
          {showSettleTab && <MarketSettlementPanel context={settlementContext} />}

          <section className="k-criteria">
            <div className="mb-2 flex items-center gap-2">
              <Gavel className="h-4 w-4 text-primary" />
              <h2 className="k-section-title">Resolution criteria</h2>
            </div>
            {market.resolutionDescription ? (
              <p className="k-criteria-text">{market.resolutionDescription}</p>
            ) : (
              <p className="text-sm text-slate-500">No resolution criteria were written for this market.</p>
            )}
            <div className="k-criteria-meta">
              <span className="font-semibold text-slate-950">Resolution policy</span>
              {tiers.map((t) => (
                <span key={t} className="k-chip-soft">{t}</span>
              ))}
              {tiers.length === 0 && <span className="text-slate-500">none configured</span>}
              {market.policy.sources.length > 0 && <span className="text-slate-500">Sources: {market.policy.sources.join(", ")}</span>}
              <span className="ml-auto text-slate-500">Grace {Math.round(market.gracePeriodSecs / 3600)}h after close</span>
            </div>
          </section>

          {indexed && (
            <section className="k-card overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                <h2 className="k-section-title">Recent trades</h2>
                <span className="text-xs text-slate-500">{market.tradeCount ?? 0} total</span>
              </div>
              <TradeFeed trades={tradesQuery.data?.items ?? []} loading={tradesQuery.isLoading} limit={20} emptyText="No trades on this market yet." />
            </section>
          )}

          <p className="px-1 text-xs leading-5 text-slate-500">
            Prices come from Paradigm's pm-AMM: the Yes price is Φ((y−x)/L) of the pool's reserve imbalance, so every quote is a calibrated probability between 0 and 1.
            {market.isDynamic && " Liquidity decays as L·√(T−t) toward expiry, keeping LP loss-versus-rebalancing uniform over the market's life."}
          </p>
        </div>

        <aside className="trade-column space-y-4">{panel}</aside>
      </div>
    </div>
  );
};

export default MarketView;
