import { strict as assert } from "node:assert";
import { test } from "node:test";
import { PROTOCOL_VERSION } from "../src/index.js";
import type {
  Actor,
  FlowctlCommand,
  FlowctlEvent,
  GraphMutation,
  GraphMutationOperation,
  Lease,
  Project,
  Task,
  TaskCreationInput,
  TaskGraph,
  TaskUpdatePatch,
  Worker
} from "../src/index.js";

const epic: Task = {
  id: "E1",
  level: "epic",
  title: "Authentication",
  status: "pending",
  dependencies: [],
  acceptanceCriteria: [],
  createdAt: "2026-08-28T00:00:00.000Z",
  updatedAt: "2026-08-28T00:00:00.000Z"
};

const actor: Actor = { type: "worker", id: "W1" };

test("exports the complete public protocol surface", () => {
  const project = {} as Project;
  const task = {} as Task;
  const graph = {} as TaskGraph;
  const worker = {} as Worker;
  const lease = {} as Lease;
  const mutation = {} as GraphMutation;
  const command = {} as FlowctlCommand;
  const event = {} as FlowctlEvent;

  assert.equal(PROTOCOL_VERSION, "0.2");
  assert.ok(project && task && graph && worker && lease && mutation && command && event);
});

function commandType(command: FlowctlCommand): string {
  switch (command.type) {
    case "task.claim":
      assert.equal(command.payload.workerId, "W1");
      return command.type;
    case "task.start":
    case "task.complete":
    case "task.review.approve":
    case "task.fail":
    case "task.block":
    case "lease.heartbeat":
    case "graph.mutation.propose":
      return command.type;
  }
}

function eventType(event: FlowctlEvent): string {
  switch (event.type) {
    case "task.created":
    case "task.ready":
    case "task.claimed":
    case "task.started":
    case "task.review_requested":
    case "task.failed":
    case "task.blocked":
    case "task.cancelled":
    case "lease.created":
    case "lease.expired":
    case "worker.connected":
    case "worker.disconnected":
    case "graph.mutation.proposed":
    case "graph.mutation.approved":
    case "graph.mutation.rejected":
      return event.type;
    case "task.completed":
      assert.equal(typeof event.payload.taskId, "string");
      return event.type;
  }
}

test("represents the four-level task hierarchy and cross-branch dependencies", () => {
  const backend: Task = { ...epic, id: "T1", parentId: epic.id, level: "task", title: "Backend" };
  const login: Task = { ...epic, id: "S1", parentId: backend.id, level: "subtask", title: "Login" };
  const signToken: Task = { ...epic, id: "A1", parentId: login.id, level: "atomic", title: "Sign token" };
  const frontend: Task = { ...epic, id: "T2", parentId: epic.id, level: "task", title: "Frontend" };
  const authContext: Task = {
    ...epic,
    id: "S2",
    parentId: frontend.id,
    level: "subtask",
    title: "Auth context",
    dependencies: [login.id]
  };

  const graph: TaskGraph = {
    projectId: "P1",
    rootTaskIds: [epic.id],
    tasks: Object.fromEntries([epic, backend, login, signToken, frontend, authContext].map((task) => [task.id, task]))
  };

  assert.equal(graph.tasks[authContext.id]?.dependencies[0], login.id);
  assert.equal(graph.tasks[signToken.id]?.parentId, login.id);
  assert.deepEqual(Object.keys(graph.tasks), ["E1", "T1", "S1", "A1", "T2", "S2"]);
});

test("uses one Worker contract for different providers", () => {
  const workers: Worker[] = [
    { id: "W1", provider: "codex", status: "idle" },
    { id: "W2", provider: "claude", status: "busy", currentTaskId: "T1" },
    { id: "W3", provider: "opencode", status: "offline" }
  ];

  assert.deepEqual(workers.map(({ provider }) => provider), ["codex", "claude", "opencode"]);
});

