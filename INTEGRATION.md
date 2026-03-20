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
# Keycloak client_credentials (required for Ledger API auth — same as the rest of the app)
VITE_KEYCLOAK_URL=...
VITE_KEYCLOAK_REALM=master
VITE_KEYCLOAK_CLIENT_ID=...
VITE_KEYCLOAK_CLIENT_SECRET=...
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
  Exercise `UserRewardsSummary.ClaimRewardsBatch` once with a `claims` array (Incentives module). Avoids multiple consuming `ClaimReward` exercises on the same contract id in one transaction.

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
   VITE_KEYCLOAK_URL=...
   VITE_KEYCLOAK_CLIENT_ID=...
   VITE_KEYCLOAK_CLIENT_SECRET=...
   ```
2. Ensure the participant is running and accepts requests from your origin (CORS); in dev the app proxies Ledger and Keycloak to avoid CORS where configured.
3. Run `npm run dev`
4. Transactions go directly to `/v2/interactive-submission/prepare` and `/execute`

---

## Troubleshooting

### "Market counter not found"
- Ensure the `MarketCounter` contract has been created by the admin party on the participant
- Check that the package ID matches the deployed DAR
- Verify the party has visibility (is signatory or observer on MarketCounter)

### active-contracts returns `[]` (empty array)

1. **MarketCounter not created yet**  
   Create it once with the admin party using `npm run create:contract` with the same `.env` as the app (`VITE_CANTON_PARTICIPANT_URL`, `VITE_TRUTHORACLE_*`, `VITE_KEYCLOAK_*`, and optionally `VITE_TRUTHORACLE_ADMIN_PARTY_ID`). Until that succeeds, there is no contract to see.

2. **Party mismatch**  
   You must query with the **exact party** that is signatory (or observer) on the contract. For `MarketCounter`, only the **admin** party is signatory. If the UI uses a different party (e.g. another wallet), that party will get `[]`. Fix: use the same party that ran `npm run create:contract`, or ensure the connected wallet’s `account.address` is that admin party ID.

3. **Wrong participant / URL**  
   The app uses `VITE_CANTON_PARTICIPANT_URL` for both creating (script) and querying (frontend). If the script was run against a different base URL than the app, contracts won’t be visible. Use the same participant URL everywhere.

4. **Response shape**  
   Some participants return a different JSON shape. Enable debug to see the raw response:
   ```bash
   VITE_DEBUG_ACTIVE_CONTRACTS=true
   ```
   Then open DevTools → Console; when the app fetches active contracts you’ll see `[active-contracts]` with `partyId`, `templateIdStr`, `raw`, etc. The code now also accepts alternative shapes (`activeContracts`, top-level `contractId`).

---

## Creating MarketCounter via CLI / curl

If you see **"Market counter not found on this participant"**, create the counter once as the admin party using either the script below or the curl steps.

### Validator party vs TruthOracle admin (`VITE_TRUTHORACLE_ADMIN_PARTY_ID`)

In `c8-knowledge-hub-main/playground/.env.example`, **`VALIDATOR_PARTY`** (e.g. `cantor8-digik-1::1220…`) is the **validator / participant infrastructure** party used in Messenger playground examples. It is **not** the TruthOracle **`MarketCounter` admin**.

- **`npm run create:contract`** uses **`VITE_TRUTHORACLE_ADMIN_PARTY_ID`** from `.env` if set; otherwise a built-in dev default. That party is signatory on `MarketCounter` (typically the same as the wallet you connect as admin). The script does not call **`GET /v2/parties`**; set the admin explicitly (see [How to get the admin party ID](#how-to-get-the-admin-party-id) below).
- Do **not** substitute `VALIDATOR_PARTY` for your TruthOracle admin unless your operator confirms they are the same party (they usually are not).

### How to get the admin party ID

The **admin party** is the Canton party that will own the `MarketCounter` contract (and be the only one who can create markets). You need its **full party ID** (e.g. `Admin::1220a1b2c3d4e5f6...`).

**Option A – List known parties on the participant**

```bash
curl -s -X GET "${BASE_URL}/v2/parties" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json"
```

Use the response to find the party you want (e.g. by display name or hint). The full ID is usually in a field like `party` or `identifier` (format `Hint::1220...`).

**Option B – Allocate a new party (e.g. "Admin")**

If your participant allows it, allocate a new party and use its ID:

```bash
curl -s -X POST "${BASE_URL}/v2/parties/external/allocate" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{ "partyHint": "Admin", "displayName": "Admin" }'
```

Use the `party` (or equivalent) from the response as `VITE_TRUTHORACLE_ADMIN_PARTY_ID` in `.env`. (Exact request/response shape may vary; check your participant’s OpenAPI or docs.)

**Option C – From the app (Loop / connected wallet)**

If you already use the TruthOracle UI with Loop (or another wallet): connect the wallet that should be admin, then read the **connected account’s party ID** (in the app this is `account.address`). That value is your admin party ID for this participant.

**Option D – From your operator / docs**

Whoever runs the Canton participant (e.g. DigiK, Cantor8, or your team) may have created an admin party and documented its ID. Ask for the “admin party ID” or “MarketCounter owner party” for your environment.

---

### Option 1: TypeScript script (recommended)

From the repo root:

```bash
# .env already has VITE_CANTON_PARTICIPANT_URL, VITE_TRUTHORACLE_PACKAGE_ID, VITE_KEYCLOAK_*.
# Recommended: set your MarketCounter admin in .env (else the script uses a repo dev default):
# VITE_TRUTHORACLE_ADMIN_PARTY_ID='6ff9435fff4d4f43856f688e95a27368::12204e98dc339cc86c6d318f3746f99e880245b4a5827ef1e8bbe7ba6193ef8c0e58'

