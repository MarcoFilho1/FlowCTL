import {
  applyTaskTransition,
  createCoreState,
  getTaskGraphSnapshot as getCoreTaskGraphSnapshot,
  isTaskTransitionAllowed
} from "@flowctl/core";
import type { FlowctlCommand, FlowctlEvent, Lease } from "@flowctl/protocol";
import { copyActor, copyEvents, copyLease } from "./command-copy.js";
import type { CommandProcessingResult } from "./results.js";
import {
  readControlPlaneState,
  replaceControlPlaneState,
  type ControlPlane,
  type ControlPlaneState
} from "./state.js";
import { getCanonicalTask } from "./task-lookup.js";

export function dispatchClaimCommand(
  controlPlane: ControlPlane,
  command: Extract<FlowctlCommand, { type: "task.claim" }>
): CommandProcessingResult {
  const currentState = readControlPlaneState(controlPlane);
  const taskGraph = getCoreTaskGraphSnapshot(currentState.coreState);
  const taskId = command.payload.taskId;
  const task = getCanonicalTask(taskGraph, taskId);

  if (task === undefined) {
    return {
      ok: false,
      code: "TASK_NOT_FOUND",
      commandId: command.id,
      taskId
    };
  }

  if (currentState.activeLeaseByTaskId.get(taskId) !== undefined) {
    return {
      ok: false,
      code: "TASK_ALREADY_LEASED",
      commandId: command.id,
      taskId
    };
  }

  if (task.status !== "ready") {
    return {
      ok: false,
      code: "TASK_NOT_READY",
      commandId: command.id,
      taskId
    };
  }

  if (!isTaskTransitionAllowed(task.status, "claimed")) {
    return {
      ok: false,
      code: "INVALID_TASK_TRANSITION",
      commandId: command.id,
      taskId,
      from: task.status,
      to: "claimed"
    };
  }

  const actor = copyActor(command.actor);
  const timestamp = currentState.options.now();
  const leaseId = currentState.options.nextLeaseId();
  const expiresAt = currentState.options.leaseExpiresAt(timestamp);
  const leaseCreatedEventId = currentState.options.nextEventId();
  const taskClaimedEventId = currentState.options.nextEventId();

  const lease: Lease = {
    id: leaseId,
    taskId,
    workerId: command.payload.workerId,
    acquiredAt: timestamp,
    expiresAt,
    lastHeartbeatAt: timestamp
  };

  const stagedEvents: FlowctlEvent[] = [
    {
      id: leaseCreatedEventId,
      protocolVersion: command.protocolVersion,
      timestamp,
      projectId: command.projectId,
      actor: copyActor(actor),
      type: "lease.created",
      payload: { lease: copyLease(lease) }
    },
    {
      id: taskClaimedEventId,
      protocolVersion: command.protocolVersion,
      timestamp,
      projectId: command.projectId,
      actor: copyActor(actor),
      type: "task.claimed",
      payload: {
        taskId,
        workerId: command.payload.workerId,
        leaseId
      }
    }
  ];

  const candidateCoreState = recreateCoreState(currentState);
  const candidateState: ControlPlaneState = {
    projectId: currentState.projectId,
    coreState: candidateCoreState,
    activeLeaseByTaskId: new Map(
      [...currentState.activeLeaseByTaskId].map(([activeTaskId, activeLease]) => [
        activeTaskId,
        copyLease(activeLease)
      ])
    ),
    eventLog: copyEvents(currentState.eventLog),
    options: currentState.options
  };

  const transition = applyTaskTransition(candidateState.coreState, taskId, "claimed", timestamp);
  if (!transition.ok) {
    throw new Error("Invariant violation: prevalidated claim transition failed during staging.");
  }

  candidateState.activeLeaseByTaskId.set(taskId, copyLease(lease));
  candidateState.eventLog.push(...copyEvents(stagedEvents));
  replaceControlPlaneState(controlPlane, candidateState);

  return {
    ok: true,
    events: copyEvents(stagedEvents)
  };
}

function recreateCoreState(currentState: ControlPlaneState) {
  const recreated = createCoreState(getCoreTaskGraphSnapshot(currentState.coreState));

  if (!recreated.ok) {
    throw new Error("Invariant violation: createCoreState rejected a snapshot from ControlPlane.");
  }

  return recreated.state;
}
