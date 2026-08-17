# TruthOracle Scanner / Indexer — Requirements & Architecture

**Status:** Draft v1.0 for review with the Cantor8 Scanner team

**Owner:** TruthOracle

**Package under discussion:** `truthoracle-v12`
(`317054909e97d941498386868b69ca6c0938f6e6c97e615cca507466b68bacad`)

---

## 1. Purpose

TruthOracle is a prediction market on Canton. The application currently reads only current ledger
state, via `POST /v2/state/active-contracts`.

The features we have queued — price charts, volume, TVL, trade feeds, portfolio P&L, leaderboards —
are all questions about history rather than state. This document sets out the event capture we need,
the datasets we derive from it, and a proposed split of responsibility between the Cantor8 Scanner
and a TruthOracle-owned projection layer.

The immediate driver is charting on the market pages. The same pipeline is also a prerequisite for
accounting, dispute forensics and the prediction-model marketplace payouts, so we would prefer to
design it once rather than add a chart cache to the frontend.

One important caveat on scope. What follows describes a very early version of TruthOracle. The DAML
is still moving and we expect it to expand considerably over the coming months, with more templates,
more choices on the existing ones, and further package versions as the market types, resolution
tiers and the model marketplace fill out. The template list in section 4 should therefore be read as
a starting set rather than a fixed one. Whatever we build together needs to absorb that growth:
adding a template, a choice or a package version should be a configuration change rather than a
redesign. We have tried to write section 6 with that in mind, and it is the main reason we favour
keeping raw events separate from the projections built on top of them.

---

## 2. Our architecture today

Two wallet paths write to the ledger. Users sign through the Cantor8 popup wallet; the admin (house)
party signs through a self-hosted Enterprise Wallet.

```text
  User (external party)              Admin / house party
  Cantor8 popup wallet               Enterprise Wallet (Docker v0.1.28)
  @cantor8/wallet-connect-sdk        POST /api/v1/external/submit
         │                                    │
         │ signAndExecute()                   │ prepare + sign + execute
         ▼                                    ▼
  C8 wallet's participant            wallet backend's synchronizer
         └──────────────┬─────────────────────┘
                        ▼
                 Canton ledger
                        │  read via C8 validator participant
                        ▼
              /v2/state/active-contracts   ← all we use today
              /v2/updates/flats            ← what we need
```

We do not operate a participant of our own. We read through the C8 validator at
`api.validator.dev.digik.cantor8.tech/api/ledger`, so pruning, retention and stream access are
governed by the validator's configuration. That is the background to most of the questions in
section 8.

### Collateral rail

Canton Coin never moves inside our DAML. The design is deliberately two-step:

- **Buy, Split, ProvideLiquidity, bonds.** The frontend triggers a CC transfer to the admin party
  through the popup, then exercises the choice. The contract does not verify that the transfer
  happened.
- **Sell, Merge, Redeem, payouts.** The choice creates a `PendingPayout` contract. The admin settles
  off-ledger and calls `MarkPaid(txHash)`.

A buy therefore appears on the ledger as two unrelated transactions: an Amulet transfer and a `Buy`
exercise. See B3 in section 7.

### 2.1 Transaction format — Enterprise Wallet (admin)

Self-hosted `cantor8technologies/enterprise-wallet:v0.1.28`. Keys are a BIP39 mnemonic held in the
container. A single call performs prepare, sign and execute.

```http
POST http://localhost:8080/api/v1/external/submit
Content-Type: application/json
```

```json
{
  "partyId": "<admin party id>",
  "appName": "truthoracle",
  "commandId": "cmd-<unique>",
  "commands": [
    {
      "ExerciseCommand": {
        "templateId": "<pkgId>:Truthoracle:MarketCounter",
        "contractId": "00abc...",
        "choice": "CreateMarket",
        "choiceArgument": { "question": "...", "expiresAt": "..." }
      }
    }
  ],
  "disclosedContracts": []
}
```

Used for `CreateMarket`, `ResolveT0`, `Resolve`, `VoidMarket`, `ScoreAndDistribute` and `MarkPaid`.

In our testing the wallet's `GET /api/v1/command/{partyId}/{commandId}` status has not consistently
reflected participant state, so we have not found a way to map our `commandId` to a ledger
transaction from the wallet side. It is quite possible we are using it wrongly, and we would welcome
a correction.

