import { useCantonWallet } from "@/contexts/CantonWalletContext";
// Internal components
import { LabelValueGrid } from "@/components/LabelValueGrid";

export function WalletDetails() {
  const { account } = useCantonWallet();
  return (
    <div className="flex flex-col gap-6">
      <h4 className="text-lg font-medium">Wallet Details</h4>
      <LabelValueGrid
        items={[
          {
            label: "Party ID",
            value: <p>{account?.address ?? "Not Present"}</p>,
          },
          {
            label: "Namespace",
            value: <p>{account?.namespace ?? "Not Present"}</p>,
          },
        ]}
      />
    </div>
  );
}
