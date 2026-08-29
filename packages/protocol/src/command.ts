import type { Actor } from "./actor.js";
import type { GraphMutation } from "./mutation.js";
import type { PROTOCOL_VERSION } from "./version.js";

export interface CommandEnvelope {
  id: string;
  protocolVersion: typeof PROTOCOL_VERSION;
  timestamp: string;
  projectId: string;
  actor: Actor;
}

export type FlowctlCommand =
  | (CommandEnvelope & { type: "task.claim"; payload: { taskId: string; workerId: string } })
  | (CommandEnvelope & { type: "task.start"; payload: { taskId: string; workerId: string; leaseId: string } })
  | (CommandEnvelope & { type: "task.complete"; payload: { taskId: string; workerId: string; leaseId: string } })
  | (CommandEnvelope & { type: "task.fail"; payload: { taskId: string; workerId: string; leaseId: string; reason: string } })
  | (CommandEnvelope & { type: "task.block"; payload: { taskId: string; workerId: string; leaseId: string; reason: string } })
  | (CommandEnvelope & { type: "lease.heartbeat"; payload: { leaseId: string; taskId: string; workerId: string } })
  | (CommandEnvelope & { type: "graph.mutation.propose"; payload: { mutation: GraphMutation } });
