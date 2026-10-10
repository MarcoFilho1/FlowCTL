# FlowCTL overlay for Windows

The floating panel and tray icon of FlowCTL on Windows, built with
[Tauri](https://tauri.app): a small native window (WebView2) that hosts the
same viewer as the macOS app (`apps/viewer`). The macOS release keeps the
Swift app in `apps/overlay`; this one follows its behavior setting for
setting, and also runs on macOS for development.

## How it talks to the plugin

The plugin (`mod/live/transport.ts`) sends each session's graph over HTTP:

- **Windows:** the app listens on `127.0.0.1` at a port the system picks and
  writes `{port, token, pid, version}` to `~/.flowctl/overlay.json`. Every
  request carries `X-FlowCTL-Token`; one without it gets 401.
- **macOS and Linux (development):** a Unix socket at
  `~/.flowctl/overlay.sock`, as the Swift app.

Routes: `POST /snapshot`, `GET /health`, and `POST /show` (a second launch
shows the running app's panel). With `FLOWCTL_DEBUG=1`, `GET /debug/state`
returns the panel's state for automated checks.

## Layout

```
src-tauri/src/core/   pure logic, ported from apps/overlay/Sources/FlowCTLCore (cargo test)
src-tauri/src/        the window, the endpoint, the tray, bringing a terminal forward
icons-src/            the app icon's source (node icons-src/draw-icon.mjs icons-src/source.png)
```

## Develop

Needs Rust (stable), Node 22 and pnpm. Build the viewer first, since the app
embeds it at compile time:

```sh
FLOWCTL_NO_FIXTURES=1 pnpm viewer:build
cd apps/overlay-tauri/src-tauri
cargo test
cargo run
```

On a Mac where the FlowCTL app already runs, start this one with another
home so they don't share `~/.flowctl`: `HOME=$(mktemp -d) FLOWCTL_DEBUG=1 cargo run`.

`cargo build --release` makes `target/release/FlowCTL.exe`; the release
workflow zips it as `FlowCTL-<version>-windows-x64.zip`, which
`/flowctl init` installs in `%LOCALAPPDATA%\Programs\FlowCTL`.

## Differences from the macOS app

- A left click on the tray icon shows or hides the panel; a right click opens
  the menu.
- Clicking a node brings the terminal's window forward (Windows Terminal,
  VS Code, a console), not a specific tab.
- The binary is not signed. `/flowctl init` downloads it with `curl.exe`,
  which does not mark it as downloaded from the internet, so SmartScreen does
  not stop it.
