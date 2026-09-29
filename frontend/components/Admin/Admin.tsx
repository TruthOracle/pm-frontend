import { Box, Center } from "@chakra-ui/react";
import PayoutQueue from "./PayoutQueue";
import CatalogPanel from "./CatalogPanel";

type Props = {};

/**
 * The operator console. Markets are created only through the catalog console's treasury-signed
 * factory (truthoracle-backend `POST /admin/markets`, docs/MARKETS.md §4); the payout queue
 * below it still runs on the older `to_admin` relay session (ADMIN_AUTH.md "Known gaps").
 */
function Admin({}: Props) {
  return (
    // Modest top padding: AdminGate renders the operator-session bar directly above,
    // so a tall pad here reads as a hole between the bar and the page title.
    <Box width={"100%"} pt={6} px={[4, 8, 20]} pb={20}>
      <Center>
        <h1 className="font-jbm font-bold text-2xl text-slate-950">Operator console</h1>
      </Center>
      {/* Series → events → markets, the treasury-signed market factory and the trading halt
          live in the accounts backend (truthoracle-backend docs/MARKETS.md). */}
      <Box mt={8}>
        <CatalogPanel />
      </Box>
      <PayoutQueue />
    </Box>
  );
}

export default Admin;
