export type WorkerProvider = "codex" | "claude" | "opencode" | "demo";

export type WorkerStatus = "idle" | "busy" | "offline";

export interface Worker {
  id: string;
  provider: WorkerProvider;
  status: WorkerStatus;
  currentTaskId?: string;
  capabilities?: string[];
}
