#!/bin/sh
set -eu

PROJECT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
PROJECT="$PROJECT_DIR/ios/App/App.xcodeproj"
DERIVED_DATA="$PROJECT_DIR/ios/DerivedData/native"

printf '%s\n' "Available iOS Simulator devices:"
open -a Simulator >/dev/null 2>&1 || true
sleep 2
simulator_status=0
simulator_output=$(xcrun simctl list devices available 2>&1) || simulator_status=$?

if [ "$simulator_status" -ne 0 ]; then
  echo "CoreSimulator service is unavailable. Quit/reopen Simulator or restart the Mac, then try again."
  printf '%s\n' "$simulator_output" | tail -4
  exit 1
fi

devices=$(printf '%s\n' "$simulator_output" | awk '
  /^-- iOS / {
    runtime = $0
    sub(/^-- /, "", runtime)
    sub(/ --$/, "", runtime)
    next
  }
  /^    (iPhone|iPad)/ {
    line = $0
    sub(/^    /, "", line)
    device_id = $(NF - 1)
    gsub(/[()]/, "", device_id)
    name = line
    sub(/ \([^()]*\) \([^()]*\).*$/, "", name)
    print name "|" runtime "|" device_id
  }
')

if [ -z "$devices" ]; then
  echo "No available iPhone/iPad simulator found. Open Xcode and install an iOS Simulator runtime."
  exit 1
fi

device_file=$(mktemp "${TMPDIR:-/tmp}/truth-oracle-devices.XXXXXX")
trap 'rm -f "$device_file"' EXIT
printf '%s\n' "$devices" > "$device_file"

index=1
while IFS='|' read -r name runtime device_id; do
  echo "  $index) $name ($runtime)"
  index=$((index + 1))
done < "$device_file"

printf 'Select simulator number: '
read choice
case "$choice" in
  ''|*[!0-9]*) echo "Invalid simulator selection."; exit 1 ;;
esac

selected=$(sed -n "${choice}p" "$device_file")
if [ -z "$selected" ]; then
  echo "Invalid simulator selection."
  exit 1
fi

device_id=$(printf '%s' "$selected" | cut -d'|' -f3)
device_name=$(printf '%s' "$selected" | cut -d'|' -f1)

xcrun simctl boot "$device_id" >/dev/null 2>&1 || true
xcrun simctl bootstatus "$device_id" -b

xcodebuild \
  -project "$PROJECT" \
  -scheme App \
  -configuration Debug \
  -destination "id=$device_id" \
  -derivedDataPath "$DERIVED_DATA" \
  CODE_SIGNING_ALLOWED=NO \
  build

xcrun simctl install "$device_id" "$DERIVED_DATA/Build/Products/Debug-iphonesimulator/App.app"
xcrun simctl launch "$device_id" com.truthoracle.app
echo "TruthOracle launched on $device_name."
