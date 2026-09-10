# Admin authentication

## What this replaced

Before this, `/__proxy/wallet` and `/__proxy/ledger` were open relays. Both inject a
server-minted Keycloak token and neither checked who was calling, so any request that
reached the deployment was executed with full authority:

| Endpoint | Authority it carried | What an anonymous caller could do |
| --- | --- | --- |
| `POST /__proxy/wallet/api/v1/external/submit` | Treasury signing key | Sign any Daml command as the admin party — including `CreateUserWallet` with an arbitrary balance, i.e. mint unlimited in-app CC |
| `POST /__proxy/wallet/api/v1/transfer` | Treasury signing key | Send any amount of real CC to any party |
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
   legitimately need an admin signature on a user's behalf moved to
   `api/wallet/deposit.mjs` and `api/wallet/settle-payout.mjs`, which derive every
   value from the ledger and the wallet's own records.
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
| `POST /api/wallet/deposit` | open by design¹ | Amount derived, so the worst case is triggering someone's legitimate credit. `410 moved_to_backend` once `BACKEND_URL` is set |
| `POST /api/wallet/settle-payout` | open by design¹ | Payee and amount read from the contract. Once `BACKEND_URL` is set: `410 moved_to_backend` for every caller and reason |
| `/__proxy/wallet/*` | **admin session** | No public surface at all |
| `/__proxy/ledger/*` | mixed | Read-only query paths public; everything else admin |
| `/__backend/*` | backend session (`to_session`) | Same-origin relay to the accounts backend — see "Accounts backend" below. Never forwards `to_admin` |

¹ Only while no accounts backend is configured — see "Legacy money endpoints step aside".

Session-authorised proxy requests are additionally checked for a same-origin `Origin`
header. The cookie is already `SameSite=Strict`, so a compliant browser never attaches
it cross-site; the origin check rejects such a request even if one arrives anyway.

### Concurrency: why the open endpoints cannot pay twice

"Derived amounts" makes sequential replays idempotent, but two *concurrent* requests
read the same upstream state — the classic TOCTOU. Both endpoints therefore submit
commands under **deterministic ids**:

- `settle-payout` derives its transfer and MarkPaid command ids from the
  PendingPayout's contract id. Racing settlements submit the *same* commandId, and
  ledger command-deduplication rejects every copy but one. Before transferring it also
  asks the wallet whether that commandId was already submitted, which doubles as crash
  recovery: a payout whose transfer landed but whose MarkPaid did not resumes at
  MarkPaid instead of paying again. (The transfer stays *before* the consuming
  MarkPaid on purpose — the failure mode is "row lingers, money already delivered",
  never "row archived, money never sent".)
- `deposit` derives its commandId from the exact state the credit was computed
  against (user, wallet contract id or "create", amount, amount already credited).
  This matters most on a user's *first* deposit: `UserWallet` has no contract key, so
  two racing `CreateCommand`s would otherwise mint two fully-credited wallets. Racing
  duplicates collide on the id; a genuine later deposit sees new state and gets a new
  one. (On the exercise path the ledger already arbitrates — `Deposit` consumes the
  wallet contract, so the loser aborts.)

Both also keep a per-instance in-flight set so same-instance races fail fast with 409.

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
`test/backend-proxy.test.mjs`, and the §18 retirement of the legacy money endpoints
(including the "unset = byte-for-byte the old behaviour" baseline) in
`test/legacy-wallet-endpoints.test.mjs`.
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
- deposit and settle-payout rate limits (per IP and per party/contract) and
  in-flight locks (60 s crash ceiling, `DEL` on release)

Without a store everything degrades to the previous per-instance behaviour and logs
one warning — the store being down never blocks logins or payouts, and the
money-moving races never depended on it in the first place (they are closed by ledger
command-dedup on deterministic ids, see the concurrency section above).

## Deposit audit trail (truthoracle-v13 2.0.0)

`UserWallet` now records which transfers were credited: `depositRefs : Optional [Text]`
(appended last and `Optional`, so the 2.0.0 DAR passes Canton's smart-contract-upgrade
check and 1.0.0 contracts read as `None`). `Deposit` rejects a `txRef` that was already
credited, so double-crediting one transfer now aborts on-ledger even if it slipped past
command-dedup — the invariant is auditable instead of derived.

Deploying it (from the `truthoracle-contracts` repository): `npm run dars:build` (done — package id
`ddeffbe7e09a4f19cafdb7e2e3cab77c4f5bbe814e718c923447e4371475ced9`), then
`npm run dars:upload`, then point `VITE_TRUTHORACLE_PACKAGE_ID` at that id. Until the
env flips, submissions keep targeting 1.0.0 and behave exactly as before. One wrinkle:
the create path (a user's very first deposit) cannot record its own ref — the JSON API
create against 1.0.0 has no such field, and after the flip the wallet starts at `None`
and records refs from the first `Deposit` exercise onward.

## Accounts backend (`/__backend`, `BACKEND_URL`)

User accounts, linked wallets, KYC and the in-app wallet live in the separate
`truthoracle-backend` service (its `docs/ARCHITECTURE.md` is the spec). The app reaches
it only through `api/proxy/backend.mjs`, a same-origin relay at `/__backend/*`
(`vercel.json` rewrite in production, the same handler as `vite dev` middleware):

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
  reads as "accounts unavailable" — no Sign-in button, nothing else changes. Backend
  unreachable → `502 backend_unreachable`.

The two auth systems do not interact. Operators keep signing into `/admin` through the
`to_admin` flow above until that UI is ported to the backend's admin sessions
(`purpose = admin-sign-in`, parties in the backend's own `ADMIN_OPERATORS`).

### Legacy money endpoints step aside (ARCHITECTURE.md §18)

The moment `BACKEND_URL` is set on this deployment:

| Endpoint | Without a backend | With `BACKEND_URL` |
| --- | --- | --- |
| `POST /api/wallet/deposit` | open, amount derived | always `410 moved_to_backend`. The backend's `POST /in-app-wallet/deposits/reconcile` attributes deposits across all of an account's linked wallets; this endpoint cannot see that attribution, so running both would double-credit |
| `POST /api/wallet/settle-payout` | open, payee/amount from the contract | always `410 moved_to_backend`, operators included. Withdrawals: the KYC gate (`PayoutService.settle`) lives in the backend and this path must not be a way around it. `bond` / `model-prize`: the backend's payout processor settles them into the in-app wallet within 30 s under its own command ids, so a second settler here would pay twice. `Admin/PayoutQueue` hides Settle until it moves to `POST /admin/payouts/:cid/settle`; Mark Paid stays for out-of-band payments |

Both checks require an *absolute* `BACKEND_URL` (same rule as the relay). The backend
refuses to turn on `KYC_ENFORCE_WITHDRAWALS` until `LEGACY_WALLET_ENDPOINTS_RETIRED=true`
attests this is deployed.

## Known gaps

- **`/api/wallet/deposit` is unauthenticated** on deployments without an accounts
  backend. Deliberate — there is no user session there, and the endpoint derives its
  own amount, so the worst an anonymous caller can do is trigger someone's legitimate
  credit; the shared-store rate limits cap the upstream work such a caller can burn.
  [#78](https://github.com/TruthOracle/prediction-market/issues/78) specced the
  user-session flow that closes this. It is closed by the accounts backend: set
  `BACKEND_URL` and the endpoint retires (section above) — deposits then require a
  signed-in account and go through the backend's session-authenticated reconcile.
