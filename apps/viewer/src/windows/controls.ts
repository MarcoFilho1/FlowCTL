// The Windows app's own pages (apps/overlay-tauri): the tray flyout, in the
// manner of Windows 11's Quick Settings, and the Settings window, in the
// manner of Windows Settings. They are this bundle opened with ?ui=controls
// or ?ui=settings; the app sends them its state and takes their changes
// through Tauri commands.

export type SessionState = "working" | "waiting_you" | "idle" | "ended";
export type SoundChoice = "off" | "look" | "smooth" | "pixel";
export type PanelSize = "Small" | "Medium" | "Large";

export interface ControlsPrefs {
  opacity: number;
  alwaysOnTop: boolean;
  showAutomatically: boolean;
  hideWhenIdle: boolean;
  showSubagents: boolean;
  idleAnimation: boolean;
  sound: SoundChoice;
  theme: "auto" | "dark" | "light";
  look: "pixel" | "smooth";
  size: PanelSize;
}

export interface ControlsState {
  version: string;
  /** Windows' accent color, "#rrggbb". */
  accent: string;
  overlayShown: boolean;
  sessions: { id: string; name: string; state: SessionState }[];
  prefs: ControlsPrefs;
}

export type ControlsAction =
  | { action: "toggleOverlay" }
  | { action: "focus"; id: string }
  | { action: "settings" }
  | { action: "quit" }
  /** Esc in the flyout. */
  | { action: "close" };

declare global {
  interface Window {
    /** The app calls update(state) whenever something the pages show changed. */
    flowctlControls?: { update(state: ControlsState): void };
    __TAURI_INTERNALS__?: { invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> };
  }
}

export const OPACITIES = [1, 0.9, 0.8, 0.7, 0.5];

/** A state to draw the pages with outside the app (?ui=controls&mock=1, tests). */
export const MOCK_STATE: ControlsState = {
  version: "1.0.7",
  accent: "#0067c0",
  overlayShown: true,
  sessions: [
    { id: "a", name: "FlowCTL", state: "working" },
    { id: "b", name: "PoupAI", state: "waiting_you" },
    { id: "c", name: "fileshare", state: "idle" }
  ],
  prefs: {
    opacity: 1,
    alwaysOnTop: true,
    showAutomatically: true,
    hideWhenIdle: true,
    showSubagents: true,
    idleAnimation: true,
    sound: "look",
    theme: "auto",
    look: "pixel",
    size: "Medium"
  }
};

function invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
  return window.__TAURI_INTERNALS__?.invoke(cmd, args).catch(() => undefined) ?? Promise.resolve(undefined);
}

/** The app's state now; the mock outside the app. */
export async function fetchState(): Promise<ControlsState | undefined> {
  if (!window.__TAURI_INTERNALS__) return MOCK_STATE;
  return (await invoke("controls_state")) as ControlsState | undefined;
}

export function setPref<K extends keyof ControlsPrefs>(key: K, value: ControlsPrefs[K]): void {
  void invoke("controls_set", { key, value });
}

export function act(action: ControlsAction): void {
  void invoke("controls_action", { request: action });
}

/** The flyout fits its window to its content. */
export function reportHeight(height: number): void {
  void invoke("controls_height", { height: Math.ceil(height) });
}
