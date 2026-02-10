# TruthOracle DAML Contracts (Canton Network)

DAML contracts for the TruthOracle prediction market platform on **Canton Network**. Markets and rewards use **Canton Coin** (native on testnet and mainnet); no custom token.

## Roles

- **Admin** – One account (party) is the platform admin. Only the admin can:
  - Create markets (`MarketCounter.CreateMarket`), add participants to a market (`PredictionMarket.AddParticipant`), record results (`PredictionMarket.RecordResult`), and archive markets (`PredictionMarket.ArchiveMarket`).
- **Users** – Normal users can trade on markets they’re allowed to (`PredictionMarket.Trade`) and claim rewards (`Incentives`). Balances and payments use **Canton Coin**.

## Modules

- **Truthoracle.daml** – Prediction markets: admin creates markets and resolves them; users in `participants` trade (buy shares).
- **Incentives.daml** – Rewards: early participant, market creator, winning prediction; users claim.

## Prerequisites

- [DAML SDK](https://docs.daml.com/getting-started/installation.html) 3.4.10 (install via `curl -sSL https://get.daml.com/ | sh`)
- Canton Network testnet access

## Build

From the repo root, use the DAML SDK’s `daml` command (installed by get.daml.com):

```bash
cd daml
daml build
```

Output: `.daml/dist/truthoracle-1.0.0.dar`.

**Optional: use `dpm` instead**  
The SDK install does not add `dpm` to your PATH. To use the Digital Asset Package Manager CLI, install it separately: [DPM manual install](https://docs.digitalasset.com/build/3.4/dpm/manual-install.html). Then you can run `dpm build` in the `daml/` directory; it uses the same `daml.yaml` and produces the same DAR.

## Test

```bash
daml test
```

## Deploy to Canton Network

**Step-by-step instructions:** see **[DEPLOYMENT.md](./DEPLOYMENT.md)** for building the DAR, uploading it to a Canton participant (local or TestNet), and configuring parties.

In short: run `daml build`, then upload the resulting `.dar` from `daml/.daml/dist/` to your participant via the Canton console (e.g. `participant1.dars.upload("path/to/truthoracle-*.dar")`). See [Canton Network documentation](https://docs.digitalasset.com/canton/) for participant setup.

The frontend and `blockend/cantonService.js` integrate with Canton via the Canton Network Dapp SDK. Wire read operations (market count, metadata, rewards, balances) to your Canton participant API (REST or gRPC) as needed.
