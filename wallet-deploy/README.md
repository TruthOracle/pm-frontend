# C8 Enterprise Wallet — TruthOracle deployment

Self-hosted Cantor8 Enterprise Wallet that signs admin-side TruthOracle transactions
(creating `MarketCounter`, future admin-only operations). End users keep using the
popup `@cantor8/wallet-connect-sdk` — this deployment is for the **admin / house** party.

- Image: `cantor8technologies/enterprise-wallet:v0.1.35` (amd64 only — compose pins `platform: linux/amd64`)
- Network: DevNet — `WALLET_NETWORK=devnet` (`devnet` | `mainnet`) is all the wallet
  needs to resolve the validator and scanner URLs (see "Network resolution" below)
- Identity service (`IDENTITY_SERVICE_URL`): `https://id.dev.digik.cantor8.tech` —
  also serves account recovery (`/accounts/recovery_v3`)
- Tenant (`CLIENT_ID`): `truthoracle`
- Auth: `keycloak` — every wallet API call needs a Bearer JWT (see "Authentication" below)

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

   The other defaults (`CLIENT_ID=truthoracle`, `WALLET_NETWORK=devnet`, DevNet `IDENTITY_SERVICE_URL`, the Keycloak auth block, in-memory batching) are already correct for DevNet.

## Authentication (Keycloak)

The wallet runs with `AUTH_TYPE=keycloak`: every `/api/v1/*` endpoint requires
`Authorization: Bearer <JWT>` or it returns 401. The wallet validates the token's
signature against the IdP's JWKS, its expiry, its algorithm (`AUTH_ALGOS`), and that
`AUTH_AUDIENCE` is present in the token's `aud` claim. There is no issuer check.

