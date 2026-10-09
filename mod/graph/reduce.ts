// The reducer: engine events in, graph state out. It never throws and never
// refuses an event; what does not fit becomes a warning. Every rule here is
// backed by a fixture (docs/events.md).
//
// `apply` mutates the state it is given (the caller owns it), so one event
// costs work proportional to that event, not to the session. Replaying the
// same events into a fresh state always yields the same state.

import {
  DEFAULT_ERROR_THRESHOLD,
  displayStatus,
  errorDetail,
  isStoppedByUser,
  type BaseStatus
} from "./status.ts";
import type { Attention, GraphEvent, GraphNode, SessionState } from "./types.ts";

/**
 * The mod's own plan tool, registered when the session has no task tools; the
 * engine names a plugin's tool mcp__<plugin>__<name>.
 */
export const FLOWPLAN_TOOL = "mcp__flowctl-graph__FlowPlan";

const MAIN = "main";

interface PlanEntry {
  id: string;
  kind: "task" | "plan";
  title: string;
  activeForm?: string;
  description?: string;
  startedT?: number;
  finishedT?: number;
  base: BaseStatus;
  agentId?: string;
  blockedBy: string[];
  attention?: Attention;
  paused: boolean;
  /** When it last became in_progress; picks the "current" task of a loop. */
  startedAt?: number;
  createdAt: number;
}

interface AgentEntry {
  id: string;
  agentId: string;
  title: string;
  summary?: string;
  startedT: number;
  finishedT?: number;
  state: "running" | "done" | "failed";
  parent?: string;
  attention?: Attention;
  createdAt: number;
}

interface LoopState {
  /** Consecutive tool batches that failed. */
  errorStreak: number;
  /** The current batch already counted a failure: parallel calls fail together. */
  batchFailed: boolean;
}

export interface GraphState {
  sessionId?: string;
  cwd?: string;
  planSource: "tasks" | "flowplan" | "none";
  entries: Map<string, PlanEntry>;
  agents: Map<string, AgentEntry>;
  loops: Map<string, LoopState>;
  /** The loop (and why) of the last permission check that asked, per tool name. */
  askedBy: Map<string, { loop: string; reason?: string }>;
  turn: { n: number; running: boolean; attention?: Attention; startedT?: number; finishedT?: number; summary?: string };
  idlePrompt: boolean;
  ended: boolean;
  warnings: string[];
  errorThreshold: number;
  clock: number;
}

export function initialState(options: { errorThreshold?: number } = {}): GraphState {
  return {
    planSource: "none",
    entries: new Map(),
    agents: new Map(),
    loops: new Map(),
    askedBy: new Map(),
    turn: { n: 0, running: false },
    idlePrompt: false,
    ended: false,
    warnings: [],
    errorThreshold: options.errorThreshold ?? DEFAULT_ERROR_THRESHOLD,
    clock: 0
  };
}

/** Applies one event to `state` in place and returns it. */
export function apply(state: GraphState, event: GraphEvent): GraphState {
  state.clock += 1;
  const input = record(event.input);
  const result = record(event.result);

  switch (event.event) {
    case "session.start":
      state.cwd = text(input["cwd"]) ?? state.cwd;
      break;
    case "classic.SessionStart":
      if (input["source"] === "clear") {
        reset(state);
      }
      state.sessionId = text(input["session_id"]) ?? state.sessionId;
      break;
    case "session.end":
    case "classic.SessionEnd":
      if (input["reason"] !== "clear") {
        state.ended = true;
      }
      break;
    case "prompt.submit":
      state.idlePrompt = false;
      clearAttention(state, (attention) => attention.kind !== "error");
      break;
    case "turn.start":
      if (event.agentId === undefined) {
        state.turn = { n: state.turn.n + 1, running: true, startedT: event.t };
        state.idlePrompt = false;
      }
      break;
    case "turn.complete":
      onTurnComplete(state, event, input, result);
      break;
    case "agent.spawn":
      onAgentSpawn(state, event, input, result);
      break;
    case "tool.check":
      if (result["decision"] === "ask") {
        const reason = text(input["reason"]);
        state.askedBy.set(text(input["tool"]) ?? "", { loop: event.agentId ?? MAIN, ...(reason !== undefined ? { reason } : {}) });
      }
      break;
    case "classic.PermissionRequest":
      onPermissionRequest(state, input, event.t);
      break;
    case "classic.PostToolBatch":
      // A batch of tool calls ended; its loop's next failure starts a new attempt.
      for (const loopState of state.loops.values()) {
        loopState.batchFailed = false;
      }
      break;
    case "classic.Notification":
      if (input["notification_type"] === "idle_prompt") {
        state.idlePrompt = true;
      }
      break;
    case "tool.call":
      onToolCall(state, event, input, result);
      break;
    default:
      break;
  }
  return state;
}

