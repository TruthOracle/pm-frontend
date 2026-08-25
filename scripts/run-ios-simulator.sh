#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DERIVED_DATA="$PROJECT_DIR/.build/native-simulator"
DEVICE_ID="$(xcrun simctl list devices available | awk -F '[()]' '/iPhone/{print $2; exit}')"

if [[ -z "$DEVICE_ID" ]]; then
  echo "No available iPhone Simulator found. Install an iOS Simulator runtime in Xcode Settings > Components."
  exit 1
fi

xcrun simctl boot "$DEVICE_ID" 2>/dev/null || true
open -a Simulator
xcrun simctl bootstatus "$DEVICE_ID" -b

xcodebuild \
  -project "$PROJECT_DIR/ios/App/App.xcodeproj" \
  -scheme App \
  -destination "id=$DEVICE_ID" \
  -derivedDataPath "$DERIVED_DATA" \
  CODE_SIGNING_ALLOWED=NO \
  build

xcrun simctl install "$DEVICE_ID" "$DERIVED_DATA/Build/Products/Debug-iphonesimulator/App.app"
xcrun simctl launch "$DEVICE_ID" com.truthoracle.app
