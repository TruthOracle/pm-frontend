# Active contracts API reference (JSON Ledger API)

Based on the [OpenAPI spec](https://docs.digitalasset.com/build/3.4/reference/json-api/openapi.html) for the JSON Ledger API.

## Endpoint

- **Method:** `POST`
- **Path:** `/v2/state/active-contracts`

## Query parameters (OpenAPI)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `limit` | integer (int64) | No | Max number of elements to return. Capped by server `http-list-max-elements-limit`. |
| `stream_idle_timeout_ms` | integer (int64) | No | Timeout for open-ended streams. |

**Note:** Some implementations also accept a `party` query parameter for server-side filtering; it is not in the OpenAPI path. Our client sends `party=<partyId>` for compatibility.

## Request body: `GetActiveContractsRequest`

Content-Type: `application/json`.

### Top-level fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `activeAtOffset` | integer (int64) | **Yes** | Snapshot offset. Must be ≤ ledger end and ≥ last pruning offset. Use `0` for ledger begin (returns empty set). |
| `eventFormat` | `EventFormat` | No* | Format of contract entries in the response (ACS_DELTA shape). Use this **or** legacy `filter`/`verbose`, not both. |
| `filter` | `TransactionFilter` | No | Deprecated (removed in 3.5.0). If set, `eventFormat` must be unset. |
| `verbose` | boolean | No | Deprecated. If set, `eventFormat` must be unset. |

\* If neither `eventFormat` nor legacy `filter` is set, the API defaults from `filter`/`verbose`; for new code, prefer `eventFormat`.

### `EventFormat`

| Field | Type | Description |
|-------|------|-------------|
| `filtersByParty` | `Map_Filters` | Map: party ID → `Filters`. For active-contracts: create/archive events for contracts whose **stakeholders** include at least one listed party and match the per-party filter. |
| `filtersForAnyParty` | `Filters` | Wildcard filters applied to all parties. |
| `verbose` | boolean | If true, include labels for record fields in values. |

### `Filters` (per-party or for-any-party)

| Field | Type | Description |
|-------|------|-------------|
| `cumulative` | array of `CumulativeFilter` | Each entry expands the scope (templates/interfaces/wildcard). Default if absent: single `WildcardFilter`, no `include_created_event_blob`. |

### `CumulativeFilter`

| Field | Type | Description |
|-------|------|-------------|
| `identifierFilter` | `IdentifierFilter` | One of: `Empty`, `InterfaceFilter`, `TemplateFilter`, `WildcardFilter`. |

### `IdentifierFilter` (one-of)

- **TemplateFilter** – specific template:
  - `TemplateFilter.value.templateId` (string, required): e.g. `"packageId:moduleName:entityName"` (package-id reference format).
  - `TemplateFilter.value.includeCreatedEventBlob` (boolean, optional): include blob for disclosed contracts.
- **InterfaceFilter** – contracts implementing an interface (`interfaceId`, etc.).
- **WildcardFilter** – all templates (`includeCreatedEventBlob` optional).
- **Empty** – no filter.

## Example request body (template filter for one party)

```json
{
  "activeAtOffset": 12345,
  "eventFormat": {
    "filtersByParty": {
      "<partyId>": {
        "cumulative": [
          {
            "identifierFilter": {
              "TemplateFilter": {
                "value": {
                  "templateId": "packageId:moduleName:entityName",
                  "includeCreatedEventBlob": false
                }
              }
            }
          }
        ]
      }
    },
    "filtersForAnyParty": {},
    "verbose": true
  }
}
```

- `activeAtOffset`: get from `GET /v2/state/ledger-end` → `response.offset` (or `0` for empty snapshot).
- Replace `<partyId>` with the Daml party ID (e.g. `619a8e89...::12202464...`).
- `templateId`: package-id reference format; both package-name and package-id reference are supported (package-id format deprecated in 3.4).

## Response

- **200:** JSON array of `JsGetActiveContractsResponse`:
  - `workflowId` (optional)
  - `contractEntry`: one of `JsActiveContract` | `JsEmpty` | `JsIncompleteAssigned` | `JsIncompleteUnassigned`

For `JsActiveContract`, the contract id and payload come from:

- `contractEntry.JsActiveContract.createdEvent.contractId`
- `contractEntry.JsActiveContract.createdEvent.createArgument` (contract payload)

## Flow used in this project

1. `GET /v2/state/ledger-end` → obtain `offset`.
2. `POST /v2/state/active-contracts?limit=200&party=<partyId>` with body:
   - `activeAtOffset`: that offset (or 0).
   - `eventFormat`: `filtersByParty` for the party with a single `TemplateFilter` for the desired template, plus `verbose: true`.
3. Parse the returned array; for each item take `contractEntry.JsActiveContract.createdEvent` and use `contractId` and `createArgument` (and filter client-side by payload if needed, e.g. `admin === partyId` for `MarketCounter`).
