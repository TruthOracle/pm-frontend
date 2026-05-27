import {
  Divider,
  Flex,
  Progress,
  Skeleton,
  Stack,
  Stat,
  StatArrow,
  StatGroup,
  StatHelpText,
  StatLabel,
  StatNumber,
  Text,
  useToast,
} from "@chakra-ui/react";
import React, { useState, useEffect, useCallback } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useCantonWallet } from "@/wallets";
import { useIsAdmin } from "@/lib/useIsAdmin";
import {
  buildAddParticipantParams,
  buildBuySharesParams,
  buildRecordResultParams,
  type DisclosedContractArg,
} from "@/utils/cantonCommands";
import { TRUTHORACLE_PACKAGE_NAME } from "@/constants";
import {
  fetchAllPredictionMarkets,
  fetchAllResolvedMarkets,
  fetchUserMarketDataContractId,
  fetchUserMarketDataPosition,
  type PredictionMarketRecord,
  type ResolvedMarketRecord,
  type UserMarketPosition,
} from "@/utils/activeContracts";
import {
  enterpriseWalletPartyId,
  submitAdminTransaction,
} from "@/lib/enterpriseWalletSubmit";
import { probeWalletStatusEndpoints } from "@/lib/cantor8Status";

type MarketViewModel = {
  marketId: number;
  question: string;
  description: string;
  imageUrl: string;
  option1: string;
  option2: string;
  optionShares1: number;
  optionShares2: number;
  liquidityParam: number;
  /** Party ids in the market's observer list — only these (plus admin) can exercise Trade. */
  participants: string[];
  /** 0 = active (PredictionMarket), 1 = resolved (ResolvedMarket). */
  status: 0 | 1;
  /** Daml `MarketResult` variant tag, only set when resolved. */
  result?: "Option1" | "Option2" | "Draw" | string;
};

function toView(active?: PredictionMarketRecord, resolved?: ResolvedMarketRecord): MarketViewModel | null {
  if (active) {
    return {
      marketId: active.marketId,
      question: active.question,
      description: active.description,
      imageUrl: active.imageUrl,
      option1: active.option1,
      option2: active.option2,
      optionShares1: active.optionShares1,
      optionShares2: active.optionShares2,
      liquidityParam: active.liquidityParam,
      participants: active.participants,
      status: 0,
    };
  }
  if (resolved) {
    return {
      marketId: resolved.marketId,
      question: resolved.question,
      description: "",
      imageUrl: "",
      option1: resolved.option1,
      option2: resolved.option2,
      // Resolved markets have no LMSR state; default the pricing display to 50/50.
      optionShares1: 0,
      optionShares2: 0,
      liquidityParam: 1,
      participants: [],
      status: 1,
      result: resolved.result,
    };
  }
  return null;
}

/**
 * Poll the participant for the buyer's UserMarketData until optionShares reflect the
 * pending trade. Returns the updated position, or null on timeout. The Cantor8 SDK's
 * own status tracker polls a transfer-only endpoint that 404s for Trade commands —
 * this is the dApp-side verification that the choice actually committed.
 */
async function waitForPositionUpdate(
  partyId: string,
  marketId: number,
  expectedShares1: number,
  expectedShares2: number,
  timeoutMs = 30_000,
  intervalMs = 1500,
): Promise<UserMarketPosition | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pos = await fetchUserMarketDataPosition(partyId, marketId);
    if (pos && pos.optionShares1 >= expectedShares1 && pos.optionShares2 >= expectedShares2) {
      return pos;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}

function getCurrentPrice(q1: number, q2: number, b: number) {
  if (!b || b === 0) return { val1: 0.5, val2: 0.5 };
  const val_1 = Math.exp(q1 / b);
  const val_2 = Math.exp(q2 / b);
  return { val1: val_1 / (val_1 + val_2), val2: val_2 / (val_1 + val_2) };
}

