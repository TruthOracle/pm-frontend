import { useEffect, useState } from "react";
import { useCantonWallet } from "@/wallets";
import { buildTransferParams } from "@/utils/cantonCommands";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getCantonCoinHoldings } from "@/view-functions/getAccountBalance";

export function TransferCanton() {
  const { account, signAndSubmitTransaction } = useCantonWallet();
  const queryClient = useQueryClient();

  const [cantonBalance, setCantonBalance] = useState<number>(0);
  const [recipient, setRecipient] = useState<string>();
  const [transferAmount, setTransferAmount] = useState<number>();

  const { data } = useQuery({
    queryKey: ["canton-coin-holdings", account?.address],
    refetchInterval: 10_000,
    queryFn: async () => {
      const holdings = await getCantonCoinHoldings();
      return { balance: holdings.balance };
    },
    enabled: !!account?.address,
  });

  const onClickButton = async () => {
    if (!account || !recipient || !transferAmount) {
      return;
    }

    try {
      const amountBase = Math.pow(10, 8) * transferAmount;
      const params = buildTransferParams(account.address, recipient, amountBase);
      const result = await signAndSubmitTransaction(params);
      queryClient.invalidateQueries();
      toast({
        title: "Success",
        description: `Transaction succeeded, commandId: ${result.hash}`,
      });
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    if (data) {
      setCantonBalance(data.balance);
    }
  }, [data]);

  return (
    <div className="flex flex-col gap-6">
      <h4 className="text-lg font-medium">Canton Coin balance: {cantonBalance.toFixed(2)} CC</h4>
      Recipient <Input disabled={!account} placeholder="0x1" onChange={(e) => setRecipient(e.target.value)} />
      Amount{" "}
      <Input disabled={!account} placeholder="100" onChange={(e) => setTransferAmount(parseFloat(e.target.value))} />
      <Button
        disabled={!account || !recipient || !transferAmount || transferAmount > cantonBalance || transferAmount <= 0}
        onClick={onClickButton}
      >
        Transfer
      </Button>
    </div>
  );
}
