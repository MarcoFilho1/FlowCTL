import type { Actor } from "./actor.js";
import type { Lease } from "./lease.js";
import type { GraphMutation } from "./mutation.js";
import type { Task } from "./task.js";
import type { Worker } from "./worker.js";
import type { PROTOCOL_VERSION } from "./version.js";

export interface EventEnvelope {
  id: string;
  protocolVersion: typeof PROTOCOL_VERSION;
  timestamp: string;
  projectId: string;
  actor: Actor;
}

export type FlowctlEvent =
  | (EventEnvelope & { type: "task.created"; payload: { task: Task } })
  | (EventEnvelope & { type: "task.ready"; payload: { taskId: string } })
  | (EventEnvelope & { type: "task.claimed"; payload: { taskId: string; workerId: string; leaseId: string } })
  | (EventEnvelope & { type: "task.started"; payload: { taskId: string; workerId: string; leaseId: string } })
  | (EventEnvelope & { type: "task.review_requested"; payload: { taskId: string; workerId: string; leaseId: string } })
  | (EventEnvelope & { type: "task.completed"; payload: { taskId: string; workerId: string; leaseId: string } })
  | (EventEnvelope & { type: "task.failed"; payload: { taskId: string; workerId: string; leaseId: string; reason: string } })
  | (EventEnvelope & { type: "task.blocked"; payload: { taskId: string; workerId: string; leaseId: string; reason: string } })
  | (EventEnvelope & { type: "task.cancelled"; payload: { taskId: string; reason?: string } })
  | (EventEnvelope & { type: "lease.created"; payload: { lease: Lease } })
  | (EventEnvelope & { type: "lease.expired"; payload: { leaseId: string; taskId: string; workerId: string } })
  | (EventEnvelope & { type: "worker.connected"; payload: { worker: Worker } })
  | (EventEnvelope & { type: "worker.disconnected"; payload: { workerId: string } })
  | (EventEnvelope & { type: "graph.mutation.proposed"; payload: { mutation: GraphMutation } })
  | (EventEnvelope & { type: "graph.mutation.approved"; payload: { mutation: GraphMutation } })
  | (EventEnvelope & { type: "graph.mutation.rejected"; payload: { mutationId: string; reason: string } });
