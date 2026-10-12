import { describe, expect, test } from "vitest";
import { layout } from "../../../mod/graph/layout.ts";
import type { GraphNode, Snapshot } from "../../../mod/graph/types.ts";
import { buildScene, cameraFor, centerOn, circleBox, clampPan, currentNodes, focusNode, linkPath, NODE_R, SATELLITE_R, type Box, type Scene } from "./geometry.ts";
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
    expect(inside(circleBox(a), stage), `${a.id} is inside the scene`).toBe(true);
    for (const b of scene.nodes.slice(i + 1)) {
      expect(overlaps(circleBox(a), circleBox(b)), `${a.id} and ${b.id} do not overlap`).toBe(false);
    }
  }
}

describe.each([...GOLDENS.keys()])("golden %s", (name) => {
  test("draws every node once as a circle, without overlaps", () => {
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
    // Consolidar sits a column to the right of every task and its satellites.
    const consolidar = shapes.get("task:4")!;
    expect(consolidar.isSatellite).toBe(false);
    for (const node of agents) {
      expect(consolidar.cx).toBeGreaterThan(shapes.get(node.id)!.cx);
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
  test("ranks run left to right; a rank's nodes stack in a column", () => {
    const scene = buildScene(laidOut([task("a"), task("b", { blockedBy: ["a"] }), task("c", { blockedBy: ["a"] })]));
    const at = new Map(scene.nodes.map((shape) => [shape.id, shape]));
    expect(at.get("b")!.cx).toBeGreaterThan(at.get("a")!.cx);
    expect(at.get("b")!.cx).toBe(at.get("c")!.cx);
    expect(at.get("c")!.cy).toBeGreaterThan(at.get("b")!.cy);
  });

  test("a dependency leaves on the right and enters on the left", () => {
    const from = circleBox({ cx: 20, cy: 20, r: 8 });
    const to = circleBox({ cx: 90, cy: 50, r: 8 });
    expect(linkPath(from, to, "dependency")).toMatch(/^M 28 20 C .* 82 50$/);
  });

  test("a new request starts after a wider gap than the steps within a request", () => {
    const scene = buildScene(
      laidOut([
        task("a", { status: "done" }),
        task("b", { status: "done", blockedBy: ["a"] }),
        task("c", { after: ["b"] }),
        task("d", { blockedBy: ["c"] })
      ])
    );
    const x = new Map(scene.nodes.map((shape) => [shape.id, shape.cx]));
    const within = x.get("b")! - x.get("a")!;
    expect(x.get("c")! - x.get("b")!).toBe(2 * within);
    expect(x.get("d")! - x.get("c")!).toBe(within);
    expect(scene.links.find((link) => link.to === "c")?.kind).toBe("sequence");
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
});

describe("the view onto the scene", () => {
  test("follows the node that needs you first, then errors, then the latest running", () => {
    const scene = buildScene(
      laidOut([task("a", { status: "running" }), task("b", { status: "running" }), task("c", { status: "error" }), task("d", { status: "needs_you" })])
    );
    expect(focusNode(scene)?.id).toBe("d");
    const calm = buildScene(laidOut([task("a", { status: "running" }), task("b", { status: "running" }), task("c")]));
    expect(focusNode(calm)?.id).toBe("b");
  });

  test("centering puts the node in the middle of the window", () => {
    expect(centerOn({ cx: 100, cy: 40 }, { width: 360, height: 220 })).toEqual({ x: 80, y: 70 });
  });

  test("a drag never loses the graph: some of it stays in view", () => {
    const scene = { width: 1000, height: 300 };
    const view = { width: 360, height: 220 };
    expect(clampPan({ x: 5000, y: 5000 }, scene, view)).toEqual({ x: 312, y: 172 });
    expect(clampPan({ x: -5000, y: -5000 }, scene, view)).toEqual({ x: -952, y: -252 });
  });

  test("a graph smaller than the window stays wholly inside it", () => {
    expect(clampPan({ x: -50, y: 500 }, { width: 100, height: 60 }, { width: 360, height: 220 })).toEqual({ x: 0, y: 160 });
  });
});

describe("the camera", () => {
  const view = { width: 360, height: 220 };
  const chain = (n: number, running: number[]) =>
    buildScene(laidOut(Array.from({ length: n }, (_, i) => task(`t${i}`, { blockedBy: i > 0 ? [`t${i - 1}`] : [], status: running.includes(i) ? "running" : i < Math.min(...running, n) ? "done" : "pending" }))));

  test("while working it follows the running node at full size", () => {
    const scene = chain(12, [8]);
    const cam = cameraFor(scene, view, "follow", true);
    const t8 = scene.nodes.find((shape) => shape.id === "t8")!;
    expect(cam.s).toBe(1);
    expect(t8.cx * cam.s + cam.x).toBeCloseTo(180, 0);
  });

  test("a running node is centered even when the whole graph would fit", () => {
    const scene = chain(3, [2]);
    expect(scene.width).toBeLessThan(view.width);
    const cam = cameraFor(scene, view, "follow", true);
    const last = scene.nodes.find((shape) => shape.id === "t2")!;
    expect(last.cx * cam.s + cam.x).toBeCloseTo(view.width / 2, 5);
    expect(last.cy * cam.s + cam.y).toBeCloseTo(view.height / 2, 5);
  });

  test("parallel running steps are framed together, zoomed out until all fit", () => {
    const scene = buildScene(laidOut([task("a", { status: "done" }), task("b", { blockedBy: ["a"], status: "running" }), task("c", { blockedBy: ["a"], status: "running" })]));
    expect(currentNodes(scene).map((shape) => shape.id)).toEqual(["b", "c"]);
    const cam = cameraFor(scene, view, "follow", true);
    const [b, c] = currentNodes(scene);
    for (const shape of [b!, c!]) {
      const x = shape.cx * cam.s + cam.x;
      const y = shape.cy * cam.s + cam.y;
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(view.width);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(view.height);
    }
    // Their midpoint sits in the middle of the window.
    expect(((b!.cy + c!.cy) / 2) * cam.s + cam.y).toBeCloseTo(view.height / 2, 5);
  });

  test("between steps it aims at the step that is free to start", () => {
    // t0..t2 done, nothing running yet.
    const between = buildScene(laidOut(Array.from({ length: 6 }, (_, i) => task(`t${i}`, { blockedBy: i > 0 ? [`t${i - 1}`] : [], status: i < 3 ? "done" : "pending" }))));
    const cam = cameraFor(between, view, "follow", true);
    const next = between.nodes.find((shape) => shape.id === "t3")!;
    expect(next.cx * cam.s + cam.x).toBeCloseTo(view.width / 2, 5);
  });

  test("many parallel steps zoom out, never below half size", () => {
    const nodes = [task("root", { status: "done" }), ...Array.from({ length: 10 }, (_, i) => task(`p${i}`, { blockedBy: ["root"], status: "running" }))];
    const cam = cameraFor(buildScene(laidOut(nodes)), view, "follow", true);
    expect(cam.s).toBeLessThan(1);
    expect(cam.s).toBeGreaterThanOrEqual(0.5);
    expect(cam.s % 0.25).toBe(0);
  });

  test("a node that needs the person takes the camera over running ones", () => {
    const scene = buildScene(laidOut([task("a", { status: "running" }), task("b", { status: "needs_you" })]));
    expect(currentNodes(scene).map((shape) => shape.id)).toEqual(["b"]);
  });

  test("at rest it pulls back to show the whole graph, in quarter steps for pixels", () => {
    const scene = chain(12, []);
    const cam = cameraFor(scene, view, "overview", true);
    expect(cam.s).toBeLessThan(1);
    expect(cam.s % 0.25).toBe(0);
    expect(cam.s).toBeGreaterThanOrEqual(0.5);
    const smooth = cameraFor(scene, view, "overview", false);
    expect(smooth.s).toBeGreaterThanOrEqual(cam.s);
  });

  test("a graph too big to show whole at rest is framed on the latest work, not its middle", () => {
    const nodes = Array.from({ length: 40 }, (_, i) =>
      task(`t${i}`, { blockedBy: i > 0 ? [`t${i - 1}`] : [], status: i < 38 ? "done" : "pending", startedAt: i * 10, finishedAt: i < 38 ? i * 10 + 5 : undefined })
    );
    const scene = buildScene(laidOut(nodes));
    const cam = cameraFor(scene, view, "overview", true);
    expect(cam.s).toBe(0.5);
    const latest = scene.nodes.find((shape) => shape.id === "t37")!;
    const x = latest.cx * cam.s + cam.x;
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(view.width);
    // The graph still fills the view: its right edge is not pulled inside it.
    expect(scene.width * cam.s + cam.x).toBeGreaterThanOrEqual(view.width - 0.001);
  });

  test("a small graph at rest stays at full size, centered", () => {
    const scene = chain(2, []);
    const cam = cameraFor(scene, view, "overview", true);
    expect(cam.s).toBe(1);
    expect(cam.x).toBeCloseTo((view.width - scene.width) / 2, 5);
  });
});
