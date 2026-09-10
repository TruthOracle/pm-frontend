import { useState } from "react";
import { useCantonWallet } from "@/wallets";
import Activity from "./Portfolio/Activity";
import PendingPayouts from "./Portfolio/PendingPayouts";
import InAppWalletCard from "./InAppWalletCard";
import { Briefcase } from "lucide-react";

function Portfolio() {
  useCantonWallet();
  // A refund or settlement in the payouts table changes the in-app balance shown
  // above it; bumping the key makes the (self-fetching) card re-read the ledger.
  const [walletVersion, setWalletVersion] = useState(0);

  return (
    <div className="page-container py-10 sm:py-14">
      <div className="mb-8">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1 text-xs font-semibold text-primary">
          <Briefcase className="h-3.5 w-3.5" />
          Trading dashboard
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl">Portfolio</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
          Your positions, pending payouts, and trading activity.
        </p>
      </div>
      <div className="space-y-6">
        <InAppWalletCard reloadKey={walletVersion} />
        <PendingPayouts onChanged={() => setWalletVersion((v) => v + 1)} />
        <Activity />
      </div>
    </div>
  );
}

export default Portfolio;
