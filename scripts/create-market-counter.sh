#!/usr/bin/env bash
# Create the TruthOracle MarketCounter contract on a Canton participant (run once).
# API reference: https://docs.digitalasset.com/build/3.4/reference/json-api/openapi.html
#   - GET /v2/state/connected-synchronizers (params: party, participantId, identityProviderId — all optional)
#   - GET /v2/parties (params: pageSize, pageToken, filter-party, identity-provider-id — all optional)
#   - POST /v2/interactive-submission/prepare (body: JsPrepareSubmissionRequest)
#   - POST /v2/interactive-submission/execute (body: JsExecuteSubmissionRequest)
# Requires: curl, jq.
# Set BASE_URL and either TOKEN or Keycloak credentials (see below).
# Optional: ADMIN_PARTY_ID. Defaults to TruthOracle admin party; if set to empty, script tries GET /v2/parties.
# All API responses are logged so you can share them for debugging.

set -e

# --- Configure these (or export before running) ---
BASE_URL="${BASE_URL:-https://api.validator.dev.digik.cantor8.tech/api/ledger}"
# Default admin party (TruthOracle wallet connect). Override with ADMIN_PARTY_ID env if needed.
ADMIN_PARTY_ID="${ADMIN_PARTY_ID:-9112efc008f3f67e48684a54644d513a::122057c91f560532605edd09804cab9be92c9303cb2f0ab36fe5a299bb2994643e69}"
TOKEN="${TOKEN:-}"                      # Bearer token. If empty, we try Keycloak below.

# Keycloak: if TOKEN is not set, we fetch it with client_credentials (hardcoded defaults).
KEYCLOAK_TOKEN_URL="${KEYCLOAK_TOKEN_URL:-https://auth.dev.digik.cantor8.tech/realms/master/protocol/openid-connect/token}"
KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID:-sachin}"
KEYCLOAK_CLIENT_SECRET="${KEYCLOAK_CLIENT_SECRET:-1xeiQKb4hwAbgL2nWTJxMomRfkPw8wNv}"

PACKAGE_ID="${PACKAGE_ID:-54bb6ae431649ce7e6e422093009054a1675bdd3da8f511f6d260d032ef8b9b3}"
TEMPLATE_ID="${PACKAGE_ID}:Truthoracle:MarketCounter"

echo "=== Running create-market-counter ==="
echo "BASE_URL=$BASE_URL"
echo ""

# --- 0. Optional: fetch token from Keycloak ---
if [ -z "$TOKEN" ] && [ -n "$KEYCLOAK_CLIENT_SECRET" ]; then
  echo ">>> POST $KEYCLOAK_TOKEN_URL (client_credentials)"
  TOKEN_RESP=$(curl -s -S -w "\n%{http_code}" -X POST "$KEYCLOAK_TOKEN_URL" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "grant_type=client_credentials" \
    -d "client_id=$KEYCLOAK_CLIENT_ID" \
    -d "client_secret=$KEYCLOAK_CLIENT_SECRET")
  TOKEN_HTTP=$(echo "$TOKEN_RESP" | tail -n1)
  TOKEN_BODY=$(echo "$TOKEN_RESP" | sed '$d')
  echo "[HTTP $TOKEN_HTTP]"
  echo "$TOKEN_BODY" | jq . 2>/dev/null || echo "$TOKEN_BODY"
  TOKEN=$(echo "$TOKEN_BODY" | jq -r '.access_token // empty')
  if [ -z "$TOKEN" ]; then
    echo "Keycloak response did not contain access_token. Set TOKEN manually or check KEYCLOAK_*."
    exit 1
  fi
  echo "(Token obtained, length ${#TOKEN})"
  echo ""
fi

# --- 1. Connected synchronizers ---
echo ">>> GET ${BASE_URL}/v2/state/connected-synchronizers"
SYNC_RESP=$(curl -s -S -w "\n%{http_code}" -X GET "${BASE_URL}/v2/state/connected-synchronizers" \
  ${TOKEN:+ -H "Authorization: Bearer $TOKEN"} \
  -H "Content-Type: application/json")
SYNC_HTTP_CODE=$(echo "$SYNC_RESP" | tail -n1)
SYNC_BODY=$(echo "$SYNC_RESP" | sed '$d')
echo "[HTTP $SYNC_HTTP_CODE]"
echo "$SYNC_BODY" | jq . 2>/dev/null || echo "$SYNC_BODY"
echo ""

