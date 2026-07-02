import { useCantonWallet } from "@/wallets";
import Activity from "./Portfolio/Activity";
import PendingPayouts from "./Portfolio/PendingPayouts";
import { Briefcase } from "lucide-react";

function Portfolio() {
  useCantonWallet();

  return (
    <div className="page-container py-8">
      <div className="mb-8">
        <div className="mb-1 flex items-center gap-2">
          <Briefcase className="h-5 w-5 text-primary" />
          <h1 className="section-title">Portfolio</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Your positions, pending payouts, and trading activity.
        </p>
      </div>
      <div className="space-y-6">
        <PendingPayouts />
        <Activity />
      </div>
    </div>
  );
}

export default Portfolio;
