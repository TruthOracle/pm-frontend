import type { PrepareExecuteParams } from "@/lib/cantonDapp";
import { TRUTHORACLE_PACKAGE_ID } from "@/constants";

const TRUTHORACLE_MODULE = "Truthoracle";
const INCENTIVES_MODULE = "Incentives";

/**
 * Daml `Int` (Int64) and `Decimal`/`Numeric` fields must be JSON-encoded as strings
 * on the JSON Ledger API — JSON numbers can't represent Int64 / arbitrary-precision
 * Decimals safely. The participant rejects raw numbers with "Expected ujson.Str".
 */
function damlInt(n: number): string {
  return Math.trunc(n).toString();
}

/** Daml Decimal — 10 decimal places, no exponent. Use for CC amounts. */
function damlDecimal(n: number): string {
  if (!Number.isFinite(n)) return "0.0000000000";
  return n.toFixed(10);
}

export function templateId(moduleName: string, entityName: string): string {
  return `${TRUTHORACLE_PACKAGE_ID}:${moduleName}:${entityName}`;
}

function baseParams(partyId: string, commands: unknown[]): PrepareExecuteParams {
  return {
    actAs: [partyId],
    commands,
    packageIdSelectionPreference: [TRUTHORACLE_PACKAGE_ID],
  };
}

export interface DisclosedContractArg {
  templateId?: string;
  contractId?: string;
  createdEventBlob: string;
  synchronizerId?: string;
}

function withDisclosure(
  params: PrepareExecuteParams,
  disclosedContracts?: DisclosedContractArg[],
): PrepareExecuteParams {
  if (disclosedContracts && disclosedContracts.length > 0) {
    params.disclosedContracts = disclosedContracts;
  }
  return params;
}

/**
 * Exercise MarketCounter.CreateMarket. Markets are always Yes/No.
 */
export function buildInitMarketParams(
  partyId: string,
  question: string,
  imageURL: string,
  description: string,
  resolutionDescription: string,
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
          resolutionDescription,
          createdAt: damlInt(createdAt),
          initialYesShares: damlInt(initialShares),
          initialNoShares: damlInt(initialShares),
          liquidityParam: damlInt(liquidityParam),
        },
      },
    },
  ];
  return baseParams(partyId, commands);
}

/**
 * Exercise PredictionMarket.Buy. costCC is the CC cost the user is paying.
 * NOTE: the contract does NOT verify that a CC transfer of `costCC` actually
 * happened — the frontend must trigger that transfer first (via Cantor8 popup)
 * and only then exercise this choice. Until reconciliation is wired up this is
 * trust-the-frontend.
 */
export function buildBuyParams(
  partyId: string,
  predictionMarketContractId: string,
  side: number,
  numShares: number,
  costCC: number,
  existingPositionContractId: string | null,
  disclosedContracts?: DisclosedContractArg[],
): PrepareExecuteParams {
  const commands = [
    {
      exercise: {
        templateId: templateId(TRUTHORACLE_MODULE, "PredictionMarket"),
        contractId: predictionMarketContractId,
        choice: "Buy",
        choiceArgument: {
          buyer: partyId,
          side: damlInt(side),
          numShares: damlInt(numShares),
          costCC: damlDecimal(costCC),
          existingPosition: existingPositionContractId ?? null,
        },
      },
    },
  ];
  return withDisclosure(baseParams(partyId, commands), disclosedContracts);
}

/**
 * Exercise PredictionMarket.Sell. Burns shares and creates a PendingPayout
 * (admin pays the user CC asynchronously via Enterprise Wallet).
 */
export function buildSellParams(
  partyId: string,
  predictionMarketContractId: string,
  side: number,
  numShares: number,
  proceedsCC: number,
  positionContractId: string,
  disclosedContracts?: DisclosedContractArg[],
): PrepareExecuteParams {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const commands = [
    {
      exercise: {
        templateId: templateId(TRUTHORACLE_MODULE, "PredictionMarket"),
        contractId: predictionMarketContractId,
        choice: "Sell",
        choiceArgument: {
          seller: partyId,
          side: damlInt(side),
          numShares: damlInt(numShares),
          proceedsCC: damlDecimal(proceedsCC),
          positionCid: positionContractId,
          nowSeconds: damlInt(nowSeconds),
        },
      },
    },
  ];
  return withDisclosure(baseParams(partyId, commands), disclosedContracts);
}

