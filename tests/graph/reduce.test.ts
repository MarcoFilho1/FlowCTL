import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { apply, FLOWPLAN_TOOL, initialState, nodes, replay, sessionState } from "../../mod/graph/reduce.ts";
import { snapshot } from "../../mod/graph/snapshot.ts";
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
  // The recording ends with /clear, which ends the session.
  assert.equal(sessionState(state), "ended");
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

test("a step left in_progress when the turn ends stops showing as running, and runs again with the next call", () => {
  const state = initialState();
  apply(state, { t: 0, event: "turn.start", input: { turnId: "a" } });
  apply(state, {
    t: 1,
    event: "tool.call",
    input: { tool: FLOWPLAN_TOOL, steps: [{ id: "pr", title: "Open the PR", status: "completed" }, { id: "merge", title: "Merge", status: "in_progress", blockedBy: ["pr"] }] },
    result: { result: "ok" }
  });
  assert.equal(byId(nodes(state), "plan:merge").status, "running");
  apply(state, { t: 2, event: "turn.complete", input: { reason: "answer" } });
  assert.equal(byId(nodes(state), "plan:merge").status, "pending", "the agent stopped without updating its plan");
  apply(state, { t: 3, event: "turn.start", input: { turnId: "b" } });
  apply(state, { t: 4, event: "tool.call", input: { tool: "Bash" }, result: { result: {} } });
  assert.equal(byId(nodes(state), "plan:merge").status, "running");
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

test("parallel subagents attach to the step they work on, one each", () => {
  const state = initialState();
  const plan = (steps: object[]): GraphEvent => ({ t: 0, event: "tool.call", input: { tool: FLOWPLAN_TOOL, steps }, result: { result: [] } });
  apply(state, plan([
    { id: "cart", title: "Testes do cart", status: "in_progress" },
    { id: "user", title: "Testes do user", status: "in_progress" },
    { id: "report", title: "Testes do report", status: "in_progress" }
  ]));
  for (const [id, description] of [["a1", "Testes node:test para cart"], ["a2", "Testes node:test para user"], ["a3", "Testes node:test para report"]]) {
    apply(state, { t: 1, event: "agent.spawn", input: { description }, result: { agentId: id } });
  }
  assert.deepEqual(nodes(state).filter((node) => node.kind === "agent").map((node) => [node.agentId, node.parent]), [
    ["a1", "plan:cart"],
    ["a2", "plan:user"],
    ["a3", "plan:report"]
  ]);
});

test("with no word in common, subagents spread over the running steps", () => {
  const state = initialState();
  apply(state, { t: 0, event: "tool.call", input: { tool: FLOWPLAN_TOOL, steps: [{ id: "x", title: "Alpha", status: "in_progress" }, { id: "y", title: "Beta", status: "in_progress" }] }, result: { result: [] } });
  apply(state, { t: 1, event: "agent.spawn", input: { description: "Worker one" }, result: { agentId: "w1" } });
  apply(state, { t: 2, event: "agent.spawn", input: { description: "Worker two" }, result: { agentId: "w2" } });
  const parents = nodes(state).filter((node) => node.kind === "agent").map((node) => node.parent);
  assert.deepEqual(new Set(parents), new Set(["plan:x", "plan:y"]));
});

test("one session, one graph: a new request's first steps come after the last request's ends", () => {
  const state = initialState();
  const plan = (steps: object[]): GraphEvent => ({ t: 0, event: "tool.call", input: { tool: FLOWPLAN_TOOL, steps }, result: { result: [] } });
  apply(state, { t: 0, event: "prompt.submit", input: { chars: 10 } });
  apply(state, plan([{ id: "a", title: "A", status: "completed" }, { id: "b", title: "B", status: "completed", blockedBy: ["a"] }, { id: "c", title: "C", status: "completed", blockedBy: ["a"] }]));
  apply(state, { t: 1, event: "prompt.submit", input: { chars: 10 } });
  apply(state, plan([{ id: "d", title: "D" }, { id: "e", title: "E", blockedBy: ["d"] }]));
  const shown = nodes(state);
  // b and c end request 1; d starts request 2; e depends on d, so it has no sequence link.
  assert.deepEqual(shown.find((node) => node.id === "plan:d")?.after, ["plan:b", "plan:c"]);
  assert.equal(shown.find((node) => node.id === "plan:e")?.after, undefined);
  assert.equal(shown.find((node) => node.id === "plan:a")?.after, undefined);
});

test("subagents spawned without a plan read as a timeline: each request's after the one before", () => {
  const state = initialState();
  const spawn = (id: string, t: number): GraphEvent => ({ t, event: "agent.spawn", input: { description: id }, result: { agentId: id } });
  apply(state, { t: 0, event: "prompt.submit", input: { chars: 10 } });
  apply(state, spawn("r1", 1));
  apply(state, spawn("r2", 2));
  apply(state, { t: 3, event: "prompt.submit", input: { chars: 10 } });
  apply(state, spawn("r3", 4));
  apply(state, { t: 5, event: "prompt.submit", input: { chars: 10 } });
  apply(state, spawn("r4", 6));
  apply(state, spawn("r5", 7));
  const shown = nodes(state);
  const after = (id: string) => shown.find((node) => node.id === `agent:${id}`)?.after;
  // Request 1 starts the timeline; its two parallel agents both end it.
  assert.equal(after("r1"), undefined);
  assert.equal(after("r2"), undefined);
  assert.deepEqual(after("r3"), ["agent:r1", "agent:r2"]);
  assert.deepEqual(after("r4"), ["agent:r3"]);
  assert.deepEqual(after("r5"), ["agent:r3"]);
  // Laid out left to right, a column per request, not one column of all of them.
  const { layout } = snapshot(state, { seq: 1, now: 0 });
  assert.deepEqual(["r1", "r2", "r3", "r4", "r5"].map((id) => layout[`agent:${id}`]?.rank), [0, 0, 1, 2, 2]);
});

test("a subagent under a step hangs from it, outside the timeline", () => {
  const state = initialState();
  apply(state, { t: 0, event: "prompt.submit", input: { chars: 10 } });
  apply(state, { t: 0, event: "tool.call", input: { tool: FLOWPLAN_TOOL, steps: [{ id: "a", title: "Alpha", status: "completed" }] }, result: { result: [] } });
  apply(state, { t: 1, event: "prompt.submit", input: { chars: 10 } });
  apply(state, { t: 1, event: "tool.call", input: { tool: FLOWPLAN_TOOL, steps: [{ id: "b", title: "Beta", status: "in_progress" }] }, result: { result: [] } });
  apply(state, { t: 2, event: "agent.spawn", input: { description: "Helper" }, result: { agentId: "h" } });
  const helper = nodes(state).find((node) => node.id === "agent:h");
  assert.equal(helper?.parent, "plan:b");
  assert.equal(helper?.after, undefined);
  assert.deepEqual(nodes(state).find((node) => node.id === "plan:b")?.after, ["plan:a"]);
});

test("the turn node of a new request hangs after the last request's subagents", () => {
  const state = initialState();
  apply(state, { t: 0, event: "prompt.submit", input: { chars: 10 } });
  apply(state, { t: 0, event: "turn.start", input: { turnId: "1" } });
  apply(state, { t: 1, event: "agent.spawn", input: { description: "Review" }, result: { agentId: "r1" } });
  apply(state, { t: 2, event: "turn.complete", input: {} });
  apply(state, { t: 3, event: "prompt.submit", input: { chars: 10 } });
  apply(state, { t: 3, event: "turn.start", input: { turnId: "2" } });
  const turn = nodes(state).find((node) => node.kind === "turn");
  assert.deepEqual(turn?.after, ["agent:r1"]);
});

test("every tool error marks the current node; it stays blue unless errors repeat", () => {
  const state = initialState();
  apply(state, { t: 0, event: "turn.start", input: { turnId: "a" } });
  apply(state, { t: 0, event: "tool.call", input: { tool: FLOWPLAN_TOOL, steps: [{ id: "fix", title: "Fix", status: "in_progress" }] }, result: { result: [] } });
  apply(state, { t: 5, event: "tool.call", input: { tool: "Bash" }, result: { isError: true, text: "Exit code 1\nboom" } });
  apply(state, { t: 6, event: "classic.PostToolBatch", input: {} });
  apply(state, { t: 7, event: "tool.call", input: { tool: "Bash" }, result: {} });
  const fix = nodes(state).find((node) => node.id === "plan:fix");
  assert.equal(fix?.status, "running");
  assert.deepEqual(fix?.lastError, { detail: "Exit code 1", at: 5 });
});

test("a new request shows the turn after the last plan until its own plan arrives; a question there is yellow", () => {
  const state = initialState();
  const plan = (steps: object[]): GraphEvent => ({ t: 0, event: "tool.call", input: { tool: FLOWPLAN_TOOL, steps }, result: { result: [] } });
  apply(state, { t: 0, event: "prompt.submit", input: { chars: 5 } });
  apply(state, { t: 0, event: "turn.start", input: { turnId: "1" } });
  apply(state, plan([{ id: "a", title: "A", status: "completed" }]));
  apply(state, { t: 1, event: "turn.complete", input: { reason: "answer" }, result: { agents: [] } });
  assert.deepEqual(nodes(state).map((node) => node.id), ["plan:a"]);

  apply(state, { t: 2, event: "prompt.submit", input: { chars: 5 } });
  apply(state, { t: 2, event: "turn.start", input: { turnId: "2" } });
  const turn = nodes(state).find((node) => node.kind === "turn");
  assert.deepEqual([turn?.status, turn?.after], ["running", ["plan:a"]]);

  apply(state, { t: 3, event: "tool.check", input: { tool: "AskUserQuestion", reason: "Which code?" }, result: { decision: "ask" } });
  apply(state, { t: 3, event: "classic.PermissionRequest", input: { tool_name: "AskUserQuestion" } });
  assert.equal(nodes(state).find((node) => node.kind === "turn")?.status, "needs_you");

  apply(state, { t: 4, event: "tool.call", input: { tool: "AskUserQuestion" }, result: { result: { answers: {} } } });
  apply(state, plan([{ id: "b", title: "B", status: "in_progress" }]));
  assert.deepEqual(nodes(state).map((node) => node.id), ["plan:a", "plan:b"]);
});

test("/clear ends the old session before the new one starts", () => {
  const state = initialState();
  apply(state, { t: 0, event: "classic.SessionStart", input: { source: "startup", session_id: "old" } });
  apply(state, { t: 1, event: "turn.start", input: { turnId: "a" } });
  apply(state, { t: 2, event: "turn.complete", input: { reason: "answer" }, result: { agents: [] } });
  apply(state, { t: 3, event: "classic.SessionEnd", input: { reason: "clear", session_id: "old" } });
  assert.deepEqual([state.sessionId, sessionState(state)], ["old", "ended"]);
  apply(state, { t: 4, event: "classic.SessionStart", input: { source: "clear", session_id: "new" } });
  assert.deepEqual([state.sessionId, sessionState(state)], ["new", "idle"]);
});

test("a step id reused in a later request is new work, not the old step again", () => {
  const state = initialState();
  const plan = (steps: object[]): GraphEvent => ({ t: 0, event: "tool.call", input: { tool: FLOWPLAN_TOOL, steps }, result: { result: [] } });
  apply(state, { t: 0, event: "prompt.submit", input: { chars: 5 } });
  apply(state, plan([{ id: "edit", title: "Edit", status: "completed" }, { id: "npm-test", title: "Run tests", status: "completed", blockedBy: ["edit"] }]));
  apply(state, { t: 1, event: "prompt.submit", input: { chars: 5 } });
  apply(state, plan([
    { id: "add-vip", title: "Add VIP", status: "in_progress" },
    { id: "vip-test", title: "Test VIP", blockedBy: ["add-vip"] },
    { id: "npm-test", title: "Run tests", blockedBy: ["vip-test"] }
  ]));
  apply(state, plan([{ id: "npm-test", status: "in_progress" }]));
  const shown = nodes(state);
  assert.deepEqual(shown.map((node) => [node.id, node.status, node.blockedBy.join()]), [
    ["plan:edit", "done", ""],
    ["plan:npm-test", "done", "plan:edit"],
    ["plan:add-vip", "running", ""],
    ["plan:vip-test", "pending", "plan:add-vip"],
    ["plan:npm-test#2", "running", "plan:vip-test"]
  ]);
  assert.deepEqual(shown.find((node) => node.id === "plan:add-vip")?.after, ["plan:npm-test"]);
  const placed = snapshot(state, { seq: 1, now: 0 });
  assert.deepEqual(placed.warnings, []);
});

test("a background agent's result is not a new request: its steps stay in the same part of the graph", () => {
  const state = initialState();
  const plan = (steps: object[]): GraphEvent => ({ t: 0, event: "tool.call", input: { tool: FLOWPLAN_TOOL, steps }, result: { result: [] } });
  apply(state, { t: 0, event: "prompt.submit", input: { chars: 50, origin: "composer" } });
  apply(state, plan([{ id: "review", title: "Review", status: "in_progress" }]));
  apply(state, { t: 1, event: "prompt.submit", input: { chars: 900, origin: "task-notification" } });
  apply(state, plan([{ id: "found", title: "Found work", blockedBy: ["review"] }, { id: "more", title: "More work" }]));
  assert.equal(nodes(state).find((node) => node.id === "plan:more")?.after, undefined);
  apply(state, { t: 2, event: "prompt.submit", input: { chars: 20, origin: "composer" } });
  apply(state, plan([{ id: "next", title: "Next request" }]));
  assert.deepEqual(nodes(state).find((node) => node.id === "plan:next")?.after, ["plan:found", "plan:more"]);
});

test("a step left running is closed when a step that waits on it starts or finishes", () => {
  const state = initialState();
  const plan = (steps: object[]): GraphEvent => ({ t: 0, event: "tool.call", input: { tool: FLOWPLAN_TOOL, steps }, result: { result: [] } });
  apply(state, plan([{ id: "test", title: "Run tests", status: "in_progress" }, { id: "review", title: "Review", blockedBy: ["test"] }, { id: "other", title: "Other", status: "in_progress" }]));
  apply(state, { t: 5, event: "tool.call", input: { tool: FLOWPLAN_TOOL, steps: [{ id: "review", status: "in_progress" }] }, result: { result: [] } });
  const shown = nodes(state);
  assert.deepEqual(shown.map((node) => [node.id, node.status]), [
    ["plan:test", "done"],
    ["plan:review", "running"],
    // Not a blocker of review: left as the agent said.
    ["plan:other", "running"]
  ]);
  assert.equal(shown[0]?.finishedAt, 5);

  // Straight from pending to completed closes its blockers too.
  apply(state, plan([{ id: "x", title: "X", status: "in_progress" }, { id: "y", title: "Y", blockedBy: ["x"] }]));
  apply(state, { t: 9, event: "tool.call", input: { tool: FLOWPLAN_TOOL, steps: [{ id: "y", status: "completed" }] }, result: { result: [] } });
  assert.equal(nodes(state).find((node) => node.id === "plan:x")?.status, "done");
});
