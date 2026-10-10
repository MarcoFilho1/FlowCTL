#!/usr/bin/env bash
# Builds the FlowCTL overlay and installs it.
#
#   scripts/install-overlay.sh               build and install it where /flowctl init does:
#                                            in place of an installed copy, else ~/Applications
#   scripts/install-overlay.sh --dest DIR    install in DIR instead
#   scripts/install-overlay.sh --build-only  leave it in apps/overlay/build
#   scripts/install-overlay.sh --open        launch it when done
#   scripts/install-overlay.sh --universal   one binary for Apple silicon and Intel
#
# Needs pnpm, Node 22 and Swift (the Command Line Tools are enough; no Xcode).
# An app already at the destination is shown, quit if running, then replaced.
# After installing, the local build is unregistered from Launch Services and
# removed, so `open -a FlowCTL` opens the installed app (--build-only keeps it).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST=""
INSTALL=1
OPEN=0
UNIVERSAL=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dest) DEST="$2"; shift 2 ;;
    --build-only) INSTALL=0; shift ;;
    --open) OPEN=1; shift ;;
    --universal) UNIVERSAL=1; shift ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

APP_ID="dev.flowctl.overlay"
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
OVERLAY="$ROOT/apps/overlay"
APP="$OVERLAY/build/FlowCTL.app"

echo "==> viewer (without fixtures)"
( cd "$ROOT" && pnpm install --frozen-lockfile >/dev/null && FLOWCTL_NO_FIXTURES=1 pnpm viewer:build >/dev/null )

if [ "$UNIVERSAL" = 1 ]; then
  # One build per architecture, joined by lipo (the Command Line Tools are enough).
  SLICES=()
  for arch in arm64 x86_64; do
    echo "==> overlay (swift build -c release, $arch)"
    swift build -c release --package-path "$OVERLAY" --product FlowCTL --triple "$arch-apple-macosx13.0"
    SLICES+=("$(swift build -c release --package-path "$OVERLAY" --product FlowCTL --triple "$arch-apple-macosx13.0" --show-bin-path)/FlowCTL")
  done
  BIN="$OVERLAY/.build/FlowCTL-universal"
  lipo -create "${SLICES[@]}" -output "$BIN"
else
  echo "==> overlay (swift build -c release)"
  swift build -c release --package-path "$OVERLAY" --product FlowCTL
  BIN="$(swift build -c release --package-path "$OVERLAY" --product FlowCTL --show-bin-path)/FlowCTL"
fi

echo "==> $APP"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/viewer"
cp "$BIN" "$APP/Contents/MacOS/FlowCTL"
cp "$OVERLAY/Resources/Info.plist" "$APP/Contents/Info.plist"
cp "$ROOT/apps/viewer/dist/index.html" "$APP/Contents/Resources/viewer/index.html"
codesign --force --sign - --timestamp=none "$APP"
codesign --verify "$APP"

if [ "$INSTALL" = 0 ]; then
  echo "built $APP"
  TARGET="$APP"
else
  # Like /flowctl init: replace an installed copy where it is (the person's
  # own folder first), else install in ~/Applications, no admin password.
  if [ -z "$DEST" ]; then
    DEST="$HOME/Applications"
    for place in "$HOME/Applications" "/Applications"; do
      if [ -e "$place/FlowCTL.app" ]; then DEST="$place"; break; fi
    done
  fi
  TARGET="$DEST/FlowCTL.app"
  if [ -e "$TARGET" ]; then
    OLD_VERSION="$(defaults read "$TARGET/Contents/Info" CFBundleShortVersionString 2>/dev/null || echo unknown)"
    echo "==> replacing $TARGET (version $OLD_VERSION, modified $(stat -f '%Sm' "$TARGET"))"
    if pgrep -xq FlowCTL; then
      echo "    quitting the running FlowCTL"
      osascript -e "tell application id \"$APP_ID\" to quit" >/dev/null 2>&1 || pkill -x FlowCTL || true
      for _ in 1 2 3 4 5 6 7 8 9 10; do pgrep -xq FlowCTL || break; sleep 0.5; done
    fi
    rm -rf "$TARGET"
  fi
  mkdir -p "$DEST"
  ditto "$APP" "$TARGET"
  echo "installed $TARGET"
  # `open -a FlowCTL` (how the mod opens the overlay) must find the installed
  # app, not this build. Unregistering alone does not last (Spotlight finds a
  # freshly built bundle and registers it again), so the staged copy goes too.
  "$LSREGISTER" -u "$APP" >/dev/null 2>&1 || true
  rm -rf "$APP"
  "$LSREGISTER" -f "$TARGET" >/dev/null 2>&1 || true
  echo "registered $TARGET with Launch Services; the local build was unregistered and removed"
fi

if [ "$OPEN" = 1 ]; then
  open "$TARGET"
fi
