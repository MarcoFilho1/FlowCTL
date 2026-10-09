import { useCallback, useEffect, useRef, useState } from "react";
import type { GraphEvent, Snapshot } from "../../../mod/graph/types.ts";
import { delayBefore } from "./player.ts";
import { sessionKey, type SessionStore } from "./store.ts";

export interface Replay {
  name: string;
  events: readonly GraphEvent[];
  /** One per event, from replaySnapshots. */
  snapshots: readonly Snapshot[];
}

export const SPEEDS = [1, 4, 16, 64] as const;

/**
 * Plays fixtures into the store as if they were live sessions: each one on
 * its own clock (its recorded gaps, divided by the speed), all paused,
 * stepped or restarted together.
 */
export function DevControls({
  replays,
  store,
  startAt
}: {
  replays: readonly Replay[];
  store: SessionStore;
  /** Opens paused on this event (1-based; `"end"` for the last): `?at=`. */
  startAt?: number | "end";
}) {
  const [playing, setPlaying] = useState(startAt === undefined);
  const [speed, setSpeed] = useState<number>(4);
  const [cursor, setCursor] = useState<number[]>(() =>
    replays.map((replay) => {
      const last = Math.max(0, replay.snapshots.length - 1);
      return startAt === undefined ? 0 : startAt === "end" ? last : Math.min(last, Math.max(0, startAt - 1));
    })
  );
  const started = useRef(false);

  const show = useCallback(
    (positions: readonly number[]) => {
      replays.forEach((replay, i) => {
        const snapshot = replay.snapshots[positions[i] ?? 0];
        if (snapshot) store.push(snapshot);
      });
    },
    [replays, store]
  );

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    show(cursor);
  }, [cursor, show]);

  useEffect(() => {
    if (!playing) return;
    const timers = replays.map((replay, i) => {
      const at = cursor[i] ?? 0;
      if (at >= replay.snapshots.length - 1) return undefined;
      return setTimeout(() => {
        const snapshot = replay.snapshots[at + 1];
        if (snapshot) store.push(snapshot);
        setCursor((current) => current.map((value, j) => (j === i ? at + 1 : value)));
      }, delayBefore(replay.events, at + 1, speed));
    });
    return () => timers.forEach((timer) => timer !== undefined && clearTimeout(timer));
  }, [playing, speed, cursor, replays, store]);

  const step = () => {
    const next = cursor.map((at, i) => Math.min(at + 1, (replays[i]?.snapshots.length ?? 1) - 1));
    setCursor(next);
    show(next);
  };

  const jump = (toEnd: boolean) => {
    const active = store.getState().active;
    const next = replays.map((replay) => (toEnd ? replay.snapshots.length - 1 : 0));
    if (!toEnd) {
      // Seq starts over, so the store must forget what it showed.
      replays.forEach((replay) => replay.snapshots[0] && store.forget(sessionKey(replay.snapshots[0])));
    }
    setCursor(next);
    show(next);
    if (active) store.select(active);
  };

  const done = replays.every((replay, i) => (cursor[i] ?? 0) >= replay.snapshots.length - 1);
  const shown = cursor.reduce((sum, at) => sum + at + 1, 0);
  const total = replays.reduce((sum, replay) => sum + replay.snapshots.length, 0);

  return (
    <div className="dev-controls" role="toolbar" aria-label="Fixture player">
      <button type="button" onClick={() => jump(false)} title="Restart">
        ⏮
      </button>
      <button type="button" onClick={() => setPlaying(!playing)} disabled={done} title={playing ? "Pause" : "Play"}>
        {playing && !done ? "⏸" : "▶"}
      </button>
      <button type="button" onClick={step} disabled={done} title="Next event">
        ⏭
      </button>
      <button type="button" onClick={() => jump(true)} disabled={done} title="Jump to the end">
        ⏩
      </button>
      <label className="speed">
        <span className="visually-hidden">Speed</span>
        <select value={speed} onChange={(event) => setSpeed(Number(event.target.value))}>
          {SPEEDS.map((value) => (
            <option key={value} value={value}>
              {value}×
            </option>
          ))}
        </select>
      </label>
      <span className="progress" aria-live="off">
        {shown}/{total}
      </span>
    </div>
  );
}
