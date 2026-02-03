import { dappAPI } from "@canton-network/dapp-sdk";
import { buildWriteMessageParams } from "@/utils/cantonCommands";

export type WriteMessageArguments = {
  partyId: string;
  content: string;
};

export const writeMessage = (
  args: WriteMessageArguments
): dappAPI.PrepareExecuteParams => {
  const { partyId, content } = args;
  return buildWriteMessageParams(partyId, content);
};