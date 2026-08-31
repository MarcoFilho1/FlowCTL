import type { Actor, FlowctlEvent, Lease } from "@flowctl/protocol";

export function copyActor(actor: Actor): Actor {
  return structuredClone(actor);
}

export function copyLease(lease: Lease): Lease {
  return structuredClone(lease);
}

export function copyEvent(event: FlowctlEvent): FlowctlEvent {
  return structuredClone(event);
}

export function copyEvents(events: readonly FlowctlEvent[]): FlowctlEvent[] {
  return events.map((event) => copyEvent(event));
}
