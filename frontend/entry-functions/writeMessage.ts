import type { PrepareExecuteParams } from "@/lib/cantonDapp";
import { buildWriteMessageParams } from "@/utils/cantonCommands";

export type WriteMessageArguments = {
  partyId: string;
  content: string;
};

export const writeMessage = (
  args: WriteMessageArguments
): PrepareExecuteParams => {
  const { partyId, content } = args;
  return buildWriteMessageParams(partyId, content);
};