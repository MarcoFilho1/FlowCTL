import type { Task, TaskGraph } from "@flowctl/protocol";
import { compareTaskIds, getTaskByKey, getSortedTaskKeys, getSortedUniqueTaskIds } from "./task-graph-helpers.js";

export function areTaskDependenciesCompleted(graph: TaskGraph, task: Task): boolean {
  return getIncompleteDependencyIds(graph, task).length === 0;
}

export function getReadyTaskIds(graph: TaskGraph): readonly string[] {
  return getSortedTaskKeys(graph).filter((taskId) => {
    const task = getTaskByKey(graph, taskId);
    return task?.status === "pending" && areTaskDependenciesCompleted(graph, task);
  }).sort(compareTaskIds);
}

export function getIncompleteDependencyIds(graph: TaskGraph, task: Task): readonly string[] {
  return getSortedUniqueTaskIds(task.dependencies).filter(
    (dependencyId) => getTaskByKey(graph, dependencyId)?.status !== "completed"
  );
}
