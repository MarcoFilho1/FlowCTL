import { expect, test } from "vitest";
import { snapshotOf, task } from "./goldens.ts";
import { errorsOf, statusesOf, transitions } from "./transitions.ts";

const chain = (a: string, b: string, c: string) =>
  snapshotOf([task("a", { status: a as never }), task("b", { status: b as never, blockedBy: ["a"] }), task("c", { status: c as never, blockedBy: ["b"] })]);

test("a finished step hands off to the step it unblocked", () => {
  const before = statusesOf(chain("running", "pending", "pending"));
  expect(transitions(before, chain("done", "running", "pending"))).toEqual({ added: [], finished: ["a"], started: ["b"], handoffs: [["a", "b"]], flashed: [] });
});

test("the handoff shows even before the agent marks the next step running", () => {
  const before = statusesOf(chain("running", "pending", "pending"));
  expect(transitions(before, chain("done", "pending", "pending")).handoffs).toEqual([["a", "b"]]);
});

test("no handoff to a step still waiting on another", () => {
  const join = (a: string, b: string) =>
    snapshotOf([task("a", { status: a as never }), task("b", { status: b as never }), task("c", { blockedBy: ["a", "b"] })]);
  const before = statusesOf(join("running", "running"));
  expect(transitions(before, join("done", "running")).handoffs).toEqual([]);
  expect(transitions(statusesOf(join("done", "running")), join("done", "done")).handoffs).toEqual([["b", "c"]]);
});

test("several steps finishing at once each fire, the first snapshot fires nothing", () => {
  const before = statusesOf(chain("running", "running", "pending"));
  expect(transitions(before, chain("done", "done", "pending")).finished).toEqual(["a", "b"]);
  expect(transitions(undefined, chain("done", "running", "pending"))).toEqual({ added: [], finished: [], started: [], handoffs: [], flashed: [] });
});

test("nodes that were not there before are added: a step the agent just discovered", () => {
  const before = statusesOf(snapshotOf([task("a", { status: "running" })]));
  const after = snapshotOf([task("a", { status: "running" }), task("b", { blockedBy: ["a"] }), task("c", { blockedBy: ["a"] })]);
  expect(transitions(before, after).added).toEqual(["b", "c"]);
});

test("a new tool error on a node flashes it once", () => {
  const before = snapshotOf([task("a", { status: "running" })]);
  const after = snapshotOf([task("a", { status: "running", lastError: { detail: "Exit code 1", at: 5 } })]);
  expect(transitions(statusesOf(before), after, errorsOf(before)).flashed).toEqual(["a"]);
  expect(transitions(statusesOf(after), after, errorsOf(after)).flashed).toEqual([]);
});
