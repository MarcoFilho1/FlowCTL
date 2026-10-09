// Layered layout (a simple Sugiyama): break cycles, rank by longest path,
// order each rank by barycenter. Pure and deterministic, so the mod computes
// it once and every surface draws the same shape.

import type { GraphNode, Layout } from "./types.ts";
import { findCycles } from "./cycles.ts";

export type Edge = [from: string, to: string];

export interface LayoutResult {
  layout: Layout;
  /** Edges removed to make the graph acyclic, in the order they were removed. */
  brokenEdges: Edge[];
}

/** Down, up, down: enough for the 20–50 nodes of a session. */
const SWEEPS = 3;

/**
 * Places each node in a rank (its longest distance from a root) and an order
 * within that rank (0..n-1). Edges run from a dependency to the node that
 * waits on it (`blockedBy`) and from an agent's `parent` to the agent; ids
 * that name no node are ignored. Cycles are broken by removing their newest
 * edge, newest meaning its target comes later in `nodes`.
 *
 * With `previous`, a node that keeps its rank keeps its order relative to the
 * other such nodes of that rank; new nodes and nodes that changed rank fall
 * in by barycenter.
 */
export function layout(nodes: readonly GraphNode[], previous?: Layout): LayoutResult {
  const ids = uniqueIds(nodes);
  const index = new Map(ids.map((id, i) => [id, i]));
  const edges = collectEdges(nodes, index);
  const brokenEdges = breakCycles(ids, edges, index);

  const predecessors = adjacency(ids, edges, 1, 0);
  const successors = adjacency(ids, edges, 0, 1);
  const ranks = rankByLongestPath(ids, predecessors, successors, index);
  const layers = orderLayers(ids, ranks, predecessors, successors, index, previous);

  const result: Layout = {};
  layers.forEach((layer, rank) => {
    layer.forEach((id, order) => {
      result[id] = { rank, order };
    });
  });
  return { layout: result, brokenEdges };
}

/** Node ids in array order; a repeated id keeps its first place. */
function uniqueIds(nodes: readonly GraphNode[]): string[] {
  return [...new Set(nodes.map((node) => node.id))];
}

/** Unique edges between known nodes, in a stable order. */
function collectEdges(nodes: readonly GraphNode[], index: ReadonlyMap<string, number>): Edge[] {
  const seen = new Set<string>();
  const edges: Edge[] = [];
  const add = (from: string, to: string) => {
    const key = `${from}\u0000${to}`;
    if (!index.has(from) || !index.has(to) || seen.has(key)) {
      return;
    }
    seen.add(key);
    edges.push([from, to]);
  };

  for (const node of nodes) {
    for (const dependency of node.blockedBy) {
      add(dependency, node.id);
    }
    // A request's first steps come after the previous request's last ones.
    for (const before of node.after ?? []) {
      add(before, node.id);
    }
    if (node.kind === "agent" && node.parent !== undefined) {
      add(node.parent, node.id);
    }
  }
  return edges;
}

/**
 * Removes the newest edge of a remaining cycle until none is left; mutates
 * `edges`. One edge per round, since removing it may break other cycles too.
 */
function breakCycles(ids: readonly string[], edges: Edge[], index: ReadonlyMap<string, number>): Edge[] {
  const broken: Edge[] = [];

  for (;;) {
    const successors = adjacency(ids, edges, 0, 1);
    const cycles = findCycles(ids, (id) => successors.get(id) ?? []);
    if (cycles.length === 0) {
      return broken;
    }

    let newest: Edge | undefined;
    for (const cycle of cycles) {
      for (let i = 0; i + 1 < cycle.length; i += 1) {
        const candidate: Edge = [cycle[i] as string, cycle[i + 1] as string];
        if (newest === undefined || isNewer(candidate, newest, index)) {
          newest = candidate;
        }
      }
    }

    const [from, to] = newest as Edge;
    edges.splice(edges.findIndex(([a, b]) => a === from && b === to), 1);
    broken.push([from, to]);
  }
}

function isNewer(left: Edge, right: Edge, index: ReadonlyMap<string, number>): boolean {
  const byTarget = position(index, left[1]) - position(index, right[1]);
  return byTarget !== 0 ? byTarget > 0 : position(index, left[0]) > position(index, right[0]);
}

