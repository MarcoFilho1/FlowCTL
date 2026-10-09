import { expect, test } from "vitest";
import { duration, hoverCard } from "./hover.ts";
import { agent, snapshotOf, task } from "./goldens.ts";

test("a done step tells what came of it and how long it took", () => {
  const node = agent("a", undefined, { status: "done", title: "Review cart", startedAt: 1_000, finishedAt: 43_000, summary: "Found 2 issues." });
  expect(hoverCard(node, snapshotOf([node]))).toEqual({ title: "Review cart", status: "Subagent done in 42s", body: "Found 2 issues." });
});

test("a done step without a summary falls back to its description", () => {
  const node = task("a", { status: "done", description: "Swap == for ===" });
  expect(hoverCard(node, snapshotOf([node])).body).toBe("Swap == for ===");
});

test("a running step tells what it is doing and for how long", () => {
  const node = task("a", { status: "running", activeForm: "Running tests", startedAt: 0, description: "npm test" });
  expect(hoverCard(node, snapshotOf([node], { updatedAt: 125_000 }))).toEqual({
    title: "Task a",
    status: "Running tests · 2m 05s",
    body: "npm test"
  });
});

test("a pending step names what it waits on", () => {
  const a = task("a", { title: "Build", status: "running" });
  const b = task("b", { title: "Lint", status: "done" });
  const c = task("c", { title: "Ship", blockedBy: ["a", "b"] });
  expect(hoverCard(c, snapshotOf([a, b, c])).status).toBe("Waiting on Build");
  expect(hoverCard(task("d"), snapshotOf([task("d")])).status).toBe("Not started");
  expect(hoverCard(task("e", { startedAt: 5 }), snapshotOf([])).status).toBe("Paused");
});

test("a node that needs you says why", () => {
  const permission = task("a", { status: "needs_you", attention: { kind: "permission", detail: "Bash", reason: "Bash: Remove the build folder", since: 0 } });
  expect(hoverCard(permission, snapshotOf([permission]))).toMatchObject({ status: "Needs your permission", body: "Bash: Remove the build folder" });
  const question = task("b", { status: "needs_you", attention: { kind: "question", detail: "AskUserQuestion", reason: "Which discount code?", since: 0 } });
  expect(hoverCard(question, snapshotOf([question]))).toMatchObject({ status: "Question for you", body: "Which discount code?" });
});

test("a failed node shows the error", () => {
  const node = task("a", { status: "error", attention: { kind: "error", detail: "Exit code 1", since: 0 } });
  expect(hoverCard(node, snapshotOf([node]))).toMatchObject({ status: "Step failed", body: "Exit code 1" });
});

test("durations read like a clock", () => {
  expect(duration(0, 9_400)).toBe("9s");
  expect(duration(0, 65_000)).toBe("1m 05s");
  expect(duration(0, 3_723_000)).toBe("1h 02m");
  expect(duration(undefined, 5)).toBeUndefined();
  expect(duration(10, 5)).toBeUndefined();
});
