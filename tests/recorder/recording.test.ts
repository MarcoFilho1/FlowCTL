import assert from "node:assert/strict";
import { test } from "node:test";
import { omitKeys, Recording, trim } from "../../mod/recorder/recording.ts";

test("trim cuts long strings and keeps short ones", () => {
  assert.equal(trim("ok"), "ok");
  const long = trim("x".repeat(2500)) as string;
  assert.ok(long.startsWith("x".repeat(2000)));
  assert.ok(long.endsWith("…[+500 chars]"));
});

test("trim truncates wide arrays and deep objects and drops non-JSON values", () => {
  const wide = trim(Array.from({ length: 60 }, (_, i) => i)) as unknown[];
  assert.equal(wide.length, 51);
  assert.equal(wide[50], "…[+10 items]");

  const deep = trim({ a: { b: { c: { d: { e: { f: { g: 1 } } } } } } });
  assert.deepEqual(deep, { a: { b: { c: { d: { e: { f: "…[depth]" } } } } } });

  assert.deepEqual(trim({ keep: 1, fn: () => 1, gone: undefined }), { keep: 1 });
});

test("events are numbered in arrival order", () => {
  const recording = new Recording("/r", "7");
  recording.add({ t: 10, event: "turn.start" });
  const second = recording.add({ t: 11, event: "tool.call", agentId: "a1" });
  assert.equal(second.seq, 2);
  assert.equal(recording.size, 2);
});

test("flush writes whole chunks and only the ones touched since the last flush", () => {
  const recording = new Recording("/r", "7", 2);
  for (let i = 0; i < 3; i += 1) {
    recording.add({ t: i, event: "e" });
  }

  const first = recording.flush();
  assert.deepEqual(first.map((write) => write.file), ["/r/rec-7-0001.jsonl", "/r/rec-7-0002.jsonl"]);
  assert.equal(first[0]?.text.trim().split("\n").length, 2);
  assert.deepEqual(JSON.parse(first[1]?.text.trim() ?? ""), { seq: 3, t: 2, event: "e" });

  assert.deepEqual(recording.flush(), []);

  recording.add({ t: 3, event: "e" });
  const second = recording.flush();
  assert.deepEqual(second.map((write) => write.file), ["/r/rec-7-0002.jsonl"]);
  assert.equal(second[0]?.text.trim().split("\n").length, 2);
});

test("omitKeys drops keys at any depth, inside arrays too", () => {
  const event = {
    hook_event_name: "PostToolBatch",
    tool_calls: [{ tool_name: "Bash", tool_input: { command: "cat secret" }, tool_response: "x" }]
  };
  assert.deepEqual(omitKeys(event, new Set(["tool_input", "tool_response"])), {
    hook_event_name: "PostToolBatch",
    tool_calls: [{ tool_name: "Bash" }]
  });
});
