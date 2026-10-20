import { describe, expect, test } from "vitest";
import { dreamFit, dreamFrame, dreamPoint, dreamPoints, MORPH_MS, SHAPE_MS, shapesFor } from "./dream.ts";

describe("idle animation shapes", () => {
  test("the shape follows the size of the graph, its signature first", () => {
    expect(shapesFor(1)).toEqual(["bob"]);
    expect(shapesFor(3)[0]).toBe("triangle");
    expect(shapesFor(4)[0]).toBe("square");
    expect(shapesFor(5)[0]).toBe("star");
    expect(shapesFor(10)).toContain("heart");
    expect(shapesFor(40)[0]).toBe("galaxy");
  });

  test("a polygon's nodes start on its corners", () => {
    const top = dreamPoint("triangle", 0, 3, 0);
    expect(top.x).toBeCloseTo(0);
    const points = [0, 1, 2].map((i) => dreamPoint("triangle", i, 3, 0));
    const sides = points.map((p, i) => Math.hypot(p.x - points[(i + 1) % 3]!.x, p.y - points[(i + 1) % 3]!.y));
    expect(sides[0]).toBeCloseTo(sides[1]!);
    expect(sides[1]).toBeCloseTo(sides[2]!);
  });

  test("every point stays inside the unit square, at any phase", () => {
    for (const n of [1, 2, 3, 4, 5, 7, 12, 30]) {
      for (const shape of shapesFor(n)) {
        for (const phase of [0, 0.13, 0.5, 0.91]) {
          for (let i = 0; i < n; i += 1) {
            const p = dreamPoint(shape, i, n, phase);
            expect(Math.abs(p.x)).toBeLessThanOrEqual(1.01);
            expect(Math.abs(p.y)).toBeLessThanOrEqual(1.01);
          }
        }
      }
    }
  });

  test("the nodes move: the shape loops", () => {
    expect(dreamPoint("circle", 0, 8, 0)).not.toEqual(dreamPoint("circle", 0, 8, 0.1));
  });

  test("leaves the graph, then morphs from shape to shape every few seconds", () => {
    expect(dreamFrame(10, 0)).toMatchObject({ from: "graph", shape: "circle", mix: 0 });
    expect(dreamFrame(10, MORPH_MS).mix).toBe(1);
    const next = dreamFrame(10, SHAPE_MS + MORPH_MS / 2);
    expect(next).toMatchObject({ from: "circle", shape: "heart" });
    expect(next.mix).toBeGreaterThan(0);
    expect(next.mix).toBeLessThan(1);
    // A one-shape graph never morphs.
    expect(dreamFrame(1, SHAPE_MS * 3).mix).toBe(1);
    expect(dreamPoints(10, next)).toHaveLength(10);
  });

  test("fits the window, zooming out only when the nodes would touch", () => {
    const window = { width: 360, height: 200 };
    expect(dreamFit(6, 8, window, true).s).toBe(1);
    const crowded = dreamFit(60, 8, window, true);
    expect(crowded.s).toBeLessThan(1);
    expect(crowded.s * 4).toBe(Math.round(crowded.s * 4));
    expect(crowded.radius * crowded.s).toBeCloseTo(67);
  });
});

describe("a crowded dream", () => {
  test("shows only the nodes that fit apart, and they do not overlap", () => {
    const nodeR = 9;
    const fit = dreamFit(200, nodeR, { width: 330, height: 260 }, true);
    expect(fit.count).toBeLessThan(200);
    expect(fit.count).toBeGreaterThan(10);
    expect(dreamFit(8, nodeR, { width: 330, height: 260 }, true).count).toBe(8);
    for (const shape of shapesFor(fit.count)) {
      for (const phase of [0, 0.13, 0.5, 0.77]) {
        const points = Array.from({ length: fit.count }, (_, i) => dreamPoint(shape, i, fit.count, phase));
        let closest = Infinity;
        for (let a = 0; a < points.length; a += 1) {
          for (let b = a + 1; b < points.length; b += 1) {
            // The infinity crosses itself: two nodes may pass through its middle at once.
            if (shape === "infinity" && Math.hypot(points[a]!.x, points[a]!.y) < 0.15) continue;
            closest = Math.min(closest, Math.hypot(points[a]!.x - points[b]!.x, points[a]!.y - points[b]!.y) * fit.radius * fit.s);
          }
        }
        // The heart folds at its dent: the nodes either side of it may graze, never stack.
        const apart = shape === "heart" ? 1.2 : 2;
        expect(closest, `${shape} at ${phase}`).toBeGreaterThanOrEqual(nodeR * apart * fit.s);
      }
    }
  });
});
