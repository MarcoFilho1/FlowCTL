// The idle animation ("dream"): once no session has worked or waited for a
// minute, the graph's nodes leave their columns and form a shape that moves,
// chosen by how many nodes there are, until a session works again. Pure:
// every position is a function of the node count and the time.

type Point = { x: number; y: number };

/** No session working or waiting for this long starts the dream. */
export const DREAM_AFTER_MS = 60_000;
/** Each shape holds this long before morphing into the next. */
export const SHAPE_MS = 20_000;
/** Going from the graph to a shape, or from one shape to the next. */
export const MORPH_MS = 1500;
/** The top bar floats over the canvas; the shape sits in the room below it. */
export const BAR_H = 26;
/** One trip of the nodes around their shape. */
const LOOP_MS = 30_000;

export type DreamShape = "bob" | "circle" | "triangle" | "square" | "star" | "heart" | "infinity" | "galaxy";

/** The shapes a graph of `n` nodes cycles through, its signature shape first. */
export function shapesFor(n: number): DreamShape[] {
  if (n <= 1) return ["bob"];
  if (n === 2) return ["circle"];
  if (n === 3) return ["triangle", "circle"];
  if (n === 4) return ["square", "circle"];
  if (n === 5) return ["star", "circle"];
  if (n <= 7) return ["circle", "triangle", "square"];
  if (n <= 19) return ["circle", "heart", "infinity", "star"];
  return ["galaxy", "infinity", "heart", "circle"];
}

/** A closed curve in unit coordinates (within -1..1), walked by arc length. */
interface Curve {
  points: Point[];
  /** Arc length at each point, the last one the whole length. */
  at: number[];
}

function curve(points: Point[]): Curve {
  const closed = [...points, points[0]!];
  const at = [0];
  for (let i = 1; i < closed.length; i += 1) {
    at.push(at[i - 1]! + Math.hypot(closed[i]!.x - closed[i - 1]!.x, closed[i]!.y - closed[i - 1]!.y));
  }
  return { points: closed, at };
}

function sampled(steps: number, f: (t: number) => Point): Point[] {
  return Array.from({ length: steps }, (_, i) => f((2 * Math.PI * i) / steps));
}

/** Vertices around the center, the first one at the top. */
function polygon(corners: number, radius: (i: number) => number = () => 1): Point[] {
  return Array.from({ length: corners }, (_, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / corners;
    return { x: Math.cos(angle) * radius(i), y: Math.sin(angle) * radius(i) };
  });
}

const CURVES: Record<Exclude<DreamShape, "bob" | "galaxy">, Curve> = {
  circle: curve(sampled(96, (t) => ({ x: Math.sin(t), y: -Math.cos(t) }))),
  triangle: curve(polygon(3).map((p) => ({ x: p.x, y: p.y + 0.2 }))),
  square: curve(polygon(4).map((p) => ({ x: p.x * 0.85, y: p.y * 0.85 }))),
  star: curve(polygon(10, (i) => (i % 2 === 0 ? 1 : 0.42))),
  heart: curve(
    sampled(120, (t) => ({
      x: (16 * Math.sin(t) ** 3) / 17,
      y: -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 17 - 0.1
    }))
  ),
  infinity: curve(
    sampled(120, (t) => {
      const d = 1 + Math.sin(t) ** 2;
      return { x: Math.cos(t) / d, y: (1.6 * Math.sin(t) * Math.cos(t)) / d };
    })
  )
};

/**
 * One arm of the galaxy, from near the middle out, walked by arc length so
 * its nodes sit evenly apart. Open: the arm does not loop back.
 */
const GALAXY_ARM: Curve = (() => {
  const points = Array.from({ length: 80 }, (_, i) => {
    const r = 0.2 + (0.8 * i) / 79;
    return { x: Math.cos(r * 3.2) * r, y: Math.sin(r * 3.2) * r };
  });
  const at = [0];
  for (let i = 1; i < points.length; i += 1) {
    at.push(at[i - 1]! + Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y));
  }
  return { points, at };
})();

function along(c: Curve, u: number): Point {
  const length = c.at[c.at.length - 1]!;
  const s = (((u % 1) + 1) % 1) * length;
  let i = 1;
  while (i < c.at.length - 1 && c.at[i]! < s) i += 1;
  const a = c.points[i - 1]!;
  const b = c.points[i]!;
  const span = c.at[i]! - c.at[i - 1]! || 1;
  const k = (s - c.at[i - 1]!) / span;
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
}

