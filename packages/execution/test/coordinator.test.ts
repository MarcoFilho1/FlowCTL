import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { TestContext } from "node:test";
import * as ControlPlane from "@flowctl/control-plane";
import { PROTOCOL_VERSION } from "@flowctl/protocol";
import type { Actor, FlowctlCommand, Task, TaskGraph } from "@flowctl/protocol";
import * as Execution from "../src/index.js";
import {
  createExecutionCoordinatorForTest,
  type ControlPlaneOperations
} from "../src/test-support.js";
import { FakeAdapter, type FakeAdapterMode } from "./support/fake-adapter.js";

const CREATED_AT = "2026-09-10T00:00:00.000Z";
const NOW = "2026-09-11T00:00:00.000Z";
const ACTOR: Actor = { type: "system", id: "coordinator" };

function makeTask(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    level: "epic",
    title: `${id} title`,
    status: "ready",
    dependencies: [],
    acceptanceCriteria: [{ id: "AC1", description: "review the result" }],
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides
  };
}

function makeExecutionFixture(t: TestContext, options: {
  adapterMode?: FakeAdapterMode;
  reject?: readonly FlowctlCommand["type"][];
  graph?: TaskGraph;
} = {}) {
  const workspacePath = mkdtempSync(join(tmpdir(), "flowctl-coordinator-"));
  t.after(() => rmSync(workspacePath, { recursive: true, force: true }));
  let leaseId = 0;
  let eventId = 0;
  let commandId = 0;
  const created = ControlPlane.createControlPlane(options.graph ?? {
    projectId: "P1",
    rootTaskIds: ["A"],
    tasks: {
      A: makeTask("A", { assignedWorkerId: "not-the-lease-owner" }),
      B: makeTask("B", { level: "task", parentId: "A", status: "pending" })
    }
  }, {
    now: () => NOW,
    nextLeaseId: () => `L${++leaseId}`,
    nextEventId: () => `E${++eventId}`,
    leaseExpiresAt: () => "2026-09-11T01:00:00.000Z"
  });
  assert.ok(created.ok);
  const { controlPlane } = created;
  const trace: string[] = [];
  const commands: FlowctlCommand[] = [];
  const statesAtRejection: TaskGraph[] = [];
  const eventsAtRejection: ReturnType<typeof ControlPlane.getEventLogSnapshot>[] = [];
  const adapter = new FakeAdapter(options.adapterMode, trace);
  const coordinatorOptions: Execution.ExecutionCoordinatorOptions = {
    controlPlane,
    workerId: "W1",
    adapter,
    workspacePath,
    actor: ACTOR,
    nextCommandId: () => `C${++commandId}`,
    now: () => NOW
  };
  const operations: ControlPlaneOperations = {
    getTaskGraphSnapshot: ControlPlane.getTaskGraphSnapshot,
    dispatchCommand(plane, command) {
      trace.push(command.type);
      commands.push(command);
      if (options.reject?.includes(command.type)) {
        statesAtRejection.push(ControlPlane.getTaskGraphSnapshot(plane));
        eventsAtRejection.push(ControlPlane.getEventLogSnapshot(plane));
        assert.ok("taskId" in command.payload);
        assert.ok("workerId" in command.payload);
        assert.ok("leaseId" in command.payload);
        return {
          ok: false,
          code: "LEASE_MISMATCH",
          commandId: command.id,
          taskId: command.payload.taskId,
          workerId: command.payload.workerId,
          leaseId: command.payload.leaseId
        };
      }
      return ControlPlane.dispatchCommand(plane, command);
    }
  };
  const result = createExecutionCoordinatorForTest(coordinatorOptions, operations);
  assert.ok(result.ok);
  return {
    coordinator: result.coordinator, coordinatorOptions, operations,
    adapter, controlPlane, commands, trace, statesAtRejection, eventsAtRejection, workspacePath
  };
}

test("rejects a non-ready task before invoking the Adapter", async (t) => {
  const { coordinator, adapter, controlPlane, commands } = makeExecutionFixture(t);
  const before = ControlPlane.getTaskGraphSnapshot(controlPlane);
  const result = await coordinator.executeTask("B");
  assert.equal(result.kind, "admission_rejected");
  if (result.kind !== "admission_rejected") return;
  assert.deepEqual(result.rejection, {
    ok: false, code: "TASK_NOT_READY", commandId: "C1", taskId: "B"
  });
  assert.equal(adapter.calls.length, 0);
  assert.deepEqual(commands.map((command) => command.type), ["task.claim"]);
  assert.deepEqual(ControlPlane.getTaskGraphSnapshot(controlPlane), before);
  assert.deepEqual(ControlPlane.getEventLogSnapshot(controlPlane), []);
});

