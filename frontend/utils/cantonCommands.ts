import type { PrepareExecuteParams } from "@/lib/cantonDapp";
import { TRUTHORACLE_PACKAGE_ID } from "@/constants";

const TRUTHORACLE_MODULE = "Truthoracle";

export type OutcomeArg = "Yes" | "No" | "VoidOutcome";

/**
 * Daml `Int` (Int64) and `Decimal`/`Numeric` fields must be JSON-encoded as strings
 * on the JSON Ledger API — JSON numbers can't represent Int64 / arbitrary-precision
 * Decimals safely. The participant rejects raw numbers with "Expected ujson.Str".
 */
function damlInt(n: number): string {
  return Math.trunc(n).toString();
}

/** Daml Decimal — 10 decimal places, no exponent. Use for collateral amounts and shares. */
function damlDecimal(n: number): string {
  if (!Number.isFinite(n)) return "0.0000000000";
  return n.toFixed(10);
}

const nowSecs = () => Math.floor(Date.now() / 1000);

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

function exerciseMarket(
  partyId: string,
  marketContractId: string,
  choice: string,
  choiceArgument: Record<string, unknown>,
  disclosedContracts?: DisclosedContractArg[],
): PrepareExecuteParams {
  const commands = [
    {
      exercise: {
        templateId: templateId(TRUTHORACLE_MODULE, "PredictionMarket"),
        contractId: marketContractId,
        choice,
        choiceArgument,
      },
    },
  ];
  return withDisclosure(baseParams(partyId, commands), disclosedContracts);
}

// ---------------------------------------------------------------------------
// Trading (in-app wallet rail: choices debit/credit the user's UserWallet for
// the market's collateral atomically — one wallet signature per trade, no
// prior token transfer). Argument names follow truthoracle-v17.
// ---------------------------------------------------------------------------

/**
 * Exercise PredictionMarket.Buy. `amount` (collateral) is debited from the buyer's
 * in-app UserWallet inside the same transaction; the pm-AMM computes shares
 * out on-ledger and rejects if below `minSharesOut` (slippage bound).
 */
export function buildBuyParams(
  partyId: string,
  predictionMarketContractId: string,
  side: OutcomeArg,
  amount: number,
  minSharesOut: number,
  existingPositionContractId: string | null,
  walletContractId: string,
  disclosedContracts?: DisclosedContractArg[],
): PrepareExecuteParams {
  return exerciseMarket(
    partyId,
    predictionMarketContractId,
    "Buy",
    {
      buyer: partyId,
      side,
      amount: damlDecimal(amount),
      minSharesOut: damlDecimal(minSharesOut),
      nowSeconds: damlInt(nowSecs()),
      existingPosition: existingPositionContractId ?? null,
      walletCid: walletContractId,
    },
    disclosedContracts,
  );
}

/**
 * Exercise PredictionMarket.Sell. Proceeds are computed on-ledger (closed
 * form) and credited straight to the seller's in-app wallet.
 */
export function buildSellParams(
  partyId: string,
  predictionMarketContractId: string,
  side: OutcomeArg,
  sharesIn: number,
  minProceeds: number,
  positionContractId: string,
  walletContractId: string,
  disclosedContracts?: DisclosedContractArg[],
): PrepareExecuteParams {
  return exerciseMarket(
    partyId,
    predictionMarketContractId,
    "Sell",
    {
      seller: partyId,
      side,
      sharesIn: damlDecimal(sharesIn),
      minProceeds: damlDecimal(minProceeds),
      nowSeconds: damlInt(nowSecs()),
      positionCid: positionContractId,
      walletCid: walletContractId,
    },
    disclosedContracts,
  );
}

/**
 * Exercise PredictionMarket.SwapShares — direct YES<->NO outcome-token swap
 * (the direct outcome-token trading primitive). No collateral involved; fee taken from the
 * input shares and retained in the pool.
 */
