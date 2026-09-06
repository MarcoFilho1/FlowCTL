import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as ControlPlane from "../src/index.js";
import type {
  Actor,
  FlowctlCommand,
  FlowctlEvent,
  Task,
  TaskGraph,
  TaskLevel
} from "@flowctl/protocol";

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
  let leaseIdCounter = 0;
  let eventIdCounter = 0;

  return {
    now: () => TIMESTAMP,
    nextLeaseId: () => `L${++leaseIdCounter}`,
    nextEventId: () => `E${++eventIdCounter}`,
    leaseExpiresAt: () => "2026-08-30T01:00:00.000Z"
  };
}

function makeActor(overrides: Partial<Actor> = {}): Actor {
  return {
    type: "worker",
    id: "W1",
    ...overrides
  };
}

function makeClaimCommand(
  overrides: {
    id?: string;
    projectId?: string;
    taskId?: string;
    workerId?: string;
    actor?: Actor;
  } = {}
): FlowctlCommand {
  const actor = overrides.actor ?? makeActor();

  return {
    id: overrides.id ?? "C1",
    protocolVersion: "0.2",
    timestamp: TIMESTAMP,
    projectId: overrides.projectId ?? "P1",
    actor,
    type: "task.claim",
    payload: {
      taskId: overrides.taskId ?? "A",
      workerId: overrides.workerId ?? actor.id
    }
  };
}

function makeStartCommand(
  overrides: {
    id?: string;
    projectId?: string;
    taskId?: string;
    workerId?: string;
    leaseId?: string;
    actor?: Actor;
  } = {}
): Extract<FlowctlCommand, { type: "task.start" }> {
  const actor = overrides.actor ?? makeActor();

  return {
    id: overrides.id ?? "S1",
    protocolVersion: "0.2",
    timestamp: TIMESTAMP,
    projectId: overrides.projectId ?? "P1",
    actor,
    type: "task.start",
    payload: {
      taskId: overrides.taskId ?? "A",
      workerId: overrides.workerId ?? actor.id,
      leaseId: overrides.leaseId ?? "L1"
    }
  };
}

function makeCompleteCommand(
  overrides: {
    id?: string;
    projectId?: string;
    taskId?: string;
    workerId?: string;
    leaseId?: string;
    actor?: Actor;
  } = {}
): Extract<FlowctlCommand, { type: "task.complete" }> {
  const actor = overrides.actor ?? makeActor();

  return {
    id: overrides.id ?? "CO1",
    protocolVersion: "0.2",
    timestamp: TIMESTAMP,
    projectId: overrides.projectId ?? "P1",
    actor,
    type: "task.complete",
    payload: {
      taskId: overrides.taskId ?? "A",
      workerId: overrides.workerId ?? actor.id,
      leaseId: overrides.leaseId ?? "L1"
    }
  };
}

function makeReviewApprovalCommand(
  overrides: { id?: string; projectId?: string; taskId?: string; actor?: Actor } = {}
): Extract<FlowctlCommand, { type: "task.review.approve" }> {
  return {
    id: overrides.id ?? "RA1",
    protocolVersion: "0.2",
    timestamp: TIMESTAMP,
    projectId: overrides.projectId ?? "P1",
    actor: overrides.actor ?? makeActor({ type: "user", id: "reviewer" }),
    type: "task.review.approve",
    payload: { taskId: overrides.taskId ?? "A" }
  };
}

function makeFailCommand(
  projectId = "P1"
): Extract<FlowctlCommand, { type: "task.fail" }> {
  return {
    id: "F1",
    protocolVersion: "0.2",
    timestamp: TIMESTAMP,
    projectId,
    actor: makeActor(),
    type: "task.fail",
    payload: {
      taskId: "A",
      workerId: "W1",
      leaseId: "L1",
      reason: "failure"
    }
  };
}

function makeBlockCommand(
  projectId = "P1"
): Extract<FlowctlCommand, { type: "task.block" }> {
  return {
    id: "B1",
    protocolVersion: "0.2",
    timestamp: TIMESTAMP,
    projectId,
    actor: makeActor(),
    type: "task.block",
    payload: {
      taskId: "A",
      workerId: "W1",
      leaseId: "L1",
      reason: "blocked"
    }
  };
}

function makeHeartbeatCommand(
  projectId = "P1"
): Extract<FlowctlCommand, { type: "lease.heartbeat" }> {
  return {
    id: "H1",
    protocolVersion: "0.2",
    timestamp: TIMESTAMP,
    projectId,
    actor: makeActor(),
    type: "lease.heartbeat",
    payload: {
      taskId: "A",
      workerId: "W1",
      leaseId: "L1"
    }
  };
}

function makeGraphMutationCommand(
  projectId = "P1"
): Extract<FlowctlCommand, { type: "graph.mutation.propose" }> {
  return {
    id: "GM1",
    protocolVersion: "0.2",
    timestamp: TIMESTAMP,
    projectId,
    actor: makeActor({ type: "user", id: "U1" }),
    type: "graph.mutation.propose",
    payload: {
      mutation: {
        id: "M1",
        reason: "future graph change",
        operations: []
      }
    }
  };
}

function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}

function assertCommandPayloadNarrowing(command: FlowctlCommand): void {
  switch (command.type) {
    case "task.claim":
      assert.equal(typeof command.payload.taskId, "string");
      assert.equal(typeof command.payload.workerId, "string");
      return;
    case "task.start":
    case "task.complete":
      assert.equal(typeof command.payload.taskId, "string");
      assert.equal(typeof command.payload.workerId, "string");
      assert.equal(typeof command.payload.leaseId, "string");
      return;
    case "task.review.approve":
      assert.equal(typeof command.payload.taskId, "string");
      return;
    case "task.fail":
    case "task.block":
      assert.equal(typeof command.payload.taskId, "string");
      assert.equal(typeof command.payload.workerId, "string");
      assert.equal(typeof command.payload.leaseId, "string");
      assert.equal(typeof command.payload.reason, "string");
      return;
    case "lease.heartbeat":
      assert.equal(typeof command.payload.taskId, "string");
      assert.equal(typeof command.payload.workerId, "string");
      assert.equal(typeof command.payload.leaseId, "string");
      return;
    case "graph.mutation.propose":
      assert.equal(typeof command.payload.mutation.id, "string");
      return;
    default:
      assertNever(command);
  }
}

function assertCommandProcessingResultFields(
  result: ControlPlane.CommandProcessingResult
): void {
  if (result.ok) {
    for (const event of result.events) {
      assertEventPayloadNarrowing(event);
    }
    return;
  }

  switch (result.code) {
    case "UNSUPPORTED_COMMAND":
      assert.equal(typeof result.commandId, "string");
      assert.equal(typeof result.commandType, "string");
      return;
    case "PROJECT_MISMATCH":
      assert.equal(typeof result.commandId, "string");
      assert.equal(typeof result.commandProjectId, "string");
      assert.equal(typeof result.controlPlaneProjectId, "string");
      return;
    case "TASK_NOT_FOUND":
    case "TASK_NOT_READY":
    case "TASK_ALREADY_LEASED":
      assert.equal(typeof result.commandId, "string");
      assert.equal(typeof result.taskId, "string");
      return;
    case "LEASE_NOT_FOUND":
      assert.equal(typeof result.commandId, "string");
      assert.equal(typeof result.leaseId, "string");
      return;
    case "LEASE_MISMATCH":
      assert.equal(typeof result.commandId, "string");
      assert.equal(typeof result.taskId, "string");
      assert.equal(typeof result.leaseId, "string");
      assert.equal(typeof result.workerId, "string");
      return;
    case "INVALID_TASK_TRANSITION":
      assert.equal(typeof result.commandId, "string");
      assert.equal(typeof result.taskId, "string");
      assert.equal(typeof result.from, "string");
      assert.equal(typeof result.to, "string");
      return;
    default:
      assertNever(result);
  }
}

