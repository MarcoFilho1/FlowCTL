import { describe, expect, test } from "vitest";
import { FIXTURES, delayBefore, loadFixture, replaySnapshots } from "./player.ts";
import { GOLDENS, golden } from "./goldens.ts";

test("every fixture has a golden snapshot", () => {
  expect(FIXTURES).toEqual([...GOLDENS.keys()]);
});

describe.each(FIXTURES)("fixture %s", (name) => {
  const events = loadFixture(name) ?? [];

  test("replays to its golden snapshot, as the mod would live", () => {
    const snapshots = replaySnapshots(events);
    expect(snapshots).toHaveLength(events.length);
    expect(snapshots.at(-1)).toEqual(golden(name));
  });

  test("files every snapshot under the given id, seq growing by one", () => {
    const snapshots = replaySnapshots(events, name);
    expect(new Set(snapshots.map((s) => s.sessionId))).toEqual(new Set([name]));
    expect(snapshots.map((s) => s.seq)).toEqual(events.map((_, i) => i + 1));
  });
});

test("earlier snapshots are not changed by later events", () => {
  const events = loadFixture("03-subagents-with-task-graph") ?? [];
  const before = replaySnapshots(events.slice(0, 60)).at(-1);
  const during = replaySnapshots(events)[59];
  expect(during).toEqual(before);
});

test("an unknown fixture is undefined", () => {
  expect(loadFixture("nope")).toBeUndefined();
});

test("delays follow the recording, scaled by speed, long pauses cut short", () => {
  const events = [{ t: 0, event: "a" }, { t: 400, event: "b" }, { t: 60_400, event: "c" }];
  expect(delayBefore(events, 0, 1)).toBe(0);
  expect(delayBefore(events, 1, 1)).toBe(400);
  expect(delayBefore(events, 1, 4)).toBe(100);
  expect(delayBefore(events, 2, 1)).toBe(2000);
});
