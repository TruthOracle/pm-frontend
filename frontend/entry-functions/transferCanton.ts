import { dappAPI } from "@canton-network/dapp-sdk";
import { buildTransferParams } from "@/utils/cantonCommands";

export type TransferCantonArguments = {
  partyId: string;
  to: string;
  amount: number;
};

export const transferCanton = (
  args: TransferCantonArguments
): dappAPI.PrepareExecuteParams => {
  const { partyId, to, amount } = args;
  return buildTransferParams(partyId, to, amount);
};
