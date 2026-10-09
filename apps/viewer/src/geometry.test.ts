import { describe, expect, test } from "vitest";
import { layout } from "../../../mod/graph/layout.ts";
import type { GraphNode, Snapshot } from "../../../mod/graph/types.ts";
import { buildScene, chooseOrientation, edgePath, fitScale, type Box, type Orientation, type Scene } from "./geometry.ts";
import { GOLDENS, agent, golden, snapshotOf, task } from "./goldens.ts";

const ORIENTATIONS: readonly Orientation[] = ["rows", "columns"];
const PANEL = { width: 360, height: 420 };

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
  expect(scene.cards.map((card) => card.id).sort()).toEqual(snapshot.nodes.map((node) => node.id).sort());
  for (const [i, a] of scene.cards.entries()) {
    expect(inside(a, { x: 0, y: 0, w: scene.width, h: scene.height }), `${a.id} is inside the scene`).toBe(true);
    for (const b of scene.cards.slice(i + 1)) {
      expect(overlaps(a, b), `${a.id} and ${b.id} do not overlap`).toBe(false);
    }
  }
}

describe.each([...GOLDENS.keys()])("golden %s", (name) => {
  test.each(ORIENTATIONS)("draws every node once, without overlaps (%s)", (orientation) => {
    const snapshot = golden(name);
    assertSound(snapshot, buildScene(snapshot, orientation));
  });

  test("draws exactly the declared edges", () => {
    const snapshot = golden(name);
    const declared = snapshot.nodes.flatMap((node) => node.blockedBy.map((from) => `${from}->${node.id}`)).sort();
    expect(buildScene(snapshot, "rows").edges.map((edge) => `${edge.from}->${edge.to}`).sort()).toEqual(declared);
  });
});

describe("subagents", () => {
  test("sit inside their parent's frame, under the parent, not between tasks (fixture 03)", () => {
    const snapshot = golden("03-subagents-with-task-graph");
    for (const orientation of ORIENTATIONS) {
      const scene = buildScene(snapshot, orientation);
      const cards = new Map(scene.cards.map((card) => [card.id, card]));
      const agents = snapshot.nodes.filter((node) => node.kind === "agent");
      expect(agents).toHaveLength(3);
      for (const node of agents) {
        const card = cards.get(node.id);
        const parent = cards.get(node.parent as string);
        const frame = scene.frames.find((f) => f.id === node.parent);
        expect(card?.isChild).toBe(true);
        expect(frame, `${node.parent} has a frame`).toBeDefined();
        expect(inside(card as Box, frame as Box)).toBe(true);
        expect(inside(parent as Box, frame as Box)).toBe(true);
        expect((card as Box).y).toBeGreaterThan((parent as Box).y + (parent as Box).h);
      }
      // Consolidar, which the layout put among the agents, is in no frame.
      const consolidar = cards.get("task:4") as Box;
      expect(scene.frames.some((frame) => inside(consolidar, frame))).toBe(false);
    }
  });

  test("an agent whose parent is missing, or who names itself, is drawn on its own", () => {
    const snapshot = laidOut([agent("agent:a", "ghost"), agent("agent:b", "agent:b")]);
    const scene = buildScene(snapshot, "rows");
    expect(scene.frames).toEqual([]);
    expect(scene.cards.every((card) => !card.isChild)).toBe(true);
  });

  test("agents that name each other as parents are still drawn", () => {
    const snapshot = laidOut([agent("agent:a", "agent:b"), agent("agent:b", "agent:a")]);
    assertSound(snapshot, buildScene(snapshot, "columns"));
  });

  test("an agent under an agent nests one level deeper", () => {
    const snapshot = laidOut([task("t"), agent("agent:a", "t"), agent("agent:b", "agent:a")]);
    const scene = buildScene(snapshot, "rows");
    const cards = new Map(scene.cards.map((card) => [card.id, card]));
    expect(scene.frames.map((frame) => frame.id).sort()).toEqual(["agent:a", "t"]);
    expect((cards.get("agent:b") as Box).x).toBeGreaterThan((cards.get("agent:a") as Box).x);
    assertSound(snapshot, scene);
  });
});

describe("orientation", () => {
  const chain = laidOut(["a", "b", "c", "d", "e", "f"].map((id, i, ids) => task(id, i ? { blockedBy: [ids[i - 1] as string] } : {})));
  const parallel = laidOut(["a", "b", "c", "d", "e"].map((id) => task(id)));

  test("ranks follow each other down the panel in rows, across it in columns", () => {
    const rows = buildScene(chain, "rows");
    const columns = buildScene(chain, "columns");
    const y = (scene: Scene, id: string) => scene.cards.find((card) => card.id === id)?.y ?? NaN;
    const x = (scene: Scene, id: string) => scene.cards.find((card) => card.id === id)?.x ?? NaN;
    expect(y(rows, "b")).toBeGreaterThan(y(rows, "a"));
    expect(x(columns, "b")).toBeGreaterThan(x(columns, "a"));
  });

  test("a long chain reads top to bottom, parallel work stacks in a column", () => {
    expect(chooseOrientation(chain, PANEL)).toBe("rows");
    expect(chooseOrientation(parallel, PANEL)).toBe("columns");
  });

  test("is sticky: a small advantage does not flip it", () => {
    const square = laidOut([task("a"), task("b"), task("c", { blockedBy: ["a"] }), task("d", { blockedBy: ["b"] })]);
    const rows = fitScale(buildScene(square, "rows"), PANEL);
    const columns = fitScale(buildScene(square, "columns"), PANEL);
    expect(rows).not.toBe(columns);
    expect(Math.max(rows, columns) / Math.min(rows, columns)).toBeLessThan(1.2);
    expect(chooseOrientation(square, PANEL, "rows")).toBe("rows");
    expect(chooseOrientation(square, PANEL, "columns")).toBe("columns");
    expect(chooseOrientation(chain, PANEL, "columns")).toBe("rows");
  });
});

describe("edges and fit", () => {
  test("an edge runs from the bottom of its source to the top of its target in rows", () => {
    const from = { x: 0, y: 0, w: 100, h: 40 };
    const to = { x: 0, y: 100, w: 100, h: 40 };
    expect(edgePath(from, to, "rows")).toMatch(/^M 50 40 C .* 50 100$/);
    expect(edgePath(from, to, "columns")).toMatch(/^M 100 20 C .* 0 120$/);
  });

  test("fitScale never enlarges and shrinks to the tighter side", () => {
    expect(fitScale({ width: 100, height: 100 }, PANEL)).toBe(1);
    expect(fitScale({ width: 720, height: 200 }, PANEL)).toBe(0.5);
  });

  test("dashed edges come from inferred nodes", () => {
    const snapshot = laidOut([task("a"), task("b", { blockedBy: ["a"], inferred: true }), task("c", { blockedBy: ["a"] })]);
    const edges = buildScene(snapshot, "rows").edges;
    expect(edges.find((edge) => edge.to === "b")?.inferred).toBe(true);
    expect(edges.find((edge) => edge.to === "c")?.inferred).toBe(false);
  });

  test("an empty snapshot is an empty scene", () => {
    const scene = buildScene(snapshotOf([]), "rows");
    expect(scene.cards).toEqual([]);
    expect(scene.width).toBeGreaterThan(0);
  });
});
