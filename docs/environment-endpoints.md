# Environment endpoints

The browser only ever calls same-origin `/__proxy/*` paths. Every upstream — the
Canton Ledger API, the Enterprise Wallet, and Keycloak — sits behind a serverless
proxy (`api/proxy/*.mjs`, routed by `vercel.json`) that resolves the real target
and injects a Keycloak bearer token server-side. So the upstream URLs and the
client credentials are configured per Vercel environment and never reach the JS
bundle. See `.env.example` for the full list and the non-VITE aliases.

## Browser variables

Use these in local, beta, and main:

```env
VITE_CANTON_PARTICIPANT_PROXY_URL=/__proxy/ledger
VITE_ENTERPRISE_WALLET_PROXY_URL=/__proxy/wallet
```

Both default to those values in `frontend/config.ts`, so set them only if the
`/__proxy/*` routes in `vercel.json` move. `VITE_ENTERPRISE_WALLET_URL` is *not*
a browser variable: it is the upstream the wallet proxy forwards to (below).

## Beta upstream targets

Set these on the Vercel beta/Preview environment:

```env
VITE_KEYCLOAK_URL=https://auth.dev.digik.cantor8.tech
VITE_KEYCLOAK_REALM=master
VITE_CANTON_PARTICIPANT_URL=<beta Canton JSON Ledger API base URL>
VITE_ENTERPRISE_WALLET_URL=<beta Enterprise Wallet URL>
KEYCLOAK_CLIENT_ID=<client id>
KEYCLOAK_CLIENT_SECRET=<client secret>
```

`KEYCLOAK_CLIENT_ID` / `KEYCLOAK_CLIENT_SECRET` take no `VITE_` prefix — the
proxies and scripts ignore a `VITE_`-prefixed spelling of either.

The ledger value must be the base URL, for example:

```env
VITE_CANTON_PARTICIPANT_URL=https://<host>/api/ledger
```

Do not include `/v2/packages`, `/v2/state/ledger-end`, or any other endpoint
suffix. The app and scripts append those paths.

## Main upstream targets

Use the same variable names on main/Production with mainnet targets:

```env
VITE_KEYCLOAK_URL=<main Keycloak base URL>
VITE_KEYCLOAK_REALM=master
VITE_CANTON_PARTICIPANT_URL=<main Canton JSON Ledger API base URL>
VITE_ENTERPRISE_WALLET_URL=<main Enterprise Wallet URL>
KEYCLOAK_CLIENT_ID=<client id>
KEYCLOAK_CLIENT_SECRET=<client secret>
```

With `VITE_APP_NETWORK=mainnet` the ledger proxy ignores
`VITE_CANTON_PARTICIPANT_URL` and the `KEYCLOAK_*` credentials entirely, reading
the `ZKPC_*` block instead. The wallet and user-auth proxies stay on the values
above on every network, so both sets must be present on a mainnet deployment.

## TruthOracle package/admin variables

For the current beta DAR:

```env
VITE_TRUTHORACLE_PACKAGE_ID=0a786ef1027354cb70a1cd78331680bf34054a642520dc0eb94c9ac4f775b837
VITE_TRUTHORACLE_PACKAGE_NAME=truthoracle-v13
VITE_ENTERPRISE_WALLET_PARTY_ID=20a2514bea1b4dd382f116c1e580197d::12205811d9301bcc2456567f882baceb8e083483c8be3f2631aedc2ce1806c424393
```
