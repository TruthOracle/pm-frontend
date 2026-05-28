import { Center, Stack } from "@chakra-ui/react";
import { useCantonWallet } from "@/wallets";
import Activity from "./Portfolio/Activity";
import PendingPayouts from "./Portfolio/PendingPayouts";

function Portfolio() {
  useCantonWallet();

  return (
    <Stack minHeight={"100vh"} width={"100%"} px={10} color={"white"}>
      <PendingPayouts />
      <Center>
        <Activity />
      </Center>
    </Stack>
  );
}

export default Portfolio;
