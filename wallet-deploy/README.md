# C8 Enterprise Wallet — TruthOracle deployment

Self-hosted Cantor8 Enterprise Wallet that signs admin-side TruthOracle transactions
(creating `MarketCounter`, future admin-only operations). End users keep using the
popup `@cantor8/wallet-connect-sdk` — this deployment is for the **admin / house** party.

- Image: `cantor8technologies/enterprise-wallet:v0.1.21`
- Backend: DevNet (`wallet-backend.dev.digik.cantor8.tech`)
- Tenant (`CLIENT_ID`): `truthoracle`
- Auth: `noop` (DevNet only — see "Production" below)

## Prerequisites

- Docker Desktop running.
- Docker Hub login with access to `cantor8technologies/enterprise-wallet` (the C8 team
  granted access to the `gittysachin` Docker Hub account):
  ```bash
  docker login -u gittysachin
  ```

## One-time setup

1. **Generate a 24-word BIP39 mnemonic** — this is the only key for the wallet party. Lose it and the funds/account are gone; C8 cannot recover.
   ```bash
   cd wallet-deploy
   node generate-mnemonic.mjs
   ```
   Copy the output and store it offline (1Password, hardware vault, etc.).

2. **Create `.env`** from the template and paste the mnemonic:
   ```bash
   cp .env.example .env
   # then edit .env and set WALLET_MNEMONIC=...
   ```

   The other defaults (`CLIENT_ID=truthoracle`, DevNet `BACKEND_URL`, `IDENTITY_SERVICE_URL`, `AUTH_TYPE=noop`, in-memory batching) are already correct for DevNet.

## Run

```bash
cd wallet-deploy
docker compose -f docker-compose-client.yml up -d
docker compose -f docker-compose-client.yml logs -f
```

Once running:
- Swagger UI: <http://localhost:8080/docs>
- API base: <http://localhost:8080>

Stop:
```bash
docker compose -f docker-compose-client.yml down
```

## Create the admin account & get the party id

The wallet doesn't auto-create an account on first start — you create one via the API. Confirmed from the C8 OpenAPI (`openapi.yaml` saved in this directory).

1. Open Swagger: <http://localhost:8080/docs>.

2. **Find your `validatorId`.** The wallet logs the validator binding on startup; if not, ask the C8 team for the DevNet `validatorId` for the `truthoracle` tenant.

3. **Create the admin account** (`POST /api/v1/accounts`). DevNet — no coupon needed:
   ```bash
   curl -sS -X POST http://localhost:8080/api/v1/accounts \
     -H "Content-Type: application/json" \
     -d '{
       "desiredAccountName": "truthoracle-admin",
       "validatorId": <INT_FROM_C8>,
       "preApproveAmuletTransfers": true
     }'
   ```
   Response is the `partyId` string.

4. **List accounts to confirm**:
   ```bash
   curl -sS http://localhost:8080/api/v1/accounts | jq
   ```

5. Copy the `partyId` and set it in the project root `.env`:
   ```env
   VITE_ENTERPRISE_WALLET_PARTY_ID=<partyId>
   ```

> `preApproveAmuletTransfers: true` lets users send Canton Coin to this party in one step (no manual accept).

## Frontend integration

`scripts/create-contract.ts` uses a **hybrid** flow (matches what the popup SDK does):

1. Prepare on the Canton participant via `POST /v2/interactive-submission/prepare` (Keycloak token) → returns `preparedTransaction`, `preparedTransactionHash`, `hashingSchemeVersion`.
2. POST those to the wallet's `POST /api/v1/transaction/sign_and_execute` — the wallet signs the hash with the admin party's key and executes.

Why not `POST /api/v1/external/submit`? In v0.1.21 the wallet's HTTP validator types `commands[]` as JSON-strings while the downstream backend expects dicts; the wallet doesn't translate, so the call always fails with "Input should be a valid dictionary".

Wallet command-status endpoint (`GET /api/v1/command/{partyId}/{commandId}`) keeps reporting `submitted` because no participant callback is registered. Verify by querying active-contracts on the participant directly.

## Production / mainnet

Switch `.env` to mainnet endpoints and turn on real auth:
```env
BACKEND_URL=https://wallet-backend.main.digik.cantor8.tech/api
IDENTITY_SERVICE_URL=https://id.main.digik.cantor8.tech
AUTH_TYPE=keycloak  # or auth0 — ask C8 for IdP envs (issuer, audience, etc.)
```

Uncomment the `AWS_*` / `CLOUDWATCH_*` block in `.env` if C8 provided log-shipping
credentials; the compose file forwards them via the `environment:` section.

Always run the wallet on a private host — `AUTH_TYPE=noop` exposes every API
without auth.

## Files

- `docker-compose-client.yml` — minimal compose, single service, port 8080.
- `.env.example` — DevNet config; copy to `.env` and fill `WALLET_MNEMONIC`.
- `generate-mnemonic.mjs` — produces a 24-word BIP39 phrase.
- `.gitignore` — excludes `.env` so the mnemonic doesn't end up in git.
