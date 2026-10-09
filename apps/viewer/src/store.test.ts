import { describe, expect, test } from "vitest";
import { createSessionStore, installBridge, isSnapshot, sessionKey } from "./store.ts";
import { golden, snapshotOf, task } from "./goldens.ts";

describe("session store", () => {
  test("shows the first session it hears from", () => {
    const store = createSessionStore();
    expect(store.push(snapshotOf([task("a")]))).toBe(true);
    expect(store.getState().active).toBe("s1");
    expect(store.getState().sessions).toHaveLength(1);
  });

  test("drops a snapshot whose seq is not newer, per session", () => {
    const store = createSessionStore();
    store.push(snapshotOf([task("a")], { seq: 5 }));
    expect(store.push(snapshotOf([task("old")], { seq: 4 }))).toBe(false);
    expect(store.push(snapshotOf([task("same")], { seq: 5 }))).toBe(false);
    expect(store.getState().sessions[0]?.nodes[0]?.id).toBe("a");

    // Another session has its own seq.
    expect(store.push(snapshotOf([task("b")], { sessionId: "s2", seq: 1 }))).toBe(true);
    expect(store.push(snapshotOf([task("a2")], { seq: 6 }))).toBe(true);
    expect(store.getState().sessions.map(sessionKey)).toEqual(["s1", "s2"]);
  });

  test("keeps the selected tab when other sessions update", () => {
    const store = createSessionStore();
    store.push(snapshotOf([], { sessionId: "s1" }));
    store.push(snapshotOf([], { sessionId: "s2" }));
    store.select("s2");
    store.push(snapshotOf([], { sessionId: "s1", seq: 2 }));
    expect(store.getState().active).toBe("s2");
    store.select("nobody");
    expect(store.getState().active).toBe("s2");
  });

  test("rejects anything that is not a schema 1 snapshot", () => {
    const store = createSessionStore();
    for (const junk of [null, 42, "x", {}, { ...snapshotOf([]), schema: 2 }, { ...snapshotOf([]), nodes: [{}] }]) {
      expect(store.push(junk)).toBe(false);
    }
    expect(store.getState().sessions).toEqual([]);
    expect(isSnapshot(golden("03-subagents-with-task-graph"))).toBe(true);
  });

  test("a session with no id is filed under its folder", () => {
    expect(sessionKey(snapshotOf([], { sessionId: "", cwd: "/p" }))).toBe("/p");
    expect(sessionKey(snapshotOf([], { sessionId: "", cwd: "" }))).toBe("session");
  });

  test("forget lets a session start over at seq 1", () => {
    const store = createSessionStore();
    store.push(snapshotOf([], { seq: 9 }));
    store.forget("s1");
    expect(store.getState()).toEqual({ sessions: [], active: null, look: "pixel" });
    expect(store.push(snapshotOf([], { seq: 1 }))).toBe(true);
  });

  test("notifies subscribers on change only", () => {
    const store = createSessionStore();
    let calls = 0;
    const stop = store.subscribe(() => (calls += 1));
    store.push(snapshotOf([]));
    store.push(snapshotOf([])); // same seq: dropped
    stop();
    store.push(snapshotOf([], { seq: 2 }));
    expect(calls).toBe(1);
  });
});

test("the bridge exposes push on window.flowctl", () => {
  const store = createSessionStore();
  const target = {} as Window;
  installBridge(store, target);
  expect(target.flowctl?.push(snapshotOf([task("a")]))).toBe(true);
  expect(target.flowctl?.push({ nope: true })).toBe(false);
  expect(store.getState().sessions).toHaveLength(1);
});
