// The sessions the viewer shows, one tab each, fed by whatever source is
// plugged in (the overlay's window.flowctl.push, or the fixture player).

import { SNAPSHOT_SCHEMA, type Snapshot } from "../../../mod/graph/types.ts";

/** How the graph is drawn: pixel art (the default) or smooth vector shapes. */
export type Look = "pixel" | "smooth";

export interface SessionsState {
  /** In the order they first arrived. */
  sessions: readonly Snapshot[];
  active: string | null;
  look: Look;
  /** Draw subagents under their tasks (default) or leave them out. */
  showSubagents: boolean;
}

export interface SessionStore {
  /** Shows a snapshot; false when it is malformed or older than the one shown. */
  push(snapshot: unknown): boolean;
  select(key: string): void;
  /** Drops a session, so its seq starts over (the fixture player's restart). */
  forget(key: string): void;
  setLook(look: Look): void;
  setShowSubagents(show: boolean): void;
  getState(): SessionsState;
  subscribe(listener: () => void): () => void;
}

/**
 * The snapshot as drawn without subagents: their nodes are left out, and so
 * are their links to the tasks they worked for.
 */
export function withoutSubagents(snapshot: Snapshot): Snapshot {
  if (!snapshot.nodes.some((node) => node.kind === "agent")) return snapshot;
  return { ...snapshot, nodes: snapshot.nodes.filter((node) => node.kind !== "agent") };
}

/** A session's tab key: its id, else its folder, so a snapshot always lands somewhere. */
export function sessionKey(snapshot: Snapshot): string {
  return snapshot.sessionId || snapshot.cwd || "session";
}

export function isSnapshot(value: unknown): value is Snapshot {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Partial<Snapshot>;
  return (
    s.schema === SNAPSHOT_SCHEMA &&
    typeof s.seq === "number" &&
    typeof s.sessionId === "string" &&
    typeof s.cwd === "string" &&
    Array.isArray(s.nodes) &&
    s.nodes.every((node) => typeof node?.id === "string" && Array.isArray(node.blockedBy)) &&
    typeof s.layout === "object" &&
    s.layout !== null
  );
}

/** After a tab is picked by hand, sessions do not take it over for this long. */
export const MANUAL_HOLD_MS = 15_000;

const isLive = (snapshot: Snapshot | undefined) =>
  snapshot?.sessionState === "working" || snapshot?.sessionState === "waiting_you";

export function createSessionStore(now: () => number = () => Date.now()): SessionStore {
  let pickedAt = -Infinity;
  let state: SessionsState = { sessions: [], active: null, look: "pixel", showSubagents: true };
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());

  return {
    push(snapshot) {
      if (!isSnapshot(snapshot)) return false;
      const key = sessionKey(snapshot);
      const index = state.sessions.findIndex((s) => sessionKey(s) === key);
      const current = state.sessions[index];
      if (current && snapshot.seq <= current.seq) return false;

      const sessions = [...state.sessions];
      if (index >= 0) sessions[index] = snapshot;
      else sessions.push(snapshot);
      // Follow the activity: when the tab on screen is resting and another
      // session starts working (or needs the person), switch to it, unless
      // the person picked the tab on screen a moment ago.
      let active = state.active ?? key;
      if (active !== key && isLive(snapshot) && now() - pickedAt >= MANUAL_HOLD_MS) {
        const shown = sessions.find((s) => sessionKey(s) === active);
        if (!isLive(shown)) active = key;
      }
      state = { ...state, sessions, active };
      emit();
      return true;
    },
    select(key) {
      if (state.active === key || !state.sessions.some((s) => sessionKey(s) === key)) return;
      pickedAt = now();
      state = { ...state, active: key };
      emit();
    },
    forget(key) {
      const sessions = state.sessions.filter((s) => sessionKey(s) !== key);
      if (sessions.length === state.sessions.length) return;
      const active = state.active === key ? (sessions[0] ? sessionKey(sessions[0]) : null) : state.active;
      state = { ...state, sessions, active };
      emit();
    },
    setShowSubagents(show) {
      if (typeof show !== "boolean" || state.showSubagents === show) return;
      state = { ...state, showSubagents: show };
      emit();
    },
    setLook(look) {
      if (state.look === look || (look !== "pixel" && look !== "smooth")) return;
      state = { ...state, look };
      emit();
    },
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}

declare global {
  interface Window {
    flowctl?: {
      push(snapshot: unknown): boolean;
      remove(sessionId: string): void;
      setLook(look: Look): void;
      setShowSubagents(show: boolean): void;
    };
    webkit?: { messageHandlers?: { flowctl?: { postMessage(message: NativeMessage): void } } };
  }
}

/** What the viewer tells the overlay app: the size it wants, and which session to bring forward. */
export type NativeMessage =
  | { type: "size"; width: number; height: number }
  | { type: "focus"; sessionId: string; nodeId: string }
  /** Where the window can be grabbed and dragged, in page points; width 0 means nowhere. */
  | { type: "grip"; x: number; y: number; width: number; height: number }
  /** The person closed the overlay with the × in the top bar. */
  | { type: "close" };

/** Sends a message to the overlay app; a no-op in a plain browser. */
export function tellNative(message: NativeMessage, target: Window = window): boolean {
  const handler = target.webkit?.messageHandlers?.flowctl;
  if (!handler) return false;
  handler.postMessage(message);
  return true;
}

/**
 * The overlay's entry points: the native app calls window.flowctl.push(snapshot)
 * for every snapshot, and window.flowctl.remove(sessionId) when an ended
 * session's tab expires.
 */
export function installBridge(store: SessionStore, target: Window = window): void {
  target.flowctl = {
    push: (snapshot) => store.push(snapshot),
    remove: (sessionId) => store.forget(sessionId),
    setLook: (look) => store.setLook(look),
    setShowSubagents: (show) => store.setShowSubagents(show)
  };
}
