import type { PrepareExecuteParams } from "@/lib/cantonDapp";
import { buildTransferParams } from "@/utils/cantonCommands";

export type TransferCantonArguments = {
  partyId: string;
  to: string;
  amount: number;
};

export const transferCanton = (
  args: TransferCantonArguments
): PrepareExecuteParams => {
  const { partyId, to, amount } = args;
  return buildTransferParams(partyId, to, amount);
};
