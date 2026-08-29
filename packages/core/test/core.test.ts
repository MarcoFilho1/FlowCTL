import { strict as assert } from "node:assert";
import { test } from "node:test";
import { validateTaskGraph } from "../src/index.js";
import type { GraphValidationIssue } from "../src/index.js";
import type { Task, TaskGraph, TaskLevel } from "@flowctl/protocol";

const TIMESTAMP = "2026-08-29T00:00:00.000Z";

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

function makeValidGraph(): TaskGraph {
  const epic = makeTask("E1", "epic");
  const taskOne = makeTask("T1", "task", { parentId: "E1" });
  const subtaskOne = makeTask("S1", "subtask", { parentId: "T1" });
  const atomicOne = makeTask("A1", "atomic", { parentId: "S1" });
  const taskTwo = makeTask("T2", "task", { parentId: "E1" });
  const subtaskTwo = makeTask("S2", "subtask", { parentId: "T2" });
  const taskFour = makeTask("T4", "task", { parentId: "E1", dependencies: ["S1"] });

  return {
    projectId: "P1",
    rootTaskIds: ["E1"],
    tasks: {
      E1: epic,
      T1: taskOne,
      S1: subtaskOne,
      A1: atomicOne,
      T2: taskTwo,
      S2: subtaskTwo,
      T4: taskFour
    }
  };
}

test("accepts a strict Epic to Atomic hierarchy", () => {
  const graph = makeValidGraph();

  assert.deepEqual(validateTaskGraph(graph), { valid: true, issues: [] });
});

test("uses graph.tasks keys as canonical identity", () => {
  const graph = makeValidGraph();
  graph.tasks.T1.id = "WRONG";
  graph.tasks.T4.dependencies = ["WRONG"];

  const result = validateTaskGraph(graph);

  assert.equal(result.valid, false);
  assert.deepEqual(result.issues, [
    { code: "TASK_KEY_MISMATCH", taskKey: "T1", taskId: "WRONG" },
    { code: "DEPENDENCY_NOT_FOUND", taskId: "T4", dependsOnTaskId: "WRONG" }
  ]);
});

test("reports a missing root task reference", () => {
  const graph = makeValidGraph();
  graph.rootTaskIds = ["E1", "MISSING"];

  assert.deepEqual(validateTaskGraph(graph).issues, [
    { code: "ROOT_NOT_FOUND", taskId: "MISSING" }
  ]);
});

test("reports duplicate root ids", () => {
  const graph = makeValidGraph();
  graph.rootTaskIds = ["E1", "E1"];

  assert.deepEqual(validateTaskGraph(graph).issues, [
    { code: "DUPLICATE_ROOT", taskId: "E1" }
  ]);
});

test("reports a root task that also declares a parent", () => {
  const graph = makeValidGraph();
  graph.tasks.E1.parentId = "A1";

  assert.deepEqual(validateTaskGraph(graph).issues, [
    { code: "ROOT_HAS_PARENT", taskId: "E1", parentId: "A1" },
    { code: "EPIC_WITH_PARENT", taskId: "E1", parentId: "A1" },
    {
      code: "INVALID_PARENT_LEVEL",
      taskId: "E1",
      taskLevel: "epic",
      parentId: "A1",
      parentLevel: "atomic"
    },
    { code: "HIERARCHY_CYCLE", taskIds: ["A1", "S1", "T1", "E1", "A1"] }
  ]);
});

test("reports a root task whose level is not epic", () => {
  const graph = makeValidGraph();
  graph.rootTaskIds = ["T1"];

  assert.deepEqual(validateTaskGraph(graph).issues, [
    { code: "ROOT_HAS_PARENT", taskId: "T1", parentId: "E1" },
    { code: "ROOT_NOT_EPIC", taskId: "T1", level: "task" },
    { code: "EPIC_NOT_ROOT", taskId: "E1" }
  ]);
});

test("reports an epic that is missing from rootTaskIds", () => {
  const graph = makeValidGraph();
  graph.rootTaskIds = [];

  assert.deepEqual(validateTaskGraph(graph).issues, [
    { code: "EPIC_NOT_ROOT", taskId: "E1" }
  ]);
});

test("reports an epic with a parent outside the root list", () => {
  const graph = makeValidGraph();
  graph.rootTaskIds = [];
  graph.tasks.E1.parentId = "A1";

  assert.deepEqual(validateTaskGraph(graph).issues, [
    { code: "EPIC_NOT_ROOT", taskId: "E1" },
    { code: "EPIC_WITH_PARENT", taskId: "E1", parentId: "A1" },
    {
      code: "INVALID_PARENT_LEVEL",
      taskId: "E1",
      taskLevel: "epic",
      parentId: "A1",
      parentLevel: "atomic"
    },
    { code: "HIERARCHY_CYCLE", taskIds: ["A1", "S1", "T1", "E1", "A1"] }
  ]);
});