/**
 * Exercise PredictionMarket.Split — mint `amount` Yes + No share pairs.
 * Costs `amount` CC (1 pair = 1 CC). Frontend must transfer CC to admin first.
 */
export function buildSplitParams(
  partyId: string,
  predictionMarketContractId: string,
  amount: number,
  existingPositionContractId: string | null,
  disclosedContracts?: DisclosedContractArg[],
): PrepareExecuteParams {
  const commands = [
    {
      exercise: {
        templateId: templateId(TRUTHORACLE_MODULE, "PredictionMarket"),
        contractId: predictionMarketContractId,
        choice: "Split",
        choiceArgument: {
          user: partyId,
          amount: damlInt(amount),
          existingPosition: existingPositionContractId ?? null,
        },
      },
    },
  ];
  return withDisclosure(baseParams(partyId, commands), disclosedContracts);
}

/**
 * Exercise PredictionMarket.Merge — burn `amount` Yes + No pairs, create
 * a PendingPayout for `amount` CC.
 */
export function buildMergeParams(
  partyId: string,
  predictionMarketContractId: string,
  amount: number,
  positionContractId: string,
  disclosedContracts?: DisclosedContractArg[],
): PrepareExecuteParams {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const commands = [
    {
      exercise: {
        templateId: templateId(TRUTHORACLE_MODULE, "PredictionMarket"),
        contractId: predictionMarketContractId,
        choice: "Merge",
        choiceArgument: {
          user: partyId,
          amount: damlInt(amount),
          positionCid: positionContractId,
          nowSeconds: damlInt(nowSeconds),
        },
      },
    },
  ];
  return withDisclosure(baseParams(partyId, commands), disclosedContracts);
}

/**
 * Exercise PredictionMarket.RecordResult. Admin-only. payoutPerShareCC is the
 * CC each winning share is worth (e.g. 1.0 for Yes-wins paying 1 CC/share).
 */
export function buildRecordResultParams(
  partyId: string,
  predictionMarketContractId: string,
  result: "Yes" | "No" | "Draw",
  payoutPerShareCC: number,
): PrepareExecuteParams {
  const commands = [
    {
      exercise: {
        templateId: templateId(TRUTHORACLE_MODULE, "PredictionMarket"),
        contractId: predictionMarketContractId,
        choice: "RecordResult",
        choiceArgument: {
          result,
          payoutPerShareCC: damlDecimal(payoutPerShareCC),
        },
      },
    },
  ];
  return baseParams(partyId, commands);
}

/**
 * Admin: archive a PendingPayout after sending CC via the Enterprise Wallet.
 * txHash is a reference for off-chain audit.
 */
export function buildMarkPaidParams(
  partyId: string,
  pendingPayoutContractId: string,
  txHash: string,
): PrepareExecuteParams {
  const commands = [
    {
      exercise: {
        templateId: templateId(TRUTHORACLE_MODULE, "PendingPayout"),
        contractId: pendingPayoutContractId,
        choice: "MarkPaid",
        choiceArgument: { txHash },
      },
    },
  ];
  return baseParams(partyId, commands);
}

/**
 * User: cancel their own pending payout (escape hatch — rarely used).
 */
export function buildCancelPayoutParams(
  partyId: string,
  pendingPayoutContractId: string,
): PrepareExecuteParams {
  const commands = [
    {
      exercise: {
        templateId: templateId(TRUTHORACLE_MODULE, "PendingPayout"),
        contractId: pendingPayoutContractId,
        choice: "CancelPayout",
        choiceArgument: {},
      },
    },
  ];
  return baseParams(partyId, commands);
}

/**
 * Exercise UserRewardsSummary.ClaimRewardsBatch on Incentives.
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

export function buildClaimAllRewardsParamsNoArgs(partyId: string): PrepareExecuteParams {
  return baseParams(partyId, []);
}

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

export function buildTransferParams(partyId: string, _to: string, _amount: number): PrepareExecuteParams {
  return baseParams(partyId, []);
}

export function buildWithdrawPayoutParams(partyId: string, _marketId: number): PrepareExecuteParams {
  return baseParams(partyId, []);
}

export function buildWriteMessageParams(partyId: string, _content: string): PrepareExecuteParams {
  return baseParams(partyId, []);
}
