import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as ControlPlane from "../src/index.js";
import type { Task, TaskGraph, TaskLevel } from "@flowctl/protocol";

type ControlPlaneCreationResult = ControlPlane.ControlPlaneCreationResult;

// @ts-expect-error ControlPlane is an opaque branded handle.
const forgedControlPlane: ControlPlane.ControlPlane = {};
void forgedControlPlane;

const TIMESTAMP = "2026-08-30T00:00:00.000Z";

function makeTask(
  id: string,
  level: TaskLevel,
  overrides: Partial<Task> = {}
): Task {
  return {
    id,
    level,
    title: `${id} title`,
    status: "pending",
    dependencies: [],
    acceptanceCriteria: [],
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    ...overrides
  };
}

function makeMilestoneGraph(): TaskGraph {
  return {
    projectId: "P1",
    rootTaskIds: ["A"],
    tasks: {
      A: makeTask("A", "epic", { status: "ready" }),
      B: makeTask("B", "task", { parentId: "A" }),
      C: makeTask("C", "subtask", { parentId: "B" }),
      D: makeTask("D", "atomic", { parentId: "C" })
    }
  };
}

function makeOptions(): ControlPlane.ControlPlaneOptions {
  return {
    now: () => TIMESTAMP,
    nextLeaseId: () => "lease-1",
    nextEventId: () => "event-1",
    leaseExpiresAt: () => "2026-08-30T01:00:00.000Z"
  };
}

test("creates an opaque ControlPlane and preserves initialization statuses", () => {
  const result = ControlPlane.createControlPlane(makeMilestoneGraph(), makeOptions());

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.deepEqual(
    Object.fromEntries(
      Object.entries(ControlPlane.getTaskGraphSnapshot(result.controlPlane).tasks).map(
        ([id, task]) => [id, task.status]
      )
    ),
    { A: "ready", B: "pending", C: "pending", D: "pending" }
  );
});

test("rejects an invalid graph with the Core validation issues", () => {
  const graph = makeMilestoneGraph();
  graph.rootTaskIds = ["MISSING"];

  const result = ControlPlane.createControlPlane(graph, makeOptions());

  const narrowResult: ControlPlaneCreationResult = result;
  assert.deepEqual(narrowResult, {
    ok: false,
    code: "INVALID_GRAPH",
    issues: [
      { code: "ROOT_NOT_FOUND", taskId: "MISSING" },
      { code: "EPIC_NOT_ROOT", taskId: "A" }
    ]
  });
});

test("defensively isolates the ControlPlane from later mutations to the source graph", () => {
  const graph = makeMilestoneGraph();
  const result = ControlPlane.createControlPlane(graph, makeOptions());

  assert.equal(result.ok, true);
  if (!result.ok) return;

  graph.rootTaskIds.push("B");
  graph.tasks.A.status = "running";
  graph.tasks.B.dependencies.push("A");
  graph.tasks.C.acceptanceCriteria.push({ id: "AC-1", description: "mutated" });

  const snapshot = ControlPlane.getTaskGraphSnapshot(result.controlPlane);

  assert.deepEqual(snapshot.rootTaskIds, ["A"]);
  assert.equal(snapshot.tasks.A.status, "ready");
  assert.deepEqual(snapshot.tasks.B.dependencies, []);
  assert.deepEqual(snapshot.tasks.C.acceptanceCriteria, []);
});

test("returns defensive task graph snapshots", () => {
  const result = ControlPlane.createControlPlane(makeMilestoneGraph(), makeOptions());

  assert.equal(result.ok, true);
  if (!result.ok) return;

  const firstSnapshot = ControlPlane.getTaskGraphSnapshot(result.controlPlane);
  firstSnapshot.rootTaskIds.push("B");
  firstSnapshot.tasks.A.status = "running";
  firstSnapshot.tasks.B.dependencies.push("A");
  firstSnapshot.tasks.C.acceptanceCriteria.push({ id: "AC-1", description: "changed" });

  const secondSnapshot = ControlPlane.getTaskGraphSnapshot(result.controlPlane);

  assert.deepEqual(secondSnapshot.rootTaskIds, ["A"]);
  assert.equal(secondSnapshot.tasks.A.status, "ready");
  assert.deepEqual(secondSnapshot.tasks.B.dependencies, []);
  assert.deepEqual(secondSnapshot.tasks.C.acceptanceCriteria, []);
});

test("starts with an empty Event Log", () => {
  const result = ControlPlane.createControlPlane(makeMilestoneGraph(), makeOptions());

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.deepEqual(ControlPlane.getEventLogSnapshot(result.controlPlane), []);
});

test("does not expose the internal Event Log array", () => {
  const result = ControlPlane.createControlPlane(makeMilestoneGraph(), makeOptions());

  assert.equal(result.ok, true);
  if (!result.ok) return;

  const first = ControlPlane.getEventLogSnapshot(result.controlPlane);
  const second = ControlPlane.getEventLogSnapshot(result.controlPlane);

  assert.deepEqual(first, []);
  assert.notStrictEqual(first, second);
});
