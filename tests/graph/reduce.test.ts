import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { apply, FLOWPLAN_TOOL, initialState, nodes, replay, sessionState } from "../../mod/graph/reduce.ts";
import type { GraphEvent, GraphNode } from "../../mod/graph/types.ts";

function fixture(name: string): GraphEvent[] {
  const path = new URL(`../../fixtures/${name}.jsonl`, import.meta.url);
  return readFileSync(path, "utf8").trim().split("\n").map((line) => JSON.parse(line) as GraphEvent);
}

/** Every distinct graph a replay shows, as `id:status` lists. */
function frames(events: readonly GraphEvent[]): string[] {
  const state = initialState();
  const seen: string[] = [];
  for (const event of events) {
    apply(state, event);
    const frame = nodes(state).map((node) => `${node.id}:${node.status}`).join(" ");
    if (seen.at(-1) !== frame) {
      seen.push(frame);
    }
  }
  return seen;
}

function byId(list: readonly GraphNode[], id: string): GraphNode {
  const node = list.find((candidate) => candidate.id === id);
  assert.ok(node, `no node ${id}`);
  return node;
}

test("fixture 03: tasks, declared dependencies and subagents under their tasks", () => {
  const state = replay(fixture("03-subagents-with-task-graph"));
  const shown = nodes(state);
  assert.equal(state.planSource, "tasks");
  assert.deepEqual(byId(shown, "task:4").blockedBy, ["task:1", "task:2", "task:3"]);
  assert.deepEqual(
    shown.filter((node) => node.kind === "agent").map((node) => [node.title, node.parent, node.status]),
    [
      ["Revisar módulo cart", "task:1", "done"],
      ["Revisar módulo user", "task:2", "done"],
      ["Revisar módulo report", "task:3", "done"]
    ]
  );
  assert.ok(shown.every((node) => node.status === "done"));
  assert.deepEqual(state.warnings, []);
});

test("fixture 03: the three reviews run in parallel while 'consolidar' waits", () => {
  const parallel = frames(fixture("03-subagents-with-task-graph")).find((frame) =>
    ["task:1:running", "task:2:running", "task:3:running", "task:4:pending"].every((part) => frame.includes(part))
  );
  assert.ok(parallel);
});

test("fixture 04: a permission prompt turns the work yellow until it is answered", () => {
  const events = fixture("04-permission-approved-then-denied");
  const state = initialState();
  const statuses: string[] = [];
  for (const event of events) {
    apply(state, event);
    const turn = nodes(state)[0];
    if (event.event === "classic.PermissionRequest" || event.event === "tool.call") {
      statuses.push(`${event.event}:${turn?.status}:${turn?.attention?.kind ?? "-"}`);
    }
  }
  assert.deepEqual(statuses, [
    "classic.PermissionRequest:needs_you:permission",
    "tool.call:running:-",
    "classic.PermissionRequest:needs_you:permission",
    // Denied: the person stopped it, so not an error.
    "tool.call:running:-"
  ]);
  assert.equal(sessionState(state), "idle");
});

test("fixture 05: a question to the person is yellow with kind 'question'", () => {
  const state = initialState();
  let attention: GraphNode["attention"];
  for (const event of fixture("05-ask-user-question")) {
    apply(state, event);
    attention ??= nodes(state)[0]?.attention;
  }
  assert.equal(attention?.kind, "question");
  assert.equal(attention?.detail, "AskUserQuestion");
  assert.equal(nodes(state)[0]?.status, "done");
});

test("fixture 06: the third consecutive tool error turns red, not the first two", () => {
  const state = initialState();
  const afterErrors: string[] = [];
  for (const event of fixture("06-repeated-tool-error")) {
    apply(state, event);
    if (event.event === "tool.call") {
      afterErrors.push(nodes(state)[0]?.status ?? "");
    }
  }
  assert.deepEqual(afterErrors, ["running", "running", "error"]);
  assert.equal(nodes(state)[0]?.status, "error");
});

