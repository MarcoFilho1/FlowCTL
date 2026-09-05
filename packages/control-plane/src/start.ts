import {
  applyTaskTransition,
  getTaskGraphSnapshot as getCoreTaskGraphSnapshot,
  isTaskTransitionAllowed
} from "@flowctl/core";
import type { FlowctlCommand, FlowctlEvent } from "@flowctl/protocol";
import { copyActor, copyEvents, copyLease } from "./command-copy.js";
import { recreateCoreState } from "./control-plane.js";
import type { CommandProcessingResult } from "./results.js";
import {
  readControlPlaneState,
  replaceControlPlaneState,
  type ControlPlane,
  type ControlPlaneState
} from "./state.js";
import { getCanonicalTask } from "./task-lookup.js";

export function dispatchStartCommand(
  controlPlane: ControlPlane,
  command: Extract<FlowctlCommand, { type: "task.start" }>
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

  if (!isTaskTransitionAllowed(task.status, "running")) {
    return {
      ok: false,
      code: "INVALID_TASK_TRANSITION",
      commandId: command.id,
      taskId,
      from: task.status,
      to: "running"
    };
  }

  const activeLease = currentState.activeLeaseByTaskId.get(taskId);

  if (activeLease === undefined) {
    return {
      ok: false,
      code: "LEASE_NOT_FOUND",
      commandId: command.id,
      leaseId: command.payload.leaseId
    };
  }

  if (
    activeLease.id !== command.payload.leaseId ||
    activeLease.workerId !== command.payload.workerId
  ) {
    return {
      ok: false,
      code: "LEASE_MISMATCH",
      commandId: command.id,
      taskId,
      leaseId: command.payload.leaseId,
      workerId: command.payload.workerId
    };
  }

  const candidateState: ControlPlaneState = {
    projectId: currentState.projectId,
    coreState: recreateCoreState(currentState.coreState),
    activeLeaseByTaskId: new Map(
      [...currentState.activeLeaseByTaskId].map(([activeTaskId, lease]) => [
        activeTaskId,
        copyLease(lease)
      ])
    ),
    eventLog: copyEvents(currentState.eventLog),
    options: currentState.options
  };
  const timestamp = currentState.options.now();
  const eventId = currentState.options.nextEventId();
  const transition = applyTaskTransition(
    candidateState.coreState,
    taskId,
    "running",
    timestamp
  );

  if (!transition.ok) {
    throw new Error("Invariant violation: prevalidated start transition failed during staging.");
  }

  const startedEvent: FlowctlEvent = {
    id: eventId,
    protocolVersion: command.protocolVersion,
    timestamp,
    projectId: command.projectId,
    actor: copyActor(command.actor),
    type: "task.started",
    payload: {
      taskId,
      workerId: command.payload.workerId,
      leaseId: command.payload.leaseId
    }
  };

  candidateState.eventLog.push(...copyEvents([startedEvent]));
  replaceControlPlaneState(controlPlane, candidateState);

  return {
    ok: true,
    events: copyEvents([startedEvent])
  };
}
