import assert from "node:assert/strict";
import { test } from "node:test";
import { FLOWPLAN_TOOL, nodes, replay } from "../../mod/graph/reduce.ts";
import { rebuildEvents, type TranscriptMessage } from "../../mod/live/rebuild.ts";

const use = (tool: string, input: Record<string, unknown>, result?: unknown, isError?: true) => ({
  tool,
  input,
  ...(result !== undefined ? { result } : {}),
  ...(isError ? { isError } : {})
});

test("a transcript's tasks, dependencies and statuses come back", () => {
  const messages: TranscriptMessage[] = [
    { role: "user", toolUses: [] },
    {
      role: "assistant",
      toolUses: [
        use("TaskCreate", { subject: "Build", description: "Compile" }, { task: { id: "1", subject: "Build" } }),
        use("TaskCreate", { subject: "Ship" }, { task: { id: "2", subject: "Ship" } }),
        use("TaskUpdate", { taskId: "2", addBlockedBy: ["1"] }, { success: true }),
        use("TaskUpdate", { taskId: "1", status: "completed" }, { success: true }),
        // Failed or unanswered calls changed nothing.
        use("TaskUpdate", { taskId: "2", status: "completed" }, "boom", true),
        use("TaskUpdate", { taskId: "2", status: "in_progress" })
      ]
    }
  ];
  const graph = replay(rebuildEvents(messages, { flowPlanTool: FLOWPLAN_TOOL, at: 5 }));
  assert.deepEqual(nodes(graph).map((node) => [node.id, node.status, node.blockedBy.join(), node.description ?? ""]), [
    ["task:1", "done", "", "Compile"],
    ["task:2", "pending", "task:1", ""]
  ]);
});

test("FlowPlan steps come back too", () => {
  const messages: TranscriptMessage[] = [
    {
      role: "assistant",
      toolUses: [
        use(FLOWPLAN_TOOL, { steps: [{ id: "a", title: "Read" }, { id: "b", title: "Fix", blockedBy: ["a"] }] }, [{ type: "text", text: "ok" }]),
        use(FLOWPLAN_TOOL, { steps: [{ id: "a", status: "completed" }, { id: "b", status: "in_progress" }] }, [{ type: "text", text: "ok" }])
      ]
    }
  ];
  const graph = replay(rebuildEvents(messages, { flowPlanTool: FLOWPLAN_TOOL, at: 5 }));
  assert.deepEqual(nodes(graph).map((node) => [node.id, node.status]), [
    ["plan:a", "done"],
    ["plan:b", "running"]
  ]);
});

test("subagents come back, running only if the engine still runs them", () => {
  const messages: TranscriptMessage[] = [
    {
      role: "assistant",
      toolUses: [
        use("Agent", { description: "Review cart", prompt: "…" }, { agentId: "x1", status: "async_launched" }),
        use("Agent", { description: "Review user" }, { agentId: "x2" })
      ]
    }
  ];
  const events = rebuildEvents(messages, { flowPlanTool: FLOWPLAN_TOOL, agents: [{ id: "x2", status: "running" }], at: 5 });
  assert.deepEqual(nodes(replay(events)).map((node) => [node.title, node.status]), [
    ["Review cart", "done"],
    ["Review user", "running"]
  ]);
});

test("a transcript with no plan rebuilds nothing", () => {
  const messages: TranscriptMessage[] = [{ role: "assistant", toolUses: [use("Bash", { command: "ls" }, "a b")] }];
  assert.deepEqual(rebuildEvents(messages, { flowPlanTool: FLOWPLAN_TOOL, at: 5 }), []);
});
