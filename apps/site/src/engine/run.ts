// Plays a scene on a session store in real time: each frame is pushed when its
// moment comes, the idle animation starts when the scene says so, and the
// scene starts over after its hold. Every frame goes through store.push, the
// same path the overlay's snapshots take.

import type { SessionStore } from "../../../viewer/src/store.ts";
import type { Scene } from "../scenes/types.ts";
import { timelineOf } from "./timeline.ts";

export interface RunHandlers {
  /** The idle animation: true once the scene rests long enough, false when a frame arrives. */
  onDream(on: boolean): void;
  /** A new run begins (the page remounts the graph, so no tween carries over). */
  onLoop(): void;
}

/** Starts the scene; the returned function stops it. */
export function runScene(scene: Scene, store: SessionStore, handlers: RunHandlers, speed = 1): () => void {
  const timeline = timelineOf(scene);
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (ms: number, fn: () => void) => {
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms / speed);
    timers.add(id);
  };
  const start = () => {
    // Starting over: the store takes seq from 1 again, as a fresh session would.
    store.forget(scene.sessionId);
    handlers.onDream(false);
    handlers.onLoop();
    for (const frame of timeline.frames) later(frame.at, () => store.push(frame.snapshot));
    if (timeline.dreamAt !== undefined) later(timeline.dreamAt, () => handlers.onDream(true));
    later(timeline.endAt, start);
  };
  start();
  return () => {
    timers.forEach(clearTimeout);
    timers.clear();
  };
}
