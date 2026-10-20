import { describe, expect, test } from "vitest";
import { snapshotOf, task } from "../goldens.ts";
import { createSessionStore } from "../store.ts";
import { EDGE, start, think, type Brain } from "./brain.ts";
import { formProgress, FORMED_MS, FORM_START_MS, gatherProgress } from "./gather.ts";
import { poseFor, SHY_AFTER_MS } from "./PetPage.tsx";
import { snailSprite, shellSprite, vibration } from "./snail.ts";
import { summarize } from "./summary.ts";

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

describe("what the snail tells on hover", () => {
  test("the current session's progress and what it did last", () => {
    const snapshot = snapshotOf(
      [
        task("a", { status: "done", title: "Write the tests", finishedAt: 60_000 }),
        task("b", { status: "done", title: "Fix the sound", finishedAt: 120_000 }),
        task("c", { status: "pending" })
      ],
      { sessionState: "idle", updatedAt: 120_000, cwd: "/work/FlowCTL" }
    );
    const summary = summarize([snapshot], "s1", 120_000 + 4 * 60_000);
    expect(summary).toMatchObject({ name: "FlowCTL", stateLabel: "Idle", done: 2, total: 3, since: "4 min ago", others: 0 });
    expect(summary?.focus).toEqual({ label: "Last done, 4 min ago", title: "Fix the sound" });
  });

  test("a step that needs the person comes first, then the one running; other sessions are counted", () => {
    const running = snapshotOf([task("a", { status: "running", title: "Build", activeForm: "Building the app" })]);
    expect(summarize([running], "s1", 0)?.focus).toEqual({ label: "Now", title: "Building the app" });
    const asking = snapshotOf(
      [task("a", { status: "needs_you", title: "Run rm", attention: { kind: "permission", reason: "Allow rm -rf build?", detail: "rm -rf build", since: 0 } })],
      { sessionState: "waiting_you" }
    );
    const other = snapshotOf([task("x")], { sessionId: "s2", sessionState: "waiting_you" });
    const summary = summarize([asking, other], "s1", 0);
    expect(summary?.focus).toEqual({ label: "Needs you", title: "Allow rm -rf build?" });
    expect(summary).toMatchObject({ others: 1, othersWaiting: 1 });
    expect(summarize([], null, 0)).toBeNull();
  });
});

describe("how the snail reacts to the person", () => {
  const calm = { alert: false, held: false, mouse: null, hoverSince: null };
  test("antennas up when the mouse is near, hiding when it stays on it, hanging when carried", () => {
    expect(poseFor("walk", calm, 0)).toBe("walk");
    expect(poseFor("look", { ...calm, mouse: 20 }, 0)).toBe("curious");
    expect(poseFor("look", { ...calm, mouse: 0, hoverSince: 0 }, SHY_AFTER_MS - 1)).toBe("curious");
    expect(poseFor("look", { ...calm, mouse: 0, hoverSince: 0 }, SHY_AFTER_MS)).toBe("shy");
    expect(poseFor("alert", { ...calm, alert: true, mouse: 0 }, 0)).toBe("alert");
    expect(poseFor("walk", { ...calm, held: true, alert: true }, 0)).toBe("held");
  });
});