function assertEventPayloadNarrowing(event: FlowctlEvent): void {
  switch (event.type) {
    case "task.created":
      assert.equal(typeof event.payload.task.id, "string");
      return;
    case "task.ready":
      assert.equal(typeof event.payload.taskId, "string");
      return;
    case "task.claimed":
    case "task.started":
    case "task.review_requested":
      assert.equal(typeof event.payload.taskId, "string");
      assert.equal(typeof event.payload.workerId, "string");
      assert.equal(typeof event.payload.leaseId, "string");
      return;
    case "task.completed":
      assert.equal(typeof event.payload.taskId, "string");
      return;
    case "task.failed":
    case "task.blocked":
      assert.equal(typeof event.payload.taskId, "string");
      assert.equal(typeof event.payload.workerId, "string");
      assert.equal(typeof event.payload.leaseId, "string");
      assert.equal(typeof event.payload.reason, "string");
      return;
    case "task.cancelled":
      assert.equal(typeof event.payload.taskId, "string");
      return;
    case "lease.created":
      assert.equal(typeof event.payload.lease.id, "string");
      return;
    case "lease.expired":
      assert.equal(typeof event.payload.leaseId, "string");
      assert.equal(typeof event.payload.taskId, "string");
      assert.equal(typeof event.payload.workerId, "string");
      return;
    case "worker.connected":
      assert.equal(typeof event.payload.worker.id, "string");
      return;
    case "worker.disconnected":
      assert.equal(typeof event.payload.workerId, "string");
      return;
    case "graph.mutation.proposed":
    case "graph.mutation.approved":
      assert.equal(typeof event.payload.mutation.id, "string");
      return;
    case "graph.mutation.rejected":
      assert.equal(typeof event.payload.mutationId, "string");
      assert.equal(typeof event.payload.reason, "string");
      return;
    default:
      assertNever(event);
  }
}

function makeReadyControlPlane(
  options: ControlPlane.ControlPlaneOptions = makeOptions()
): { controlPlane: ControlPlane.ControlPlane } {
  const result = ControlPlane.createControlPlane(makeMilestoneGraph(), options);
  assert.equal(result.ok, true);
  if (!result.ok) {
    throw new Error("Expected a valid control plane fixture.");
  }

  return { controlPlane: result.controlPlane };
}

function makeClaimedControlPlane(): {
  controlPlane: ControlPlane.ControlPlane;
  leaseId: string;
} {
  const { controlPlane } = makeReadyControlPlane();
  const claim = ControlPlane.dispatchCommand(controlPlane, makeClaimCommand());
  assert.equal(claim.ok, true);
  if (!claim.ok || claim.events[0]?.type !== "lease.created") {
    throw new Error("Expected a claimed control plane fixture.");
  }

  return {
    controlPlane,
    leaseId: claim.events[0].payload.lease.id
  };
}

function makeRunningControlPlane(): {
  controlPlane: ControlPlane.ControlPlane;
  leaseId: string;
} {
  const claimed = makeClaimedControlPlane();
  const started = ControlPlane.dispatchCommand(
    claimed.controlPlane,
    makeStartCommand({ leaseId: claimed.leaseId })
  );
  assert.equal(started.ok, true);

  return claimed;
}

function getLeaseId(
  result: ControlPlane.CommandProcessingResult
): string {
  assert.equal(result.ok, true);
  if (!result.ok || result.events[0]?.type !== "lease.created") {
    throw new Error("Expected a successful claim with a created Lease.");
  }

  return result.events[0].payload.lease.id;
}

function getCompletionOrReadyEventTuple(event: FlowctlEvent): readonly [string, string] {
  if (event.type !== "task.completed" && event.type !== "task.ready") {
    throw new Error(`Expected a completion or readiness Event, received ${event.type}.`);
  }

  return [event.type, event.payload.taskId];
}

const unsupportedCommands: readonly FlowctlCommand[] = [
  makeFailCommand(),
  makeBlockCommand(),
  makeHeartbeatCommand(),
  makeGraphMutationCommand()
];

for (const command of unsupportedCommands) {
  test(`rejects ${command.type} as unsupported without mutation`, () => {
    assertCommandPayloadNarrowing(command);
    const { controlPlane } = makeReadyControlPlane();
    const beforeGraph = ControlPlane.getTaskGraphSnapshot(controlPlane);
    const beforeLog = ControlPlane.getEventLogSnapshot(controlPlane);
    const result = ControlPlane.dispatchCommand(controlPlane, command);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "UNSUPPORTED_COMMAND");
      assert.equal(result.commandId, command.id);
      assert.equal(result.commandType, command.type);
    }
    assertCommandProcessingResultFields(result);
    assert.deepEqual(ControlPlane.getTaskGraphSnapshot(controlPlane), beforeGraph);
    assert.deepEqual(ControlPlane.getEventLogSnapshot(controlPlane), beforeLog);
  });
}

const foreignUnsupportedCommands: readonly FlowctlCommand[] = [
  makeReviewApprovalCommand({ projectId: "OTHER" }),
  makeFailCommand("OTHER"),
  makeBlockCommand("OTHER"),
  makeHeartbeatCommand("OTHER"),
  makeGraphMutationCommand("OTHER")
];

for (const command of foreignUnsupportedCommands) {
  test(`rejects foreign ${command.type} before support detection`, () => {
    assertCommandPayloadNarrowing(command);
    const { controlPlane } = makeReadyControlPlane();
    const beforeGraph = ControlPlane.getTaskGraphSnapshot(controlPlane);
    const beforeLog = ControlPlane.getEventLogSnapshot(controlPlane);
    const result = ControlPlane.dispatchCommand(controlPlane, command);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "PROJECT_MISMATCH");
      assert.equal(result.commandId, command.id);
      assert.equal(result.commandProjectId, "OTHER");
      assert.equal(result.controlPlaneProjectId, "P1");
    }
    assertCommandProcessingResultFields(result);
    assert.deepEqual(ControlPlane.getTaskGraphSnapshot(controlPlane), beforeGraph);
    assert.deepEqual(ControlPlane.getEventLogSnapshot(controlPlane), beforeLog);
  });
}

test("project mismatch precedes unsupported-command detection", () => {
  const { controlPlane } = makeReadyControlPlane();
  const result = ControlPlane.dispatchCommand(
    controlPlane,
    makeGraphMutationCommand("OTHER")
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "PROJECT_MISMATCH");
    assert.equal(result.commandId, "GM1");
    assert.equal(result.commandProjectId, "OTHER");
    assert.equal(result.controlPlaneProjectId, "P1");
  }
  assertCommandProcessingResultFields(result);
});

test("a supported-project unsupported command returns UNSUPPORTED_COMMAND", () => {
  const { controlPlane } = makeReadyControlPlane();
  const result = ControlPlane.dispatchCommand(
    controlPlane,
    makeGraphMutationCommand()
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "UNSUPPORTED_COMMAND");
    assert.equal(result.commandId, "GM1");
    assert.equal(result.commandType, "graph.mutation.propose");
  }
  assertCommandProcessingResultFields(result);
});

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

test("claims ready A with one active Lease and ordered Events", () => {
  const result = ControlPlane.createControlPlane(makeMilestoneGraph(), makeOptions());
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const command = makeClaimCommand({ actor: { type: "worker", id: "W1" } });
  const dispatch = ControlPlane.dispatchCommand(result.controlPlane, command);

  assert.equal(dispatch.ok, true);
  if (!dispatch.ok) return;
  assert.deepEqual(
    dispatch.events.map((event) => event.type),
    ["lease.created", "task.claimed"]
  );
  if (dispatch.events[0]?.type === "lease.created" && dispatch.events[1]?.type === "task.claimed") {
    assert.equal(dispatch.events[0].payload.lease.id, "L1");
    assert.equal(dispatch.events[1].payload.leaseId, dispatch.events[0].payload.lease.id);
  }
  assert.equal(ControlPlane.getTaskGraphSnapshot(result.controlPlane).tasks.A?.status, "claimed");
});

test("rejects claims for missing tasks without mutating state", () => {
  const { controlPlane } = makeReadyControlPlane();
  const beforeGraph = ControlPlane.getTaskGraphSnapshot(controlPlane);
  const beforeLog = ControlPlane.getEventLogSnapshot(controlPlane);

  const result = ControlPlane.dispatchCommand(
    controlPlane,
    makeClaimCommand({ taskId: "MISSING" })
  );

  assert.deepEqual(result, {
    ok: false,
    code: "TASK_NOT_FOUND",
    commandId: "C1",
    taskId: "MISSING"
  });
  assert.deepEqual(ControlPlane.getTaskGraphSnapshot(controlPlane), beforeGraph);
  assert.deepEqual(ControlPlane.getEventLogSnapshot(controlPlane), beforeLog);
});

