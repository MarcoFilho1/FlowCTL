import type { FlowctlCommand, FlowctlEvent } from "@flowctl/protocol";
import {
  createClaimCommand,
  createCompleteCommand,
  createReviewApproveCommand,
  createStartCommand
} from "../src/demo/command-factory.js";
import {
  createDemoRuntime,
  dispatchAndSync,
  getPlaygroundSnapshot
} from "../src/demo/runtime.js";
import { getLeaseIdForTask } from "../src/model/lease-projection.js";

test("command factories emit the exact public Protocol shapes", () => {
  expect(createClaimCommand("A", "demo-command-1")).toEqual({
    id: "demo-command-1",
    protocolVersion: "0.2",
    timestamp: "2026-09-08T00:00:00.000Z",
    projectId: "demo-project",
    actor: { type: "user", id: "playground" },
    type: "task.claim",
    payload: { taskId: "A", workerId: "demo-worker" }
  });
  expect(createStartCommand("A", "demo-lease-1", "demo-command-2")).toEqual({
    id: "demo-command-2",
    protocolVersion: "0.2",
    timestamp: "2026-09-08T00:00:00.000Z",
    projectId: "demo-project",
    actor: { type: "user", id: "playground" },
    type: "task.start",
    payload: { taskId: "A", workerId: "demo-worker", leaseId: "demo-lease-1" }
  });
  expect(createCompleteCommand("A", "demo-lease-1", "demo-command-3")).toEqual({
    id: "demo-command-3",
    protocolVersion: "0.2",
    timestamp: "2026-09-08T00:00:00.000Z",
    projectId: "demo-project",
    actor: { type: "user", id: "playground" },
    type: "task.complete",
    payload: { taskId: "A", workerId: "demo-worker", leaseId: "demo-lease-1" }
  });
  expect(createReviewApproveCommand("A", "demo-command-4")).toEqual({
    id: "demo-command-4",
    protocolVersion: "0.2",
    timestamp: "2026-09-08T00:00:00.000Z",
    projectId: "demo-project",
    actor: { type: "user", id: "playground" },
    type: "task.review.approve",
    payload: { taskId: "A" }
  });
});

test("runtime exercises claim, start, complete, and review approval through public dispatch", () => {
  const runtime = createDemoRuntime();

  const claimed = dispatchAndSync(
    runtime,
    createClaimCommand("A", runtime.nextCommandId()),
    2
  );
  expect(claimed.result.ok).toBe(true);
  expect(claimed.result.ok && claimed.result.events.map((event) => event.type)).toEqual([
    "lease.created",
    "task.claimed"
  ]);
  expect(claimed.snapshot.graph.tasks.A.status).toBe("claimed");
  const leaseId = getLeaseIdForTask(claimed.snapshot.events, "A");
  expect(leaseId).toBe("demo-lease-1");

  const started = dispatchAndSync(
    runtime,
    createStartCommand("A", leaseId!, runtime.nextCommandId()),
    2
  );
  expect(started.result.ok && started.result.events.map((event) => event.type)).toEqual([
    "task.started"
  ]);
  expect(started.snapshot.graph.tasks.A.status).toBe("running");
  expect(started.snapshot.events.map((event) => event.type)).toEqual([
    "lease.created",
    "task.claimed",
    "task.started"
  ]);

  const completed = dispatchAndSync(
    runtime,
    createCompleteCommand("A", leaseId!, runtime.nextCommandId()),
    2
  );
  expect(completed.result.ok && completed.result.events.map((event) => event.type)).toEqual([
    "task.review_requested"
  ]);
  expect(completed.snapshot.graph.tasks.A.status).toBe("review");

  const approved = dispatchAndSync(
    runtime,
    createReviewApproveCommand("A", runtime.nextCommandId()),
    2
  );
  expect(approved.result.ok && approved.result.events.map((event) => event.type)).toEqual([
    "task.completed",
    "task.ready",
    "task.ready"
  ]);
  expect(approved.snapshot.graph.tasks.A.status).toBe("completed");
  expect(approved.snapshot.graph.tasks.B.status).toBe("ready");
  expect(approved.snapshot.graph.tasks.C.status).toBe("ready");
  expect(approved.snapshot.readyTaskIds).toEqual(["B", "C"]);
  expect(approved.snapshot.candidateTaskIds).toEqual(["B", "C"]);
  expect(approved.snapshot.events).toHaveLength(7);
});

