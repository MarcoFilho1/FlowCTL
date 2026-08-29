import type { Task, TaskGraph } from "@flowctl/protocol";

export function areTaskDependenciesCompleted(graph: TaskGraph, task: Task): boolean {
  return getIncompleteDependencyIds(graph, task).length === 0;
}

export function getReadyTaskIds(graph: TaskGraph): readonly string[] {
  return Object.entries(graph.tasks)
    .filter(([, task]) => task.status === "pending" && areTaskDependenciesCompleted(graph, task))
    .map(([taskId]) => taskId)
    .sort();
}

function getIncompleteDependencyIds(graph: TaskGraph, task: Task): readonly string[] {
  return Array.from(new Set(task.dependencies))
    .filter((dependencyId) => graph.tasks[dependencyId]?.status !== "completed")
    .sort();
}
