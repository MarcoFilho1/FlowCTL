// The Windows app's flyout (Quick Settings' manner) and Settings window
// (Windows Settings' manner). Both read the app's state and change it
// through the app; see controls.ts.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { act, fetchState, OPACITIES, reportHeight, setPref, type ControlsPrefs, type ControlsState, type SessionState } from "./controls.ts";
import { GlyphIcon, Icon, type Glyph } from "./Glyphs.tsx";
import "./fluent.css";

const LOOKS = [["pixel", "Pixel"], ["smooth", "Smooth"]] as const;
const THEMES = [["auto", "Auto"], ["dark", "Dark"], ["light", "Light"]] as const;
const SIZES = [["Small", "Small"], ["Medium", "Medium"], ["Large", "Large"]] as const;
const SOUNDS = [["off", "Off"], ["look", "Look"], ["smooth", "Clean"], ["pixel", "8-bit"]] as const;

/** The state the app sends, kept current. */
function useControlsState(): ControlsState | undefined {
  const [state, setState] = useState<ControlsState>();
  useEffect(() => {
    window.flowctlControls = { update: setState };
    void fetchState().then((first) => first && setState((now) => now ?? first));
    return () => {
      window.flowctlControls = undefined;
    };
  }, []);
  return state;
}

/** Applies a change at once in the page, and sends it to the app. */
function useChange(state: ControlsState | undefined, set: (state: ControlsState) => void) {
  return <K extends keyof ControlsPrefs>(key: K, value: ControlsPrefs[K]) => {
    if (state) set({ ...state, prefs: { ...state.prefs, [key]: value } });
    setPref(key, value);
  };
}

function useAccent(accent: string | undefined) {
  useEffect(() => {
    if (accent) document.documentElement.style.setProperty("--fl-accent-base", accent);
  }, [accent]);
}

function stateText(state: SessionState): string {
  return state === "working" ? "Working" : state === "waiting_you" ? "Needs you" : state === "idle" ? "Idle" : "Ended";
}

// MARK: Flyout