/** Applies every event, in order, to a fresh state. */
export function replay(events: readonly GraphEvent[], options?: { errorThreshold?: number }): GraphState {
  const state = initialState(options);
  for (const event of events) {
    apply(state, event);
  }
  return state;
}

/**
 * The nodes the state shows, in creation order: plan entries, then agents.
 * With neither, one node for the current turn, so the graph is never empty.
 */
export function nodes(state: GraphState): GraphNode[] {
  const out: GraphNode[] = [];
  const known = new Set([...state.entries.keys(), ...[...state.agents.values()].map((agent) => agent.id)]);

  for (const entry of [...state.entries.values()].sort(byCreation)) {
    out.push({
      id: entry.id,
      kind: "task",
      title: entry.title,
      ...(entry.activeForm !== undefined ? { activeForm: entry.activeForm } : {}),
      ...(entry.description !== undefined ? { description: entry.description } : {}),
      ...(entry.startedT !== undefined ? { startedAt: entry.startedT } : {}),
      ...(entry.finishedT !== undefined ? { finishedAt: entry.finishedT } : {}),
      status: displayStatus(entry.base, entry.attention, entry.paused),
      ...(entry.attention !== undefined ? { attention: entry.attention } : {}),
      ...(entry.agentId !== undefined ? { agentId: entry.agentId } : {}),
      blockedBy: entry.blockedBy.filter((id) => known.has(id))
    });
  }
  for (const agent of [...state.agents.values()].sort(byCreation)) {
    const base: BaseStatus = agent.state === "running" ? "in_progress" : "completed";
    const attention: Attention | undefined =
      agent.state === "failed" ? { kind: "error", detail: "subagent failed", since: 0 } : agent.attention;
    out.push({
      id: agent.id,
      kind: "agent",
      title: agent.title,
      ...(agent.summary !== undefined ? { summary: agent.summary } : {}),
      startedAt: agent.startedT,
      ...(agent.finishedT !== undefined ? { finishedAt: agent.finishedT } : {}),
      status: agent.state === "failed" ? "error" : displayStatus(base, attention),
      ...(attention !== undefined ? { attention } : {}),
      agentId: agent.agentId,
      blockedBy: [],
      ...(agent.parent !== undefined && known.has(agent.parent) ? { parent: agent.parent } : {})
    });
  }
  if (out.length === 0 && state.turn.n > 0) {
    out.push({
      id: `turn:${state.turn.n}`,
      kind: "turn",
      title: "Current turn",
      ...(state.turn.summary !== undefined ? { summary: state.turn.summary } : {}),
      ...(state.turn.startedT !== undefined ? { startedAt: state.turn.startedT } : {}),
      ...(state.turn.finishedT !== undefined ? { finishedAt: state.turn.finishedT } : {}),
      // A turn that ended on errors stays red until the next turn starts.
      status:
        state.turn.attention?.kind === "error"
          ? "error"
          : displayStatus(state.turn.running ? "in_progress" : "completed", state.turn.attention),
      ...(state.turn.attention !== undefined ? { attention: state.turn.attention } : {}),
      blockedBy: []
    });
  }
  return out;
}

export function sessionState(state: GraphState): SessionState {
  if (state.ended) {
    return "ended";
  }
  const shown = nodes(state);
  if (state.idlePrompt || shown.some((node) => node.status === "needs_you")) {
    return "waiting_you";
  }
  if (state.turn.running || [...state.agents.values()].some((agent) => agent.state === "running")) {
    return "working";
  }
  return "idle";
}

// --- events -----------------------------------------------------------------

