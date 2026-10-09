#!/usr/bin/env bash
# Builds the spike with SwiftPM (Command Line Tools only, no Xcode) and
# assembles build/FlowCTLSpike.app around the release binary.
set -euo pipefail
cd "$(dirname "$0")"

swift build -c release
BIN="$(swift build -c release --show-bin-path)/FlowCTLSpike"

APP=build/FlowCTLSpike.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/FlowCTLSpike"
cp Resources/Info.plist "$APP/Contents/Info.plist"
cp -R Resources/web "$APP/Contents/Resources/web"
codesign --force --sign - "$APP"

echo "built $APP"
echo "run:  open $APP   (or $APP/Contents/MacOS/FlowCTLSpike to see the log)"
