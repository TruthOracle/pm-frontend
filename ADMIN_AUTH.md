# Admin authentication

## What this replaced

Before this, `/__proxy/wallet` and `/__proxy/ledger` were open relays. Both inject a
server-minted Keycloak token and neither checked who was calling, so any request that
reached the deployment was executed with full authority:

| Endpoint | Authority it carried | What an anonymous caller could do |
| --- | --- | --- |
| `POST /__proxy/wallet/api/v1/external/submit` | Treasury signing key | Sign any Daml command as the admin party — including creating a `UserWallet` with an arbitrary balance, i.e. mint unlimited in-app balance in any instrument |
| `POST /__proxy/wallet/api/v1/transfer` | Treasury signing key | Send any amount of any token the treasury holds (Canton Coin at the time) to any party |
| `POST /__proxy/ledger/v2/users/{u}/rights` | `ParticipantAdmin` | Grant themselves `CanActAs` on any party hosted by the participant |

The only thing standing in front of them was `useIsAdmin()`, which compared a
connected wallet's party id to `VITE_ENTERPRISE_WALLET_PARTY_ID` in the browser. That
gate hid UI and nothing else — and it could never pass anyway, because the enterprise
wallet's admin party is created through the wallet API and has no passkey to connect
with.

## The model now

Three ideas, in order of importance:

1. **The proxies deny by default.** A request is forwarded only if its path is on an
   explicit read-only allowlist, or the caller holds a valid admin session. When
   `ADMIN_SESSION_SECRET` is unset, privileged paths fail closed with 503 rather than
   falling open. See `api/_lib/proxyGuard.mjs`.
2. **Amounts and recipients are never accepted from the browser.** The two flows that
   need the treasury's signature on a user's behalf — crediting a deposit and settling
   a payout — live in the accounts backend (`truthoracle-backend`), behind a user
   session, and derive every value from the ledger and the wallet's own records. This
   repository has no money-moving endpoint of its own.
3. **Operators sign in as themselves.** The party that *authorises* an action and the
   party that *signs* it are deliberately different. An operator proves control of a
   party they can actually connect with; the enterprise wallet still holds the
   treasury key.

### Login flow

```
GET  /api/admin/nonce                     -> { nonce, expiresAt }        5 min, HMAC-stamped
wallet.signMessage(nonce, partyId)        -> signature                   popup asks the operator
browser generates instanceToken           random bytes, held ONLY in JS memory
POST /api/admin/session {partyId, nonce, signature, instanceToken}
       server: verify nonce HMAC + freshness + single use
               look up the PINNED public key for partyId
               Ed25519 verify
               bake sha256(instanceToken) into the session
       -> Set-Cookie: to_admin=...        HttpOnly, SameSite=Strict, 15 min
```

**A session lives exactly one page load.** Privileged calls must send the cookie AND
the instance token (as `x-admin-instance`); either half alone is rejected. The token
is a plain JS variable — never localStorage or sessionStorage — so reloading the page
or navigating away destroys it, and the cookie that survives the reload is inert.
Every new page document therefore starts with a fresh wallet signature. (In-app route
changes are not page loads: the SPA keeps its memory, so the session keeps working
until reload, sign-out, revocation, or the 15-minute expiry — whichever comes first.)

The request carries **no public key**. The verifying key comes from the server's
`ADMIN_OPERATORS` map. If the browser supplied one, an attacker would generate a
keypair, sign our nonce with it, claim any party id, and verify perfectly.

Deriving the key from the party id *is* possible — an earlier version of this document
claimed otherwise. Verified against the real operator party: the `::1220…` suffix is

```
hex(0x12 0x20 ‖ sha256(uint32be(12) ‖ rawEd25519Key))
```

