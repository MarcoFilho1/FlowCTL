import { useSyncExternalStore } from "react";
import { DevControls, type Replay } from "./DevControls.tsx";
import { GraphView } from "./GraphView.tsx";
import { Header, Tabs } from "./Header.tsx";
import { sessionKey, type SessionStore } from "./store.ts";

export function App({
  store,
  replays,
  startAt
}: {
  store: SessionStore;
  replays?: readonly Replay[];
  startAt?: number | "end";
}) {
  const { sessions, active } = useSyncExternalStore(store.subscribe, store.getState);
  const current = sessions.find((session) => sessionKey(session) === active) ?? sessions[0];
  return (
    <main className={`app ${replays ? "dev" : "overlay"}`}>
      {replays && <DevControls replays={replays} store={store} {...(startAt !== undefined ? { startAt } : {})} />}
      <Tabs sessions={sessions} active={current ? sessionKey(current) : null} onSelect={store.select} />
      {current ? (
        <>
          <Header snapshot={current} />
          {/* Keyed per session: each tab keeps its own orientation and tweens. */}
          <GraphView key={sessionKey(current)} snapshot={current} />
        </>
      ) : (
        <p className="empty">Waiting for a Claude Code session…</p>
      )}
    </main>
  );
}
