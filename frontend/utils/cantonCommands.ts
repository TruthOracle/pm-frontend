import type { PrepareExecuteParams } from "@/lib/cantonDapp";
import type { JsCommands } from "@canton-network/core-wallet-dapp-rpc-client";

/**
 * Build Canton PrepareExecuteParams. Replace commands with real DAML-generated commands.
 */
function baseParams(partyId: string): PrepareExecuteParams {
  return {
    actAs: [partyId],
    commands: {} as JsCommands,
  };
}

export function buildClaimAllRewardsParams(partyId: string): PrepareExecuteParams {
  return baseParams(partyId);
}

export function buildBuySharesParams(_partyId: string, _marketId: number, _optionIndex: number, _amount: number): PrepareExecuteParams {
  return baseParams(_partyId);
}

export function buildInitMarketParams(
  _partyId: string,
  _question: string,
  _imageURL: string,
  _description: string,
  _option1: string,
  _option2: string,
  _liquidityParam: number
): PrepareExecuteParams {
  return baseParams(_partyId);
}

export function buildWriteMessageParams(partyId: string, _content: string): PrepareExecuteParams {
  return baseParams(partyId);
}

export function buildTransferParams(partyId: string, _to: string, _amount: number): PrepareExecuteParams {
  return baseParams(partyId);
}

export function buildWithdrawPayoutParams(partyId: string, _marketId: number): PrepareExecuteParams {
  return baseParams(partyId);
}
