import { createControlPlane } from "@flowctl/control-plane";
import type { TaskGraph, TaskStatus } from "@flowctl/protocol";
import {
  DEMO_NODE_POSITIONS,
  createDemoTaskGraph
} from "../src/demo/fixture.js";
import { createDemoControlPlaneOptions } from "../src/demo/control-plane.js";
import {
  getMaterializedReadyTaskIds,
  taskGraphToEdges,
  taskGraphToNodes
} from "../src/model/graph-projection.js";
import { statusToPresentation } from "../src/model/status-presentation.js";

test("official fixture is accepted by the public Control Plane and uses canonical graph keys", () => {
  const graph = createDemoTaskGraph();
  const result = createControlPlane(graph, createDemoControlPlaneOptions());

  expect(result.ok).toBe(true);
  expect(Object.keys(graph.tasks).sort()).toEqual(["A", "B", "C", "D"]);
  expect(Object.entries(graph.tasks).map(([key, task]) => [key, task.id])).toEqual([
    ["A", "A"],
    ["B", "B"],
    ["C", "C"],
    ["D", "D"]
  ]);
});

test("each Control Plane options factory call owns independent deterministic counters", () => {
  const first = createDemoControlPlaneOptions();
  const second = createDemoControlPlaneOptions();

  expect(first.nextEventId()).toBe("demo-event-1");
  expect(first.nextLeaseId()).toBe("demo-lease-1");
  expect(first.now()).toBe("2026-09-08T00:00:01.000Z");
  expect(second.nextEventId()).toBe("demo-event-1");
  expect(second.nextLeaseId()).toBe("demo-lease-1");
  expect(second.now()).toBe("2026-09-08T00:00:01.000Z");
});

test("node projection preserves fixed positions and explicit task statuses", () => {
  const nodes = taskGraphToNodes(createDemoTaskGraph(), DEMO_NODE_POSITIONS);

  expect(nodes).toEqual([
    {
      taskId: "A",
      title: "Define the developer graph playground",
      status: "ready",
      dependencyCount: 0,
      position: { x: 360, y: 48 }
    },
    {
      taskId: "B",
      title: "Project the task graph for the canvas",
      status: "pending",
      dependencyCount: 1,
      position: { x: 152, y: 208 }
    },
    {
      taskId: "C",
      title: "Render accessible task graph details",
      status: "pending",
      dependencyCount: 1,
      position: { x: 568, y: 208 }
    },
    {
      taskId: "D",
      title: "Exercise the Control Plane runtime",
      status: "pending",
      dependencyCount: 2,
      position: { x: 360, y: 368 }
    }
  ]);
});

test("edge projection uses dependencies only and is deterministic across task insertion order", () => {
  const graph = createDemoTaskGraph();
  const reorderedGraph: TaskGraph = {
    ...graph,
    tasks: {
      D: graph.tasks.D,
      C: graph.tasks.C,
      B: graph.tasks.B,
      A: graph.tasks.A
    }
  };

  const expectedEdges = [
    { fromTaskId: "A", toTaskId: "B" },
    { fromTaskId: "A", toTaskId: "C" },
    { fromTaskId: "B", toTaskId: "D" },
    { fromTaskId: "C", toTaskId: "D" }
  ];

  expect(taskGraphToEdges(graph)).toEqual(expectedEdges);
  expect(taskGraphToEdges(reorderedGraph)).toEqual(expectedEdges);
  expect(taskGraphToEdges(graph)).not.toContainEqual({ fromTaskId: "B", toTaskId: "C" });
  expect(taskGraphToNodes(reorderedGraph, DEMO_NODE_POSITIONS).map((node) => node.taskId)).toEqual([
    "A",
    "B",
    "C",
    "D"
  ]);
});

test("status presentation is exhaustive and always supplies text and a non-color signal", () => {
  const statuses: readonly TaskStatus[] = [
    "pending",
    "ready",
    "claimed",
    "running",
    "blocked",
    "review",
    "completed",
    "failed",
    "cancelled"
  ];

  for (const status of statuses) {
    const presentation = statusToPresentation(status);

    expect(presentation.label).not.toHaveLength(0);
    expect(presentation.symbol).not.toHaveLength(0);
    expect(presentation.className).not.toHaveLength(0);
  }
});

test("materialized ready IDs use canonical keys and never recalculate dependency readiness", () => {
  const graph = createDemoTaskGraph();
  const snapshot: TaskGraph = {
    ...graph,
    tasks: {
      D: { ...graph.tasks.D, status: "ready" },
      C: { ...graph.tasks.C, status: "ready" },
      B: { ...graph.tasks.B, status: "pending" },
      A: { ...graph.tasks.A, status: "completed" }
    }
  };

  expect(getMaterializedReadyTaskIds(snapshot)).toEqual(["C", "D"]);
});
