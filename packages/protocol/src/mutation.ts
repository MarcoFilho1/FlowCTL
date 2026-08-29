import type { Task } from "./task.js";

export interface TaskCreationInput {
  id: string;
  parentId?: string;
  level: Task["level"];
  title: string;
  description?: string;
  acceptanceCriteria: Task["acceptanceCriteria"];
}

export type TaskUpdatePatch = Partial<
  Pick<Task, "title" | "description" | "parentId" | "level" | "acceptanceCriteria">
>;

export type GraphMutationOperation =
  | { type: "task.create"; task: TaskCreationInput }
  | { type: "dependency.add"; taskId: string; dependsOnTaskId: string }
  | { type: "dependency.remove"; taskId: string; dependsOnTaskId: string }
  | { type: "task.update"; taskId: string; changes: TaskUpdatePatch };

export interface GraphMutation {
  id: string;
  sourceTaskId?: string;
  reason: string;
  operations: GraphMutationOperation[];
}