### 2.2 Transaction format — Cantor8 popup wallet (users)

`@cantor8/wallet-connect-sdk` 0.3.0 or later. The connected party is an external / self-custody
party, and the wallet's own participant prepares, signs and executes.

```js
wallet.signAndExecute({
  note: "TruthOracle transaction",
  partyId: "<user party id>",
  commandId: "<uuid>",
  commandsJson: JSON.stringify(commands),           // string, not an array
  disclosedContracts: JSON.stringify(disclosed),    // string, not an array
});
```

`commandsJson` and `disclosedContracts` are both JSON strings rather than arrays (confirmed with
Vasiliy), where `commands` is:

```json
[
  {
    "ExerciseCommand": {
      "templateId": "<pkgId>:Truthoracle:PredictionMarket",
      "contractId": "00...",
      "choice": "Buy",
      "choiceArgument": {
        "buyer": "<user party id>",
        "side": "Yes",
        "collateralCC": "10.0",
        "minSharesOut": "18.0",
        "nowSeconds": "1754...",
        "existingPosition": null
      }
    }
  }
]
```

and `disclosed` is:

```json
[{ "createdEventBlob": "...", "synchronizerId": "..." }]
```

The promise does not carry the result; resolution arrives through events — `txInitiated` carries
`txId`, `txChanged` with `status=failed` means the submission was rejected, and `operationCanceled`
means the user closed the popup.

Used for `Buy`, `Sell`, `SwapShares`, `Split`, `Merge`, `ProvideLiquidity`, `WithdrawLiquidity`,
`RedeemPosition`, `ProposeOutcome`, `ChallengeOutcome` and `CommitForecast`. CC transfers go through
`wallet.send({ senderPartyId, instrumentId: "Amulet", amount, receiverPartyId, memo, metadata })`,
with the SDK handling AmuletRules and OpenMiningRound internally.

Disclosed contracts matter here because the user's party lives on the C8 wallet's participant and
cannot resolve our `PredictionMarket` contract id directly. We pass `createdEventBlob` and
`synchronizerId` from the active-contracts query so the wallet's participant can. Any indexer we
build has to request `includeCreatedEventBlob: true` for this to keep working.

---

## 3. Why reading current state is not enough for us

`PredictionMarket` is a single template that mutates by recreation. Every trading choice (`Buy`,
`Sell`, `SwapShares`) is consuming: it archives the current market contract and creates a successor
carrying the new `currentPrice`, `reserveYes`, `reserveNo` and `totalVolumeCC`. A market's entire
price history therefore already exists on the ledger, as an ordered chain of created events.

The ACS endpoint returns only the newest link in that chain. Everything before it is archived, and
archived contracts are invisible to `/v2/state/active-contracts` by design.

Three consequences follow:

1. History cannot be reconstructed from state after the fact. Data for any period before we start
   listening is recoverable only from the update stream, and only while the participant has not
   pruned it.
2. Not all activity is in the chain. `Split`, `Merge`, `RedeemPosition` and `CommitForecast` are
   non-consuming choices. They never archive or recreate the market, so they are observable only as
   an exercise node, not as a state delta.
3. Trades cannot be attributed. The successor contract records that the price moved from 0.42 to
   0.47, but not who traded, on which side, or for how much. That is in the choice arguments of the
   exercise node (`buyer`, `side`, `collateralCC`).

This is why we are asking about a ledger-effects (transaction tree) update stream rather than a flat
/ ACS-delta stream or ACS polling.

---

## 4. Ledger surface to be indexed

### 4.1 Template visibility matrix

The TruthOracle admin party is the Enterprise Wallet party (`VITE_ENTERPRISE_WALLET_PARTY_ID`).
Because admin is signatory or observer nearly everywhere, a single subscription as that one party
covers almost the whole protocol:

