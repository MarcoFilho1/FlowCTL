import type { Task, TaskGraph } from "@flowctl/protocol";

export function getCanonicalTask(graph: TaskGraph, taskId: string): Task | undefined {
  return Object.hasOwn(graph.tasks, taskId) ? graph.tasks[taskId] : undefined;
}
