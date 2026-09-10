# TruthOracle
TruthOracle is a cutting-edge decentralized prediction market platform built on the Canton Network. Our mission is to provide a secure, transparent, and low-cost environment for users to create, participate in, and resolve prediction markets on a variety of topics, including politics, climate change, and sports.

The platform can be seen at - [truthoracle-omega.vercel.app](https://truthoracle-omega.vercel.app/)

## Features
- Decentralized Market Creation: Easily create and participate in prediction markets without intermediaries.
- Low Transaction Fees: Enjoy minimal fees thanks to the efficiency of the Canton Network.
- Automated Outcomes: Smart contracts handle the resolution of markets using reliable oracles.
- User-Friendly Interface: Designed for ease of use with an intuitive interface.
- Multi-Category Predictions: Engage in predictions across diverse categories.

## Tools & Technologies
- React: For building the user interface.
- Vite: A modern development tool for fast builds.
- shadcn/ui & Tailwind CSS: For stylish and responsive design.
- Canton Network Dapp SDK: For wallet connection and DAML command execution on Canton.
- DAML: Smart contracts for prediction markets and incentives on Canton Network; trading uses Canton Coin (testnet/mainnet).

## Getting Started

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Start the Development Server**
   ```bash
   npm run dev
   ```

3. **Deploy the Application**
   ```bash
   npm run deploy
   ```

## iOS Mobile App

The iOS app is a native Swift/SwiftUI target. It does not load the React/Vite
frontend in a WebView. The native project is in `ios/` and owns the iOS
navigation, news, markets, and portfolio surfaces.

### Run in the iOS Simulator

1. Open Xcode once and install an iOS Simulator runtime from **Xcode → Settings → Components**.
2. Build the native iOS target:
   ```bash
   npm run ios:build
   ```
3. Open the iOS project:
   ```bash
   npm run ios:open
   ```
4. Select an iPhone simulator in Xcode and press **Run**.

The current native shell uses local preview data for the first SwiftUI surfaces.
The next integration step is to connect `URLSession` services for live news,
Canton markets, and the native wallet flow without introducing a WebView.

## Repositories

This repository is the web frontend plus its Vercel proxy functions. The rest of the
platform lives in sibling repositories:

| Repository | Contents |
|---|---|
| `truthoracle-canton` (this repo) | React/Vite frontend, `api/` Vercel functions (ledger/wallet proxies, accounts-backend relay, admin auth) |
| `truthoracle-backend` | NestJS backend — accounts (Google / Telegram / Canton wallet sign-in), linked wallets, KYC, deposits and payouts (the only money rails; required for deposit/withdraw), admin API |
| `truthoracle-contracts` | Daml package (`daml/`), DAR build/upload and operator scripts (`create:contract`, `ledger:query`, `contracts:active`, `rights:grant`, `create:account`) |
| `enterprise-wallet` | Self-hosted Cantor8 Enterprise Wallet that signs as the admin / treasury party |

## DAML Contracts (Canton Network)

TruthOracle uses DAML contracts on the Canton Network. They now live in the
`truthoracle-contracts` repository (`daml/daml/Truthoracle.daml` — markets, pm-AMM
trades, `UserWallet`, `PendingPayout`; `daml/daml/Incentives.daml` — rewards). Build with
`npm run dars:build`, test with `npm run dars:test` and deploy with `npm run dars:upload`
from that repository, then point `VITE_TRUTHORACLE_PACKAGE_ID` / `VITE_TRUTHORACLE_PACKAGE_NAME`
here at the uploaded package.

Balances and payments use **Canton Coin** (native on Canton Network testnet and mainnet).

## Our deployments

Front-end: [https://truth-oracle.vercel.app/](https://truth-oracle.vercel.app/)

## Documentation

- **Getting Started:**  
  See this README for setup, installation, and deployments.

- **Architecture Overview:**  
  - [Market Resolution System](https://github.com/Truth-Oracle/truthoracle/tree/main/market-resolution)
  - [ZKP Circuits](https://github.com/Truth-Oracle/truthoracle/tree/main/noir/circuits)
  - DAML Smart Contracts: the `truthoracle-contracts` repository

- **API Reference:**  
  - [CantonService API](./blockend/cantonService.js) – Functions for interacting with Canton and DAML.
  - Backend API: `docs/ARCHITECTURE.md` in the `truthoracle-backend` repository.

- **User Interface:**  
  - [UI Components](https://github.com/Truth-Oracle/truthoracle/tree/main/frontend/components)
  - [Live Demo](https://truth-oracle.vercel.app/)

## Repository

- **Full Codebase:**  
  [https://github.com/Truth-Oracle/truthoracle](https://github.com/Truth-Oracle/truthoracle)

---

**For more details, see the inline documentation and `daml/README.md` in the `truthoracle-contracts` repository.**
