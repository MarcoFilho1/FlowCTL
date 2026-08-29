import type { Task } from "./task.js";

export interface TaskGraph {
  projectId: string;
  rootTaskIds: string[];
  tasks: Record<string, Task>;
}