test("rejects claims for pending tasks without mutating state", () => {
  const { controlPlane } = makeReadyControlPlane();
  const beforeGraph = ControlPlane.getTaskGraphSnapshot(controlPlane);
  const beforeLog = ControlPlane.getEventLogSnapshot(controlPlane);

  const result = ControlPlane.dispatchCommand(controlPlane, makeClaimCommand({ taskId: "B" }));

  assert.deepEqual(result, {
    ok: false,
    code: "TASK_NOT_READY",
    commandId: "C1",
    taskId: "B"
  });
  assert.deepEqual(ControlPlane.getTaskGraphSnapshot(controlPlane), beforeGraph);
  assert.deepEqual(ControlPlane.getEventLogSnapshot(controlPlane), beforeLog);
});

test("rejects a second claim as TASK_ALREADY_LEASED before task status checks", () => {
  const { controlPlane } = makeReadyControlPlane();
  const accepted = ControlPlane.dispatchCommand(controlPlane, makeClaimCommand());
  assert.equal(accepted.ok, true);
  if (!accepted.ok) return;

  const beforeGraph = ControlPlane.getTaskGraphSnapshot(controlPlane);
  const beforeLog = ControlPlane.getEventLogSnapshot(controlPlane);
  const second = ControlPlane.dispatchCommand(
    controlPlane,
    makeClaimCommand({ id: "C2", actor: { type: "worker", id: "W2" }, workerId: "W2" })
  );

  assert.deepEqual(second, {
    ok: false,
    code: "TASK_ALREADY_LEASED",
    commandId: "C2",
    taskId: "A"
  });
  assert.deepEqual(ControlPlane.getTaskGraphSnapshot(controlPlane), beforeGraph);
  assert.deepEqual(ControlPlane.getEventLogSnapshot(controlPlane), beforeLog);
});

test("rejects claims from a foreign project before task lookup", () => {
  const { controlPlane } = makeReadyControlPlane();
  const beforeGraph = ControlPlane.getTaskGraphSnapshot(controlPlane);
  const beforeLog = ControlPlane.getEventLogSnapshot(controlPlane);

  const result = ControlPlane.dispatchCommand(
    controlPlane,
    makeClaimCommand({ projectId: "P2", taskId: "MISSING" })
  );

  assert.deepEqual(result, {
    ok: false,
    code: "PROJECT_MISMATCH",
    commandId: "C1",
    commandProjectId: "P2",
    controlPlaneProjectId: "P1"
  });
  assert.deepEqual(ControlPlane.getTaskGraphSnapshot(controlPlane), beforeGraph);
  assert.deepEqual(ControlPlane.getEventLogSnapshot(controlPlane), beforeLog);
});

for (const taskId of ["toString", "constructor", "__proto__"]) {
  test(`does not resolve inherited task key ${taskId}`, () => {
    const { controlPlane } = makeReadyControlPlane();
    const beforeGraph = ControlPlane.getTaskGraphSnapshot(controlPlane);
    const beforeLog = ControlPlane.getEventLogSnapshot(controlPlane);
    const result = ControlPlane.dispatchCommand(controlPlane, makeClaimCommand({ taskId }));

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "TASK_NOT_FOUND");
    assert.deepEqual(ControlPlane.getTaskGraphSnapshot(controlPlane), beforeGraph);
    assert.deepEqual(ControlPlane.getEventLogSnapshot(controlPlane), beforeLog);
  });
}

test("keeps state unchanged when now throws during claim dispatch", () => {
  const { controlPlane } = makeReadyControlPlane({
    ...makeOptions(),
    now: () => {
      throw new Error("now failed");
    }
  });
  const beforeGraph = ControlPlane.getTaskGraphSnapshot(controlPlane);
  const beforeLog = ControlPlane.getEventLogSnapshot(controlPlane);

  assert.throws(
    () => ControlPlane.dispatchCommand(controlPlane, makeClaimCommand()),
    /now failed/
  );
  assert.deepEqual(ControlPlane.getTaskGraphSnapshot(controlPlane), beforeGraph);
  assert.deepEqual(ControlPlane.getEventLogSnapshot(controlPlane), beforeLog);
});

test("keeps state unchanged when nextLeaseId throws during claim dispatch", () => {
  const { controlPlane } = makeReadyControlPlane({
    ...makeOptions(),
    nextLeaseId: () => {
      throw new Error("lease id failed");
    }
  });
  const beforeGraph = ControlPlane.getTaskGraphSnapshot(controlPlane);
  const beforeLog = ControlPlane.getEventLogSnapshot(controlPlane);

  assert.throws(
    () => ControlPlane.dispatchCommand(controlPlane, makeClaimCommand()),
    /lease id failed/
  );
  assert.deepEqual(ControlPlane.getTaskGraphSnapshot(controlPlane), beforeGraph);
  assert.deepEqual(ControlPlane.getEventLogSnapshot(controlPlane), beforeLog);
});

test("keeps state unchanged when leaseExpiresAt throws during claim dispatch", () => {
  const { controlPlane } = makeReadyControlPlane({
    ...makeOptions(),
    leaseExpiresAt: () => {
      throw new Error("lease expiry failed");
    }
  });
  const beforeGraph = ControlPlane.getTaskGraphSnapshot(controlPlane);
  const beforeLog = ControlPlane.getEventLogSnapshot(controlPlane);

  assert.throws(
    () => ControlPlane.dispatchCommand(controlPlane, makeClaimCommand()),
    /lease expiry failed/
  );
  assert.deepEqual(ControlPlane.getTaskGraphSnapshot(controlPlane), beforeGraph);
  assert.deepEqual(ControlPlane.getEventLogSnapshot(controlPlane), beforeLog);
});

test("keeps state unchanged when the second nextEventId throws during claim dispatch", () => {
  let eventIdCounter = 0;
  const { controlPlane } = makeReadyControlPlane({
    ...makeOptions(),
    nextEventId: () => {
      eventIdCounter += 1;
      if (eventIdCounter === 2) {
        throw new Error("event id failed");
      }

      return `E${eventIdCounter}`;
    }
  });
  const beforeGraph = ControlPlane.getTaskGraphSnapshot(controlPlane);
  const beforeLog = ControlPlane.getEventLogSnapshot(controlPlane);

  assert.throws(
    () => ControlPlane.dispatchCommand(controlPlane, makeClaimCommand()),
    /event id failed/
  );
  assert.deepEqual(ControlPlane.getTaskGraphSnapshot(controlPlane), beforeGraph);
  assert.deepEqual(ControlPlane.getEventLogSnapshot(controlPlane), beforeLog);
});

test("copies command input and returned Events independently from stored history", () => {
  const { controlPlane } = makeReadyControlPlane();
  const command = makeClaimCommand({ actor: { type: "worker", id: "W1" } });
  const result = ControlPlane.dispatchCommand(controlPlane, command);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  command.actor.id = "MUTATED";
  if (result.events[1] !== undefined) {
    result.events[1].actor.id = "RESULT_MUTATED";
  }

  const history = ControlPlane.getEventLogSnapshot(controlPlane);
  if (result.events[0]?.type === "lease.created") {
    result.events[0].payload.lease.workerId = "RESULT_LEASE_MUTATED";
  }
  assert.equal(history[1]?.actor.id, "W1");
  const snapshot = ControlPlane.getEventLogSnapshot(controlPlane);
  if (snapshot[0]?.type === "lease.created") {
    snapshot[0].payload.lease.workerId = "SNAPSHOT_LEASE_MUTATED";
  }
  assert.equal(history[0]?.type, "lease.created");
  if (history[0]?.type === "lease.created") {
    assert.equal(history[0].payload.lease.workerId, "W1");
  }
  const freshSnapshot = ControlPlane.getEventLogSnapshot(controlPlane);
  if (freshSnapshot[0]?.type === "lease.created") {
    assert.equal(freshSnapshot[0].payload.lease.workerId, "W1");
  }
});

