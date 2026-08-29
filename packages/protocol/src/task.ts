export type TaskLevel = "epic" | "task" | "subtask" | "atomic";

export type TaskStatus =
  | "pending"
  | "ready"
  | "claimed"
  | "running"
  | "blocked"
  | "review"
  | "completed"
  | "failed"
  | "cancelled";

export interface AcceptanceCriterion {
  id: string;
  description: string;
}

export interface Task {
  id: string;
  parentId?: string;
  level: TaskLevel;
  title: string;
  description?: string;
  status: TaskStatus;
  dependencies: string[];
  acceptanceCriteria: AcceptanceCriterion[];
  assignedWorkerId?: string;
  createdAt: string;
  updatedAt: string;
}
