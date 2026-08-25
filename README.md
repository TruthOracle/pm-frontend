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

The iOS app is packaged with Capacitor so the existing responsive React UI can be
used inside a native iOS shell. The native project is in `ios/` and is generated
from the production Vite build.

### Run in the iOS Simulator

1. Open Xcode once and install an iOS Simulator runtime from **Xcode → Settings → Components**.
2. Build the web app and sync it into the native project:
   ```bash
   npm run mobile:sync
   ```
3. Open the iOS project:
   ```bash
   npm run mobile:open
   ```
4. Select an iPhone simulator in Xcode and press **Run**.

The shortcut `npm run mobile:run` performs the sync and attempts to run directly
from the command line.

### Run against a hosted deployment

The bundled app cannot use the Vite development proxy for routes such as
`/__proxy/ledger`. Set `CAPACITOR_SERVER_URL` in `.env` to load a deployed app
and its server-side proxy:

```bash
# Use beta
CAPACITOR_SERVER_URL=https://beta.truthoracle.xyz

# Or use production
# CAPACITOR_SERVER_URL=https://truthoracle.xyz

npm run mobile:run
```

To switch environments, change only `CAPACITOR_SERVER_URL` in `.env`, then run
`npm run mobile:run` again. Capacitor regenerates its native configuration with
the selected URL. This does not require `npm run mobile:dev:server`.

The selected deployment must have its Vercel environment variables, Canton
proxy routes, wallet configuration, and API routes configured.

The existing Cantor8 wallet flow currently uses browser popup/message behavior.
It must be tested in the iOS WebView before enabling mobile deposits/trades. The
embedded-wallet deposit, balance, trade, and withdrawal flow depends on the
updated DAML contract interfaces and should be wired after those contracts are
finalized.

## DAML Contracts (Canton Network)

TruthOracle uses DAML contracts on the Canton Network in the `daml/` directory:

- **daml/daml/Truthoracle.daml** – Prediction markets (create, buy shares, record result)
- **daml/daml/Incentives.daml** – Rewards (early participant, creator, winning prediction)

Balances and payments use **Canton Coin** (native on Canton Network testnet and mainnet).

### Build DAML
```bash
cd daml
dpm build
```

### Test DAML
```bash
cd daml
dpm test
```

### Deploy to Canton Network

Use your Canton participant node and deployment process to upload the Dar and configure parties. See [Canton Network documentation](https://docs.digitalasset.com/canton/) for participant setup and Dar deployment.

Full DAML setup and module details: [daml/README.md](daml/README.md).

## Our deployments

Front-end: [https://truth-oracle.vercel.app/](https://truth-oracle.vercel.app/)

## Documentation

- **Getting Started:**  
  See this README for setup, installation, and deployments.

- **Architecture Overview:**  
  - [Market Resolution System](https://github.com/Truth-Oracle/truthoracle/tree/main/market-resolution)
  - [ZKP Circuits](https://github.com/Truth-Oracle/truthoracle/tree/main/noir/circuits)
  - [DAML Smart Contracts](https://github.com/Truth-Oracle/truthoracle/tree/main/daml)

- **API Reference:**  
  - [CantonService API](./blockend/cantonService.js) – Functions for interacting with Canton and DAML.

- **User Interface:**  
  - [UI Components](https://github.com/Truth-Oracle/truthoracle/tree/main/frontend/components)
  - [Live Demo](https://truth-oracle.vercel.app/)

## Repository

- **Full Codebase:**  
  [https://github.com/Truth-Oracle/truthoracle](https://github.com/Truth-Oracle/truthoracle)

---

**For more details, see the inline documentation and [daml/README.md](daml/README.md).**
