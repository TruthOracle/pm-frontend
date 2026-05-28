import {
    Box,
    Button,
    Heading,
    Input,
    Table,
    Tbody,
    Td,
    Text,
    Th,
    Thead,
    Tr,
    useToast,
} from "@chakra-ui/react";
import { useCallback, useEffect, useState } from "react";
import { useCantonWallet } from "@/wallets";
import {
    fetchPendingPayouts,
    type PendingPayoutRecord,
} from "@/utils/activeContracts";
import { buildMarkPaidParams } from "@/utils/cantonCommands";
import {
    enterpriseWalletPartyId,
    submitAdminTransaction,
} from "@/lib/enterpriseWalletSubmit";

function truncate(s: string, head = 8, tail = 6) {
    if (s.length <= head + tail + 1) return s;
    return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

/**
 * Admin payout queue. Lists every PendingPayout the admin party can see
 * (i.e. they're signatory). Admin reads the queue, sends the CC off-ledger
 * via the Enterprise Wallet's `/api/v1/transfer`, then exercises MarkPaid
 * to archive the row with a tx hash for audit.
 *
 * This is the manual half of the two-step flow. The actual CC transfer
 * is NOT wired through this UI yet — admin pastes the off-ledger tx hash.
 */
function PayoutQueue() {
    const { account, signAndSubmitTransaction } = useCantonWallet();
    const [rows, setRows] = useState<PendingPayoutRecord[]>([]);
    const [loading, setLoading] = useState(false);
    const [marking, setMarking] = useState<string | null>(null);
    const [txHashes, setTxHashes] = useState<Record<string, string>>({});
    const toast = useToast();

    const adminParty = enterpriseWalletPartyId();

    const refresh = useCallback(async () => {
        if (!adminParty) return;
        setLoading(true);
        try {
            const list = await fetchPendingPayouts(adminParty);
            setRows(list);
        } finally {
            setLoading(false);
        }
    }, [adminParty]);

    useEffect(() => {
        refresh();
    }, [refresh]);

    const markPaid = async (cid: string) => {
        if (!account) return;
        const hash = (txHashes[cid] ?? "").trim();
        if (!hash) {
            toast({ title: "Paste the CC tx hash first", status: "info", duration: 3000, isClosable: true });
            return;
        }
        setMarking(cid);
        try {
            const params = buildMarkPaidParams(adminParty || account.address, cid, hash);
            const committed = await submitAdminTransaction(params, signAndSubmitTransaction);
            void committed.hash;
            toast({
                title: "Payout marked paid",
                description: "PendingPayout archived. The user's row will disappear on next refresh.",
                status: "success",
                duration: 5000,
                isClosable: true,
            });
            setTxHashes((m) => {
                const next = { ...m };
                delete next[cid];
                return next;
            });
            await refresh();
        } catch (e) {
            console.error(e);
            toast({
                title: "Mark paid failed",
                description: e instanceof Error ? e.message : String(e),
                status: "error",
                duration: 5000,
                isClosable: true,
            });
        } finally {
            setMarking(null);
        }
    };

    if (!adminParty) {
        return (
            <Box color="white" p={6}>
                <Text color="orange.400" fontSize="sm">
                    VITE_ENTERPRISE_WALLET_PARTY_ID is not set — payout queue can't load.
                </Text>
            </Box>
        );
    }

    const total = rows.reduce((s, r) => s + r.amountCC, 0);

    return (
        <Box className="font-jbm" color="white" p={6} mt={6} borderRadius="lg" borderWidth="2px" borderColor="#CCCCFF" bg="#18191C" maxW="6xl" mx="auto">
            <Heading size="md" mb={1} color="#CCCCFF">Payout Queue</Heading>
            <Text fontSize="xs" color="gray.500" mb={4}>
                Sell, Merge, and resolved-winner shares each create a `PendingPayout` row here. Send the CC out-of-band via the Enterprise Wallet, then paste the resulting tx hash and Mark Paid to archive the row.
            </Text>
            <Text fontSize="sm" color="amber.300" mb={3}>
                Outstanding: <strong>{total.toFixed(4)} CC</strong> across <strong>{rows.length}</strong> row{rows.length === 1 ? "" : "s"}
            </Text>
            <Button size="sm" onClick={refresh} isDisabled={loading} mb={4}>
                {loading ? "Refreshing…" : "Refresh"}
            </Button>
            {rows.length === 0 ? (
                <Text color="gray.500" fontSize="sm">No outstanding payouts.</Text>
            ) : (
                <Table variant="simple" size="sm">
                    <Thead>
                        <Tr>
                            <Th color="white">User</Th>
                            <Th color="white">Market</Th>
                            <Th color="white">Reason</Th>
                            <Th color="white" isNumeric>Amount</Th>
                            <Th color="white">CC tx hash</Th>
                            <Th color="white"></Th>
                        </Tr>
                    </Thead>
                    <Tbody>
                        {rows.map((r) => (
                            <Tr color="#CCCCFF" key={r.contractId}>
                                <Td fontSize="xs" fontFamily="mono">{truncate(r.user)}</Td>
                                <Td>#{r.marketId}</Td>
                                <Td>{r.reason}</Td>
                                <Td isNumeric>{r.amountCC.toFixed(4)} CC</Td>
                                <Td>
                                    <Input
                                        size="sm"
                                        placeholder="paste off-ledger tx hash"
                                        value={txHashes[r.contractId] ?? ""}
                                        onChange={(e) =>
                                            setTxHashes((m) => ({ ...m, [r.contractId]: e.target.value }))
                                        }
                                        bg="white"
                                        color="black"
                                    />
                                </Td>
                                <Td>
                                    <Button
                                        size="sm"
                                        colorScheme="green"
                                        onClick={() => markPaid(r.contractId)}
                                        isDisabled={marking === r.contractId || !(txHashes[r.contractId] ?? "").trim()}
                                    >
                                        {marking === r.contractId ? "…" : "Mark Paid"}
                                    </Button>
                                </Td>
                            </Tr>
                        ))}
                    </Tbody>
                </Table>
            )}
        </Box>
    );
}

export default PayoutQueue;
