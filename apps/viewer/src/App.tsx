import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Snapshot } from "../../../mod/graph/types.ts";
import { DREAM_AFTER_MS } from "./dream.ts";
import { DevControls, type Replay } from "./DevControls.tsx";
import { GraphView } from "./GraphView.tsx";
import { Close, DragZone, Grip, Header, Pager } from "./Header.tsx";
import { cue } from "./sound.ts";
import { sessionKey, soundLook, withoutSubagents, type SessionStore } from "./store.ts";

export function App({
  store,
  replays,
  startAt,
  dreamAfter = DREAM_AFTER_MS
}: {
  store: SessionStore;
  replays?: readonly Replay[];
  startAt?: number | "end";
  /** How long nothing works before the idle animation (0 starts it at once). */
  dreamAfter?: number;
}) {
  const { sessions: all, active, look, showSubagents, sound, soundStyle, idleAnimation, dreamStyle } = useSyncExternalStore(store.subscribe, store.getState);
  const sounds = soundLook(look, soundStyle);
  // A session with nothing drawn that is not working (a fresh one gone idle, a
  // stale file restored at launch) would only be an empty tab.
  const sessions = all.filter(
    (session) => session.nodes.length > 0 || session.sessionState === "working" || session.sessionState === "waiting_you"
  );
  const chosen = sessions.find((session) => sessionKey(session) === active) ?? sessions[0];
  const current = useMemo(() => (chosen && !showSubagents ? withoutSubagents(chosen) : chosen), [chosen, showSubagents]);
  const dreaming = useDreaming(all, idleAnimation, dreamAfter);

  // A session off screen that starts waiting for the person still chimes.
  const waitingBefore = useRef(new Set<string>());
  useEffect(() => {
    const waiting = new Set(sessions.filter((session) => session.sessionState === "waiting_you").map(sessionKey));
    const shown = current ? sessionKey(current) : null;
    if (sound && [...waiting].some((key) => key !== shown && !waitingBefore.current.has(key))) cue("needs", sounds);
    waitingBefore.current = waiting;
  }, [sessions, current, sound, sounds]);
  return (
    <main className={`app ${replays ? "dev" : "overlay"} look-${look}`}>
      {replays && <DevControls replays={replays} store={store} {...(startAt !== undefined ? { startAt } : {})} />}
      {/* One top bar: the drag zone (session name, progress, dots), the pager, close. */}
      <div className="topbar">
        <DragZone>
          {current ? <Header snapshot={current} showWarnings={replays !== undefined} /> : <span className="header" />}
          <Grip />
        </DragZone>
        <Pager sessions={sessions} active={current ? sessionKey(current) : null} onSelect={store.select} />
        <Close />
      </div>
      {current ? (
        <>
          {/* Keyed per session: each tab keeps its own orientation and tweens. */}
          <GraphView key={sessionKey(current)} snapshot={current} look={look} sound={sound} sounds={sounds} dreaming={dreaming} dreamStyle={dreamStyle} />
        </>
      ) : (
        <p className="empty">Waiting for a Claude Code session…</p>
      )}
    </main>
  );
}

const isLive = (session: Snapshot) => session.sessionState === "working" || session.sessionState === "waiting_you";

/**
 * True once no session has worked or waited for `after` ms (counted from the
 * page's start too), false again the moment one does.
 */
function useDreaming(sessions: readonly Snapshot[], enabled: boolean, after: number): boolean {
  const live = sessions.some(isLive);
  const [dreaming, setDreaming] = useState(false);
  useEffect(() => {
    setDreaming(false);
    if (!enabled || live) return;
    const timer = setTimeout(() => setDreaming(true), after);
    return () => clearTimeout(timer);
  }, [live, enabled, after]);
  return dreaming && enabled && !live;
}
