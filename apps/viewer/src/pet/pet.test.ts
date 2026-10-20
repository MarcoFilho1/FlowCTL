import { describe, expect, test } from "vitest";
import { createSessionStore } from "../store.ts";
import { EDGE, start, think, type Brain } from "./brain.ts";
import { formProgress, FORMED_MS, FORM_START_MS, gatherProgress } from "./gather.ts";
import { snailSprite, shellSprite, vibration } from "./snail.ts";

const room = { left: 500, right: 500 };
const fixed = (value: number) => () => value;

describe("the snail's brain", () => {
  test("walks at first, then stops, rests and falls asleep in its own time", () => {
    let brain: Brain = start(0, fixed(0));
    expect(think(brain, { now: 10, mouse: null, room, alert: false }).pose).toBe("walk");
    // Past the walk: a low roll pauses it (it looks around).
    let step = think(brain, { now: brain.until, mouse: null, room, alert: false, random: fixed(0) });
    expect(step.brain.activity).toBe("pause");
    expect(step.pose).toBe("look");
    expect(step.moving).toBe(false);
    // From a rest, a low roll puts it to sleep.
    brain = { activity: "rest", until: 100, dir: 1 };
    step = think(brain, { now: 100, mouse: null, room, alert: false, random: fixed(0) });
    expect(step.pose).toBe("sleep");
  });

  test("turns back at an edge and stays put with no room either way", () => {
    const brain: Brain = { activity: "walk", until: 10_000, dir: 1 };
    const turned = think(brain, { now: 1, mouse: null, room: { left: 300, right: EDGE - 1 }, alert: false });
    expect(turned.brain.dir).toBe(-1);
    expect(turned.moving).toBe(true);
    const stuck = think(brain, { now: 1, mouse: null, room: { left: 2, right: 2 }, alert: false });
    expect(stuck.moving).toBe(false);
    expect(stuck.pose).toBe("look");
  });

  test("the mouse wakes it and turns it around; a waiting session sets it rattling", () => {
    const asleep: Brain = { activity: "sleep", until: 60_000, dir: 1 };
    const woken = think(asleep, { now: 5, mouse: -40, room, alert: false });
    expect(woken.pose).toBe("look");
    expect(woken.brain.dir).toBe(-1);
    expect(woken.brain.activity).toBe("rest");
    const alert = think(asleep, { now: 5, mouse: null, room, alert: true });
    expect(alert.pose).toBe("alert");
    expect(alert.moving).toBe(false);
  });
});

describe("the nodes gather into the snail", () => {
  test("one after another, all in before the snail is whole", () => {
    expect(gatherProgress(0, 20, 0)).toBe(0);
    expect(gatherProgress(0, 20, 300)).toBeGreaterThan(gatherProgress(19, 20, 300));
    expect(gatherProgress(19, 20, FORM_START_MS + 400)).toBe(1);
    expect(formProgress(FORM_START_MS)).toBe(0);
    expect(formProgress(FORMED_MS)).toBe(1);
  });

  test("a big graph gathers no slower than a small one", () => {
    expect(gatherProgress(199, 200, 1100)).toBe(1);
  });
});

describe("the snail's sprites", () => {
  const cells = (sprite: (string | null)[][], material: string) => sprite.flat().filter((m) => m?.[0] === material).length;

  test("its shell is shaded and the whole snail outlined", () => {
    const walking = snailSprite("walk", 0, 0);
    expect(cells(walking, "a")).toBeGreaterThan(40);
    expect(walking.flat()).toContain("a+");
    expect(walking.flat()).toContain("a-");
    expect(cells(walking, "o")).toBeGreaterThan(20);
  });

  test("while it rattles the shell is its own sprite; asleep, it is all shell", () => {
    expect(cells(snailSprite("alert", 0, 0), "a")).toBe(0);
    expect(cells(shellSprite(1), "a")).toBeGreaterThan(40);
    expect(cells(snailSprite("sleep", 0, 0), "a")).toBeGreaterThan(cells(snailSprite("sleep", 0, 0), "b"));
  });

  test("the shell buzzes in bursts, still between them", () => {
    expect(vibration(500)).toBe(0);
    expect([100, 130, 160, 200].some((t) => vibration(t) !== 0)).toBe(true);
  });
});

describe("the idle style in the store", () => {
  test("shapes by default, the snail when chosen, and waking counts", () => {
    const store = createSessionStore();
    expect(store.getState().idleStyle).toBe("shapes");
    store.setIdleStyle("pet");
    expect(store.getState().idleStyle).toBe("pet");
    store.setIdleStyle("nonsense" as never);
    expect(store.getState().idleStyle).toBe("pet");
    store.setPetAway(true);
    expect(store.getState().petAway).toBe(true);
    store.wake();
    expect(store.getState().wakes).toBe(1);
    expect(store.getState().petAway).toBe(false);
  });
});