test("runtime materializes the complete A to B/C to D progression at scheduler limit 2", () => {
  const runtime = createDemoRuntime();

  function approve(taskId: string) {
    const claimed = dispatchAndSync(
      runtime,
      createClaimCommand(taskId, runtime.nextCommandId()),
      2
    );
    const leaseId = getLeaseIdForTask(claimed.snapshot.events, taskId);
    if (!leaseId) {
      throw new Error(`Expected a Lease for ${taskId}.`);
    }
    dispatchAndSync(runtime, createStartCommand(taskId, leaseId, runtime.nextCommandId()), 2);
    dispatchAndSync(runtime, createCompleteCommand(taskId, leaseId, runtime.nextCommandId()), 2);
    return dispatchAndSync(runtime, createReviewApproveCommand(taskId, runtime.nextCommandId()), 2);
  }

  const initial = getPlaygroundSnapshot(runtime, 2, null);
  expect(initial.readyTaskIds).toEqual(["A"]);
  expect(initial.candidateTaskIds).toEqual(["A"]);

  const afterA = approve("A").snapshot;
  expect(afterA.readyTaskIds).toEqual(["B", "C"]);
  expect(afterA.candidateTaskIds).toEqual(["B", "C"]);

  const afterB = approve("B").snapshot;
  expect(afterB.graph.tasks.B.status).toBe("completed");
  expect(afterB.graph.tasks.C.status).toBe("ready");
  expect(afterB.graph.tasks.D.status).toBe("pending");
  expect(afterB.readyTaskIds).toEqual(["C"]);
  expect(afterB.candidateTaskIds).toEqual(["C"]);

  const afterC = approve("C").snapshot;
  expect(afterC.graph.tasks.C.status).toBe("completed");
  expect(afterC.graph.tasks.D.status).toBe("ready");
  expect(afterC.readyTaskIds).toEqual(["D"]);
  expect(afterC.candidateTaskIds).toEqual(["D"]);
  expect(afterC.events.map((event) => event.type)).toEqual([
    "lease.created",
    "task.claimed",
    "task.started",
    "task.review_requested",
    "task.completed",
    "task.ready",
    "task.ready",
    "lease.created",
    "task.claimed",
    "task.started",
    "task.review_requested",
    "task.completed",
    "lease.created",
    "task.claimed",
    "task.started",
    "task.review_requested",
    "task.completed",
    "task.ready"
  ]);
});

test("changing scheduler limits changes only candidates, never tasks, Events, or Lease history", () => {
  const runtime = createDemoRuntime();
  const claimed = dispatchAndSync(
    runtime,
    createClaimCommand("A", runtime.nextCommandId()),
    2
  );
  const leaseId = getLeaseIdForTask(claimed.snapshot.events, "A");
  if (!leaseId) {
    throw new Error("Expected a Lease for A.");
  }
  dispatchAndSync(runtime, createStartCommand("A", leaseId, runtime.nextCommandId()), 2);
  dispatchAndSync(runtime, createCompleteCommand("A", leaseId, runtime.nextCommandId()), 2);
  const approved = dispatchAndSync(
    runtime,
    createReviewApproveCommand("A", runtime.nextCommandId()),
    2
  );
  const before = getPlaygroundSnapshot(runtime, 2, approved.result);
  const limited = getPlaygroundSnapshot(runtime, 1, approved.result);

  expect(before.candidateTaskIds).toEqual(["B", "C"]);
  expect(limited.candidateTaskIds).toEqual(["B"]);
  expect(limited.graph).toEqual(before.graph);
  expect(limited.readyTaskIds).toEqual(["B", "C"]);
  expect(limited.events).toEqual(before.events);
  expect(getLeaseIdForTask(limited.events, "A")).toBe("demo-lease-1");
});

test("rejected dispatches return a failure without mutating graph or accumulated history", () => {
  const runtime = createDemoRuntime();
  const before = getPlaygroundSnapshot(runtime, 1, null);
  const rejected = dispatchAndSync(
    runtime,
    createStartCommand("A", "missing-lease", runtime.nextCommandId()),
    1
  );

  expect(rejected.result).toMatchObject({
    ok: false,
    code: "INVALID_TASK_TRANSITION",
    commandId: "demo-command-1",
    taskId: "A",
    from: "ready",
    to: "running"
  });
  expect(rejected.snapshot.graph).toEqual(before.graph);
  expect(rejected.snapshot.events).toEqual([]);
  expect(rejected.snapshot.lastResult).toEqual(rejected.result);
});

