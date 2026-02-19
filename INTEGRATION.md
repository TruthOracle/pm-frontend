# TruthOracle Canton Integration

This document explains how the TruthOracle frontend integrates with Canton Network and submits transactions.

---

## Package ID

The deployed TruthOracle DAML package ID is configured in `frontend/constants.ts`:

```typescript
export const TRUTHORACLE_PACKAGE_ID = 
  "54bb6ae431649ce7e6e422093009054a1675bdd3da8f511f6d260d032ef8b9b3";
```

Override via environment variable in `.env`:
```bash
VITE_TRUTHORACLE_PACKAGE_ID=your-package-id-here
```

All DAML commands include `packageIdSelectionPreference: [TRUTHORACLE_PACKAGE_ID]` so the Canton participant resolves to the correct package.

---

## Transaction Submission: Two Options

The app supports **two modes** for submitting transactions:

### Option 1: Loop Wallet (Default)

Uses the Loop wallet browser extension/popup for user signing and submission.

- User connects Loop wallet via `loopConnect()`
- Transactions are built as DAML commands and passed to `loop.provider.submitAndWaitForTransaction()`
- Loop wallet prompts user to approve and sign
- Best for end-user flows where users have Loop wallet installed

**Configuration:**
```bash
VITE_USE_PARTICIPANT_API=false  # or omit (default)
```

### Option 2: Canton Participant Interactive Submission API

Directly calls the Canton participant's Ledger API endpoints:
- `/v2/interactive-submission/prepare` — prepares the transaction and returns a prepared transaction blob
- `/v2/interactive-submission/execute` — executes the prepared transaction (participant signs or accepts external signature)

**Configuration:**
```bash
VITE_USE_PARTICIPANT_API=true
VITE_CANTON_PARTICIPANT_URL=https://api.validator.dev.digik.cantor8.tech/api/ledger
VITE_CANTON_PARTICIPANT_TOKEN=your-bearer-token  # Optional, if participant requires auth
```

The mode is selected at runtime in `CantonWalletContext.tsx`:

```typescript
const useParticipantApi = import.meta.env.VITE_USE_PARTICIPANT_API === "true";
if (useParticipantApi) {
  const client = createParticipantClient();
  return await client.submitTransaction(params);
} else {
  // Use Loop wallet
  const result = await provider.submitAndWaitForTransaction(payload, {...});
  return { hash: result.command_id };
}
```

---

## Command Structure

All commands are built in `frontend/utils/cantonCommands.ts` using the Ledger API format:

```typescript
{
  actAs: [partyId],
  commands: [
    {
      exercise: {
        templateId: {
          packageId: "54bb6ae4...",
          moduleName: "Truthoracle",
          entityName: "MarketCounter"
        },
        contractId: "00abc...",
        choice: "CreateMarket",
        choiceArgument: {
          question: "Will X happen?",
          imageUrl: "https://...",
          // ... other fields
        }
      }
    }
  ],
  packageIdSelectionPreference: ["54bb6ae4..."]
}
```

### Available command builders:

- **`buildInitMarketParams(partyId, question, imageURL, description, option1, option2, liquidityParam, marketCounterContractId)`**  
  Exercise `MarketCounter.CreateMarket` to create a new prediction market.

- **`buildBuySharesParams(partyId, predictionMarketContractId, option, numShares, cost, existingPositionContractId)`**  
  Exercise `PredictionMarket.Trade` to buy shares (option 1 or 2).

- **`buildClaimAllRewardsParams(partyId, userRewardsSummaryContractId, claimArgs)`**  
  Exercise `UserRewardsSummary.ClaimReward` for one or more rewards (from Incentives module).

- **`buildTransferParams(partyId, to, amount)`** *(placeholder)*  
  For Canton Coin transfers (not yet wired to TruthOracle DAML).

- **`buildWithdrawPayoutParams(partyId, marketId)`** *(placeholder)*  
  For withdrawing payouts (pending implementation in DAML).

---

## Active Contract Lookup

