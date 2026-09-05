import type { GraphValidationIssue } from "@flowctl/core";
import type { FlowctlCommand, FlowctlEvent, TaskStatus } from "@flowctl/protocol";
import type { ControlPlane } from "./state.js";

export interface ControlPlaneOptions {
  now: () => string;
  nextLeaseId: () => string;
  nextEventId: () => string;
  leaseExpiresAt: (acquiredAt: string) => string;
}

export type ControlPlaneCreationResult =
  | { ok: true; controlPlane: ControlPlane }
  | { ok: false; code: "INVALID_GRAPH"; issues: readonly GraphValidationIssue[] };

type CommandProcessingSuccess = { ok: true; events: readonly FlowctlEvent[] };

type CommandProcessingFailure =
  | {
      ok: false;
      code: "UNSUPPORTED_COMMAND";
      commandId: string;
      commandType: FlowctlCommand["type"];
    }
  | {
      ok: false;
      code: "PROJECT_MISMATCH";
      commandId: string;
      commandProjectId: string;
      controlPlaneProjectId: string;
    }
  | { ok: false; code: "TASK_NOT_FOUND"; commandId: string; taskId: string }
  | { ok: false; code: "TASK_NOT_READY"; commandId: string; taskId: string }
  | { ok: false; code: "TASK_ALREADY_LEASED"; commandId: string; taskId: string }
  | { ok: false; code: "LEASE_NOT_FOUND"; commandId: string; leaseId: string }
  | {
      ok: false;
      code: "LEASE_MISMATCH";
      commandId: string;
      taskId: string;
      leaseId: string;
      workerId: string;
    }
  | {
      ok: false;
      code: "INVALID_TASK_TRANSITION";
      commandId: string;
      taskId: string;
      from: TaskStatus;
      to: TaskStatus;
    };

export type CommandProcessingResult =
  | CommandProcessingSuccess
  | CommandProcessingFailure;
