import type { TaskGraph } from "@flowctl/protocol";

export interface SchedulerSelectionOptions {
  readonly limit?: number;
}

export function selectReadyTaskIds(
  graph: TaskGraph,
  options?: SchedulerSelectionOptions
): readonly string[] {
  const suppliedLimit = options?.limit;
  const limit = suppliedLimit === undefined ? 1 : suppliedLimit;

  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new RangeError("limit must be a non-negative safe integer");
  }

  const eligibleKeys = Object.keys(graph.tasks)
    .filter((key) => graph.tasks[key].status === "ready")
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));

  return eligibleKeys.slice(0, limit);
}
