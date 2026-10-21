// What the snail tells the person who hovers over it: the session the overlay
// would show (the store follows the activity the same way), how far its plan
// got, and what it is on now or did last. Pure, so tested without a page.

import type { SessionState, Snapshot } from "../../../../mod/graph/types.ts";
import { folderName } from "../Header.tsx";
import { sessionKey } from "../store.ts";

export interface SessionSummary {
  name: string;
  state: SessionState;
  stateLabel: string;
  done: number;
  total: number;
  /** The step that matters most: one that needs the person, the one running, or the last done. */
  focus?: { label: string; title: string };
  /** How long since the session last changed, coarse ("4 min ago"). */
  since?: string;
  /** Other live sessions, and how many of them wait for the person. */
  others: number;
  othersWaiting: number;
}

const STATE_LABEL: Record<SessionState, string> = {
  working: "Working",
  waiting_you: "Needs you",
  idle: "Idle",
  ended: "Ended"
};

/** "just now", "4 min ago", "2 h ago". */
export function ago(from: number | undefined, now: number): string | undefined {
  if (from === undefined || !Number.isFinite(from)) return undefined;
  const seconds = Math.max(0, (now - from) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} h ago`;
}

export function summarize(sessions: readonly Snapshot[], active: string | null, now: number): SessionSummary | null {
  const shown = sessions.filter((s) => s.nodes.length > 0 || s.sessionState === "working" || s.sessionState === "waiting_you");
  const current = shown.find((s) => sessionKey(s) === active) ?? shown[0];
  if (!current) return null;
  const plan = current.nodes.filter((node) => node.kind !== "turn" && node.skipped !== true);
  const needs = current.nodes.find((node) => node.status === "needs_you");
  const running = current.nodes.find((node) => node.status === "running");
  const last = current.nodes
    .filter((node) => node.status === "done" && node.finishedAt !== undefined)
    .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))[0];
  const focus = needs
    ? { label: "Needs you", title: needs.attention?.reason ?? needs.title }
    : running
      ? { label: "Now", title: running.activeForm ?? running.title }
      : last
        ? { label: `Last done${ago(last.finishedAt, now) ? `, ${ago(last.finishedAt, now)}` : ""}`, title: last.title }
        : undefined;
  const others = shown.filter((s) => s !== current && s.sessionState !== "ended");
  const since = ago(current.updatedAt, now);
  return {
    name: folderName(current.cwd),
    state: current.sessionState,
    stateLabel: STATE_LABEL[current.sessionState],
    done: plan.filter((node) => node.status === "done").length,
    total: plan.length,
    ...(focus ? { focus } : {}),
    ...(since ? { since } : {}),
    others: others.length,
    othersWaiting: others.filter((s) => s.sessionState === "waiting_you").length
  };
}
