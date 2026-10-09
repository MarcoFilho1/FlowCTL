// Dev mode: replays a recorded fixture through the mod's own reducer and
// snapshot builder, exactly as the mod does live, one snapshot per event.

import { apply, initialState } from "../../../mod/graph/reduce.ts";
import { snapshot } from "../../../mod/graph/snapshot.ts";
import type { GraphEvent, Snapshot } from "../../../mod/graph/types.ts";

const recorded = import.meta.glob("../../../fixtures/*.jsonl", {
  query: "?raw",
  import: "default",
  eager: true
}) as Record<string, string>;

/** Fixture names (file names without `.jsonl`), sorted. */
export const FIXTURES: readonly string[] = Object.keys(recorded)
  .map((path) => path.replace(/^.*\//, "").replace(/\.jsonl$/, ""))
  .sort();

export function loadFixture(name: string): GraphEvent[] | undefined {
  const text = Object.entries(recorded).find(([path]) => path.endsWith(`/${name}.jsonl`))?.[1];
  if (text === undefined) return undefined;
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as GraphEvent);
}

/**
 * Every snapshot of a replay, in order: the i-th is the session after event i.
 * The layout carries over as it does live. With `sessionId` (the fixture's
 * name, say) every snapshot is filed under it: a recording gets its real id
 * only some events in, and may span a /clear.
 */
export function replaySnapshots(events: readonly GraphEvent[], sessionId?: string): Snapshot[] {
  const state = initialState();
  const result: Snapshot[] = [];
  let last: Snapshot | undefined;
  events.forEach((event, i) => {
    apply(state, event);
    // Cloned: the reducer mutates its state, and snapshots share some of it.
    last = structuredClone(snapshot(state, { seq: i + 1, now: event.t, ...(last ? { previous: last.layout } : {}) }));
    result.push(sessionId ? { ...last, sessionId } : last);
  });
  return result;
}

/** The wait before showing event `i`, scaled by speed; long pauses are cut short. */
export function delayBefore(events: readonly GraphEvent[], i: number, speed: number): number {
  if (i <= 0) return 0;
  const gap = (events[i]?.t ?? 0) - (events[i - 1]?.t ?? 0);
  return Math.min(Math.max(gap, 0), 2000) / speed;
}