test("extracts the current claim Lease and starts before Adapter execution", async (t) => {
  const { coordinator, adapter, controlPlane, trace, commands, workspacePath } = makeExecutionFixture(t);
  const result = await coordinator.executeTask("A");
  assert.equal(result.kind, "submitted_for_review");
  assert.equal(adapter.calls.length, 1);
  assert.deepEqual(trace, ["task.claim", "task.start", "adapter.execute", "task.complete"]);
  assert.equal(adapter.calls[0].projectId, "P1");
  assert.equal(adapter.calls[0].taskId, "A");
  assert.equal(adapter.calls[0].leaseId, "L1");
  assert.equal(adapter.calls[0].workerId, "W1");
  assert.equal(adapter.calls[0].workspacePath, workspacePath);
  assert.equal(adapter.calls[0].task.status, "claimed");
  assert.equal(adapter.calls[0].task.updatedAt, NOW);
  assert.equal(ControlPlane.getTaskGraphSnapshot(controlPlane).tasks.A.status, "review");
  assert.deepEqual(commands, [
    { id: "C1", protocolVersion: PROTOCOL_VERSION, timestamp: NOW, projectId: "P1", actor: ACTOR,
      type: "task.claim", payload: { taskId: "A", workerId: "W1" } },
    { id: "C2", protocolVersion: PROTOCOL_VERSION, timestamp: NOW, projectId: "P1", actor: ACTOR,
      type: "task.start", payload: { taskId: "A", workerId: "W1", leaseId: "L1" } },
    { id: "C3", protocolVersion: PROTOCOL_VERSION, timestamp: NOW, projectId: "P1", actor: ACTOR,
      type: "task.complete", payload: { taskId: "A", workerId: "W1", leaseId: "L1" } }
  ]);
});

test("public factory success stops at review and never approves automatically", async (t) => {
  const { coordinatorOptions, controlPlane } = makeExecutionFixture(t);
  const created = Execution.createExecutionCoordinator(coordinatorOptions);
  assert.ok(created.ok);
  const result = await created.coordinator.executeTask("A");
  assert.equal(result.kind, "submitted_for_review");
  if (result.kind !== "submitted_for_review") return;
  assert.deepEqual(result.completion.events.map((event) => event.type), ["task.review_requested"]);
  assert.equal(ControlPlane.getTaskGraphSnapshot(controlPlane).tasks.A.status, "review");
  assert.deepEqual(ControlPlane.getEventLogSnapshot(controlPlane).map((event) => event.type),
    ["lease.created", "task.claimed", "task.started", "task.review_requested"]);
});

