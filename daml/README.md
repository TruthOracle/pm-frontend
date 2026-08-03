# TruthOracle DAML Contracts (Canton Network)

DAML contracts for the TruthOracle prediction market protocol on **Canton Network**,
implementing the TruthOracle proposal v0.6 / implementation plan v1.1 (see `docs/`):
a **dynamic pm-AMM** (Paradigm's Gaussian-score AMM — price `P = Φ((y−x)/L_eff)`,
`L_eff = L0·√(T−t)`) with **tiered objective resolution** (T0–T3). Markets and rewards
use **Canton Coin** (native on testnet and mainnet); no custom token.

## Roles

- **Admin (operator/treasury)** – Creates markets (`MarketCounter.CreateMarket` with a
  `ResolutionPolicy`), resolves them (`ResolveT0` / `Resolve` from attestations /
  `VoidMarket`), settles the payout queue (`PendingPayout.MarkPaid`), and scores model
  forecasts (`ScoreAndDistribute`).
- **Traders** – `Buy` / `Sell` against the pm-AMM (slippage-bounded, priced on-ledger),
  `Split` / `Merge` complete sets (1 CC = 1 YES + 1 NO), `RedeemPosition` after
  resolution (1 CC per winning share; cost-basis refund on Void).
- **Liquidity providers** – `ProvideLiquidity` (value-based, price-preserving) and
  `WithdrawLiquidity` (dynamic pools lock LPs until resolution — uniform LVR).
- **Reporters / sources (T1/T2)** – create `OutcomeAttestation` contracts; `Resolve`
  accepts a first-party `secp256k1`-signed source reading (T1) or an M-of-N reporter
  quorum (T2).
- **Proposers / challengers (T3)** – `ProposeOutcome` / `ChallengeOutcome` /
  `FinalizeOutcome` with CC bonds; challenges escalate objectively to T1/T2, never a vote.
- **Forecasters** – `CommitForecast` while a market is Trading; Brier-scored against the
  realised outcome, prize pool funded from a fee slice.

## Modules

- **PmAmmMath.daml** – Normal distribution (`Φ`, `φ`, `Φ⁻¹`), closed-form optimal
  reserves / pool value, effective-liquidity decay, and the Newton swap solver.
- **Truthoracle.daml** – `PredictionMarket` (inline pm-AMM + `ResolutionPolicy` +
  lifecycle `Trading | Proposed | Resolved | Voided`), `Position`, `LiquidityPosition`,
  `OutcomeAttestation`, `ModelForecast`, `PendingPayout`, `MarketCounter`.
- **Marketplace.daml** – `PredictionModel` registry (prediction-model marketplace).
- **Incentives.daml** – Rewards: early participant, market creator, winning prediction.

### Reward claims (important)

- Prefer **`ClaimRewardsBatch`** with a `claims` list when claiming more than one reward in a single submission. Several **`ClaimReward`** exercises on the same `UserRewardsSummary` contract id would fail: the first choice consumes the summary.
- **`ClaimReward`** (single) still updates `totalEarned` / `claimedMarkets` by archiving the old summary and creating a new one; return type is **`(ContractId ClaimedReward, ContractId UserRewardsSummary)`**.
- The duplicate **`ClaimAllReward`** choice was removed; use **`ClaimRewardsBatch`** or **`ClaimReward`**.
- After any DAML change: **`dpm build`**, upload the new **`.dar`**, then set **`VITE_TRUTHORACLE_PACKAGE_ID`** / `frontend/constants.ts` to the new package id.

## Prerequisites

- **DPM** (Digital Asset Package Manager) with SDK 3.4.10 — see [DPM install](https://docs.digitalasset.com/build/3.4/dpm/manual-install.html)
- Canton Network testnet access

## Build

```bash
cd daml
dpm build
```

Or from the repo root: `npm run dars:build`.

Output: `.daml/dist/truthoracle-v12-1.0.0.dar`.

**Note on `daml` vs `dpm`**  
The legacy `daml` CLI (from `get.daml.com`) reads the same `daml.yaml` and produces the same DAR, so `daml build` still works if you have it installed. `dpm` is the supported path for SDK 3.4.x.

## Test

```bash
dpm test
```

## Deploy to Canton Network

**Step-by-step instructions:** see **[DEPLOYMENT.md](./DEPLOYMENT.md)** for building the DAR, uploading it to a Canton participant (local or TestNet), and configuring parties.

In short: run `dpm build`, then upload the resulting `.dar` from `daml/.daml/dist/` to your participant via the Canton console (e.g. `participant1.dars.upload("path/to/truthoracle-*.dar")`). See [Canton Network documentation](https://docs.digitalasset.com/canton/) for participant setup.

The frontend and `blockend/cantonService.js` integrate with Canton via the Canton Network Dapp SDK. Wire read operations (market count, metadata, rewards, balances) to your Canton participant API (REST or gRPC) as needed.
