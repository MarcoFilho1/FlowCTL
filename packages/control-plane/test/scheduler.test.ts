import { strict as assert } from "node:assert";
import { test } from "node:test";
import { selectReadyTaskIds } from "../src/scheduler-policy.js";
import type { Task, TaskGraph, TaskLevel, TaskStatus } from "@flowctl/protocol";

const TIMESTAMP = "2026-09-07T00:00:00.000Z";

function makeTask(
  id: string,
  status: TaskStatus = "pending",
  overrides: Partial<Task> = {}
): Task {
  return {
    id,
    level: "atomic" as TaskLevel,
    title: `${id} title`,
    status,
    dependencies: [],
    acceptanceCriteria: [],
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    ...overrides
  };
}

function makeGraph(tasks: Record<string, Task>): TaskGraph {
  return {
    projectId: "P1",
    rootTaskIds: [],
    tasks
  };
}

test("returns no task ids for an empty graph", () => {
  assert.deepEqual(selectReadyTaskIds(makeGraph({})), []);
});

test("selects only own tasks whose status is ready", () => {
  const graph = makeGraph({
    pending: makeTask("pending"),
    claimed: makeTask("claimed", "claimed"),
    running: makeTask("running", "running"),
    blocked: makeTask("blocked", "blocked"),
    review: makeTask("review", "review"),
    failed: makeTask("failed", "failed"),
    cancelled: makeTask("cancelled", "cancelled"),
    completed: makeTask("completed", "completed"),
    ready: makeTask("ready", "ready"),
    varied: makeTask("different-task-id", "ready", {
      dependencies: ["missing"],
      parentId: "parent",
      level: "task",
      assignedWorkerId: "worker"
    })
  });

  assert.deepEqual(selectReadyTaskIds(graph, { limit: 10 }), ["ready", "varied"]);
});

test("defaults to one result and honors zero, finite, and oversized limits", () => {
  const graph = makeGraph({
    C: makeTask("C", "ready"),
    A: makeTask("A", "ready"),
    B: makeTask("B", "ready")
  });

  assert.deepEqual(selectReadyTaskIds(graph), ["A"]);
  assert.deepEqual(selectReadyTaskIds(graph, { limit: 0 }), []);
  assert.deepEqual(selectReadyTaskIds(graph, { limit: 1 }), ["A"]);
  assert.deepEqual(selectReadyTaskIds(graph, { limit: 2 }), ["A", "B"]);
  assert.deepEqual(selectReadyTaskIds(graph, { limit: 10 }), ["A", "B", "C"]);
  assert.deepEqual(
    selectReadyTaskIds(makeGraph({ B: makeTask("B", "ready"), A: makeTask("A", "ready") })),
    ["A"]
  );
});

test("returns canonical graph keys in locale-independent lexical order", () => {
  const graph = makeGraph({
    z: makeTask("not-z", "ready"),
    "10": makeTask("not-10", "ready"),
    "2": makeTask("not-2", "ready"),
    A: makeTask("not-A", "ready"),
    a: makeTask("not-a", "ready")
  });

  assert.deepEqual(selectReadyTaskIds(graph, { limit: 10 }), ["10", "2", "A", "a", "z"]);
});

test("does not select inherited names or inherited __proto__", () => {
  const prototype = Object.create({
    toString: makeTask("toString", "ready"),
    constructor: makeTask("constructor", "ready")
  });
  Object.defineProperty(prototype, "__proto__", {
    value: makeTask("inherited-proto", "ready"),
    enumerable: true,
    configurable: true,
    writable: true
  });
  const tasks = Object.create(prototype) as Record<string, Task>;

  assert.deepEqual(selectReadyTaskIds(makeGraph(tasks), { limit: 10 }), []);
});

test("selects a legitimate own enumerable __proto__ key", () => {
  const tasks = {} as Record<string, Task>;
  const readyTask = makeTask("different-id", "ready");
  Object.defineProperty(tasks, "__proto__", {
    value: readyTask,
    enumerable: true,
    configurable: true,
    writable: true
  });

  assert.deepEqual(selectReadyTaskIds(makeGraph(tasks), { limit: 10 }), ["__proto__"]);
});

test("rejects every supplied limit that is not a non-negative safe integer", () => {
  const graph = makeGraph({ ready: makeTask("ready", "ready") });

  const invalidLimits = [
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
    null as unknown as number
  ];

  for (const limit of invalidLimits) {
    assert.throws(() => selectReadyTaskIds(graph, { limit }), RangeError);
  }
  assert.deepEqual(selectReadyTaskIds(graph, { limit: Number.MAX_SAFE_INTEGER }), ["ready"]);

  const graphWithoutTasks = {} as TaskGraph;
  assert.throws(
    () =>
      selectReadyTaskIds(graphWithoutTasks, {
        limit: null as unknown as number
      }),
    RangeError
  );
});

test("does not mutate the graph or share the returned array between calls", () => {
  const graph = makeGraph({
    B: makeTask("B", "ready"),
    A: makeTask("A", "ready")
  });
  const originalGraph = structuredClone(graph);

  const result = selectReadyTaskIds(graph, { limit: 2 });
  (result as string[]).push("mutated");

  assert.deepEqual(graph, originalGraph);
  assert.deepEqual(selectReadyTaskIds(graph, { limit: 2 }), ["A", "B"]);
});

test("validates the limit before reading the graph", () => {
  const graph = {} as TaskGraph;

  assert.throws(() => selectReadyTaskIds(graph, { limit: -1 }), RangeError);
});
