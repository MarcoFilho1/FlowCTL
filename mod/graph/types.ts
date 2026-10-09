// The graph's data model: what the reducer reads (GraphEvent) and what every
// surface draws (Snapshot). Pure types, no imports.
//
// Snapshot is the contract between the mod, the viewer and the overlay. A
// change to its shape bumps SNAPSHOT_SCHEMA and updates all three together.

export const SNAPSHOT_SCHEMA = 1;

/** One engine event, as the hooks module sees it and the recorder stores it. */
export interface GraphEvent {
  seq?: number;
  t: number;
  event: string;
  agentId?: string;
  input?: unknown;
  result?: unknown;
}

/** The five colors. */
export type NodeStatus = "pending" | "running" | "needs_you" | "error" | "done";

export type NodeKind = "task" | "agent" | "turn";

/** Why a node needs attention, laid over its own status. */
export interface Attention {
  kind: "permission" | "question" | "error";
  /** Tool name, or the last error's first line. */
  detail: string;
  since: number;
}

export interface GraphNode {
  /** `task:<id>`, `plan:<id>`, `agent:<agentId>` or `turn:<n>`. */
  id: string;
  kind: NodeKind;
  title: string;
  /** Present-tense label while running ("Running tests"). */
  activeForm?: string;
  /** What the node shows. */
  status: NodeStatus;
  attention?: Attention;
  /** The loop that owns the node; absent for the main agent. */
  agentId?: string;
  /** Node ids this node waits on: the graph's edges. */
  blockedBy: string[];
  /** For an agent node, the task its parent loop was running when it spawned. */
  parent?: string;
  /** Edges were inferred (creation order), not declared by the agent. */
  inferred?: boolean;
}

/** Where a node sits: its column (rank, from the roots) and row within it. */
export interface NodePlacement {
  rank: number;
  order: number;
}

export type Layout = Record<string, NodePlacement>;

export type SessionState = "working" | "waiting_you" | "idle" | "ended";

export interface Snapshot {
  schema: typeof SNAPSHOT_SCHEMA;
  /** Grows with every snapshot of the session; readers drop older ones. */
  seq: number;
  sessionId: string;
  cwd: string;
  updatedAt: number;
  sessionState: SessionState;
  /** Where the plan comes from in this session. */
  planSource: "tasks" | "flowplan" | "none";
  nodes: GraphNode[];
  layout: Layout;
  /** Inconsistencies seen (unknown ids, cycles). Never thrown. */
  warnings: string[];
}
