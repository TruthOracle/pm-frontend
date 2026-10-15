import { useCantonWallet } from "@/wallets";
// Internal components
import { LabelValueGrid, DisplayValue } from "@/components/LabelValueGrid";
import { formatMoney, instrumentForWalletId, useInstruments } from "@/lib/instruments";

/**
 * The connected external wallet's account: party, key, namespace and — when the wallet reports
 * them — its holdings per token, each labelled through the instrument catalog's
 * `walletInstrumentId` (the wallet says `Amulet`, the catalog says what that is called here).
 */
export function AccountInfo() {
  const { account } = useCantonWallet();
  const instruments = useInstruments().data;
  const holdings = (account?.holdings ?? []).map((h) => {
    const instrument = instrumentForWalletId(instruments, h.instrumentId) ?? { symbol: h.instrumentId, name: h.instrumentId, decimals: 10 };
    return formatMoney(h.balance, instrument, 2);
  });
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
            value: <DisplayValue value={account?.publicKey ?? "Not Present"} isCorrect={!!account?.publicKey} />,
          },
          {
            label: "Namespace",
            value: <p>{account?.namespace ?? "Not Present"}</p>,
          },
          {
            label: "Wallet balances",
            value: <p>{holdings.length > 0 ? holdings.join(" · ") : "Not Present"}</p>,
          },
        ]}
      />
    </div>
  );
}