const MarketView = () => {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  // `?status=resolved` is set by MarketCard when the user clicks a resolved tile.
  // It disambiguates the case where an active and a resolved market share a marketId
  // (happens when the participant/counter was reset but old ResolvedMarket cids stayed).
  const preferResolved = searchParams.get("status") === "resolved";
  const marketIdNum = id != null && id !== "" ? Number(id) : NaN;

  const [view, setView] = useState<MarketViewModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState<number>(0);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [predictionMarketCid, setPredictionMarketCid] = useState<string | null>(null);
  // Captured from the active PredictionMarket record so Trade can pass the contract
  // as a DisclosedContract — external (Cantor8) buyers don't see the cid via their
  // own participant view, and the wallet's prepare call needs the blob to resolve it.
  const [predictionMarketDisclosure, setPredictionMarketDisclosure] = useState<{
    createdEventBlob: string;
    synchronizerId?: string;
  } | null>(null);
  const [userMarketDataCid, setUserMarketDataCid] = useState<string | null>(null);
  const [resolveResult, setResolveResult] = useState<"Option1" | "Option2" | "Draw">("Option1");
  const [payoutPerShare, setPayoutPerShare] = useState<number>(0);
  const [resolving, setResolving] = useState(false);
  const [addParticipantInput, setAddParticipantInput] = useState<string>("");
  const [addingParticipant, setAddingParticipant] = useState(false);
  const [submittingBet, setSubmittingBet] = useState(false);
  const { account, signAndSubmitTransaction } = useCantonWallet();
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
        const matches = actives.filter((m) => m.marketId === marketIdNum);
        const active =
          matches.length === 0
            ? undefined
            : matches.reduce((best, m) =>
                m.participants.length >= best.participants.length ? m : best
              );
        const done = resolved.find((m) => m.marketId === marketIdNum);
        // If the user navigated from a resolved card (?status=resolved), pin to the
        // resolved record even when an active market with the same marketId exists
        // (post-redeploy counter collision). Otherwise prefer active.
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

  // UserMarketData is owned by the user; only they (or the service account) can resolve
  // its cid. Null on first trade — the Trade choice creates the position contract.
  useEffect(() => {
    if (!account?.address || isNaN(marketIdNum)) {
      setUserMarketDataCid(null);
      return;
    }
    fetchUserMarketDataContractId(account.address, marketIdNum).then(setUserMarketDataCid);
  }, [account?.address, marketIdNum]);

  const currentPrice = view
    ? getCurrentPrice(view.optionShares1, view.optionShares2, view.liquidityParam)
    : null;

  // Admin sees the contract by signatory and can always trade/resolve. End users
  // must be added via AddParticipant first or `prepare` fails with CONTRACT_NOT_FOUND
  // (template has `observer participants` — they can't see the cid from their view).
  const isParticipant = !!(
    account?.partyId &&
    view &&
    (isAdmin || view.participants.includes(account.partyId))
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value);
    if (!isNaN(value) && value >= 0) {
      setAmount(Math.round(value * 100) / 100);
    }
  };

  const incrementAmount = () => {
    setAmount((prev) => Math.round((prev + 1) * 100) / 100);
  };

  const decrementAmount = () => {
    setAmount((prev) => Math.max(Math.round((prev - 1) * 100) / 100, 0));
  };

  const handleOptionClick = (option: string) => {
    setSelectedOption(option);
  };

  const handleBuyClick = async () => {
    if (!view || view.status !== 0) return;
    if (!account) {
      toast({ title: "Connect a wallet to trade", status: "info", duration: 4000, isClosable: true });
      return;
    }
    if (!predictionMarketCid) {
      toast({
        title: "Market contract not found",
        description: "This market may not be visible to your party yet. Ask the admin to add you as a participant.",
        status: "warning",
        duration: 5000,
        isClosable: true,
      });
      return;
    }
    // Daml `Trade` choice expects option ∈ {1, 2}; map from the option label the user clicked.
    const damlOption = selectedOption === view.option1 ? 1 : 2;
    const numShares = Math.max(0, Math.floor(amount));
    if (numShares <= 0) {
      toast({ title: "Enter shares to buy", status: "info", duration: 3000, isClosable: true });
      return;
    }
    // LMSR cost in Canton Coin units. For now we charge 1 unit/share; the contract only
    // asserts cost >= 0, so this stays consistent with the on-ledger accounting.
    const cost = numShares;

    // Snapshot the pre-trade position so we can verify the trade committed on-ledger:
    // expected post-trade shares = pre-trade + delta on the chosen option.
    const prePosition = await fetchUserMarketDataPosition(account.address, marketIdNum);
    const expectedShares1 = (prePosition?.optionShares1 ?? 0) + (damlOption === 1 ? numShares : 0);
    const expectedShares2 = (prePosition?.optionShares2 ?? 0) + (damlOption === 2 ? numShares : 0);

    setSubmittingBet(true);
    const submittingToastId = toast({
      title: "Submitting bet…",
      description: "Confirm the transaction in the wallet popup.",
      status: "info",
      duration: null,
      isClosable: false,
    });

    try {
      const disclosed: DisclosedContractArg[] = predictionMarketDisclosure?.createdEventBlob
        ? [
            {
              templateId: `#${TRUTHORACLE_PACKAGE_NAME}:Truthoracle:PredictionMarket`,
              contractId: predictionMarketCid,
              createdEventBlob: predictionMarketDisclosure.createdEventBlob,
              synchronizerId: predictionMarketDisclosure.synchronizerId,
            },
          ]
        : [];

      const params = buildBuySharesParams(
        account.address,
        predictionMarketCid,
        damlOption,
        numShares,
        cost,
        userMarketDataCid,
        disclosed.length > 0 ? disclosed : undefined,
      );

      let txId = "";
      try {
        const committedTxn = await signAndSubmitTransaction(params);
        txId = committedTxn.hash;
        // Probe both v1 wallet endpoints to see which one returns data for this
        // commandId. Logs status transitions over ~30s in the console.
        if (txId) {
          void probeWalletStatusEndpoints(account.address, txId);
        }
      } catch (e) {
        if (submittingToastId !== undefined) toast.close(submittingToastId);
        console.error(e);
        toast({
          title: "Trade failed",
          description: e instanceof Error ? e.message : "Wallet could not submit the trade.",
          status: "error",
          duration: 5000,
          isClosable: true,
        });
        return;
      }

      // Wallet popup accepted submission. The SDK's status tracker polls a transfer-only
      // endpoint that 404s for Trade — so verify on the dApp's participant instead.
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
        expectedShares1,
        expectedShares2,
      );

      if (submittingToastId !== undefined) toast.close(submittingToastId);

      const w = window as unknown as { refreshPortfolio?: () => void; refreshMarketplace?: () => void };
      w.refreshPortfolio?.();
      w.refreshMarketplace?.();
      await refreshMarket();

      if (verified) {
        toast({
          title: "Bet Placed",
          description: `Position now ${verified.optionShares1} / ${verified.optionShares2} shares (Δ ${numShares} on ${damlOption === 1 ? view.option1 : view.option2}).`,
          status: "success",
          duration: 7000,
          isClosable: true,
        });
      } else {
        toast({
          title: "Bet submitted — confirmation pending",
          description:
            `Wallet accepted the transaction${txId ? ` (id ${txId})` : ""}, ` +
            "but the participant hasn't shown the new position yet. Refresh in a moment.",
          status: "warning",
          duration: 9000,
          isClosable: true,
        });
      }
    } finally {
      setSubmittingBet(false);
    }
  };

  const getResultText = () => {
    if (!view || view.status === 0) return null;
    if (view.result === "Option1") return `Winner: ${view.option1}`;
    if (view.result === "Option2") return `Winner: ${view.option2}`;
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

  const handleAddParticipantClick = async () => {
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
    const newParty = addParticipantInput.trim();
    if (!newParty) {
      toast({ title: "Enter a party id", status: "info", duration: 3000, isClosable: true });
      return;
    }
    if (view.participants.includes(newParty)) {
      toast({ title: "Already a participant", status: "info", duration: 3000, isClosable: true });
      return;
    }
    setAddingParticipant(true);
    try {
      const adminParty = enterpriseWalletPartyId() || account.address;
      const params = buildAddParticipantParams(adminParty, predictionMarketCid, newParty);
      const committedTxn = await submitAdminTransaction(params, signAndSubmitTransaction);
      void committedTxn.hash;
      setAddParticipantInput("");

      // AddParticipant archives the old cid and creates a new contract — poll until visible.
      let synced: PredictionMarketRecord | null = null;
      for (let i = 0; i < 12; i++) {
        synced = await refreshMarket({ silent: true });
        if (synced?.participants.includes(newParty)) break;
        await new Promise((r) => setTimeout(r, 500));
      }

      if (synced?.participants.includes(newParty)) {
        toast({
          title: "Participant added",
          description: `${newParty} can now trade on this market.`,
          status: "success",
          duration: 6000,
          isClosable: true,
        });
      } else {
        toast({
          title: "Participant submitted",
          description:
            "Transaction was sent. If the list is still empty, click Refresh below or reload the page.",
          status: "info",
          duration: 8000,
          isClosable: true,
        });
      }
    } catch (e) {
      console.error(e);
      toast({
        title: "Add participant failed",
        description: e instanceof Error ? e.message : "Could not submit AddParticipant.",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setAddingParticipant(false);
    }
  };

  if (loading && !view) {
    return (
      <Stack minHeight={"100vh"} p={5} width={"100%"} color={"white"} justifyContent={"space-between"}>
        <Skeleton height="20px" />
        <Skeleton height="20px" />
        <Skeleton height="20px" />
      </Stack>
    );
  }

  if (!view) {
    return (
      <Stack minHeight={"100vh"} p={5} width={"100%"} color={"white"} alignItems={"center"} justifyContent={"center"}>
        <Text fontSize="lg">Market #{id} not found.</Text>
      </Stack>
    );
  }

  return (
    <Flex minHeight={"100vh"} p={5} width={"100%"} color={"white"} justifyContent={"space-between"}>
      <Stack width={"60%"}>
        <h2 className="text-xl font-jbm font-bold mb-3" style={{ color: "#CCCCFF" }}>
          {view.question}
        </h2>
        <Text fontSize={"lg"} mb={10} className="font-jbm">
          {view.description}
        </Text>
        <Flex>
          <Stack width={"70%"}>
            <Flex>
              <Text mr={2}>{view.option1}</Text>
              <Text>
                {" - "}
                {view.optionShares1} Shares ({((currentPrice?.val1 ?? 0) * 100).toFixed(1)}%)
              </Text>
            </Flex>
            <Progress
              width={"50%"}
              colorScheme="green"
              size="sm"
              value={(currentPrice?.val1 ?? 0) * 100}
            />
            <Flex width={"100%"}>
              <Text mr={2}>{view.option2} </Text>
              <Text>
                {" - "}
                {view.optionShares2} Shares ({((currentPrice?.val2 ?? 0) * 100).toFixed(1)}%)
              </Text>
            </Flex>
            <Progress
              width={"50%"}
              colorScheme="red"
              size="sm"
              value={(currentPrice?.val2 ?? 0) * 100}
            />
          </Stack>

          <StatGroup>
            <Stat mr={20}>
              <StatLabel fontSize={"lg"}>{view.option1}</StatLabel>
              <StatNumber>
                {"$"}
                {currentPrice?.val1.toFixed(2)}
              </StatNumber>
              {view.status === 0 && (
                <StatHelpText>
                  <StatArrow type="increase" />
                </StatHelpText>
              )}
            </Stat>

            <Stat>
              <StatLabel fontSize={"lg"}>{view.option2}</StatLabel>
              <StatNumber>
                {"$"}
                {currentPrice?.val2.toFixed(2)}
              </StatNumber>
              {view.status === 0 && (
                <StatHelpText>
                  <StatArrow type="decrease" />
                </StatHelpText>
              )}
            </Stat>
          </StatGroup>
        </Flex>

        <Divider my={10} />

        <h2 style={{ color: "#CCCCFF" }} className="text-md font-jbm font-bold">
          About the Logarithmic Market Scoring Rule
        </h2>
        <Text fontSize={"sm"} mb={20} className="font-jbm">
          The Logarithmic Market Scoring Rule (LMSR) is a mathematical tool used to evaluate the accuracy of
          predictions. It's designed to encourage honesty and precision when making predictions about uncertain
          events.
        </Text>
      </Stack>

      {view.status === 0 ? (
        <Stack width={"30%"} ml={20}>
          <div
            style={{ color: "white", backgroundColor: "#18191C" }}
            className="font-jbm p-4 rounded-lg border-2 border-[#CCCCFF] shadow-md w-full max-w-sm mx-auto"
          >
            <div className="text-center mb-4">
              <h2 className="text-lg font-bold">Buy Bet</h2>
              <h3 className="text-sm text-gray-300 mt-2">{view.question}</h3>
            </div>

            <div className="flex flex-col items-center mb-4">
              <button
                onClick={() => handleOptionClick(view.option1)}
                className={
                  selectedOption === view.option1
                    ? "font-bold py-2 px-4 mb-2 rounded w-full border-2 border-green-400 bg-green-600 text-white ring-2 ring-green-400/40 transition-all"
                    : "font-bold py-2 px-4 mb-2 rounded w-full border-2 border-green-600 bg-transparent text-green-300 hover:bg-green-600/20 hover:text-white transition-all"
                }
              >
                Bet {view.option1}
              </button>
              <button
                onClick={() => handleOptionClick(view.option2)}
                className={
                  selectedOption === view.option2
                    ? "font-bold py-2 px-4 rounded w-full border-2 border-red-400 bg-red-600 text-white ring-2 ring-red-400/40 transition-all"
                    : "font-bold py-2 px-4 rounded w-full border-2 border-red-600 bg-transparent text-red-300 hover:bg-red-600/20 hover:text-white transition-all"
                }
              >
                Bet {view.option2}
              </button>
            </div>

            <div className="flex flex-col items-center mb-4">
              <div className="flex flex-row items-center w-max mb-4">
                <button
                  onClick={decrementAmount}
                  className="text-white font-bold py-2 px-4 rounded-l bg-[#CCCCFF] hover:bg-gray-600"
                  style={{ borderColor: "#333", borderWidth: "2px" }}
                >
                  -
                </button>
                <input
                  type="number"
                  value={amount.toFixed(2)}
                  onChange={handleInputChange}
                  placeholder="$0.0"
                  className="text-black py-2 px-4 w-32 text-center"
                  style={{ borderColor: "#333", borderWidth: "2px", borderLeft: "none", borderRight: "none" }}
                />
                <button
                  onClick={incrementAmount}
                  className="text-white font-bold py-2 px-4 rounded-r bg-[#CCCCFF] hover:bg-gray-600"
                  style={{ borderColor: "#333", borderWidth: "2px" }}
                >
                  +
                </button>
              </div>

              {(() => {
                const buyDisabledReason = !account
                  ? "Connect wallet"
                  : !predictionMarketCid
                    ? "Loading market…"
                    : !isParticipant
                      ? "Awaiting admin access"
                      : submittingBet
                        ? "Submitting…"
                        : !selectedOption
                          ? "Select an option"
                          : amount <= 0
                            ? "Enter shares to buy"
                            : null;
                const isDisabled = buyDisabledReason !== null;
                return (
                  <button
                    onClick={handleBuyClick}
                    className={
                      isDisabled
                        ? "font-bold py-2 px-4 rounded bg-[#2a2b30] text-gray-500 cursor-not-allowed"
                        : "text-black font-bold py-2 px-4 rounded bg-[#ebebf0] hover:bg-[#CCCCFF] hover:text-white"
                    }
                    style={{
                      borderColor: isDisabled ? "#3a3b40" : "#333",
                      borderWidth: "2px",
                      width: "100%",
                    }}
                    disabled={isDisabled}
                  >
                    {buyDisabledReason ?? "BUY"}
                  </button>
                );
              })()}
              <div className="flex flex-col m-1 text-gray-500 text-sm justify-between font-jbm">
                <p className="font-jbm">⚠️ Due to slippage tolerance, price may vary.</p>
                {account && !isParticipant && (
                  <p className="font-jbm text-amber-400 mt-2">
                    🔒 Your party is not a participant yet. Ask the admin to add{" "}
                    <span className="break-all text-amber-300">{account.partyId}</span> to this market.
                  </p>
                )}
              </div>
            </div>
          </div>

          {isAdmin && (
            <div
              style={{ color: "white", backgroundColor: "#18191C" }}
              className="font-jbm p-4 mt-4 rounded-lg border-2 border-[#CCCCFF] shadow-md w-full max-w-sm mx-auto"
            >
              <div className="text-center mb-3">
                <h2 className="text-lg font-bold">Add Participant</h2>
                <p className="text-xs text-gray-400 mt-1">
                  Grant trading access. {view.participants.length} participant
                  {view.participants.length === 1 ? "" : "s"} so far.
                </p>
              </div>
              {view.participants.length > 0 ? (
                <ul
                  className="text-left text-xs text-gray-300 mb-3 max-h-36 overflow-y-auto rounded border border-gray-700 divide-y divide-gray-700"
                  aria-label="Market participants"
                >
                  {view.participants.map((partyId) => (
                    <li key={partyId} className="break-all px-2 py-2 font-mono">
                      {partyId}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-gray-500 mb-3 text-center">No participants yet — add a party id below.</p>
              )}
              <input
                type="text"
                value={addParticipantInput}
                onChange={(e) => setAddParticipantInput(e.target.value)}
                placeholder="Party id (e.g. user::1220…)"
                className="text-black py-2 px-3 w-full text-sm mb-2 rounded"
                style={{ borderColor: "#333", borderWidth: "2px" }}
              />
              <div className="flex gap-2">
                <button
                  onClick={handleAddParticipantClick}
                  className="text-black font-bold py-2 px-4 rounded bg-[#ebebf0] hover:bg-[#CCCCFF] hover:text-white disabled:bg-[#2a2b30] disabled:text-gray-500 disabled:cursor-not-allowed flex-1"
                  style={{ borderColor: "#333", borderWidth: "2px" }}
                  disabled={addingParticipant || !predictionMarketCid || !account || !addParticipantInput.trim()}
                >
                  {addingParticipant ? "Adding…" : "ADD"}
                </button>
                <button
                  type="button"
                  onClick={() => void refreshMarket()}
                  className="text-gray-300 font-bold py-2 px-3 rounded border-2 border-gray-600 hover:border-[#CCCCFF] hover:text-white disabled:opacity-50"
                  disabled={addingParticipant}
                  title="Reload participants from ledger"
                >
                  Refresh
                </button>
              </div>
            </div>
          )}

          {isAdmin && (
            <div
              style={{ color: "white", backgroundColor: "#18191C" }}
              className="font-jbm p-4 mt-4 rounded-lg border-2 border-[#CCCCFF] shadow-md w-full max-w-sm mx-auto"
            >
              <div className="text-center mb-4">
                <h2 className="text-lg font-bold">Resolve Market</h2>
                <p className="text-xs text-gray-400 mt-1">Admin only — archives this market and records the outcome.</p>
              </div>

              <div className="flex flex-col items-stretch mb-4 gap-2">
                <button
                  onClick={() => setResolveResult("Option1")}
                  className={
                    resolveResult === "Option1"
                      ? "font-bold py-2 px-4 rounded w-full border-2 border-green-400 bg-green-600 text-white ring-2 ring-green-400/40 transition-all"
                      : "font-bold py-2 px-4 rounded w-full border-2 border-green-600 bg-transparent text-green-300 hover:bg-green-600/20 hover:text-white transition-all"
                  }
                >
                  {view.option1} wins
                </button>
                <button
                  onClick={() => setResolveResult("Option2")}
                  className={
                    resolveResult === "Option2"
                      ? "font-bold py-2 px-4 rounded w-full border-2 border-red-400 bg-red-600 text-white ring-2 ring-red-400/40 transition-all"
                      : "font-bold py-2 px-4 rounded w-full border-2 border-red-600 bg-transparent text-red-300 hover:bg-red-600/20 hover:text-white transition-all"
                  }
                >
                  {view.option2} wins
                </button>
                <button
                  onClick={() => setResolveResult("Draw")}
                  className={
                    resolveResult === "Draw"
                      ? "font-bold py-2 px-4 rounded w-full border-2 border-gray-300 bg-gray-500 text-white ring-2 ring-gray-300/40 transition-all"
                      : "font-bold py-2 px-4 rounded w-full border-2 border-gray-500 bg-transparent text-gray-300 hover:bg-gray-500/30 hover:text-white transition-all"
                  }
                >
                  Draw
                </button>
              </div>

              <div className="flex flex-col items-center mb-3">
                <label className="text-xs text-gray-400 mb-1 self-start">Payout per share</label>
                <input
                  type="number"
                  min={0}
                  value={payoutPerShare}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    setPayoutPerShare(isNaN(v) || v < 0 ? 0 : v);
                  }}
                  placeholder="0"
                  className="text-black py-2 px-4 w-full text-center"
                  style={{ borderColor: "#333", borderWidth: "2px" }}
                />
              </div>

              <button
                onClick={handleResolveClick}
                className="text-black font-bold py-2 px-4 rounded bg-[#ebebf0] hover:bg-[#CCCCFF] hover:text-white"
                style={{ borderColor: "#333", borderWidth: "2px", width: "100%" }}
                disabled={resolving || !predictionMarketCid || !account}
              >
                {resolving
                  ? "Resolving…"
                  : !account
                    ? "Connect wallet"
                    : !predictionMarketCid
                      ? "Loading market…"
                      : "RECORD RESULT"}
              </button>
              <p className="text-xs text-gray-500 mt-2 font-jbm">
                ⚠️ This is irreversible — the market will be archived and a ResolvedMarket created on-ledger.
              </p>
            </div>
          )}
        </Stack>
      ) : (
        <Stack width={"30%"} ml={20}>
          <div
            style={{ color: "white", backgroundColor: "#18191C" }}
            className="font-jbm p-4 rounded-lg border-2 border-[#CCCCFF] shadow-md w-full max-w-sm mx-auto"
          >
            <div className="text-center mb-4">
              <h2 className="text-lg font-bold">Market Result</h2>
              <Text color="#CCCCFF" fontSize="lg" mt={4}>
                {getResultText()}
              </Text>
              <div className="mt-4 text-left text-sm text-gray-300 space-y-1">
                <div className="flex justify-between">
                  <span>{view.option1}</span>
                  <span>
                    {view.optionShares1} ({((currentPrice?.val1 ?? 0) * 100).toFixed(1)}%)
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>{view.option2}</span>
                  <span>
                    {view.optionShares2} ({((currentPrice?.val2 ?? 0) * 100).toFixed(1)}%)
                  </span>
                </div>
              </div>
            </div>
          </div>

          {isAdmin && (
            <div
              style={{ color: "white", backgroundColor: "#18191C" }}
              className="font-jbm p-4 mt-4 rounded-lg border-2 border-[#CCCCFF] shadow-md w-full max-w-sm mx-auto"
            >
              <div className="text-center mb-3">
                <h2 className="text-lg font-bold">Participants</h2>
                <p className="text-xs text-gray-400 mt-1">
                  Market is resolved — read-only. {view.participants.length} participant
                  {view.participants.length === 1 ? "" : "s"}.
                </p>
              </div>
              {view.participants.length > 0 ? (
                <ul
                  className="text-left text-xs text-gray-300 max-h-48 overflow-y-auto rounded border border-gray-700 divide-y divide-gray-700"
                  aria-label="Market participants"
                >
                  {view.participants.map((partyId) => (
                    <li key={partyId} className="break-all px-2 py-2 font-mono">
                      {partyId}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-gray-500 text-center">
                  Participant list isn't preserved on the ResolvedMarket contract.
                </p>
              )}
            </div>
          )}
        </Stack>
      )}
    </Flex>
  );
};

export default MarketView;