npm run create:contract
```

### Option 2: Manual curl

Replace `BASE_URL`, `ADMIN_PARTY_ID`, and `TOKEN` (or omit `-H "Authorization: Bearer ..."` if no auth).

**1. Get a synchronizer ID**

```bash
curl -s -X GET "${BASE_URL}/v2/state/connected-synchronizers?party=${ADMIN_PARTY_ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json"
```

Use the first `synchronizerId` from the `connectedSynchronizers` array (e.g. `SYNCHRONIZER_ID=...`).

**2. Prepare the create command**

```bash
PACKAGE_ID="54bb6ae431649ce7e6e422093009054a1675bdd3da8f511f6d260d032ef8b9b3"
TEMPLATE_ID="${PACKAGE_ID}:Truthoracle:MarketCounter"
COMMAND_ID=$(uuidgen)   # or any unique string

curl -s -X POST "${BASE_URL}/v2/interactive-submission/prepare" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "'"${ADMIN_PARTY_ID}"'",
    "commandId": "'"${COMMAND_ID}"'",
    "synchronizerId": "'"${SYNCHRONIZER_ID}"'",
    "verboseHashing": false,
    "commands": [
      {
        "CreateCommand": {
          "templateId": "'"${TEMPLATE_ID}"'",
          "createArguments": { "admin": "'"${ADMIN_PARTY_ID}"'", "value": 0 }
        }
      }
    ],
    "actAs": [ "'"${ADMIN_PARTY_ID}"'" ],
    "readAs": [],
    "disclosedContracts": [],
    "packageIdSelectionPreference": [ "'"${PACKAGE_ID}"'" ]
  }'
```

From the response, take `preparedTransaction` (or `prepared_transaction`).

**3. Execute**

```bash
curl -s -X POST "${BASE_URL}/v2/interactive-submission/execute" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{ "preparedTransaction": "'"${PREPARED_TRANSACTION}"'" }'
```

After a successful execute, the participant has one active `MarketCounter` contract; the UI can then create markets.

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
