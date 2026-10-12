// A scene as the mod would have produced it: each beat goes through the
// reducer and the snapshot builder, one snapshot per beat. Pure: no clock, no
// timers, so the same scene gives the same frames every time (the video
// renders from this too).

import { apply, initialState } from "../../../../mod/graph/reduce.ts";
import { snapshot } from "../../../../mod/graph/snapshot.ts";
import type { GraphEvent, Snapshot } from "../../../../mod/graph/types.ts";
import type { Scene } from "../scenes/types.ts";

/** Any fixed instant works: the snapshots only use the differences between times. */
export const SCENE_EPOCH = 1_800_000_000_000;

export interface Frame {
  /** Milliseconds from the start of the scene. */
  at: number;
  snapshot: Snapshot;
}

export interface Timeline {
  frames: Frame[];
  /** Milliseconds from the start when the idle animation starts. */
  dreamAt?: number;
  /** Milliseconds from the start when the scene starts over. */
  endAt: number;
}

export function timelineOf(scene: Scene): Timeline {
  const state = initialState();
  const frames: Frame[] = [];
  let last: Snapshot | undefined;
  scene.beats.forEach(([seconds, event], i) => {
    const now = SCENE_EPOCH + seconds * 1000;
    apply(state, { ...event, t: now } as GraphEvent);
    // Cloned: the reducer mutates its state, and snapshots share some of it.
    const built = structuredClone(snapshot(state, { seq: i + 1, now, ...(last ? { previous: last.layout } : {}) }));
    last = { ...built, sessionId: scene.sessionId, cwd: scene.cwd };
    frames.push({ at: seconds * 1000, snapshot: last });
  });
  const lastAt = frames.at(-1)?.at ?? 0;
  return {
    frames,
    ...(scene.dreamAt !== undefined ? { dreamAt: scene.dreamAt * 1000 } : {}),
    endAt: lastAt + scene.holdMs
  };
}

/** The frame on screen at `seconds`: the last one not after it. */
export function frameAt(timeline: Timeline, seconds: number): Frame | undefined {
  let shown: Frame | undefined;
  for (const frame of timeline.frames) {
    if (frame.at > seconds * 1000) break;
    shown = frame;
  }
  return shown;
}
