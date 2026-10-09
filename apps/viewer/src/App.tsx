import { useCallback, useSyncExternalStore } from "react";
import { DevControls, type Replay } from "./DevControls.tsx";
import { GraphView, type Extent } from "./GraphView.tsx";
import { Header, Tabs } from "./Header.tsx";
import { sessionKey, tellNative, type SessionStore } from "./store.ts";

// Room around the graph inside the overlay: the header line, the tab row, padding.
const HEADER_H = 26;
const TABS_H = 26;
const PAD = 8;

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
  const tabs = sessions.length > 1;
  // The overlay starts small and grows with the graph: tell it the size this graph wants.
  const onExtent = useCallback(
    (extent: Extent) =>
      void tellNative({
        type: "size",
        width: Math.ceil(extent.width + 2 * PAD),
        height: Math.ceil(extent.height + HEADER_H + (tabs ? TABS_H : 0) + 2 * PAD)
      }),
    [tabs]
  );

  return (
    <main className={`app ${replays ? "dev" : "overlay"}`}>
      {replays && <DevControls replays={replays} store={store} {...(startAt !== undefined ? { startAt } : {})} />}
      <Tabs sessions={sessions} active={current ? sessionKey(current) : null} onSelect={store.select} />
      {current ? (
        <>
          <Header snapshot={current} />
          {/* Keyed per session: each tab keeps its own orientation and tweens. */}
          <GraphView key={sessionKey(current)} snapshot={current} onExtent={onExtent} />
        </>
      ) : (
        <p className="empty">Waiting for a Claude Code session…</p>
      )}
    </main>
  );
}
