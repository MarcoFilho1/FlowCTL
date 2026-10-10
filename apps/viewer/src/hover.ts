// What the hover card says about a node. Pure, so every status is tested.
//
// Done: what came of it. Running or pending: where it stands now. Needs you:
// why the agent is asking. Error: what failed.
//
// The words come from HoverLabels: English by default, and the landing page
// passes its own translation, so the same card reads in another language.

import type { GraphNode, NodeStatus, Snapshot } from "../../../mod/graph/types.ts";

export interface HoverCard {
  title: string;
  /** One line on where the node stands. */
  status: string;
  /** The longer text: the outcome, the reason, or the description. */
  body?: string;
}

/** Every phrase the viewer shows, so a page in another language can say the same things. */
export interface HoverLabels {
  kind: Record<GraphNode["kind"], string>;
  status: Record<NodeStatus, string>;
  done: (kind: string, took?: string) => string;
  failed: (kind: string) => string;
  question: string;
  permission: string;
  running: string;
  waitingOn: (titles: string) => string;
  paused: string;
  notStarted: string;
  lastError: (detail: string, ago?: string) => string;
  graph: (nodes: number) => string;
  outOfView: string;
}

export const ENGLISH_LABELS: HoverLabels = {
  kind: { task: "Step", agent: "Subagent", turn: "Turn" },
  status: { pending: "Pending", running: "Running", needs_you: "Needs you", error: "Error", done: "Done" },
  done: (kind, took) => `${kind} done${took ? ` in ${took}` : ""}`,
  failed: (kind) => `${kind} failed`,
  question: "Question for you",
  permission: "Needs your permission",
  running: "Running",
  waitingOn: (titles) => `Waiting on ${titles}`,
  paused: "Paused",
  notStarted: "Not started",
  lastError: (detail, ago) => `Last error${ago ? ` ${ago} ago` : ""}: ${detail}`,
  graph: (nodes) => `Task graph, ${nodes} nodes`,
  outOfView: "out of view"
};

export function hoverCard(node: GraphNode, snapshot: Snapshot, labels: HoverLabels = ENGLISH_LABELS): HoverCard {
  const card = baseCard(node, snapshot, labels);
  // A step still in progress that hit an error says so: the agent is working around it.
  if (node.lastError && (node.status === "running" || node.status === "pending")) {
    const ago = duration(node.lastError.at, snapshot.updatedAt);
    const line = labels.lastError(node.lastError.detail, ago);
    return { ...card, body: card.body ? `${card.body}\n${line}` : line };
  }
  return card;
}

function baseCard(node: GraphNode, snapshot: Snapshot, labels: HoverLabels): HoverCard {
  const kind = labels.kind[node.kind];
  switch (node.status) {
    case "done": {
      const took = duration(node.startedAt, node.finishedAt);
      return withBody({ title: node.title, status: labels.done(kind, took) }, node.summary ?? node.description);
    }
    case "needs_you": {
      const why = node.attention?.kind === "question" ? labels.question : labels.permission;
      return withBody({ title: node.title, status: why }, node.attention?.reason ?? node.attention?.detail);
    }
    case "error":
      return withBody({ title: node.title, status: labels.failed(kind) }, node.attention?.detail ?? node.description);
    case "running": {
      const since = duration(node.startedAt, snapshot.updatedAt);
      const doing = node.activeForm ?? labels.running;
      return withBody({ title: node.title, status: `${doing}${since ? ` · ${since}` : ""}` }, node.description);
    }
    case "pending": {
      const waiting = node.blockedBy
        .map((id) => snapshot.nodes.find((other) => other.id === id))
        .filter((other): other is GraphNode => other !== undefined && other.status !== "done")
        .map((other) => other.title);
      const status =
        waiting.length > 0 ? labels.waitingOn(waiting.join(", ")) : node.startedAt !== undefined ? labels.paused : labels.notStarted;
      return withBody({ title: node.title, status }, node.description);
    }
  }
}

function withBody(card: HoverCard, body: string | undefined): HoverCard {
  const text = body?.trim();
  return text ? { ...card, body: text } : card;
}

/** "42s", "3m 05s", "1h 02m"; undefined without both ends. */
export function duration(from: number | undefined, to: number | undefined): string | undefined {
  if (from === undefined || to === undefined || to < from) return undefined;
  const seconds = Math.round((to - from) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}