export function buildSwapSharesParams(
  partyId: string,
  predictionMarketContractId: string,
  fromSide: OutcomeArg,
  sharesIn: number,
  minSharesOut: number,
  positionContractId: string,
  disclosedContracts?: DisclosedContractArg[],
): PrepareExecuteParams {
  return exerciseMarket(
    partyId,
    predictionMarketContractId,
    "SwapShares",
    {
      swapper: partyId,
      fromSide,
      sharesIn: damlDecimal(sharesIn),
      minSharesOut: damlDecimal(minSharesOut),
      nowSeconds: damlInt(nowSecs()),
      positionCid: positionContractId,
    },
    disclosedContracts,
  );
}

/** Exercise PredictionMarket.Split — mint complete sets (1 unit of collateral = 1 YES + 1 NO), debited from the in-app wallet. */
export function buildSplitParams(
  partyId: string,
  predictionMarketContractId: string,
  amount: number,
  existingPositionContractId: string | null,
  walletContractId: string,
  disclosedContracts?: DisclosedContractArg[],
): PrepareExecuteParams {
  return exerciseMarket(
    partyId,
    predictionMarketContractId,
    "Split",
    {
      user: partyId,
      amount: damlDecimal(amount),
      nowSeconds: damlInt(nowSecs()),
      existingPosition: existingPositionContractId ?? null,
      walletCid: walletContractId,
    },
    disclosedContracts,
  );
}

/** Exercise PredictionMarket.Merge — burn pairs for 1 unit of collateral each, credited to the in-app wallet. */
export function buildMergeParams(
  partyId: string,
  predictionMarketContractId: string,
  amount: number,
  positionContractId: string,
  walletContractId: string,
  disclosedContracts?: DisclosedContractArg[],
): PrepareExecuteParams {
  return exerciseMarket(
    partyId,
    predictionMarketContractId,
    "Merge",
    {
      user: partyId,
      amount: damlDecimal(amount),
      nowSeconds: damlInt(nowSecs()),
      positionCid: positionContractId,
      walletCid: walletContractId,
    },
    disclosedContracts,
  );
}

// ---------------------------------------------------------------------------
// Liquidity
// ---------------------------------------------------------------------------

/**
 * Exercise PredictionMarket.ProvideLiquidity. Value-based deposit: names a
 * desired pool-value increase; cost = max(dx, dy) in collateral, debited from
 * the provider's in-app wallet. `maxCost` bounds quote drift.
 */
export function buildProvideLiquidityParams(
  partyId: string,
  predictionMarketContractId: string,
  valueIncrease: number,
  maxCost: number,
  existingLpPositionContractId: string | null,
  walletContractId: string,
  disclosedContracts?: DisclosedContractArg[],
): PrepareExecuteParams {
  return exerciseMarket(
    partyId,
    predictionMarketContractId,
    "ProvideLiquidity",
    {
      provider: partyId,
      valueIncrease: damlDecimal(valueIncrease),
      maxCost: damlDecimal(maxCost),
      nowSeconds: damlInt(nowSecs()),
      existingLpPosition: existingLpPositionContractId ?? null,
      walletCid: walletContractId,
    },
    disclosedContracts,
  );
}

/**
 * Exercise PredictionMarket.WithdrawLiquidity. Collateral proceeds are credited
 * to the provider's in-app wallet; a static pool allows early exit to shares.
 */
export function buildWithdrawLiquidityParams(
  partyId: string,
  predictionMarketContractId: string,
  lpTokensToBurn: number,
  lpPositionContractId: string,
  existingPositionContractId: string | null,
  walletContractId: string,
  disclosedContracts?: DisclosedContractArg[],
): PrepareExecuteParams {
  return exerciseMarket(
    partyId,
    predictionMarketContractId,
    "WithdrawLiquidity",
    {
      provider: partyId,
      lpTokensToBurn: damlDecimal(lpTokensToBurn),
      nowSeconds: damlInt(nowSecs()),
      lpPositionCid: lpPositionContractId,
      existingPosition: existingPositionContractId ?? null,
      walletCid: walletContractId,
    },
    disclosedContracts,
  );
}

// ---------------------------------------------------------------------------
// Resolution (tiers T0–T3) and redemption
// ---------------------------------------------------------------------------

