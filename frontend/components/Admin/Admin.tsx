import { Box, Center } from "@chakra-ui/react";
import PayoutQueue from "./PayoutQueue";
import CatalogPanel from "./CatalogPanel";
import InstrumentsPanel from "./InstrumentsPanel";
import TokensPanel from "./TokensPanel";
import RewardsPanel from "./RewardsPanel";
import { BackendOperatorProvider, OperatorSessionCard } from "./BackendOperatorSession";

type Props = {};

/**
 * The operator console. Everything that configures the exchange lives in the accounts backend
 * behind one operator session (BackendOperatorSession.tsx): the catalog and the treasury-signed
 * market factory (truthoracle-backend docs/MARKETS.md §4), the instrument registry, Cantor8's
 * token-app (mint / burn) and the rewards rules (docs/TOKENS.md §4). The payout queue below them
 * still runs on the older `to_admin` relay session (ADMIN_AUTH.md "Known gaps").
 */
function Admin({}: Props) {
  return (
    // Modest top padding: AdminGate renders the operator-session bar directly above,
    // so a tall pad here reads as a hole between the bar and the page title.
    <Box width={"100%"} pt={6} px={[4, 8, 20]} pb={20}>
      <Center>
        <h1 className="font-jbm font-bold text-2xl text-slate-950">Operator console</h1>
      </Center>
      <BackendOperatorProvider>
        <Box mt={8} className="space-y-6">
          <OperatorSessionCard />
          <CatalogPanel />
          <InstrumentsPanel />
          <TokensPanel />
          <RewardsPanel />
        </Box>
      </BackendOperatorProvider>
      <PayoutQueue />
    </Box>
  );
}

export default Admin;