/** How long a shape's outline is, per unit of radius: spacing the nodes needs room. */
export function outline(shape: DreamShape): number {
  if (shape === "bob") return 1;
  // Two arms, the nodes shared between them.
  if (shape === "galaxy") return 2 * GALAXY_ARM.at[GALAXY_ARM.at.length - 1]!;
  const c = CURVES[shape];
  return c.at[c.at.length - 1]!;
}

/**
 * Where node `i` of `n` sits in a shape, in unit coordinates, `phase` turns
 * (0..1) into its loop. The nodes keep their graph order around the shape.
 */
export function dreamPoint(shape: DreamShape, i: number, n: number, phase: number): Point {
  if (shape === "bob") {
    const angle = 2 * Math.PI * phase * 4;
    return { x: 0, y: Math.sin(angle) * 0.12 };
  }
  if (shape === "galaxy") {
    // Two arms, the nodes taking turns, evenly apart along each; the whole galaxy turns.
    const perArm = Math.ceil(n / 2);
    const p = along(GALAXY_ARM, (Math.floor(i / 2) + 0.5) / perArm);
    const angle = (i % 2 === 0 ? 0 : Math.PI) + 2 * Math.PI * phase;
    return { x: p.x * Math.cos(angle) - p.y * Math.sin(angle), y: p.x * Math.sin(angle) + p.y * Math.cos(angle) };
  }
  return along(CURVES[shape], i / n + phase);
}

function ease(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

export interface DreamFrame {
  /** The shape now (or being morphed into). */
  shape: DreamShape;
  /** The shape being left, while `mix` < 1. */
  from: DreamShape | "graph";
  /** 0: all `from`, 1: all `shape`. */
  mix: number;
  phase: number;
}

/** What the dream shows `elapsed` ms after it began, for `n` nodes. */
export function dreamFrame(n: number, elapsed: number): DreamFrame {
  const shapes = shapesFor(n);
  const t = Math.max(0, elapsed);
  const index = Math.floor(t / SHAPE_MS);
  const shape = shapes[index % shapes.length]!;
  const since = t - index * SHAPE_MS;
  const from = index === 0 ? "graph" : shapes[(index - 1) % shapes.length]!;
  const mix = from === shape ? 1 : ease(Math.min(1, since / MORPH_MS));
  return { shape, from, mix, phase: t / LOOP_MS };
}

/**
 * Each node's place this frame in unit coordinates. While the dream is still
 * leaving the graph (`from` is "graph"), these are where the nodes are going;
 * the caller blends from the graph by `mix`.
 */
export function dreamPoints(n: number, frame: DreamFrame): Point[] {
  return Array.from({ length: n }, (_, i) => {
    const to = dreamPoint(frame.shape, i, n, frame.phase);
    if (frame.from === "graph" || frame.mix >= 1) return to;
    const was = dreamPoint(frame.from, i, n, frame.phase);
    return { x: was.x + (to.x - was.x) * frame.mix, y: was.y + (to.y - was.y) * frame.mix };
  });
}

/**
 * The dream's scale and radius for a window, and how many nodes it shows: as
 * large as fits, zoomed out only when the nodes would touch along an outline,
 * and past the furthest zoom out, only as many nodes as fit apart (the rest
 * rest out of sight). `nodeR` is the largest node's radius; pixel art zooms in
 * quarter steps.
 */
export function dreamFit(
  n: number,
  nodeR: number,
  viewport: { width: number; height: number },
  pixel: boolean
): { s: number; radius: number; count: number } {
  // The outline sits a node and a margin inside the window.
  const room = Math.max(24, Math.min(viewport.width, viewport.height - BAR_H) / 2 - 12 - nodeR);
  // The tightest of the graph's shapes sets the size, so it holds between shapes.
  const needed = (count: number) => (count * (2 * nodeR + 6)) / Math.min(...shapesFor(count).map(outline));
  const least = pixel ? 0.5 : 0.4;
  // Crowded nodes overlap, each one's rim cutting into the next: fewer, apart, read better.
  let count = Math.max(1, n);
  while (count > 1 && room / needed(count) < least) count -= 1;
  let s = Math.min(1, room / Math.max(needed(count), 1));
  if (pixel) s = Math.max(least, Math.floor(s * 4) / 4);
  else s = Math.max(least, s);
  return { s, radius: room / s, count: Math.min(count, n) };
}

/**
 * The shape's outline, a faint constellation line under the nodes, so a
 * heart reads as a heart even with a handful of nodes. None for the shapes
 * that are not a line (bob, galaxy).
 */
export function dreamOutline(shape: DreamShape): Point[] | null {
  if (shape === "bob" || shape === "galaxy") return null;
  return CURVES[shape].points;
}
