import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as ControlPlane from "../src/index.js";
import type { Actor, FlowctlCommand, Task, TaskGraph, TaskLevel } from "@flowctl/protocol";

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
    protocolVersion: "0.1",
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
    protocolVersion: "0.1",
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
    protocolVersion: "0.1",
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
    assert.equal(result.events[0].protocolVersion, "0.1");
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
