import {
    Box,
    Heading,
    Table,
    Tbody,
    Td,
    Text,
    Th,
    Thead,
    Tr,
} from "@chakra-ui/react";
import { useCallback, useEffect, useState } from "react";
import { useCantonWallet } from "@/wallets";
import {
    fetchPendingPayouts,
    type PendingPayoutRecord,
} from "@/utils/activeContracts";

/**
 * Lists CC payouts the admin owes the connected user. Each row comes from a
 * `PendingPayout` contract on-ledger — Sell, Merge, and resolved-winner shares
 * all flow through this queue. Admin marks each one paid after the actual CC
 * transfer goes out via the Enterprise Wallet.
 */
function PendingPayouts() {
    const { account } = useCantonWallet();
    const [rows, setRows] = useState<PendingPayoutRecord[]>([]);
    const [loading, setLoading] = useState(false);

    const refresh = useCallback(async () => {
        if (!account?.address) {
            setRows([]);
            return;
        }
        setLoading(true);
        try {
            const list = await fetchPendingPayouts(account.address);
            setRows(list.filter((r) => r.user === account.address));
        } finally {
            setLoading(false);
        }
    }, [account?.address]);

    useEffect(() => {
        refresh();
    }, [refresh]);

    if (!account) return null;

    const total = rows.reduce((sum, r) => sum + r.amountCC, 0);

    return (
        <Box className="font-jbm" color="white" mt={6} maxW="4xl" mx="auto">
            <Heading size="md" mb={1} color="#CCCCFF">Pending Payouts</Heading>
            <Text fontSize="xs" color="gray.500" mb={4}>
                CC the admin owes you. Each row maps to a `PendingPayout` contract created when
                you sold shares, merged a pair, or won a resolved market. Admin pays out
                asynchronously via the Enterprise Wallet.
            </Text>
            {loading && rows.length === 0 ? (
                <Text color="gray.400">Loading…</Text>
            ) : rows.length === 0 ? (
                <Text color="gray.500" fontSize="sm">No pending payouts.</Text>
            ) : (
                <>
                    <Text fontSize="sm" color="green.300" mb={3}>
                        Total owed: <strong>{total.toFixed(4)} CC</strong>
                    </Text>
                    <Table variant="simple" size="sm">
                        <Thead>
                            <Tr>
                                <Th color="white">Market</Th>
                                <Th color="white">Reason</Th>
                                <Th color="white" isNumeric>Amount</Th>
                                <Th color="white">Created</Th>
                            </Tr>
                        </Thead>
                        <Tbody>
                            {rows.map((r) => (
                                <Tr color="#CCCCFF" key={r.contractId}>
                                    <Td>#{r.marketId}</Td>
                                    <Td>{r.reason}</Td>
                                    <Td isNumeric>{r.amountCC.toFixed(4)} CC</Td>
                                    <Td>{new Date(r.createdAt * 1000).toLocaleString()}</Td>
                                </Tr>
                            ))}
                        </Tbody>
                    </Table>
                </>
            )}
        </Box>
    );
}

export default PendingPayouts;