for (const rejectFail of [false, true]) {
  test(`completion rejection is ${rejectFail ? "unfinalized" : "finalized"}`, async (t) => {
    const { coordinator, controlPlane, adapter, commands, trace, statesAtRejection, eventsAtRejection } = makeExecutionFixture(t, {
      reject: rejectFail ? ["task.complete", "task.fail"] : ["task.complete"]
    });
    const result = await coordinator.executeTask("A");
    assert.equal(result.kind, rejectFail ? "completion_rejected_unfinalized" : "completion_rejected_finalized");
    assert.ok(result.kind === "completion_rejected_finalized" || result.kind === "completion_rejected_unfinalized");
    assert.deepEqual(result.completionRejection, {
      ok: false, code: "LEASE_MISMATCH", commandId: "C3", taskId: "A", workerId: "W1", leaseId: "L1"
    });
    assert.equal(result.finalization.ok, !rejectFail);
    if (result.finalization.ok) {
      assert.equal(result.finalization.events.length, 1);
      assert.equal(result.finalization.events[0].type, "task.failed");
      assert.deepEqual(result.finalization.events[0].payload, {
        taskId: "A", workerId: "W1", leaseId: "L1", reason: "execution_completion_rejected"
      });
    } else {
      assert.deepEqual(result.finalization, {
        ok: false, code: "LEASE_MISMATCH", commandId: "C4", taskId: "A", workerId: "W1", leaseId: "L1"
      });
    }
    assert.equal(adapter.calls.length, 1);
    assert.deepEqual(trace, ["task.claim", "task.start", "adapter.execute", "task.complete", "task.fail"]);
    assert.equal(statesAtRejection.length, rejectFail ? 2 : 1);
    for (const graph of statesAtRejection) assert.equal(graph.tasks.A.status, "running");
    for (const events of eventsAtRejection) {
      assert.deepEqual(events.map((event) => event.type), ["lease.created", "task.claimed", "task.started"]);
    }
    assert.deepEqual(commands.map((command) => command.type), ["task.claim", "task.start", "task.complete", "task.fail"]);
    assert.deepEqual(commands[3].payload, {
      taskId: "A", workerId: "W1", leaseId: "L1", reason: "execution_completion_rejected"
    });
    assert.equal(ControlPlane.getTaskGraphSnapshot(controlPlane).tasks.A.status, rejectFail ? "running" : "failed");
    assert.deepEqual(ControlPlane.getEventLogSnapshot(controlPlane).map((event) => event.type),
      rejectFail ? ["lease.created", "task.claimed", "task.started"] :
        ["lease.created", "task.claimed", "task.started", "task.failed"]);
    if (rejectFail) {
      assert.deepEqual(ControlPlane.getTaskGraphSnapshot(controlPlane), statesAtRejection[0]);
      assert.deepEqual(ControlPlane.getEventLogSnapshot(controlPlane), eventsAtRejection[0]);
      // Real completion after the assertions proves both synthetic rejections retained the trusted Lease.
      assert.ok(ControlPlane.dispatchCommand(controlPlane, { ...commands[2], id: "real-complete" }).ok);
    }
  });

  const failureCases: {
    name: string;
    mode: FakeAdapterMode;
    executionReason: string;
    commandReason: string;
  }[] = [
    {
      name: "returned execution_failed",
      mode: { kind: "return", result: { kind: "failed", reason: "execution_failed", message: "fake failure" } },
      executionReason: "execution_failed", commandReason: "execution_failed"
    },
    {
      name: "returned timeout",
      mode: { kind: "return", result: { kind: "failed", reason: "timeout", message: "fake failure" } },
      executionReason: "timeout", commandReason: "timeout"
    },
    {
      name: "returned aborted",
      mode: { kind: "return", result: { kind: "failed", reason: "aborted", message: "fake failure" } },
      executionReason: "aborted", commandReason: "aborted"
    },
    {
      name: "returned unavailable",
      mode: { kind: "return", result: { kind: "failed", reason: "unavailable", message: "fake failure" } },
      executionReason: "unavailable", commandReason: "unavailable"
    },
    {
      name: "synchronous throw",
      mode: { kind: "throw", error: new Error("secret-token private-prompt private-reasoning\nprovider-stack") },
      executionReason: "execution_failed", commandReason: "adapter_exception"
    },
    {
      name: "Promise rejection",
      mode: { kind: "reject", error: new Error("secret-token private-prompt private-reasoning\nprovider-stack") },
      executionReason: "execution_failed", commandReason: "adapter_exception"
    }
  ];
  for (const scenario of failureCases) {
    test(`${scenario.name} is ${rejectFail ? "unfinalized" : "finalized"} through task.fail`, async (t) => {
      const { coordinator, adapter, controlPlane, commands, trace, statesAtRejection, eventsAtRejection } = makeExecutionFixture(t, {
        adapterMode: scenario.mode, reject: rejectFail ? ["task.fail"] : []
      });
      const result = await coordinator.executeTask("A");
      assert.equal(result.kind, rejectFail ? "execution_failed_unfinalized" : "execution_failed_finalized");
      assert.ok(result.kind === "execution_failed_finalized" || result.kind === "execution_failed_unfinalized");
      assert.equal(result.taskId, "A");
      assert.equal(result.execution.kind, "failed");
      assert.equal(result.execution.reason, scenario.executionReason);
      if (scenario.mode.kind === "return") {
        assert.deepEqual(result.execution, {
          kind: "failed", reason: scenario.executionReason, message: "fake failure"
        });
      } else {
        assert.ok(result.execution.message.length > 0 && result.execution.message.length <= 120);
        assert.doesNotMatch(JSON.stringify(result), /secret-token|private-prompt|private-reasoning|provider-stack|\bat\b/);
      }
      assert.equal(result.finalization.ok, !rejectFail);
      if (result.finalization.ok) {
        assert.equal(result.finalization.events.length, 1);
        assert.equal(result.finalization.events[0].type, "task.failed");
        assert.deepEqual(result.finalization.events[0].payload, {
          taskId: "A", workerId: "W1", leaseId: "L1", reason: scenario.commandReason
        });
      } else {
        assert.deepEqual(result.finalization, {
          ok: false, code: "LEASE_MISMATCH", commandId: "C3", taskId: "A", workerId: "W1", leaseId: "L1"
        });
      }
      assert.equal(adapter.calls.length, 1);
      assert.deepEqual(trace, ["task.claim", "task.start", "adapter.execute", "task.fail"]);
      assert.deepEqual(commands[2], {
        id: "C3", protocolVersion: PROTOCOL_VERSION, timestamp: NOW, projectId: "P1", actor: ACTOR,
        type: "task.fail", payload: { taskId: "A", workerId: "W1", leaseId: "L1", reason: scenario.commandReason }
      });
      assert.equal(ControlPlane.getTaskGraphSnapshot(controlPlane).tasks.A.status, rejectFail ? "running" : "failed");
      assert.deepEqual(ControlPlane.getEventLogSnapshot(controlPlane).map((event) => event.type),
        rejectFail ? ["lease.created", "task.claimed", "task.started"] :
          ["lease.created", "task.claimed", "task.started", "task.failed"]);
      if (rejectFail) {
        assert.deepEqual(ControlPlane.getTaskGraphSnapshot(controlPlane), statesAtRejection[0]);
        assert.deepEqual(ControlPlane.getEventLogSnapshot(controlPlane), eventsAtRejection[0]);
        assert.ok(ControlPlane.dispatchCommand(controlPlane, { ...commands[2], id: "real-fail" }).ok);
      }
    });
  }

  test(`rejected start is ${rejectFail ? "unfinalized" : "finalized"} with the real claimed Lease`, async (t) => {
    const { coordinator, adapter, controlPlane, commands, statesAtRejection } = makeExecutionFixture(t, {
      reject: rejectFail ? ["task.start", "task.fail"] : ["task.start"]
    });
    const result = await coordinator.executeTask("A");
    assert.equal(result.kind, rejectFail ? "start_rejected_unfinalized" : "start_rejected_finalized");
    assert.ok(result.kind === "start_rejected_finalized" || result.kind === "start_rejected_unfinalized");
    assert.deepEqual(result.startRejection, {
      ok: false, code: "LEASE_MISMATCH", commandId: "C2", taskId: "A", workerId: "W1", leaseId: "L1"
    });
    assert.equal(result.finalization.ok, !rejectFail);
    if (!result.finalization.ok) {
      assert.deepEqual(result.finalization, {
        ok: false, code: "LEASE_MISMATCH", commandId: "C3", taskId: "A", workerId: "W1", leaseId: "L1"
      });
    } else {
      assert.equal(result.finalization.events[0].type, "task.failed");
      assert.deepEqual(result.finalization.events[0].payload, {
        taskId: "A", workerId: "W1", leaseId: "L1", reason: "execution_start_rejected"
      });
    }
    assert.equal(adapter.calls.length, 0);
    assert.ok(statesAtRejection.every((graph) => graph.tasks.A.status === "claimed"));
    assert.deepEqual(commands.map((command) => command.type), ["task.claim", "task.start", "task.fail"]);
    assert.deepEqual(commands[2].payload, {
      taskId: "A", workerId: "W1", leaseId: "L1", reason: "execution_start_rejected"
    });
    assert.equal(ControlPlane.getTaskGraphSnapshot(controlPlane).tasks.A.status, rejectFail ? "claimed" : "failed");
    assert.deepEqual(ControlPlane.getEventLogSnapshot(controlPlane).map((event) => event.type),
      rejectFail ? ["lease.created", "task.claimed"] : ["lease.created", "task.claimed", "task.failed"]);
    if (rejectFail) {
      // A subsequent real start proves the synthetic rejections retained the trusted Lease.
      assert.ok(ControlPlane.dispatchCommand(controlPlane, { ...commands[1], id: "real-start" }).ok);
    }
  });
}