i.e. a sha2-256 multihash (`0x12 0x20` = sha2-256, 32 bytes) over the raw key prefixed
with Canton's `HashPurpose` 12 (`PublicKeyFingerprint`) — exactly
`TopologyWriteService.createFingerprintFromKey` in `@canton-network/wallet-sdk`. So a
client-supplied key *can* be bound to its party by recomputing the fingerprint, and that
is what the accounts backend does for self-serve wallet sign-in (`POST
/api/v1/auth/wallet`; `wallet_key_mismatch` when the signing key is not the namespace
key — rotated keys and participant-namespace parties are its documented limitation).
The admin flow keeps the pin regardless: `ADMIN_OPERATORS` is the operator allowlist,
and pinning the key there is an additional check on top of the fingerprint binding —
admin access is tied to exactly the key configured server-side, independent of what
the ledger currently says about the party.

## Configuration

Server-only. None of these may take a `VITE_` prefix — Vite compiles every referenced
`VITE_*` variable into the public JS bundle.

```bash
# Signing key for nonces and session cookies. At least 32 chars.
ADMIN_SESSION_SECRET=$(openssl rand -hex 32)

# Operators allowed to hold an admin session: <partyId>=<publicKey>, comma separated.
# Public key may be hex, base64, or base64url — it is identified by decoding to 32 bytes.
ADMIN_OPERATORS="a99dd107…::1220880b…=b6f1…,3b9317d2…::1220514795…=9ac4…"

# Optional. Session lifetime in hours (default 0.25 = 15 minutes; max 24).
# Expiry is absolute, not sliding: activity never extends a session, so a stolen
# cookie has a hard ceiling. Re-auth costs the operator one wallet popup.
ADMIN_SESSION_TTL_HOURS=0.25
```

An operator's public key is the Ed25519 key on the wallet's account payload: the
Cantor8 SDK (≥0.5.0) returns `publicKey` on the account object, and the Canton wallet
exposes it as `provider.public_key` (see `frontend/wallets/*/…WalletContext.tsx`). Read
it from the wallet-backend accounts API, or from the connected account object in the
browser console. It is deliberately NOT shown anywhere in the UI.

Revocation is immediate: `verifySession` re-checks the allowlist on every request, so
removing a party from `ADMIN_OPERATORS` invalidates their live cookie rather than
waiting for it to expire.

## Signature encoding — CONFIRMED 2026-09-01

The first real login settled it: the Cantor8 popup signs the **raw UTF-8 bytes** of
the message (`[admin-auth] session issued … (preimage form: utf8)`), and the key and
signature encodings decode within the closed set below. The multi-form verifier stays
as is — it costs one extra Ed25519 verify at most and keeps logins working if a wallet
update changes the format. The original investigation follows for context.

### Original notes

`@cantor8/wallet-connect-sdk` is a pure postMessage transport for this method:

```js
signMessage(e, t) { return this.transport.request("signMessage", { message: e, partyId: t }, !0) }
```

It returns the popup's string verbatim, and the SDK's types say only
`Promise<string>`. So neither the encoding nor the exact preimage is discoverable from
the package. `api/_lib/verifyPartySignature.mjs` therefore tries the closed set of
plausible combinations — hex / base64 / base64url for both key and signature, and
raw-UTF-8 vs `sha256(utf8)` for the preimage — and logs which one matched.

**If the first real login fails**, the server log line is what pins it down:

```
[admin-auth] rejected login for <party>: signature did not verify against the account
public key — signature: 88 chars, charset=base64, decodes hex=0B base64=64B base64url=64B;
publicKey: 64 chars, charset=hex, decodes hex=32B base64=48B base64url=48B
```

A 64-byte decode on both sides means the encoding is handled and the *preimage* is the
mismatch — the popup is signing something other than the bare nonce (a prefix, a
domain separator, or a JSON envelope). Capture one signature and add that form to
`preimages()`.

### Fallback, if the signature path proves impractical

The SDK already holds a wallet-backend bearer token for the connected party
(`auth-flow` → `session.setBearerToken`), and `GET /api/balance` on
`wallet-backend.main.digik.cantor8.tech` returns that token's `party_id`. Verifying a token
that way needs no signature-format knowledge at all. It is a smaller change than it
looks: only `api/admin/session.mjs` would swap its verification step.

