import type { TaskGraph, TaskStatus } from "@flowctl/protocol";
import type { DemoNodePosition } from "../demo/fixture.js";

export type VisualNode = Readonly<{
  taskId: string;
  title: string;
  status: TaskStatus;
  dependencyCount: number;
  position: DemoNodePosition;
}>;

export type VisualEdge = Readonly<{
  fromTaskId: string;
  toTaskId: string;
}>;

export function taskGraphToNodes(
  graph: TaskGraph,
  positions: Readonly<Record<string, DemoNodePosition>>
): readonly VisualNode[] {
  return getCanonicalTaskIds(graph).map((taskId) => {
    const task = graph.tasks[taskId];
    const position = positions[taskId];

    if (!position) {
      throw new Error(`Missing graph position for task ${taskId}.`);
    }

    return {
      taskId,
      title: task.title,
      status: task.status,
      dependencyCount: task.dependencies.length,
      position
    };
  });
}

export function taskGraphToEdges(graph: TaskGraph): readonly VisualEdge[] {
  return getCanonicalTaskIds(graph).flatMap((toTaskId) =>
    [...graph.tasks[toTaskId].dependencies].sort(compareCodeUnits).map((fromTaskId) => ({
      fromTaskId,
      toTaskId
    }))
  );
}

export function getMaterializedReadyTaskIds(graph: TaskGraph): readonly string[] {
  return getCanonicalTaskIds(graph).filter((taskId) => graph.tasks[taskId].status === "ready");
}

function getCanonicalTaskIds(graph: TaskGraph): string[] {
  return Object.keys(graph.tasks).sort(compareCodeUnits);
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