test("factory rejects invalid workspaces without Commands or Adapter execution", (t) => {
  const { coordinatorOptions, operations, workspacePath, commands, adapter, controlPlane } = makeExecutionFixture(t);
  const filePath = join(workspacePath, "file.txt");
  writeFileSync(filePath, "not a directory");
  for (const [path, reason] of [
    ["relative", "NOT_ABSOLUTE"], [join(workspacePath, "missing"), "NOT_FOUND"], [filePath, "NOT_DIRECTORY"]
  ]) {
    const options = { ...coordinatorOptions, workspacePath: path };
    const expected = { ok: false, code: "INVALID_WORKSPACE", workspacePath: path, reason };
    assert.deepEqual(Execution.createExecutionCoordinator(options), expected);
    assert.deepEqual(createExecutionCoordinatorForTest(options, operations), expected);
  }
  assert.equal(commands.length, 0);
  assert.equal(adapter.calls.length, 0);
  assert.deepEqual(ControlPlane.getEventLogSnapshot(controlPlane), []);
});

test("public runtime facade exposes only the coordinator factory", () => {
  assert.deepEqual(Object.keys(Execution), ["createExecutionCoordinator"]);
});

type SnapshotAnomaly = "absent" | "wrong-id" | "snapshot-throw" | "post-start-copy";

// Alter only the fresh public snapshot; all Commands still reach the real plane.
function withSnapshotAnomaly(
  operations: ControlPlaneOperations,
  anomaly: SnapshotAnomaly
): ControlPlaneOperations {
  let snapshots = 0;
  return {
    ...operations,
    getTaskGraphSnapshot(plane) {
      const graph = operations.getTaskGraphSnapshot(plane);
      if (++snapshots !== 2) return graph;
      if (anomaly === "snapshot-throw") throw new Error("public snapshot unavailable");
      if (anomaly === "absent") delete graph.tasks.A;
      if (anomaly === "wrong-id") graph.tasks.A.id = "foreign-task";
      if (anomaly === "post-start-copy") {
        Object.defineProperty(graph.tasks.A, "dependencies", {
          enumerable: true,
          get() { throw new Error("public Task cannot be copied"); }
        });
      }
      return graph;
    }
  };
}

for (const anomaly of ["absent", "wrong-id", "snapshot-throw", "post-start-copy"] as const) {
  for (const rejectFail of [false, true]) {
    test(`trusted Lease ${anomaly} invariant carries ${rejectFail ? "rejected" : "accepted"} real finalization`, async (t) => {
      const { coordinatorOptions, operations, commands, adapter, controlPlane, statesAtRejection, eventsAtRejection } =
        makeExecutionFixture(t, { reject: rejectFail ? ["task.fail"] : [] });
      const created = createExecutionCoordinatorForTest(coordinatorOptions, withSnapshotAnomaly(operations, anomaly));
      assert.ok(created.ok);
      const result = await created.coordinator.executeTask("A");
      assert.equal(result.kind, "invariant_error");
      assert.ok(result.kind === "invariant_error");
      assert.equal(result.taskId, "A");
      assert.equal(result.stage, anomaly === "post-start-copy" ? "post_start" : "post_claim_snapshot");
      assert.ok(result.message.length > 0);
      assert.ok(result.finalization);
      assert.equal(result.finalization.ok, !rejectFail);
      assert.equal(adapter.calls.length, 0);
      assert.deepEqual(commands.map((command) => command.type), anomaly === "post-start-copy"
        ? ["task.claim", "task.start", "task.fail"] : ["task.claim", "task.fail"]);
      const fail = commands.at(-1)!;
      assert.deepEqual(fail.payload, {
        taskId: "A", workerId: "W1", leaseId: "L1", reason: "execution_invariant_error"
      });
      if (result.finalization.ok) {
        assert.equal(ControlPlane.getTaskGraphSnapshot(controlPlane).tasks.A.status, "failed");
        assert.equal(result.finalization.events.length, 1);
        assert.equal(result.finalization.events[0].type, "task.failed");
        assert.deepEqual(result.finalization.events[0].payload, fail.payload);
        assert.deepEqual(ControlPlane.getEventLogSnapshot(controlPlane).map((event) => event.type),
          anomaly === "post-start-copy" ? ["lease.created", "task.claimed", "task.started", "task.failed"]
            : ["lease.created", "task.claimed", "task.failed"]);
      } else {
        assert.deepEqual(result.finalization, {
          ok: false, code: "LEASE_MISMATCH", commandId: fail.id,
          taskId: "A", workerId: "W1", leaseId: "L1"
        });
        assert.deepEqual(ControlPlane.getTaskGraphSnapshot(controlPlane), statesAtRejection[0]);
        assert.deepEqual(ControlPlane.getEventLogSnapshot(controlPlane), eventsAtRejection[0]);
        assert.equal(ControlPlane.getTaskGraphSnapshot(controlPlane).tasks.A.status,
          anomaly === "post-start-copy" ? "running" : "claimed");
        assert.ok(ControlPlane.dispatchCommand(controlPlane, { ...fail, id: "real-invariant-fail" }).ok);
      }
    });
  }
}