test("starts only with the active Lease and emits task.started", () => {
  const { controlPlane, leaseId } = makeClaimedControlPlane();
  const command = makeStartCommand({ leaseId });
  const result = ControlPlane.dispatchCommand(controlPlane, command);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.events.map((event) => event.type), ["task.started"]);
  if (result.events[0]?.type === "task.started") {
    assert.deepEqual(result.events[0].payload, {
      taskId: "A",
      workerId: "W1",
      leaseId
    });
    assert.deepEqual(result.events[0].actor, command.actor);
    assert.equal(result.events[0].projectId, "P1");
    assert.equal(result.events[0].protocolVersion, "0.2");
    assert.equal(result.events[0].timestamp, TIMESTAMP);
  }
  assert.equal(ControlPlane.getTaskGraphSnapshot(controlPlane).tasks.A?.status, "running");
});

test("rejects start without an active Lease even when assignedWorkerId matches", () => {
  const graph = makeMilestoneGraph();
  graph.tasks.A.status = "claimed";
  graph.tasks.A.assignedWorkerId = "W1";
  const created = ControlPlane.createControlPlane(graph, makeOptions());
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const beforeGraph = ControlPlane.getTaskGraphSnapshot(created.controlPlane);
  const beforeLog = ControlPlane.getEventLogSnapshot(created.controlPlane);
  const result = ControlPlane.dispatchCommand(
    created.controlPlane,
    makeStartCommand({ leaseId: "L1" })
  );

  assert.deepEqual(result, {
    ok: false,
    code: "LEASE_NOT_FOUND",
    commandId: "S1",
    leaseId: "L1"
  });
  assert.deepEqual(ControlPlane.getTaskGraphSnapshot(created.controlPlane), beforeGraph);
  assert.deepEqual(ControlPlane.getEventLogSnapshot(created.controlPlane), beforeLog);
});

test("rejects start with a wrong Lease ID without mutating graph or Event Log", () => {
  const { controlPlane } = makeClaimedControlPlane();
  const beforeGraph = ControlPlane.getTaskGraphSnapshot(controlPlane);
  const beforeLog = ControlPlane.getEventLogSnapshot(controlPlane);
  const result = ControlPlane.dispatchCommand(
    controlPlane,
    makeStartCommand({ id: "S2", leaseId: "WRONG" })
  );

  assert.deepEqual(result, {
    ok: false,
    code: "LEASE_MISMATCH",
    commandId: "S2",
    taskId: "A",
    leaseId: "WRONG",
    workerId: "W1"
  });
  assert.deepEqual(ControlPlane.getTaskGraphSnapshot(controlPlane), beforeGraph);
  assert.deepEqual(ControlPlane.getEventLogSnapshot(controlPlane), beforeLog);
});

test("rejects start with a wrong Worker ID without mutating graph or Event Log", () => {
  const { controlPlane, leaseId } = makeClaimedControlPlane();
  const beforeGraph = ControlPlane.getTaskGraphSnapshot(controlPlane);
  const beforeLog = ControlPlane.getEventLogSnapshot(controlPlane);
  const result = ControlPlane.dispatchCommand(
    controlPlane,
    makeStartCommand({ id: "S2", leaseId, workerId: "W2" })
  );

  assert.deepEqual(result, {
    ok: false,
    code: "LEASE_MISMATCH",
    commandId: "S2",
    taskId: "A",
    leaseId,
    workerId: "W2"
  });
  assert.deepEqual(ControlPlane.getTaskGraphSnapshot(controlPlane), beforeGraph);
  assert.deepEqual(ControlPlane.getEventLogSnapshot(controlPlane), beforeLog);
});

test("rejects a lifecycle-invalid start without mutating graph or Event Log", () => {
  const { controlPlane, leaseId } = makeClaimedControlPlane();
  const accepted = ControlPlane.dispatchCommand(
    controlPlane,
    makeStartCommand({ leaseId })
  );
  assert.equal(accepted.ok, true);

  const beforeGraph = ControlPlane.getTaskGraphSnapshot(controlPlane);
  const beforeLog = ControlPlane.getEventLogSnapshot(controlPlane);
  const result = ControlPlane.dispatchCommand(
    controlPlane,
    makeStartCommand({ id: "S2", leaseId })
  );

  assert.deepEqual(result, {
    ok: false,
    code: "INVALID_TASK_TRANSITION",
    commandId: "S2",
    taskId: "A",
    from: "running",
    to: "running"
  });
  assert.deepEqual(ControlPlane.getTaskGraphSnapshot(controlPlane), beforeGraph);
  assert.deepEqual(ControlPlane.getEventLogSnapshot(controlPlane), beforeLog);
});

test("completes implementation into review and removes the active Lease", () => {
  const { controlPlane, leaseId } = makeRunningControlPlane();
  const result = ControlPlane.dispatchCommand(
    controlPlane,
    makeCompleteCommand({ leaseId, workerId: "W1" })
  );

  assert.deepEqual(
    result.ok && result.events.map((event) => event.type),
    ["task.review_requested"]
  );
  assert.equal(ControlPlane.getTaskGraphSnapshot(controlPlane).tasks.A?.status, "review");
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(ControlPlane.getTaskGraphSnapshot(controlPlane).tasks).map(
        ([id, task]) => [id, task.status]
      )
    ),
    { A: "review", B: "pending", C: "pending", D: "pending" }
  );

  const history = ControlPlane.getEventLogSnapshot(controlPlane);
  assert.deepEqual(history.map((event) => event.type), [
    "lease.created",
    "task.claimed",
    "task.started",
    "task.review_requested"
  ]);
  assert.equal(history.some((event) => event.type === "task.completed"), false);

  const claimAgain = ControlPlane.dispatchCommand(
    controlPlane,
    makeClaimCommand({ id: "C2", workerId: "W2", actor: { type: "worker", id: "W2" } })
  );

  assert.equal(claimAgain.ok, false);
  if (!claimAgain.ok) assert.equal(claimAgain.code, "TASK_NOT_READY");
});

test("executes the complete v0 milestone for A without promoting B, C, or D", () => {
  const { controlPlane } = makeReadyControlPlane();

  const initialGraph = ControlPlane.getTaskGraphSnapshot(controlPlane);
  assert.equal(initialGraph.tasks.A?.status, "ready");
  assert.equal(initialGraph.tasks.B?.status, "pending");
  assert.equal(initialGraph.tasks.C?.status, "pending");
  assert.equal(initialGraph.tasks.D?.status, "pending");

  const claim = ControlPlane.dispatchCommand(controlPlane, makeClaimCommand());
  const leaseId = getLeaseId(claim);
  const start = ControlPlane.dispatchCommand(
    controlPlane,
    makeStartCommand({ leaseId, workerId: "W1" })
  );
  const complete = ControlPlane.dispatchCommand(
    controlPlane,
    makeCompleteCommand({ leaseId, workerId: "W1" })
  );

  assert.deepEqual(
    claim.ok && claim.events.map((event) => event.type),
    ["lease.created", "task.claimed"]
  );
  assert.deepEqual(
    start.ok && start.events.map((event) => event.type),
    ["task.started"]
  );
  assert.deepEqual(
    complete.ok && complete.events.map((event) => event.type),
    ["task.review_requested"]
  );

  assert.deepEqual(
    claim.ok && claim.events.map((event) => event.id),
    ["E1", "E2"]
  );
  assert.deepEqual(start.ok && start.events.map((event) => event.id), ["E3"]);
  assert.deepEqual(
    complete.ok && complete.events.map((event) => event.id),
    ["E4"]
  );

  const finalGraph = ControlPlane.getTaskGraphSnapshot(controlPlane);
  assert.equal(finalGraph.tasks.A?.status, "review");
  assert.equal(finalGraph.tasks.B?.status, "pending");
  assert.equal(finalGraph.tasks.C?.status, "pending");
  assert.equal(finalGraph.tasks.D?.status, "pending");

  const eventLog = ControlPlane.getEventLogSnapshot(controlPlane);
  assert.deepEqual(eventLog.map((event) => event.type), [
    "lease.created",
    "task.claimed",
    "task.started",
    "task.review_requested"
  ]);
  assert.equal(eventLog.some((event) => event.type === "task.ready"), false);
  assert.equal(eventLog.some((event) => event.type === "task.completed"), false);
});

