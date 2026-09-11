import { dispatchCommand, getTaskGraphSnapshot } from "@flowctl/control-plane";
import { PROTOCOL_VERSION } from "@flowctl/protocol";
import type { FlowctlCommand, FlowctlEvent } from "@flowctl/protocol";
import type {
  ExecutionAttemptResult,
  ExecutionCoordinatorCreationResult,
  ExecutionCoordinatorOptions,
  ExecutionInput
} from "./types.js";
import { validateWorkspacePath } from "./workspace.js";

export function createExecutionCoordinator(
  options: ExecutionCoordinatorOptions
): ExecutionCoordinatorCreationResult {
  return createExecutionCoordinatorWithOperations(options, {
    getTaskGraphSnapshot,
    dispatchCommand
  });
}

// Internal construction seam; only the one-argument factory is on the facade.
export function createExecutionCoordinatorWithOperations(
  options: ExecutionCoordinatorOptions,
  operations: {
    getTaskGraphSnapshot: typeof getTaskGraphSnapshot;
    dispatchCommand: typeof dispatchCommand;
  }
): ExecutionCoordinatorCreationResult {
  const workspace = validateWorkspacePath(options.workspacePath);
  if (!workspace.ok) {
    return {
      ok: false,
      code: "INVALID_WORKSPACE",
      workspacePath: options.workspacePath,
      reason: workspace.reason
    };
  }

  const { controlPlane, workerId, adapter, workspacePath, actor, now, nextCommandId } = options;

  return {
    ok: true,
    coordinator: {
      async executeTask(taskId): Promise<ExecutionAttemptResult> {
        const { projectId } = operations.getTaskGraphSnapshot(controlPlane);
        const envelope = () => ({
          id: nextCommandId(),
          protocolVersion: PROTOCOL_VERSION,
          timestamp: now(),
          projectId,
          actor: { ...actor }
        });
        const claimCommand: FlowctlCommand = {
          ...envelope(),
          type: "task.claim",
          payload: { taskId, workerId }
        };
        const claim = operations.dispatchCommand(controlPlane, claimCommand);
        if (!claim.ok) {
          return { kind: "admission_rejected", taskId, rejection: claim };
        }

        const leaseEvents = claim.events.filter(
          (event): event is Extract<FlowctlEvent, { type: "lease.created" }> =>
            event.type === "lease.created" &&
            event.projectId === projectId &&
            event.payload.lease.taskId === taskId &&
            event.payload.lease.workerId === workerId
        );
        if (leaseEvents.length !== 1) {
          return {
            kind: "invariant_error",
            taskId,
            stage: "lease_extraction",
            message: "Accepted claim must contain exactly one matching lease.created Event."
          };
        }
        const leaseId = leaseEvents[0].payload.lease.id;
        const identity = { taskId, workerId, leaseId };
        const finalizeFailure = (reason: string) => {
          const command: FlowctlCommand = {
            ...envelope(),
            type: "task.fail",
            payload: { ...identity, reason }
          };
          return operations.dispatchCommand(controlPlane, command);
        };

        const graph = operations.getTaskGraphSnapshot(controlPlane);
        const task = Object.hasOwn(graph.tasks, taskId) ? graph.tasks[taskId] : undefined;
        if (task === undefined || task.id !== taskId) {
          return {
            kind: "invariant_error",
            taskId,
            stage: "post_claim_snapshot",
            message: "Accepted claim has no canonical Task in the fresh snapshot.",
            finalization: finalizeFailure("execution_invariant_error")
          };
        }

        const startCommand: FlowctlCommand = {
          ...envelope(),
          type: "task.start",
          payload: { ...identity }
        };
        const start = operations.dispatchCommand(controlPlane, startCommand);
        if (!start.ok) {
          const finalization = finalizeFailure("execution_start_rejected");
          return finalization.ok
            ? { kind: "start_rejected_finalized", taskId, startRejection: start, finalization }
            : { kind: "start_rejected_unfinalized", taskId, startRejection: start, finalization };
        }

        const input: ExecutionInput = {
          projectId,
          ...identity,
          workspacePath,
          task: {
            ...task,
            dependencies: [...task.dependencies],
            acceptanceCriteria: task.acceptanceCriteria.map((criterion) => ({ ...criterion }))
          }
        };
        const execution = await adapter.execute(input);
        if (execution.kind === "failed") {
          const finalization = finalizeFailure(execution.reason);
          return finalization.ok
            ? { kind: "execution_failed_finalized", taskId, execution, finalization }
            : { kind: "execution_failed_unfinalized", taskId, execution, finalization };
        }

        const completeCommand: FlowctlCommand = {
          ...envelope(),
          type: "task.complete",
          payload: { ...identity }
        };
        const completion = operations.dispatchCommand(controlPlane, completeCommand);
        if (!completion.ok) {
          const finalization = finalizeFailure("execution_completion_rejected");
          return finalization.ok
            ? { kind: "completion_rejected_finalized", taskId, completionRejection: completion, finalization }
            : { kind: "completion_rejected_unfinalized", taskId, completionRejection: completion, finalization };
        }
        return { kind: "submitted_for_review", taskId, completion };
      }
    }
  };
}
