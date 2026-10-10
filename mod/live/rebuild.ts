// Rebuilds a session's graph from its transcript, for when the mod starts
// late: a reload of the mod, a resumed session, an update mid-session. The
// transcript keeps every tool call and its result, so the plan (tasks,
// FlowPlan steps, subagents) can be replayed; what was only momentary (a
// permission prompt, an error streak) is not, and need not be.

import type { GraphEvent } from "../graph/types.ts";

/** The part of a transcript message the rebuild reads ($.session.messages()). */
export interface TranscriptMessage {
  role: "user" | "assistant";
  /** The message's text blocks joined; a person's prompt has some. */
  text?: string;
  toolUses: ReadonlyArray<{ tool: string; input: Record<string, unknown>; result?: unknown; isError?: true; text?: string }>;
  /** A user message carrying tool results is the engine's, not the person's. */
  toolResults?: readonly unknown[];
}

/** The part of $.agent.list() the rebuild reads. */
export interface AgentStatusRow {
  id: string;
  status: string;
  description?: string;
}

const PLAN_TOOLS = new Set(["TaskCreate", "TaskUpdate", "TaskGet", "TaskList"]);

/**
 * The events that replay the plan the transcript holds, in order, stamped
 * `at`. Agents the engine still lists get their live status; others are done.
 */
export function rebuildEvents(
  messages: readonly TranscriptMessage[],
  options: { flowPlanTool: string; agents?: readonly AgentStatusRow[]; at: number }
): GraphEvent[] {
  const events: GraphEvent[] = [];
  const t = options.at;
  const spawned: string[] = [];

  for (const message of messages) {
    // Each of the person's prompts starts a request, so the rebuilt graph
    // keeps its requests apart, in order, as the live one does.
    if (isPersonPrompt(message)) {
      events.push({ t, event: "prompt.submit", input: { chars: message.text!.length } });
      continue;
    }
    if (message.role !== "assistant") continue;
    for (const use of message.toolUses) {
      // An unanswered call has not happened yet, and a failed one changed nothing.
      if (use.result === undefined || use.isError) continue;
      if (PLAN_TOOLS.has(use.tool) || use.tool === options.flowPlanTool) {
        events.push({ t, event: "tool.call", input: { tool: use.tool, ...use.input }, result: { result: use.result } });
      } else if (use.tool === "Agent") {
        const agentId = agentIdOf(use.result);
        if (agentId === undefined) continue;
        spawned.push(agentId);
        const description = typeof use.input["description"] === "string" ? use.input["description"] : undefined;
        events.push({ t, event: "agent.spawn", input: description !== undefined ? { description } : {}, result: { agentId } });
      }
    }
  }

  if (spawned.length > 0) {
    const listed = new Map((options.agents ?? []).map((row) => [row.id, row.status]));
    // turn.complete carries the engine's agent list: running ones stay running.
    events.push({
      t,
      event: "turn.complete",
      agentId: "flowctl-rebuild",
      input: { reason: "answer" },
      result: { agents: spawned.map((id) => ({ id, status: listed.get(id) ?? "completed" })) }
    });
  }
  return events;
}

/**
 * A user message the person typed: text, no tool results, and none of the
 * engine's own wrappers (task notifications, system reminders, a slash
 * command's echo, an interruption note).
 */
function isPersonPrompt(message: TranscriptMessage): boolean {
  if (message.role !== "user" || (message.toolResults?.length ?? 0) > 0) return false;
  const text = message.text?.trim() ?? "";
  return text !== "" && !text.startsWith("<") && !text.startsWith("[Request interrupted");
}

function agentIdOf(result: unknown): string | undefined {
  if (result === null || typeof result !== "object") return undefined;
  const id = (result as Record<string, unknown>)["agentId"];
  return typeof id === "string" ? id : undefined;
}