test("busy gate rejects overlap without Commands and remains held until the Adapter settles", async (t) => {
  const { coordinator, adapter, commands, controlPlane } = makeExecutionFixture(t, { adapterMode: { kind: "deferred" } });
  const called = adapter.waitUntilCalled();
  const first = coordinator.executeTask("A");
  await called;
  const graph = ControlPlane.getTaskGraphSnapshot(controlPlane);
  const events = ControlPlane.getEventLogSnapshot(controlPlane);
  try {
    assert.deepEqual(await coordinator.executeTask("A"), { kind: "worker_busy", taskId: "A" });
    assert.deepEqual(await coordinator.executeTask("B"), { kind: "worker_busy", taskId: "B" });
    assert.equal(adapter.calls.length, 1);
    assert.deepEqual(commands.map((command) => command.type), ["task.claim", "task.start"]);
    assert.deepEqual(ControlPlane.getTaskGraphSnapshot(controlPlane), graph);
    assert.deepEqual(ControlPlane.getEventLogSnapshot(controlPlane), events);
  } finally {
    adapter.resolve({ kind: "succeeded" });
    await first;
  }
  assert.equal((await coordinator.executeTask("A")).kind, "admission_rejected");
});

test("busy gate belongs to one Coordinator even when worker and Control Plane are shared", async (t) => {
  const { coordinator, coordinatorOptions, adapter, controlPlane } = makeExecutionFixture(t, {
    adapterMode: { kind: "deferred" },
    graph: { projectId: "P1", rootTaskIds: ["A", "Q"], tasks: { A: makeTask("A"), Q: makeTask("Q") } }
  });
  const otherAdapter = new FakeAdapter({ kind: "deferred" });
  const other = Execution.createExecutionCoordinator({ ...coordinatorOptions, adapter: otherAdapter });
  assert.ok(other.ok);
  const first = coordinator.executeTask("A");
  await adapter.waitUntilCalled();
  const second = other.coordinator.executeTask("Q");
  await otherAdapter.waitUntilCalled();
  assert.equal(ControlPlane.getTaskGraphSnapshot(controlPlane).tasks.Q.status, "running");
  adapter.resolve({ kind: "succeeded" });
  otherAdapter.resolve({ kind: "succeeded" });
  assert.equal((await first).kind, "submitted_for_review");
  assert.equal((await second).kind, "submitted_for_review");
});

for (const preAborted of [false, true]) {
  test(`caller signal is forwarded unchanged (${preAborted ? "already aborted" : "aborted in flight"})`, async (t) => {
    const { coordinator, adapter, commands } = makeExecutionFixture(t, { adapterMode: { kind: "deferred" } });
    const controller = new AbortController();
    if (preAborted) controller.abort();
    const attempt = coordinator.executeTask("A", { signal: controller.signal });
    await adapter.waitUntilCalled();
    try {
      assert.strictEqual(adapter.calls[0].signal, controller.signal);
      if (!preAborted) controller.abort();
      assert.equal(adapter.calls[0].signal.aborted, true);
      assert.deepEqual(commands.map((command) => command.type), ["task.claim", "task.start"]);
    } finally {
      adapter.resolve({ kind: "succeeded" });
    }
    assert.equal((await attempt).kind, "submitted_for_review");
  });
}

const exitCases: {
  name: string;
  expected: Execution.ExecutionAttemptResult["kind"] | "throws";
  reject?: FlowctlCommand["type"][];
  adapterMode?: FakeAdapterMode;
  deferredResult?: Execution.ExecutionResult;
  deferredReject?: boolean;
  anomaly?: SnapshotAnomaly | "missing-lease";
  throwAt?: "initial-snapshot" | "task.start" | "task.complete" | "task.fail";
}[] = [
  { name: "admission rejection", expected: "admission_rejected" },
  { name: "start rejection finalized", expected: "start_rejected_finalized", reject: ["task.start"] },
  { name: "start rejection unfinalized", expected: "start_rejected_unfinalized", reject: ["task.start", "task.fail"] },
  { name: "review submission", expected: "submitted_for_review", adapterMode: { kind: "deferred" }, deferredResult: { kind: "succeeded" } },
  { name: "failure finalized", expected: "execution_failed_finalized", adapterMode: { kind: "deferred" }, deferredResult: { kind: "failed", reason: "execution_failed", message: "failed" } },
  { name: "failure unfinalized", expected: "execution_failed_unfinalized", reject: ["task.fail"], adapterMode: { kind: "deferred" }, deferredResult: { kind: "failed", reason: "execution_failed", message: "failed" } },
  { name: "completion rejection finalized", expected: "completion_rejected_finalized", reject: ["task.complete"] },
  { name: "completion rejection unfinalized", expected: "completion_rejected_unfinalized", reject: ["task.complete", "task.fail"] },
  { name: "Adapter throw", expected: "execution_failed_finalized", adapterMode: { kind: "throw", error: new Error("adapter throw") } },
  { name: "Adapter throw unfinalized", expected: "execution_failed_unfinalized", reject: ["task.fail"], adapterMode: { kind: "throw", error: new Error("adapter throw") } },
  { name: "Adapter rejection", expected: "execution_failed_finalized", adapterMode: { kind: "deferred" }, deferredReject: true },
  { name: "Adapter rejection unfinalized", expected: "execution_failed_unfinalized", reject: ["task.fail"], adapterMode: { kind: "deferred" }, deferredReject: true },
  { name: "missing Lease invariant", expected: "invariant_error", anomaly: "missing-lease" },
  { name: "trusted Lease invariant finalized", expected: "invariant_error", anomaly: "absent" },
  { name: "trusted Lease invariant unfinalized", expected: "invariant_error", anomaly: "absent", reject: ["task.fail"] },
  { name: "snapshot exception", expected: "invariant_error", anomaly: "snapshot-throw" },
  { name: "post-start invariant finalized", expected: "invariant_error", anomaly: "post-start-copy" },
  { name: "post-start invariant unfinalized", expected: "invariant_error", anomaly: "post-start-copy", reject: ["task.fail"] },
  { name: "initial programming error", expected: "throws", throwAt: "initial-snapshot" },
  { name: "start public-operation exception", expected: "invariant_error", throwAt: "task.start" },
  { name: "completion public-operation exception", expected: "invariant_error", throwAt: "task.complete" },
  { name: "finalization programming error", expected: "throws", throwAt: "task.fail", reject: ["task.start"] }
];

