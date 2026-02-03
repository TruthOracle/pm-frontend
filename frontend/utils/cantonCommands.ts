import { dappAPI } from "@canton-network/dapp-sdk";

/**
 * Build Canton PrepareExecuteParams. Replace commands with real DAML-generated commands.
 */
function baseParams(partyId: string): dappAPI.PrepareExecuteParams {
  return {
    actAs: [partyId],
    commands: {} as dappAPI.JsCommands,
  };
}

export function buildClaimAllRewardsParams(partyId: string): dappAPI.PrepareExecuteParams {
  return baseParams(partyId);
}

export function buildBuySharesParams(_partyId: string, _marketId: number, _optionIndex: number, _amount: number): dappAPI.PrepareExecuteParams {
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
): dappAPI.PrepareExecuteParams {
  return baseParams(_partyId);
}

export function buildMintUsdcParams(partyId: string, _amount: number): dappAPI.PrepareExecuteParams {
  return baseParams(partyId);
}

export function buildWriteMessageParams(partyId: string, _content: string): dappAPI.PrepareExecuteParams {
  return baseParams(partyId);
}

export function buildTransferParams(partyId: string, _to: string, _amount: number): dappAPI.PrepareExecuteParams {
  return baseParams(partyId);
}

export function buildWithdrawPayoutParams(partyId: string, _marketId: number): dappAPI.PrepareExecuteParams {
  return baseParams(partyId);
}
