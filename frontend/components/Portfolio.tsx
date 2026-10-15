/**
 * /portfolio — the connected party's in-app balances (one row per instrument), position summary,
 * pending payouts and trading activity. The positions are read once here (every Position joined
 * with its market, from the participant) and shared by the Summary and the Activity table so the
 * two never disagree; a refund or settlement in the payouts table bumps the wallet card.
 */
import { useCallback, useEffect, useState } from "react";
import { Briefcase } from "lucide-react";
import { useCantonWallet } from "@/wallets";
import { fetchAllPredictionMarkets, fetchAllUserPositions } from "@/utils/activeContracts";
import Activity from "./Portfolio/Activity";
import PendingPayouts from "./Portfolio/PendingPayouts";
import Summary from "./Portfolio/Summary";
import InAppWalletCard from "./InAppWalletCard";
import { buildRows, type ActivityRow } from "./Portfolio/portfolioRows";

function Portfolio() {
  const { account } = useCantonWallet();
  // A refund or settlement in the payouts table changes the in-app balance shown
  // above it; bumping the key makes the (self-fetching) card re-read the ledger.
  const [walletVersion, setWalletVersion] = useState(0);
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!account?.address) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      const [positions, markets] = await Promise.all([fetchAllUserPositions(account.address), fetchAllPredictionMarkets()]);
      setRows(buildRows(positions, markets));
    } finally {
      setLoading(false);
    }
  }, [account?.address]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="page-container py-10 sm:py-14">
      <div className="mb-8">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1 text-xs font-semibold text-primary">
          <Briefcase className="h-3.5 w-3.5" />
          Trading dashboard
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl">Portfolio</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">Your in-app balances, positions, pending payouts, and trading activity.</p>
      </div>
      <div className="space-y-6">
        <InAppWalletCard reloadKey={walletVersion} />
        {account && <Summary rows={rows} loading={loading} />}
        <PendingPayouts onChanged={() => setWalletVersion((v) => v + 1)} />
        <Activity rows={rows} loading={loading} refresh={refresh} />
      </div>
    </div>
  );
}

export default Portfolio;
