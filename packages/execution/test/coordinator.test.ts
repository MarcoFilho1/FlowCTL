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
