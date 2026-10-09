import { expect, test } from "vitest";
import { discSprite, ringPixels, snap, steppedPath } from "./pixel.ts";

const cells = (path: string) => [...path.matchAll(/M(\d+) (\d+)h1v1h-1z/g)].map(([, x, y]) => `${x},${y}`);

test("a disc sprite is round, solid and symmetric", () => {
  const sprite = discSprite(9);
  const all = [...cells(sprite.outline), ...cells(sprite.body), ...cells(sprite.light), ...cells(sprite.shade)];
  expect(new Set(all).size).toBe(all.length);
  // Corners are empty, the middle is filled.
  expect(all).not.toContain("0,0");
  expect(all).not.toContain("8,8");
  expect(all).toContain("4,4");
  // Mirror symmetric across both axes.
  for (const cell of all) {
    const [x, y] = cell.split(",").map(Number) as [number, number];
    expect(all).toContain(`${8 - x},${y}`);
    expect(all).toContain(`${x},${8 - y}`);
  }
});

test("its rim is outline, light sits upper left and shade lower right", () => {
  const sprite = discSprite(9);
  expect(cells(sprite.outline)).toContain("4,0");
  expect(cells(sprite.light).length).toBeGreaterThan(0);
  expect(cells(sprite.shade).length).toBeGreaterThan(0);
  const mean = (list: string[]) => list.map((c) => c.split(",").map(Number)).reduce((sum, [x, y]) => sum + (x ?? 0) + (y ?? 0), 0) / list.length;
  expect(mean(cells(sprite.light))).toBeLessThan(mean(cells(sprite.shade)));
});

test("small sprites stay round too", () => {
  const sprite = discSprite(5);
  const all = [...cells(sprite.outline), ...cells(sprite.body), ...cells(sprite.light), ...cells(sprite.shade)];
  expect(all).toContain("2,2");
  expect(all).not.toContain("0,0");
});

test("the chaser ring has eight distinct pixels around the sprite", () => {
  const ring = ringPixels(9);
  expect(new Set(ring.map(([x, y]) => `${x},${y}`)).size).toBe(8);
  expect(ring[0]).toEqual([4, -2]);
});

test("stepped edges only turn at right angles, on the pixel grid", () => {
  expect(steppedPath(10, 20, 61, 51)).toBe("M 10 20 H 36 V 52 H 62");
  expect(steppedPath(10, 20, 60, 21)).toBe("M 10 20 H 36 V 22 H 60");
  expect(steppedPath(10, 20, 60, 20)).toBe("M 10 20 H 60");
  expect(snap(7)).toBe(8);
});
