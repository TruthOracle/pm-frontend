import { Box, Center } from "@chakra-ui/react";
import AdminForm from "./AdminForm";
import PayoutQueue from "./PayoutQueue";
import CatalogPanel from "./CatalogPanel";

type Props = {};

function Admin({}: Props) {
  return (
    // Modest top padding: AdminGate renders the operator-session bar directly above,
    // so a tall pad here reads as a hole between the bar and the page title.
    <Box width={"100%"} pt={6} px={[4, 8, 20]} pb={20}>
      <Center>
        <h1 className="font-jbm font-bold text-2xl text-slate-950">
          Build your own Prediction Market
        </h1>
      </Center>
      <Center mt={8}>
        <AdminForm />
      </Center>
      {/* Series → events → markets, the treasury-signed market factory and the trading halt
          live in the accounts backend (truthoracle-backend docs/MARKETS.md). */}
      <Box mt={10}>
        <CatalogPanel />
      </Box>
      <PayoutQueue />
    </Box>
  );
}

export default Admin
