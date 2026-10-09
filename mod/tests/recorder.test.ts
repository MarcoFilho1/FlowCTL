import { expect, test } from "claude-code/testing";

// The recorder observes: what the tools answer reaches the session unchanged.
test("graph tool calls pass through the recorder untouched", async ($, on) => {
  on("tool.call", () => ({ result: { task: { id: "1", subject: "Write tests" } } }));
  const answer = await $.tool.call({ tool: "TaskCreate", subject: "Write tests", description: "cover the reducer" });
  expect(answer.result).toEqual({ task: { id: "1", subject: "Write tests" } });
});

test("errored calls of other tools pass through untouched", async ($, on) => {
  on("tool.call", () => ({ isError: true as const, result: "boom", text: "boom" }));
  const answer = await $.tool.call({ tool: "Bash", command: "false" });
  expect(answer.isError).toBe(true);
  expect(answer.text).toBe("boom");
});

test("permission checks keep the engine's verdict", async ($, on) => {
  on("tool.check", () => ({ decision: "ask" as const }));
  const verdict = await $.tool.check({ tool: "Bash", input: { command: "rm -rf build" } });
  expect(verdict.decision).toBe("ask");
});
