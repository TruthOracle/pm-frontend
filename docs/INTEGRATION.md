# TruthOracle Canton Integration

How the TruthOracle frontend talks to the Canton Network: which wallet signs what, how
commands are built, how contracts are read, and where money moves. The accounts backend
(`truthoracle-backend`, its `docs/API.md`) owns everything the browser cannot do as an
external party — the ledger index, deposits, payouts, rewards and the operator actions — so
this document is about the browser's own ledger surface and the seams to that backend.

---

## Package

The deployed Daml package is `truthoracle-v17` (`truthoracle-contracts`, `daml/daml.yaml`
`name:`; the token design is `truthoracle-backend/docs/TOKENS.md` §3). Two values identify it
and both come from `.env` through `frontend/config.ts` (re-exported by `frontend/constants.ts`):

```bash
# Printed by `npm run dars:upload` in truthoracle-contracts — no default, fails loudly when unset.
VITE_TRUTHORACLE_PACKAGE_ID=<64-hex package id>
# daml.yaml `name:`; the browser defaults to truthoracle-v17, the server-side client does not.
VITE_TRUTHORACLE_PACKAGE_NAME=truthoracle-v17
```

They are used in two different places and the participant is strict about which goes where:

- **Commands pin the package by id.** Every exercise built in `frontend/utils/cantonCommands.ts`
  carries `templateId = "<packageId>:Truthoracle:<Entity>"` and
  `packageIdSelectionPreference: [<packageId>]`, so the participant resolves the exact version.
- **Active-contracts filters name the package.** `/v2/state/active-contracts` takes the
  package-name reference `"#truthoracle-v17:Truthoracle:<Entity>"` and rejects the id form with
  `INVALID_FIELD` "expected a package name" (`frontend/utils/activeContracts.ts`,
  `api/_lib/ledgerClient.mjs`). Responses still return `templateId` in id form.

---

## Wallets and transaction submission

`frontend/wallets/types.ts` is the one interface both wallet contexts implement
(`CantonWalletContextValue`: `connect`, `disconnect`, `signAndSubmitTransaction`, `transfer`,
`listInstruments`, `signMessage`, `account`, `wallets`, `network`); `frontend/wallets/index.tsx`
picks the implementation from `VITE_WALLET_TYPE`.

### Cantor8 (default — `VITE_WALLET_TYPE=cantor8`)

`frontend/wallets/cantor8/Cantor8WalletContext.tsx` wraps `@cantor8/wallet-connect-sdk` 0.5.1.
The popup holds the user's key and does the whole prepare → sign → execute cycle itself:

- `signAndSubmitTransaction(params)` → SDK `signAndExecute` with the Daml commands and any
  `disclosedContracts` (how orders are signed — the backend prepares them, the popup signs).
- `transfer({ instrumentId, to, amount, memo?, metadata? })` → SDK `send` under the wallet's OWN
  id for the token (`ApiInstrument.walletInstrumentId` — `Amulet` for Canton Coin, `cBYN`, `TRO`):
  the deposit leg of the in-app wallet.
- `listInstruments()` → SDK `getInstruments()`, answered from the SDK session without a popup and
  cached per connected party; the deposit button is disabled for a token the wallet does not list.
- `signMessage(message, partyId)` → the popup signs the admin login challenge and the account's
  wallet-link challenge.