test("fixture 07: Esc leaves the running task pending, not red", () => {
  const shown = nodes(replay(fixture("07-esc-with-task-in-progress")));
  assert.deepEqual(shown.map((node) => [node.id, node.status, node.title]), [["task:1", "pending", "aguardar build"]]);
});

test("fixtures 02 and 08: with no plan, one node follows the current turn", () => {
  for (const name of ["02-task-tools-on-big-task-without-tasks", "08-resume-then-short-request"]) {
    const shown = nodes(replay(fixture(name)));
    assert.equal(shown.length, 1, name);
    assert.equal(shown[0]?.kind, "turn", name);
    assert.equal(shown[0]?.status, "done", name);
  }
});

test("fixture 01: /clear starts a new graph and unannounced subagent stops are ignored", () => {
  const events = fixture("01-no-task-tools-big-task-then-subagents");
  const clear = events.findIndex((event) => event.event === "classic.SessionStart" && (event.input as { source?: string }).source === "clear");
  const before = replay(events.slice(0, clear));
  assert.deepEqual(nodes(before).map((node) => node.kind), ["turn"]);
  const after = replay(events.slice(0, clear + 1));
  assert.deepEqual(nodes(after), []);
  assert.equal(nodes(replay(events)).filter((node) => node.kind === "agent").length, 3);
});

test("replaying the same events twice gives the same graph", () => {
  const events = fixture("03-subagents-with-task-graph");
  assert.deepEqual(nodes(replay(events)), nodes(replay(events)));
});

test("events that do not fit become warnings, never exceptions", () => {
  const state = initialState();
  const odd: GraphEvent[] = [
    { t: 1, event: "tool.call", input: { tool: "TaskUpdate", taskId: "9", status: "completed" }, result: { result: { success: true } } },
    { t: 2, event: "tool.call", input: { tool: "TaskCreate" }, result: { result: {} } },
    { t: 3, event: "tool.call", input: "garbage", result: 42 },
    { t: 4, event: "turn.complete", input: null, result: { agents: [{ id: "nobody", status: "failed" }] } },
    { t: 5, event: "never.heard.of" }
  ];
  for (const event of odd) {
    apply(state, event);
  }
  assert.equal(state.warnings.length, 2);
  assert.deepEqual(nodes(state), []);
});

test("TaskList is the whole truth: it creates, corrects and deletes tasks", () => {
  const state = initialState();
  const call = (tool: string, input: object, result: object): GraphEvent => ({ t: 0, event: "tool.call", input: { tool, ...input }, result: { result } });
  apply(state, call("TaskCreate", { subject: "old" }, { task: { id: "1", subject: "old" } }));
  apply(state, call("TaskList", {}, {
    tasks: [
      { id: "2", subject: "build", status: "in_progress", blockedBy: [] },
      { id: "3", subject: "ship", status: "pending", blockedBy: ["2"] }
    ]
  }));
  assert.deepEqual(nodes(state).map((node) => [node.id, node.status, node.blockedBy.join()]), [
    ["task:2", "running", ""],
    ["task:3", "pending", "task:2"]
  ]);
});

test("FlowPlan steps become nodes with their dependencies", () => {
  const state = initialState();
  apply(state, {
    t: 0,
    event: "tool.call",
    input: {
      tool: FLOWPLAN_TOOL,
      steps: [
        { id: "a", title: "Read the code", status: "completed" },
        { id: "b", title: "Write the fix", status: "in_progress", blockedBy: ["a"] },
        { id: "c", title: "Run tests", blockedBy: ["b"] }
      ]
    },
    result: { result: "ok" }
  });
  assert.equal(state.planSource, "flowplan");
  assert.deepEqual(nodes(state).map((node) => [node.id, node.status, node.blockedBy.join()]), [
    ["plan:a", "done", ""],
    ["plan:b", "running", "plan:a"],
    ["plan:c", "pending", "plan:b"]
  ]);
});