test("rejects complete without an active Lease even when assignedWorkerId matches", () => {
  const graph = makeMilestoneGraph();
  graph.tasks.A.status = "running";
  graph.tasks.A.assignedWorkerId = "W1";
  const created = ControlPlane.createControlPlane(graph, makeOptions());
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const beforeGraph = ControlPlane.getTaskGraphSnapshot(created.controlPlane);
  const beforeLog = ControlPlane.getEventLogSnapshot(created.controlPlane);
  const result = ControlPlane.dispatchCommand(
    created.controlPlane,
    makeCompleteCommand()
  );

  assert.deepEqual(result, {
    ok: false,
    code: "LEASE_NOT_FOUND",
    commandId: "CO1",
    leaseId: "L1"
  });
  assert.deepEqual(ControlPlane.getTaskGraphSnapshot(created.controlPlane), beforeGraph);
  assert.deepEqual(ControlPlane.getEventLogSnapshot(created.controlPlane), beforeLog);
});

test("rejects complete with a wrong Lease ID without mutating graph or Event Log", () => {
  const { controlPlane } = makeRunningControlPlane();
  const beforeGraph = ControlPlane.getTaskGraphSnapshot(controlPlane);
  const beforeLog = ControlPlane.getEventLogSnapshot(controlPlane);
  const result = ControlPlane.dispatchCommand(
    controlPlane,
    makeCompleteCommand({ id: "CO2", leaseId: "WRONG" })
  );

  assert.deepEqual(result, {
    ok: false,
    code: "LEASE_MISMATCH",
    commandId: "CO2",
    taskId: "A",
    leaseId: "WRONG",
    workerId: "W1"
  });
  assert.deepEqual(ControlPlane.getTaskGraphSnapshot(controlPlane), beforeGraph);
  assert.deepEqual(ControlPlane.getEventLogSnapshot(controlPlane), beforeLog);
});

test("rejects complete with a wrong Worker ID without mutating graph or Event Log", () => {
  const { controlPlane, leaseId } = makeRunningControlPlane();
  const beforeGraph = ControlPlane.getTaskGraphSnapshot(controlPlane);
  const beforeLog = ControlPlane.getEventLogSnapshot(controlPlane);
  const result = ControlPlane.dispatchCommand(
    controlPlane,
    makeCompleteCommand({ id: "CO3", leaseId, workerId: "W2" })
  );

  assert.deepEqual(result, {
    ok: false,
    code: "LEASE_MISMATCH",
    commandId: "CO3",
    taskId: "A",
    leaseId,
    workerId: "W2"
  });
  assert.deepEqual(ControlPlane.getTaskGraphSnapshot(controlPlane), beforeGraph);
  assert.deepEqual(ControlPlane.getEventLogSnapshot(controlPlane), beforeLog);
});

test("rejects complete outside running before Lease validation", () => {
  const { controlPlane, leaseId } = makeClaimedControlPlane();
  const beforeGraph = ControlPlane.getTaskGraphSnapshot(controlPlane);
  const beforeLog = ControlPlane.getEventLogSnapshot(controlPlane);
  const result = ControlPlane.dispatchCommand(
    controlPlane,
    makeCompleteCommand({ id: "CO4", leaseId })
  );

  assert.deepEqual(result, {
    ok: false,
    code: "INVALID_TASK_TRANSITION",
    commandId: "CO4",
    taskId: "A",
    from: "claimed",
    to: "review"
  });
  assert.deepEqual(ControlPlane.getTaskGraphSnapshot(controlPlane), beforeGraph);
  assert.deepEqual(ControlPlane.getEventLogSnapshot(controlPlane), beforeLog);
});

function makeReviewGraph(): TaskGraph {
  return {
    projectId: "P1",
    rootTaskIds: ["A"],
    // Deliberately insert C before B: event order must come from Core.
    tasks: {
      A: makeTask("A", "epic", { status: "review", assignedWorkerId: "W1" }),
      C: makeTask("C", "subtask", { parentId: "B", dependencies: ["A"] }),
      B: makeTask("B", "task", { parentId: "A", dependencies: ["A"] }),
      D: makeTask("D", "atomic", { parentId: "C", dependencies: ["B", "C"] })
    }
  };
}

function createReviewFixture(
  graph: TaskGraph = makeReviewGraph(),
  options: ControlPlane.ControlPlaneOptions = makeOptions()
): ControlPlane.ControlPlane {
  const creation = ControlPlane.createControlPlane(graph, options);
  assert.equal(creation.ok, true);
  if (!creation.ok) throw new Error("Expected a valid review approval fixture.");
  return creation.controlPlane;
}

for (const taskId of ["MISSING", "toString", "constructor", "__proto__"]) {
  test(`rejects approval for absent own task key ${taskId} without mutation or staging`, () => {
    const controlPlane = createReviewFixture(makeReviewGraph(), {
      ...makeOptions(),
      now: () => { throw new Error("Rejections must not stage"); }
    });
    const beforeGraph = ControlPlane.getTaskGraphSnapshot(controlPlane);
    const beforeLog = ControlPlane.getEventLogSnapshot(controlPlane);
    const result = ControlPlane.dispatchCommand(controlPlane, makeReviewApprovalCommand({ taskId }));

    assert.deepEqual(ControlPlane.getTaskGraphSnapshot(controlPlane), beforeGraph);
    assert.deepEqual(ControlPlane.getEventLogSnapshot(controlPlane), beforeLog);
    assert.deepEqual(result, { ok: false, code: "TASK_NOT_FOUND", commandId: "RA1", taskId });
  });
}

for (const status of ["pending", "ready", "claimed", "running", "blocked", "completed", "failed", "cancelled"] as const) {
  test(`rejects approval from ${status} to completed before staging`, () => {
    const graph = makeReviewGraph();
    graph.tasks.A.status = status;
    const controlPlane = createReviewFixture(graph, {
      ...makeOptions(),
      now: () => { throw new Error("Rejections must not stage"); }
    });
    const beforeGraph = ControlPlane.getTaskGraphSnapshot(controlPlane);
    const beforeLog = ControlPlane.getEventLogSnapshot(controlPlane);
    const result = ControlPlane.dispatchCommand(controlPlane, makeReviewApprovalCommand());

    assert.deepEqual(ControlPlane.getTaskGraphSnapshot(controlPlane), beforeGraph);
    assert.deepEqual(ControlPlane.getEventLogSnapshot(controlPlane), beforeLog);
    assert.deepEqual(result, {
      ok: false, code: "INVALID_TASK_TRANSITION", commandId: "RA1",
      taskId: "A", from: status, to: "completed"
    });
  });
}

test("rejects approval from another project before task lookup", () => {
  const controlPlane = createReviewFixture();
  const beforeGraph = ControlPlane.getTaskGraphSnapshot(controlPlane);
  const beforeLog = ControlPlane.getEventLogSnapshot(controlPlane);
  const result = ControlPlane.dispatchCommand(
    controlPlane, makeReviewApprovalCommand({ projectId: "OTHER", taskId: "MISSING" })
  );

  assert.deepEqual(ControlPlane.getTaskGraphSnapshot(controlPlane), beforeGraph);
  assert.deepEqual(ControlPlane.getEventLogSnapshot(controlPlane), beforeLog);
  assert.deepEqual(result, {
    ok: false, code: "PROJECT_MISMATCH", commandId: "RA1",
    commandProjectId: "OTHER", controlPlaneProjectId: "P1"
  });
});

