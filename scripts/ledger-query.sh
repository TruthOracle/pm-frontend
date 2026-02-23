#!/bin/bash
#

set -e

LEDGER_API=https://api.validator.dev.digik.cantor8.tech/api/ledger
KEYCLOAK_URL=https://auth.dev.digik.cantor8.tech
KEYCLOAK_REALM=master
CLIENT_ID=sachin
CLIENT_SECRET=1xeiQKb4hwAbgL2nWTJxMomRfkPw8wNv

# Get OAuth token
TOKEN_URL="$KEYCLOAK_URL/realms/$KEYCLOAK_REALM/protocol/openid-connect/token"
TOKEN=$(curl -s -X POST "$TOKEN_URL" \
    -d "grant_type=client_credentials" \
    -d "client_id=$CLIENT_ID" \
    -d "client_secret=$CLIENT_SECRET" | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))")

# echo $TOKEN  # uncomment to debug

if [ -z "$TOKEN" ]; then
    echo "Error: Could not get access token"
    exit 1
fi

# echo "Deploying to DevNet..."

RESPONSE=$(curl -s -X GET \
    -H "Authorization: Bearer $TOKEN" \
    "$LEDGER_API/v2/state/ledger-end")

echo $RESPONSE

# Extract the offset from ledger-end response
OFFSET=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('offset', 0))")
echo "Offset: $OFFSET"

# Query active contracts
echo ""
echo "Querying active contracts..."
ACTIVE=$(curl -s -X POST \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    "$LEDGER_API/v2/state/active-contracts?limit=200" \
    -d "{\"verbose\":false,\"activeAtOffset\":$OFFSET,\"eventFormat\":{\"filtersByParty\":{},\"filtersForAnyParty\":{\"cumulative\":[{\"identifierFilter\":{\"WildcardFilter\":{\"value\":{\"includeCreatedEventBlob\":false}}}}]},\"verbose\":true}}")

echo $ACTIVE