test("runtime snapshots and dispatch results are defensive at command, Event, and result boundaries", () => {
  const runtime = createDemoRuntime();
  const command = createClaimCommand("A", runtime.nextCommandId());
  const dispatched = dispatchAndSync(runtime, command, 1);

  command.actor.id = "mutated";
  if (command.type !== "task.claim") {
    throw new Error("Expected a claim command.");
  }
  command.payload.taskId = "mutated";
  expect(createClaimCommand("A", "independent-command").actor).toEqual({
    type: "user",
    id: "playground"
  });
  if (!dispatched.result.ok || dispatched.result.events[0]?.type !== "lease.created") {
    throw new Error("Expected accepted claim Events.");
  }

  dispatched.result.events[0].actor.id = "mutated-result";
  dispatched.result.events[0].payload.lease.id = "mutated-result-lease";
  const mutableSnapshotEvents = dispatched.snapshot.events as FlowctlEvent[];
  if (mutableSnapshotEvents[0]?.type !== "lease.created") {
    throw new Error("Expected lease.created in snapshot.");
  }
  mutableSnapshotEvents[0].actor.id = "mutated-snapshot";
  mutableSnapshotEvents[0].payload.lease.id = "mutated-snapshot-lease";
  if (dispatched.snapshot.lastResult?.ok) {
    dispatched.snapshot.lastResult.events[0].actor.id = "mutated-snapshot-result";
  }

  const fresh = getPlaygroundSnapshot(runtime, 1, null);
  expect(fresh.events[0]).toMatchObject({
    actor: { type: "user", id: "playground" },
    type: "lease.created",
    payload: { lease: { id: "demo-lease-1", taskId: "A" } }
  });
  expect(fresh.graph.tasks.A.status).toBe("claimed");
});

test("Lease projection reads only lease.created Events and uses the latest matching Event", () => {
  const base = {
    protocolVersion: "0.2",
    timestamp: "2026-09-08T00:00:01.000Z",
    projectId: "demo-project",
    actor: { type: "user", id: "playground" }
  } as const;
  const events: FlowctlEvent[] = [
    {
      ...base,
      id: "demo-event-1",
      type: "lease.created",
      payload: {
        lease: {
          id: "lease-old",
          taskId: "A",
          workerId: "demo-worker",
          acquiredAt: base.timestamp,
          expiresAt: "2026-09-08T01:00:01.000Z",
          lastHeartbeatAt: base.timestamp
        }
      }
    },
    {
      ...base,
      id: "demo-event-2",
      type: "task.started",
      payload: { taskId: "A", workerId: "demo-worker", leaseId: "ignored" }
    },
    {
      ...base,
      id: "demo-event-3",
      type: "lease.created",
      payload: {
        lease: {
          id: "lease-latest",
          taskId: "A",
          workerId: "demo-worker",
          acquiredAt: base.timestamp,
          expiresAt: "2026-09-08T01:00:01.000Z",
          lastHeartbeatAt: base.timestamp
        }
      }
    }
  ];

  expect(getLeaseIdForTask(events, "A")).toBe("lease-latest");
  expect(getLeaseIdForTask(events, "B")).toBeUndefined();
});

test("fresh runtimes own independent command, Event, and Lease counters", () => {
  const first = createDemoRuntime();
  dispatchAndSync(first, createClaimCommand("A", first.nextCommandId()), 1);
  const second = createDemoRuntime();
  const resetClaim = dispatchAndSync(
    second,
    createClaimCommand("A", second.nextCommandId()),
    1
  );

  expect(first.nextCommandId()).toBe("demo-command-2");
  expect(resetClaim.result.ok && resetClaim.result.events[0]).toMatchObject({
    id: "demo-event-1",
    type: "lease.created",
    payload: { lease: { id: "demo-lease-1" } }
  });
  expect(resetClaim.snapshot.lastResult).toEqual(resetClaim.result);
});

test("public runtime accepts the complete FlowctlCommand union at its boundary", () => {
  const runtime = createDemoRuntime();
  const unsupported: FlowctlCommand = {
    id: runtime.nextCommandId(),
    protocolVersion: "0.2",
    timestamp: "2026-09-08T00:00:00.000Z",
    projectId: "demo-project",
    actor: { type: "user", id: "playground" },
    type: "graph.mutation.propose",
    payload: {
      mutation: {
        id: "mutation-1",
        reason: "Exercise the unsupported-command boundary.",
        operations: []
      }
    }
  };

  expect(dispatchAndSync(runtime, unsupported, 1).result).toMatchObject({
    ok: false,
    code: "UNSUPPORTED_COMMAND",
    commandId: "demo-command-1",
    commandType: "graph.mutation.propose"
  });
});