test("approves A and immediately promotes B/C while D stays pending using one timestamp", () => {
  const approvedAt = "2026-09-06T12:00:00.000Z";
  let clockCalls = 0;
  const controlPlane = createReviewFixture(makeReviewGraph(), {
    ...makeOptions(),
    now: () => {
      assert.equal(++clockCalls, 1);
      return approvedAt;
    },
    nextLeaseId: () => { throw new Error("Approval must not create a Lease"); },
    leaseExpiresAt: () => { throw new Error("Approval must not inspect Lease expiry"); }
  });
  const result = ControlPlane.dispatchCommand(controlPlane, makeReviewApprovalCommand());

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.events, [
    { id: "E1", protocolVersion: "0.2", timestamp: approvedAt, projectId: "P1",
      actor: { type: "user", id: "reviewer" }, type: "task.completed", payload: { taskId: "A" } },
    { id: "E2", protocolVersion: "0.2", timestamp: approvedAt, projectId: "P1",
      actor: { type: "user", id: "reviewer" }, type: "task.ready", payload: { taskId: "B" } },
    { id: "E3", protocolVersion: "0.2", timestamp: approvedAt, projectId: "P1",
      actor: { type: "user", id: "reviewer" }, type: "task.ready", payload: { taskId: "C" } }
  ]);
  const graph = ControlPlane.getTaskGraphSnapshot(controlPlane);
  assert.deepEqual([graph.tasks.A.status, graph.tasks.B.status, graph.tasks.C.status, graph.tasks.D.status],
    ["completed", "ready", "ready", "pending"]);
  assert.deepEqual([graph.tasks.A.updatedAt, graph.tasks.B.updatedAt, graph.tasks.C.updatedAt, graph.tasks.D.updatedAt],
    [approvedAt, approvedAt, approvedAt, TIMESTAMP]);
  assert.equal(graph.tasks.A.assignedWorkerId, "W1");
  assert.equal(clockCalls, 1);
  assert.deepEqual(ControlPlane.getEventLogSnapshot(controlPlane), result.events);
});

test("approval reconciles global readiness beyond A descendants", () => {
  const graph: TaskGraph = {
    projectId: "P1",
    rootTaskIds: ["A", "X", "Y"],
    tasks: {
      A: makeTask("A", "epic", { status: "review" }),
      X: makeTask("X", "epic", { dependencies: ["Y"] }),
      Y: makeTask("Y", "epic", { status: "completed" }),
      B: makeTask("B", "task", { parentId: "A", dependencies: ["A"] })
    }
  };
  const controlPlane = createReviewFixture(graph);

  const result = ControlPlane.dispatchCommand(
    controlPlane,
    makeReviewApprovalCommand()
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    result.events.map(getCompletionOrReadyEventTuple),
    [
      ["task.completed", "A"],
      ["task.ready", "B"],
      ["task.ready", "X"]
    ]
  );
  const snapshot = ControlPlane.getTaskGraphSnapshot(controlPlane);
  assert.deepEqual(
    [snapshot.tasks.A.status, snapshot.tasks.B.status, snapshot.tasks.X.status],
    ["completed", "ready", "ready"]
  );
});

test("approval with zero promotions emits only task.completed", () => {
  const controlPlane = createReviewFixture({
    projectId: "P1",
    rootTaskIds: ["A", "X", "Y"],
    tasks: {
      A: makeTask("A", "epic", { status: "review" }),
      X: makeTask("X", "epic", { dependencies: ["A", "Y"] }),
      Y: makeTask("Y", "epic", { status: "failed" })
    }
  });

  const result = ControlPlane.dispatchCommand(
    controlPlane,
    makeReviewApprovalCommand()
  );

  assert.deepEqual(result, {
    ok: true,
    events: [{
      id: "E1",
      protocolVersion: "0.2",
      timestamp: TIMESTAMP,
      projectId: "P1",
      actor: { type: "user", id: "reviewer" },
      type: "task.completed",
      payload: { taskId: "A" }
    }]
  });
  assert.equal(ControlPlane.getTaskGraphSnapshot(controlPlane).tasks.X.status, "pending");
});

test("multiple ready events preserve Core order and approval event metadata", () => {
  const approvedAt = "2026-09-06T13:00:00.000Z";
  const actor: Actor = { type: "user", id: "adversarial-reviewer" };
  const graph: TaskGraph = {
    projectId: "P1",
    rootTaskIds: ["A", "Z", "B"],
    tasks: {
      Z: makeTask("Z", "epic", { dependencies: ["A"] }),
      A: makeTask("A", "epic", { status: "review" }),
      B: makeTask("B", "epic", { dependencies: ["A"] })
    }
  };
  const controlPlane = createReviewFixture(graph, {
    ...makeOptions(),
    now: () => approvedAt
  });

  const result = ControlPlane.dispatchCommand(
    controlPlane,
    makeReviewApprovalCommand({ actor })
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    result.events.map(getCompletionOrReadyEventTuple),
    [["task.completed", "A"], ["task.ready", "B"], ["task.ready", "Z"]]
  );
  assert.deepEqual(
    result.events.map((event) => event.id),
    ["E1", "E2", "E3"]
  );
  for (const event of result.events) {
    assert.equal(event.timestamp, approvedAt);
    assert.deepEqual(event.actor, actor);
    assert.equal(event.projectId, "P1");
    assert.equal(event.protocolVersion, "0.2");
  }
});

test("explicit claim start complete approve DAG progression ends with D ready only", () => {
  const graph: TaskGraph = {
    projectId: "P1",
    rootTaskIds: ["A"],
    tasks: {
      A: makeTask("A", "epic", { status: "ready" }),
      B: makeTask("B", "task", { parentId: "A", dependencies: ["A"] }),
      C: makeTask("C", "subtask", { parentId: "B", dependencies: ["A"] }),
      D: makeTask("D", "atomic", { parentId: "C", dependencies: ["B", "C"] })
    }
  };
  const controlPlane = createReviewFixture(graph);

  const claimA = ControlPlane.dispatchCommand(controlPlane, makeClaimCommand({ taskId: "A" }));
  const leaseA = getLeaseId(claimA);
  assert.equal(ControlPlane.dispatchCommand(controlPlane, makeStartCommand({ taskId: "A", leaseId: leaseA })).ok, true);
  assert.equal(ControlPlane.dispatchCommand(controlPlane, makeCompleteCommand({ taskId: "A", leaseId: leaseA })).ok, true);
  const approveA = ControlPlane.dispatchCommand(controlPlane, makeReviewApprovalCommand({ taskId: "A" }));
  assert.deepEqual(
    approveA.ok && approveA.events.map(getCompletionOrReadyEventTuple),
    [["task.completed", "A"], ["task.ready", "B"], ["task.ready", "C"]]
  );
  assert.deepEqual(
    Object.fromEntries(Object.entries(ControlPlane.getTaskGraphSnapshot(controlPlane).tasks).map(([id, task]) => [id, task.status])),
    { A: "completed", B: "ready", C: "ready", D: "pending" }
  );

  const historyAfterA = ControlPlane.getEventLogSnapshot(controlPlane);
  assert.equal(approveA.ok && approveA.events.length, 3);
  assert.equal(historyAfterA.length, 7);

  const claimB = ControlPlane.dispatchCommand(controlPlane, makeClaimCommand({ id: "CB", taskId: "B", workerId: "WB", actor: { type: "worker", id: "WB" } }));
  const leaseB = getLeaseId(claimB);
  assert.equal(ControlPlane.dispatchCommand(controlPlane, makeStartCommand({ id: "SB", taskId: "B", workerId: "WB", leaseId: leaseB, actor: { type: "worker", id: "WB" } })).ok, true);
  assert.equal(ControlPlane.dispatchCommand(controlPlane, makeCompleteCommand({ id: "COB", taskId: "B", workerId: "WB", leaseId: leaseB, actor: { type: "worker", id: "WB" } })).ok, true);
  const approveB = ControlPlane.dispatchCommand(controlPlane, makeReviewApprovalCommand({ id: "RAB", taskId: "B" }));
  assert.deepEqual(
    approveB.ok && approveB.events.map(getCompletionOrReadyEventTuple),
    [["task.completed", "B"]]
  );
  assert.deepEqual(
    Object.fromEntries(Object.entries(ControlPlane.getTaskGraphSnapshot(controlPlane).tasks).map(([id, task]) => [id, task.status])),
    { A: "completed", B: "completed", C: "ready", D: "pending" }
  );

  const historyAfterB = ControlPlane.getEventLogSnapshot(controlPlane);
  assert.equal(approveB.ok && approveB.events.length, 1);
  assert.equal(historyAfterB.length, 12);

  const claimC = ControlPlane.dispatchCommand(controlPlane, makeClaimCommand({ id: "CC", taskId: "C", workerId: "WC", actor: { type: "worker", id: "WC" } }));
  const leaseC = getLeaseId(claimC);
  assert.equal(ControlPlane.dispatchCommand(controlPlane, makeStartCommand({ id: "SC", taskId: "C", workerId: "WC", leaseId: leaseC, actor: { type: "worker", id: "WC" } })).ok, true);
  assert.equal(ControlPlane.dispatchCommand(controlPlane, makeCompleteCommand({ id: "COC", taskId: "C", workerId: "WC", leaseId: leaseC, actor: { type: "worker", id: "WC" } })).ok, true);
  const approveC = ControlPlane.dispatchCommand(controlPlane, makeReviewApprovalCommand({ id: "RAC", taskId: "C" }));
  assert.deepEqual(
    approveC.ok && approveC.events.map(getCompletionOrReadyEventTuple),
    [["task.completed", "C"], ["task.ready", "D"]]
  );

  const finalGraph = ControlPlane.getTaskGraphSnapshot(controlPlane);
  assert.deepEqual(
    Object.fromEntries(Object.entries(finalGraph.tasks).map(([id, task]) => [id, task.status])),
    { A: "completed", B: "completed", C: "completed", D: "ready" }
  );
  const finalHistory = ControlPlane.getEventLogSnapshot(controlPlane);
  assert.equal(approveC.ok && approveC.events.length, 2);
  assert.equal(finalHistory.length, 18);
  assert.deepEqual(finalHistory.slice(0, historyAfterA.length), historyAfterA);
  assert.deepEqual(finalHistory.slice(0, historyAfterB.length), historyAfterB);
  assert.deepEqual(
    finalHistory.flatMap((event) =>
      (event.type === "task.completed" || event.type === "task.ready") && event.payload.taskId === "D"
        ? [event.type]
        : []
    ),
    ["task.ready"]
  );
  assert.equal(
    finalHistory.some(
      (event) => event.type === "task.claimed" && event.payload.taskId === "D"
    ),
    false
  );
  assert.equal(
    finalHistory.some(
      (event) => event.type === "task.started" && event.payload.taskId === "D"
    ),
    false
  );
});

