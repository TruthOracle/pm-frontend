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
import { debugError } from "@/lib/debugLog";

function truncate(s: string, head = 8, tail = 6) {
    if (s.length <= head + tail + 1) return s;
    return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

/**
 * Admin payout queue. Lists every PendingPayout the admin party can see (i.e. they're
 * signatory).
 *
 * Settlement is the accounts backend's job: its payout processor settles bond /
 * model-prize rows into the in-app balance and withdrawals after identity verification,
 * and an operator force-settles a stuck row through its admin API
 * (POST /api/v1/admin/payouts/:cid/settle). That API needs a backend ADMIN session,
 * which this UI's operator cookie (to_admin) is not — so nothing here pretends to call
 * it; the contract id is copyable instead. The paste-a-hash Mark Paid remains as the
 * escape hatch for payouts that were genuinely settled out-of-band (wallet-signed,
 * amount never leaves the browser).
 */
function PayoutQueue() {
    const { account, signAndSubmitTransaction } = useCantonWallet();
    const [rows, setRows] = useState<PendingPayoutRecord[]>([]);
    const [loading, setLoading] = useState(false);
    const [marking, setMarking] = useState<string | null>(null);
    const [txHashes, setTxHashes] = useState<Record<string, string>>({});
    const [copied, setCopied] = useState<string | null>(null);
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

    const copyCid = async (cid: string) => {
        try {
            await navigator.clipboard.writeText(cid);
            setCopied(cid);
            window.setTimeout(() => setCopied((c) => (c === cid ? null : c)), 1500);
        } catch {
            toast({ title: "Could not copy", description: cid, status: "info", duration: 6000, isClosable: true });
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
            <Text fontSize="xs" color="gray.500" mb={2}>
                Sell, Merge, withdrawals, and resolved-winner shares each create a `PendingPayout` row here.
                Use Mark Paid only for payouts already settled out-of-band.
            </Text>
            <Text fontSize="xs" color="amber.300" mb={3}>
                Settlement runs in the accounts backend (bond and model-prize into the in-app balance,
                withdrawals after identity verification). To force-settle a stuck row, copy its contract
                id and use the backend&apos;s admin API: POST /api/v1/admin/payouts/:cid/settle.
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
                            <Th color="white">Contract id</Th>
                            <Th color="white">CC tx hash</Th>
                            <Th color="white"></Th>
                        </Tr>
                    </Thead>
                    <Tbody>
                        {rows.map((r) => (
                            <Tr color="#CCCCFF" key={r.contractId}>
                                <Td fontSize="xs" fontFamily="mono" title={r.user}>{truncate(r.user)}</Td>
                                <Td>{r.marketId === 0 ? "—" : `#${r.marketId}`}</Td>
                                <Td>{r.reason}</Td>
                                <Td isNumeric>{r.amountCC.toFixed(4)} CC</Td>
                                <Td fontSize="xs" fontFamily="mono" whiteSpace="nowrap" title={r.contractId}>
                                    {truncate(r.contractId, 6, 4)}
                                    <Button
                                        size="xs"
                                        variant="ghost"
                                        colorScheme="gray"
                                        ml={1}
                                        onClick={() => void copyCid(r.contractId)}
                                        aria-label="Copy contract id"
                                    >
                                        {copied === r.contractId ? "Copied" : "Copy"}
                                    </Button>
                                </Td>
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
                                        variant="outline"
                                        colorScheme="gray"
                                        onClick={() => markPaid(r.contractId)}
                                        isDisabled={
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
