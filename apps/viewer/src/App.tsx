import { useMemo, useSyncExternalStore } from "react";
import { DevControls, type Replay } from "./DevControls.tsx";
import { GraphView } from "./GraphView.tsx";
import { Close, DragZone, Grip, Header, Pager } from "./Header.tsx";
import { sessionKey, withoutSubagents, type SessionStore } from "./store.ts";

export function App({
  store,
  replays,
  startAt
}: {
  store: SessionStore;
  replays?: readonly Replay[];
  startAt?: number | "end";
}) {
  const { sessions: all, active, look, showSubagents } = useSyncExternalStore(store.subscribe, store.getState);
  // A session with nothing drawn that is not working (a fresh one gone idle, a
  // stale file restored at launch) would only be an empty tab.
  const sessions = all.filter(
    (session) => session.nodes.length > 0 || session.sessionState === "working" || session.sessionState === "waiting_you"
  );
  const chosen = sessions.find((session) => sessionKey(session) === active) ?? sessions[0];
  const current = useMemo(() => (chosen && !showSubagents ? withoutSubagents(chosen) : chosen), [chosen, showSubagents]);
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
          <GraphView key={sessionKey(current)} snapshot={current} look={look} />
        </>
      ) : (
        <p className="empty">Waiting for a Claude Code session…</p>
      )}
    </main>
  );
}
