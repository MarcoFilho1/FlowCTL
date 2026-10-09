import assert from "node:assert/strict";
import { test } from "node:test";
import { findCycles } from "../../mod/graph/cycles.ts";

function graph(edges: Record<string, string[]>) {
  return { ids: Object.keys(edges), neighbors: (id: string) => edges[id] ?? [] };
}

test("an acyclic graph has no cycles", () => {
  const { ids, neighbors } = graph({ a: ["b", "c"], b: ["d"], c: ["d"], d: [] });
  assert.deepEqual(findCycles(ids, neighbors), []);
});

test("a cycle is normalized to start at its smallest id", () => {
  const { ids, neighbors } = graph({ c: ["a"], a: ["b"], b: ["c"] });
  assert.deepEqual(findCycles(ids, neighbors), [["a", "b", "c", "a"]]);
});

test("a self-loop is a cycle", () => {
  const { ids, neighbors } = graph({ a: ["a"], b: [] });
  assert.deepEqual(findCycles(ids, neighbors), [["a", "a"]]);
});

test("separate cycles are all reported, sorted", () => {
  const { ids, neighbors } = graph({ x: ["y"], y: ["x"], a: ["b"], b: ["a"], m: ["x"] });
  assert.deepEqual(findCycles(ids, neighbors), [
    ["a", "b", "a"],
    ["x", "y", "x"]
  ]);
});

test("unknown neighbors and duplicate edges are ignored", () => {
  const { ids, neighbors } = graph({ a: ["ghost", "b", "b"], b: [] });
  assert.deepEqual(findCycles(ids, neighbors), []);
});

test("the result does not depend on input order", () => {
  const edges = { a: ["b"], b: ["c"], c: ["a"], d: ["a"] };
  const forward = findCycles(Object.keys(edges), (id) => edges[id as keyof typeof edges] ?? []);
  const reversed = findCycles(Object.keys(edges).reverse(), (id) => [
    ...(edges[id as keyof typeof edges] ?? [])
  ].reverse());
  assert.deepEqual(forward, reversed);
});
