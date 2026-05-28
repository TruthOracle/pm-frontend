import { Button, Center, Input, useToast, Text, Textarea } from "@chakra-ui/react";
import React, { useState, useEffect } from "react";
import { useCantonWallet } from "@/wallets";
import { buildInitMarketParams } from "@/utils/cantonCommands";
import { fetchMarketCounterContractId } from "@/utils/activeContracts";
import { enterpriseWalletPartyId, submitAdminTransaction } from "@/lib/enterpriseWalletSubmit";

type Props = {};

function AdminForm({}: Props) {
    const { account, signAndSubmitTransaction } = useCantonWallet();
    const [marketCounterCid, setMarketCounterCid] = useState<string | null>(null);
    const [loadingCid, setLoadingCid] = useState(true);

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
        liquidityParameter: 100,
    });

    const handleInputChange = (
        event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
    ) => {
        const { name, value } = event.target;
        setFormData((prev) => ({ ...prev, [name]: value }));
    };

    const formValid =
        formData.question.trim() !== "" &&
        formData.imageURL.trim() !== "" &&
        formData.description.trim() !== "" &&
        formData.resolutionDescription.trim() !== "";

    const toast = useToast();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!account) {
            console.error("Account not available");
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

        const adminParty = enterpriseWalletPartyId() || account.address;
        const params = buildInitMarketParams(
            adminParty,
            formData.question,
            formData.imageURL,
            formData.description,
            formData.resolutionDescription,
            formData.liquidityParameter,
            freshCid
        );
        try {
            const committedTxn = await submitAdminTransaction(params, signAndSubmitTransaction);
            console.log(`Committed transaction: ${committedTxn.hash}`);
            (window as { refreshMarketplace?: () => void }).refreshMarketplace?.();
            toast({
                title: "Market Created",
                description:
                    "Yes/No market created on ledger. Check Marketplace if the card does not appear yet.",
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
        }
    };

    return (
        <Center
            className="font-jbm"
            width={"50%"}
            bgColor={"white"}
            padding={"20px"}
            borderRadius={"10px"}
            boxShadow={"2xl"}
        >
            <form onSubmit={handleSubmit}>
                <label htmlFor="question">Question</label>
                <Input
                    required
                    type="text"
                    marginBottom="20px"
                    marginTop="2px"
                    name="question"
                    placeholder="e.g. Will Bitcoin close above $100k on Dec 31?"
                    value={formData.question}
                    onChange={handleInputChange}
                />

                <label htmlFor="imageURL">Image URL</label>
                <Input
                    required
                    type="text"
                    marginBottom="20px"
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
                    marginBottom="20px"
                    marginTop="2px"
                    name="description"
                    placeholder="Short description shown on the market card"
                    value={formData.description}
                    onChange={handleInputChange}
                />

                <label htmlFor="resolutionDescription">Resolution criteria</label>
                <Textarea
                    required
                    marginBottom="20px"
                    marginTop="2px"
                    name="resolutionDescription"
                    placeholder="How will this market resolve? Cite the authoritative source."
                    value={formData.resolutionDescription}
                    onChange={handleInputChange}
                />

                <Text fontSize="xs" color="gray.500" mb={3}>
                    Every market is binary Yes / No — no per-market option labels.
                </Text>

                {loadingCid && <Text color="gray.400" fontSize="sm">Loading contract...</Text>}
                {!loadingCid && !marketCounterCid && account && (
                    <Text color="orange.400" fontSize="sm" mb={2}>
                        Market counter not found on this participant. Deploy TruthOracle and create
                        the counter first.
                    </Text>
                )}
                <Button type="submit" colorScheme="green" isDisabled={loadingCid || !formValid}>
                    Create Yes/No Market
                </Button>
            </form>
        </Center>
    );
}

export default AdminForm;