## Endpoint reference

| Endpoint | Auth | Notes |
| --- | --- | --- |
| `GET /api/admin/nonce` | public | Worthless without a pinned private key |
| `POST /api/admin/session` | public | Rate limited; uniform error to avoid operator enumeration |
| `GET /api/admin/me` | public | Rendering aid only, never a boundary |
| `POST /api/admin/logout` | public | Clears the cookie |
| `/__proxy/wallet/*` | **admin session** | No public surface at all |
| `/__proxy/ledger/*` | mixed | Read-only query paths public; everything else admin |
| `/__backend/*` | backend session (`to_session`) | Same-origin relay to the accounts backend — see "Accounts backend" below. Never forwards `to_admin` |

Session-authorised proxy requests are additionally checked for a same-origin `Origin`
header. The cookie is already `SameSite=Strict`, so a compliant browser never attaches
it cross-site; the origin check rejects such a request even if one arrives anyway.

### Concurrency of the money flows

Nothing in this repository moves money, so there is no TOCTOU to close here. The
backend's deposit credit and payout settlement submit under **deterministic command
ids** (write-ahead `to_deposit_credits` / `to_payouts` rows plus a confirm pass), so
racing or replayed attempts collide on the id and ledger command-deduplication rejects
every copy but one — `truthoracle-backend/docs/ARCHITECTURE.md` §8.3 and §9.4.

## Tests

`npm test` runs a zero-dependency `node --test` suite over the auth stack: nonce
lifecycle and replay, session MAC tampering and immediate revocation, allowlist
parsing, Ed25519 verification across all nine encoding combinations plus the
pre-hashed preimage, and the proxy policy including the fail-closed,
allowlist-bypass, and CSRF cases (`test/admin-auth.test.mjs`); plus the shared
store's claim/rate-limit/lock semantics, cross-instance behaviour against an
emulated backend, and its degrade-on-outage path (`test/shared-store.test.mjs`).
The accounts-backend relay's containment rules — path allowlist, cookie and header
filtering, `Domain=` stripping, the 503/404/502 answers — are in
`test/backend-proxy.test.mjs`.
The dedup assertion in `UserWallet.Deposit` is covered by the Daml suite
(`daml/daml/TruthoracleTest.daml` in the `truthoracle-contracts` repository, `npm run dars:test` there).

The ledger allowlist is `v2/state/active-contracts`, `v2/state/ledger-end`,
`v2/state/connected-synchronizers`, `v2/interactive-submission/prepare`, and
`v2/interactive-submission/execute`. The `interactive-submission` pair is safe
unauthenticated because it is self-authorising — `prepare` only builds an unsigned
transaction, and `execute` is rejected without a valid signature from the acting
party.

## Shared store (closes the per-instance gaps)

`api/_lib/sharedStore.mjs` speaks the Upstash Redis REST protocol. When configured
(`KV_REST_API_URL`/`KV_REST_API_TOKEN`, or the `UPSTASH_REDIS_REST_*` pair — Vercel KV
exposes the former automatically), these guards become fleet-wide:

