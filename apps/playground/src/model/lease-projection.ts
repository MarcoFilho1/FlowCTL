import type { FlowctlEvent } from "@flowctl/protocol";

export function getLeaseIdForTask(
  events: readonly FlowctlEvent[],
  taskId: string
): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];

    if (event.type === "lease.created" && event.payload.lease.taskId === taskId) {
      return event.payload.lease.id;
    }
  }

  return undefined;
}