for (const scenario of exitCases) {
  test(`busy gate releases after ${scenario.name} and guards the subsequent attempt`, async (t) => {
    const rejected = [...(scenario.reject ?? [])];
    const { coordinatorOptions, operations, adapter, commands, controlPlane } = makeExecutionFixture(t, {
      adapterMode: scenario.adapterMode, reject: rejected,
      graph: { projectId: "P1", rootTaskIds: ["A", "Q"], tasks: { A: makeTask("A"), Q: makeTask("Q") } }
    });
    const anomalyOps = scenario.anomaly && scenario.anomaly !== "missing-lease"
      ? withSnapshotAnomaly(operations, scenario.anomaly) : operations;
    let initial = true;
    let throwingCommandCalls = 0;
    const bug = new Error("injected programming error");
    const created = createExecutionCoordinatorForTest(coordinatorOptions, {
      getTaskGraphSnapshot(plane) {
        if (initial && scenario.throwAt === "initial-snapshot") { initial = false; throw bug; }
        return anomalyOps.getTaskGraphSnapshot(plane);
      },
      dispatchCommand(plane, command) {
        if ("taskId" in command.payload && command.payload.taskId === "A" && command.type === scenario.throwAt) {
          throwingCommandCalls++;
          throw bug;
        }
        const result = anomalyOps.dispatchCommand(plane, command);
        return scenario.anomaly === "missing-lease" && command.type === "task.claim" && command.payload.taskId === "A" && result.ok
          ? { ok: true, events: [] } : result;
      }
    });
    assert.ok(created.ok);
    const { coordinator } = created;
    const first = coordinator.executeTask(scenario.expected === "admission_rejected" ? "missing" : "A");
    if (scenario.adapterMode?.kind === "deferred") {
      await adapter.waitUntilCalled();
      if (scenario.deferredReject) adapter.reject(new Error("adapter rejection"));
      else adapter.resolve(scenario.deferredResult!);
    }
    if (scenario.expected === "throws") await assert.rejects(first, (error) => error === bug);
    else {
      const result = await first;
      assert.equal(result.kind, scenario.expected);
      if (result.kind === "invariant_error") {
        assert.equal(result.stage, scenario.anomaly === "missing-lease" ? "lease_extraction"
          : scenario.anomaly === "post-start-copy" || scenario.throwAt === "task.complete" ? "post_start"
            : "post_claim_snapshot");
        if (scenario.anomaly === "missing-lease") {
          assert.equal(Object.hasOwn(result, "finalization"), false);
          assert.deepEqual(commands.map((command) => command.type), ["task.claim"]);
        } else {
          assert.equal(result.finalization?.ok, !rejected.includes("task.fail"));
          assert.deepEqual(commands.at(-1)?.payload, {
            taskId: "A", workerId: "W1", leaseId: "L1", reason: "execution_invariant_error"
          });
          if (result.finalization?.ok) {
            assert.equal(ControlPlane.getTaskGraphSnapshot(controlPlane).tasks.A.status, "failed");
          }
        }
      }
    }
    if (scenario.throwAt && scenario.throwAt !== "initial-snapshot") assert.equal(throwingCommandCalls, 1);

    rejected.length = 0;
    adapter.setMode({ kind: "deferred" });
    const callCount = adapter.calls.length;
    const next = coordinator.executeTask("Q");
    // Also observe settlement so a stuck gate fails promptly instead of hanging.
    const entered = await Promise.race([
      adapter.waitUntilCalled(callCount + 1).then(() => true), next.then(() => false)
    ]);
    assert.equal(entered, true, "subsequent attempt must reach the Adapter");
    const commandCount = commands.length;
    try {
      assert.equal(ControlPlane.getTaskGraphSnapshot(controlPlane).tasks.Q.status, "running");
      assert.deepEqual(await coordinator.executeTask("Q"), { kind: "worker_busy", taskId: "Q" });
      assert.equal(commands.length, commandCount);
      assert.equal(adapter.calls.length, callCount + 1);
    } finally {
      adapter.resolve({ kind: "succeeded" });
      await next;
    }
    assert.equal((await next).kind, "submitted_for_review");
    assert.equal((await coordinator.executeTask("missing")).kind, "admission_rejected");
  });
}

