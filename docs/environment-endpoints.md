# Environment endpoints

TruthOracle uses browser-visible proxy paths for Canton Ledger and Keycloak,
while the actual upstream targets are configured per Vercel environment. The
Enterprise Wallet is not proxied through Vercel; it is configured directly by
environment variable.

## Browser variables

Use these in local, beta, and main:

```env
VITE_KEYCLOAK_PROXY_URL=/__proxy/keycloak
VITE_CANTON_PARTICIPANT_PROXY_URL=/__proxy/ledger
VITE_ENTERPRISE_WALLET_URL=https://enterprise-wallet-production.up.railway.app
```

## Beta upstream targets

Set these on the Vercel beta/Preview environment:

```env
VITE_KEYCLOAK_URL=https://auth.dev.digik.cantor8.tech
VITE_CANTON_PARTICIPANT_URL=<beta Canton JSON Ledger API base URL>
```

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
VITE_CANTON_PARTICIPANT_URL=<main Canton JSON Ledger API base URL>
VITE_ENTERPRISE_WALLET_URL=<main Enterprise Wallet URL>
```

## TruthOracle package/admin variables

For the current beta DAR:

```env
VITE_TRUTHORACLE_PACKAGE_ID=0a786ef1027354cb70a1cd78331680bf34054a642520dc0eb94c9ac4f775b837
VITE_TRUTHORACLE_PACKAGE_NAME=truthoracle-v13
VITE_ENTERPRISE_WALLET_PARTY_ID=20a2514bea1b4dd382f116c1e580197d::12205811d9301bcc2456567f882baceb8e083483c8be3f2631aedc2ce1806c424393
```
