import assert from "node:assert/strict";
import { test } from "node:test";
import { displayStatus, errorDetail, isStoppedByUser } from "../../mod/graph/status.ts";

const permission = { kind: "permission" as const, detail: "Bash", since: 0 };
const failure = { kind: "error" as const, detail: "Exit code 1", since: 0 };

test("done wins over any attention", () => {
  assert.equal(displayStatus("completed", failure), "done");
  assert.equal(displayStatus("completed", permission), "done");
});

test("error wins over needs-you, needs-you over progress", () => {
  assert.equal(displayStatus("in_progress", failure), "error");
  assert.equal(displayStatus("pending", permission), "needs_you");
  assert.equal(displayStatus("in_progress"), "running");
  assert.equal(displayStatus("pending"), "pending");
});

test("a paused task shows as pending", () => {
  assert.equal(displayStatus("in_progress", undefined, true), "pending");
});

test("denials and Esc are the person stopping, not failures", () => {
  assert.ok(isStoppedByUser("The user doesn't want to proceed with this tool use."));
  assert.ok(isStoppedByUser("Exit code 137\n[Request interrupted by user for tool use]"));
  assert.ok(!isStoppedByUser("Exit code 1\nError: Cannot find module"));
  assert.ok(!isStoppedByUser(undefined));
});

test("error details keep the first line, cut to a label", () => {
  assert.equal(errorDetail("Exit code 1\nstack..."), "Exit code 1");
  assert.equal(errorDetail("x".repeat(200)).length, 120);
  assert.equal(errorDetail(undefined), "tool error");
});