export function QuickSettingsPage() {
  const live = useControlsState();
  const [state, setState] = useState(live);
  useEffect(() => setState(live), [live]);
  useAccent(state?.accent);
  const change = useChange(state, setState);
  const root = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    // With the 16 px margin on each side, kept for the shadow.
    if (root.current) reportHeight(root.current.getBoundingClientRect().height + 32);
  });
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") act({ action: "close" });
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);

  if (!state) return null;
  const p = state.prefs;
  const toggles: { glyph: Glyph; label: string; on: boolean; run: () => void }[] = [
    {
      glyph: "overlay",
      label: state.overlayShown ? "Overlay" : "Overlay off",
      on: state.overlayShown,
      run: () => {
        setState({ ...state, overlayShown: !state.overlayShown });
        act({ action: "toggleOverlay" });
      }
    },
    { glyph: "onTop", label: "On top", on: p.alwaysOnTop, run: () => change("alwaysOnTop", !p.alwaysOnTop) },
    { glyph: "animation", label: "Animation", on: p.idleAnimation, run: () => change("idleAnimation", !p.idleAnimation) },
    { glyph: "autoShow", label: "Auto show", on: p.showAutomatically, run: () => change("showAutomatically", !p.showAutomatically) },
    { glyph: "hideWhenIdle", label: "Hide when idle", on: p.hideWhenIdle, run: () => change("hideWhenIdle", !p.hideWhenIdle) },
    { glyph: "subagents", label: "Subagents", on: p.showSubagents, run: () => change("showSubagents", !p.showSubagents) }
  ];
  const opacityIndex = Math.max(0, OPACITIES.findIndex((o) => Math.abs(o - p.opacity) < 0.01));

  return (
    <div className="fl fl-flyout" ref={root}>
      <div className="fl-flyout-body">
        <div className="fl-toggles">
          {toggles.map((toggle) => (
            <div key={toggle.glyph} className="fl-toggle-cell">
              <button
                type="button"
                className={`fl-toggle${toggle.on ? " is-on" : ""}`}
                aria-pressed={toggle.on}
                aria-label={toggle.label}
                onClick={toggle.run}
              >
                <GlyphIcon glyph={toggle.glyph} on={toggle.on} />
              </button>
              <span className="fl-toggle-label">{toggle.label}</span>
            </div>
          ))}
        </div>

        <div className="fl-slider-row">
          <Icon name="opacity" />
          <input
            className="fl-slider"
            type="range"
            min={0}
            max={OPACITIES.length - 1}
            step={1}
            // Left is the faintest, as a brightness slider.
            value={OPACITIES.length - 1 - opacityIndex}
            aria-label="Opacity"
            style={{ ["--fl-fill" as string]: `${((OPACITIES.length - 1 - opacityIndex) / (OPACITIES.length - 1)) * 100}%` }}
            onChange={(event) => change("opacity", OPACITIES[OPACITIES.length - 1 - Number(event.target.value)]!)}
          />
          <span className="fl-slider-value">{Math.round(p.opacity * 100)}%</span>
        </div>

        <div className="fl-choices">
          <Choice icon="look" label="Look" value={p.look} options={LOOKS} onChange={(v) => change("look", v)} />
          <Choice icon="theme" label="Theme" value={p.theme} options={THEMES} onChange={(v) => change("theme", v)} />
          <Choice icon="size" label="Size" value={p.size} options={SIZES.map(([v, t]) => [v, t.slice(0, 1)] as const)} onChange={(v) => change("size", v)} />
          <Choice icon="sound" label="Sound" value={p.sound} options={SOUNDS} onChange={(v) => change("sound", v)} />
        </div>

        <div className="fl-sessions">
          <div className="fl-caption">Sessions</div>
          {state.sessions.length === 0 ? (
            <div className="fl-empty">Start Claude Code in a terminal.</div>
          ) : (
            state.sessions.slice(0, 3).map((session) => (
              <button key={session.id} type="button" className="fl-session" onClick={() => act({ action: "focus", id: session.id })}>
                <span className={`fl-dot is-${session.state}`} />
                <span className="fl-session-name">{session.name}</span>
                <span className="fl-session-state">{stateText(session.state)}</span>
              </button>
            ))
          )}
          {state.sessions.length > 3 && <div className="fl-more">and {state.sessions.length - 3} more in the overlay</div>}
        </div>
      </div>

      <footer className="fl-flyout-footer">
        <span className="fl-footer-title">FlowCTL {state.version}</span>
        <span className="fl-footer-actions">
          <button type="button" className="fl-icon-button" title="Settings" aria-label="Settings" onClick={() => act({ action: "settings" })}>
            <Icon name="settings" />
          </button>
          <button type="button" className="fl-icon-button" title="Quit FlowCTL" aria-label="Quit FlowCTL" onClick={() => act({ action: "quit" })}>
            <Icon name="power" />
          </button>
        </span>
      </footer>
    </div>
  );
}

function Choice<V extends string>({
  icon,
  label,
  value,
  options,
  onChange
}: {
  icon: "look" | "theme" | "size" | "sound";
  label: string;
  value: V;
  options: readonly (readonly [V, string])[];
  onChange: (value: V) => void;
}) {
  return (
    <div className="fl-choice">
      <Icon name={icon} />
      <span className="fl-choice-label">{label}</span>
      <div className="fl-segments" role="radiogroup" aria-label={label}>
        {options.map(([option, title]) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={option === value}
            className={`fl-segment${option === value ? " is-on" : ""}`}
            onClick={() => onChange(option)}
          >
            {title}
          </button>
        ))}
      </div>
    </div>
  );
}

// MARK: Settings