| Template | Module | Signatory | Observers | Visible to admin? |
|---|---|---|---|---|
| `PredictionMarket` | Truthoracle | `admin` | `auditObservers`, `policy.reporters` | ✅ signatory |
| `MarketCounter` | Truthoracle | `admin` | — | ✅ signatory |
| `PendingPayout` | Truthoracle | `admin` | `user` | ✅ signatory |
| `Position` | Truthoracle | `holder` | `admin`, `auditObservers` | ✅ observer |
| `LiquidityPosition` | Truthoracle | `provider` | `admin`, `auditObservers` | ✅ observer |
| `OutcomeAttestation` | Truthoracle | `attester` | `admin` | ✅ observer |
| `ModelForecast` | Truthoracle | `author` | `admin`, `auditObservers` | ✅ observer |
| `PredictionModel` | Marketplace | `author` | `admin` | ✅ observer |
| `ClaimedReward` | Incentives | `user` | — | ❌ **not visible** |
| `UserRewardsSummary` | Incentives | `user` | — | ❌ **not visible** |

> **Gap: needs a DAML change, not a Scanner change.** The two `Incentives` templates have `user` as
> sole signatory and no observers, so no indexer subscribed as admin can see them however the
> Scanner is built. Rewards issuance and claims are consequently unauditable and unchartable today.
> The fix is to add `observer admin` to `ClaimedReward` and `UserRewardsSummary` in the next package
> version. Tracked on our side, noted here so the Scanner team does not spend time on them.

One party subscription covers everything else. We do not need per-user subscriptions, and the
Scanner would not have to manage a growing set of parties.

### 4.2 Event catalogue

**`MarketCounter`**

| Choice | Emits | Indexed for |
|---|---|---|
| `CreateMarket` | new `PredictionMarket`, seed `LiquidityPosition`, new counter | market registry, genesis price, initial L₀ |
| `IncrementCounter` | new counter | — |

**`PredictionMarket` — trading** (consuming; archives and recreates the market)

| Choice | Key choice arguments | Indexed for |
|---|---|---|
| `Buy` | `buyer`, `side`, `collateralCC`, `minSharesOut`, `nowSeconds` | price series, volume, trade feed, per-user flow |
| `Sell` | `seller`, `side`, `sharesIn`, `minProceedsCC` | price series, volume, trade feed, payout queue |
| `SwapShares` | `swapper`, `fromSide`, `sharesIn` | price series, volume (priced at `sharesIn × fromPrice`) |

**`PredictionMarket` — non-consuming** (no market state delta; exercise node only)

| Choice | Key choice arguments | Indexed for |
|---|---|---|
| `Split` | `user`, `amount` | outstanding complete sets, collateral solvency |
| `Merge` | `user`, `amount` | outstanding complete sets, payout queue |
| `RedeemPosition` | `holder` | settlement flow, realised P&L |
| `CommitForecast` | `author`, `modelId`, `probabilityYes` | model leaderboard, proof-of-priority |

**`PredictionMarket` — liquidity**

| Choice | Key choice arguments | Indexed for |
|---|---|---|
| `ProvideLiquidity` | `provider`, `valueIncreaseCC`, `maxCostCC` | TVL series, LP roster |
| `WithdrawLiquidity` | `provider`, `lpTokensToBurn` | TVL series, LP P&L |

**`PredictionMarket` — resolution**

| Choice | Key choice arguments | Indexed for |
|---|---|---|
| `ResolveT0` | `resolvedOutcome`, `sourceUri` | resolution timeline, operator audit |
| `Resolve` | `attestationCids` | resolution timeline, T1/T2 evidence chain |
| `ProposeOutcome` | `proposer`, `proposedOutcome` | T3 optimistic flow, bond accounting |
| `ChallengeOutcome` | `challenger`, `challengerOutcome` | dispute rate metric |
| `FinalizeOutcome` | `finalizer` | time-to-resolution metric |
| `VoidMarket` | — | void rate metric |
| `ScoreAndDistribute` | `forecastCids` | model prize distribution |

**Settlement and supporting templates**

| Template · Choice | Indexed for |
|---|---|
| `PendingPayout` create | obligations outstanding, treasury exposure |
| `PendingPayout.MarkPaid(txHash)` | off-ledger settlement reconciliation: links a CC transfer hash to the on-ledger obligation |
| `PendingPayout.CancelPayout` | exception reporting |
| `OutcomeAttestation` create | resolution evidence, source reliability stats |
| `ModelForecast` create | leaderboard inputs |
| `PredictionModel` create / `UpdateModelInfo` / `RetireModel` | model registry |

