# Active contracts API reference (JSON Ledger API)

Based on the [OpenAPI spec](https://docs.digitalasset.com/build/3.4/reference/json-api/openapi.html)
for the JSON Ledger API, checked against the participant the app talks to (Canton 3.6.1 on
DevNet, 2026-10-15 — `truthoracle-backend/docs/TOKENS.md` §1).

## Endpoint

- **Method:** `POST`
- **Path:** `/v2/state/active-contracts`

## Query parameters (OpenAPI)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `limit` | integer (int64) | No | Max number of elements to return. Capped by server `http-list-max-elements-limit`. |
| `stream_idle_timeout_ms` | integer (int64) | No | Timeout for open-ended streams. |

The app sends neither: the party is named inside `eventFormat.filtersByParty`, and the
participant's default page is enough for one template's contracts.

## Request body: `GetActiveContractsRequest`

Content-Type: `application/json`.

### Top-level fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `activeAtOffset` | integer (int64) — the app sends it as a string | **Yes** | Snapshot offset. Must be ≤ ledger end and ≥ last pruning offset. `0` is ledger begin (returns the empty set). |
| `eventFormat` | `EventFormat` | **Yes** (for us) | Format of contract entries in the response (ACS_DELTA shape). |
| `filter` | `TransactionFilter` | **Never** | Legacy. Canton 3.6 refuses it with `DEPRECATED_API_DISABLED`. |
| `verbose` | boolean | **Never** | Legacy. Same refusal — the verbose flag lives INSIDE `eventFormat`. |

Nothing may sit next to `eventFormat` but `activeAtOffset`. Both clients in this repository
build exactly that body (`frontend/lib/cantonParticipant.ts` `queryActiveContracts`,
`api/_lib/ledgerClient.mjs` `activeContractsRequest`), and `test/ledger-client.test.mjs`
pins the shape.

### `EventFormat`

| Field | Type | Description |
|-------|------|-------------|
| `filtersByParty` | `Map_Filters` | Map: party ID → `Filters`. For active-contracts: create/archive events for contracts whose **stakeholders** include at least one listed party and match the per-party filter. |
| `filtersForAnyParty` | `Filters` | Wildcard filters applied to all parties. |
| `verbose` | boolean | If true, include labels for record fields in values. The app sends `false`. |

### `Filters` (per-party or for-any-party)

| Field | Type | Description |
|-------|------|-------------|
| `cumulative` | array of `CumulativeFilter` | Each entry expands the scope (templates/interfaces/wildcard). Default if absent: single `WildcardFilter`, no `include_created_event_blob`. |

### `CumulativeFilter`

| Field | Type | Description |
|-------|------|-------------|
| `identifierFilter` | `IdentifierFilter` | One of: `Empty`, `InterfaceFilter`, `TemplateFilter`, `WildcardFilter`. |

### `IdentifierFilter` (one-of)

- **TemplateFilter** – one template:
  - `TemplateFilter.value.templateId` (string, required): the **package-name reference**
    `"#packageName:moduleName:entityName"`, e.g. `"#truthoracle-v17:Truthoracle:MarketCounter"`.
    The package-id form (`"<64-hex>:Module:Entity"`) is rejected here with `INVALID_FIELD`
    "Received an identifier with package ID …, but expected a package name"; commands, by
    contrast, pin the package by id.
  - `TemplateFilter.value.includeCreatedEventBlob` (boolean, optional): include the blob a
    `DisclosedContract` needs (the market page asks for it on `PredictionMarket`).
- **InterfaceFilter** – contracts implementing an interface (`interfaceId`,
  `includeInterfaceView`). The backend's indexer uses it for the token standard
  (`#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding`); the browser does not.
- **WildcardFilter** – all templates (`includeCreatedEventBlob` optional).
- **Empty** – no filter.

## Example request body (template filter for one party)

```json
{
  "activeAtOffset": "12345",
  "eventFormat": {
    "filtersByParty": {
      "<partyId>": {
        "cumulative": [
          {
            "identifierFilter": {
              "TemplateFilter": {
                "value": {
                  "templateId": "#truthoracle-v17:Truthoracle:MarketCounter",
                  "includeCreatedEventBlob": false
                }
              }
            }
          }
        ]
      }
    },
    "verbose": false
  }
}
```

- `activeAtOffset`: `GET /v2/state/ledger-end` → `response.offset`.
- `<partyId>`: the full Daml party id (`Hint::1220…`). Only a stakeholder sees the contract —
  `MarketCounter` is seen by its admin (the treasury), a `UserWallet` by its owner and the
  treasury, a `PredictionMarket` by the treasury and its observers.

## Response

- **200:** JSON array of `JsGetActiveContractsResponse`:
  - `workflowId` (optional)
  - `contractEntry`: one of `JsActiveContract` | `JsEmpty` | `JsIncompleteAssigned` | `JsIncompleteUnassigned`

For `JsActiveContract`, the contract id and payload come from:

- `contractEntry.JsActiveContract.createdEvent.contractId`
- `contractEntry.JsActiveContract.createdEvent.createArgument` (contract payload; Daml `Int`
  and `Decimal` fields arrive as strings, `InstrumentId` as `{ admin, id }`)
- `contractEntry.JsActiveContract.createdEvent.createdEventBlob` and `synchronizerId` when
  `includeCreatedEventBlob` was set
- `templateId` comes back in package-id form even though the filter named the package — that
  asymmetry is normal.

## Flow used in this project

1. `GET /v2/state/ledger-end` → `offset`.
2. `POST /v2/state/active-contracts` with `activeAtOffset` (as a string) and one
   `TemplateFilter` under the party, `verbose: false` inside `eventFormat`, nothing else.
3. Parse the array; for each item take `contractEntry.JsActiveContract.createdEvent`, use
   `contractId` and `createArgument`, and filter client-side by payload where the template
   is shared (`owner === partyId` on `UserWallet`, `marketId` on `Position`).

Set `VITE_DEBUG_ACTIVE_CONTRACTS=true` to log each browser lookup (`[active-contracts]`
with the template id, offset and raw response).
