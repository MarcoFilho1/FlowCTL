// What changed between two snapshots of a session, for the transition
// effects: which nodes just finished, which just started, and the handoffs
// between them (a finished step to the step it unblocked).

import type { NodeStatus, Snapshot } from "../../../mod/graph/types.ts";

export interface Transitions {
  finished: string[];
  started: string[];
  /** From a node that just finished to a node it was holding back. */
  handoffs: Array<[from: string, to: string]>;
}

export function transitions(before: ReadonlyMap<string, NodeStatus> | undefined, after: Snapshot): Transitions {
  if (!before) return { finished: [], started: [], handoffs: [] };
  const status = new Map(after.nodes.map((node) => [node.id, node.status]));
  const finished = after.nodes.filter((node) => node.status === "done" && before.has(node.id) && before.get(node.id) !== "done").map((node) => node.id);
  const started = after.nodes
    .filter((node) => node.status === "running" && before.get(node.id) !== "running" && before.get(node.id) !== "needs_you")
    .map((node) => node.id);
  const handoffs: Array<[string, string]> = [];
  for (const node of after.nodes) {
    if (node.status === "done") continue;
    const unblocked = node.blockedBy.every((id) => status.get(id) === "done");
    for (const from of node.blockedBy) {
      // The step it waited on just finished and nothing else holds it back.
      if (finished.includes(from) && unblocked) handoffs.push([from, node.id]);
    }
  }
  return { finished, started, handoffs };
}

export function statusesOf(snapshot: Snapshot): Map<string, NodeStatus> {
  return new Map(snapshot.nodes.map((node) => [node.id, node.status]));
}