`MarkPaid` is worth calling out. Because the collateral rail is two-step, the `txHash` recorded
there is the only join key between our on-ledger obligations and actual Canton Coin movement. Any
treasury or solvency dashboard depends on capturing it.

---

## 5. Datasets we need to derive

These projections feed the product. They are TruthOracle-specific and, in our view, belong on our
side of the boundary (section 6).

| Dataset | Grain | Source events | Feeds |
|---|---|---|---|
| `market_price_history` | market × ledger offset | `PredictionMarket` creates | probability chart, card sparkline |
| `trades` | one row per trade | `Buy` / `Sell` / `SwapShares` exercises | volume bars, trade feed, order flow |
| `market_daily_stats` | market × day | rollup of `trades` | 24h volume, 24h change, ranking |
| `liquidity_history` | market × offset | `ProvideLiquidity` / `WithdrawLiquidity` + reserves | TVL chart, depth |
| `positions_history` | holder × market × offset | `Position` create/archive pairs | portfolio value over time, holder distribution |
| `payouts` | one row per obligation | `PendingPayout` lifecycle | treasury dashboard, settlement SLA |
| `resolutions` | market | resolution choices + attestations | resolution timeline, dispute rate |
| `model_scores` | model × market | `ModelForecast` + realised outcome | Brier leaderboard |

### Derivation notes that affect correctness

These are traps we have already hit in our own contracts, listed so whoever implements the indexer
does not have to rediscover them.

- **Use ledger `recordTime` as the time axis, not the payload.** Every choice takes a
  client-supplied `nowSeconds`, and the contracts do not validate it against ledger time. It is
  untrusted input. Key charts on `recordTime` and order by `offset`. Store `createdAt` /
  `nowSeconds` / `fetchedAt` as claims, not facts.
- **Do not derive volume by diffing `totalVolumeCC`.** It accumulates in inconsistent units: `Buy`
  adds gross collateral including fee, `Sell` adds pre-fee proceeds, `SwapShares` adds `sharesIn ×
  fromPrice`. Compute volume from the exercise arguments and keep the field as a reconciliation
  checksum.
- **Key market state on payload `marketId`, not `contractId`.** The contract id changes on every
  trade; `marketId` is the stable identity.
- **Complete sets are not in the market payload.** `Split` and `Merge` mint and burn YES+NO pairs
  against collateral without touching `reserveYes` or `reserveNo`. Outstanding sets exist only as
  the running sum of `Split` minus `Merge` exercises, so TVL or solvency computed from reserves
  alone is wrong.
- **`L_eff` is a function of time, not an event.** Effective liquidity decays as
  `L₀·√((T−t)/(T−t₀))` for dynamic pools. Compute it at read time from `liquidityL`, `isDynamic`,
  `createdAt`, `liquidityPeriodSecs` and `expiresAt`.
- **Decimals should not go through floating point.** The JSON Ledger API serialises Daml `Decimal`
  as strings. Store as `NUMERIC(38,10)`; cumulative volume in `float8` will drift visibly.

---

## 6. Architecture options

### 6.1 The two layers

The pipeline separates into two layers. Who owns each is the main thing we would like to settle in
this review.

**Raw event capture.** Subscribing to the ledger, checkpointing offsets, surviving restarts,
backfilling, handling retention, and delivering events in order. This work is the same regardless of
what the contracts mean.

**Domain projection.** Turning those events into product data: reading the difference between two
`PredictionMarket` contracts as a pm-AMM price tick, scoring forecasts on a Brier basis gated by the
market price at commit time, tracking that `Split` and `Merge` affect solvency but not reserves.
This depends on our DAML and changes when our DAML changes.

The two layers have different rates of change, which is why we describe them separately rather than
as a single "indexer".

### 6.2 Options

**Option A — TruthOracle builds and runs both layers.** We subscribe directly to the participant's
JSON Ledger API as the admin party. This gives us full control and no external dependency, and we
estimate about two weeks to a first version. The trade-off is that we own capture uptime: if our
consumer is down for longer than the retention window, that history is not recoverable.

**Option B — the Scanner covers both layers.** The Scanner indexes our templates and exposes query
APIs, and we build no infrastructure. The trade-off is that projection logic changes whenever our
DAML changes, so each change would need to be scheduled with the Scanner team. Whether this falls
within the Scanner's scope is a question for you.