The frontend fetches active contracts using the Loop provider's `getActiveContracts()` or by querying the participant directly. Helpers in `frontend/utils/activeContracts.ts`:

- **`fetchMarketCounterContractId()`** — Get the active MarketCounter contract (admin holds it)
- **`fetchPredictionMarketContractId(marketId)`** — Get PredictionMarket contract by market ID
- **`fetchUserMarketDataContractId(partyId, marketId)`** — Get UserMarketData for a user and market
- **`fetchUserRewardsSummaryContractId(partyId)`** — Get UserRewardsSummary for rewards

These use the **full template identifier** format:

```
packageId:moduleName:entityName
```

Example:
```
54bb6ae431649ce7e6e422093009054a1675bdd3da8f511f6d260d032ef8b9b3:Truthoracle:MarketCounter
```

If the Loop/Canton API returns a 500 error for active-contracts, verify:
1. The package ID matches the deployed DAR
2. The participant has the MarketCounter and other contracts visible to the connected party
3. The template identifier format is correct (try with/without package ID if needed)

---

## UI Integration

### Admin Form (Create Market)

1. On mount, fetches `MarketCounter` contract ID via `fetchMarketCounterContractId()`
2. When user submits the form, calls `buildInitMarketParams(..., marketCounterCid)` 
3. Calls `signAndSubmitTransaction(params)` which uses Loop wallet or participant API based on `VITE_USE_PARTICIPANT_API`

### Bet Buy Card (Trade)

1. On mount, fetches `PredictionMarket` contract (by market ID) and `UserMarketData` (for user + market)
2. When user clicks "BUY", calls `buildBuySharesParams(..., predictionMarketCid, option, numShares, cost, userMarketDataCid)`
3. Submits via `signAndSubmitTransaction(params)`

### Rewards (Claim)

1. Fetches `UserRewardsSummary` contract for the user
2. Builds claim args from `rewardMarkets` (eligible markets)
3. Calls `buildClaimAllRewardsParams(partyId, summaryCid, claimArgs)` and submits

---

## Testing

### With Loop Wallet (default)
1. Install Loop wallet extension or use Loop web wallet at https://cantonloop.com
2. Connect to devnet
3. Ensure your party has visibility of the TruthOracle contracts on devnet
4. Run `npm run dev` and connect wallet
5. Create markets, buy shares, claim rewards

### With Participant API
1. Set `.env`:
   ```bash
   VITE_USE_PARTICIPANT_API=true
   VITE_CANTON_PARTICIPANT_URL=https://api.validator.dev.digik.cantor8.tech/api/ledger
   ```
2. Ensure the participant is running and accepts requests from your origin (CORS)
3. If auth is required, set `VITE_CANTON_PARTICIPANT_TOKEN`
4. Run `npm run dev`
5. Transactions go directly to `/v2/interactive-submission/prepare` and `/execute`

---

## Troubleshooting

### "Market counter not found"
- Ensure the `MarketCounter` contract has been created by the admin party on the participant
- Check that the package ID matches the deployed DAR
- Verify the party has visibility (is signatory or observer on MarketCounter)

### "Market contract not found" (when buying shares)
- The `PredictionMarket` for that market ID must exist on the participant
- Check that the market was created via `CreateMarket` and is visible to the user

### 500 error on active-contracts
- Verify the template identifier format (package ID may or may not be required)
- Check participant logs for errors (template not found, party not authorized, etc.)
- Ensure the package is uploaded and vetted on the participant

### Transaction rejected
- Check that the party has authority (signatory/controller) for the choice
- Verify all required contract IDs are correct
- Check choice arguments match the DAML template signature
- Review participant logs for detailed error messages

---

## References

- **DAML Contracts:** `daml/daml/Truthoracle.daml`, `daml/daml/Incentives.daml`
- **Canton Interactive Submission API:** [Canton docs](https://docs.digitalasset.com/build/3.4/tutorials/app-dev/external_signing_submission_part_2.html)
- **Loop SDK:** [@fivenorth/loop-sdk](https://www.npmjs.com/package/@fivenorth/loop-sdk)
- **Canton Network:** https://www.canton.network/