function onToolCall(state: GraphState, event: GraphEvent, input: Record<string, unknown>, result: Record<string, unknown>): void {
  const tool = text(input["tool"]) ?? "";
  const loop = event.agentId ?? MAIN;
  const isError = result["isError"] === true;
  const denied = result["deny"] !== undefined;
  const errorText = text(result["text"]);

  // The call a permission prompt held has now run, or been refused.
  clearAttention(state, (attention) => attention.kind !== "error", loop);
  if (loop === MAIN) {
    for (const entry of state.entries.values()) {
      entry.paused = false;
    }
  }

  if (isError && !denied && !isStoppedByUser(errorText)) {
    // Calls the model makes in parallel (three Reads of guessed paths) fail
    // as one attempt: a batch counts once toward the streak.
    const loopState = loopOf(state, loop);
    if (!loopState.batchFailed) {
      loopState.errorStreak += 1;
      loopState.batchFailed = true;
    }
    if (loopState.errorStreak >= state.errorThreshold) {
      setAttention(state, loop, { kind: "error", detail: errorDetail(errorText), since: event.t });
    }
  } else if (!isError) {
    loopOf(state, loop).errorStreak = 0;
    clearAttention(state, (attention) => attention.kind === "error", loop);
  }

  if (isError || denied) {
    return;
  }
  const payload = record(result["result"]);
  switch (tool) {
    case "TaskCreate":
      onTaskCreate(state, event, input, payload);
      break;
    case "TaskUpdate":
      onTaskUpdate(state, event, input, payload);
      break;
    case "TaskList":
      onTaskList(state, event, payload);
      break;
    case "TaskGet":
      if (isRecord(payload["task"])) {
        upsertTask(state, event, payload["task"]);
      }
      break;
    case FLOWPLAN_TOOL:
      onFlowPlan(state, event, input);
      break;
    default:
      break;
  }
}

function onTaskCreate(state: GraphState, event: GraphEvent, input: Record<string, unknown>, payload: Record<string, unknown>): void {
  const task = record(payload["task"]);
  const taskId = text(task["id"]);
  if (taskId === undefined) {
    state.warnings.push(`TaskCreate without an id (seq ${event.seq ?? "?"})`);
    return;
  }
  state.planSource = "tasks";
  const id = `task:${taskId}`;
  const activeForm = text(input["activeForm"]);
  const description = text(input["description"]);
  state.entries.set(id, {
    id,
    kind: "task",
    title: text(task["subject"]) ?? text(input["subject"]) ?? id,
    ...(activeForm !== undefined ? { activeForm } : {}),
    ...(description !== undefined ? { description } : {}),
    base: "pending",
    ...(event.agentId !== undefined ? { agentId: event.agentId } : {}),
    blockedBy: [],
    paused: false,
    createdAt: state.clock
  });
}

function onTaskUpdate(state: GraphState, event: GraphEvent, input: Record<string, unknown>, payload: Record<string, unknown>): void {
  if (payload["success"] === false) {
    return;
  }
  const taskId = text(input["taskId"]);
  if (taskId === undefined) {
    return;
  }
  const id = `task:${taskId}`;
  const entry = state.entries.get(id);
  if (entry === undefined) {
    state.warnings.push(`TaskUpdate for unknown task ${taskId}`);
    return;
  }
  const status = input["status"];
  if (status === "deleted") {
    removeEntry(state, id);
    return;
  }
  if (status === "pending" || status === "in_progress" || status === "completed") {
    setBase(state, entry, status, event.t);
  }
  entry.title = text(input["subject"]) ?? entry.title;
  entry.activeForm = text(input["activeForm"]) ?? entry.activeForm;
  entry.description = text(input["description"]) ?? entry.description;
  for (const blocker of strings(input["addBlockedBy"])) {
    addEdge(entry, `task:${blocker}`);
  }
  for (const blocked of strings(input["addBlocks"])) {
    const target = state.entries.get(`task:${blocked}`);
    if (target !== undefined) {
      addEdge(target, id);
    }
  }
}

function onTaskList(state: GraphState, event: GraphEvent, payload: Record<string, unknown>): void {
  if (!Array.isArray(payload["tasks"])) {
    return;
  }
  state.planSource = "tasks";
  const listed = new Set<string>();
  for (const task of payload["tasks"]) {
    if (isRecord(task)) {
      const id = upsertTask(state, event, task);
      if (id !== undefined) {
        listed.add(id);
      }
    }
  }
  // The list is the whole truth: tasks it no longer has were deleted.
  for (const id of [...state.entries.keys()]) {
    if (id.startsWith("task:") && !listed.has(id)) {
      removeEntry(state, id);
    }
  }
}