**Option C — the Scanner owns raw capture, TruthOracle owns projection.** C8 provides a durable,
replayable, ordered event feed for our templates with a stated retention window. We run the
projection service, database and read API. This is our starting preference, but it depends on the
answers in section 8, and A or B are both workable.

```text
Canton participant
      │
      │  ledger-effects update stream, admin party,
      │  filtered to truthoracle-v12 templates (+ Amulet, see B3)
      ▼
┌───────────────────────────────────┐
│  Raw event capture                │   ← ownership TBD (C8 Scanner or TruthOracle)
│  offset checkpoint · replay ·     │      guarantees: ordered, gap-free,
│  retention                        │      replayable from offset, retained N days
└───────────────┬───────────────────┘
                ▼
┌───────────────────────────────────┐
│  TruthOracle projection service   │   ← TruthOracle owns
│  event → domain decoder           │
│  price / volume / TVL / P&L       │
└───────────────┬───────────────────┘
                ▼
        Postgres + TimescaleDB
                │
                ▼
        Read API (REST/GraphQL)
                │
                ▼
        TruthOracle frontend charts
```

These options are not mutually exclusive over time. If the raw event contract in 6.3 is agreed up
front, we can start on Option A against the participant now and move the capture layer to the
Scanner later without changing projection code.

### 6.3 What we would need from the capture layer

These are the same whether the Scanner or our own consumer fills the role:

| Area | What we would need |
|---|---|
| Shape | Ledger-effects / transaction-tree events: created, archived **and** exercised nodes. Flat / ACS-delta alone does not carry the exercise nodes (section 3). |
| Filter | Templates in `truthoracle-v12`, modules `Truthoracle` and `Marketplace`, as party = TruthOracle admin. Plus Amulet transfers for the admin party (B3). |
| Ordering | Strict ledger offset order, gap-free. |
| Delivery | At-least-once is fine; we key on `(offset, nodeId)` and upsert idempotently. |
| Resumption | Resume from an arbitrary stored offset after downtime. |
| Backfill | Replay from ledger begin, or from the earliest retained offset. |
| Metadata per event | `offset`, `updateId`, `recordTime`, `synchronizerId`, `commandId`, `workflowId`, acting parties, `contractId`, `templateId`, `choice`, `choiceArgument`, `createArgument`, `exerciseResult`. |
| Retention | Open question, see section 8. |
| Latency | Under 5s from commit to availability is comfortable. |
| Extensibility | New templates, new choices and new package versions addable without re-architecting: filters driven by configuration, and raw events retained undecoded so a later projection can be backfilled from existing history. See section 1 on expected growth. |

### 6.4 Reference request shape

For Canton 3.4 the endpoint is `POST` / WebSocket `/v2/updates/flats`, which despite the name
carries the shape selected by `transactionShape`. Universal Event Streams landed in 3.3 and replaced
the older `filter` field with `updateFormat`:

```json
{
  "beginExclusive": "<last processed offset>",
  "updateFormat": {
    "includeTransactions": {
      "transactionShape": "TRANSACTION_SHAPE_LEDGER_EFFECTS",
      "eventFormat": {
        "filtersByParty": {
          "<admin party id>": {
            "cumulative": [
              { "identifierFilter": { "TemplateFilter": { "value": {
                  "templateId": "#truthoracle-v12:Truthoracle:PredictionMarket",
                  "includeCreatedEventBlob": true } } } }
            ]
          }
        },
        "verbose": true
      }
    }
  }
}
```

Two notes from our existing integration:

- The filter requires a package-name reference (`#truthoracle-v12:Module:Entity`). A package-id is
  rejected with `INVALID_FIELD: Received an identifier with package ID, but expected a package
  name.` Responses come back in package-id form; that asymmetry is expected.
- Ledger API auth is Keycloak `client_credentials` with short-lived tokens, so a long-lived stream
  needs token refresh mid-connection plus reconnect at the last offset.

Exact field names should be confirmed against the participant's own OpenAPI / AsyncAPI definitions,
since the 3.2 shape used a top-level `filter` and this changed in 3.3.

### 6.5 Storage sketch