test("commands and events narrow by their discriminant", () => {
  const mutation: GraphMutation = {
    id: "M1",
    sourceTaskId: "S1",
    reason: "The implementation needs a migration first.",
    operations: [
      {
        type: "task.create",
        task: {
          id: "A2",
          parentId: "S1",
          level: "atomic",
          title: "Create migration",
          acceptanceCriteria: [],
          description: "Prepare the database migration."
        }
      },
      { type: "dependency.add", taskId: "S1", dependsOnTaskId: "A2" }
    ]
  };
  const command: FlowctlCommand = {
    id: "C1",
    protocolVersion: "0.2",
    timestamp: "2026-08-28T00:00:00.000Z",
    projectId: "P1",
    actor,
    type: "graph.mutation.propose",
    payload: { mutation }
  };
  const proposed: FlowctlEvent = {
    id: "EV1",
    protocolVersion: "0.2",
    timestamp: "2026-08-28T00:00:00.000Z",
    projectId: "P1",
    actor: { type: "system", id: "core" },
    type: "graph.mutation.proposed",
    payload: { mutation }
  };
  const approved: FlowctlEvent = {
    ...proposed,
    id: "EV2",
    type: "graph.mutation.approved",
    payload: { mutation }
  };
  const approval: FlowctlCommand = {
    id: "C-REVIEW-1",
    protocolVersion: "0.2",
    timestamp: "2026-09-05T00:00:00.000Z",
    projectId: "P1",
    actor,
    type: "task.review.approve",
    payload: { taskId: "A" }
  };
  const completed: FlowctlEvent = {
    id: "EV-COMPLETED-1",
    protocolVersion: "0.2",
    timestamp: "2026-09-05T00:00:00.000Z",
    projectId: "P1",
    actor,
    type: "task.completed",
    payload: { taskId: "A" }
  };

  const legacyCompleted: FlowctlEvent = {
    ...completed,
    // @ts-expect-error v0.2 does not accept execution metadata on completed.
    payload: { taskId: "A", workerId: "W1", leaseId: "L1" }
  };

  void legacyCompleted;
  assert.equal(PROTOCOL_VERSION, "0.2");
  assert.equal(commandType(command), "graph.mutation.propose");
  assert.equal(commandType(approval), "task.review.approve");
  assert.equal(eventType(proposed), "graph.mutation.proposed");
  assert.equal(eventType(approved), "graph.mutation.approved");
  assert.equal(eventType(completed), "task.completed");
});

test("represents all mutation operations and the limited update patch", () => {
  const operations: GraphMutationOperation[] = [
    { type: "task.create", task: {} as never },
    { type: "dependency.add", taskId: "T2", dependsOnTaskId: "T1" },
    { type: "dependency.remove", taskId: "T2", dependsOnTaskId: "T1" },
    { type: "task.update", taskId: "T2", changes: { title: "Updated" } }
  ];
  // @ts-expect-error Core-controlled status cannot be a mutation patch.
  const statusChange: TaskUpdatePatch = { status: "completed" };
  // @ts-expect-error Dependencies can change only through dedicated operations.
  const dependencyChange: TaskUpdatePatch = { dependencies: ["T1"] };
  // @ts-expect-error Core-controlled worker assignment cannot be a mutation patch.
  const assignmentChange: TaskUpdatePatch = { assignedWorkerId: "W1" };
  // @ts-expect-error Core-controlled timestamps cannot be mutation patches.
  const timestampChange: TaskUpdatePatch = { createdAt: "2026-08-28T00:00:00.000Z", updatedAt: "2026-08-28T00:00:00.000Z" };
  // @ts-expect-error Lease fields cannot be mutation patches.
  const leaseChange: TaskUpdatePatch = { leaseId: "L1" };

  void statusChange;
  void dependencyChange;
  void assignmentChange;
  void timestampChange;
  void leaseChange;
  assert.deepEqual(operations.map(({ type }) => type), [
    "task.create",
    "dependency.add",
    "dependency.remove",
    "task.update"
  ]);
});

test("restricts task creation to planner-owned fields", () => {
  const creationInput: TaskCreationInput = {
    id: "A3",
    parentId: "S1",
    level: "atomic",
    title: "Create migration",
    description: "Prepare the database migration.",
    acceptanceCriteria: []
  };
  const operation: GraphMutationOperation = { type: "task.create", task: creationInput };

  // @ts-expect-error Task status is controlled by the Core.
  const status: TaskCreationInput = { ...creationInput, status: "pending" };
  // @ts-expect-error Dependencies are controlled by dedicated mutation operations.
  const dependencies: TaskCreationInput = { ...creationInput, dependencies: [] };
  // @ts-expect-error Worker assignment is controlled by the scheduler/lease layer.
  const assignedWorkerId: TaskCreationInput = { ...creationInput, assignedWorkerId: "W1" };
  // @ts-expect-error Timestamps are controlled by the Core.
  const timestamps: TaskCreationInput = { ...creationInput, createdAt: "2026-08-29T13:42:18.321Z" };
  // @ts-expect-error Timestamps are controlled by the Core.
  const updatedAt: TaskCreationInput = { ...creationInput, updatedAt: "2026-08-29T13:42:18.321Z" };
  // @ts-expect-error Lease information is not part of task creation input.
  const leaseId: TaskCreationInput = { ...creationInput, leaseId: "L1" };

  assert.equal(operation.task.title, "Create migration");
  void status;
  void dependencies;
  void assignedWorkerId;
  void timestamps;
  void updatedAt;
  void leaseId;
});
