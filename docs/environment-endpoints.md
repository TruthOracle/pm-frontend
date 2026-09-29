# Environment endpoints

The browser only ever calls same-origin `/__proxy/*` paths. Every upstream — the
Canton Ledger API, the Enterprise Wallet, and Keycloak — sits behind a serverless
proxy (`api/proxy/*.mjs`, routed by `vercel.json`) that resolves the real target
and injects a Keycloak bearer token server-side. So the upstream URLs and the
client credentials are configured per Vercel environment and never reach the JS
bundle.

`.env.example` is the full annotated list; this page is the Vercel setup.

## Secret vs Config

Vercel flags any `VITE_`-prefixed variable you mark **Secret**: *"The `VITE_`
prefix exposes this value to the browser."* It is right about the prefix. Three
groups, three answers:

| Group | Type | Why |
|---|---|---|
| `VITE_*` that `frontend/config.ts` reads | **Config** | Genuinely compiled into the public JS. Secret would hide them from your own dashboard, not from devtools. None is sensitive. |
| Upstream URLs | **Secret**, using the non-`VITE_` alias | Same value, no warning, and a name that cannot be inlined even by a later edit to `config.ts`. |
| Credentials | **Secret** | No `VITE_` prefix, so no warning. |

Never leave a `VITE_` variable sitting on Secret — that combination is only ever
misleading.

## Browser variables (Config)

Required in every environment. All are read by `frontend/config.ts`:

```env
VITE_APP_NETWORK=devnet
VITE_WALLET_TYPE=cantor8
VITE_LOOP_NETWORK=devnet
VITE_USE_PARTICIPANT_API=true
VITE_TRUTHORACLE_PACKAGE_ID=<package id printed by npm run dars:upload in truthoracle-contracts>
VITE_TRUTHORACLE_PACKAGE_NAME=truthoracle-v15
VITE_ENTERPRISE_WALLET_PARTY_ID=20a2514bea1b4dd382f116c1e580197d::12205811d9301bcc2456567f882baceb8e083483c8be3f2631aedc2ce1806c424393
VITE_ENTERPRISE_WALLET_APP_NAME=truthoracle
```

`VITE_ENTERPRISE_WALLET_PARTY_ID` is the one with no working default: without it
the marketplace queries and admin gating throw.

Only `VITE_APP_NETWORK=mainnet` is special-cased — any other value, `testnet`
included, behaves as devnet.

The proxy paths default to `/__proxy/ledger` and `/__proxy/wallet` in
`frontend/config.ts`. Set them only if the routes in `vercel.json` move:

```env
VITE_CANTON_PARTICIPANT_PROXY_URL=/__proxy/ledger
VITE_ENTERPRISE_WALLET_PROXY_URL=/__proxy/wallet
```

## Upstream targets (Secret)

Set these on the Vercel beta/Preview environment. These are the alias spellings —
the proxies prefer them over the `VITE_` equivalents, and they carry no warning:

```env
CANTON_LEDGER_PROXY_TARGET_URL=<beta Canton JSON Ledger API base URL>
ENTERPRISE_WALLET_PROXY_TARGET_URL=<beta Enterprise Wallet URL>
KEYCLOAK_URL=https://auth.dev.digik.cantor8.tech
KEYCLOAK_REALM=master
KEYCLOAK_CLIENT_ID=<client id>
KEYCLOAK_CLIENT_SECRET=<client secret>
```

The ledger value must be the base URL, for example:

```env
CANTON_LEDGER_PROXY_TARGET_URL=https://<host>/api/ledger
```

Do not include `/v2/packages`, `/v2/state/ledger-end`, or any other endpoint
suffix. The app appends those paths.

`ENTERPRISE_WALLET_PROXY_TARGET_URL` has no fallback default. Unset, every wallet
call returns `500 "Missing proxy target for enterprise wallet"` — market creation,
result recording and Mark Paid alike. (Deposit credits and payout settlement go
through the accounts backend, which reaches the wallet with its own configuration.)

`KEYCLOAK_CLIENT_ID` / `KEYCLOAK_CLIENT_SECRET` take no `VITE_` prefix. A
`VITE_`-prefixed spelling of either is deliberately ignored by
`api/proxy/_keycloakToken.mjs` and by the scripts, so a stray
`VITE_KEYCLOAK_CLIENT_SECRET` cannot become the live credential.

## Main / mainnet

Use the same names on main/Production with mainnet targets. On
`VITE_APP_NETWORK=mainnet` the **ledger** proxy switches to the dedicated zkpc
node and reads the `ZKPC_*` block *only* — no fallback to the values above:

```env
ZKPC_LEDGER_API_URL=https://api.validator.main.zkpc.cantor8.tech/api/ledger
ZKPC_KEYCLOAK_URL=https://auth.main.zkpc.cantor8.tech
ZKPC_KEYCLOAK_REALM=master
ZKPC_KEYCLOAK_CLIENT_ID=<client id>
ZKPC_KEYCLOAK_CLIENT_SECRET=<client secret>
```

The wallet and user-auth proxies stay on the digik credentials on every network,
so **both** sets must be present on a mainnet deployment. The no-fallback rule is
deliberate: a missing `ZKPC_*` value fails fast instead of silently minting a
token against the wrong Keycloak, which the participant rejects with an opaque
401.

## Local `.env`

The aliases above are a Vercel convenience; locally either spelling works for the
proxies and the dev server. The operator scripts (`ledger:query`, `contracts:active`,
`rights:grant`, `dars:upload`, `create:contract`, `create:account`) moved to the
`truthoracle-contracts` repository, which has its own `.env` / `.env.example`
documenting exactly which names each script reads. The treasury wallet deployment is
the `enterprise-wallet` repository; accounts, KYC and session-gated money flows are
the `truthoracle-backend` repository.