/** Admin T0: designated-operator resolution from an allowlisted source. */
export function buildResolveT0Params(
  partyId: string,
  predictionMarketContractId: string,
  resolvedOutcome: OutcomeArg,
  sourceUri: string,
): PrepareExecuteParams {
  return exerciseMarket(partyId, predictionMarketContractId, "ResolveT0", {
    resolvedOutcome,
    sourceUri,
    nowSeconds: damlInt(nowSecs()),
  });
}

/** Admin T1/T2: resolve from gathered OutcomeAttestation contracts. */
export function buildResolveParams(
  partyId: string,
  predictionMarketContractId: string,
  attestationContractIds: string[],
): PrepareExecuteParams {
  return exerciseMarket(partyId, predictionMarketContractId, "Resolve", {
    attestationCids: attestationContractIds,
    nowSeconds: damlInt(nowSecs()),
  });
}

/** T3: bonded optimistic proposal (bond debited from the in-app wallet). */
export function buildProposeOutcomeParams(
  partyId: string,
  predictionMarketContractId: string,
  proposedOutcome: OutcomeArg,
  walletContractId: string,
  disclosedContracts?: DisclosedContractArg[],
): PrepareExecuteParams {
  return exerciseMarket(
    partyId,
    predictionMarketContractId,
    "ProposeOutcome",
    {
      proposer: partyId,
      proposedOutcome,
      nowSeconds: damlInt(nowSecs()),
      walletCid: walletContractId,
    },
    disclosedContracts,
  );
}

/** T3: bonded challenge — escalates objectively to T1/T2, never a vote. */
export function buildChallengeOutcomeParams(
  partyId: string,
  predictionMarketContractId: string,
  challengerOutcome: OutcomeArg,
  walletContractId: string,
  disclosedContracts?: DisclosedContractArg[],
): PrepareExecuteParams {
  return exerciseMarket(
    partyId,
    predictionMarketContractId,
    "ChallengeOutcome",
    {
      challenger: partyId,
      challengerOutcome,
      nowSeconds: damlInt(nowSecs()),
      walletCid: walletContractId,
    },
    disclosedContracts,
  );
}

/** T3: finalize an unchallenged proposal after the window. */
export function buildFinalizeOutcomeParams(
  partyId: string,
  predictionMarketContractId: string,
  disclosedContracts?: DisclosedContractArg[],
): PrepareExecuteParams {
  return exerciseMarket(
    partyId,
    predictionMarketContractId,
    "FinalizeOutcome",
    {
      finalizer: partyId,
      nowSeconds: damlInt(nowSecs()),
    },
    disclosedContracts,
  );
}

/** Admin: void a market whose grace period elapsed without resolution. */
export function buildVoidMarketParams(partyId: string, predictionMarketContractId: string): PrepareExecuteParams {
  return exerciseMarket(partyId, predictionMarketContractId, "VoidMarket", {
    nowSeconds: damlInt(nowSecs()),
  });
}

/**
 * Holder: redeem a position on a Resolved (one unit of collateral per winning
 * share) or Voided (cost-basis refund) market. Credits the in-app wallet,
 * archives the position.
 */
export function buildRedeemPositionParams(
  partyId: string,
  predictionMarketContractId: string,
  positionContractId: string,
  walletContractId: string,
  disclosedContracts?: DisclosedContractArg[],
): PrepareExecuteParams {
  return exerciseMarket(
    partyId,
    predictionMarketContractId,
    "RedeemPosition",
    {
      holder: partyId,
      nowSeconds: damlInt(nowSecs()),
      positionCid: positionContractId,
      walletCid: walletContractId,
    },
    disclosedContracts,
  );
}

// ---------------------------------------------------------------------------
// Outcome attestations (reporters / T1 source desks)
// ---------------------------------------------------------------------------

export interface AttestationArgs {
  admin: string;
  marketId: number;
  sourceUri: string;
  outcome: OutcomeArg;
  payloadHash: string; // sha256 hex of the verbatim source response
  sourceSignature?: string; // T1 only
  responseExcerpt?: string;
}