test("reports a non-root task without a parent", () => {
  const graph = makeValidGraph();
  delete graph.tasks.T1.parentId;

  assert.deepEqual(validateTaskGraph(graph).issues, [
    { code: "NON_ROOT_WITHOUT_PARENT", taskId: "T1", level: "task" }
  ]);
});

test("reports a missing parent reference", () => {
  const graph = makeValidGraph();
  graph.tasks.T1.parentId = "MISSING";

  assert.deepEqual(validateTaskGraph(graph).issues, [
    { code: "PARENT_NOT_FOUND", taskId: "T1", parentId: "MISSING" }
  ]);
});

test("reports an invalid parent and child level pair", () => {
  const graph = makeValidGraph();
  graph.tasks.A1.parentId = "E1";

  assert.deepEqual(validateTaskGraph(graph).issues, [
    {
      code: "INVALID_PARENT_LEVEL",
      taskId: "A1",
      taskLevel: "atomic",
      parentId: "E1",
      parentLevel: "epic"
    }
  ]);
});

test("reports a missing dependency target", () => {
  const graph = makeValidGraph();
  graph.tasks.T4.dependencies = ["MISSING"];

  assert.deepEqual(validateTaskGraph(graph).issues, [
    { code: "DEPENDENCY_NOT_FOUND", taskId: "T4", dependsOnTaskId: "MISSING" }
  ]);
});

test("reports self-dependency without also reporting a dependency cycle", () => {
  const graph = makeValidGraph();
  graph.tasks.T1.dependencies = ["T1"];

  const result = validateTaskGraph(graph);

  assert.deepEqual(result.issues, [{ code: "SELF_DEPENDENCY", taskId: "T1" }]);
});

test("reports duplicate dependency ids", () => {
  const graph = makeValidGraph();
  graph.tasks.T4.dependencies = ["S1", "S1"];

  assert.deepEqual(validateTaskGraph(graph).issues, [
    { code: "DUPLICATE_DEPENDENCY", taskId: "T4", dependsOnTaskId: "S1" }
  ]);
});

test("reports dependency cycles with a stable canonical path", () => {
  const graph = makeValidGraph();
  graph.tasks.S1.dependencies = ["S2"];
  graph.tasks.S2.dependencies = ["S1"];

  assert.deepEqual(validateTaskGraph(graph).issues, [
    { code: "DEPENDENCY_CYCLE", taskIds: ["S1", "S2", "S1"] }
  ]);
});

test("reports hierarchy cycles with a stable canonical path", () => {
  const graph = makeValidGraph();
  graph.tasks.E1.parentId = "A1";

  assert.deepEqual(validateTaskGraph(graph).issues, [
    { code: "ROOT_HAS_PARENT", taskId: "E1", parentId: "A1" },
    { code: "EPIC_WITH_PARENT", taskId: "E1", parentId: "A1" },
    {
      code: "INVALID_PARENT_LEVEL",
      taskId: "E1",
      taskLevel: "epic",
      parentId: "A1",
      parentLevel: "atomic"
    },
    { code: "HIERARCHY_CYCLE", taskIds: ["A1", "S1", "T1", "E1", "A1"] }
  ]);
});

test("allows cross-branch dependencies when the target exists", () => {
  const graph = makeValidGraph();
  graph.tasks.S2.dependencies = ["S1"];

  assert.deepEqual(validateTaskGraph(graph), { valid: true, issues: [] });
});

test("does not mutate the input graph", () => {
  const graph = makeValidGraph();
  const snapshot = structuredClone(graph);
  graph.tasks.S1.dependencies = ["S2"];
  graph.tasks.S2.dependencies = ["S1"];

  validateTaskGraph(graph);

  assert.deepEqual(graph, {
    ...snapshot,
    tasks: {
      ...snapshot.tasks,
      S1: { ...snapshot.tasks.S1, dependencies: ["S2"] },
      S2: { ...snapshot.tasks.S2, dependencies: ["S1"] }
    }
  });
});

