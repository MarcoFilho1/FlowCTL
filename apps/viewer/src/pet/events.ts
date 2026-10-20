// What the snail reacts to while sessions work, read from the snapshots as
// they come: a step done (its ball bursts and a new one comes) and a session
// that finished working (it celebrates). Pure, so tested without a page.

import type { SessionState, Snapshot } from "../../../../mod/graph/types.ts";
import { sessionKey } from "../store.ts";

/** What was seen of each session at the last look. */
export type Seen = ReadonlyMap<string, { done: number; state: SessionState }>;

export interface Progress {
  /** Steps done since the last look, over the sessions already seen. */
  steps: number;
  /** Sessions that stopped working since the last look (idle or ended, not waiting). */
  finished: number;
  /** Any session working now. */
  working: boolean;
  seen: Seen;
}

const doneCount = (snapshot: Snapshot) => snapshot.nodes.filter((node) => node.kind !== "turn" && node.status === "done").length;

export function progress(before: Seen, sessions: readonly Snapshot[]): Progress {
  const seen = new Map<string, { done: number; state: SessionState }>();
  let steps = 0;
  let finished = 0;
  for (const session of sessions) {
    const key = sessionKey(session);
    const now = { done: doneCount(session), state: session.sessionState };
    const was = before.get(key);
    if (was) {
      steps += Math.max(0, now.done - was.done);
      if (was.state === "working" && (now.state === "idle" || now.state === "ended")) finished += 1;
    }
    seen.set(key, now);
  }
  return { steps, finished, working: sessions.some((s) => s.sessionState === "working"), seen };
}