test("one event costs the same early and late in a long session", () => {
  const state = initialState();
  const call = (tool: string, input: object, result: object): GraphEvent => ({ t: 0, event: "tool.call", input: { tool, ...input }, result: { result } });
  for (let i = 1; i <= 50; i += 1) {
    apply(state, call("TaskCreate", { subject: `t${i}` }, { task: { id: String(i), subject: `t${i}` } }));
  }
  const started = performance.now();
  for (let i = 0; i < 2000; i += 1) {
    apply(state, call("Bash", {}, {}));
  }
  assert.ok(performance.now() - started < 200, "2000 events over 50 nodes took too long");
});

test("hover details: why it waits, what it is about, what came of it", () => {
  const state = initialState();
  const call = (tool: string, input: object, result: object, t: number): GraphEvent => ({ t, event: "tool.call", input: { tool, ...input }, result: { result } });
  apply(state, { t: 1, event: "turn.start", input: { turnId: "a" } });
  apply(state, call("TaskCreate", { subject: "Clean up", description: "Remove stale build output" }, { task: { id: "1", subject: "Clean up" } }, 2));
  apply(state, call("TaskUpdate", { taskId: "1", status: "in_progress" }, { success: true }, 3));
  apply(state, { t: 4, event: "tool.check", input: { tool: "Bash", reason: "Bash: Remove the build folder" }, result: { decision: "ask" } });
  apply(state, { t: 5, event: "classic.PermissionRequest", input: { tool_name: "Bash" } });
  const waiting = nodes(state)[0];
  assert.equal(waiting?.status, "needs_you");
  assert.equal(waiting?.attention?.reason, "Bash: Remove the build folder");
  assert.equal(waiting?.description, "Remove stale build output");
  assert.equal(waiting?.startedAt, 3);

  apply(state, call("Bash", {}, {}, 6));
  apply(state, call("TaskUpdate", { taskId: "1", status: "completed" }, { success: true }, 7));
  apply(state, { t: 8, event: "agent.spawn", input: { description: "Review" }, result: { agentId: "x1" } });
  apply(state, { t: 9, event: "turn.complete", agentId: "x1", input: { reason: "answer", summary: "Found 2 issues." } });
  const [task, agent] = nodes(state);
  assert.deepEqual([task?.status, task?.finishedAt], ["done", 7]);
  assert.deepEqual([agent?.status, agent?.summary, agent?.startedAt, agent?.finishedAt], ["done", "Found 2 issues.", 8, 9]);
});

test("parallel calls that fail together count as one attempt toward red", () => {
  const state = initialState();
  const fail = (t: number): GraphEvent => ({ t, event: "tool.call", input: { tool: "Read" }, result: { isError: true, text: "File does not exist." } });
  const batchEnd = (t: number): GraphEvent => ({ t, event: "classic.PostToolBatch", input: {} });
  apply(state, { t: 0, event: "turn.start", input: { turnId: "a" } });
  // One batch of three parallel Reads, all failing: not red.
  [fail(1), fail(2), fail(3), batchEnd(4)].forEach((event) => apply(state, event));
  assert.equal(nodes(state)[0]?.status, "running");
  // Two more failed batches make three failed attempts in a row: red.
  [fail(5), batchEnd(6), fail(7), batchEnd(8)].forEach((event) => apply(state, event));
  assert.equal(nodes(state)[0]?.status, "error");
});

test("Claude idling for the next prompt is a resting session, not one waiting for the person", () => {
  const state = initialState();
  apply(state, { t: 0, event: "turn.start", input: { turnId: "a" } });
  apply(state, { t: 1, event: "turn.complete", input: { reason: "answer" }, result: { agents: [] } });
  apply(state, { t: 2, event: "classic.Notification", input: { notification_type: "idle_prompt", message: "Claude is waiting for your input" } });
  assert.equal(sessionState(state), "idle");
  // A real request, in the next turn, does wait for the person.
  apply(state, { t: 3, event: "turn.start", input: { turnId: "b" } });
  apply(state, { t: 3, event: "tool.check", input: { tool: "Bash" }, result: { decision: "ask" } });
  apply(state, { t: 4, event: "classic.PermissionRequest", input: { tool_name: "Bash" } });
  assert.equal(sessionState(state), "waiting_you");
});
