import assert from "node:assert/strict";
import { test } from "node:test";
import { layout } from "../../mod/graph/layout.ts";
import type { GraphNode, Layout } from "../../mod/graph/types.ts";

function task(id: string, blockedBy: string[] = []): GraphNode {
  return { id, kind: "task", title: id, status: "pending", blockedBy };
}

function agent(id: string, parent?: string): GraphNode {
  return { id, kind: "agent", title: id, status: "running", blockedBy: [], parent };
}

/** Each rank's ids in order: `[["a"], ["b", "c"]]`. */
function columns(placed: Layout): string[][] {
  const result: string[][] = [];
  for (const [id, { rank, order }] of Object.entries(placed)) {
    (result[rank] ??= [])[order] = id;
  }
  return result;
}

function assertCompact(placed: Layout): void {
  for (const column of columns(placed)) {
    assert.ok(column.every((id) => id !== undefined), "orders are 0..n-1 in every rank");
  }
}

test("a chain takes one rank per node", () => {
  const { layout: placed, brokenEdges } = layout([task("a"), task("b", ["a"]), task("c", ["b"])]);
  assert.deepEqual(columns(placed), [["a"], ["b"], ["c"]]);
  assert.deepEqual(brokenEdges, []);
});

test("a diamond puts its middle side by side", () => {
  const { layout: placed } = layout([
    task("a"),
    task("b", ["a"]),
    task("c", ["a"]),
    task("d", ["b", "c"])
  ]);
  assert.deepEqual(columns(placed), [["a"], ["b", "c"], ["d"]]);
});

test("rank is the longest path, not the shortest", () => {
  const { layout: placed } = layout([task("a"), task("b", ["a"]), task("c", ["a", "b"])]);
  assert.equal(placed.c?.rank, 2);
});

test("independent nodes sit side by side in rank 0, in array order", () => {
  const { layout: placed } = layout([task("x"), task("y"), task("z")]);
  assert.deepEqual(columns(placed), [["x", "y", "z"]]);
});

test("an agent sits one rank below the task it was spawned from", () => {
  const { layout: placed } = layout([task("t1"), task("t2", ["t1"]), agent("agent:a", "t1")]);
  assert.deepEqual(placed["agent:a"], { rank: 1, order: 1 });
  assert.deepEqual(placed.t2, { rank: 1, order: 0 });
});

test("an agent with a missing or absent parent is a root", () => {
  const { layout: placed } = layout([agent("agent:a", "ghost"), agent("agent:b")]);
  assert.deepEqual(columns(placed), [["agent:a", "agent:b"]]);
});

test("a cycle is broken at its newest edge and reported", () => {
  // Edges c -> a -> b -> c. The newest is the one whose target comes last in
  // the array: b -> c.
  const { layout: placed, brokenEdges } = layout([task("a", ["c"]), task("b", ["a"]), task("c", ["b"])]);
  assert.deepEqual(brokenEdges, [["b", "c"]]);
  assert.deepEqual(columns(placed), [["c"], ["a"], ["b"]]);
});

test("a self-loop is broken and reported", () => {
  const { layout: placed, brokenEdges } = layout([task("a", ["a"]), task("b", ["a"])]);
  assert.deepEqual(brokenEdges, [["a", "a"]]);
  assert.deepEqual(columns(placed), [["a"], ["b"]]);
});

test("unknown ids and duplicate edges are ignored", () => {
  const { layout: placed, brokenEdges } = layout([task("a", ["ghost"]), task("b", ["a", "a", "nobody"])]);
  assert.deepEqual(columns(placed), [["a"], ["b"]]);
  assert.deepEqual(brokenEdges, []);
  assert.deepEqual(Object.keys(placed).sort(), ["a", "b"]);
});

test("barycenter keeps edges from crossing", () => {
  // Rank 0: p, q. Rank 1 is created as y (under q) before x (under p).
  const { layout: placed } = layout([task("p"), task("q"), task("y", ["q"]), task("x", ["p"])]);
  assert.deepEqual(columns(placed), [["p", "q"], ["x", "y"]]);
});

test("orders are compact in every rank", () => {
  const nodes = [task("a"), task("b"), task("c", ["a"]), task("d", ["b"]), task("e", ["a", "b"]), task("f", ["e"])];
  assertCompact(layout(nodes).layout);
});

