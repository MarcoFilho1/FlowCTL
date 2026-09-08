import type { TaskStatus } from "@flowctl/protocol";

export type StatusPresentation = Readonly<{
  label: string;
  symbol: string;
  className: string;
}>;

const STATUS_PRESENTATIONS: Readonly<Record<TaskStatus, StatusPresentation>> = {
  pending: { label: "Pending", symbol: "○", className: "status-pending" },
  ready: { label: "Ready", symbol: "●", className: "status-ready" },
  claimed: { label: "Claimed", symbol: "◐", className: "status-claimed" },
  running: { label: "Running", symbol: "▶", className: "status-running" },
  blocked: { label: "Blocked", symbol: "!", className: "status-blocked" },
  review: { label: "Review", symbol: "?", className: "status-review" },
  completed: { label: "Completed", symbol: "✓", className: "status-completed" },
  failed: { label: "Failed", symbol: "×", className: "status-failed" },
  cancelled: { label: "Cancelled", symbol: "−", className: "status-cancelled" }
};

export function statusToPresentation(status: TaskStatus): StatusPresentation {
  return STATUS_PRESENTATIONS[status];
}