/** Reporter/source: create an OutcomeAttestation for a market. */
export function buildCreateAttestationParams(partyId: string, args: AttestationArgs): PrepareExecuteParams {
  const commands = [
    {
      create: {
        templateId: templateId(TRUTHORACLE_MODULE, "OutcomeAttestation"),
        createArguments: {
          attester: partyId,
          admin: args.admin,
          marketId: damlInt(args.marketId),
          sourceUri: args.sourceUri,
          fetchedAt: damlInt(nowSecs()),
          outcome: args.outcome,
          payloadHash: args.payloadHash,
          sourceSignature: args.sourceSignature ?? null,
          responseExcerpt: args.responseExcerpt ?? null,
        },
      },
    },
  ];
  return baseParams(partyId, commands);
}

// ---------------------------------------------------------------------------
// Prediction-model marketplace
// ---------------------------------------------------------------------------

/** Forecaster: commit a timestamped probability while the market is Trading. */
export function buildCommitForecastParams(
  partyId: string,
  predictionMarketContractId: string,
  modelId: string,
  probabilityYes: number,
  disclosedContracts?: DisclosedContractArg[],
): PrepareExecuteParams {
  return exerciseMarket(
    partyId,
    predictionMarketContractId,
    "CommitForecast",
    {
      author: partyId,
      modelId,
      probabilityYes: damlDecimal(probabilityYes),
      nowSeconds: damlInt(nowSecs()),
    },
    disclosedContracts,
  );
}

/** Admin: Brier-score committed forecasts and distribute the prize pool. */
export function buildScoreAndDistributeParams(
  partyId: string,
  predictionMarketContractId: string,
  forecastContractIds: string[],
): PrepareExecuteParams {
  return exerciseMarket(partyId, predictionMarketContractId, "ScoreAndDistribute", {
    forecastCids: forecastContractIds,
    nowSeconds: damlInt(nowSecs()),
  });
}

// ---------------------------------------------------------------------------
// Payout queue
// ---------------------------------------------------------------------------

/**
 * Admin: archive a PendingPayout after the tokens were sent via the Enterprise
 * Wallet. txHash is a reference for off-chain audit.
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
 * User: cancel their own pending payout. Passing their wallet cid re-credits
 * the amount to the in-app balance (the right call for a "withdraw" payout);
 * null just archives (forfeits) it.
 */
export function buildCancelPayoutParams(
  partyId: string,
  pendingPayoutContractId: string,
  refundWalletContractId: string | null,
): PrepareExecuteParams {
  const commands = [
    {
      exercise: {
        templateId: templateId(TRUTHORACLE_MODULE, "PendingPayout"),
        contractId: pendingPayoutContractId,
        choice: "CancelPayout",
        choiceArgument: { refundWalletCid: refundWalletContractId ?? null },
      },
    },
  ];
  return baseParams(partyId, commands);
}

/**
 * Admin: settle a PendingPayout into the user's in-app wallet for the payout's
 * instrument instead of an external transfer (T3 bond settlement, model prizes).
 */
export function buildSettleToWalletParams(
  partyId: string,
  pendingPayoutContractId: string,
  walletContractId: string,
): PrepareExecuteParams {
  const commands = [
    {
      exercise: {
        templateId: templateId(TRUTHORACLE_MODULE, "PendingPayout"),
        contractId: pendingPayoutContractId,
        choice: "SettleToWallet",
        choiceArgument: { walletCid: walletContractId },
      },
    },
  ];
  return baseParams(partyId, commands);
}

// ---------------------------------------------------------------------------
// In-app UserWallet (withdraw). Wallets are created and credited by the
// accounts backend as the treasury (one per owner and instrument); the only
// wallet choice a user signs in the browser is Withdraw.
// ---------------------------------------------------------------------------

/**
 * Owner: move in-app funds back toward their external wallet — debits the
 * balance and queues a PendingPayout (in the wallet's instrument) the backend
 * settles through the treasury.
 */
export function buildWalletWithdrawParams(
  partyId: string,
  walletContractId: string,
  amount: number,
): PrepareExecuteParams {
  const commands = [
    {
      exercise: {
        templateId: templateId(TRUTHORACLE_MODULE, "UserWallet"),
        contractId: walletContractId,
        choice: "Withdraw",
        choiceArgument: { amount: damlDecimal(amount), nowSeconds: damlInt(nowSecs()) },
      },
    },
  ];
  return baseParams(partyId, commands);
}
