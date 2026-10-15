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
  liquidity, every figure in the market's collateral. A trade goes through
  `POST /markets/:market/orders/prepare`: the backend assembles the exact ExerciseCommand
  (active market version + disclosed blob, the account's UserWallet for the market's
  collateral and its Position contract ids — reads a browser cannot do as an external party
  on mainnet) and the Cantor8 wallet signs it; the page then waits on `GET /ledger/wait` and
  reloads from the index. The local `lib/marketPricing.ts` mirror still drives the live quote box.
- The header banner reflects `GET /exchange/status`: an operator trading halt disables the
  trade controls (redemptions stay available).
- `/portfolio` is the account's positions, liquidity, pending payouts and in-app wallet, summed
  per instrument (a cBYN figure and a Canton Coin figure never add up); `/rewards` is the TRO
  rewards page (below).
- `/admin` is the operator console (`components/Admin`). One backend operator session
  (wallet-signed challenge, `POST /auth/admin`, held by `BackendOperatorSession.tsx`) serves
  four panels: the catalog — series, events, the treasury-signed market factory
  (`CreateMarketForm.tsx` → `POST /admin/markets`, with the collateral instrument picked per
  market and locked to the event's once it has one) and the trading halt; the instrument
  registry (`InstrumentsPanel.tsx`: list, add, enable/disable, default collateral, registry and
  transfer wiring, the AutoAccept / MintDelegation setup action); Cantor8's token-app
  (`TokensPanel.tsx`: status, treasury holdings vs in-app liabilities per instrument, mint to the
  treasury, mint-and-credit a user, burn); and rewards (`RewardsPanel.tsx`: float, rule toggles
  and parameters, manual grants, grants by status). The factory is the only way this UI creates
  a market: the backend refuses an unknown event, a taken ticker or a collateral other than the
  event's before the Enterprise Wallet signs `CreateMarket`. Every `PredictionMarket` carries its
  ticker, event ticker and the two side labels as mandatory contract fields (since
  `truthoracle-v16`) and its `collateral` instrument (since `truthoracle-v17`). Image,
  description and category are not on the contract: the backend keeps them as operator metadata
  (`PATCH /admin/markets/:market/metadata`, the "Market presentation" card), the image defaults
  to the event's and the category comes from the event's series. The payout queue under the
  panels still runs on this repository's own `to_admin` session (ADMIN_AUTH.md).

Without a backend the app stays what it was: markets from the participant, no events, no
candles (the market chart only draws the prices this tab observed — nothing is fabricated),
no accounts and therefore no deposits, withdrawals or rewards.

## Features
- Decentralized Market Creation: Easily create and participate in prediction markets without intermediaries.
- Low Transaction Fees: Enjoy minimal fees thanks to the efficiency of the Canton Network.
- Automated Outcomes: Smart contracts handle the resolution of markets using reliable oracles.
- Configurable Collateral: every market is denominated in one CIP-56 collateral instrument — the Canton Belarusian Ruble (cBYN) once Cantor8 delivers it, Canton Coin on DevNet until then — and every amount in the app is labelled with the instrument it is in, read from the backend's instrument catalog rather than hard-coded.
- In-app Wallet per Instrument: one on-ledger `UserWallet` per owner and instrument; the wallet card shows a row per instrument with its own Deposit (a Cantor8 wallet transfer of that token to the treasury, credited from the backend's ledger index) and Withdraw (quantised to the instrument's decimals, settled by the treasury after identity verification).
- Rewards in TRO: trading rebates, redeem bonuses and first-deposit bonuses are computed by the backend from its ledger index and credited to an in-app TRO balance that is withdrawable like any other.
- User-Friendly Interface: Designed for ease of use with an intuitive interface.
- Multi-Category Predictions: Engage in predictions across diverse categories.

## Tools & Technologies
- React: For building the user interface.
- Vite: A modern development tool for fast builds.
- shadcn/ui & Tailwind CSS: For stylish and responsive design.
- Cantor8 wallet-connect SDK (default) and the Loop SDK: wallet connection, signing and token transfers on Canton.
- DAML: Smart contracts for prediction markets on Canton Network; markets are denominated in a configurable CIP-56 collateral instrument (cBYN, Canton Coin on DevNet) and rewards are paid in TRO.

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

`npm run lint`, `npm test` (a zero-dependency `node --test` suite over the pure helpers and the
Vercel functions) and `npm run build` (`tsc` + `vite build`, also the pre-commit hook) are the
checks; `npm run fmt` runs prettier over `frontend/**/*.ts`.

## Environment

Copy `.env.example` to `.env`; it documents every variable the browser bundle and the Vercel
functions read, and `docs/environment-endpoints.md` is the Vercel setup (Secret vs Config, the
non-`VITE_` aliases for upstream URLs, the mainnet `ZKPC_*` block). The ones that matter most:

- `VITE_TRUTHORACLE_PACKAGE_ID` / `VITE_TRUTHORACLE_PACKAGE_NAME=truthoracle-v17` — the deployed
  Daml package (printed by `npm run dars:upload` in `truthoracle-contracts`); commands pin the
  id, active-contracts filters use the name.
- `VITE_ENTERPRISE_WALLET_PARTY_ID` — the treasury party (the same value as the backend's
  `TREASURY_PARTY_ID`): the admin on every contract and where deposits are sent.
- `VITE_CANTON_PARTICIPANT_URL`, `VITE_ENTERPRISE_WALLET_URL`, `VITE_KEYCLOAK_*`,
  `KEYCLOAK_CLIENT_ID` / `KEYCLOAK_CLIENT_SECRET` — upstreams and credentials for the
  server-side proxies; the browser only ever calls `/__proxy/*` and `/__backend/*`.
- `BACKEND_URL` / `BACKEND_PROXY_SECRET` — the accounts backend behind the same-origin relay;
  without it the app is read + wallet-signed trading only.
- `ADMIN_SESSION_SECRET` / `ADMIN_OPERATORS` — the payout queue's admin session (ADMIN_AUTH.md).

There is no instrument configuration here: symbols, decimals, the default collateral and the
rewards token come from the backend's `GET /exchange/instruments`.

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
| `pm-frontend` (this repo) | React/Vite frontend, `api/` Vercel functions (ledger/wallet proxies, accounts-backend relay, admin auth) |
| `truthoracle-backend` | NestJS backend — accounts (Google / Telegram sign-in; the Cantor8 wallet is linked to the account afterwards, never a sign-in method), KYC, the ledger index, the instrument catalog, deposits and payouts per instrument (the only money rails; required for deposit/withdraw), rewards (TRO), token-app mint/burn, admin API |
| `truthoracle-contracts` | Daml package `truthoracle-v17` (`daml/`), DAR build/upload and operator scripts (`create:contract`, `create:market`, `ledger:query`, `contracts:active`, `rights:grant`, `create:account`) |
| `cbyn-token` | The cBYN (Canton Belarusian Ruble) CIP-56 token as received from Cantor8, with our build wiring and daml-script tests |
| `truthoracle-token` | TRO, the TruthOracle rewards token — the same CIP-56 layout, `TruthOracle.TRO.*`, 6 decimals, not pegged |
| `enterprise-wallet` | Self-hosted Cantor8 Enterprise Wallet that signs as the admin / treasury party |

## DAML Contracts (Canton Network)

TruthOracle uses DAML contracts on the Canton Network. They now live in the
`truthoracle-contracts` repository (`daml/daml/Truthoracle.daml`, package `truthoracle-v17` —
markets with a `collateral` instrument, pm-AMM trades, one `UserWallet` per owner and
instrument, `PendingPayout` carrying its instrument). Build with `npm run dars:build`, test with
`npm run dars:test` and deploy with `npm run dars:upload` from that repository, then point
`VITE_TRUTHORACLE_PACKAGE_ID` / `VITE_TRUTHORACLE_PACKAGE_NAME` here at the uploaded package.

Balances and payments are in CIP-56 token-standard instruments: every market is denominated in
one collateral instrument (the Canton Belarusian Ruble **cBYN** once Cantor8 delivers it, Canton
Coin on DevNet until then) and rewards are paid in the **TruthOracle Token (TRO)**. The backend's
instrument catalog (`GET /exchange/instruments`) is the source of truth for symbols and decimals;
the frontend labels every amount from it and never hard-codes a currency
(`truthoracle-backend/docs/TOKENS.md`).

## Our deployments

Front-end: [https://truth-oracle.vercel.app/](https://truth-oracle.vercel.app/)

## Documentation

- **Getting Started:**  
  See this README for setup, installation, and deployments.

- **Architecture Overview:**  
  - [Market Resolution System](https://github.com/Truth-Oracle/truthoracle/tree/main/market-resolution)
  - [ZKP Circuits](https://github.com/Truth-Oracle/truthoracle/tree/main/noir/circuits)
  - DAML Smart Contracts: the `truthoracle-contracts` repository
  - Tokens (collateral instruments and TRO): `docs/TOKENS.md` in the `truthoracle-backend` repository

- **API Reference:**  
  - Backend API: `docs/API.md` and `docs/ARCHITECTURE.md` in the `truthoracle-backend` repository.
  - Frontend ↔ Canton integration: [docs/INTEGRATION.md](./docs/INTEGRATION.md).
  - Admin authentication and the proxies: [ADMIN_AUTH.md](./ADMIN_AUTH.md).

- **User Interface:**  
  - [UI Components](https://github.com/Truth-Oracle/truthoracle/tree/main/frontend/components)
  - [Live Demo](https://truth-oracle.vercel.app/)

## Repository

- **Full Codebase:**  
  [https://github.com/Truth-Oracle/truthoracle](https://github.com/Truth-Oracle/truthoracle)

---

**For more details, see the inline documentation and `daml/README.md` in the `truthoracle-contracts` repository.**