test("sorts issues by spec precedence across different codes", () => {
  const graph: TaskGraph = {
    projectId: "P1",
    rootTaskIds: ["MISSING_ROOT", "A0", "A0"],
    tasks: {
      A0: makeTask("A0", "atomic", { parentId: "T0" }),
      C1: makeTask("C1", "task", { parentId: "E9", dependencies: ["C2"] }),
      C2: makeTask("C2", "task", { parentId: "E9", dependencies: ["C1"] }),
      D1: makeTask("D1", "task", { parentId: "E9", dependencies: ["MISSING_DEP"] }),
      D2: makeTask("D2", "task", { parentId: "E9", dependencies: ["D2"] }),
      D3: makeTask("D3", "task", { parentId: "E9", dependencies: ["C1", "C1"] }),
      E0: makeTask("E0", "epic", { parentId: "A0" }),
      H1: makeTask("H1", "task", { parentId: "H2" }),
      H2: makeTask("H2", "subtask", { parentId: "H1" }),
      K1: makeTask("WRONG", "task"),
      T0: makeTask("T0", "task"),
      T1: makeTask("T1", "task", { parentId: "MISSING_PARENT" }),
      T2: makeTask("T2", "task", { parentId: "A0" })
    }
  };

  const codes = Array.from(new Set(validateTaskGraph(graph).issues.map((issue) => issue.code)));

  assert.deepEqual(codes, [
    "TASK_KEY_MISMATCH",
    "ROOT_NOT_FOUND",
    "DUPLICATE_ROOT",
    "ROOT_HAS_PARENT",
    "ROOT_NOT_EPIC",
    "EPIC_NOT_ROOT",
    "EPIC_WITH_PARENT",
    "NON_ROOT_WITHOUT_PARENT",
    "PARENT_NOT_FOUND",
    "INVALID_PARENT_LEVEL",
    "DEPENDENCY_NOT_FOUND",
    "SELF_DEPENDENCY",
    "DUPLICATE_DEPENDENCY",
    "DEPENDENCY_CYCLE",
    "HIERARCHY_CYCLE"
  ]);
});

test("sorts same-code issues lexicographically by canonical identifiers", () => {
  const graph = makeValidGraph();
  graph.rootTaskIds = ["A0", "Z0", "A0", "Z0"];
  graph.tasks.A2 = makeTask("WRONG-A2", "task");
  graph.tasks.Z9 = makeTask("WRONG-Z9", "task");
  graph.tasks.B2 = makeTask("B2", "task", { parentId: "MISSING-B" });
  graph.tasks.B1 = makeTask("B1", "task", { parentId: "MISSING-A" });
  graph.tasks.D2 = makeTask("D2", "task", { parentId: "E1", dependencies: ["MISSING-B"] });
  graph.tasks.D1 = makeTask("D1", "task", { parentId: "E1", dependencies: ["MISSING-A"] });

  const issues = validateTaskGraph(graph).issues;

  assert.deepEqual(issues.filter(isTaskKeyMismatch), [
    { code: "TASK_KEY_MISMATCH", taskKey: "A2", taskId: "WRONG-A2" },
    { code: "TASK_KEY_MISMATCH", taskKey: "Z9", taskId: "WRONG-Z9" }
  ]);
  assert.deepEqual(
    issues.filter((issue) => issue.code === "ROOT_NOT_FOUND"),
    [
      { code: "ROOT_NOT_FOUND", taskId: "A0" },
      { code: "ROOT_NOT_FOUND", taskId: "Z0" }
    ]
  );
  assert.deepEqual(
    issues.filter((issue) => issue.code === "DUPLICATE_ROOT"),
    [
      { code: "DUPLICATE_ROOT", taskId: "A0" },
      { code: "DUPLICATE_ROOT", taskId: "Z0" }
    ]
  );
  assert.deepEqual(
    issues.filter((issue) => issue.code === "PARENT_NOT_FOUND"),
    [
      { code: "PARENT_NOT_FOUND", taskId: "B1", parentId: "MISSING-A" },
      { code: "PARENT_NOT_FOUND", taskId: "B2", parentId: "MISSING-B" }
    ]
  );
  assert.deepEqual(
    issues.filter((issue) => issue.code === "DEPENDENCY_NOT_FOUND"),
    [
      { code: "DEPENDENCY_NOT_FOUND", taskId: "D1", dependsOnTaskId: "MISSING-A" },
      { code: "DEPENDENCY_NOT_FOUND", taskId: "D2", dependsOnTaskId: "MISSING-B" }
    ]
  );
});

function isTaskKeyMismatch(
  issue: GraphValidationIssue
): issue is Extract<GraphValidationIssue, { code: "TASK_KEY_MISMATCH" }> {
  return issue.code === "TASK_KEY_MISMATCH";
}
