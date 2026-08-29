import { strict as assert } from "node:assert";
import { test } from "node:test";
import { PROTOCOL_VERSION } from "../src/index.js";
import type {
  Actor,
  FlowctlCommand,
  FlowctlEvent,
  GraphMutation,
  GraphMutationOperation,
  Task,
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

function commandType(command: FlowctlCommand): string {
  switch (command.type) {
    case "task.claim":
      assert.equal(command.payload.workerId, "W1");
      return command.type;
    case "task.start":
    case "task.complete":
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
    case "task.completed":
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
          status: "pending",
          dependencies: [],
          acceptanceCriteria: [],
          createdAt: "2026-08-28T00:00:00.000Z",
          updatedAt: "2026-08-28T00:00:00.000Z"
        }
      },
      { type: "dependency.add", taskId: "S1", dependsOnTaskId: "A2" }
    ]
  };
  const command: FlowctlCommand = {
    id: "C1",
    protocolVersion: "0.1",
    timestamp: "2026-08-28T00:00:00.000Z",
    projectId: "P1",
    actor,
    type: "graph.mutation.propose",
    payload: { mutation }
  };
  const proposed: FlowctlEvent = {
    id: "EV1",
    protocolVersion: "0.1",
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

  assert.equal(PROTOCOL_VERSION, "0.1");
  assert.equal(commandType(command), "graph.mutation.propose");
  assert.equal(eventType(proposed), "graph.mutation.proposed");
  assert.equal(eventType(approved), "graph.mutation.approved");
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
