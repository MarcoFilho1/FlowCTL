# FlowCTL overlay (macOS)

A floating, transparent window that draws the live graph of every Claude Code
session running the FlowCTL mod. It is the viewer (`apps/viewer`) in a
`WKWebView`, fed by the mod over a Unix socket.

## Install

```
scripts/install-overlay.sh            # builds and installs /Applications/FlowCTL.app
scripts/install-overlay.sh --open     # ...and opens it
scripts/install-overlay.sh --build-only   # leaves it in apps/overlay/build
```

Needs pnpm, Node 22 and Swift (the Command Line Tools are enough, no Xcode).
An app already installed is shown (version, date), quit if running, then
replaced. The app is signed ad hoc, not notarized: if macOS says it cannot be
opened (an app downloaded rather than built here), clear the quarantine flag:

```
xattr -dr com.apple.quarantine /Applications/FlowCTL.app
```

The mod opens the overlay by itself when a session starts (`open -g -a
FlowCTL`, setting `autoOpenOverlay`).

## Close, hide, quit

It can always be closed:

- the **×** at the top-left of the window hides it (so does **⌘W** once you
  have clicked the window);
- the **menu bar item** (the graph icon; a yellow warning while a session waits
  on you) has **Show/Hide Panel**, **Opacity**, **Always on Top**, **Show
  Automatically**, **Hide When Idle** and **Quit FlowCTL**;
- **⌘Q** quits once you have clicked the window.

Hidden by you, it comes back only for a new session or one that starts
waiting on you (with **Show Automatically** on). **Hide When Idle** hides it
after a minute with no session working or waiting.

## Uninstall

Quit it from the menu bar, then:

```
rm -rf /Applications/FlowCTL.app
defaults delete dev.flowctl.overlay      # window place and menu settings
rm -rf ~/.flowctl/sessions               # snapshots the mod left (optional)
```

The Automation permission (used to select a terminal tab) is under System
Settings > Privacy & Security > Automation.

## How it works

- **Window**: a borderless, non-activating `NSPanel` on every Space and over
  full-screen apps, with no background or shadow of its own: the graph floats
  over the screen. It never takes the terminal's keyboard focus when it
  appears; a click makes it key. A thin strip on top holds the close button and
  is the handle to drag it by.
- **Size**: starts at 120×120 and follows the size the viewer asks for
  (`postMessage({ type: "size", width, height })`), up to 480×640 or 40% of
  the screen each way, animated over 200 ms. It grows away from its anchor
  corner (top-right at first); after a drag the anchor is the nearest screen
  corner. Anchor and settings live in UserDefaults (`dev.flowctl.overlay`).
- **Socket**: `~/.flowctl/overlay.sock` (0600, in `~/.flowctl`, 0700), HTTP
  with one request per connection. `GET /health` answers `ok`; `POST /snapshot`
  takes a schema 1 snapshot and hands it to `window.flowctl.push` as an
  argument (`callAsyncJavaScript`), never as script text. A snapshot whose seq
  is not newer than its session's is dropped. Only one overlay runs: a second
  one finds the first answering `/health` and quits.
- **Sessions**: on launch it shows the snapshots in `~/.flowctl/sessions`
  that are neither ended nor older than a day, and deletes those (again every
  hour). An ended session's tab closes 30 s after it ended.
- **Click on a node** (`postMessage({ type: "focus", sessionId, nodeId })`):
  brings that session's terminal forward from the snapshot's `terminal`
  field. Terminal.app and iTerm2 get the session's own tab selected by
  AppleScript (by tty; iTerm2 also by `ITERM_SESSION_ID`), which asks once for
  Automation permission; refused or not found, the app is just brought
  forward. Other terminals are brought forward by bundle id. Maestri has no
  public way to focus one terminal (no URL scheme, AppleScript dictionary or
  CLI command), so it is only brought forward.

## Develop

```
swift build --package-path apps/overlay
swift run --package-path apps/overlay overlay-checks   # the core checks, no Xcode needed
swift test --package-path apps/overlay                 # the same checks under XCTest (needs Xcode)
FLOWCTL_VIEWER_DIR=apps/viewer/dist .build/debug/FlowCTL   # run against a local viewer build
```

`FlowCTLCore` holds the logic without AppKit (HTTP parsing, snapshots,
sessions, file cleanup, window geometry, terminal focus plans);
`OverlayChecks` holds its checks. With `FLOWCTL_DEBUG=1` the app also serves
`/debug/*` endpoints (state, a capture of its own window, and clicks on its
controls) for checking it without Screen Recording or Accessibility
permissions; see `Sources/FlowCTL/DebugHooks.swift`.