export function SettingsPage() {
  const live = useControlsState();
  const [state, setState] = useState(live);
  useEffect(() => setState(live), [live]);
  useAccent(state?.accent);
  const change = useChange(state, setState);
  if (!state) return null;
  const p = state.prefs;

  return (
    <div className="fl fl-settings">
      <h1 className="fl-title">FlowCTL</h1>

      <section className="fl-group">
        <h2 className="fl-subtitle">Overlay</h2>
        <Card icon="size" title="Size" description="The floating window's size.">
          <Select value={p.size} options={SIZES} onChange={(v) => change("size", v)} />
        </Card>
        <Card icon="opacity" title="Opacity">
          <Select value={String(p.opacity)} options={OPACITIES.map((o) => [String(o), `${Math.round(o * 100)}%`] as const)} onChange={(v) => change("opacity", Number(v))} />
        </Card>
        <Card icon="window" title="Always on top" description="Keep the overlay above other windows.">
          <Switch on={p.alwaysOnTop} onChange={(v) => change("alwaysOnTop", v)} />
        </Card>
        <Card icon="window" title="Show automatically" description="When a session starts working or needs you.">
          <Switch on={p.showAutomatically} onChange={(v) => change("showAutomatically", v)} />
        </Card>
        <Card icon="window" title="Hide when idle" description="After five minutes with no session working.">
          <Switch on={p.hideWhenIdle} onChange={(v) => change("hideWhenIdle", v)} />
        </Card>
      </section>

      <section className="fl-group">
        <h2 className="fl-subtitle">Graph</h2>
        <Card icon="look" title="Look" description="Pixel art or smooth vector shapes.">
          <Select value={p.look} options={LOOKS} onChange={(v) => change("look", v)} />
        </Card>
        <Card icon="theme" title="Theme" description="Auto follows Windows' mode.">
          <Select value={p.theme} options={THEMES} onChange={(v) => change("theme", v)} />
        </Card>
        <Card icon="graph" title="Show subagents" description="Draw the agents a session starts as their own nodes.">
          <Switch on={p.showSubagents} onChange={(v) => change("showSubagents", v)} />
        </Card>
        <Card icon="graph" title="Idle animation" description="The graph moves gently after a minute with nothing working.">
          <Switch on={p.idleAnimation} onChange={(v) => change("idleAnimation", v)} />
        </Card>
      </section>

      <section className="fl-group">
        <h2 className="fl-subtitle">Sound</h2>
        <Card icon="sound" title="Sound" description="A quiet cue when a step starts, finishes or needs you.">
          <Select value={p.sound} options={SOUNDS} onChange={(v) => change("sound", v)} />
        </Card>
      </section>

      <section className="fl-group">
        <h2 className="fl-subtitle">About</h2>
        <Card icon="info" title={`FlowCTL ${state.version}`} description="A live graph of what Claude Code is doing.">
          <a className="fl-link" href="https://github.com/MarcoFilho1/FlowCTL" target="_blank" rel="noreferrer">
            github.com/MarcoFilho1/FlowCTL
          </a>
        </Card>
      </section>
    </div>
  );
}

function Card({ icon, title, description, children }: { icon: Parameters<typeof Icon>[0]["name"]; title: string; description?: string; children: ReactNode }) {
  return (
    <div className="fl-card">
      <span className="fl-card-icon">
        <Icon name={icon} />
      </span>
      <span className="fl-card-text">
        <span className="fl-card-title">{title}</span>
        {description && <span className="fl-card-description">{description}</span>}
      </span>
      <span className="fl-card-control">{children}</span>
    </div>
  );
}

/** Windows' toggle switch, with its On/Off label to the left. */
function Switch({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="fl-switch-wrap">
      <span className="fl-switch-text">{on ? "On" : "Off"}</span>
      <button type="button" role="switch" aria-checked={on} className={`fl-switch${on ? " is-on" : ""}`} onClick={() => onChange(!on)}>
        <span className="fl-switch-knob" />
      </button>
    </label>
  );
}

/** Windows' combo box: the system's own drop-down list. */
function Select<V extends string>({ value, options, onChange }: { value: V; options: readonly (readonly [V, string])[]; onChange: (value: V) => void }) {
  return (
    <select className="fl-select" value={value} onChange={(event) => onChange(event.target.value as V)}>
      {options.map(([option, title]) => (
        <option key={option} value={option}>
          {title}
        </option>
      ))}
    </select>
  );
}