for (const taskId of ["A", "toString", "constructor", "__proto__"]) {
  test(`approves canonical own key ${taskId} with no Lease or promotions and worker Actor provenance`, () => {
    const controlPlane = createReviewFixture({
      projectId: "P1", rootTaskIds: [taskId],
      tasks: { [taskId]: makeTask(taskId, "epic", { status: "review" }) }
    });
    const result = ControlPlane.dispatchCommand(controlPlane, makeReviewApprovalCommand({
      taskId, actor: { type: "worker", id: "unassigned-reviewer" }
    }));

    assert.deepEqual(result, { ok: true, events: [{
      id: "E1", protocolVersion: "0.2", timestamp: TIMESTAMP, projectId: "P1",
      actor: { type: "worker", id: "unassigned-reviewer" },
      type: "task.completed", payload: { taskId }
    }] });
    assert.equal(ControlPlane.getTaskGraphSnapshot(controlPlane).tasks[taskId].status, "completed");
    assert.deepEqual(ControlPlane.getEventLogSnapshot(controlPlane), result.ok ? result.events : []);
  });
}

for (const failurePoint of ["now", 1, 2, 3] as const) {
  test(`approval atomic failure at ${failurePoint} preserves graph, history and Lease semantics`, () => {
    const graph = makeReviewGraph();
    graph.rootTaskIds = [...graph.rootTaskIds, "X"];
    graph.tasks.X = makeTask("X", "epic", { status: "ready" });
    let failing = false;
    let approvalEventCalls = 0;
    const issuedApprovalIds: string[] = [];
    const stagingFailure = new Error("approval staging failed");
    const options = makeOptions();
    const controlPlane = createReviewFixture(graph, {
      ...options,
      now: () => {
        if (failing && failurePoint === "now") throw stagingFailure;
        return TIMESTAMP;
      },
      nextEventId: () => {
        if (failing && ++approvalEventCalls === failurePoint) throw stagingFailure;
        const id = options.nextEventId();
        if (failing) issuedApprovalIds.push(id);
        return id;
      },
      nextLeaseId: () => {
        assert.equal(failing, false, "Approval must not allocate a Lease");
        return options.nextLeaseId();
      },
      leaseExpiresAt: (timestamp) => {
        assert.equal(failing, false, "Approval must not compute Lease expiry");
        return options.leaseExpiresAt(timestamp);
      }
    });
    const leaseId = getLeaseId(ControlPlane.dispatchCommand(controlPlane, makeClaimCommand({ taskId: "X" })));
    const beforeGraph = ControlPlane.getTaskGraphSnapshot(controlPlane);
    const beforeLog = ControlPlane.getEventLogSnapshot(controlPlane);
    failing = true;

    assert.throws(() => ControlPlane.dispatchCommand(controlPlane, makeReviewApprovalCommand()),
      (error) => error === stagingFailure);
    assert.equal(approvalEventCalls, failurePoint === "now" ? 0 : failurePoint);
    assert.deepEqual(issuedApprovalIds,
      failurePoint === 3 ? ["E3", "E4"] : failurePoint === 2 ? ["E3"] : []);
    assert.deepEqual(ControlPlane.getTaskGraphSnapshot(controlPlane), beforeGraph);
    assert.deepEqual(ControlPlane.getEventLogSnapshot(controlPlane), beforeLog);

    // Claim checks Lease presence before task readiness; these probes cannot mutate state.
    for (const taskId of ["A", "B", "C", "D", "X"]) {
      assert.deepEqual(ControlPlane.dispatchCommand(controlPlane, makeClaimCommand({ taskId })), {
        ok: false, code: taskId === "X" ? "TASK_ALREADY_LEASED" : "TASK_NOT_READY",
        commandId: "C1", taskId
      });
    }
    for (const credentials of [
      { leaseId: "WRONG", workerId: "W1" },
      { leaseId, workerId: "OTHER" }
    ]) {
      assert.deepEqual(ControlPlane.dispatchCommand(controlPlane, makeStartCommand({ taskId: "X", ...credentials })), {
        ok: false, code: "LEASE_MISMATCH", commandId: "S1", taskId: "X", ...credentials
      });
    }
    assert.deepEqual(ControlPlane.getTaskGraphSnapshot(controlPlane), beforeGraph);
    assert.deepEqual(ControlPlane.getEventLogSnapshot(controlPlane), beforeLog);
    failing = false;

    // A retry must still perform the whole multi-Event approval, without replaying spent IDs.
    const retry = ControlPlane.dispatchCommand(controlPlane, makeReviewApprovalCommand());
    assert.ok(retry.ok);
    assert.deepEqual(retry.events.map(getCompletionOrReadyEventTuple),
      [["task.completed", "A"], ["task.ready", "B"], ["task.ready", "C"]]);
    assert.equal(retry.events.some((event) => issuedApprovalIds.includes(event.id)), false);
    assert.deepEqual(ControlPlane.getEventLogSnapshot(controlPlane), [...beforeLog, ...retry.events]);
    assert.deepEqual(ControlPlane.getTaskGraphSnapshot(controlPlane).tasks.X, beforeGraph.tasks.X);
    assert.equal(ControlPlane.dispatchCommand(controlPlane, makeStartCommand({ taskId: "X", leaseId })).ok, true);
  });
}

