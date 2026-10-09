// What the live mod says in the terminal and offers the model, as pure
// functions over snapshots: the status line, the toasts, the FlowPlan tool
// and the optional nudge.

import type { GraphNode, Snapshot } from "../graph/types.ts";

/** The status line: progress, then what needs the person. */
export function statusLine(snapshot: Snapshot): string | undefined {
  const plan = snapshot.nodes.filter((node) => node.kind !== "turn");
  if (plan.length === 0 && snapshot.sessionState !== "waiting_you") {
    return undefined;
  }
  const parts: string[] = [];
  if (plan.length > 0) {
    parts.push(`◆ ${plan.filter((node) => node.status === "done").length}/${plan.length}`);
  }
  const waiting = snapshot.nodes.filter((node) => node.status === "needs_you").length;
  if (waiting > 0) {
    parts.push(`${waiting} aguardando você`);
  } else if (snapshot.sessionState === "waiting_you") {
    parts.push("aguardando você");
  }
  const failed = snapshot.nodes.filter((node) => node.status === "error").length;
  if (failed > 0) {
    parts.push(`${failed} com erro`);
  }
  return parts.join(" · ");
}

/** One line per node that turned yellow or red since `before`. */
export function alerts(before: Snapshot | undefined, after: Snapshot): string[] {
  const was = new Map(before?.nodes.map((node) => [node.id, node.status]) ?? []);
  const out: string[] = [];
  for (const node of after.nodes) {
    if (node.status === was.get(node.id)) {
      continue;
    }
    if (node.status === "needs_you") {
      out.push(`${label(node)} precisa de você${node.attention ? ` (${node.attention.detail})` : ""}`);
    } else if (node.status === "error") {
      out.push(`${label(node)} falhou${node.attention ? `: ${node.attention.detail}` : ""}`);
    }
  }
  return out;
}

function label(node: GraphNode): string {
  return node.kind === "turn" ? "O agente" : `"${node.title}"`;
}

/** The name the engine gives the registered tool: mcp__<plugin>__<name>. */
export const FLOWPLAN_NAME = "FlowPlan";

/** Registered when the session has no task tools (docs/events.md §1). */
export const FLOWPLAN_SPEC = {
  name: FLOWPLAN_NAME,
  description:
    "Declare or update your plan as steps with dependencies, so the person can follow it as a live graph. " +
    "Call it when work has 3 or more steps: once with all steps, then again whenever a step starts, finishes or a new one appears. " +
    "Steps are matched by id; steps you leave out are kept. Steps that can run in parallel should not block each other.",
  inputSchema: {
    type: "object",
    properties: {
      steps: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "Short stable id, e.g. 'tests'" },
            title: { type: "string", description: "What the step does, in a few words" },
            status: { type: "string", enum: ["pending", "in_progress", "completed"] },
            blockedBy: { type: "array", items: { type: "string" }, description: "Ids of steps that must finish first" }
          },
          required: ["id"]
        }
      }
    },
    required: ["steps"]
  }
} as const;

/** The nudge, added to the system prompt only when the person turns it on. */
export function nudgeText(tool: string): string {
  return (
    `When a request needs 3 or more steps, declare your plan with ${tool} before starting: ` +
    "one entry per step, with its dependencies, then keep each entry's status current as you work. " +
    "The person follows this plan as a live graph. Skip it for quick, single-step requests."
  );
}
