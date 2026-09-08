import { PROTOCOL_VERSION } from "@flowctl/protocol";
import type { FlowctlCommand } from "@flowctl/protocol";
import {
  DEMO_ACTOR,
  DEMO_PROJECT_ID,
  DEMO_WORKER_ID
} from "./fixture.js";

const DEMO_COMMAND_TIMESTAMP = "2026-09-08T00:00:00.000Z";

function createEnvelope(commandId: string) {
  return {
    id: commandId,
    protocolVersion: PROTOCOL_VERSION,
    timestamp: DEMO_COMMAND_TIMESTAMP,
    projectId: DEMO_PROJECT_ID,
    actor: { ...DEMO_ACTOR }
  };
}

export function createClaimCommand(taskId: string, commandId: string): FlowctlCommand {
  return {
    ...createEnvelope(commandId),
    type: "task.claim",
    payload: { taskId, workerId: DEMO_WORKER_ID }
  };
}

export function createStartCommand(
  taskId: string,
  leaseId: string,
  commandId: string
): FlowctlCommand {
  return {
    ...createEnvelope(commandId),
    type: "task.start",
    payload: { taskId, workerId: DEMO_WORKER_ID, leaseId }
  };
}

export function createCompleteCommand(
  taskId: string,
  leaseId: string,
  commandId: string
): FlowctlCommand {
  return {
    ...createEnvelope(commandId),
    type: "task.complete",
    payload: { taskId, workerId: DEMO_WORKER_ID, leaseId }
  };
}

export function createReviewApproveCommand(
  taskId: string,
  commandId: string
): FlowctlCommand {
  return {
    ...createEnvelope(commandId),
    type: "task.review.approve",
    payload: { taskId }
  };
}
