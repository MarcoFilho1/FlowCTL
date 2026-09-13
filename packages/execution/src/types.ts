import type {
  CommandProcessingResult,
  ControlPlane
} from "@flowctl/control-plane";
import type { Actor, Task } from "@flowctl/protocol";

type CommandSuccess = Extract<CommandProcessingResult, { ok: true }>;
type CommandFailure = Extract<CommandProcessingResult, { ok: false }>;
type FailedExecutionResult = Extract<ExecutionResult, { kind: "failed" }>;
type InvariantStage =
  | "lease_extraction"
  | "post_claim_snapshot"
  | "post_start";

export interface AgentAdapter {
  execute(input: ExecutionInput): Promise<ExecutionResult>;
}

export type ExecutionInput = Readonly<{
  projectId: string;
  taskId: string;
  task: Readonly<Task>;
  leaseId: string;
  workerId: string;
  workspacePath: string;
  signal?: AbortSignal;
}>;

export type ExecutionResult =
  | { kind: "succeeded" }
  | {
      kind: "failed";
      reason: "execution_failed" | "timeout" | "aborted" | "unavailable";
      message: string;
    };

export interface ExecutionCoordinatorOptions {
  controlPlane: ControlPlane;
  workerId: string;
  adapter: AgentAdapter;
  workspacePath: string;
  actor: Actor;
  nextCommandId: () => string;
  now: () => string;
}

export interface ExecuteTaskOptions {
  /** Forwarded unchanged to the Adapter; the Coordinator owns no cancellation policy. */
  signal?: AbortSignal;
}

export interface ExecutionCoordinator {
  /** Allows one in-flight attempt per instance; releases the gate on every exit. */
  executeTask(
    taskId: string,
    options?: ExecuteTaskOptions
  ): Promise<ExecutionAttemptResult>;
}

export type ExecutionCoordinatorCreationResult =
  | { ok: true; coordinator: ExecutionCoordinator }
  | {
      ok: false;
      code: "INVALID_WORKSPACE";
      workspacePath: string;
      reason: "NOT_ABSOLUTE" | "NOT_FOUND" | "NOT_DIRECTORY";
    };

export type ExecutionAttemptResult =
  | { kind: "worker_busy"; taskId: string }
  | {
      kind: "admission_rejected";
      taskId: string;
      rejection: CommandFailure;
    }
  | {
      kind: "start_rejected_finalized";
      taskId: string;
      startRejection: CommandFailure;
      finalization: CommandSuccess;
    }
  | {
      kind: "start_rejected_unfinalized";
      taskId: string;
      startRejection: CommandFailure;
      finalization: CommandFailure;
    }
  | {
      kind: "submitted_for_review";
      taskId: string;
      completion: CommandSuccess;
    }
  | {
      kind: "completion_rejected_finalized";
      taskId: string;
      completionRejection: CommandFailure;
      finalization: CommandSuccess;
    }
  | {
      kind: "completion_rejected_unfinalized";
      taskId: string;
      completionRejection: CommandFailure;
      finalization: CommandFailure;
    }
  | {
      kind: "execution_failed_finalized";
      taskId: string;
      execution: FailedExecutionResult;
      finalization: CommandSuccess;
    }
  | {
      kind: "execution_failed_unfinalized";
      taskId: string;
      execution: FailedExecutionResult;
      finalization: CommandFailure;
    }
  | {
      kind: "invariant_error";
      taskId: string;
      stage: InvariantStage;
      message: string;
      /** Present only when a trusted current-claim Lease permits task.fail recovery. */
      finalization?: CommandSuccess | CommandFailure;
    };
