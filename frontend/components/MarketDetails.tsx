import MarketView from './MarketView';
import { Flex } from '@chakra-ui/react';

const MarketDetails = () => {
  return (
    <Flex p={5} width={"100%"} color={"white"} justifyContent={"space-between"}>
      <MarketView />
    </Flex>
  );
};

export default MarketDetails;
