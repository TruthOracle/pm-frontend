import {Button, Center, Input, useToast, Text} from '@chakra-ui/react'
import React, {useState, useEffect} from 'react'
// @ts-ignore
import { getMarketCount, getMarketMetadata} from "../../../blockend/cantonService";
import { useCantonWallet } from "@/contexts/CantonWalletContext";
import { buildInitMarketParams } from "@/utils/cantonCommands";
import { fetchMarketCounterContractId } from "@/utils/activeContracts";

type Props = {}

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
        fetchMarketCounterContractId(account.address)
            .then(setMarketCounterCid)
            .finally(() => setLoadingCid(false));
    }, [account?.address]);

    const [formData, setFormData] = useState({
		question: "",
        imageURL:"",
        description:"",
        firstShareOption:"",
        secondShareOption:"",
        liquidityParameter:100
	})


    const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
		const { name, value } = event.target
		setFormData((prevFormData) => ({
			...prevFormData,
			[name]: value,
		}))

	}

    const formValid =
        formData.question.trim() !== "" &&
        formData.imageURL.trim() !== "" &&
        formData.description.trim() !== "" &&
        formData.firstShareOption.trim() !== "" &&
        formData.secondShareOption.trim() !== "";

    const toast = useToast()



    const handleSubmit = async (e: any) => {
        e.preventDefault();

        if (!account) {
            console.error("Account not available");
            return;
        }
        // Re-fetch MarketCounter contract ID immediately before submit to avoid CONTRACT_NOT_FOUND
        // (cached ID may be stale if the counter was re-created or the contract was archived).
        const freshCid = await fetchMarketCounterContractId(account.address);
        if (!freshCid) {
            toast({
                title: "Market counter not found",
                description: "Connect to the participant where TruthOracle is deployed and ensure the admin has created the MarketCounter.",
                status: "warning",
                duration: 6000,
                isClosable: true,
            });
            setMarketCounterCid(null);
            return;
        }
        setMarketCounterCid(freshCid);

        const params = buildInitMarketParams(
            account.address,
            formData.question,
            formData.imageURL,
            formData.description,
            formData.firstShareOption,
            formData.secondShareOption,
            formData.liquidityParameter,
            freshCid
        );
        try {
            const committedTxn = await signAndSubmitTransaction(params);
            console.log(`Committed transaction: ${committedTxn.hash}`);
            toast({
                title: "Market Created",
                description: "We've created the market successfully!",
                status: "success",
                duration: 9000,
                isClosable: true,
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (message.includes("CONTRACT_NOT_FOUND") || message.includes("Contract could not be found")) {
                setMarketCounterCid(null);
                const partyHint = account?.address
                    ? ` Use the create-market-counter script with ADMIN_PARTY_ID="${account.address}" so this participant has a counter for your wallet.`
                    : "";
                toast({
                    title: "Market counter not found",
                    description: `The participant rejected the counter contract.${partyHint} Then try again.`,
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
    }

  return (
    <>
    <Center className="font-jbm" width={"50%"} bgColor={"white"} padding={"20px"} borderRadius={"10px"} boxShadow={"2xl"}>
    <form onSubmit={handleSubmit}>
									
        <label htmlFor="question">Question</label>
		<Input
			required
			type="text"
			marginBottom="20px"
			marginTop="2px"
			name="question"
			placeholder="Prediction Question"
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
			placeholder="Add Description"
			value={formData.description}
			onChange={handleInputChange}
		/>

		<label htmlFor="firstShareOption">Prediction Option - 1</label>
		<Input
			type="text"
			marginBottom="25px"
			marginTop="2px"
			placeholder="Prediction Option"
			name="firstShareOption"
			value={formData.firstShareOption}
			onChange={handleInputChange}
			required={true}
		/>

   
        <label htmlFor="secondShareOption">Prediction Option - 2</label>
		<Input
			type="text"
			marginBottom="20px"
			marginTop="2px"
			placeholder="Prediction Option"
			name="secondShareOption"
			value={formData.secondShareOption}
			onChange={handleInputChange}
			required
		/>

    

        {/* <label htmlFor="liquidityParameter">Liquidity Parameter</label>
		<Input
			type="number"
			marginBottom="20px"
			marginTop="2px"
			placeholder="Liquidity Parameter"
			name="liquidityParameter"
			value={formData.liquidityParameter}
			onChange={handleInputChange}
		/> */}
		    {loadingCid && <Text color="gray.400" fontSize="sm">Loading contract...</Text>}
		    {!loadingCid && !marketCounterCid && account && (
		        <Text color="orange.400" fontSize="sm" mb={2}>Market counter not found on this participant. Deploy TruthOracle and create the counter first.</Text>
		    )}
		    <Button type="submit" colorScheme='green' isDisabled={loadingCid || !formValid}>Submit</Button>

			
        </form>
    </Center>

    </>
  )
}

export default AdminForm