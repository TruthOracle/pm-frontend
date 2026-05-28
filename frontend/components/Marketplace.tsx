import { useCantonWallet } from "@/wallets";
import { Grid, Tabs, TabList, Tab, TabPanels, TabPanel, Box, Spinner, Center, Text } from "@chakra-ui/react";
import { useEffect, useState, useCallback } from "react";
import {
  fetchAllPredictionMarkets,
  fetchAllResolvedMarkets,
  type PredictionMarketRecord,
  type ResolvedMarketRecord,
} from "@/utils/activeContracts";
import MarketCard from "./MarketCard";


const Marketplace = () => {
  const { account } = useCantonWallet();
  const [active, setActive] = useState<PredictionMarketRecord[]>([]);
  const [resolved, setResolved] = useState<ResolvedMarketRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchMarkets = useCallback(async () => {
    setLoading(true);
    try {
      // Both queries hit the participant in parallel; each one already swallows its own
      // error and returns []. So no try/catch needed around Promise.all.
      const [act, res] = await Promise.all([fetchAllPredictionMarkets(), fetchAllResolvedMarkets()]);
      setActive(act);
      setResolved(res);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMarkets();
  }, [fetchMarkets, account]);

  // Allow other parts of the app (e.g. AdminForm) to refresh after creating a market.
  useEffect(() => {
    (window as { refreshMarketplace?: () => void }).refreshMarketplace = fetchMarkets;
    return () => {
      delete (window as { refreshMarketplace?: () => void }).refreshMarketplace;
    };
  }, [fetchMarkets]);

  const gridTemplate = {
    base: "repeat(2, 1fr)",
    sm: "repeat(2, 1fr)",
    md: "repeat(3, 1fr)",
    lg: "repeat(3, 1fr)",
  };

  return (
    <Box p={6} className="font-jbm">
      <Tabs variant="soft-rounded" colorScheme="blue" align="center" mb={6}>
        <TabList>
          <Tab color="white">Active Markets ({active.length})</Tab>
          <Tab color="white">Expired Markets ({resolved.length})</Tab>
        </TabList>
        <TabPanels>
          <TabPanel>
            {loading ? (
              <Center minH="200px">
                <Spinner size="xl" color="#CCCCFF" />
              </Center>
            ) : active.length === 0 ? (
              <Center minH="200px">
                <Text color="gray.400">No active markets yet.</Text>
              </Center>
            ) : (
              <Grid templateColumns={gridTemplate} gap={8} alignItems={"center"}>
                {active.map((m) => (
                  <MarketCard
                    key={m.contractId}
                    id={m.marketId}
                    question={m.question}
                    imageUrl={m.imageUrl}
                    status={0}
                  />
                ))}
              </Grid>
            )}
          </TabPanel>
          <TabPanel>
            {loading ? (
              <Center minH="200px">
                <Spinner size="xl" color="#CCCCFF" />
              </Center>
            ) : resolved.length === 0 ? (
              <Center minH="200px">
                <Text color="gray.400">No resolved markets yet.</Text>
              </Center>
            ) : (
              <Grid templateColumns={gridTemplate} gap={8} alignItems={"center"}>
                {resolved.map((m) => (
                  <MarketCard
                    key={m.contractId}
                    id={m.marketId}
                    question={m.question}
                    imageUrl=""
                    status={1}
                    result={m.result}
                  />
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
