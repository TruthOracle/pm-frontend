import { Box, Center } from "@chakra-ui/react";
import AdminForm from "./AdminForm";
import PayoutQueue from "./PayoutQueue";

type Props = {};

function Admin({}: Props) {
  return (
    <Box width={"100%"} pt={20} px={20} pb={20}>
      <Center>
        <h1 className="font-jbm text-white font-bold text-2xl">
          Build your own Prediction Market
        </h1>
      </Center>
      <Center mt={10}>
        <AdminForm />
      </Center>
      <PayoutQueue />
    </Box>
  );
}

export default Admin