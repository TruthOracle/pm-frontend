import { useCantonWallet } from "@/wallets";
// Internal components
import { DisplayValue, LabelValueGrid } from "@/components/LabelValueGrid";

export function NetworkInfo() {
  const { network } = useCantonWallet();
  const baseUrl = network?.ledgerApi?.baseUrl;
  return (
    <div className="flex flex-col gap-6">
      <h4 className="text-lg font-medium">Network Info</h4>
      <LabelValueGrid
        items={[
          {
            label: "Network ID",
            value: <DisplayValue value={network?.networkId ?? "Not Present"} isCorrect={!!network} expected="Canton testnet" />,
          },
          {
            label: "Ledger API URL",
            value: baseUrl ? (
              <a href={baseUrl} target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-300">
                {baseUrl}
              </a>
            ) : (
              "Not Present"
            ),
          },
        ]}
      />
    </div>
  );
}