Env var names were confirmed from the image itself (`application.conf` inside the
app jar; C8's PDF says "ask the C8 team"):

| Env | Meaning | Our value |
|---|---|---|
| `AUTH_TYPE` | `auth0` \| `keycloak` \| `custom` \| `noop` | `keycloak` |
| `IDP_BASE_URL` | Keycloak base URL | `https://auth.dev.digik.cantor8.tech` |
| `AUTH_REALM` | Keycloak realm (JWKS at `{IDP_BASE_URL}/realms/{AUTH_REALM}/protocol/openid-connect/certs`) | `master` |
| `AUTH_AUDIENCE` | must appear in the token's `aud` | `https://ledger_api.validator.dev.digik.cantor8.tech` |
| `AUTH_ALGOS` | allowed signing algorithms (asymmetric only) | `RS256,Ed25519` |
| `JWKS_URL` | only for `AUTH_TYPE=custom` | unset |

### Network resolution

`WALLET_NETWORK=devnet` resolves (via the bundled wallet-sdk jar) validator
`https://wallet-backend.dev.digik.cantor8.tech/api` and scanner
`https://scanner-ledger-read-api.dev.digik.cantor8.tech`. Optional sparse overrides
exist as `SDK_VALIDATOR_{0,1}_NAME/_URL/_SCANNER_API_URL/_IDENTITY_SERVICE_ID` —
we don't set them; the network defaults are correct.

### Where tokens come from (server-side only)

Tokens are minted **server-side** — the Keycloak client id/secret never reach the
browser bundle:

- **UI:** the browser calls the same-origin proxies `/__proxy/wallet` and
  `/__proxy/ledger` with no credentials. The proxies (`api/proxy/wallet.mjs`,
  `api/proxy/ledger.mjs`, sharing `api/proxy/_keycloakToken.mjs`) mint a
  client_credentials token and inject the `Authorization` header. Under `npm run dev`
  the same handlers run as Vite middleware (see `vite.config.ts`), so dev behaves
  identically. Creds come from server-only env: `KEYCLOAK_CLIENT_ID` /
  `KEYCLOAK_CLIENT_SECRET` (the wallet proxy prefers `WALLET_KEYCLOAK_*` if present).
- **Scripts** (`scripts/create-contract.ts`, `active-contracts.ts`, `ledger-query.ts`)
  run in Node with `dotenv`, so they mint their own token from the same server-only
  env — fine, since scripts are never shipped to a browser.

For manual `curl`s, mint a token yourself (`KEYCLOAK_*` are in the project root `.env`):

```bash
TOKEN=$(curl -sS -X POST "https://auth.dev.digik.cantor8.tech/realms/master/protocol/openid-connect/token" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data "grant_type=client_credentials&client_id=$KEYCLOAK_CLIENT_ID&client_secret=$KEYCLOAK_CLIENT_SECRET" \
  | jq -r .access_token)
```

Tokens expire after ~15 minutes; re-fetch as needed.

> **Security note:** the client id/secret are intentionally NOT `VITE_`-prefixed.
> Anything `VITE_*` is compiled into the public JS bundle — a token-minting secret
> there is world-readable. Keep these server-only, and set them on Vercel WITHOUT the
> `VITE_` prefix.

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

3. **Create the admin account** (`POST /api/v1/accounts`). DevNet — no coupon needed
   (`$TOKEN` from the "Authentication" section above):
   ```bash
   curl -sS -X POST http://localhost:8080/api/v1/accounts \
     -H "Authorization: Bearer $TOKEN" \
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
   curl -sS -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/v1/accounts | jq
   ```

5. Copy the `partyId` and set it in the project root `.env`:
   ```env
   VITE_ENTERPRISE_WALLET_PARTY_ID=<partyId>
   ```

> `preApproveAmuletTransfers: true` lets users send Canton Coin to this party in one step (no manual accept).

## Frontend integration

The wallet exposes `POST /api/v1/external/submit` for arbitrary transactions, so
`scripts/create-contract.ts` and `frontend/lib/enterpriseWalletSubmit.ts` use a
**single-call** flow: hand the wallet `{ partyId, appName, commandId, commands,
disclosedContracts }` and the wallet prepares + signs + executes against its
backend's synchronizer.

```bash
curl -sS -X POST http://localhost:8080/api/v1/external/submit \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "partyId": "<admin party id>",
    "appName": "truthoracle",
    "commandId": "cmd-<unique>",
    "commands": [{"CreateCommand": {"templateId": "<pkg>:Truthoracle:MarketCounter", "createArguments": {"admin": "<admin party id>", "value": "0"}}}],
    "disclosedContracts": []
  }'
```

Verify the result by querying active-contracts on the participant directly
(`npm run ledger:query`); the wallet's `GET /api/v1/command/{partyId}/{commandId}`
status callback is not always wired through to the participant.

## Railway (current production deployment)

The wallet runs publicly at `https://enterprise-wallet-production.up.railway.app`.
Required service variables (Settings → Variables), plus `WALLET_MNEMONIC` and
`CLIENT_ID`:

```env
WALLET_NETWORK=devnet
IDENTITY_SERVICE_URL=https://id.dev.digik.cantor8.tech
AUTH_TYPE=keycloak
IDP_BASE_URL=https://auth.dev.digik.cantor8.tech
AUTH_REALM=master
AUTH_AUDIENCE=https://ledger_api.validator.dev.digik.cantor8.tech
AUTH_ALGOS=RS256,Ed25519
```

The image on Docker Hub is private, so Railway needs registry credentials for the
`gittysachin` account (Pro plan) to pull it. Verify after deploy: an
unauthenticated call must 401, an authenticated one must succeed:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://enterprise-wallet-production.up.railway.app/api/v1/accounts             # expect 401
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $TOKEN" \
  https://enterprise-wallet-production.up.railway.app/api/v1/accounts                                                    # expect 200
```

## Production / mainnet

Switch `.env` to mainnet and rotate to a fresh mnemonic:
```env
WALLET_NETWORK=mainnet
IDENTITY_SERVICE_URL=https://id.cantor8.tech
AUTH_TYPE=keycloak
IDP_BASE_URL=https://auth.main.digik.cantor8.tech
AUTH_REALM=master
AUTH_AUDIENCE=<aud claim of a mainnet client_credentials token — decode one to confirm>
AUTH_ALGOS=RS256,Ed25519
```

Uncomment the `AWS_*` / `CLOUDWATCH_*` block in `.env` if C8 provided log-shipping
credentials; the compose file forwards them via the `environment:` section.

Never run with `AUTH_TYPE=noop` on a public host — it exposes every API (including
signing/submit for the admin party) without auth.

## Files

- `docker-compose-client.yml` — minimal compose, single service, port 8080.
- `.env.example` — DevNet config; copy to `.env` and fill `WALLET_MNEMONIC`.
- `generate-mnemonic.mjs` — produces a 24-word BIP39 phrase.
- `images/` — saved image tarballs (`docker save`), e.g. `enterprise-wallet-v0.1.35.tar`.
  Gitignored (large binaries); load offline with `docker load -i images/<file>.tar`.
- `.gitignore` — excludes `.env` (mnemonic) and `images/`.
