import { expect, test } from "vitest";
import { isSnapshot } from "../../../viewer/src/store.ts";
import { timelineOf, type Timeline } from "../engine/timeline.ts";
import { LANGS } from "../i18n/index.ts";
import { SCENE_BUILDERS, sceneFor } from "./index.ts";
import type { SceneId } from "./types.ts";

const IDS = Object.keys(SCENE_BUILDERS) as SceneId[];

for (const id of IDS) {
  for (const lang of LANGS) {
    test(`${id} (${lang}): every frame is a valid snapshot, numbered in order`, () => {
      const timeline = timelineOf(sceneFor(id, lang));
      timeline.frames.forEach((frame, i) => {
        expect(isSnapshot(frame.snapshot), `frame ${i}`).toBe(true);
        expect(frame.snapshot.seq).toBe(i + 1);
        for (const node of frame.snapshot.nodes) expect(frame.snapshot.layout[node.id], node.id).toBeDefined();
      });
    });

    test(`${id} (${lang}): ends with everything green, and the idle animation (if any) comes after the work`, () => {
      const timeline = timelineOf(sceneFor(id, lang));
      const last = timeline.frames.at(-1)!.snapshot;
      expect(last.nodes.length).toBeGreaterThan(0);
      for (const node of last.nodes) expect(node.status, node.title).toBe("done");
      expect(last.sessionState).not.toBe("working");
      if (timeline.dreamAt !== undefined) expect(timeline.dreamAt).toBeGreaterThan(timeline.frames.at(-1)!.at);
      expect(timeline.endAt).toBeGreaterThan(timeline.frames.at(-1)!.at);
    });
  }
}

test("the scene is deterministic: the same script gives the same frames", () => {
  const a = timelineOf(sceneFor("overlay", "en"));
  const b = timelineOf(sceneFor("overlay", "en"));
  expect(b).toEqual(a);
});

test("the overlay scene shows every color of the legend and a flashing error", () => {
  const frames = timelineOf(sceneFor("overlay", "en")).frames.map((f) => f.snapshot);
  const seen = new Set(frames.flatMap((s) => s.nodes.map((n) => n.status)));
  for (const status of ["pending", "running", "needs_you", "done"]) expect(seen.has(status as never), status).toBe(true);
  expect(frames.some((s) => s.nodes.some((n) => n.lastError !== undefined))).toBe(true);
  expect(frames.some((s) => s.nodes.some((n) => n.kind === "agent"))).toBe(true);
});

test("the subagents scene hangs each subagent from the step that started it", () => {
  const frames = timelineOf(sceneFor("subagents", "en")).frames.map((f) => f.snapshot);
  const agents = frames.at(-1)!.nodes.filter((n) => n.kind === "agent");
  expect(agents.length).toBe(3);
  // Three are on screen together at one moment.
  expect(Math.max(...frames.map((f) => f.nodes.filter((n) => n.kind === "agent").length))).toBe(3);
  for (const agent of agents) expect(agent.parent, agent.id).toBeDefined();
});

test("the follow-up scene draws the second request to the right of the first", () => {
  const frames = timelineOf(sceneFor("followup", "en")).frames.map((f) => f.snapshot);
  const shown = frames.find((s) => s.nodes.some((n) => n.id === "plan:expire") && s.nodes.some((n) => n.id === "plan:read"))!;
  expect(shown).toBeDefined();
  expect(shown.layout["plan:expire"]!.rank).toBeGreaterThan(shown.layout["plan:read"]!.rank);
});

test("the idle scene rests long enough for the animation to start", () => {
  const timeline: Timeline = timelineOf(sceneFor("idle", "pt"));
  expect(timeline.dreamAt).toBeDefined();
  expect(timeline.endAt - timeline.dreamAt!).toBeGreaterThan(5000);
});

test("the hover tour and the request groups point at nodes that exist", () => {
  const overlay = sceneFor("overlay", "en");
  const frames = timelineOf(overlay).frames.map((f) => f.snapshot);
  const ids = new Set(frames.flatMap((f) => f.nodes.map((n) => n.id)));
  for (const id of overlay.hoverTour ?? []) expect(ids.has(id), id).toBe(true);

  const followup = sceneFor("followup", "en");
  const last = timelineOf(followup).frames.at(-1)!.snapshot;
  for (const group of followup.groups ?? []) {
    for (const id of group.ids) expect(last.nodes.some((n) => n.id === id), id).toBe(true);
  }
});

test("the idle scene graph has between 8 and 12 steps", () => {
  const last = timelineOf(sceneFor("idle", "en")).frames.at(-1)!.snapshot;
  const steps = last.nodes.filter((n) => n.kind !== "turn").length;
  expect(steps).toBeGreaterThanOrEqual(8);
  expect(steps).toBeLessThanOrEqual(12);
});