test("missing current claim Lease yields an invariant without fabricated finalization", async (t) => {
  const { coordinatorOptions, operations, commands, adapter } = makeExecutionFixture(t);
  const created = createExecutionCoordinatorForTest(coordinatorOptions, {
    ...operations,
    dispatchCommand(plane, command) {
      const result = operations.dispatchCommand(plane, command);
      return command.type === "task.claim" && result.ok ? { ok: true, events: [] } : result;
    }
  });
  assert.ok(created.ok);
  const result = await created.coordinator.executeTask("A");
  assert.equal(result.kind, "invariant_error");
  if (result.kind !== "invariant_error") return;
  assert.equal(result.stage, "lease_extraction");
  assert.equal(result.finalization, undefined);
  assert.equal(adapter.calls.length, 0);
  assert.deepEqual(commands.map((command) => command.type), ["task.claim"]);
});

for (const mismatch of ["project", "task", "worker", "duplicate"] as const) {
  test(`claim Lease ${mismatch} anomaly cannot authorize execution or fabricated recovery`, async (t) => {
    const { coordinatorOptions, operations, commands, adapter, controlPlane } = makeExecutionFixture(t);
    const created = createExecutionCoordinatorForTest(coordinatorOptions, {
      ...operations,
      dispatchCommand(plane, command) {
        const result = operations.dispatchCommand(plane, command);
        if (command.type !== "task.claim" || !result.ok) return result;
        const events = [...result.events];
        const leaseEvent = events.find((event) => event.type === "lease.created");
        assert.ok(leaseEvent);
        if (mismatch === "project") leaseEvent.projectId = "foreign-project";
        if (mismatch === "task") leaseEvent.payload.lease.taskId = "foreign-task";
        if (mismatch === "worker") leaseEvent.payload.lease.workerId = "foreign-worker";
        if (mismatch === "duplicate") events.push(structuredClone(leaseEvent));
        return { ok: true, events };
      }
    });
    assert.ok(created.ok);
    const result = await created.coordinator.executeTask("A");
    assert.equal(result.kind, "invariant_error");
    if (result.kind !== "invariant_error") return;
    assert.equal(result.stage, "lease_extraction");
    assert.equal(result.finalization, undefined);
    assert.equal(adapter.calls.length, 0);
    assert.deepEqual(commands.map((command) => command.type), ["task.claim"]);
    const actualLease = ControlPlane.getEventLogSnapshot(controlPlane)[0];
    assert.equal(actualLease.type, "lease.created");
    if (actualLease.type !== "lease.created") return;
    assert.equal(actualLease.projectId, "P1");
    assert.equal(actualLease.payload.lease.taskId, "A");
    assert.equal(actualLease.payload.lease.workerId, "W1");
  });
}

test("post-claim lookup ignores inherited Tasks and finalizes with the trusted Lease", async (t) => {
  const { coordinatorOptions, operations, commands, adapter, controlPlane } = makeExecutionFixture(t);
  let snapshots = 0;
  const created = createExecutionCoordinatorForTest(coordinatorOptions, {
    ...operations,
    getTaskGraphSnapshot(plane) {
      const graph = operations.getTaskGraphSnapshot(plane);
      if (++snapshots === 2) {
        const task = graph.tasks.A;
        delete graph.tasks.A;
        Object.setPrototypeOf(graph.tasks, { A: task });
      }
      return graph;
    }
  });
  assert.ok(created.ok);
  const result = await created.coordinator.executeTask("A");
  assert.equal(result.kind, "invariant_error");
  if (result.kind !== "invariant_error") return;
  assert.equal(result.stage, "post_claim_snapshot");
  assert.equal(result.finalization?.ok, true);
  assert.equal(adapter.calls.length, 0);
  assert.deepEqual(commands.map((command) => command.type), ["task.claim", "task.fail"]);
  assert.equal(ControlPlane.getTaskGraphSnapshot(controlPlane).tasks.A.status, "failed");
});

test("already-leased admission rejects before Adapter execution and preserves state", async (t) => {
  const { coordinator, adapter, controlPlane, commands } = makeExecutionFixture(t);
  assert.ok(ControlPlane.dispatchCommand(controlPlane, {
    id: "external-claim", protocolVersion: PROTOCOL_VERSION, timestamp: NOW,
    projectId: "P1", actor: ACTOR, type: "task.claim", payload: { taskId: "A", workerId: "another-worker" }
  }).ok);
  const before = ControlPlane.getTaskGraphSnapshot(controlPlane);
  const eventsBefore = ControlPlane.getEventLogSnapshot(controlPlane);
  const result = await coordinator.executeTask("A");
  assert.equal(result.kind, "admission_rejected");
  if (result.kind !== "admission_rejected") return;
  assert.equal(result.rejection.code, "TASK_ALREADY_LEASED");
  assert.equal(adapter.calls.length, 0);
  assert.deepEqual(commands.map((command) => command.type), ["task.claim"]);
  assert.deepEqual(ControlPlane.getTaskGraphSnapshot(controlPlane), before);
  assert.deepEqual(ControlPlane.getEventLogSnapshot(controlPlane), eventsBefore);
});

