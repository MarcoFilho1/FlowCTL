import type { Task, TaskStatus } from "@flowctl/protocol";

export type TaskTransitionResult =
  | { ok: true; task: Task }
  | {
      ok: false;
      code: "INVALID_TASK_TRANSITION";
      from: TaskStatus;
      to: TaskStatus;
    };

const ALLOWED_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  pending: ["ready", "cancelled"],
  ready: ["claimed", "cancelled"],
  claimed: ["running", "ready", "blocked", "failed", "cancelled"],
  running: ["review", "blocked", "failed", "cancelled"],
  blocked: ["ready", "cancelled"],
  review: ["running", "completed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: []
};

export function isTaskTransitionAllowed(from: TaskStatus, to: TaskStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function transitionTask(
  task: Task,
  nextStatus: TaskStatus,
  updatedAt: string
): TaskTransitionResult {
  if (!isTaskTransitionAllowed(task.status, nextStatus)) {
    return {
      ok: false,
      code: "INVALID_TASK_TRANSITION",
      from: task.status,
      to: nextStatus
    };
  }

  return {
    ok: true,
    task: {
      ...task,
      status: nextStatus,
      updatedAt
    }
  };
}