- nonce single use (`SET NX PX` keyed by the nonce's MAC)
- login rate limit (10/min per IP)

Without a store everything degrades to the previous per-instance behaviour and logs
one warning — the store being down never blocks logins. No money-moving invariant
lives here (see "Concurrency of the money flows").

## Accounts backend (`/__backend`, `BACKEND_URL`)

User accounts, linked wallets, KYC and the in-app wallet live in the separate
`truthoracle-backend` service (its `docs/ARCHITECTURE.md` is the spec). It is the
**only money rail**: the on-ledger `UserWallet` is created by the backend (treasury-
signed) for an account's primary wallet on the first deposit, deposits are credited by
`POST /in-app-wallet/deposits/reconcile` and payouts settled by
`POST /in-app-wallet/payouts/:cid/settle` (KYC-gated) — both session-authenticated.
Deposits and withdrawals therefore **require a signed-in account**; a Canton party
never holds an in-app balance without one. Trading stays wallet-signed and works
anonymously (reads + Daml choices), but any choice that debits or credits a
`UserWallet` needs one to exist, i.e. an account that has deposited.

The app reaches the backend only through `api/proxy/backend.mjs`, a same-origin relay
at `/__backend/*` (`vercel.json` rewrite in production, the same handler as `vite dev`
middleware):

- Forwards only `api/v1/**`, `health` and `health/ready`; everything else — including
  any path with a dot segment — is `404 { error: "path not proxied" }`.
- Injects **no** server credential. The caller's own `to_session` cookie authorises the
  request; the relay rebuilds the `Cookie` header from `to_session` and `to_oidc` only,
  so the admin cookie (`to_admin`), a client bearer and `x-admin-instance` never leave
  this deployment. Request headers are an allow-list (`content-type`, `accept`,
  `origin`, `referer`, `x-requested-with`), never a copy of what the client sent.
- Replaces every client-supplied `x-forwarded-*` with values it derives itself
  (`x-forwarded-host` = the app host, `x-forwarded-proto`, `x-real-ip`), authenticated
  to the backend by `x-truthoracle-proxy: BACKEND_PROXY_SECRET`. The backend trusts
  those headers only when the secret matches; otherwise it uses the socket address.
- Relays redirects (`redirect: "manual"` — the Telegram OIDC hops are for the browser)
  and `Set-Cookie` as an array with any `Domain=` stripped, so backend cookies bind to
  the app host. Response `cache-control` defaults to `no-store`.
- `BACKEND_URL` unset → `503 { error: "backend_unconfigured" }`, which the frontend
  reads as "accounts unavailable": no Sign-in button and no deposit / withdraw
  controls — the app is read + wallet-signed trading only. Backend unreachable →
  `502 backend_unreachable`: sign-in is offered but disabled and the money controls
  pause with a Retry (an outage must never look like "no backend").

The two auth systems do not interact. Everything that configures the exchange is
backend-only now: `Admin/BackendOperatorSession.tsx` signs the operator into the backend
once (`purpose = admin-sign-in`, parties in the backend's own `ADMIN_OPERATORS`) and holds
that session for every backend-backed panel — the catalog and the treasury-signed market
factory (`CatalogPanel`, `CreateMarketForm` → `POST /admin/markets`), the instrument
registry (`InstrumentsPanel` → `/admin/instruments`, including the AutoAccept /
MintDelegation setup action), Cantor8's token-app (`TokensPanel` → `/admin/tokens/*`:
mint, mint-and-credit, burn) and the rewards rules (`RewardsPanel` → `/admin/rewards/*`).
The browser never builds those commands and the wallet relay serves none of them; the
backend submits them through the Enterprise Wallet or the token-app and audits each one.
Only the payout queue still signs in through the `to_admin` flow above:
`Admin/PayoutQueue` lists rows, copies their contract ids for the backend's
`POST /api/v1/admin/payouts/:cid/settle`, and keeps the wallet-signed Mark Paid for payouts
settled out-of-band — it never pretends to hold a backend admin session.

## Known gaps

- **The payout queue is not on backend admin sessions yet.** Every other `/admin` panel
  runs on the backend operator session (`BackendOperatorSession.tsx`); the queue's
  `to_admin` cookie is this repository's own flow, so it cannot call the backend's
  `POST /api/v1/admin/payouts/:cid/settle` — stuck payouts are force-settled from that
  API directly (the queue shows the contract id to copy). Porting it is Phase 2 in
  `truthoracle-backend/docs/ARCHITECTURE.md` §17.
- **No deposits or withdrawals without `BACKEND_URL`.** By design: there are no
  money endpoints in this repository, so a deployment without an accounts backend is
  read + wallet-signed trading only. [#78](https://github.com/TruthOracle/pm-frontend/issues/78)
  (an unauthenticated deposit reconcile) is closed by this — every credit and
  settlement is session-authenticated in the backend.
