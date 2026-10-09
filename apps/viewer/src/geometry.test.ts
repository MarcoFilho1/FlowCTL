import { describe, expect, test } from "vitest";
import { layout } from "../../../mod/graph/layout.ts";
import type { GraphNode, Snapshot } from "../../../mod/graph/types.ts";
import { buildScene, circleBox, fitScale, footprint, linkPath, NODE_R, SATELLITE_R, shortLabel, type Box, type Scene } from "./geometry.ts";
import { GOLDENS, agent, golden, snapshotOf, task } from "./goldens.ts";

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function inside(inner: Box, outer: Box): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}

/** Laid out by the mod's own layout, as a real snapshot is. */
function laidOut(nodes: GraphNode[]): Snapshot {
  return snapshotOf(nodes, { layout: layout(nodes).layout });
}

function assertSound(snapshot: Snapshot, scene: Scene): void {
  expect(scene.nodes.map((shape) => shape.id).sort()).toEqual(snapshot.nodes.map((node) => node.id).sort());
  const stage = { x: 0, y: 0, w: scene.width, h: scene.height };
  for (const [i, a] of scene.nodes.entries()) {
    expect(inside(footprint(a), stage), `${a.id} is inside the scene`).toBe(true);
    for (const b of scene.nodes.slice(i + 1)) {
      expect(overlaps(footprint(a), footprint(b)), `${a.id} and ${b.id} do not overlap`).toBe(false);
    }
  }
}

describe.each([...GOLDENS.keys()])("golden %s", (name) => {
  test("draws every node once as a circle, labels included, without overlaps", () => {
    const snapshot = golden(name);
    assertSound(snapshot, buildScene(snapshot));
  });

  test("links exactly the declared dependencies", () => {
    const snapshot = golden(name);
    const declared = snapshot.nodes.flatMap((node) => node.blockedBy.map((from) => `${from}->${node.id}`)).sort();
    const drawn = buildScene(snapshot).links.filter((link) => link.kind === "dependency");
    expect(drawn.map((link) => `${link.from}->${link.to}`).sort()).toEqual(declared);
  });
});

describe("subagents", () => {
  test("hang under their task as smaller satellites, not between tasks (fixture 03)", () => {
    const snapshot = golden("03-subagents-with-task-graph");
    const scene = buildScene(snapshot);
    const shapes = new Map(scene.nodes.map((shape) => [shape.id, shape]));
    const agents = snapshot.nodes.filter((node) => node.kind === "agent");
    expect(agents).toHaveLength(3);
    for (const node of agents) {
      const shape = shapes.get(node.id);
      const parent = shapes.get(node.parent as string);
      expect(shape?.isSatellite).toBe(true);
      expect(shape?.r).toBe(SATELLITE_R);
      expect(shape!.cy).toBeGreaterThan(parent!.cy);
      expect(shape!.cx).toBeGreaterThan(parent!.cx);
      expect(scene.links.some((link) => link.kind === "agent" && link.from === node.parent && link.to === node.id)).toBe(true);
    }
    // Consolidar sits a rank below every task, apart from the satellites.
    const consolidar = shapes.get("task:4")!;
    expect(consolidar.isSatellite).toBe(false);
    for (const node of agents) {
      expect(consolidar.cy).toBeGreaterThan(shapes.get(node.id)!.cy);
    }
  });

  test("an agent whose parent is missing, or who names itself, is a node of its own", () => {
    const scene = buildScene(laidOut([agent("x", "ghost"), agent("y", "y")]));
    expect(scene.nodes.every((shape) => !shape.isSatellite && shape.r === NODE_R)).toBe(true);
  });

  test("agents that name each other as parents are still drawn", () => {
    const snapshot = laidOut([agent("x", "y"), agent("y", "x")]);
    assertSound(snapshot, buildScene(snapshot));
  });

  test("an agent under an agent hangs off the same task", () => {
    const scene = buildScene(laidOut([task("t", { status: "running" }), agent("a1", "t"), agent("a2", "a1")]));
    const satellites = scene.nodes.filter((shape) => shape.isSatellite).map((shape) => shape.id);
    expect(satellites.sort()).toEqual(["a1", "a2"]);
  });
});

describe("drawing", () => {
  test("ranks run top to bottom; a rank's nodes sit side by side", () => {
    const scene = buildScene(laidOut([task("a"), task("b", { blockedBy: ["a"] }), task("c", { blockedBy: ["a"] })]));
    const at = new Map(scene.nodes.map((shape) => [shape.id, shape]));
    expect(at.get("b")!.cy).toBeGreaterThan(at.get("a")!.cy);
    expect(at.get("b")!.cy).toBe(at.get("c")!.cy);
    expect(at.get("c")!.cx).toBeGreaterThan(at.get("b")!.cx);
  });

  test("labels are short; the hover card carries the full title", () => {
    expect(shortLabel("Refactor the whole checkout flow into modules")).toMatch(/^.{21}…$/u);
    expect(shortLabel("Run tests")).toBe("Run tests");
  });

  test("a dependency runs from the bottom of its source to the top of its target", () => {
    const from = circleBox({ cx: 20, cy: 20, r: 8 });
    const to = circleBox({ cx: 60, cy: 80, r: 8 });
    expect(linkPath(from, to, "dependency")).toMatch(/^M 20 28 C .* 60 72$/);
  });

  test("fitScale never enlarges and shrinks to the tighter side", () => {
    expect(fitScale({ width: 100, height: 100 }, { width: 400, height: 400 })).toBe(1);
    expect(fitScale({ width: 400, height: 200 }, { width: 200, height: 200 })).toBe(0.5);
  });

  test("dashed dependencies come from inferred nodes", () => {
    const scene = buildScene(laidOut([task("a"), task("b", { blockedBy: ["a"], inferred: true })]));
    expect(scene.links.find((link) => link.to === "b")?.inferred).toBe(true);
  });

  test("an empty snapshot is an empty scene", () => {
    const scene = buildScene(snapshotOf([]));
    expect(scene.nodes).toEqual([]);
    expect(scene.links).toEqual([]);
  });

  test("a single node makes a small scene: the overlay starts small", () => {
    const scene = buildScene(laidOut([task("a", { title: "Current turn", kind: "turn" })]));
    expect(scene.width).toBeLessThan(140);
    expect(scene.height).toBeLessThan(40);
  });
});