test("adding a node does not reorder the old ones", () => {
  const before = [task("a"), task("b", ["a"]), task("c", ["a"]), task("d", ["a"])];
  const first = layout(before).layout;

  const after = [...before, task("e", ["a"])];
  const second = layout(after, first).layout;

  for (const id of ["a", "b", "c", "d"]) {
    assert.deepEqual(second[id], first[id], `${id} keeps its place`);
  }
  assert.deepEqual(second.e, { rank: 1, order: 3 });
});

test("old nodes keep their relative order even where barycenter would swap them", () => {
  const nodes = [task("p"), task("q"), task("x", ["p"]), task("y", ["q"])];
  const previous: Layout = {
    p: { rank: 0, order: 0 },
    q: { rank: 0, order: 1 },
    x: { rank: 1, order: 1 },
    y: { rank: 1, order: 0 }
  };
  const { layout: placed } = layout(nodes, previous);
  assert.deepEqual(columns(placed), [["p", "q"], ["y", "x"]]);
});

test("a node new to a rank enters by barycenter between old ones", () => {
  const previous = layout([task("p"), task("q"), task("r"), task("x", ["p"]), task("z", ["r"])]).layout;
  const { layout: placed } = layout(
    [task("p"), task("q"), task("r"), task("x", ["p"]), task("z", ["r"]), task("y", ["q"])],
    previous
  );
  assert.deepEqual(columns(placed), [["p", "q", "r"], ["x", "y", "z"]]);
});

test("a node that changed rank is not held to its old order", () => {
  const previous = layout([task("a"), task("b"), task("c")]).layout;
  const { layout: placed } = layout([task("a"), task("b"), task("c", ["a"])], previous);
  assert.deepEqual(columns(placed), [["a", "b"], ["c"]]);
});

test("the same input always yields the same layout", () => {
  const nodes = [
    task("a"),
    task("b", ["a"]),
    task("c", ["a"]),
    task("d", ["b", "c"]),
    task("e", ["d", "ghost"]),
    agent("agent:1", "c"),
    task("f", ["e"]),
    task("g", ["f", "a"]),
    task("a2", ["g"])
  ];
  const first = layout(nodes);
  for (let i = 0; i < 5; i += 1) {
    assert.deepEqual(layout(nodes), first);
  }
  assert.deepEqual(layout(nodes, first.layout), layout(nodes, first.layout));
});

test("an empty graph has an empty layout", () => {
  assert.deepEqual(layout([]), { layout: {}, brokenEdges: [] });
});

test("50 nodes are laid out in under 5 ms", () => {
  const nodes: GraphNode[] = [];
  for (let i = 0; i < 50; i += 1) {
    const deps = [
      i % 5 !== 0 ? i - 1 : -1,
      i % 2 === 0 ? i - 3 : -1,
      i % 3 === 0 ? i - 7 : -1
    ].filter((d) => d >= 0).map((d) => `t${d}`);
    nodes.push(i % 10 === 9 ? agent(`t${i}`, `t${i - 4}`) : task(`t${i}`, deps));
  }
  nodes[0] = task("t0", ["t48"]); // one cycle to break

  const warm = layout(nodes);
  const runs = 20;
  const start = performance.now();
  for (let i = 0; i < runs; i += 1) {
    layout(nodes, warm.layout);
  }
  const perRun = (performance.now() - start) / runs;

  assertCompact(warm.layout);
  assert.equal(Object.keys(warm.layout).length, 50);
  assert.ok(warm.brokenEdges.length > 0);
  assert.ok(columns(warm.layout).length > 10, "a deep graph, not a flat one");
  const broken = new Set(warm.brokenEdges.map(([from, to]) => `${from}>${to}`));
  for (const node of nodes) {
    const sources = node.kind === "agent" ? [node.parent as string] : node.blockedBy;
    for (const from of sources.filter((source) => !broken.has(`${source}>${node.id}`))) {
      assert.ok(
        (warm.layout[from]?.rank ?? 0) < (warm.layout[node.id]?.rank ?? 0),
        `${from} -> ${node.id} points down the ranks`
      );
    }
  }
  assert.ok(perRun < 5, `took ${perRun.toFixed(3)} ms per layout`);
});
