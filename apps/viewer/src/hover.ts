// What the hover card says about a node. Pure, so every status is tested.
//
// Done: what came of it. Running or pending: where it stands now. Needs you:
// why the agent is asking. Error: what failed.

import type { GraphNode, Snapshot } from "../../../mod/graph/types.ts";

export interface HoverCard {
  title: string;
  /** One line on where the node stands. */
  status: string;
  /** The longer text: the outcome, the reason, or the description. */
  body?: string;
}

const KIND: Record<GraphNode["kind"], string> = { task: "Step", agent: "Subagent", turn: "Turn" };

export function hoverCard(node: GraphNode, snapshot: Snapshot): HoverCard {
  const kind = KIND[node.kind];
  switch (node.status) {
    case "done": {
      const took = duration(node.startedAt, node.finishedAt);
      return withBody({ title: node.title, status: `${kind} done${took ? ` in ${took}` : ""}` }, node.summary ?? node.description);
    }
    case "needs_you": {
      const why = node.attention?.kind === "question" ? "Question for you" : "Needs your permission";
      return withBody({ title: node.title, status: why }, node.attention?.reason ?? node.attention?.detail);
    }
    case "error":
      return withBody({ title: node.title, status: `${kind} failed` }, node.attention?.detail ?? node.description);
    case "running": {
      const since = duration(node.startedAt, snapshot.updatedAt);
      const doing = node.activeForm ?? "Running";
      return withBody({ title: node.title, status: `${doing}${since ? ` · ${since}` : ""}` }, node.description);
    }
    case "pending": {
      const waiting = node.blockedBy
        .map((id) => snapshot.nodes.find((other) => other.id === id))
        .filter((other): other is GraphNode => other !== undefined && other.status !== "done")
        .map((other) => other.title);
      const status = waiting.length > 0 ? `Waiting on ${waiting.join(", ")}` : node.startedAt !== undefined ? "Paused" : "Not started";
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
