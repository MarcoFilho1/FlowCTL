import { useCallback, useSyncExternalStore } from "react";
import { DevControls, type Replay } from "./DevControls.tsx";
import { GraphView, type Extent } from "./GraphView.tsx";
import { folderName, Header, Tabs } from "./Header.tsx";
import { sessionKey, tellNative, type SessionStore } from "./store.ts";

// Room around the graph inside the overlay: the header line, the tab row, padding.
const HEADER_H = 26;
const TABS_H = 26;
const PAD = 8;
/** Never narrower than the header needs. */
const MIN_W = 150;
/** About the width of a tab: its label plus its padding. */
const tabWidth = (label: string) => label.length * 6.6 + 18;

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
  const tabsWidth = tabs ? sessions.reduce((sum, session) => sum + tabWidth(folderName(session.cwd) || sessionKey(session)), 0) : 0;
  // The overlay starts small and grows with the graph: tell it the size this
  // graph wants. Past the overlay's limit the graph scales down to fit.
  const onExtent = useCallback(
    (extent: Extent) =>
      void tellNative({
        type: "size",
        width: Math.ceil(Math.max(extent.width + 2 * PAD, tabsWidth + 2 * PAD, MIN_W)),
        height: Math.ceil(Math.max(extent.height, 24) + HEADER_H + (tabs ? TABS_H : 0) + 2 * PAD)
      }),
    [tabs, tabsWidth]
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
