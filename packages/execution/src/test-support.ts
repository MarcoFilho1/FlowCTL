import type { dispatchCommand, getTaskGraphSnapshot } from "@flowctl/control-plane";
import { createExecutionCoordinatorWithOperations } from "./coordinator.js";
import type {
  ExecutionCoordinatorCreationResult,
  ExecutionCoordinatorOptions
} from "./types.js";

export interface ControlPlaneOperations {
  getTaskGraphSnapshot: typeof getTaskGraphSnapshot;
  dispatchCommand: typeof dispatchCommand;
}

export function createExecutionCoordinatorForTest(
  options: ExecutionCoordinatorOptions,
  operations: ControlPlaneOperations
): ExecutionCoordinatorCreationResult {
  return createExecutionCoordinatorWithOperations(options, operations);
}
