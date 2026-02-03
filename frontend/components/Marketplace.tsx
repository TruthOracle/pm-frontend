import { useCantonWallet } from "@/contexts/CantonWalletContext";
import {Grid, Tabs, TabList, Tab, TabPanels, TabPanel, Box, Spinner, Center} from "@chakra-ui/react";
import {useEffect, useState, useCallback} from "react";
import {getMarketCount, getMarketMetadata} from "../../blockend/cantonService";
import BetCard from "./BetCard";

const Marketplace = () => {
    const { account } = useCantonWallet();
    const [activeBets, setActiveBets] = useState<any[]>([]);
    const [expiredBets, setExpiredBets] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchBets = useCallback(async () => {
        setLoading(true);
        setActiveBets([]); // Clear previous bets
        setExpiredBets([]); // Clear previous expired bets

        try {
            const marketCount = await getMarketCount(); // Get the market count
            const newActiveBets: any[] = []; // Array to collect active bets
            const newExpiredBets: any[] = []; // Array to collect expired bets

            for (let i = 0; i < marketCount; i++) {
                const marketMetadata: any = await getMarketMetadata(i); // Fetch market metadata
                console.log("i", i);

                if (marketMetadata.length > 0) {
                    if (marketMetadata[0].status === 0) { // Active market
                        if (i != 8 && i != 5) {
                            newActiveBets.push(marketMetadata[0]);
                        }
                    } else if (marketMetadata[0].status === 1) { // Expired market
                        newExpiredBets.push(marketMetadata[0]);
                    }
                }
            }

            setActiveBets(newActiveBets); // Update state with active bets
            setExpiredBets(newExpiredBets); // Update state with expired bets
            console.log("Active Bets:", newActiveBets);
            console.log("Expired Bets:", newExpiredBets);
        } catch (error) {
            console.error("Error fetching bets:", error);
        }
        setLoading(false);
    }, []);

    useEffect(() => {
        fetchBets();
    }, [fetchBets, account]);

    // Expose the refresh function to the window object
    useEffect(() => {
        (window as any).refreshMarketplace = fetchBets;
        return () => {
            delete (window as any).refreshMarketplace;
        };
    }, [fetchBets]);

    return (
        <Box p={6} className="font-jbm">
            <Tabs variant="soft-rounded" colorScheme="blue" align="center" mb={6}>
                <TabList>
                    <Tab color="white">Active Markets</Tab>
                    <Tab color="white">Expired Markets</Tab>
                </TabList>
                <TabPanels>
                    <TabPanel>
                        {loading ? (
                            <Center minH="200px"><Spinner size="xl" color="#CCCCFF" /></Center>
                        ) : (
                        <Grid
                            templateColumns={{
                                base: "repeat(2, 1fr)",
                                sm: "repeat(2, 1fr)",
                                md: "repeat(3, 1fr)",
                                lg: "repeat(3, 1fr)",
                            }}
                            gap={8}
                            alignItems={"center"}
                        >
                            {activeBets?.map((bet) => (
                                <div key={bet?.id} className="font-jbm">
                                    <BetCard {...bet} />
                                </div>
                            ))}
                        </Grid>
                        )}
                    </TabPanel>
                    <TabPanel>
                        {loading ? (
                            <Center minH="200px"><Spinner size="xl" color="#CCCCFF" /></Center>
                        ) : (
                        <Grid
                            templateColumns={{
                                base: "repeat(2, 1fr)",
                                sm: "repeat(2, 1fr)",
                                md: "repeat(3, 1fr)",
                                lg: "repeat(3, 1fr)",
                            }}
                            gap={8}
                            alignItems={"center"}
                        >
                            {expiredBets?.map((bet) => (
                                <div key={bet?.id} className="font-jbm">
                                    <BetCard {...bet} />
                                </div>
                            ))}
                        </Grid>
                        )}
                    </TabPanel>
                </TabPanels>
            </Tabs>
        </Box>
    );
};

export default Marketplace;
