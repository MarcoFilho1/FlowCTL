import assert from "node:assert/strict";
import { test } from "node:test";
import type { GraphNode, Snapshot } from "../../mod/graph/types.ts";
import { alerts, FLOWPLAN_SPEC, nudgeText, statusLine } from "../../mod/live/present.ts";

function node(id: string, status: GraphNode["status"], extra: Partial<GraphNode> = {}): GraphNode {
  return { id, kind: "task", title: id, status, blockedBy: [], ...extra };
}

function snap(nodes: GraphNode[], sessionState: Snapshot["sessionState"] = "working"): Snapshot {
  return { schema: 1, seq: 1, sessionId: "s", cwd: "/p", updatedAt: 0, sessionState, planSource: "tasks", nodes, layout: {}, warnings: [] };
}

test("the status line shows progress and what needs the person", () => {
  assert.equal(statusLine(snap([node("a", "done"), node("b", "running"), node("c", "pending")])), "◆ 1/3");
  assert.equal(
    statusLine(snap([node("a", "done"), node("b", "needs_you"), node("c", "error")], "waiting_you")),
    "◆ 1/3 · 1 waiting for you · 1 failed"
  );
});

test("with no plan the status line stays quiet unless the session waits", () => {
  const turn = node("turn:1", "running", { kind: "turn" });
  assert.equal(statusLine(snap([turn])), undefined);
  assert.equal(statusLine(snap([turn], "waiting_you")), "waiting for you");
});

test("alerts fire once, when a node turns yellow or red", () => {
  const before = snap([node("a", "running"), node("b", "running")]);
  const after = snap([
    node("a", "needs_you", { attention: { kind: "permission", detail: "Bash", since: 0 } }),
    node("b", "error", { attention: { kind: "error", detail: "Exit code 1", since: 0 } })
  ]);
  assert.deepEqual(alerts(before, after), ['"a" needs you (Bash)', '"b" failed: Exit code 1']);
  assert.deepEqual(alerts(after, after), []);
});

test("the FlowPlan spec and the nudge name the plan tool", () => {
  assert.equal(FLOWPLAN_SPEC.name, "FlowPlan");
  assert.deepEqual(FLOWPLAN_SPEC.inputSchema.required, ["steps"]);
  assert.ok(nudgeText("mcp__flowctl-graph__FlowPlan").includes("mcp__flowctl-graph__FlowPlan"));
});
