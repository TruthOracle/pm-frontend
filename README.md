# TruthOracle
TruthOracle is a cutting-edge decentralized prediction market platform built on the Canton Network. Our mission is to provide a secure, transparent, and low-cost environment for users to create, participate in, and resolve prediction markets on a variety of topics, including politics, climate change, and sports.

The platform can be seen at - [truthoracle-omega.vercel.app](https://truthoracle-omega.vercel.app/)

## Markets like an exchange (series → events → markets)

With the accounts backend deployed, the app reads markets, candles and the catalog from its
ledger index (`truthoracle-backend/docs/MARKETS.md`) instead of polling the participant's
active contracts:

- `/marketplace` lists **events** (one question, N binary pm-AMM markets) with their legs'
  Yes / No prices, filtered by the series' category (`?category=`, `?series=`, `?q=` — the
  header topics and search box drive them); a Markets view lists every market.
- `/events/:ticker` is the event page: the legs table (Yes price, 24 h change, volume, open
  interest, trade buttons) and one chart with every leg's Yes price.
- `/market/:idOrTicker` is the market page. The chart is the backend's candlesticks (1 min ·
  1 h · 1 d, line or candles, volume bars, OHLC tooltip); the header shows the ticker, the
  event and the two side labels; the stats show 24 h volume, open interest and the pool's
  liquidity. A trade goes through `POST /markets/:market/orders/prepare`: the backend assembles
  the exact ExerciseCommand (active market version + disclosed blob, the account's UserWallet
  and Position contract ids — reads a browser cannot do as an external party on mainnet) and
  the Cantor8 wallet signs it; the page then waits on `GET /ledger/wait` and reloads from the
  index. The local `lib/marketPricing.ts` mirror still drives the live quote box.
- The header banner reflects `GET /exchange/status`: an operator trading halt disables the
  trade controls (redemptions stay available).
- `/admin` gains the catalog console (`components/Admin/CatalogPanel.tsx`): a backend operator
  session (wallet-signed challenge, `POST /auth/admin`), series and events, the treasury-signed
  market factory (`POST /admin/markets`, on-ledger ticker / event / side labels with
  truthoracle-v14 ≥ 1.1.0), assignment of what older markets left blank, and the trading halt.
  The browser-side `CreateMarket` form also carries the four identity fields
  (`VITE_TRUTHORACLE_PACKAGE_ID` must point at the 1.1.0 package for them to be accepted).

Without a backend the app stays what it was: markets from the participant, no events, no
candles (the market chart only draws the prices this tab observed — nothing is fabricated).

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
| `truthoracle-backend` | NestJS backend — accounts (Google / Telegram sign-in; the Cantor8 wallet is linked to the account afterwards, never a sign-in method), KYC, deposits and payouts (the only money rails; required for deposit/withdraw), admin API |
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
