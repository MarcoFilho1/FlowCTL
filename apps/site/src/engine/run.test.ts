import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createSessionStore } from "../../../viewer/src/store.ts";
import { sceneFor } from "../scenes/index.ts";
import { runScene } from "./run.ts";
import { timelineOf } from "./timeline.ts";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test("runScene pushes every frame through the store, in time order, and loops", () => {
  const scene = sceneFor("followup", "en");
  const timeline = timelineOf(scene);
  const store = createSessionStore(() => Date.now());
  const pushed: number[] = [];
  const unsubscribe = store.subscribe(() => {
    const shown = store.getState().sessions[0];
    if (shown && pushed.at(-1) !== shown.seq) pushed.push(shown.seq);
  });
  const handlers = { onDream: vi.fn(), onLoop: vi.fn() };
  const stop = runScene(scene, store, handlers);

  vi.advanceTimersByTime(timeline.frames.at(-1)!.at);
  expect(pushed).toEqual(timeline.frames.map((frame) => frame.snapshot.seq));
  expect(handlers.onLoop).toHaveBeenCalledTimes(1);

  // The scene starts over after its hold, with sequence numbers from 1 again.
  vi.advanceTimersByTime(timeline.endAt);
  expect(handlers.onLoop).toHaveBeenCalledTimes(2);
  expect(pushed.slice(timeline.frames.length, timeline.frames.length + 1)).toEqual([1]);

  stop();
  unsubscribe();
});

test("the idle animation starts when the scene rests, and stops with the next work", () => {
  const scene = sceneFor("idle", "pt");
  const timeline = timelineOf(scene);
  const handlers = { onDream: vi.fn(), onLoop: vi.fn() };
  const stop = runScene(scene, createSessionStore(), handlers);
  vi.advanceTimersByTime(timeline.dreamAt! - 1);
  expect(handlers.onDream).not.toHaveBeenCalledWith(true);
  vi.advanceTimersByTime(1);
  expect(handlers.onDream).toHaveBeenLastCalledWith(true);
  stop();
});

test("stopping a scene cancels its pending frames", () => {
  const scene = sceneFor("overlay", "en");
  const store = createSessionStore();
  const stop = runScene(scene, store, { onDream: vi.fn(), onLoop: vi.fn() });
  vi.advanceTimersByTime(1000);
  stop();
  const before = store.getState().sessions[0]?.seq;
  vi.advanceTimersByTime(60_000);
  expect(store.getState().sessions[0]?.seq).toBe(before);
});