SYNC_IDS=($(echo "$SYNC_BODY" | jq -r '.connectedSynchronizers[]?.synchronizerId // empty'))
if [ ${#SYNC_IDS[@]} -eq 0 ]; then
  echo "No connected synchronizers in response. Stopping so you can share the output above."
  exit 1
fi
SYNCHRONIZER_ID="${SYNC_IDS[0]}"
echo "Using synchronizerId: $SYNCHRONIZER_ID"
echo ""

# --- 2. Optionally get party from /v2/parties if ADMIN_PARTY_ID was set to empty ---
if [ -z "$ADMIN_PARTY_ID" ]; then
  PARTIES_PAGE_SIZE="${PARTIES_PAGE_SIZE:-500}"
  echo ">>> GET ${BASE_URL}/v2/parties?pageSize=${PARTIES_PAGE_SIZE} (to pick admin party)"
  PARTIES_RESP=$(curl -s -S -w "\n%{http_code}" -X GET "${BASE_URL}/v2/parties?pageSize=${PARTIES_PAGE_SIZE}" \
    ${TOKEN:+ -H "Authorization: Bearer $TOKEN"} \
    -H "Content-Type: application/json")
  PARTIES_HTTP_CODE=$(echo "$PARTIES_RESP" | tail -n1)
  PARTIES_BODY=$(echo "$PARTIES_RESP" | sed '$d')
  echo "[HTTP $PARTIES_HTTP_CODE]"
  echo "$PARTIES_BODY" | jq '{ partyDetails: (.partyDetails[:5] // []), totalFirstPage: (.partyDetails | length), nextPageToken: .nextPageToken }' 2>/dev/null || echo "$PARTIES_BODY"
  echo ""

  ADMIN_PARTY_ID=$(echo "$PARTIES_BODY" | jq -r '[.partyDetails[] | select(.isLocal == true) | .party] | sort_by(length) | .[0] // .partyDetails[0].party // empty')
  if [ -n "$ADMIN_PARTY_ID" ]; then
    echo "Using party from /v2/parties as admin: $ADMIN_PARTY_ID"
  else
    echo "No party from /v2/parties. Set ADMIN_PARTY_ID or use default (re-run without exporting ADMIN_PARTY_ID='')."
    exit 1
  fi
  echo ""
fi
echo "Using admin party: $ADMIN_PARTY_ID"
echo ""

# --- 3. Prepare (JsPrepareSubmissionRequest per OpenAPI) ---
# Required: userId (or from JWT), commandId, synchronizerId, verboseHashing, commands, actAs (non-empty).
# Optional: readAs, disclosedContracts, packageIdSelectionPreference.
# Use a short userId for the API (some participants enforce max length); actAs is the Daml party.
PREPARE_USER_ID="${PREPARE_USER_ID:-sachin}"
COMMAND_ID=$(uuidgen 2>/dev/null || echo "cmd-$(date +%s)-$RANDOM")
PREPARE_BODY=$(jq -n \
  --arg userId "$PREPARE_USER_ID" \
  --arg commandId "$COMMAND_ID" \
  --arg synchronizerId "$SYNCHRONIZER_ID" \
  --arg templateId "$TEMPLATE_ID" \
  --arg admin "$ADMIN_PARTY_ID" \
  --argjson packageIdSelectionPreference "[ \"$PACKAGE_ID\" ]" \
  '{
    userId: $userId,
    commandId: $commandId,
    synchronizerId: $synchronizerId,
    verboseHashing: false,
    commands: [
      {
        CreateCommand: {
          templateId: $templateId,
          createArguments: { admin: $admin, value: 0 }
        }
      }
    ],
    actAs: [ $admin ],
    readAs: [],
    disclosedContracts: [],
    packageIdSelectionPreference: $packageIdSelectionPreference
  }')

echo ">>> POST ${BASE_URL}/v2/interactive-submission/prepare"
echo "Request body:"
echo "$PREPARE_BODY" | jq .
PREPARE_RESP=$(curl -s -S -w "\n%{http_code}" -X POST "${BASE_URL}/v2/interactive-submission/prepare" \
  ${TOKEN:+ -H "Authorization: Bearer $TOKEN"} \
  -H "Content-Type: application/json" \
  -d "$PREPARE_BODY")
PREPARE_HTTP_CODE=$(echo "$PREPARE_RESP" | tail -n1)
PREPARE_BODY_RESP=$(echo "$PREPARE_RESP" | sed '$d')
echo "[HTTP $PREPARE_HTTP_CODE]"
echo "$PREPARE_BODY_RESP" | jq . 2>/dev/null || echo "$PREPARE_BODY_RESP"
echo ""

PREPARED=$(echo "$PREPARE_BODY_RESP" | jq -r '.preparedTransaction // .prepared_transaction // empty')
if [ -z "$PREPARED" ]; then
  echo "Prepare did not return preparedTransaction. Share the output above."
  exit 1
fi

# --- 4. Execute (JsExecuteSubmissionRequest) ---
# OpenAPI execute can require preparedTransaction, partySignatures, deduplicationPeriod, submissionId, hashingSchemeVersion.
# Some participants accept only preparedTransaction when the participant signs on behalf of the user.
EXEC_BODY=$(jq -n --arg pt "$PREPARED" '{ preparedTransaction: $pt }')
echo ">>> POST ${BASE_URL}/v2/interactive-submission/execute"
EXEC_RESP=$(curl -s -S -w "\n%{http_code}" -X POST "${BASE_URL}/v2/interactive-submission/execute" \
  ${TOKEN:+ -H "Authorization: Bearer $TOKEN"} \
  -H "Content-Type: application/json" \
  -d "$EXEC_BODY")
EXEC_HTTP_CODE=$(echo "$EXEC_RESP" | tail -n1)
EXEC_BODY_RESP=$(echo "$EXEC_RESP" | sed '$d')
echo "[HTTP $EXEC_HTTP_CODE]"
echo "$EXEC_BODY_RESP" | jq . 2>/dev/null || echo "$EXEC_BODY_RESP"
echo ""

ERROR=$(echo "$EXEC_BODY_RESP" | jq -r '.error // empty')
if [ -n "$ERROR" ]; then
  echo "Execute failed. Share the output above."
  exit 1
fi
CMD_ID=$(echo "$EXEC_BODY_RESP" | jq -r '.commandId // .command_id // .transactionId // .transaction_id // "ok"')
echo "MarketCounter created successfully. commandId: $CMD_ID"
