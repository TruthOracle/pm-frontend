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
import { runAdminAutoPayout } from "@/lib/adminAutoPayout";
import { debugError } from "@/lib/debugLog";
import { useAuth } from "@/auth/AuthContext";

function truncate(s: string, head = 8, tail = 6) {
    if (s.length <= head + tail + 1) return s;
    return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

/**
 * Admin payout queue. Lists every PendingPayout the admin party can see
 * (i.e. they're signatory).
 *
 * "Settle" is the normal path WITHOUT an accounts backend: the server reads payee and
 * amount from the contract, sends the CC through the Enterprise Wallet, and exercises
 * MarkPaid — the same race-safe endpoint the automatic flows use, so a stuck payout is
 * retried here with no chance of double-paying. Once a backend is configured (§18)
 * that route answers 410 for everyone: the backend's payout processor settles every
 * row itself (bond / model-prize in-app within 30 s, withdrawals KYC-gated), and a
 * second settler with its own command ids would pay twice. The button is therefore
 * hidden until this queue is ported to POST /admin/payouts/:cid/settle. The
 * paste-a-hash Mark Paid remains as the escape hatch for payouts that were genuinely
 * settled out-of-band.
 */
function PayoutQueue() {
    const { account, signAndSubmitTransaction } = useCantonWallet();
    const auth = useAuth();
    // `unavailable` = the relay has no BACKEND_URL; anything else means a backend owns
    // settlement (loading / unreachable included — better a hidden button than a 410).
    const legacySettleEnabled = auth.status === "unavailable";
    const [rows, setRows] = useState<PendingPayoutRecord[]>([]);
    const [loading, setLoading] = useState(false);
    const [marking, setMarking] = useState<string | null>(null);
    const [settling, setSettling] = useState<string | null>(null);
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

    const settle = async (cid: string) => {
        setSettling(cid);
        try {
            const result = await runAdminAutoPayout({ pendingPayoutCid: cid });
            toast({
                title: result.settled ? "Payout settled" : "Nothing to settle",
                description: result.settled
                    ? `Sent ${result.amountCC?.toFixed(4) ?? "?"} CC to ${truncate(result.to ?? "?")} and archived the row.`
                    : "The payout was already settled or cancelled.",
                status: result.settled ? "success" : "info",
                duration: 6000,
                isClosable: true,
            });
            await refresh();
        } catch (e) {
            toast({
                title: "Settlement failed",
                description: e instanceof Error ? e.message : String(e),
                status: "error",
                duration: 6000,
                isClosable: true,
            });
        } finally {
            setSettling(null);
        }
    };

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
            debugError("Mark paid failed", e);
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
                Sell, Merge, withdrawals, and resolved-winner shares each create a `PendingPayout` row here.
                Settle sends the CC via the Enterprise Wallet and archives the row in one step (amount and
                payee come from the contract). Use Mark Paid only for payouts already settled out-of-band.
            </Text>
            {!legacySettleEnabled && (
                <Text fontSize="xs" color="amber.300" mb={3}>
                    An accounts backend is configured: its payout processor settles these rows itself (bond and
                    model-prize into the in-app balance, withdrawals after identity verification). The legacy
                    Settle path is retired here to avoid paying twice; Mark Paid stays for out-of-band payments.
                </Text>
            )}
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
                                    {legacySettleEnabled ? (
                                        <Button
                                            size="sm"
                                            colorScheme="green"
                                            mr={2}
                                            onClick={() => settle(r.contractId)}
                                            isLoading={settling === r.contractId}
                                            isDisabled={settling !== null || marking !== null}
                                        >
                                            Settle
                                        </Button>
                                    ) : (
                                        <Text as="span" fontSize="xs" color="gray.500" mr={2}>
                                            {r.reason === "withdraw" ? "Backend (KYC-gated)" : "Backend (in-app)"}
                                        </Text>
                                    )}
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        colorScheme="gray"
                                        onClick={() => markPaid(r.contractId)}
                                        isDisabled={
                                            settling !== null ||
                                            marking === r.contractId ||
                                            !(txHashes[r.contractId] ?? "").trim()
                                        }
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