/** Creates or corrects a task from a TaskList / TaskGet record. */
function upsertTask(state: GraphState, event: GraphEvent, task: Record<string, unknown>): string | undefined {
  const taskId = text(task["id"]);
  if (taskId === undefined) {
    return undefined;
  }
  const id = `task:${taskId}`;
  let entry = state.entries.get(id);
  if (entry === undefined) {
    entry = { id, kind: "task", title: id, base: "pending", blockedBy: [], paused: false, createdAt: state.clock };
    state.entries.set(id, entry);
  }
  entry.title = text(task["subject"]) ?? entry.title;
  const status = task["status"];
  if (status === "pending" || status === "in_progress" || status === "completed") {
    setBase(state, entry, status, event.t);
  }
  if (Array.isArray(task["blockedBy"])) {
    entry.blockedBy = strings(task["blockedBy"]).map((blocker) => `task:${blocker}`);
  }
  return id;
}

/**
 * FlowPlan: `{ steps: [{ id, title, blockedBy?, status? }] }`, each step
 * created or updated by id. Steps left out are kept.
 */
function onFlowPlan(state: GraphState, event: GraphEvent, input: Record<string, unknown>): void {
  if (!Array.isArray(input["steps"])) {
    return;
  }
  state.planSource = "flowplan";
  for (const step of input["steps"]) {
    if (!isRecord(step)) {
      continue;
    }
    const stepId = text(step["id"]);
    if (stepId === undefined) {
      continue;
    }
    const id = `plan:${stepId}`;
    let entry = state.entries.get(id);
    if (entry === undefined) {
      entry = {
        id,
        kind: "plan",
        title: id,
        base: "pending",
        ...(event.agentId !== undefined ? { agentId: event.agentId } : {}),
        blockedBy: [],
        paused: false,
        createdAt: state.clock
      };
      state.entries.set(id, entry);
    }
    entry.title = text(step["title"]) ?? entry.title;
    entry.description = text(step["description"]) ?? entry.description;
    const status = step["status"];
    if (status === "pending" || status === "in_progress" || status === "completed") {
      setBase(state, entry, status, event.t);
    }
    if (Array.isArray(step["blockedBy"])) {
      entry.blockedBy = strings(step["blockedBy"]).map((blocker) => `plan:${blocker}`);
    }
  }
}

function onAgentSpawn(state: GraphState, event: GraphEvent, input: Record<string, unknown>, result: Record<string, unknown>): void {
  const agentId = text(result["agentId"]);
  if (agentId === undefined) {
    return;
  }
  const title = text(input["description"]) ?? "subagent";
  const parent = parentFor(state, title);
  state.agents.set(agentId, {
    id: `agent:${agentId}`,
    agentId,
    title,
    state: "running",
    startedT: event.t,
    ...(parent !== undefined ? { parent } : {}),
    createdAt: state.clock
  });
}

function onTurnComplete(
  state: GraphState,
  event: GraphEvent,
  input: Record<string, unknown>,
  result: Record<string, unknown>
): void {
  const agentId = event.agentId;
  // The engine's own list is the authority on subagents.
  if (Array.isArray(result["agents"])) {
    for (const info of result["agents"]) {
      const agent = isRecord(info) ? state.agents.get(text(info["id"]) ?? "") : undefined;
      if (agent === undefined) {
        continue;
      }
      if (info["status"] === "completed" && agent.state === "running") {
        agent.state = "done";
        agent.finishedT = event.t;
      } else if ((info["status"] === "failed" || info["status"] === "killed") && agent.state === "running") {
        agent.state = "failed";
        agent.finishedT = event.t;
      }
    }
  }

  const summary = text(input["summary"]);
  if (agentId !== undefined) {
    const agent = state.agents.get(agentId);
    if (agent !== undefined) {
      if (agent.state === "running") {
        agent.state = "done";
        agent.finishedT = event.t;
      }
      agent.summary = summary ?? agent.summary;
    }
    return;
  }

  state.turn.running = false;
  state.turn.finishedT = event.t;
  if (summary !== undefined) {
    state.turn.summary = summary;
  }
  const reason = input["reason"];
  if (reason === "aborted") {
    // Esc: what was running stops, it did not fail.
    clearAttention(state, () => true, MAIN);
    for (const entry of state.entries.values()) {
      if (entry.base === "in_progress" && entry.agentId === undefined) {
        entry.paused = true;
      }
    }
  } else if (reason === "error" || reason === "refusal") {
    setAttention(state, MAIN, { kind: "error", detail: `turn ended: ${String(reason)}`, since: event.t });
  } else {
    clearAttention(state, (attention) => attention.kind !== "error", MAIN);
  }
}

