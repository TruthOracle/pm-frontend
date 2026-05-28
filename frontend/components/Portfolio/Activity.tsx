import { useCantonWallet } from "@/wallets";
import {
    Table,
    TableCaption,
    TableContainer,
    Tbody,
    Td,
    Text,
    Th,
    Thead,
    Tr,
} from "@chakra-ui/react";
import { useCallback, useEffect, useState } from "react";
import {
    fetchAllPredictionMarkets,
    fetchAllResolvedMarkets,
    fetchAllUserMarketDataPositions,
    type PredictionMarketRecord,
    type ResolvedMarketRecord,
    type UserMarketPosition,
} from "@/utils/activeContracts";

/**
 * One row per market the user has a position in. Combines on-ledger UserMarketData
 * with the active/resolved PredictionMarket so we can render the question + option labels.
 */
type ActivityRow = {
    position: UserMarketPosition;
    market: PredictionMarketRecord | ResolvedMarketRecord | null;
    /** "active" if PredictionMarket, "resolved" if ResolvedMarket, "unknown" if neither found. */
    state: "active" | "resolved" | "unknown";
    /** Resolved market result, only set when state === "resolved". */
    result?: string;
    /** Payout for this position if resolved (winning shares × payoutPerShareCC). */
    payout?: number;
};

function buildRows(
    positions: UserMarketPosition[],
    actives: PredictionMarketRecord[],
    resolved: ResolvedMarketRecord[],
): ActivityRow[] {
    const activeById = new Map(actives.map((m) => [m.marketId, m]));
    const resolvedById = new Map(resolved.map((m) => [m.marketId, m]));

    return positions.map((position) => {
        const active = activeById.get(position.marketId);
        if (active) {
            return { position, market: active, state: "active" as const };
        }
        const done = resolvedById.get(position.marketId);
        if (done) {
            const winningShares =
                done.result === "Yes"
                    ? position.yesShares
                    : done.result === "No"
                        ? position.noShares
                        : 0;
            return {
                position,
                market: done,
                state: "resolved" as const,
                result: done.result,
                payout: winningShares * done.payoutPerShareCC,
            };
        }
        return { position, market: null, state: "unknown" as const };
    });
}

function Activity() {
    const { account } = useCantonWallet();
    const [rows, setRows] = useState<ActivityRow[]>([]);
    const [loading, setLoading] = useState(false);

    const fetchBets = useCallback(async () => {
        if (!account?.address) {
            setRows([]);
            return;
        }
        setLoading(true);
        try {
            const [positions, actives, resolved] = await Promise.all([
                fetchAllUserMarketDataPositions(account.address),
                fetchAllPredictionMarkets(),
                fetchAllResolvedMarkets(),
            ]);
            setRows(buildRows(positions, actives, resolved));
        } finally {
            setLoading(false);
        }
    }, [account?.address]);

    useEffect(() => {
        fetchBets();
    }, [fetchBets]);

    // Expose so MarketView.handleBuyClick can refresh us after a trade commits.
    useEffect(() => {
        (window as unknown as { refreshPortfolio?: () => void }).refreshPortfolio = fetchBets;
        return () => {
            delete (window as unknown as { refreshPortfolio?: () => void }).refreshPortfolio;
        };
    }, [fetchBets]);

    return (
        <div className="font-jbm">
            <TableContainer color={"white"} mt={10}>
                <Table variant="simple">
                    <TableCaption style={{ fontFamily: "'JetBrains Mono'" }}>
                        Your Activity on TruthOracle
                    </TableCaption>
                    <Thead>
                        <Tr>
                            <Th color={"white"} style={{ fontFamily: "'JetBrains Mono'" }}>Question</Th>
                            <Th color={"white"} style={{ fontFamily: "'JetBrains Mono'" }}>Status</Th>
                            <Th color={"white"} style={{ fontFamily: "'JetBrains Mono'" }}>Invested</Th>
                            <Th color={"white"} style={{ fontFamily: "'JetBrains Mono'" }}>Yes Shares</Th>
                            <Th color={"white"} style={{ fontFamily: "'JetBrains Mono'" }}>No Shares</Th>
                            <Th color={"white"} style={{ fontFamily: "'JetBrains Mono'" }}>Payout</Th>
                        </Tr>
                    </Thead>
                    <Tbody>
                        {rows.map((row) => {
                            const m = row.market;
                            const question = m && "question" in m ? m.question : `Market #${row.position.marketId}`;
                            const statusLabel =
                                row.state === "active"
                                    ? "Active"
                                    : row.state === "resolved"
                                        ? `Resolved (${row.result ?? "?"})`
                                        : "Unknown";
                            return (
                                <Tr color={"#CCCCFF"} key={row.position.contractId}>
                                    <Td className="font-jbm">{question}</Td>
                                    <Td className="font-jbm">{statusLabel}</Td>
                                    <Td className="font-jbm">{row.position.amountInvestedCC.toFixed(2)} CC</Td>
                                    <Td className="font-jbm">{row.position.yesShares}</Td>
                                    <Td className="font-jbm">{row.position.noShares}</Td>
                                    <Td className="font-jbm">
                                        {row.state === "resolved" ? `${(row.payout ?? 0).toFixed(2)} CC` : "—"}
                                    </Td>
                                </Tr>
                            );
                        })}
                    </Tbody>
                </Table>
                {!loading && rows.length === 0 && (
                    <Text textAlign="center" color="gray.400" py={6} className="font-jbm">
                        {account
                            ? "No positions yet. Place a bet on a market to see it here."
                            : "Connect a wallet to see your bets."}
                    </Text>
                )}
                {loading && (
                    <Text textAlign="center" color="gray.400" py={6} className="font-jbm">
                        Loading positions…
                    </Text>
                )}
            </TableContainer>
        </div>
    );
}

export default Activity;
