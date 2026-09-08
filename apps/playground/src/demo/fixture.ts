import type { TaskGraph } from "@flowctl/protocol";

export type DemoNodePosition = Readonly<{ x: number; y: number }>;

export const DEMO_PROJECT_ID = "demo-project" as const;
export const DEMO_WORKER_ID = "demo-worker" as const;
export const DEMO_ACTOR = { type: "user", id: "playground" } as const;

const TIMESTAMP = "2026-09-08T00:00:00.000Z";

export const DEMO_NODE_POSITIONS: Readonly<Record<string, DemoNodePosition>> = {
  A: { x: 360, y: 48 },
  B: { x: 152, y: 208 },
  C: { x: 568, y: 208 },
  D: { x: 360, y: 368 }
};

export function createDemoTaskGraph(): TaskGraph {
  return {
    projectId: DEMO_PROJECT_ID,
    rootTaskIds: ["A"],
    tasks: {
      A: {
        id: "A",
        level: "epic",
        title: "Define the developer graph playground",
        status: "ready",
        dependencies: [],
        acceptanceCriteria: [],
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP
      },
      B: {
        id: "B",
        parentId: "A",
        level: "task",
        title: "Project the task graph for the canvas",
        status: "pending",
        dependencies: ["A"],
        acceptanceCriteria: [],
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP
      },
      C: {
        id: "C",
        parentId: "B",
        level: "subtask",
        title: "Render accessible task graph details",
        status: "pending",
        dependencies: ["A"],
        acceptanceCriteria: [],
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP
      },
      D: {
        id: "D",
        parentId: "C",
        level: "atomic",
        title: "Exercise the Control Plane runtime",
        status: "pending",
        dependencies: ["B", "C"],
        acceptanceCriteria: [],
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP
      }
    }
  };
}