```sql
-- Immutable raw log; every table below is a pure function of it.
CREATE TABLE ledger_events (
  offset          BIGINT, node_id INT, update_id TEXT, record_time TIMESTAMPTZ,
  synchronizer_id TEXT, command_id TEXT, template_id TEXT, contract_id TEXT,
  event_type      TEXT, acting_parties TEXT[], payload JSONB,
  PRIMARY KEY (offset, node_id)
);

CREATE TABLE markets (
  market_id  BIGINT PRIMARY KEY, question TEXT, category TEXT,
  created_at TIMESTAMPTZ, expires_at TIMESTAMPTZ, is_dynamic BOOLEAN,
  fee_bps    INT, policy JSONB, current_status TEXT
);

CREATE TABLE market_state_history (            -- hypertable
  market_id BIGINT, offset BIGINT, record_time TIMESTAMPTZ, contract_id TEXT,
  current_price NUMERIC(38,10), reserve_yes NUMERIC(38,10), reserve_no NUMERIC(38,10),
  liquidity_l NUMERIC(38,10), lp_token_supply NUMERIC(38,10),
  total_volume_cc NUMERIC(38,10), accumulated_fees_cc NUMERIC(38,10),
  prize_pool_cc NUMERIC(38,10), status TEXT,
  PRIMARY KEY (market_id, offset)
);

CREATE TABLE trades (                          -- hypertable
  offset BIGINT, node_id INT, market_id BIGINT, trader TEXT, kind TEXT, side TEXT,
  collateral_cc NUMERIC(38,10), shares NUMERIC(38,10),
  price_before NUMERIC(38,10), price_after NUMERIC(38,10), fee_cc NUMERIC(38,10),
  PRIMARY KEY (offset, node_id)
);

CREATE TABLE positions_history (
  holder TEXT, market_id BIGINT, offset BIGINT, yes_shares NUMERIC(38,10),
  no_shares NUMERIC(38,10), cost_basis_cc NUMERIC(38,10),
  PRIMARY KEY (holder, market_id, offset)
);

CREATE TABLE liquidity_history (
  market_id BIGINT, offset BIGINT, provider TEXT,
  lp_tokens_delta NUMERIC(38,10), deposited_cc_delta NUMERIC(38,10),
  PRIMARY KEY (market_id, offset)
);

CREATE TABLE payouts (
  contract_id TEXT PRIMARY KEY, market_id BIGINT, "user" TEXT,
  amount_cc NUMERIC(38,10), reason TEXT,
  created_offset BIGINT, paid_offset BIGINT, tx_hash TEXT, state TEXT
);

CREATE TABLE resolutions (
  market_id BIGINT PRIMARY KEY, tier TEXT, outcome TEXT, resolved_at_offset BIGINT,
  proposer TEXT, challenger TEXT, attestation_ids TEXT[]
);

CREATE TABLE model_forecasts (
  contract_id TEXT PRIMARY KEY, market_id BIGINT, author TEXT, model_id TEXT,
  probability_yes NUMERIC(38,10), market_price_at_commit NUMERIC(38,10),
  committed_offset BIGINT
);
```

`ledger_events` as an append-only raw log is the important part: every other table is a pure
function of it, so a projection bug is fixed by replaying rather than by re-querying a ledger that
may have pruned. It is also what makes the design extensible. When we add templates or choices, the
new projection can be backfilled from events already captured, provided the raw payload was stored
undecoded at the time.

Hypertables on `market_state_history` and `trades` (TimescaleDB), with continuous aggregates for the
1m/5m/1h/1d rollups the charts consume.

---

## 7. Blockers

**B1 — history only accumulates from the point capture starts.** Anything not captured before the
participant prunes cannot be recovered later. This is the reason we would like to begin Phase 1
early, even in a limited form.

**B2 — retention settings sit with the validator.** Pruning, retention and stream access are
configured on the C8 side, so we would need those figures from you before we can size the rest of
the design.

**B3 — the collateral leg has no on-ledger link to the trade.** A buy is an Amulet transfer plus a
`Buy` exercise, submitted separately, with nothing joining them. Reconciling trades against actual
CC movement requires Amulet transfer events for the admin party to be indexed alongside our
templates. If the Scanner already decodes Splice Amulet events, reusing that would save us a good
deal of work.

Proposal: we start writing `marketId` and `commandId` into the `memo` / `metadata` fields of
`wallet.send()`, giving a real join key instead of matching on party, amount and time window. We
would welcome your view on whether the memo survives to the ledger event intact.

