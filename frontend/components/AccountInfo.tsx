import { useCantonWallet } from "@/wallets";
// Internal components
import { LabelValueGrid, DisplayValue } from "@/components/LabelValueGrid";

export function AccountInfo() {
  const { account } = useCantonWallet();
  return (
    <div className="flex flex-col gap-6">
      <h4 className="text-lg font-medium">Account Info</h4>
      <LabelValueGrid
        items={[
          {
            label: "Address",
            value: <DisplayValue value={account?.address ?? "Not Present"} isCorrect={!!account?.address} />,
          },
          {
            label: "Public key",
            value: (
              <DisplayValue value={account?.publicKey ?? "Not Present"} isCorrect={!!account?.publicKey} />
            ),
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