- The account payload carries `publicKey` and `holdings` (the wallet's balances by its own ids).

Every popup-opening call must be the first thing a click handler awaits — the browser grants one
popup per gesture (`frontend/wallets/cantor8/popupGesture.ts`).

### Loop (`VITE_WALLET_TYPE=canton`)

`frontend/wallets/canton/CantonWalletContext.tsx` wraps `@fivenorth/loop-sdk` (`lib/loopSdk.ts`):
`loopConnect()` opens the Loop popup / QR flow, and `signAndSubmitTransaction` either hands the
Daml payload to `provider.submitAndWaitForTransaction()` or, with
`VITE_USE_PARTICIPANT_API=true`, runs the participant's interactive-submission API through the
ledger proxy (`lib/cantonParticipant.ts`: `/v2/interactive-submission/prepare` → `execute`).
The Loop build is Amulet-only: `listInstruments()` returns Canton Coin and `transfer()` refuses,
so deposits in practice run through Cantor8.

### The treasury (Enterprise Wallet) and the accounts backend

The treasury party (`VITE_ENTERPRISE_WALLET_PARTY_ID`) is the signatory on every TruthOracle
contract and its key lives in the self-hosted Cantor8 Enterprise Wallet, never in a browser:

- The **accounts backend** submits everything that needs the treasury's signature on a user's or
  an operator's behalf — `CreateMarket`, `UserWallet` creation and deposit credits
  (`UserWallet.Deposit`), reward grants (`UserWallet.Grant`), payout settlement, instrument setup,
  token-app mint / burn — behind its own sessions, deriving every amount from its ledger index.
- `lib/enterpriseWalletSubmit.ts` is the one browser path to the wallet relay
  (`/__proxy/wallet/api/v1/external/submit`, admin session required — ADMIN_AUTH.md): the payout
  queue's wallet-signed Mark Paid for payouts settled out-of-band. Nothing in this repository
  moves money.

Keycloak client credentials for the ledger and wallet proxies are server-only:

```bash
VITE_CANTON_PARTICIPANT_URL=https://api.validator.dev.digik.cantor8.tech/api/ledger
VITE_KEYCLOAK_URL=...
VITE_KEYCLOAK_REALM=master
KEYCLOAK_CLIENT_ID=...        # no VITE_ prefix — minted by api/proxy/*.mjs, never in the browser
KEYCLOAK_CLIENT_SECRET=...
```

---

## Command Structure

Commands are built in `frontend/utils/cantonCommands.ts` in the Ledger API's JSON shape and
normalised by `utils/normalizeCommand.ts` before they reach a wallet or the participant. Daml
`Int` and `Decimal` fields are JSON strings (the participant rejects raw numbers with "Expected
ujson.Str"); decimals carry the ledger's 10 dp. A `PredictionMarket.Buy` of 25 units of the
market's collateral:

```typescript
{
  actAs: [partyId],
  commands: [
    {
      exercise: {
        templateId: `${TRUTHORACLE_PACKAGE_ID}:Truthoracle:PredictionMarket`,
        contractId: "00abc...",                 // the market's ACTIVE contract id
        choice: "Buy",
        choiceArgument: {
          buyer: partyId,
          side: "Yes",
          amount: "25.0000000000",              // collateral spent, in market.collateral
          minSharesOut: "40.0000000000",        // slippage bound
          nowSeconds: "1760500000",
          existingPosition: null,               // or the Position contract id
          walletCid: "00def...",                // the buyer's UserWallet for market.collateral
        },
      },
    },
  ],
  disclosedContracts: [{ templateId, contractId, createdEventBlob, synchronizerId }],
  packageIdSelectionPreference: [TRUTHORACLE_PACKAGE_ID],
}
```

Argument names follow truthoracle-v17 (`truthoracle-backend/docs/TOKENS.md` §3): `amount`,
`minProceeds`, `valueIncrease`, `maxCost`, `initialValue`, `collateral` — no `CC` suffix anywhere.
Every market choice debits or credits the signer's `UserWallet` **for the market's collateral**
inside the same transaction; a wallet of another instrument is refused on-ledger.

### Command builders

- Market creation has no browser-side builder: the operator console posts to the accounts backend
  (`POST /admin/markets`), which validates the catalog identity and the collateral instrument and
  has the Enterprise Wallet exercise `MarketCounter.CreateMarket` as the treasury.
- **Trading** (`PredictionMarket`): `buildBuyParams(partyId, marketCid, side, amount, minSharesOut,
  existingPositionCid, walletCid, disclosedContracts?)`, `buildSellParams` (`minProceeds`),
  `buildSwapSharesParams`, `buildSplitParams`, `buildMergeParams`,
  `buildProvideLiquidityParams` (`valueIncrease`, `maxCost`), `buildWithdrawLiquidityParams`,
  `buildRedeemPositionParams`. Pass `disclosedContracts` (from the active
  `PredictionMarketRecord`'s `createdEventBlob` and `synchronizerId`) when the signer is an
  external party whose participant cannot see the contract directly — without it the wallet's
  prepare fails to resolve the contract.
- **Resolution**: `buildResolveT0Params`, `buildResolveParams`, `buildProposeOutcomeParams`,
  `buildChallengeOutcomeParams`, `buildFinalizeOutcomeParams`, `buildVoidMarketParams`,
  `buildCreateAttestationParams`; **models**: `buildCommitForecastParams`,
  `buildScoreAndDistributeParams`.
- **Payouts and the in-app wallet**: `buildMarkPaidParams`, `buildCancelPayoutParams`,
  `buildSettleToWalletParams` (treasury-signed, through the backend or the admin relay) and
  `buildWalletWithdrawParams(partyId, walletCid, amount)` — `UserWallet.Withdraw { amount,
  nowSeconds }` on the wallet of ONE instrument, which queues a `PendingPayout` carrying it.
- With an accounts backend the market page does not assemble trades itself:
  `POST /markets/:market/orders/prepare` returns the exact `ExerciseCommand` for the active market
  version and the account's wallet of the market's collateral, and the wallet signs it as-is
  (`lib/marketsApi.ts`). The builders remain the ledger-only fallback.
- The Incentives builders (`UserRewardsSummary.ClaimRewardsBatch`) are gone with
  `Incentives.daml`: rewards are TRO, computed by the backend from its ledger index and credited
  to the account's in-app TRO wallet with `UserWallet.Grant` (docs/TOKENS.md §4.6) — nothing is
  claimed on-ledger. The Aptos-era placeholders (`buildTransferParams`,
  `buildWithdrawPayoutParams`, `buildWriteMessageParams`) and the components that called them
  are gone too: token transfers go through the wallet's `transfer()`, payouts through the backend.

---

## Instruments and money labels

Markets are denominated in a configurable CIP-56 collateral instrument (cBYN once Cantor8 delivers
it, Canton Coin on DevNet until then) and rewards are paid in TRO (truthoracle-backend
docs/TOKENS.md). No wire field carries a currency suffix any more: every money value is read next to
the instrument it is in — `market.collateral`, `wallet.instrument`, `payout.instrument`, a trade's or
position's `instrument` — and `frontend/lib/instruments.ts` turns that into text: `useInstruments()`
reads the catalog once per session (`GET /exchange/instruments`), `formatAmount(value, instrument)`
formats with the instrument's decimals and thousands separators, `formatMoney` appends the symbol,
`quantizeAmount(value, decimals)` floors a withdrawal to the instrument's scale in whole 1e-10 units,
`compactAmount` (lib/chartData.ts) is the card-sized `1.2k cBYN`. A record read straight from the
participant knows only the instrument's identity, so it carries the token id as its symbol until
`resolveInstrument` matches it against the catalog. The external wallet's brand
(`WALLET_DISPLAY_NAME`) is the only fixed label; it is not a currency.

### The external wallet and deposits

Two members of `CantonWalletContextValue` carry the instrument: `transfer({ instrumentId, to,
amount, memo?, metadata? })` wraps the Cantor8 SDK's `wallet.send()` under the wallet's OWN id for
the token (`ApiInstrument.walletInstrumentId` — `Amulet` for Canton Coin), and `listInstruments()`
returns what the connected wallet can send (SDK `getInstruments()`, answered from its session
without a popup and cached per connected party in `Cantor8WalletContext`). `CantonAccount.holdings`
is the wallet's own snapshot of the party's balances by wallet id, labelled through the catalog;
`lib/walletHoldings.ts` (`fetchWalletHoldings`, `holdingFor`) is the refreshing read of the same
figures from the Cantor8 wallet backend's `/api/balance`, one row per token, shown in the header
chip and on the market page for the market's collateral.

`lib/inAppWallet.ts` runs the money flows per instrument. `depositToInAppWallet({ userParty,
instrument, amount, transfer, walletInstruments? })` refuses a token the wallet does not list
before any popup (`missingWalletInstrumentReason` → "Your Cantor8 wallet does not list <symbol>
yet"), sends the transfer under `walletInstrumentId(instrument)` with the memo `TruthOracle:
deposit <amount> <symbol> to in-app wallet` and the metadata `{ kind, amount, instrument }`, then
calls `POST /in-app-wallet/deposits/reconcile { instrument }` and polls the participant for the
credit. `withdrawFromInAppWallet` floors the amount to the instrument's decimals (the treasury
keeps the dust) and signs `UserWallet.Withdraw` on that instrument's wallet.
`fetchAccountBalances(party)` is what the wallet card renders: `GET /in-app-wallet`'s `balances`
(one row per instrument, read by the backend as the treasury) with the participant's
`fetchUserWallets` as the fallback.

### In-app wallet card

`components/InAppWalletCard.tsx` shows one row per instrument: the catalog's default collateral
and rewards instrument always, plus every instrument the account holds a wallet in. Each row has
its own Deposit / Withdraw toggles and amount form (the input's `step` is the instrument's smallest
unit). A parent may pin the card to one instrument (`instrument` prop — the market page passes
its collateral, the Rewards page the rewards token with `actions={["withdraw"]}`) and may manage
the wallet record itself (`wallet` / `walletLoaded`). The account states (A/B/C, anonymous,
unavailable, unreachable) and the one-popup-per-click rules are documented in the file header.

---

## Active contract lookup

The browser reads the ledger through the same-origin ledger proxy (`/__proxy/ledger` →
`api/proxy/ledger.mjs`, read-only paths public — ADMIN_AUTH.md) with
`lib/cantonParticipant.ts` `queryActiveContracts(partyId, templateId, { includeCreatedEventBlob? })`:

1. `GET /v2/state/ledger-end` → `offset`.
2. `POST /v2/state/active-contracts` with a `GetActiveContractsRequest` whose ONLY top-level fields
   are `activeAtOffset` (as a string) and `eventFormat`:

```json
{
  "activeAtOffset": "12345",
  "eventFormat": {
    "filtersByParty": {
      "<partyId>": {
        "cumulative": [
          { "identifierFilter": { "TemplateFilter": { "value": {
            "templateId": "#truthoracle-v17:Truthoracle:PredictionMarket",
            "includeCreatedEventBlob": true } } } }
        ]
      }
    },
    "verbose": false
  }
}
```

The legacy top-level `filter` and `verbose` fields are **disabled on Canton 3.6**
(`DEPRECATED_API_DISABLED`); the verbose flag lives inside `eventFormat` and nowhere else.
`api/_lib/ledgerClient.mjs` (`activeContractsRequest`) builds the identical body server-side and
`test/ledger-client.test.mjs` pins it. The response is an array of `JsGetActiveContractsResponse`;
each `contractEntry.JsActiveContract.createdEvent` carries `contractId`, `createArgument` (the
payload — Daml `Int`/`Decimal` as strings, `InstrumentId` as `{ admin, id }`) and, when asked for,
`createdEventBlob` + `synchronizerId` for a `DisclosedContract`. `docs/active-contracts-api-reference.md`
has the field-by-field reference.

Helpers in `frontend/utils/activeContracts.ts` (each queries as the party that is a stakeholder):

- **`fetchMarketCounterContractId()`** — the active `MarketCounter` (the treasury holds it)
- **`fetchAllPredictionMarkets()`** / **`fetchAllResolvedMarkets()`** /
  **`fetchPredictionMarketContractId(marketId)`** — `PredictionMarketRecord`s with their
  `collateral` instrument (`instrumentRefFromId` until the catalog names it), identity fields,
  reserves and the disclosure blob
- **`fetchUserPosition(partyId, marketId)`** / **`fetchAllUserPositions(partyId)`** — the holder's
  `Position`s (`costBasis` in the market's collateral)
- **`fetchUserLpPosition(partyId, marketId)`** — `LiquidityPosition` (`deposited`)
- **`fetchAttestations`**, **`fetchModelForecasts`** — the resolution console's records
- **`fetchUserWallets(partyId)`** / **`fetchUserWallet(partyId, instrument)`** /
  **`waitForUserWallet(partyId, instrument, predicate)`** — the party's in-app `UserWallet`s, one
  per instrument (`{ admin, id }`); a market only debits or credits the wallet of its own `collateral`
- **`fetchPendingPayouts(partyId)`** — `PendingPayout` rows, each carrying the `instrument` it is owed in

With an accounts backend most pages read the backend's ledger index instead (`lib/marketsApi.ts`,
`lib/marketQueries.ts`) — an external party's own reads come back empty on mainnet, the backend
reads as the treasury — and these helpers are the fallback and the anonymous-wallet path.

### Server-side helpers (`api/_lib`)

`ledgerClient.mjs` mirrors the browser client for Vercel functions: `templateId` (id form, for
commands), `filterTemplateId` (name form, for filters), `activeContracts(party, entity)`,
`fetchUserWallet(adminParty, ownerParty, instrument)` (v17: the owner's wallet of ONE instrument,
with `balance`, `deposited`, `withdrawn`, `creditRefs`) and `fetchPendingPayout(adminParty, cid)`
(with `instrument` and `amount`). `walletClient.mjs` holds the Enterprise Wallet calls:
`transfer({ from, to, instrumentId, amount, … })` (v0.1.35's instrument-aware `/api/v1/transfer`,
amount as the ledger's 10-dp string), `externalSubmit`, `transferStatus`,
`transferAlreadySubmitted`, and the paged history read with `totalReceivedFrom(rows, party,
counterparty, instrumentId)` for operator diagnostics. No `api/` route calls them today: deposit
crediting and payout settlement moved to the accounts backend, which reads its own ledger index
(docs/TOKENS.md §2.5). `upstream.mjs` resolves the ledger / wallet targets and credentials per
network (`ZKPC_*` on mainnet, no fallback).

---

## UI integration

### Operator console (Create Market)

1. `components/Admin/CreateMarketForm.tsx` collects the event, the ticker suffix, the question, the Yes / No labels, the collateral instrument (an enabled collateral of the catalog; locked to the event's instrument once it has one), the pm-AMM seed and the resolution policy — seed and bond are in the collateral
2. Submits `POST /admin/markets` to the accounts backend under a backend operator session (`lib/backendAdmin.ts`)
3. The backend checks the event and the ticker against the catalog, then the Enterprise Wallet signs `MarketCounter.CreateMarket`; the market appears once the indexer sees it

### Trade ticket

1. On mount, the market page loads the market from the index (or `fetchAllPredictionMarkets` with `includeCreatedEventBlob: true` on a ledger-only deployment) and the account's `Position`, `LiquidityPosition` and `UserWallet` for the market's collateral (`fetchMyMarketView`, falling back to the participant), plus the external wallet's holdings for the collateral.
2. On "Buy", the page asks the backend to prepare the order (the common path), or — ledger-only — builds a single-entry `disclosedContracts` array from the active record and calls `buildBuyParams(..., marketCid, side, amount, minSharesOut, positionCid, walletCid, disclosed)`.
3. Submits via `signAndSubmitTransaction(params)` — the Cantor8 wallet forwards `disclosedContracts` to its participant's prepare call — then waits on `GET /ledger/wait` and reloads from the index.

### Rewards

Nothing is claimed in the browser. The backend's rewards processor computes TRO grants from its
ledger index and credits them to the account's in-app TRO wallet with `UserWallet.Grant`
(docs/TOKENS.md §4.6). `lib/rewards.ts` holds the shapes (`RewardGrant`, `RewardsOverview`,
`RewardRule`, `RewardsFloat`), `fetchMyRewards()` (`GET /me/rewards`; a 404 means no rewards
instrument is configured and reads as such) and the plain-words labels for rule kinds and grant
statuses. `components/Rewards.tsx` shows the TRO balance, the credited / queued totals, the grants
with kind, amount, status and time, explains the rule kinds, and offers "Withdraw TRO to your
Cantor8 wallet" through the in-app wallet card pinned to the rewards instrument (the common
withdraw flow). The Aptos-era `blockend/`, `utils/cantonClient.ts` and the claim-rewards UI are gone.

### Card ramp (buy and cash out with a bank card)

truthoracle-backend docs/RAMP.md. `lib/ramp.ts` is the client and the wording: `GET /ramp`
(enabled, fees, limits with what remains, the card hold, why the account may not use a
direction), the quote, `startCardPurchase` (opens the order with an `Idempotency-Key` and returns
the acquirer's hosted checkout URL — card entry and 3-D Secure never touch this app) and
`cashOutToCard` (opens the cash-out, signs `UserWallet.Withdraw` for exactly its amount with the
common withdraw builder, finds the new PendingPayout and calls `attach`; if the page dies after the
signature the backend binds it on its scan). `components/ramp/CardRampCard.tsx` sits under the
in-app wallet on /portfolio and renders nothing until the backend reports the ramp enabled;
`RampOrderPage` (`/wallet/ramp/:orderId`, where the checkout returns) polls the order until only an
operator can move it — the redirect's query string decides nothing; `MockCheckoutPage`
(`/wallet/ramp/mock-checkout`) is the mock acquirer's page on dev / test deployments. The relay
forwards `idempotency-key` (api/proxy/backend.mjs). A plain withdrawal of card-bought value inside
the hold shows "On hold (card purchase)" in the payouts table and settles by itself.

### Operator console

`/admin` (components/Admin) runs on two sessions: the Vercel `to_admin` session (AdminGate, the
payout queue's relays) and the backend operator session, held once by
`BackendOperatorSession.tsx` (`BackendOperatorProvider`, `useBackendOperator`,
`OperatorSessionCard`) so every backend-backed panel agrees on whether an operator is signed in.
`lib/backendAdmin.ts` is the client: catalog and market factory (CatalogPanel, CreateMarketForm),
the instrument registry (`fetchAdminInstruments`, `createInstrument`, `updateInstrument`,
`setupInstrument` — InstrumentsPanel: list, add, enable/disable, default collateral, edit symbol /
name / decimals / transfer mode / registry wiring / wallet id, and the confirmed AutoAccept /
MintDelegation setup, reported per action with the choice exercised and its command status),
Cantor8's token-app (`fetchTokenStatus`, `mintTokens`, `burnTokens` — TokensPanel: token-app
status, treasury holdings vs in-app liabilities per instrument, mint to the treasury or
mint-and-credit a user, burn) and rewards (`fetchRewardRules`, `updateRewardRule`, `grantReward`,
`fetchRewardGrants`, `fetchRewardsFloat` — RewardsPanel: the float with the grants in flight, rule
toggles and parameters, manual grant, the newest page of grants by status). Every mint, burn and
rule change carries a reason the backend keeps on its audit row — the forms require one before the
button enables. Every action runs through `useRun` (adminUi.tsx) for one busy state, reload and
toast convention.

---

## Testing

### With the Cantor8 wallet (default)
1. `VITE_WALLET_TYPE=cantor8` (or unset) and a DevNet `.env` (see `.env.example`)
2. Run `npm run dev`, sign in (Google / Telegram) when a backend is configured, connect the Cantor8 wallet and link it to the account
3. Deposit (a wallet transfer of the collateral token to the treasury), trade, withdraw; the Rewards page shows TRO once the backend credits a grant

### With Loop
1. `VITE_WALLET_TYPE=canton`, `VITE_LOOP_NETWORK=devnet`; install the Loop extension or use https://cantonloop.com
2. Ensure your party has visibility of the TruthOracle contracts on devnet
3. Run `npm run dev` and connect; trading works, deposits do not (Amulet-only, no token `send`)

### With the participant's interactive-submission API (Loop context only)
1. Set `.env`:
   ```bash
   VITE_WALLET_TYPE=canton
   VITE_USE_PARTICIPANT_API=true
   VITE_CANTON_PARTICIPANT_URL=https://api.validator.dev.digik.cantor8.tech/api/ledger
   VITE_KEYCLOAK_URL=...
   KEYCLOAK_CLIENT_ID=...
   KEYCLOAK_CLIENT_SECRET=...
   ```
2. The ledger proxy mints the token; the browser calls `/__proxy/ledger` with no credentials
3. Run `npm run dev` — transactions go to `/v2/interactive-submission/prepare` and `/execute`

`npm test` runs the unit suite (`test/*.test.mjs`, `node --test` with the TypeScript loader in
`test/_support/frontend-loader.mjs`): the instrument helpers, the deposit / reconcile flow, the
rewards and portfolio shapes, the ledger and wallet clients against stubbed upstreams, the admin
auth stack and the proxies.

---

## Troubleshooting

### "Market counter not found"
- Ensure the `MarketCounter` contract has been created by the treasury party on the participant (`npm run create:contract` in `truthoracle-contracts`)
- Check that `VITE_TRUTHORACLE_PACKAGE_ID` / `VITE_TRUTHORACLE_PACKAGE_NAME` match the deployed DAR
- Verify the party has visibility (is signatory or observer on MarketCounter)

### active-contracts returns `[]` (empty array)

1. **MarketCounter not created yet**  
   Create it once with the treasury party using `npm run create:contract` in the `truthoracle-contracts` repository, with the same values in its `.env` as the app (`VITE_CANTON_PARTICIPANT_URL`, `VITE_TRUTHORACLE_*`, `VITE_KEYCLOAK_URL`/`_REALM`, `KEYCLOAK_CLIENT_ID`/`_SECRET`, and `VITE_ENTERPRISE_WALLET_PARTY_ID`). Until that succeeds, there is no contract to see.

2. **Party mismatch**  
   You must query with the **exact party** that is signatory (or observer) on the contract. For `MarketCounter`, only the **admin** (treasury) party is signatory. If the UI uses a different party (e.g. another wallet), that party gets `[]`. On mainnet an external party's own reads come back empty altogether — that is why account-backed pages read the backend's index.

3. **Wrong participant / URL**  
   The app uses `VITE_CANTON_PARTICIPANT_URL` for both creating (script) and querying (frontend). If the script was run against a different base URL than the app, contracts are not visible. Use the same participant URL everywhere.

4. **Response shape**  
   Enable debug to see the raw response:
   ```bash
   VITE_DEBUG_ACTIVE_CONTRACTS=true
   ```
   Then open DevTools → Console; when the app fetches active contracts you see `[active-contracts]` with `partyId`, `templateIdStr`, `raw`, etc.

### active-contracts returns 400 / 500

- `DEPRECATED_API_DISABLED` — the request carried the legacy top-level `filter` or `verbose`; Canton 3.6 wants `eventFormat` only (see "Active contract lookup")
- `INVALID_FIELD … expected a package name` — the template filter used the package-id form; filters take `#<name>:Module:Entity`
- Otherwise check participant logs (template not found, party not authorized) and that the package is uploaded and vetted on the participant

### Creating MarketCounter via CLI / curl

If you see **"Market counter not found on this participant"**, create the counter once as the treasury party. The recommended way is `npm run create:contract` in the `truthoracle-contracts` repository (its `.env` names the participant, the package and `VITE_ENTERPRISE_WALLET_PARTY_ID`). The treasury party is the Enterprise Wallet's account (`npm run create:account` there); do **not** substitute the validator / participant infrastructure party (`VALIDATOR_PARTY` in Cantor8's playground examples) — it is not the TruthOracle admin. To find a party id: `GET /v2/parties` on the participant, the connected account's `account.address` in the app, or your operator's documentation.

Manual curl, replacing `BASE_URL`, `ADMIN_PARTY_ID`, `PACKAGE_ID` and `TOKEN`:

**1. Get a synchronizer ID**

```bash
curl -s -X GET "${BASE_URL}/v2/state/connected-synchronizers?party=${ADMIN_PARTY_ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json"
```

Use the first `synchronizerId` from the `connectedSynchronizers` array.

**2. Prepare the create command**

```bash
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
          "createArguments": { "admin": "'"${ADMIN_PARTY_ID}"'", "value": "0" }
        }
      }
    ],
    "actAs": [ "'"${ADMIN_PARTY_ID}"'" ],
    "readAs": [],
    "disclosedContracts": [],
    "packageIdSelectionPreference": [ "'"${PACKAGE_ID}"'" ]
  }'
```

From the response, take `preparedTransaction`.

**3. Execute**

```bash
curl -s -X POST "${BASE_URL}/v2/interactive-submission/execute" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{ "preparedTransaction": "'"${PREPARED_TRANSACTION}"'" }'
```

(For a participant-hosted party; the Enterprise Wallet's `/api/v1/external/submit` does the same with the treasury's key.) After a successful execute, the participant has one active `MarketCounter` contract; the operator console can then create markets.

### "Market contract not found" (when buying shares)
- The `PredictionMarket` for that market ID must exist on the participant
- Check that the market was created via `CreateMarket` and is visible to the user, or pass the disclosed contract (the backend's prepared order does)

### Transaction rejected
- Check that the party has authorities (signatory/controller) for the choice
- Verify all required contract IDs are correct and ACTIVE (a trade on an archived market version fails with CONTRACT_NOT_FOUND — reload from the index)
- "wallet holds a different instrument than the market's collateral": the `UserWallet` passed is for another token — deposit the market's collateral first
- Check choice arguments match the DAML template signature (v17 names)
- Review participant logs for detailed error messages

---

## References

- **DAML Contracts:** `daml/daml/Truthoracle.daml` (truthoracle-v17) in the `truthoracle-contracts` repository; the token design is `truthoracle-backend/docs/TOKENS.md`
- **Backend API:** `truthoracle-backend/docs/API.md` (markets, orders, in-app wallet, rewards, admin)
- **Canton Interactive Submission API:** [Canton docs](https://docs.digitalasset.com/build/3.4/tutorials/app-dev/external_signing_submission_part_2.html)
- **JSON Ledger API active contracts:** `docs/active-contracts-api-reference.md`
- **Cantor8 wallet-connect SDK:** `@cantor8/wallet-connect-sdk`
- **Loop SDK:** [@fivenorth/loop-sdk](https://www.npmjs.com/package/@fivenorth/loop-sdk)
- **Canton Network:** https://www.canton.network/