**B4 — we have not found a way to correlate `commandId` to a ledger transaction.** The Enterprise
Wallet command status has not matched participant state in our testing, and the popup SDK surfaces
`txId` only through an event. Any guidance on the intended pattern here would help.

**B5 — `Incentives` templates are invisible to any admin-side indexer.** Ours to fix (section 4.1).

---

## 8. Questions for the Cantor8 team

**The main question**

1. Can the existing C8 Scanner be used for TruthOracle, or would this need a Scanner built
   specifically for us? We are happy with either outcome. We would mainly like to know which one it
   is, and roughly what it would involve on your side, so we can plan the backend around it.
   Questions 2 to 9 are the detail we would need in order to answer this with you.

**Retention — this shapes everything else**

2. What is the participant's pruning configuration on the environments we use (beta validator, and
   mainnet)? How far back can `/v2/updates/flats` replay today?
3. Can we get a guaranteed minimum retention window, either through the Scanner keeping a durable
   copy beyond the participant's pruning horizon, or through a retention floor on the participant if
   we run our own consumer? We would like a multi-day outage on our side to stay recoverable.

**Scanner capability — feeds directly into question 1**

4. Can the Scanner stream ledger-effects events, including exercise nodes and their choice
   arguments? If it is create/archive only it cannot carry our trade data (section 3).
5. How would adding a new template, a new choice or a new package version work in practice: a
   configuration change on the Scanner side, or a code change and release? As noted in section 1,
   our DAML is still expanding, so this is likely to be a regular occurrence rather than a one-off.
6. Does it index arbitrary tenant templates, or only Canton Coin / Splice / infrastructure
   templates?

**If we build our own — access and reference material**

7. Are long-lived WebSocket connections to `/v2/updates/flats` supported on the validator, and at
   what concurrency? Any idle-timeout or message-size limits?
8. We understand from Kate that there is no written documentation for the Scanner, which is
   completely fine. If we do end up building our own, is there anything else you could point us at?
   A short walkthrough with someone from the Scanner team, a look at how it decodes Splice Amulet
   events, or the OpenAPI / AsyncAPI definitions for your participant build would all help. Even an
   informal session would save us a fair amount of trial and error.

**Correlation — B3 and B4**

9. Does `memo` / `metadata` on `wallet.send()` reach the ledger event intact? Without it we have no
   join key between the CC transfer and the `Buy` exercise, and the same gap blocks mapping a
   `commandId` to a ledger offset.

---

## 9. Phasing

| Phase | Scope | Unblocks |
|---|---|---|
| **0** | Confirm retention/pruning answers; agree the raw event contract (6.3) | everything below |
| **1** | Capture `PredictionMarket` creates only → price + volume series → probability chart and card sparklines | the immediate charting ask |
| **2** | Full ledger-effects capture: trades, positions, liquidity → trade feed, TVL, portfolio P&L | portfolio and market-detail pages |
| **3** | Payouts, `MarkPaid` and Amulet reconciliation → treasury and solvency dashboard | operations and accounting |
| **4** | Resolutions, attestations, model forecasts → resolution timeline, Brier leaderboard | model marketplace launch |

Phase 1 is intentionally small: `PredictionMarket` created events alone, which are available in the
cheaper ACS-delta shape, already yield the price and volume charts that started this conversation.
If it suits you, we would like to start it in parallel with the Phase 0 discussion, for the reason
in B1.

---

## 10. Summary of our asks

1. A decision on question 1: existing Scanner, or a TruthOracle-specific one. That is the outcome we
   said we would bring this document to.
2. Answers to questions 2 and 3 on retention. These shape the rest of the design, so they are the
   ones we would most like to close first.
3. Agreement on the raw event contract in section 6.3, so we can start Phase 1 capture now and swap
   the source later without rework.
4. A view on Option A, B or C from the Scanner side, so we can agree who owns raw capture. Our
   starting preference is C, but the answers to point 2 may change that.

We plan to build the projection layer, schema and chart API in all three options, so that part does
not depend on the outcome.

We appreciate there are competing demands on the Scanner team, and we are not assuming any of this
is straightforward on your side. If some of it is not practical, we would rather know early so we
can plan around it. Happy to walk through any section on a call.
