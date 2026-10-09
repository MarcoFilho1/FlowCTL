// The golden snapshots of mod/graph (fixtures/golden), for tests.

import type { GraphNode, Snapshot } from "../../../mod/graph/types.ts";

const files = import.meta.glob("../../../fixtures/golden/*.json", { eager: true, import: "default" }) as Record<
  string,
  Snapshot
>;

export const GOLDENS: ReadonlyMap<string, Snapshot> = new Map(
  Object.entries(files)
    .map(([path, snapshot]) => [path.replace(/^.*\//, "").replace(/\.json$/, ""), snapshot] as const)
    .sort(([a], [b]) => (a < b ? -1 : 1))
);

export function golden(name: string): Snapshot {
  const snapshot = GOLDENS.get(name);
  if (!snapshot) throw new Error(`no golden snapshot named ${name}`);
  return structuredClone(snapshot);
}

/** A snapshot around hand-made nodes; layout from their position unless given. */
export function snapshotOf(nodes: GraphNode[], overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    schema: 1,
    seq: 1,
    sessionId: "s1",
    cwd: "/work/project",
    updatedAt: 0,
    sessionState: "working",
    planSource: "tasks",
    nodes,
    layout: Object.fromEntries(nodes.map((node, i) => [node.id, { rank: 0, order: i }])),
    warnings: [],
    ...overrides
  };
}

export function task(id: string, extra: Partial<GraphNode> = {}): GraphNode {
  return { id, kind: "task", title: `Task ${id}`, status: "pending", blockedBy: [], ...extra };
}

export function agent(id: string, parent?: string, extra: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    kind: "agent",
    title: `Agent ${id}`,
    status: "running",
    blockedBy: [],
    ...(parent !== undefined ? { parent } : {}),
    ...extra
  };
}
