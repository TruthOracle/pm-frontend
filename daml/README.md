# TruthOracle DAML Contracts (Canton Network)

DAML contracts for the TruthOracle prediction market platform on **Canton Network**. These modules provide prediction markets, incentives, and a USDC-style token.

## Modules

- **Truthoracle.daml** – Prediction markets: create markets, buy shares (LMSR), record results, user positions.
- **Incentives.daml** – Rewards: early participant, market creator, winning prediction; claim single or all.
- **Usdc.daml** – USDC-style token: balances, transfer, mint (for testnet).

## Prerequisites

- [DAML SDK](https://docs.daml.com/getting-started/installation.html) (e.g. 2.9.x)
- Canton Network testnet access

## Build

```bash
cd daml
daml build
```

## Test

```bash
daml test
```

## Deploy to Canton Network

Use the Canton participant node and your deployment process to upload the Dar and configure parties. See [Canton Network documentation](https://docs.digitalasset.com/canton/) for participant setup and Dar deployment.

The frontend and `blockend/cantonService.js` integrate with Canton via the Canton Network Dapp SDK. Wire read operations (market count, metadata, rewards, balances) to your Canton participant API (REST or gRPC) as needed.
