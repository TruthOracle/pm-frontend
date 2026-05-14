import type { PrepareExecuteParams } from "@/lib/cantonDapp";
import { TRUTHORACLE_PACKAGE_ID } from "@/constants";

const TRUTHORACLE_MODULE = "Truthoracle";
const INCENTIVES_MODULE = "Incentives";

/**
 * Daml `Int` (Int64) and `Decimal`/`Numeric` fields must be JSON-encoded as strings
 * on the JSON Ledger API — JSON numbers can't represent Int64 precisely. The participant
 * rejects raw numbers with "Expected ujson.Str (data: <value>)" / LEDGER_API_INTERNAL_ERROR.
 * Use this everywhere a Daml Int/Decimal field appears in choiceArguments / createArguments.
 */
function damlInt(n: number): string {
  return Math.trunc(n).toString();
}

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
          // Daml Int → JSON string (see damlInt comment).
          createdAt: damlInt(createdAt),
          initialOptionShares1: damlInt(initialShares),
          initialOptionShares2: damlInt(initialShares),
          liquidityParam: damlInt(liquidityParam),
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
          // Daml Int → JSON string.
          option: damlInt(option),
          numShares: damlInt(numShares),
          cost: damlInt(cost),
          existingPosition: existingPositionContractId ?? null,
        },
      },
    },
  ];
  return baseParams(partyId, commands);
}

/**
 * Exercise PredictionMarket.AddParticipant. Admin-only on the DAML side
 * (`controller admin`). Adds `newParticipant` as an observer on the market so
 * the participant node will surface the cid from that party's view — without
 * this, Trade prepare fails with CONTRACT_NOT_FOUND because the buyer can't
 * see the contract.
 *
 * Returns a new PredictionMarket cid; the previous one is archived by the
 * choice. Callers should refresh after the tx settles.
 */
export function buildAddParticipantParams(
  partyId: string,
  predictionMarketContractId: string,
  newParticipantPartyId: string,
): PrepareExecuteParams {
  const commands = [
    {
      exercise: {
        templateId: templateId(TRUTHORACLE_MODULE, "PredictionMarket"),
        contractId: predictionMarketContractId,
        choice: "AddParticipant",
        choiceArgument: {
          newParticipant: newParticipantPartyId,
        },
      },
    },
  ];
  return baseParams(partyId, commands);
}

/**
 * Exercise PredictionMarket.RecordResult. Admin-only on the DAML side
 * (`controller admin` in Truthoracle.daml) — the wallet must be connected as
 * the admin party (VITE_ENTERPRISE_WALLET_PARTY_ID). On success the underlying
 * PredictionMarket is archived and a ResolvedMarket is created on the participant.
 *
 * `result` is a Daml `MarketResult` enum (`Option1 | Option2 | Draw`); the JSON
 * Ledger API encodes nullary enum constructors as plain tag strings — same as
 * `rewardType` in buildClaimAllRewardsParams.
 */
export function buildRecordResultParams(
  partyId: string,
  predictionMarketContractId: string,
  result: "Option1" | "Option2" | "Draw",
  payoutPerShare: number,
): PrepareExecuteParams {
  const commands = [
    {
      exercise: {
        templateId: templateId(TRUTHORACLE_MODULE, "PredictionMarket"),
        contractId: predictionMarketContractId,
        choice: "RecordResult",
        choiceArgument: {
          result,
          payoutPerShare: damlInt(payoutPerShare),
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
          // DAML RewardClaim: { marketId: Int, rewardType, amount: Int } — Int → JSON string.
          claims: claimArgs.map(({ marketId, rewardType, amount }) => ({
            marketId: damlInt(marketId),
            rewardType,
            amount: damlInt(amount),
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