function onPermissionRequest(state: GraphState, input: Record<string, unknown>, t: number): void {
  const tool = text(input["tool_name"]) ?? "tool";
  const asked = state.askedBy.get(tool);
  setAttention(state, asked?.loop ?? MAIN, {
    kind: tool === "AskUserQuestion" ? "question" : "permission",
    detail: tool,
    ...(asked?.reason !== undefined ? { reason: asked.reason } : {}),
    since: t
  });
}

// --- helpers ----------------------------------------------------------------

function reset(state: GraphState): void {
  const fresh = initialState({ errorThreshold: state.errorThreshold });
  Object.assign(state, fresh, { cwd: state.cwd, clock: state.clock });
}

/** The node a loop is working on: its latest in_progress entry, its agent node, or the turn. */
function target(state: GraphState, loop: string): PlanEntry | AgentEntry | GraphState["turn"] {
  let current: PlanEntry | undefined;
  for (const entry of state.entries.values()) {
    const owner = entry.agentId ?? MAIN;
    if (owner === loop && entry.base === "in_progress" && (current === undefined || (entry.startedAt ?? 0) >= (current.startedAt ?? 0))) {
      current = entry;
    }
  }
  if (current !== undefined) {
    return current;
  }
  const agent = loop === MAIN ? undefined : state.agents.get(loop);
  return agent ?? state.turn;
}

function setAttention(state: GraphState, loop: string, attention: Attention): void {
  target(state, loop).attention = attention;
}

/**
 * Clears matching attention. With `loop`, only on nodes that loop owns: its
 * entries, its agent node (an agent's own id names its loop), or the turn
 * for the main loop.
 */
function clearAttention(state: GraphState, match: (attention: Attention) => boolean, loop?: string): void {
  const holders: Array<{ attention?: Attention; agentId?: string }> = [
    ...state.entries.values(),
    ...state.agents.values()
  ];
  for (const holder of holders) {
    if (holder.attention !== undefined && match(holder.attention) && (loop === undefined || (holder.agentId ?? MAIN) === loop)) {
      delete holder.attention;
    }
  }
  if (state.turn.attention !== undefined && match(state.turn.attention) && (loop === undefined || loop === MAIN)) {
    delete state.turn.attention;
  }
}

function setBase(state: GraphState, entry: PlanEntry, base: BaseStatus, t: number): void {
  if (base === "in_progress" && entry.base !== "in_progress") {
    entry.startedAt = state.clock;
    entry.startedT = t;
  }
  if (base === "completed" && entry.base !== "completed") {
    entry.finishedT = t;
  }
  entry.base = base;
  entry.paused = false;
  if (base === "completed") {
    delete entry.attention;
  }
}

function removeEntry(state: GraphState, id: string): void {
  state.entries.delete(id);
  for (const entry of state.entries.values()) {
    entry.blockedBy = entry.blockedBy.filter((blocker) => blocker !== id);
  }
}

function addEdge(entry: PlanEntry, blocker: string): void {
  if (blocker !== entry.id && !entry.blockedBy.includes(blocker)) {
    entry.blockedBy.push(blocker);
  }
}

/**
 * The task a new subagent works for: an in_progress task of the main loop
 * whose title matches the agent's description, else the latest started one.
 */
function parentFor(state: GraphState, description: string): string | undefined {
  const wanted = description.trim().toLowerCase();
  let latest: PlanEntry | undefined;
  for (const entry of state.entries.values()) {
    if (entry.agentId !== undefined || entry.base !== "in_progress") {
      continue;
    }
    if (entry.title.trim().toLowerCase() === wanted) {
      return entry.id;
    }
    if (latest === undefined || (entry.startedAt ?? 0) >= (latest.startedAt ?? 0)) {
      latest = entry;
    }
  }
  return latest?.id;
}

function loopOf(state: GraphState, loop: string): LoopState {
  let found = state.loops.get(loop);
  if (found === undefined) {
    found = { errorStreak: 0, batchFailed: false };
    state.loops.set(loop, found);
  }
  return found;
}

function byCreation(left: { createdAt: number }, right: { createdAt: number }): number {
  return left.createdAt - right.createdAt;
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
