import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as Core from "../src/index.js";
import * as Protocol from "@flowctl/protocol";

const validateTaskGraph = Core.validateTaskGraph;
const getReadyTaskIds = Core.getReadyTaskIds;
const isTaskTransitionAllowed = Core.isTaskTransitionAllowed;
const transitionTask = Core.transitionTask;
const createCoreState = Core.createCoreState;
const getTaskGraphSnapshot = Core.getTaskGraphSnapshot;
const applyTaskTransition = Core.applyTaskTransition;
const advanceReadyTasks = Core.advanceReadyTasks;

type GraphValidationIssue = Core.GraphValidationIssue;
type CoreState = Core.CoreState;
type CoreStateResult = Core.CoreStateResult;
type CoreTaskTransitionResult = Core.CoreTaskTransitionResult;
type TaskTransitionResult = Core.TaskTransitionResult;
type Task = Protocol.Task;
type TaskGraph = Protocol.TaskGraph;
type TaskLevel = Protocol.TaskLevel;

// @ts-expect-error CoreState is an opaque branded handle.
const forgedState: CoreState = {};
void forgedState;

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

test("sorts multiple dependency cycles by the complete canonical cycle path", () => {
  const graph = makeValidGraph();
  graph.tasks.D1 = makeTask("D1", "task", { parentId: "E1", dependencies: ["D2"] });
  graph.tasks.D2 = makeTask("D2", "task", { parentId: "E1", dependencies: ["D1"] });
  graph.tasks.C1 = makeTask("C1", "task", { parentId: "E1", dependencies: ["C2"] });
  graph.tasks.C2 = makeTask("C2", "task", { parentId: "E1", dependencies: ["C3"] });
  graph.tasks.C3 = makeTask("C3", "task", { parentId: "E1", dependencies: ["C1"] });

  const issues = validateTaskGraph(graph).issues.filter(
    (issue): issue is Extract<GraphValidationIssue, { code: "DEPENDENCY_CYCLE" }> =>
      issue.code === "DEPENDENCY_CYCLE"
  );

  assert.deepEqual(issues, [
    { code: "DEPENDENCY_CYCLE", taskIds: ["C1", "C2", "C3", "C1"] },
    { code: "DEPENDENCY_CYCLE", taskIds: ["D1", "D2", "D1"] }
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

test("sorts multiple hierarchy cycles by the complete canonical cycle path", () => {
  const graph = makeValidGraph();
  graph.tasks.C1 = makeTask("C1", "task", { parentId: "C2" });
  graph.tasks.C2 = makeTask("C2", "subtask", { parentId: "C3" });
  graph.tasks.C3 = makeTask("C3", "atomic", { parentId: "C1" });
  graph.tasks.D1 = makeTask("D1", "task", { parentId: "D2" });
  graph.tasks.D2 = makeTask("D2", "subtask", { parentId: "D1" });

  const issues = validateTaskGraph(graph).issues.filter(
    (issue): issue is Extract<GraphValidationIssue, { code: "HIERARCHY_CYCLE" }> =>
      issue.code === "HIERARCHY_CYCLE"
  );

  assert.deepEqual(issues, [
    { code: "HIERARCHY_CYCLE", taskIds: ["C1", "C2", "C3", "C1"] },
    { code: "HIERARCHY_CYCLE", taskIds: ["D1", "D2", "D1"] }
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

test("returns pending tasks with no dependencies", () => {
  const graph = makeReadinessGraph({
    E1: makeTask("E1", "epic", { status: "completed" }),
    T1: makeTask("T1", "task", { parentId: "E1" })
  });

  assert.deepEqual(getReadyTaskIds(graph), ["T1"]);
});

test("returns pending tasks only after all dependencies complete", () => {
  const graph = makeReadinessGraph({
    E1: makeTask("E1", "epic", { status: "completed" }),
    A1: makeTask("A1", "task", { parentId: "E1", status: "completed" }),
    S1: makeTask("S1", "subtask", { parentId: "A1", status: "completed" }),
    T1: makeTask("T1", "task", { parentId: "E1", dependencies: ["A1", "S1"] })
  });

  assert.deepEqual(getReadyTaskIds(graph), ["T1"]);
});

test("does not return a task when any dependency is not completed", () => {
  const nonCompletedStatuses: Exclude<Protocol.TaskStatus, "completed">[] = [
    "pending",
    "ready",
    "claimed",
    "running",
    "blocked",
    "review",
    "failed",
    "cancelled"
  ];

  for (const dependencyStatus of nonCompletedStatuses) {
    const graph = makeReadinessGraph({
      E1: makeTask("E1", "epic", { status: "completed" }),
      A1: makeTask("A1", "task", {
        parentId: "E1",
        status: dependencyStatus,
        dependencies: ["MISSING"]
      }),
      T1: makeTask("T1", "task", { parentId: "E1", dependencies: ["A1"] })
    });

    assert.deepEqual(getReadyTaskIds(graph), []);
  }
});

test("treats hierarchy as independent from readiness", () => {
  const graph = makeReadinessGraph({
    E1: makeTask("E1", "epic", { status: "completed" }),
    A1: makeTask("A1", "task", { parentId: "E1", status: "completed" }),
    S1: makeTask("S1", "subtask", { parentId: "A1", status: "completed" }),
    T1: makeTask("T1", "task", { parentId: "E1", dependencies: ["S1"] })
  });

  assert.deepEqual(getReadyTaskIds(graph), ["T1"]);
});

test("returns a pending task whose dependency is completed in another branch", () => {
  const graph = makeReadinessGraph({
    E1: makeTask("E1", "epic", { status: "completed" }),
    A1: makeTask("A1", "task", { parentId: "E1", status: "completed" }),
    S1: makeTask("S1", "subtask", { parentId: "A1", status: "completed" }),
    A2: makeTask("A2", "task", { parentId: "E1", status: "completed" }),
    T1: makeTask("T1", "task", { parentId: "A2", dependencies: ["S1"] })
  });

  assert.deepEqual(getReadyTaskIds(graph), ["T1"]);
});

test("returns ready task ids in lexicographic order", () => {
  const graph = makeReadinessGraph({
    E1: makeTask("E1", "epic", { status: "completed" }),
    Z1: makeTask("Z1", "task", { parentId: "E1" }),
    A1: makeTask("A1", "task", { parentId: "E1" }),
    M1: makeTask("M1", "task", { parentId: "E1" })
  });

  assert.deepEqual(getReadyTaskIds(graph), ["A1", "M1", "Z1"]);
});

test("does not return claimed or blocked tasks even when dependencies are complete", () => {
  const graph = makeReadinessGraph({
    E1: makeTask("E1", "epic", { status: "completed" }),
    A1: makeTask("A1", "task", { parentId: "E1", status: "completed" }),
    P1: makeTask("P1", "task", { parentId: "E1", dependencies: ["A1"] }),
    R1: makeTask("R1", "task", { parentId: "E1", status: "ready", dependencies: ["A1"] }),
    C1: makeTask("C1", "task", { parentId: "E1", status: "claimed", dependencies: ["A1"] }),
    B1: makeTask("B1", "task", { parentId: "E1", status: "blocked", dependencies: ["A1"] })
  });

  assert.deepEqual(getReadyTaskIds(graph), ["P1"]);
});

test("does not return a task with a missing dependency", () => {
  const graph = makeReadinessGraph({
    E1: makeTask("E1", "epic", { status: "completed" }),
    A1: makeTask("A1", "task", { parentId: "E1", status: "completed" }),
    T1: makeTask("T1", "task", { parentId: "E1", dependencies: ["A1", "MISSING"] })
  });

  assert.deepEqual(getReadyTaskIds(graph), []);
});

test("does not mutate the input graph", () => {
  const graph = makeReadinessGraph({
    E1: makeTask("E1", "epic", { status: "completed" }),
    A1: makeTask("A1", "task", { parentId: "E1", status: "completed" }),
    T1: makeTask("T1", "task", { parentId: "E1", dependencies: ["MISSING", "A1"] })
  });
  const snapshot = structuredClone(graph);

  getReadyTaskIds(graph);

  assert.deepEqual(graph, snapshot);
});

function makeReadinessGraph(tasks: Record<string, Task>): TaskGraph {
  return {
    projectId: "P1",
    rootTaskIds: ["E1"],
    tasks
  };
}

test("allows every lifecycle transition listed in the spec", () => {
  const allowedTransitions: readonly [Protocol.TaskStatus, Protocol.TaskStatus][] = [
    ["pending", "ready"],
    ["pending", "cancelled"],
    ["ready", "claimed"],
    ["ready", "cancelled"],
    ["claimed", "running"],
    ["claimed", "ready"],
    ["claimed", "blocked"],
    ["claimed", "failed"],
    ["claimed", "cancelled"],
    ["running", "review"],
    ["running", "blocked"],
    ["running", "failed"],
    ["running", "cancelled"],
    ["blocked", "ready"],
    ["blocked", "cancelled"],
    ["review", "running"],
    ["review", "completed"],
    ["review", "cancelled"]
  ];

  for (const [from, to] of allowedTransitions) {
    assert.equal(isTaskTransitionAllowed(from, to), true, `${from} -> ${to}`);
  }
});

test("rejects representative lifecycle transitions that are not listed", () => {
  const disallowedTransitions: readonly [Protocol.TaskStatus, Protocol.TaskStatus][] = [
    ["pending", "running"],
    ["ready", "running"],
    ["claimed", "completed"],
    ["running", "claimed"],
    ["blocked", "claimed"],
    ["review", "failed"],
    ["completed", "running"],
    ["failed", "running"],
    ["cancelled", "ready"]
  ];

  for (const [from, to] of disallowedTransitions) {
    assert.equal(isTaskTransitionAllowed(from, to), false, `${from} -> ${to}`);
  }
});

test("treats completed, failed, and cancelled as terminal states", () => {
  const terminalStatuses: readonly Protocol.TaskStatus[] = ["completed", "failed", "cancelled"];
  const targetStatuses: readonly Protocol.TaskStatus[] = [
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

  for (const from of terminalStatuses) {
    for (const to of targetStatuses) {
      assert.equal(isTaskTransitionAllowed(from, to), false, `${from} -> ${to}`);
    }
  }
});

test("transitions a task through the pure lifecycle helper without mutating the input", () => {
  const task = makeTask("T1", "task", {
    parentId: "E1",
    description: "keep me",
    assignedWorkerId: "W1",
    status: "review",
    dependencies: ["A1", "S1"],
    acceptanceCriteria: [
      { id: "AC1", description: "one" },
      { id: "AC2", description: "two" }
    ]
  });
  const snapshot = structuredClone(task);

  const result = transitionTask(task, "running", "2026-08-29T01:02:03.000Z");

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.task, {
      ...snapshot,
      status: "running",
      updatedAt: "2026-08-29T01:02:03.000Z"
    });
    assert.notEqual(result.task, task);
    assert.deepEqual(task, snapshot);
  }
});

test("returns a structured invalid transition result for disallowed pairs", () => {
  const task = makeTask("T2", "task", { status: "failed" });
  const snapshot = structuredClone(task);

  const result = transitionTask(task, "running", "2026-08-29T01:02:03.000Z");

  assert.equal(result.ok, false);
  if (!result.ok) {
    const narrowResult: TaskTransitionResult = result;

    assert.deepEqual(narrowResult, {
      ok: false,
      code: "INVALID_TASK_TRANSITION",
      from: "failed",
      to: "running"
    });
  }
  assert.deepEqual(task, snapshot);
});

test("preserves unrelated task fields when transitioning successfully", () => {
  const task = makeTask("T3", "atomic", {
    parentId: "S1",
    description: "desc",
    assignedWorkerId: "W2",
    status: "claimed",
    dependencies: ["A1"],
    acceptanceCriteria: [{ id: "AC1", description: "done" }]
  });

  const result = transitionTask(task, "running", "2026-08-29T09:08:07.000Z");

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.task, {
      id: "T3",
      parentId: "S1",
      level: "atomic",
      title: "T3 title",
      description: "desc",
      status: "running",
      dependencies: ["A1"],
      acceptanceCriteria: [{ id: "AC1", description: "done" }],
      assignedWorkerId: "W2",
      createdAt: TIMESTAMP,
      updatedAt: "2026-08-29T09:08:07.000Z"
    });
  }
});

test("rejects invalid graphs when creating state", () => {
  const graph = makeValidGraph();
  graph.rootTaskIds = ["MISSING"];

  const result = createCoreState(graph);

  const narrowResult: CoreStateResult = result;
  assert.deepEqual(narrowResult, {
    ok: false,
    issues: [
      { code: "ROOT_NOT_FOUND", taskId: "MISSING" },
      { code: "EPIC_NOT_ROOT", taskId: "E1" }
    ]
  });
});

test("creates state from a valid graph and returns a branded handle", () => {
  const result = createCoreState(makeValidGraph());

  assert.equal(result.ok, true);
  if (result.ok) {
    const state: CoreState = result.state;
    assert.equal(typeof state, "object");
    assert.notEqual(state, null);
  }
});

test("defensively isolates state from later mutations to the source graph", () => {
  const graph = makeValidGraph();
  const result = createCoreState(graph);

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  graph.rootTaskIds.push("T1");
  graph.tasks.T1.status = "running";
  graph.tasks.T1.dependencies.push("S2");
  graph.tasks.T1.acceptanceCriteria.push({ id: "AC1", description: "mutated" });

  const snapshot = getTaskGraphSnapshot(result.state);

  assert.deepEqual(snapshot.rootTaskIds, ["E1"]);
  assert.equal(snapshot.tasks.T1.status, "pending");
  assert.deepEqual(snapshot.tasks.T1.dependencies, []);
  assert.deepEqual(snapshot.tasks.T1.acceptanceCriteria, []);
});

test("returns defensive graph snapshots", () => {
  const result = createCoreState(makeValidGraph());

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  const firstSnapshot = getTaskGraphSnapshot(result.state);
  firstSnapshot.rootTaskIds.push("T1");
  firstSnapshot.tasks.T1.status = "running";
  firstSnapshot.tasks.T1.dependencies.push("S2");
  firstSnapshot.tasks.T1.acceptanceCriteria.push({ id: "AC1", description: "changed" });

  const secondSnapshot = getTaskGraphSnapshot(result.state);

  assert.deepEqual(secondSnapshot.rootTaskIds, ["E1"]);
  assert.equal(secondSnapshot.tasks.T1.status, "pending");
  assert.deepEqual(secondSnapshot.tasks.T1.dependencies, []);
  assert.deepEqual(secondSnapshot.tasks.T1.acceptanceCriteria, []);
});

test("returns task not found before any lifecycle or dependency checks", () => {
  const result = createCoreState(makeValidGraph());

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  const transitionResult = applyTaskTransition(
    result.state,
    "MISSING",
    "ready",
    "2026-08-29T10:00:00.000Z"
  );

  const narrowResult: CoreTaskTransitionResult = transitionResult;
  assert.deepEqual(narrowResult, {
    ok: false,
    code: "TASK_NOT_FOUND",
    taskId: "MISSING"
  });
  assert.deepEqual(getTaskGraphSnapshot(result.state), makeValidGraph());
});

test("returns an invalid transition result before dependency checks when lifecycle disallows it", () => {
  const graph = makeValidGraph();
  graph.tasks.T1.status = "running";
  graph.tasks.T1.dependencies = ["S1"];
  graph.tasks.S1.status = "pending";

  const result = createCoreState(graph);

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  const transitionResult = applyTaskTransition(
    result.state,
    "T1",
    "ready",
    "2026-08-29T10:00:00.000Z"
  );

  const narrowResult: CoreTaskTransitionResult = transitionResult;
  assert.deepEqual(narrowResult, {
    ok: false,
    code: "INVALID_TASK_TRANSITION",
    taskId: "T1",
    from: "running",
    to: "ready"
  });
  assert.equal(getTaskGraphSnapshot(result.state).tasks.T1.status, "running");
});

test("rejects ready transitions when dependencies are not completed and sorts incomplete ids", () => {
  const graph = makeValidGraph();
  graph.tasks.T1.status = "claimed";
  graph.tasks.T1.dependencies = ["S2", "A1", "T2"];
  graph.tasks.A1.status = "blocked";
  graph.tasks.S2.status = "pending";
  graph.tasks.T2.status = "ready";

  const result = createCoreState(graph);

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  const transitionResult = applyTaskTransition(
    result.state,
    "T1",
    "ready",
    "2026-08-29T10:00:00.000Z"
  );

  const narrowResult: CoreTaskTransitionResult = transitionResult;
  assert.deepEqual(narrowResult, {
    ok: false,
    code: "DEPENDENCIES_NOT_COMPLETED",
    taskId: "T1",
    incompleteDependencyIds: ["A1", "S2", "T2"]
  });
  assert.equal(getTaskGraphSnapshot(result.state).tasks.T1.status, "claimed");
});

test("allows a pending task to become ready when dependencies are completed", () => {
  const graph = makeValidGraph();
  graph.tasks.T1.dependencies = ["S1", "A1"];
  graph.tasks.S1.status = "completed";
  graph.tasks.A1.status = "completed";

  const result = createCoreState(graph);

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  const transitionResult = applyTaskTransition(
    result.state,
    "T1",
    "ready",
    "2026-08-29T10:00:00.000Z"
  );

  assert.equal(transitionResult.ok, true);
  if (transitionResult.ok) {
    assert.equal(transitionResult.task.status, "ready");
    assert.equal(transitionResult.task.updatedAt, "2026-08-29T10:00:00.000Z");
  }

  const snapshot = getTaskGraphSnapshot(result.state);
  assert.equal(snapshot.tasks.T1.status, "ready");
  assert.equal(snapshot.tasks.T1.updatedAt, "2026-08-29T10:00:00.000Z");
});

test("allows a claimed task to become ready when dependencies are completed", () => {
  const graph = makeValidGraph();
  graph.tasks.T1.status = "claimed";
  graph.tasks.T1.dependencies = ["S1"];
  graph.tasks.S1.status = "completed";

  const result = createCoreState(graph);

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  const transitionResult = applyTaskTransition(
    result.state,
    "T1",
    "ready",
    "2026-08-29T10:00:00.000Z"
  );

  assert.equal(transitionResult.ok, true);
  if (transitionResult.ok) {
    assert.equal(transitionResult.task.status, "ready");
  }
});

test("allows a blocked task to become ready when dependencies are completed", () => {
  const graph = makeValidGraph();
  graph.tasks.T1.status = "blocked";
  graph.tasks.T1.dependencies = ["S1"];
  graph.tasks.S1.status = "completed";

  const result = createCoreState(graph);

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  const transitionResult = applyTaskTransition(
    result.state,
    "T1",
    "ready",
    "2026-08-29T10:00:00.000Z"
  );

  assert.equal(transitionResult.ok, true);
  if (transitionResult.ok) {
    assert.equal(transitionResult.task.status, "ready");
  }
});

test("allows non-ready lifecycle transitions through the pure state machine", () => {
  const graph = makeValidGraph();
  graph.tasks.T1.status = "ready";

  const result = createCoreState(graph);

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  const transitionResult = applyTaskTransition(
    result.state,
    "T1",
    "claimed",
    "2026-08-29T10:00:00.000Z"
  );

  assert.equal(transitionResult.ok, true);
  if (transitionResult.ok) {
    assert.deepEqual(transitionResult.task, {
      ...makeValidGraph().tasks.T1,
      status: "claimed",
      updatedAt: "2026-08-29T10:00:00.000Z"
    });
  }
});

test("does not mutate state on failed transitions", () => {
  const graph = makeValidGraph();
  graph.tasks.T1.status = "claimed";
  graph.tasks.T1.dependencies = ["S1"];
  graph.tasks.S1.status = "pending";

  const result = createCoreState(graph);

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  const snapshotBefore = getTaskGraphSnapshot(result.state);

  applyTaskTransition(result.state, "T1", "ready", "2026-08-29T10:00:00.000Z");

  assert.deepEqual(getTaskGraphSnapshot(result.state), snapshotBefore);
});

test("advanceReadyTasks promotes only pending ready tasks in sorted order", () => {
  const graph = makeReadinessGraph({
    E1: makeTask("E1", "epic", { status: "completed" }),
    A1: makeTask("A1", "task", { parentId: "E1", status: "completed" }),
    M1: makeTask("M1", "task", { parentId: "E1" }),
    Z1: makeTask("Z1", "task", { parentId: "E1", dependencies: ["A1"] }),
    C1: makeTask("C1", "task", {
      parentId: "E1",
      status: "claimed",
      dependencies: ["A1"]
    }),
    B1: makeTask("B1", "task", {
      parentId: "E1",
      status: "blocked",
      dependencies: ["A1"]
    }),
    R1: makeTask("R1", "task", {
      parentId: "E1",
      status: "ready",
      dependencies: ["A1"]
    })
  });
  const result = createCoreState(graph);

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  const changedTaskIds = advanceReadyTasks(result.state, "2026-08-29T11:00:00.000Z");
  const snapshot = getTaskGraphSnapshot(result.state);

  assert.deepEqual(changedTaskIds, ["M1", "Z1"]);
  assert.equal(snapshot.tasks.M1.status, "ready");
  assert.equal(snapshot.tasks.M1.updatedAt, "2026-08-29T11:00:00.000Z");
  assert.equal(snapshot.tasks.Z1.status, "ready");
  assert.equal(snapshot.tasks.Z1.updatedAt, "2026-08-29T11:00:00.000Z");
  assert.equal(snapshot.tasks.C1.status, "claimed");
  assert.equal(snapshot.tasks.B1.status, "blocked");
  assert.equal(snapshot.tasks.R1.status, "ready");
});

test("exposes the intended runtime facade surface from the source barrel", () => {
  assert.deepEqual(Object.keys(Core).sort(), [
    "advanceReadyTasks",
    "applyTaskTransition",
    "createCoreState",
    "getReadyTaskIds",
    "getTaskGraphSnapshot",
    "isTaskTransitionAllowed",
    "transitionTask",
    "validateTaskGraph"
  ]);
});

test("supports exhaustive narrowing for every GraphValidationIssue code", () => {
  const samples: readonly GraphValidationIssue[] = [
    { code: "TASK_KEY_MISMATCH", taskKey: "T1", taskId: "WRONG" },
    { code: "ROOT_NOT_FOUND", taskId: "ROOT" },
    { code: "DUPLICATE_ROOT", taskId: "ROOT" },
    { code: "ROOT_HAS_PARENT", taskId: "ROOT", parentId: "PARENT" },
    { code: "ROOT_NOT_EPIC", taskId: "ROOT", level: "task" },
    { code: "EPIC_NOT_ROOT", taskId: "E1" },
    { code: "EPIC_WITH_PARENT", taskId: "E1", parentId: "A1" },
    { code: "NON_ROOT_WITHOUT_PARENT", taskId: "T1", level: "task" },
    { code: "PARENT_NOT_FOUND", taskId: "T1", parentId: "MISSING" },
    {
      code: "INVALID_PARENT_LEVEL",
      taskId: "T1",
      taskLevel: "task",
      parentId: "A1",
      parentLevel: "atomic"
    },
    { code: "DEPENDENCY_NOT_FOUND", taskId: "T1", dependsOnTaskId: "MISSING" },
    { code: "SELF_DEPENDENCY", taskId: "T1" },
    { code: "DUPLICATE_DEPENDENCY", taskId: "T1", dependsOnTaskId: "A1" },
    { code: "DEPENDENCY_CYCLE", taskIds: ["A1", "B1", "A1"] },
    { code: "HIERARCHY_CYCLE", taskIds: ["E1", "T1", "S1", "E1"] }
  ];

  assert.deepEqual(
    samples.map(describeGraphValidationIssue),
    [
      "key:T1->WRONG",
      "root-missing:ROOT",
      "root-duplicate:ROOT",
      "root-parent:ROOT->PARENT",
      "root-level:ROOT->task",
      "epic-not-root:E1",
      "epic-parent:E1->A1",
      "non-root-parent:T1->task",
      "parent-missing:T1->MISSING",
      "parent-level:T1(task)->A1(atomic)",
      "dependency-missing:T1->MISSING",
      "self-dependency:T1",
      "dependency-duplicate:T1->A1",
      "dependency-cycle:A1>B1>A1",
      "hierarchy-cycle:E1>T1>S1>E1"
    ]
  );
});

test("supports exhaustive narrowing for every public Core result union branch", () => {
  const createdStateResult = createCoreState(makeValidGraph());
  assert.equal(createdStateResult.ok, true);
  if (!createdStateResult.ok) {
    throw new Error("Expected valid graph to create CoreState");
  }

  const stateResultSamples: readonly CoreStateResult[] = [
    { ok: false, issues: [{ code: "ROOT_NOT_FOUND", taskId: "MISSING" }] },
    { ok: true, state: createdStateResult.state }
  ];
  const taskTransitionSamples: readonly TaskTransitionResult[] = [
    { ok: false, code: "INVALID_TASK_TRANSITION", from: "pending", to: "running" },
    { ok: true, task: makeTask("T1", "task", { parentId: "E1", status: "ready" }) }
  ];
  const coreTransitionSamples: readonly CoreTaskTransitionResult[] = [
    { ok: false, code: "TASK_NOT_FOUND", taskId: "MISSING" },
    {
      ok: false,
      code: "INVALID_TASK_TRANSITION",
      taskId: "T1",
      from: "running",
      to: "ready"
    },
    {
      ok: false,
      code: "DEPENDENCIES_NOT_COMPLETED",
      taskId: "T1",
      incompleteDependencyIds: ["A1", "S1"]
    },
    { ok: true, task: makeTask("T1", "task", { parentId: "E1", status: "ready" }) }
  ];

  assert.deepEqual(stateResultSamples.map(describeCoreStateResult), [
    "state-error:ROOT_NOT_FOUND",
    "state-ok"
  ]);
  assert.deepEqual(taskTransitionSamples.map(describeTaskTransitionResult), [
    "task-transition-error:pending->running:INVALID_TASK_TRANSITION",
    "task-transition-ok:ready"
  ]);
  assert.deepEqual(coreTransitionSamples.map(describeCoreTaskTransitionResult), [
    "core-transition-missing:MISSING",
    "core-transition-invalid:T1:running->ready",
    "core-transition-blocked:T1:A1,S1",
    "core-transition-ok:ready"
  ]);
});

function describeGraphValidationIssue(issue: GraphValidationIssue): string {
  switch (issue.code) {
    case "TASK_KEY_MISMATCH":
      return `key:${issue.taskKey}->${issue.taskId}`;
    case "ROOT_NOT_FOUND":
      return `root-missing:${issue.taskId}`;
    case "DUPLICATE_ROOT":
      return `root-duplicate:${issue.taskId}`;
    case "ROOT_HAS_PARENT":
      return `root-parent:${issue.taskId}->${issue.parentId}`;
    case "ROOT_NOT_EPIC":
      return `root-level:${issue.taskId}->${issue.level}`;
    case "EPIC_NOT_ROOT":
      return `epic-not-root:${issue.taskId}`;
    case "EPIC_WITH_PARENT":
      return `epic-parent:${issue.taskId}->${issue.parentId}`;
    case "NON_ROOT_WITHOUT_PARENT":
      return `non-root-parent:${issue.taskId}->${issue.level}`;
    case "PARENT_NOT_FOUND":
      return `parent-missing:${issue.taskId}->${issue.parentId}`;
    case "INVALID_PARENT_LEVEL":
      return `parent-level:${issue.taskId}(${issue.taskLevel})->${issue.parentId}(${issue.parentLevel})`;
    case "DEPENDENCY_NOT_FOUND":
      return `dependency-missing:${issue.taskId}->${issue.dependsOnTaskId}`;
    case "SELF_DEPENDENCY":
      return `self-dependency:${issue.taskId}`;
    case "DUPLICATE_DEPENDENCY":
      return `dependency-duplicate:${issue.taskId}->${issue.dependsOnTaskId}`;
    case "DEPENDENCY_CYCLE":
      return `dependency-cycle:${issue.taskIds.join(">")}`;
    case "HIERARCHY_CYCLE":
      return `hierarchy-cycle:${issue.taskIds.join(">")}`;
    default:
      return assertNever(issue);
  }
}

function describeTaskTransitionResult(result: TaskTransitionResult): string {
  if (result.ok) {
    return `task-transition-ok:${result.task.status}`;
  }

  const code: "INVALID_TASK_TRANSITION" = result.code;
  return `task-transition-error:${result.from}->${result.to}:${code}`;
}

function describeCoreStateResult(result: CoreStateResult): string {
  if (result.ok) {
    return "state-ok";
  }

  return `state-error:${result.issues[0]?.code ?? "NONE"}`;
}

function describeCoreTaskTransitionResult(result: CoreTaskTransitionResult): string {
  if (result.ok) {
    return `core-transition-ok:${result.task.status}`;
  }

  switch (result.code) {
    case "TASK_NOT_FOUND":
      return `core-transition-missing:${result.taskId}`;
    case "INVALID_TASK_TRANSITION":
      return `core-transition-invalid:${result.taskId}:${result.from}->${result.to}`;
    case "DEPENDENCIES_NOT_COMPLETED":
      return `core-transition-blocked:${result.taskId}:${result.incompleteDependencyIds.join(",")}`;
    default:
      return assertNever(result);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${JSON.stringify(value)}`);
}
