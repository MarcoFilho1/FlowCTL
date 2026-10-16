import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import type { Replay } from "./DevControls.tsx";
import { FIXTURES, loadFixture, replaySnapshots } from "./player.ts";
import { createSessionStore, installBridge } from "./store.ts";
import "./styles.css";
import { QuickSettingsPage, SettingsPage } from "./windows/Pages.tsx";

const store = createSessionStore();
// Installed before the first render, so a push that arrives early still lands.
installBridge(store);

// ?fixture=<name>[,<name>...] replays recorded sessions; ?fixture=all plays
// every one; &at=<event> (1-based) or &at=end opens them there, paused.
const params = new URLSearchParams(location.search);
const requested = params.get("fixture");
let replays: Replay[] | undefined;
if (requested !== null) {
  const names = requested === "all" ? [...FIXTURES] : requested.split(",").map((name) => name.trim()).filter(Boolean);
  replays = names.flatMap((name) => {
    const events = loadFixture(name);
    if (!events) {
      console.warn(`flowctl: no fixture named ${name}; known: ${FIXTURES.join(", ")}`);
      return [];
    }
    return [{ name, events, snapshots: replaySnapshots(events, name) }];
  });
}

// ?look=smooth draws the vector style instead of pixel art.
const look = params.get("look");
if (look === "smooth" || look === "pixel") store.setLook(look);

// ?sound=off silences the cues (the overlay's Sound menu does it there).
if (params.get("sound") === "off") store.setSound(false);
// ?sounds=smooth|pixel plays that set whatever the look.
const sounds = params.get("sounds");
if (sounds === "smooth" || sounds === "pixel") store.setSoundStyle(sounds);

// ?theme=dark|light overrides macOS's appearance.
const theme = params.get("theme");
if (theme === "dark" || theme === "light") store.setTheme(theme);

// ?dream=now starts the idle animation at once (demos, screenshots).
const dreamAfter = params.get("dream") === "now" ? 0 : undefined;

// ?subagents=hide leaves subagents out of the graph.
if (params.get("subagents") === "hide") store.setShowSubagents(false);

const at = params.get("at");
const startAt = at === "end" ? "end" : at !== null && Number.isInteger(Number(at)) ? Number(at) : undefined;

// ?ui=controls|settings: the Windows app's tray flyout and Settings window (src/windows).
const ui = params.get("ui");

const root = document.getElementById("root");
if (root && (ui === "controls" || ui === "settings")) {
  createRoot(root).render(<StrictMode>{ui === "controls" ? <QuickSettingsPage /> : <SettingsPage />}</StrictMode>);
} else if (root) {
  createRoot(root).render(
    <StrictMode>
      <App store={store} {...(replays ? { replays } : {})} {...(startAt !== undefined ? { startAt } : {})} {...(dreamAfter !== undefined ? { dreamAfter } : {})} />
    </StrictMode>
  );
}
