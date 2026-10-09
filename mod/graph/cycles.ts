// Cycle detection over a directed graph, ported from v0 (packages/core,
// tag v0-orchestrator) without its task model. Pure: no imports, so both the
// mod and the viewer can load it.

export type Neighbors = (id: string) => readonly string[];

/**
 * The cycles a depth-first search meets as back edges: at least one for every
 * cyclic part of the graph, not every elementary cycle. Each is normalized to
 * start at its smallest id and closed by repeating it (`["a", "b", "a"]`).
 * Self-loops are cycles too. Neighbors that are not in `ids` are ignored.
 * Deterministic: the same graph always yields the same cycles in order.
 */
export function findCycles(ids: readonly string[], neighbors: Neighbors): string[][] {
  const known = new Set(ids);
  const visited = new Set<string>();
  const onPath = new Map<string, number>();
  const path: string[] = [];
  const found = new Map<string, string[]>();

  function visit(id: string): void {
    visited.add(id);
    onPath.set(id, path.length);
    path.push(id);

    for (const next of sortedUnique(neighbors(id))) {
      if (!known.has(next)) {
        continue;
      }

      const start = onPath.get(next);
      if (start !== undefined) {
        const cycle = normalize(path.slice(start));
        found.set(cycle.join("\u0000"), cycle);
        continue;
      }

      if (!visited.has(next)) {
        visit(next);
      }
    }

    path.pop();
    onPath.delete(id);
  }

  for (const id of sortedUnique(ids)) {
    if (!visited.has(id)) {
      visit(id);
    }
  }

  return [...found.values()].sort(compareTuples);
}

function normalize(cycle: readonly string[]): string[] {
  let best = 0;
  for (let i = 1; i < cycle.length; i += 1) {
    if ((cycle[i] as string) < (cycle[best] as string)) {
      best = i;
    }
  }
  const rotated = [...cycle.slice(best), ...cycle.slice(0, best)];
  return [...rotated, rotated[0] as string];
}

function sortedUnique(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort();
}

function compareTuples(left: readonly string[], right: readonly string[]): number {
  const length = Math.min(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const a = left[i] as string;
    const b = right[i] as string;
    if (a !== b) {
      return a < b ? -1 : 1;
    }
  }
  return left.length - right.length;
}
