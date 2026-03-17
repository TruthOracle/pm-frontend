import { useCantonWallet } from "@/wallets";
import { buildClaimAllRewardsParams, buildClaimAllRewardsParamsNoArgs } from "@/utils/cantonCommands";
import { fetchUserRewardsSummaryContractId } from "@/utils/activeContracts";
import { Box, Button, Heading, Text, VStack, useToast, HStack, Spinner, IconButton } from "@chakra-ui/react";
import { RepeatIcon } from "@chakra-ui/icons";
import { useEffect, useState } from "react";
import { getUserRewards, getRewardMarkets, getClaimedMarkets } from "../../blockend/cantonService";

const Rewards = () => {
    const { account, signAndSubmitTransaction } = useCantonWallet();
    const [rewards, setRewards] = useState<{ pending: number; total: number }>({ pending: 0, total: 0 });
    const [rewardMarkets, setRewardMarkets] = useState<number[]>([]);
    const [claimedMarkets, setClaimedMarkets] = useState<number[]>([]);
    const [loading, setLoading] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [initialLoading, setInitialLoading] = useState(true);
    const toast = useToast();

    const fetchRewardsAndClaims = async () => {
        if (account?.address) {
            try {
                const result = await getUserRewards(account.address);
                const [pending, total] = result;
                console.log({
                    result,
                    pending,
                    total
                });
                setRewards({
                    pending: Number(pending) / 1e8, // Convert from base units to Canton Coin
                    total: Number(total) / 1e8
                });
                const rewardMarkets = await getRewardMarkets(account.address);
                const claimedMarkets = await getClaimedMarkets(account.address);
                const claimedMarketIds = claimedMarkets[0].map((id: any) => Number(id));
                setClaimedMarkets(claimedMarketIds);
                
                // Filter out claimed markets from eligible markets
                const eligibleMarketIds = rewardMarkets[0].map((id: any) => Number(id));
                const unclaimedMarkets = eligibleMarketIds.filter((id: number) => !claimedMarketIds.includes(id));
                setRewardMarkets(unclaimedMarkets);
            } catch (error) {
                console.error("Error fetching rewards markets:", error);
                toast({
                    title: "Error",
                    description: "Failed to fetch rewards data. Please try again.",
                    status: "error",
                    duration: 3000,
                    isClosable: true,
                });
            }
        }
        setInitialLoading(false);
        setRefreshing(false);
    };

    useEffect(() => {
        fetchRewardsAndClaims();
        // eslint-disable-next-line
    }, [account]);

    const handleClaimAllRewards = async () => {
        if (!account) {
            toast({
                title: "Error",
                description: "Please connect your Canton wallet first",
                status: "error",
                duration: 3000,
                isClosable: true,
            });
            return;
        }
        setLoading(true);
        try {
            const summaryCid = await fetchUserRewardsSummaryContractId(account.address);
            const claimArgs = rewardMarkets.length > 0
                ? rewardMarkets.slice(0, 10).map((marketId) => ({ marketId, rewardType: "EarlyParticipant" as const, amount: 5000000 }))
                : [];
            const params = summaryCid && claimArgs.length > 0
                ? buildClaimAllRewardsParams(account.address, summaryCid, claimArgs)
                : buildClaimAllRewardsParamsNoArgs(account.address);
            const result = await signAndSubmitTransaction(params);
            void result.hash; // Canton commandId

            toast({
                title: "Success",
                description: "All available rewards claimed successfully!",
                status: "success",
                duration: 3000,
                isClosable: true,
            });
            await fetchRewardsAndClaims();
        } catch (error) {
            console.error("Error claiming all rewards:", error);
            toast({
                title: "Error",
                description: "Failed to claim rewards. Please try again.",
                status: "error",
                duration: 3000,
                isClosable: true,
            });
        }
        setLoading(false);
    };

    const handleRefresh = async () => {
        setRefreshing(true);
        await fetchRewardsAndClaims();
    };

    if (initialLoading) {
        return (
            <Box maxW="600px" mx="auto" w="100%" p={6} textAlign="center">
                <Spinner size="xl" color="blue.500" />
                <Text color="white" fontSize="xl" mt={4}>Loading rewards data...</Text>
            </Box>
        );
    }

    return (
        <div style={{ maxHeight: "100vh", paddingTop: "60px" }} className="font-jbm">
            <Box maxW="600px" mx="auto" w="100%" p={6}>
                <VStack spacing={4} align="stretch">
                    <HStack justify="space-between" align="center">
                        <Heading size="lg" color="white">Your Rewards</Heading>
                        <IconButton
                            aria-label="Refresh rewards"
                            icon={<RepeatIcon />}
                            onClick={handleRefresh}
                            isLoading={refreshing}
                            colorScheme="blue"
                            variant="ghost"
                        />
                    </HStack>

                    {/* Rewards Available to be Claimed Section */}
                    <Box p={4} borderWidth={1} borderRadius="lg" bg="#23292B">
                        <Heading size="md" color="white" mb={3}>Available Rewards</Heading>
                        <VStack align="stretch" spacing={2}>
                            <HStack justify="space-between">
                                <Text color="#E0E0E0">Pending Rewards:</Text>
                                <Text fontSize="xl" fontWeight="bold" color="white">
                                    {rewards.pending.toFixed(2)} Canton Coin
                                </Text>
                            </HStack>
                            <HStack justify="space-between">
                                <Text color="#E0E0E0">Total Claimed Rewards:</Text>
                                <Text fontSize="lg" color="white">
                                    {rewards.total.toFixed(2)} Canton Coin
                                </Text>
                            </HStack>
                        </VStack>
                    </Box>

                    <Button
                        colorScheme="blue"
                        onClick={handleClaimAllRewards}
                        isDisabled={rewards.pending === 0 || loading}
                        isLoading={loading}
                        size="lg"
                    >
                        {rewards.pending === 0 ? "No Rewards to Claim" : "Claim All Rewards"}
                    </Button>

                    {/* Pending Reward Markets Section */}
                    <Box p={4} borderWidth={1} borderRadius="lg" bg="#23292B">
                        <Heading size="md" color="white" mb={3}>Eligible Reward Markets</Heading>
                        {rewardMarkets.length === 0 ? (
                            <Text color="#E0E0E0">You have no eligible markets for rewards at the moment.</Text>
                        ) : (
                            <VStack align="stretch" spacing={2}>
                                <Text color="#E0E0E0">
                                  You are eligible for rewards in {rewardMarkets.length} {rewardMarkets.length === 1 ? "market" : "markets"}:
                                </Text>
                                <Box 
                                    p={2} 
                                    bg="#1A1F21" 
                                    borderRadius="md" 
                                    maxH="150px" 
                                    overflowY="auto"
                                >
                                    <Text color="#E0E0E0" fontSize="sm">
                                        Market IDs: {rewardMarkets.join(", ")}
                                    </Text>
                                </Box>
                            </VStack>
                        )}
                    </Box>

                    {/* Claimed Reward Markets Section */}
                    <Box p={4} borderWidth={1} borderRadius="lg" bg="#23292B">
                        <Heading size="md" color="white" mb={3}>Claimed Reward Markets</Heading>
                        {claimedMarkets.length === 0 ? (
                            <Text color="#E0E0E0">You have not claimed any rewards yet.</Text>
                        ) : (
                            <VStack align="stretch" spacing={2}>
                                <Text color="#E0E0E0">
                                  You have already claimed rewards from {claimedMarkets.length} {claimedMarkets.length === 1 ? "market" : "markets"}:
                                </Text>
                                <Box 
                                    p={2} 
                                    bg="#1A1F21" 
                                    borderRadius="md" 
                                    maxH="150px" 
                                    overflowY="auto"
                                >
                                    <Text color="#E0E0E0" fontSize="sm">
                                        Market IDs: {claimedMarkets.join(", ")}
                                    </Text>
                                </Box>
                            </VStack>
                        )}
                    </Box>

                    {/* How to Earn Section */}
                    <Box p={4} borderWidth={1} borderRadius="lg" bg="#23292B">
                        <Heading size="md" mb={3} color="white">How to Earn Rewards</Heading>
                        <VStack align="stretch" spacing={3}>
                            <Box p={2} bg="#1A1F21" borderRadius="md">
                                <Text color="#E0E0E0" fontWeight="bold">Early Participant Bonus</Text>
                                <Text color="#E0E0E0" fontSize="sm">Earn 0.05 Canton Coin for early market participation (≥ 1 Canton Coin investment)</Text>
                            </Box>
                            <Box p={2} bg="#1A1F21" borderRadius="md">
                                <Text color="#E0E0E0" fontWeight="bold">Market Creator Reward</Text>
                                <Text color="#E0E0E0" fontSize="sm">Earn 0.1 Canton Coin for creating a new market</Text>
                            </Box>
                            <Box p={2} bg="#1A1F21" borderRadius="md">
                                <Text color="#E0E0E0" fontWeight="bold">Winning Prediction Bonus</Text>
                                <Text color="#E0E0E0" fontSize="sm">Earn 0.2 Canton Coin for correct predictions</Text>
                            </Box>
                        </VStack>
                    </Box>
                </VStack>
            </Box>
        </div>
    );
};

export default Rewards; 