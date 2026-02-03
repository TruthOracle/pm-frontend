//import { useParams } from 'react-router-dom';
import BetBuyCard from './BetBuyCard';
import {Flex} from '@chakra-ui/react';

const BetDetails = () => {
  //const { id } = useParams<{ id: string }>();

  return (
    <>
    <Flex p={5} width={"100%"} color={"white"} justifyContent={"space-between"}>      
          <BetBuyCard/>
    </Flex>
  </>
     
      
  );
};

export default BetDetails;

