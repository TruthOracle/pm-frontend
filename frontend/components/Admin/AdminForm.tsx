import {
    Button,
    Center,
    Input,
    useToast,
    Text,
    Textarea,
    Select,
    Switch,
    FormLabel,
    Flex,
    Box,
} from "@chakra-ui/react";
import React, { useState, useEffect } from "react";
import { useCantonWallet } from "@/wallets";
import { buildInitMarketParams, type ResolutionPolicyArg } from "@/utils/cantonCommands";
import { fetchMarketCounterContractId } from "@/utils/activeContracts";
import { enterpriseWalletPartyId, submitAdminTransaction } from "@/lib/enterpriseWalletSubmit";
import { optimalReserves, liquidityFromValue } from "@/lib/marketPricing";

type Props = {};

const CATEGORIES = ["Sports", "Politics", "Crypto", "Finance", "Science", "Entertainment", "Other"];

function AdminForm({}: Props) {
    const { account, signAndSubmitTransaction } = useCantonWallet();
    const [marketCounterCid, setMarketCounterCid] = useState<string | null>(null);
    const [loadingCid, setLoadingCid] = useState(true);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (!account?.address) {
            setMarketCounterCid(null);
            setLoadingCid(false);
            return;
        }
        setLoadingCid(true);
        fetchMarketCounterContractId()
            .then(setMarketCounterCid)
            .finally(() => setLoadingCid(false));
    }, [account?.address]);

    const [formData, setFormData] = useState({
        question: "",
        imageURL: "",
        description: "",
        resolutionDescription: "",
        category: "Sports",
        expiresAtLocal: "", // datetime-local string
        gracePeriodHours: 24,
        liquidityPeriodMinutes: 5, // pre-trading liquidity-collection window (default 5 min)
        isDynamic: true,
        initialProbability: 50, // percent
        initialValueCC: 100, // pool value V0 in CC
        feeBps: 30,
        prizeFeeShareBps: 2000,
        // Resolution policy
        operatorResolution: true,
        sources: "", // comma-separated URIs
        reporters: "", // comma-separated party ids
        quorum: 0,
        challengeHours: 0, // 0 disables T3
        bondCC: 0,
    });

    const handleInputChange = (
        event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
    ) => {
        const { name, value, type } = event.target;
        const checked = (event.target as HTMLInputElement).checked;
        setFormData((prev) => ({
            ...prev,
            [name]: type === "checkbox" ? checked : type === "number" ? Number(value) : value,
        }));
    };

    const p0 = Math.min(0.99, Math.max(0.01, formData.initialProbability / 100));
    const seedCost = (() => {
        try {
            const l0 = liquidityFromValue(formData.initialValueCC, p0);
            const { x, y } = optimalReserves(p0, l0);
            return Math.max(x, y);
        } catch {
            return 0;
        }
    })();

    const formValid =
        formData.question.trim() !== "" &&
        formData.description.trim() !== "" &&
        formData.resolutionDescription.trim() !== "" &&
        formData.expiresAtLocal !== "" &&
        formData.initialValueCC > 0 &&
        formData.initialProbability >= 1 &&
        formData.initialProbability <= 99;

    const toast = useToast();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!account) {
            console.error("Account not available");
            return;
        }
        const expiresAt = Math.floor(new Date(formData.expiresAtLocal).getTime() / 1000);
        if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) {
            toast({ title: "Expiry must be in the future", status: "warning", duration: 5000, isClosable: true });
            return;
        }

        const reporters = formData.reporters
            .split(",")
            .map((r) => r.trim())
            .filter(Boolean);
        if (formData.quorum > reporters.length) {
            toast({
                title: "Quorum exceeds reporter count",
                description: `Quorum ${formData.quorum} but only ${reporters.length} reporters listed.`,
                status: "warning",
                duration: 6000,
                isClosable: true,
            });
            return;
        }

        // Re-fetch MarketCounter contract ID immediately before submit to avoid CONTRACT_NOT_FOUND
        // (cached ID may be stale if the counter was re-created or archived).
        const freshCid = await fetchMarketCounterContractId();
        if (!freshCid) {
            toast({
                title: "Market counter not found",
                description:
                    "Connect to the participant where TruthOracle is deployed and ensure the admin has created the MarketCounter.",
                status: "warning",
                duration: 6000,
                isClosable: true,
            });
            setMarketCounterCid(null);
            return;
        }
        setMarketCounterCid(freshCid);

        const policy: ResolutionPolicyArg = {
            operatorResolution: formData.operatorResolution,
            sources: formData.sources.split(",").map((s) => s.trim()).filter(Boolean),
            sourceKeys: [], // T1 keys are pinned via operator tooling when the source can sign
            reporters,
            quorum: formData.quorum,
            challengeSecs: Math.round(formData.challengeHours * 3600),
            bondCC: formData.bondCC,
        };

        const adminParty = enterpriseWalletPartyId() || account.address;
        const params = buildInitMarketParams(
            adminParty,
            {
                question: formData.question,
                imageUrl: formData.imageURL,
                description: formData.description,
                resolutionDescription: formData.resolutionDescription,
                category: formData.category,
                expiresAt,
                gracePeriodSecs: Math.round(formData.gracePeriodHours * 3600),
                isDynamic: formData.isDynamic,
                liquidityPeriodSecs: formData.isDynamic
                    ? Math.max(0, Math.round(formData.liquidityPeriodMinutes * 60))
                    : 0,
                initialProbability: p0,
                initialValueCC: formData.initialValueCC,
                feeBps: formData.feeBps,
                prizeFeeShareBps: formData.prizeFeeShareBps,
                policy,
                auditObservers: [],
            },
            freshCid
        );
        setSubmitting(true);
        try {
            const committedTxn = await submitAdminTransaction(params, signAndSubmitTransaction);
            console.log(`Committed transaction: ${committedTxn.hash}`);
            (window as { refreshMarketplace?: () => void }).refreshMarketplace?.();
            toast({
                title: "Market Created",
                description: `pm-AMM seeded at ${formData.initialProbability}% with ${formData.initialValueCC} CC pool value (collateral cost ≈ ${seedCost.toFixed(2)} CC).`,
                status: "success",
                duration: 9000,
                isClosable: true,
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (
                message.includes("CONTRACT_NOT_FOUND") ||
                message.includes("Contract could not be found")
            ) {
                setMarketCounterCid(null);
                toast({
                    title: "Market counter not found",
                    description:
                        "The participant rejected the counter contract. Re-run `npm run create:contract` and try again.",
                    status: "warning",
                    duration: 8000,
                    isClosable: true,
                });
            } else {
                toast({
                    title: "Submission failed",
                    description: message,
                    status: "error",
                    duration: 6000,
                    isClosable: true,
                });
            }
            throw err;
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Center
            className="font-jbm"
            width={{ base: "100%", lg: "60%" }}
            bgColor={"white"}
            padding={"20px"}
            borderRadius={"10px"}
            boxShadow={"2xl"}
        >
            <form onSubmit={handleSubmit} style={{ width: "100%" }}>
                <label htmlFor="question">Question</label>
                <Input
                    required
                    type="text"
                    marginBottom="16px"
                    marginTop="2px"
                    name="question"
                    placeholder="e.g. Will Liverpool beat Brighton on 13 May?"
                    value={formData.question}
                    onChange={handleInputChange}
                />

                <label htmlFor="imageURL">Image URL (optional)</label>
                <Input
                    type="text"
                    marginBottom="16px"
                    marginTop="2px"
                    name="imageURL"
                    placeholder="Add Image URL"
                    value={formData.imageURL}
                    onChange={handleInputChange}
                />

                <label htmlFor="description">Description</label>
                <Input
                    required
                    type="text"
                    marginBottom="16px"
                    marginTop="2px"
                    name="description"
                    placeholder="Short description shown on the market card"
                    value={formData.description}
                    onChange={handleInputChange}
                />

                <label htmlFor="resolutionDescription">Resolution criteria</label>
                <Textarea
                    required
                    marginBottom="16px"
                    marginTop="2px"
                    name="resolutionDescription"
                    placeholder="How will this market resolve? Cite the authoritative source."
                    value={formData.resolutionDescription}
                    onChange={handleInputChange}
                />

                <Flex gap={4} marginBottom="16px">
                    <Box flex={1}>
                        <label htmlFor="category">Category</label>
                        <Select name="category" value={formData.category} onChange={handleInputChange} marginTop="2px">
                            {CATEGORIES.map((c) => (
                                <option key={c} value={c}>{c}</option>
                            ))}
                        </Select>
                    </Box>
                    <Box flex={1}>
                        <label htmlFor="expiresAtLocal">Expiry (trading stops)</label>
                        <Input
                            required
                            type="datetime-local"
                            name="expiresAtLocal"
                            marginTop="2px"
                            value={formData.expiresAtLocal}
                            onChange={handleInputChange}
                        />
                    </Box>
                </Flex>

                <Flex gap={4} marginBottom="16px">
                    <Box flex={1}>
                        <label htmlFor="initialProbability">Initial probability (%)</label>
                        <Input
                            required
                            type="number"
                            min={1}
                            max={99}
                            name="initialProbability"
                            marginTop="2px"
                            value={formData.initialProbability}
                            onChange={handleInputChange}
                        />
                    </Box>
                    <Box flex={1}>
                        <label htmlFor="initialValueCC">Initial pool value (CC)</label>
                        <Input
                            required
                            type="number"
                            min={1}
                            step="any"
                            name="initialValueCC"
                            marginTop="2px"
                            value={formData.initialValueCC}
                            onChange={handleInputChange}
                        />
                    </Box>
                    <Box flex={1}>
                        <label htmlFor="feeBps">Fee (bps)</label>
                        <Input
                            required
                            type="number"
                            min={0}
                            max={1000}
                            name="feeBps"
                            marginTop="2px"
                            value={formData.feeBps}
                            onChange={handleInputChange}
                        />
                    </Box>
                </Flex>

                <Flex gap={4} alignItems="center" marginBottom="16px">
                    <FormLabel htmlFor="isDynamic" mb={0} fontSize="sm">
                        Dynamic pm-AMM (liquidity decays √(T−t), uniform LVR)
                    </FormLabel>
                    <Switch
                        id="isDynamic"
                        name="isDynamic"
                        isChecked={formData.isDynamic}
                        onChange={(e) =>
                            setFormData((prev) => ({ ...prev, isDynamic: e.target.checked }))
                        }
                    />
                    {formData.isDynamic && (
                        <Box flex={1}>
                            <label htmlFor="liquidityPeriodMinutes">Liquidity period (min)</label>
                            <Input
                                type="number"
                                min={0}
                                step="any"
                                name="liquidityPeriodMinutes"
                                marginTop="2px"
                                value={formData.liquidityPeriodMinutes}
                                onChange={handleInputChange}
                            />
                        </Box>
                    )}
                </Flex>

                <Text fontWeight="bold" fontSize="sm" mb={2}>
                    Resolution policy (immutable after creation)
                </Text>

                <Flex gap={4} alignItems="center" marginBottom="12px">
                    <FormLabel htmlFor="operatorResolution" mb={0} fontSize="sm">
                        T0 — operator resolution enabled
                    </FormLabel>
                    <Switch
                        id="operatorResolution"
                        isChecked={formData.operatorResolution}
                        onChange={(e) =>
                            setFormData((prev) => ({ ...prev, operatorResolution: e.target.checked }))
                        }
                    />
                </Flex>

                <label htmlFor="sources">Allowlisted source URIs (comma-separated)</label>
                <Input
                    type="text"
                    marginBottom="12px"
                    marginTop="2px"
                    name="sources"
                    placeholder="https://api.opta.example/result, https://backup.example/score"
                    value={formData.sources}
                    onChange={handleInputChange}
                />

                <label htmlFor="reporters">T2 reporter party ids (comma-separated)</label>
                <Input
                    type="text"
                    marginBottom="12px"
                    marginTop="2px"
                    name="reporters"
                    placeholder="reporter1::1220…, reporter2::1220…"
                    value={formData.reporters}
                    onChange={handleInputChange}
                />

                <Flex gap={4} marginBottom="16px">
                    <Box flex={1}>
                        <label htmlFor="quorum">T2 quorum (M-of-N)</label>
                        <Input
                            type="number"
                            min={0}
                            name="quorum"
                            marginTop="2px"
                            value={formData.quorum}
                            onChange={handleInputChange}
                        />
                    </Box>
                    <Box flex={1}>
                        <label htmlFor="challengeHours">T3 challenge window (hours, 0 = off)</label>
                        <Input
                            type="number"
                            min={0}
                            step="any"
                            name="challengeHours"
                            marginTop="2px"
                            value={formData.challengeHours}
                            onChange={handleInputChange}
                        />
                    </Box>
                    <Box flex={1}>
                        <label htmlFor="bondCC">T3 bond (CC)</label>
                        <Input
                            type="number"
                            min={0}
                            step="any"
                            name="bondCC"
                            marginTop="2px"
                            value={formData.bondCC}
                            onChange={handleInputChange}
                        />
                    </Box>
                </Flex>

                <Text fontSize="xs" color="gray.500" mb={3}>
                    Seeding at {formData.initialProbability}% with {formData.initialValueCC} CC pool
                    value costs ≈ {seedCost.toFixed(2)} CC of collateral (max of the optimal YES/NO
                    reserves). Every market is binary Yes / No; Void is a first-class outcome.
                </Text>

                {loadingCid && <Text color="gray.400" fontSize="sm">Loading contract...</Text>}
                {!loadingCid && !marketCounterCid && account && (
                    <Text color="orange.400" fontSize="sm" mb={2}>
                        Market counter not found on this participant. Deploy TruthOracle and create
                        the counter first.
                    </Text>
                )}
                <Button
                    type="submit"
                    colorScheme="green"
                    isDisabled={loadingCid || !formValid || submitting}
                    isLoading={submitting}
                >
                    Create pm-AMM Market
                </Button>
            </form>
        </Center>
    );
}

export default AdminForm;