test("stale ready selection is re-admitted by the real Control Plane", async (t) => {
  const { coordinator, adapter, controlPlane, commands } = makeExecutionFixture(t);
  assert.equal(ControlPlane.getTaskGraphSnapshot(controlPlane).tasks.A.status, "ready");
  const envelope = { protocolVersion: PROTOCOL_VERSION, timestamp: NOW, projectId: "P1", actor: ACTOR };
  assert.ok(ControlPlane.dispatchCommand(controlPlane, {
    ...envelope, id: "external-claim", type: "task.claim", payload: { taskId: "A", workerId: "W2" }
  }).ok);
  assert.ok(ControlPlane.dispatchCommand(controlPlane, {
    ...envelope, id: "external-fail", type: "task.fail",
    payload: { taskId: "A", workerId: "W2", leaseId: "L1", reason: "execution_failed" }
  }).ok);
  const before = ControlPlane.getTaskGraphSnapshot(controlPlane);
  const eventsBefore = ControlPlane.getEventLogSnapshot(controlPlane);
  const result = await coordinator.executeTask("A");
  assert.equal(result.kind, "admission_rejected");
  if (result.kind !== "admission_rejected") return;
  assert.equal(result.rejection.code, "TASK_NOT_READY");
  assert.equal(adapter.calls.length, 0);
  assert.deepEqual(commands.map((command) => command.type), ["task.claim"]);
  assert.deepEqual(ControlPlane.getTaskGraphSnapshot(controlPlane), before);
  assert.deepEqual(ControlPlane.getEventLogSnapshot(controlPlane), eventsBefore);
});

for (const taskId of ["missing", "toString", "constructor", "__proto__"]) {
  test(`absent own-key Task ${taskId} is rejected before execution`, async (t) => {
    const { coordinator, adapter, controlPlane } = makeExecutionFixture(t);
    const result = await coordinator.executeTask(taskId);
    assert.equal(result.kind, "admission_rejected");
    if (result.kind !== "admission_rejected") return;
    assert.equal(result.rejection.code, "TASK_NOT_FOUND");
    assert.equal(adapter.calls.length, 0);
    assert.deepEqual(ControlPlane.getEventLogSnapshot(controlPlane), []);
  });
}

for (const taskId of ["toString", "constructor", "__proto__"]) {
  test(`canonical own-key Task ${taskId} can execute through review`, async (t) => {
    const { coordinator, adapter, controlPlane } = makeExecutionFixture(t, {
      graph: { projectId: "P-own", rootTaskIds: [taskId], tasks: { [taskId]: makeTask(taskId) } }
    });
    const result = await coordinator.executeTask(taskId);
    assert.equal(result.kind, "submitted_for_review");
    assert.equal(adapter.calls[0].task.id, taskId);
    assert.equal(ControlPlane.getTaskGraphSnapshot(controlPlane).tasks[taskId].status, "review");
  });
}

test("successive attempts use their own claim Events rather than historical Leases", async (t) => {
  const { coordinator, adapter, commands } = makeExecutionFixture(t, {
    graph: { projectId: "P1", rootTaskIds: ["A", "Q"], tasks: { A: makeTask("A"), Q: makeTask("Q") } }
  });
  assert.equal((await coordinator.executeTask("Q")).kind, "submitted_for_review");
  assert.equal((await coordinator.executeTask("A")).kind, "submitted_for_review");
  assert.equal(adapter.calls[0].leaseId, "L1");
  assert.equal(adapter.calls[1].leaseId, "L2");
  assert.deepEqual(commands[4].payload, { taskId: "A", workerId: "W1", leaseId: "L2" });
  assert.deepEqual(commands[5].payload, { taskId: "A", workerId: "W1", leaseId: "L2" });
});

test("Adapter Task and nested arrays are defensive copies of the fresh snapshot", async (t) => {
  const { coordinatorOptions, operations, adapter, controlPlane } = makeExecutionFixture(t);
  const snapshots: TaskGraph[] = [];
  const created = createExecutionCoordinatorForTest(coordinatorOptions, {
    ...operations,
    getTaskGraphSnapshot(plane) {
      const graph = operations.getTaskGraphSnapshot(plane);
      snapshots.push(graph);
      return graph;
    }
  });
  assert.ok(created.ok);
  assert.equal((await created.coordinator.executeTask("A")).kind, "submitted_for_review");
  assert.equal(snapshots.length, 2);
  assert.equal(snapshots[0].tasks.A.status, "ready");
  assert.equal(snapshots[1].tasks.A.status, "claimed");
  const input = adapter.calls[0];
  const before = ControlPlane.getTaskGraphSnapshot(controlPlane);
  input.task.dependencies.push("foreign-dependency");
  input.task.acceptanceCriteria[0].description = "mutated criterion";
  input.task.acceptanceCriteria.push({ id: "foreign", description: "foreign" });
  assert.deepEqual(snapshots[1].tasks.A.dependencies, []);
  assert.deepEqual(snapshots[1].tasks.A.acceptanceCriteria, [{ id: "AC1", description: "review the result" }]);
  assert.deepEqual(ControlPlane.getTaskGraphSnapshot(controlPlane), before);
});

for (const failed of [false, true]) {
  test(`returned ${failed ? "failure" : "completion"} Events cannot mutate Event Log history`, async (t) => {
    const { coordinator, controlPlane } = makeExecutionFixture(t, failed ? {
      adapterMode: { kind: "return", result: { kind: "failed", reason: "execution_failed", message: "fake failure" } }
    } : {});
    const result = await coordinator.executeTask("A");
    assert.ok(result.kind === "submitted_for_review" || result.kind === "execution_failed_finalized");
    const events = result.kind === "submitted_for_review" ? result.completion.events : result.finalization.events;
    assert.equal(events.length, 1);
    const before = ControlPlane.getEventLogSnapshot(controlPlane);
    const event = events[0];
    assert.ok(event.type === "task.review_requested" || event.type === "task.failed");
    event.actor.id = "mutated actor";
    event.payload.taskId = "foreign-task";
    event.payload.leaseId = "foreign-lease";
    assert.deepEqual(ControlPlane.getEventLogSnapshot(controlPlane), before);
  });
}