for (const mutationSource of ["Command/Actor", "result Events", "Event Log snapshot", "Graph snapshot"] as const) {
  test(`approval defensive mutation isolation for ${mutationSource}`, () => {
    const graph = makeReviewGraph();
    graph.tasks.C.acceptanceCriteria = [{ id: "AC-1", description: "original" }];
    graph.rootTaskIds = [...graph.rootTaskIds, "X"];
    graph.tasks.X = makeTask("X", "epic", { status: "ready" });
    const controlPlane = createReviewFixture(graph);
    const claim = ControlPlane.dispatchCommand(controlPlane, makeClaimCommand({ taskId: "X" }));
    const leaseId = getLeaseId(claim);
    const expectedClaim = structuredClone(claim);
    const beforeLog = ControlPlane.getEventLogSnapshot(controlPlane);
    const beforeGraph = ControlPlane.getTaskGraphSnapshot(controlPlane);
    const expectedBeforeLog = structuredClone(beforeLog);
    const expectedBeforeGraph = structuredClone(beforeGraph);
    const actor = makeActor({ type: "user", id: "reviewer" });
    const command = makeReviewApprovalCommand({ actor });
    const result = ControlPlane.dispatchCommand(controlPlane, command);
    assert.ok(result.ok);
    assert.deepEqual(result.events.map(getCompletionOrReadyEventTuple),
      [["task.completed", "A"], ["task.ready", "B"], ["task.ready", "C"]]);
    const expectedEvents = structuredClone(result.events);
    const expectedLog = structuredClone([...beforeLog, ...result.events]);
    const expectedGraph = structuredClone(beforeGraph);
    expectedGraph.tasks.A.status = "completed";
    expectedGraph.tasks.B.status = "ready";
    expectedGraph.tasks.C.status = "ready";
    assert.deepEqual(ControlPlane.getEventLogSnapshot(controlPlane), expectedLog);
    assert.deepEqual(ControlPlane.getTaskGraphSnapshot(controlPlane), expectedGraph);

    switch (mutationSource) {
      case "Command/Actor":
        command.actor.id = "mutated-command";
        command.actor.type = "system";
        command.payload.taskId = "mutated-command";
        command.id = "mutated-command";
        command.projectId = "OTHER";
        command.timestamp = "2099-01-01T00:00:00.000Z";
        command.actor = { type: "worker", id: "replacement" };
        actor.id = "mutated-original-actor";
        actor.type = "worker";
        break;
      case "result Events":
        result.events[0].actor.id = "mutated-result";
        result.events[0].actor.type = "system";
        assert.deepEqual(result.events.slice(1), expectedEvents.slice(1));
        assert.deepEqual(actor, { type: "user", id: "reviewer" });
        for (const event of result.events) {
          event.id = "mutated-result";
          event.projectId = "OTHER";
          event.actor.id = "mutated-result";
          event.actor.type = "system";
          if (event.type === "task.completed" || event.type === "task.ready") {
            event.payload.taskId = "mutated-result";
          }
        }
        (result.events as FlowctlEvent[]).splice(0, result.events.length);
        break;
      case "Event Log snapshot": {
        const snapshot = ControlPlane.getEventLogSnapshot(controlPlane);
        assert.equal(snapshot[0].type, "lease.created");
        if (snapshot[0].type === "lease.created") {
          Object.assign(snapshot[0].payload.lease, {
            id: "OTHER", taskId: "A", workerId: "OTHER",
            acquiredAt: "changed", expiresAt: "changed", lastHeartbeatAt: "changed"
          });
        }
        for (const event of snapshot) {
          event.id = "mutated-snapshot";
          event.actor.id = "mutated-snapshot";
          event.actor.type = "system";
          if ("taskId" in event.payload) event.payload.taskId = "mutated-snapshot";
        }
        (snapshot as FlowctlEvent[]).splice(0, snapshot.length, ...structuredClone(expectedEvents));
        break;
      }
      case "Graph snapshot": {
        const snapshot = ControlPlane.getTaskGraphSnapshot(controlPlane);
        snapshot.projectId = "OTHER";
        snapshot.rootTaskIds.splice(0, snapshot.rootTaskIds.length, "OTHER");
        snapshot.tasks.A.status = "failed";
        snapshot.tasks.A.assignedWorkerId = "OTHER";
        snapshot.tasks.B.dependencies.push("OTHER");
        snapshot.tasks.C.acceptanceCriteria[0].description = "mutated-snapshot";
        snapshot.tasks.C.acceptanceCriteria.push({ id: "AC-2", description: "inserted" });
        snapshot.tasks.X.updatedAt = "changed";
        delete snapshot.tasks.D;
        snapshot.tasks.OTHER = makeTask("OTHER", "epic");
        break;
      }
    }

    if (mutationSource !== "result Events") assert.deepEqual(result.events, expectedEvents);
    assert.deepEqual(claim, expectedClaim);
    assert.deepEqual(beforeLog, expectedBeforeLog);
    assert.deepEqual(beforeGraph, expectedBeforeGraph);
    assert.deepEqual(ControlPlane.getEventLogSnapshot(controlPlane), expectedLog);
    assert.deepEqual(ControlPlane.getTaskGraphSnapshot(controlPlane), expectedGraph);
    for (const taskId of ["A", "D"]) {
      assert.deepEqual(ControlPlane.dispatchCommand(controlPlane, makeClaimCommand({ taskId })), {
        ok: false, code: "TASK_NOT_READY", commandId: "C1", taskId
      });
    }
    assert.equal(ControlPlane.dispatchCommand(controlPlane, makeStartCommand({ taskId: "X", leaseId })).ok, true);
    // Approval must leave newly ready tasks unleased and must not consume Lease IDs.
    assert.equal(getLeaseId(ControlPlane.dispatchCommand(controlPlane, makeClaimCommand({ taskId: "B" }))), "L2");
    assert.equal(getLeaseId(ControlPlane.dispatchCommand(controlPlane, makeClaimCommand({ taskId: "C" }))), "L3");
    assert.deepEqual(ControlPlane.getEventLogSnapshot(controlPlane).slice(0, expectedLog.length), expectedLog);
  });
}

test("narrows every public command result and emitted event by its discriminant", () => {
  const results: ControlPlane.CommandProcessingResult[] = [];

  const mismatchPlane = makeReadyControlPlane().controlPlane;
  results.push(
    ControlPlane.dispatchCommand(mismatchPlane, makeGraphMutationCommand("OTHER"))
  );
  results.push(
    ControlPlane.dispatchCommand(mismatchPlane, makeGraphMutationCommand())
  );
  results.push(
    ControlPlane.dispatchCommand(
      mismatchPlane,
      makeClaimCommand({ taskId: "MISSING" })
    )
  );
  results.push(
    ControlPlane.dispatchCommand(mismatchPlane, makeClaimCommand({ taskId: "B" }))
  );

  const claimedPlane = makeReadyControlPlane().controlPlane;
  results.push(
    ControlPlane.dispatchCommand(claimedPlane, makeClaimCommand())
  );
  results.push(
    ControlPlane.dispatchCommand(
      claimedPlane,
      makeClaimCommand({ id: "C2", workerId: "W2", actor: makeActor({ id: "W2" }) })
    )
  );

  const noLeasePlane = makeMilestoneGraph();
  noLeasePlane.tasks.A.status = "claimed";
  const noLeaseCreation = ControlPlane.createControlPlane(noLeasePlane, makeOptions());
  assert.equal(noLeaseCreation.ok, true);
  if (!noLeaseCreation.ok) return;
  results.push(
    ControlPlane.dispatchCommand(noLeaseCreation.controlPlane, makeStartCommand())
  );

  const leaseMismatchPlane = makeClaimedControlPlane();
  results.push(
    ControlPlane.dispatchCommand(
      leaseMismatchPlane.controlPlane,
      makeStartCommand({ leaseId: "WRONG" })
    )
  );

  const runningPlane = makeClaimedControlPlane();
  const started = ControlPlane.dispatchCommand(
    runningPlane.controlPlane,
    makeStartCommand({ leaseId: runningPlane.leaseId })
  );
  results.push(started);
  results.push(
    ControlPlane.dispatchCommand(
      runningPlane.controlPlane,
      makeStartCommand({ id: "S2", leaseId: runningPlane.leaseId })
    )
  );

  const completedPlane = makeRunningControlPlane();
  results.push(
    ControlPlane.dispatchCommand(
      completedPlane.controlPlane,
      makeCompleteCommand({ leaseId: completedPlane.leaseId })
    )
  );

  for (const result of results) {
    assertCommandProcessingResultFields(result);
  }

  assert.deepEqual(
    results.filter((result) => !result.ok).map((result) => result.code),
    [
      "PROJECT_MISMATCH",
      "UNSUPPORTED_COMMAND",
      "TASK_NOT_FOUND",
      "TASK_NOT_READY",
      "TASK_ALREADY_LEASED",
      "LEASE_NOT_FOUND",
      "LEASE_MISMATCH",
      "INVALID_TASK_TRANSITION"
    ]
  );
});
