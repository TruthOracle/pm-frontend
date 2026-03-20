import type { PrepareExecuteParams } from "@/lib/cantonDapp";
import { TRUTHORACLE_PACKAGE_ID } from "@/constants";

const TRUTHORACLE_MODULE = "Truthoracle";
const INCENTIVES_MODULE = "Incentives";

function templateId(moduleName: string, entityName: string) {
  return {
    packageId: TRUTHORACLE_PACKAGE_ID,
    moduleName,
    entityName,
  };
}

function baseParams(partyId: string, commands: unknown[]): PrepareExecuteParams {
  return {
    actAs: [partyId],
    commands,
    packageIdSelectionPreference: [TRUTHORACLE_PACKAGE_ID],
  };
}

/**
 * Exercise MarketCounter.CreateMarket. Requires the active MarketCounter contract ID
 * (fetch via wallet getActiveContracts or participant query).
 */
export function buildInitMarketParams(
  partyId: string,
  question: string,
  imageURL: string,
  description: string,
  option1: string,
  option2: string,
  liquidityParam: number,
  marketCounterContractId: string
): PrepareExecuteParams {
  const createdAt = Math.floor(Date.now() / 1000);
  const initialShares = Math.max(1, Math.floor(liquidityParam / 2));
  const commands = [
    {
      exercise: {
        templateId: templateId(TRUTHORACLE_MODULE, "MarketCounter"),
        contractId: marketCounterContractId,
        choice: "CreateMarket",
        choiceArgument: {
          question,
          imageUrl: imageURL,
          description,
          option1,
          option2,
          createdAt,
          initialOptionShares1: initialShares,
          initialOptionShares2: initialShares,
          liquidityParam,
        },
      },
    },
  ];
  return baseParams(partyId, commands);
}

/**
 * Exercise PredictionMarket.Trade. Requires the PredictionMarket contract ID.
 * existingPositionContractId can be null when the user has no position yet.
 */
export function buildBuySharesParams(
  partyId: string,
  predictionMarketContractId: string,
  option: number, // 1 or 2
  numShares: number,
  cost: number,
  existingPositionContractId: string | null
): PrepareExecuteParams {
  const commands = [
    {
      exercise: {
        templateId: templateId(TRUTHORACLE_MODULE, "PredictionMarket"),
        contractId: predictionMarketContractId,
        choice: "Trade",
        choiceArgument: {
          buyer: partyId,
          option,
          numShares,
          cost,
          existingPosition: existingPositionContractId ?? null,
        },
      },
    },
  ];
  return baseParams(partyId, commands);
}

/**
 * Exercise UserRewardsSummary.ClaimRewardsBatch on Incentives (all claims in one choice).
 * One exercise avoids archiving the summary on the first ClaimReward and failing on the rest.
 */
export function buildClaimAllRewardsParams(
  partyId: string,
  userRewardsSummaryContractId: string,
  claimArgs: { marketId: number; rewardType: string; amount: number }[]
): PrepareExecuteParams {
  const commands = [
    {
      exercise: {
        templateId: templateId(INCENTIVES_MODULE, "UserRewardsSummary"),
        contractId: userRewardsSummaryContractId,
        choice: "ClaimRewardsBatch",
        choiceArgument: {
          // DAML RewardClaim: { marketId, rewardType, amount }
          claims: claimArgs.map(({ marketId, rewardType, amount }) => ({
            marketId,
            rewardType,
            amount,
          })),
        },
      },
    },
  ];
  return baseParams(partyId, commands);
}

/**
 * No-arg version: use when contract ID or claim args are not yet available.
 * Submits with packageIdSelectionPreference only (no commands).
 */
export function buildClaimAllRewardsParamsNoArgs(partyId: string): PrepareExecuteParams {
  return baseParams(partyId, []);
}

/**
 * Simplified claim: single ClaimReward exercise. Use when you have one reward to claim.
 */
export function buildClaimRewardParams(
  partyId: string,
  userRewardsSummaryContractId: string,
  marketId: number,
  rewardType: string,
  amount: number
): PrepareExecuteParams {
  return buildClaimAllRewardsParams(partyId, userRewardsSummaryContractId, [
    { marketId, rewardType, amount },
  ]);
}

/**
 * Placeholder: Transfer Canton Coin. Not in TruthOracle DAML; wire to your Canton Coin module when available.
 */
export function buildTransferParams(partyId: string, _to: string, _amount: number): PrepareExecuteParams {
  return baseParams(partyId, []);
}

/**
 * Placeholder: Withdraw payout. TruthOracle DAML has ResolvedMarket but no withdraw choice;
 * wire to your payout flow or Incentives when available.
 */
export function buildWithdrawPayoutParams(partyId: string, _marketId: number): PrepareExecuteParams {
  return baseParams(partyId, []);
}

/**
 * Placeholder: Write message. Wire to your message template when available.
 */
export function buildWriteMessageParams(partyId: string, _content: string): PrepareExecuteParams {
  return baseParams(partyId, []);
}
