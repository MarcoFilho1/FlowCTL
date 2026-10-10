// The graph's data model: what the reducer reads (GraphEvent) and what every
// surface draws (Snapshot). Pure types, no imports.
//
// Snapshot is the contract between the mod, the viewer and the overlay. A
// change to its shape bumps SNAPSHOT_SCHEMA and updates all three together;
// a new optional field does not (readers ignore what they do not know).

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
  /** Why the person is needed, in words: the command's purpose, the question asked. */
  reason?: string;
  since: number;
}

export interface GraphNode {
  /** `task:<id>`, `plan:<id>`, `agent:<agentId>` or `turn:<n>`. */
  id: string;
  kind: NodeKind;
  title: string;
  /** Present-tense label while running ("Running tests"). */
  activeForm?: string;
  /** What the step is about, as the agent described it. */
  description?: string;
  /** What came of it, once done (a subagent's or a turn's answer, cut short). */
  summary?: string;
  /** When it started running and when it finished (ms since epoch). */
  startedAt?: number;
  finishedAt?: number;
  /** What the node shows. */
  status: NodeStatus;
  attention?: Attention;
  /** The loop that owns the node; absent for the main agent. */
  agentId?: string;
  /** Node ids this node waits on: the graph's edges. */
  blockedBy: string[];
  /**
   * Node ids this node simply came after: the last steps of the previous
   * request in the same session. Drawn dashed; not a dependency.
   */
  after?: string[];
  /** The latest tool error while this node was current: the viewer flashes red when it changes. */
  lastError?: { detail: string; at: number };
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

/** Where the session runs, so a click on a node can bring that terminal forward. */
export interface TerminalInfo {
  /** The terminal app's bundle id (com.apple.Terminal, com.googlecode.iterm2, ...). */
  app?: string;
  /** TERM_PROGRAM. */
  program?: string;
  /** The session's tty, e.g. ttys021 (Unix only; Windows has none). */
  tty?: string;
  /** The Claude Code process, so a reader can tell a live session from a dead one. */
  pid?: number;
  /** Terminal-specific ids, when set: ITERM_SESSION_ID, TERM_SESSION_ID, MAESTRI_TERMINAL_ID, WT_SESSION (Windows Terminal). */
  ids?: Record<string, string>;
}

export interface Snapshot {
  schema: typeof SNAPSHOT_SCHEMA;
  /** Grows with every snapshot of the session; readers drop older ones. */
  seq: number;
  sessionId: string;
  cwd: string;
  updatedAt: number;
  sessionState: SessionState;
  terminal?: TerminalInfo;
  /** Where the plan comes from in this session. */
  planSource: "tasks" | "flowplan" | "none";
  nodes: GraphNode[];
  layout: Layout;
  /** Inconsistencies seen (unknown ids, cycles). Never thrown. */
  warnings: string[];
}