/** Neighbor lists keyed by `edge[key]`, each in node-array order. */
function adjacency(
  ids: readonly string[],
  edges: readonly Edge[],
  key: 0 | 1,
  value: 0 | 1
): Map<string, string[]> {
  const lists = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const edge of edges) {
    lists.get(edge[key])?.push(edge[value]);
  }
  return lists;
}

/** Longest distance from a root, in a Kahn order that prefers earlier nodes. */
function rankByLongestPath(
  ids: readonly string[],
  predecessors: ReadonlyMap<string, readonly string[]>,
  successors: ReadonlyMap<string, readonly string[]>,
  index: ReadonlyMap<string, number>
): Map<string, number> {
  const remaining = new Map(ids.map((id) => [id, predecessors.get(id)?.length ?? 0]));
  const rank = new Map(ids.map((id) => [id, 0]));
  const ready = ids.filter((id) => remaining.get(id) === 0);

  while (ready.length > 0) {
    ready.sort((a, b) => position(index, a) - position(index, b));
    const id = ready.shift() as string;
    for (const next of successors.get(id) ?? []) {
      rank.set(next, Math.max(rank.get(next) ?? 0, (rank.get(id) ?? 0) + 1));
      const left = (remaining.get(next) ?? 0) - 1;
      remaining.set(next, left);
      if (left === 0) {
        ready.push(next);
      }
    }
  }
  return rank;
}

function orderLayers(
  ids: readonly string[],
  ranks: ReadonlyMap<string, number>,
  predecessors: ReadonlyMap<string, readonly string[]>,
  successors: ReadonlyMap<string, readonly string[]>,
  index: ReadonlyMap<string, number>,
  previous: Layout | undefined
): string[][] {
  const depth = ids.length === 0 ? 0 : Math.max(...ranks.values()) + 1;
  const layers: string[][] = Array.from({ length: depth }, () => []);
  for (const id of ids) {
    layers[ranks.get(id) ?? 0]?.push(id);
  }

  // A node that keeps its rank is anchored to its previous order.
  const anchored = (id: string) => previous?.[id]?.rank === ranks.get(id);
  const order = new Map<string, number>();
  const settle = (layer: string[]) => {
    keepAnchoredOrder(layer, anchored, previous);
    layer.forEach((id, i) => order.set(id, i));
  };
  layers.forEach(settle);

  for (let sweep = 0; sweep < SWEEPS; sweep += 1) {
    const isDown = sweep % 2 === 0;
    const neighbors = isDown ? predecessors : successors;
    const sequence = isDown ? layers.keys() : [...layers.keys()].reverse();

    for (const rank of sequence) {
      const layer = layers[rank] as string[];
      const key = new Map(layer.map((id) => [id, barycenter(neighbors.get(id) ?? [], order) ?? (order.get(id) ?? 0)]));
      layer.sort(
        (a, b) =>
          (key.get(a) ?? 0) - (key.get(b) ?? 0) ||
          (order.get(a) ?? 0) - (order.get(b) ?? 0) ||
          position(index, a) - position(index, b)
      );
      settle(layer);
    }
  }
  return layers;
}

function barycenter(neighbors: readonly string[], order: ReadonlyMap<string, number>): number | undefined {
  if (neighbors.length === 0) {
    return undefined;
  }
  let sum = 0;
  for (const id of neighbors) {
    sum += order.get(id) ?? 0;
  }
  return sum / neighbors.length;
}

/**
 * Puts the anchored nodes of a layer back in their previous relative order,
 * in the slots they already hold, so new nodes keep the places barycenter
 * gave them and old ones never pass each other.
 */
function keepAnchoredOrder(
  layer: string[],
  anchored: (id: string) => boolean,
  previous: Layout | undefined
): void {
  if (previous === undefined) {
    return;
  }
  const slots: number[] = [];
  const old: string[] = [];
  layer.forEach((id, i) => {
    if (anchored(id)) {
      slots.push(i);
      old.push(id);
    }
  });
  old.sort((a, b) => (previous[a]?.order ?? 0) - (previous[b]?.order ?? 0));
  slots.forEach((slot, i) => {
    layer[slot] = old[i] as string;
  });
}

function position(index: ReadonlyMap<string, number>, id: string): number {
  return index.get(id) ?? Number.MAX_SAFE_INTEGER;
}
