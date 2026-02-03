# TruthOracle
TruthOracle is a cutting-edge decentralized prediction market platform built on the Canton Network. Our mission is to provide a secure, transparent, and low-cost environment for users to create, participate in, and resolve prediction markets on a variety of topics, including politics, climate change, and sports.

The platform can be seen at - https://truth-oracle.vercel.app/

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
- DAML: Smart contracts for prediction markets, incentives, and USDC-style token on Canton Network.

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

## DAML Contracts (Canton Network)

TruthOracle uses DAML contracts on the Canton Network in the `daml/` directory:

- **daml/daml/Truthoracle.daml** – Prediction markets (create, buy shares, record result)
- **daml/daml/Incentives.daml** – Rewards (early participant, creator, winning prediction)
- **daml/daml/Usdc.daml** – USDC-style token (balance, transfer, mint)

### Build DAML
```bash
cd daml
daml build
```

### Test DAML
```bash
cd daml
daml test
```

### Deploy to Canton Network

Use your Canton participant node and deployment process to upload the Dar and configure parties. See [Canton Network documentation](https://docs.digitalasset.com/canton/) for participant setup and Dar deployment.

Full DAML setup and module details: [daml/README.md](daml/README.md).

## Our deployments

Front-end: [https://truth-oracle.vercel.app/](https://truth-oracle.vercel.app/)

## Documentation

- **Getting Started:**  
  See this README for setup, installation, and deployment.

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
