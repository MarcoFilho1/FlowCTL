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
replaced. The local build is then unregistered from Launch Services and
removed, so `open -a FlowCTL` finds the installed app. The app is signed ad hoc, not notarized: if macOS says it cannot be
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
  on you) has **Show/Hide Panel**, **Opacity**, **Size** (Small 280×180,
  Medium 360×220, Large 480×300), **Look** (Pixel, the default, or Smooth),
  **Always on Top**, **Show Automatically**,
  **Hide When Idle** and **Quit FlowCTL**;
- **⌘Q** quits once you have clicked the window.

Hidden by you, it comes back only for a new session or one that starts
waiting on you (with **Show Automatically** on).

**Hide When Idle** is on by default: when no session has been working or
waiting for more than five minutes, the panel fades out by itself, and it fades
back in as soon as a session starts working or waits on you again, even when
it was hidden that way (a panel you closed with × stays closed for ordinary
activity: only a new session or one that starts waiting brings it back). The
viewer keeps drawing the whole graph meanwhile. Turn the item off to keep it up
all the time.

Hiding and showing fade over 0.25 s.

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
  over the screen. It never takes the terminal's keyboard focus: a click on a
  node goes to the page without making the panel key; only a click on the thin
  strip on top (the close button and the handle to drag it by) does, so ⌘W and
  ⌘Q reach it.
- **Hover**: WebKit ignores mouse moves while its app is inactive, and the
  overlay's always is. An always-on tracking area relays each move to a small
  script the overlay adds to the page, which raises the `mouseover`/`mouseout`
  a real move would; the viewer's hover cards work over any app.
- **Size**: fixed, picked in the menu bar (Medium, 360×220, by default). It
  keeps one corner (its anchor) where it is: top-right at first, and after a
  drag the nearest screen corner. Size, anchor and settings live in
  UserDefaults (`dev.flowctl.overlay`). The viewer pans and zooms the graph
  inside it.
- **Drag and scroll**: pressing and dragging in the graph, and two-finger or
  wheel scrolling, reach the page as WebKit's own pointer and wheel events
  even while the app is inactive, and never make the panel key. The page
  also has `__flowctlDrag(phase, x, y)` and `__flowctlWheel(dx, dy, x?, y?)`,
  which raise the same events synthetically (pointerId 1, buttons 1 while
  pressed), should a WebKit version stop delivering them.
- **Socket**: `~/.flowctl/overlay.sock` (0600, in `~/.flowctl`, 0700), HTTP
  with one request per connection. `GET /health` answers `ok`; `POST /snapshot`
  takes a schema 1 snapshot and hands it to `window.flowctl.push` as an
  argument (`callAsyncJavaScript`), never as script text. A snapshot whose seq
  is not newer than its session's is dropped. Only one overlay runs: a second
  one finds the first answering `/health` and quits.
- **Sessions**: on launch it shows the snapshots in `~/.flowctl/sessions`
  that are neither ended nor older than a day, and deletes those (again every
  hour). An ended session's tab closes 30 s after it ended, through
  `window.flowctl.remove(sessionId)` (a page without it is reloaded instead).
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

With `FLOWCTL_DEBUG=1`, `FLOWCTL_IDLE_SECONDS=20` shortens the idle limit
(five minutes by default), to see the hide and show without waiting.

`FlowCTLCore` holds the logic without AppKit (HTTP parsing, snapshots,
sessions, file cleanup, window geometry, terminal focus plans);
`OverlayChecks` holds its checks. With `FLOWCTL_DEBUG=1` the app also serves
`/debug/*` endpoints (state, a capture of its own window, and clicks on its
controls) for checking it without Screen Recording or Accessibility
permissions; see `Sources/FlowCTL/DebugHooks.swift`.
