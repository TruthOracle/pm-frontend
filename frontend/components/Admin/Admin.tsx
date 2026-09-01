import { Box, Center } from "@chakra-ui/react";
import AdminForm from "./AdminForm";
import PayoutQueue from "./PayoutQueue";

type Props = {};

function Admin({}: Props) {
  return (
    // Modest top padding: AdminGate renders the operator-session bar directly above,
    // so a tall pad here reads as a hole between the bar and the page title.
    <Box width={"100%"} pt={6} px={20} pb={20}>
      <Center>
        <h1 className="font-jbm font-bold text-2xl text-slate-950">
          Build your own Prediction Market
        </h1>
      </Center>
      <Center mt={8}>
        <AdminForm />
      </Center>
      <PayoutQueue />
    </Box>
  );
}

export default Admin
