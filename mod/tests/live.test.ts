import { expect, test } from "claude-code/testing";

const FLOWPLAN = "mcp__flowctl-graph__FlowPlan";
const COMPOSE = {
  model: "claude-fable-5-1",
  promptModel: "claude-fable-5-1",
  surfaces: ["terminal"] as const,
  tools: [],
  outputStyle: null,
  traits: []
};

test("the mod serves its FlowPlan tool itself", async ($) => {
  const answer = await $.tool.call({
    tool: FLOWPLAN,
    steps: [
      { id: "read", title: "Read the code", status: "completed" },
      { id: "fix", title: "Write the fix", status: "in_progress", blockedBy: ["read"] }
    ]
  });
  expect(answer.isError).toBeUndefined();
  expect(answer.text).toContain("2 step(s)");
  // The engine accepts only text or content blocks from a plugin's tool; an
  // object makes every call fail for the model (seen in a real session).
  expect(answer.result).toEqual([{ type: "text", text: answer.text }]);
});

test("the nudge stays out of the system prompt by default", async ($, on) => {
  on("prompt.compose", () => ({ sections: [{ id: "base", text: "base", scope: "shared" as const }] }));
  const { sections } = await $.prompt.compose(COMPOSE);
  expect(sections.map((section) => section.id)).toEqual(["base"]);
});

test("with the nudge on, one session section asks for a plan", { options: { nudge: true } }, async ($, on) => {
  on("prompt.compose", () => ({ sections: [{ id: "base", text: "base", scope: "shared" as const }] }));
  const { sections } = await $.prompt.compose(COMPOSE);
  expect(sections.map((section) => [section.id, section.scope])).toEqual([
    ["base", "shared"],
    ["flowctl-nudge", "session"]
  ]);
  expect(sections[1]?.text).toContain("3 or more steps");
});
