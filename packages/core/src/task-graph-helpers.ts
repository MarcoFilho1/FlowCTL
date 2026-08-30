import type { Task, TaskGraph } from "@flowctl/protocol";

export function compareTaskIds(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

export function compareTaskIdTuples(left: readonly string[], right: readonly string[]): number {
  const length = Math.min(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const difference = compareTaskIds(left[index] ?? "", right[index] ?? "");
    if (difference !== 0) {
      return difference;
    }
  }

  return left.length - right.length;
}

export function getTaskByKey(graph: TaskGraph, taskId: string): Task | undefined {
  return Object.hasOwn(graph.tasks, taskId) ? graph.tasks[taskId] : undefined;
}

export function getSortedTaskKeys(graph: TaskGraph): readonly string[] {
  return Object.keys(graph.tasks).sort(compareTaskIds);
}

export function getSortedUniqueTaskIds(taskIds: readonly string[]): readonly string[] {
  return Array.from(new Set(taskIds)).sort(compareTaskIds);
}
