// The snail, the idle pet: drawn on a 2D canvas in the app's two looks. The
// pixel look is a sprite of square art pixels (shaded and outlined like the
// graph's nodes); the smooth look is the same snail in vector shapes. Every
// function draws in CSS pixels at a point the caller gives: the snail's feet
// (the middle of its body, on the ground line).

import type { Look } from "../store.ts";

/** One art pixel, in CSS px: the size the snail has on screen. */
export const ART = 4;
/** The sprite grid; design coordinates are offset by (OX, OY) so outlines fit. */
const W = 20;
const H = 18;
const OX = 1;
const OY = 2;
/** The design's middle column and ground row: x 9, y 15 sit on the snail's feet. */
const MID = 9;
const GROUND = 15;

/**
 * What the snail is doing, as drawn: walking, looking around, asleep in its
 * shell, rattling its shell (a session needs the person), curled in its shell
 * flying home (tucked), antennas up at the mouse (curious), hiding from a
 * mouse that stays on it (shy), carried by its shell (held), pushing the
 * step under way (work) and celebrating a finished session (done).
 */
export type Pose = "walk" | "look" | "sleep" | "alert" | "tucked" | "curious" | "shy" | "held" | "work" | "done";

const INK = "#0d1117";
const INK_A = "rgba(13,17,23,0.82)";
const SHELL = "#d29922";
const SPIRAL = "#8a5a00";
const SLUG = "#7ee787";
const YELLOW = "#e3b341";
const GREEN = "#3fb950";
const BLUE = "#58a6ff";
const WHITE = "#e6edf3";
const PALETTE: Record<string, string> = { b: SLUG, a: SHELL, r: SPIRAL };

/** Lighter (amt > 0) or darker (amt < 0) by a fraction of the way to white or black. */
export function mix(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const t = amt > 0 ? 255 : 0;
  const a = Math.abs(amt);
  const channel = (v: number) => Math.round(v + (t - v) * a);
  return `rgb(${channel(n >> 16)},${channel((n >> 8) & 255)},${channel(n & 255)})`;
}

/** A stable pseudo-random number in [0, 1) for a pair of integers. */
export function hash(x: number, y: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

// ---------- pixel sprites ----------

/** A sprite: one material per cell ("b" body, "a" shell, "r" spiral, "k" ink, "o" outline), null for none. */
export type Sprite = (string | null)[][];

interface Painter {
  px(x: number, y: number, m: string): void;
  pts(list: [number, number][], m: string): void;
  disc(cx: number, cy: number, r: number, m: string): void;
  rect(x: number, y: number, w: number, h: number, m: string): void;
  line(x0: number, y0: number, x1: number, y1: number, m: string): void;
}

/** Paints a sprite in design coordinates, then shades its body and shell and outlines it all. */
export function build(paint: (p: Painter) => void): Sprite {
  const g: Sprite = Array.from({ length: H }, () => Array<string | null>(W).fill(null));
  const set = (x: number, y: number, m: string) => {
    const gx = Math.round(x) + OX;
    const gy = Math.round(y) + OY;
    if (gx >= 0 && gy >= 0 && gx < W && gy < H) g[gy]![gx] = m;
  };
  const each = (fn: (x: number, y: number) => void) => {
    for (let y = -OY; y < H - OY; y++) for (let x = -OX; x < W - OX; x++) fn(x, y);
  };
  paint({
    px: set,
    pts: (list, m) => list.forEach(([x, y]) => set(x, y, m)),
    disc: (cx, cy, r, m) => each((x, y) => { if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) set(x, y, m); }),
    rect: (x, y, w, h, m) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) set(x + i, y + j, m); },
    line: (x0, y0, x1, y1, m) => {
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
      for (let i = 0; i <= n; i++) set(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, m);
    }
  });
  // Light from the upper left, shade to the lower right, per material.
  for (const m of ["b", "a"]) {
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (g[y]![x] !== m) continue;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    if (x1 < 0) continue;
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const size = Math.max(x1 - x0, y1 - y0) + 1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (g[y]![x] !== m) continue;
      const d = x - cx + (y - cy);
      if (d <= -size * 0.42) g[y]![x] = `${m}+`;
      else if (d >= size * 0.38) g[y]![x] = `${m}-`;
    }
  }
  const out = g.map((row) => row.slice());
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (g[y]![x]) continue;
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => g[y + dy!]?.[x + dx!])) out[y]![x] = "o";
  }
  return out;
}

function colorOf(m: string): string {
  if (m === "o" || m === "k") return INK;
  const base = PALETTE[m[0]!] ?? INK;
  if (m[1] === "+") return mix(base, 0.3);
  if (m[1] === "-") return mix(base, -0.25);
  return base;
}

const SPIRAL_PIXELS: [number, number][] = [[7, 7], [8, 7], [8, 8], [7, 9], [6, 8], [6, 7], [6, 6], [7, 5], [8, 5], [9, 6], [10, 7], [10, 8], [9, 10]];

// ---------- the rig: the snail as parts that move ----------

/**
 * The snail's parts, each a number that eases from one state to the next, so
 * it never jumps between poses: how far out of its shell it is, how high its
 * antennas stand, which way it faces (a turn passes through 0), and so on.
 * Design units: one art pixel; the snail faces right at turn 1.
 */
export interface Rig {
  /** 0 hidden in its shell .. 1 all the way out. */
  out: number;
  /** Whether its foot shows under the shell while it is in (asleep, shy), 0..1; not when carried or flying. */
  foot: number;
  /** 0 relaxed .. 1 raised (curious, alert, happy). */
  stalk: number;
  /** Where the antenna tips point, added to their place. */
  gazeX: number;
  gazeY: number;
  /** The walk's stretch, -0.5..0.5. */
  stretch: number;
  /** Facing: 1 right, -1 left; in between while it turns. */
  turn: number;
  /** The shell's own offsets (a rattle, a breath) and how high it is lifted off the body (eggs). */
  shellX: number;
  shellY: number;
  lid: number;
  /** The shell's tilt and spin, radians (the smooth look; the pixel look shifts its spiral instead). */
  tilt: number;
  spiral: number;
  /** Its little hands, 0..1 (eggs). */
  hands: number;
  /** The whole snail lifted off the ground, px (a hop). */
  lift: number;
}

const REST: Rig = { out: 1, foot: 1, stalk: 0, gazeX: 0, gazeY: 0, stretch: 0, turn: 1, shellX: 0, shellY: 0, lid: 0, tilt: 0, spiral: 0, hands: 0, lift: 0 };

/** The rig a pose asks for at time `t`, facing `dir`; the page eases toward it. */
export function rigFor(pose: Pose, t: number, dir: 1 | -1, step = 0): Rig {
  const rig: Rig = { ...REST, turn: dir };
  switch (pose) {
    case "walk":
    case "work":
      rig.stretch = step * 0.5;
      rig.gazeX = Math.sin(t / 900) * 0.3;
      rig.gazeY = Math.cos(t / 650) * 0.3;
      break;
    case "look":
      rig.gazeX = Math.sin(t / 700) * 0.9;
      rig.gazeY = Math.cos(t / 650) * 0.3;
      break;
    case "sleep":
      rig.out = 0;
      rig.shellY = -Math.sin(t / 800) * 0.12;
      break;
    case "shy":
      rig.out = 0;
      rig.shellX = Math.floor(t / 90) % 5 === 0 ? 0.25 : 0;
      break;
    case "held":
      rig.out = 0;
      rig.foot = 0;
      rig.tilt = Math.sin(t / 260) * 0.3;
      rig.shellX = Math.sin(t / 220) * 0.6;
      break;
    case "tucked":
      rig.out = 0;
      rig.foot = 0;
      rig.tilt = t / 120;
      rig.spiral = (Math.floor(t / 90) % 3) - 1;
      break;
    case "curious":
      rig.stalk = 1;
      rig.gazeX = Math.sin(t / 110) * 0.8;
      rig.gazeY = Math.abs(Math.sin(t / 110)) * 0.3;
      break;
    case "done":
      rig.stalk = 1;
      rig.gazeX = Math.sin(t / 110) * 0.6;
      break;
    case "alert": {
      rig.stalk = 1;
      rig.gazeX = Math.sin(t / 160) * 0.6;
      const buzz = vibration(t);
      rig.shellX = buzz * 0.5;
      rig.shellY = buzz && Math.floor(t / 40) % 2 ? -0.25 : 0;
      rig.tilt = buzz * 0.08;
      rig.spiral = buzz ? (Math.floor(t / 50) % 3) - 1 : 0;
      break;
    }
  }
  return rig;
}

/** How fast each part follows its target (ms to cover about two thirds of the way). */
const FOLLOW: Partial<Record<keyof Rig, number>> = { foot: 120, stalk: 140, gazeX: 120, gazeY: 120, stretch: 60, turn: 110, lid: 140, hands: 120, lift: 50 };

/**
 * One frame of easing from `now` toward `target`, `dt` ms later. Going into
 * the shell is quick (a flinch), coming out slow; the shell's own jitter and
 * spin follow at once.
 */
export function follow(now: Rig, target: Rig, dt: number): Rig {
  const next = { ...target };
  for (const key of Object.keys(FOLLOW) as (keyof Rig)[]) {
    const tau = FOLLOW[key]!;
    next[key] = now[key] + (target[key] - now[key]) * (1 - Math.exp(-dt / tau));
  }
  const tau = target.out < now.out ? 70 : 260;
  next.out = now.out + (target.out - now.out) * (1 - Math.exp(-dt / tau));
  return next;
}

/** Where the head is, in design units, for a rig. */
export function headAt(rig: Rig): { x: number; y: number; r: number } {
  const k = Math.max(0, Math.min(1, (rig.out - 0.3) / 0.7));
  return { x: 10.5 + 3.9 * k + rig.stretch, y: 10.9 + (1 - k) * 1.2, r: 1 + 0.9 * k };
}

/** The antenna bases and tips, in design units. */
function stalksAt(rig: Rig): { grow: number; bases: [number, number][]; tips: [number, number][] } {
  const head = headAt(rig);
  const grow = Math.max(0, Math.min(1, (rig.out - 0.55) / 0.45));
  const bases: [number, number][] = [[head.x - 0.5, head.y - 1.2], [head.x + 0.6, head.y - 1.2]];
  const relaxed: [number, number][] = [[head.x - 1.2, 6.7], [head.x + 1.8, 6.9]];
  const raised: [number, number][] = [[head.x - 1.6, 3.4], [head.x + 2, 3.6]];
  const tips = bases.map(([bx, by], i): [number, number] => {
    const tx = relaxed[i]![0] + (raised[i]![0] - relaxed[i]![0]) * rig.stalk + rig.gazeX * (i ? 0.7 : 1);
    const ty = relaxed[i]![1] + (raised[i]![1] - relaxed[i]![1]) * rig.stalk + rig.gazeY * (i ? -1 : 1);
    return [bx + (tx - bx) * grow, by + (ty - by) * grow];
  });
  return { grow, bases, tips };
}

/** Where the shell sits, in design units: lower when the snail is in it. */
export function shellAt(rig: Rig): { x: number; y: number } {
  return { x: 7 + 0.5 * (1 - rig.out) + rig.shellX, y: 7.5 + 2.1 * (1 - rig.out) + rig.shellY - rig.lid };
}

// ---------- pixel sprites from the rig ----------

/** The rig rounded to what art pixels can show, so its sprites are few and cached. */
function quantize(rig: Rig): Rig {
  return {
    ...rig,
    out: Math.round(rig.out * 10) / 10,
    foot: Math.round(rig.foot),
    stalk: Math.round(rig.stalk * 4) / 4,
    gazeX: Math.round(rig.gazeX),
    gazeY: Math.round(rig.gazeY),
    stretch: rig.stretch > 0.15 ? 1 : 0,
    shellX: Math.round(rig.shellX),
    shellY: Math.round(rig.shellY),
    lid: Math.round(rig.lid),
    spiral: Math.round(rig.spiral),
    hands: Math.round(rig.hands),
    tilt: 0,
    turn: 1,
    lift: 0
  };
}

export function rigPainter(rig: Rig): (p: Painter) => void {
  return (P) => {
    const q = rig;
    // The foot: a strip under the shell while it is in, the body once it is out.
    if (q.out < 0.45) {
      if (q.foot > 0.5) P.rect(3, 14, 9, 1, "b");
    } else {
      const k = (q.out - 0.45) / 0.55;
      P.rect(Math.round(3 - k), 12, Math.round(9 + 3 * k) + q.stretch, 2, "b");
    }
    const head = headAt(q);
    if (q.out > 0.3) P.disc(head.x, head.y, head.r, "b");
    const shell = shellAt(q);
    P.disc(shell.x, shell.y, 4.4, "a");
    const sx = Math.round(shell.x - 7);
    const sy = Math.round(shell.y - 7.5);
    P.pts(
      SPIRAL_PIXELS.map(([x, y]): [number, number] => [x + q.spiral + sx, y + sy]).filter(([x, y]) => (x - shell.x) ** 2 + (y - shell.y) ** 2 <= 3.6 ** 2),
      "r"
    );
    const stalks = stalksAt(q);
    if (stalks.grow > 0) {
      stalks.bases.forEach(([bx, by], i) => {
        const [tx, ty] = stalks.tips[i]!;
        P.line(Math.round(bx), Math.round(by), Math.round(tx), Math.round(ty), "b");
        if (stalks.grow > 0.6) P.px(Math.round(tx), Math.round(ty) - 1, "k");
      });
    }
    if (q.hands) {
      P.disc(head.x + 2.8, 11, 1.1, "b");
      P.disc(head.x - 3.6, 11.4, 1.1, "b");
    }
  };
}

const sprites = new Map<string, Sprite>();
function cached(key: string, paint: () => (p: Painter) => void): Sprite {
  let sprite = sprites.get(key);
  if (!sprite) {
    if (sprites.size > 600) sprites.clear();
    sprite = build(paint());
    sprites.set(key, sprite);
  }
  return sprite;
}

export function rigSprite(rig: Rig): Sprite {
  const q = quantize(rig);
  const key = `rig:${q.out}:${q.foot}:${q.stalk}:${q.gazeX}:${q.gazeY}:${q.stretch}:${q.shellX}:${q.shellY}:${q.lid}:${q.spiral}:${q.hands}`;
  return cached(key, () => rigPainter(q));
}

/** The sprite for a pose at rest (tests, and callers without a rig). */
export const snailSprite = (pose: Pose, step = 0, _gaze = 0) => rigSprite(rigFor(pose, 500, 1, step));
/** The shell alone, its spiral shifted by `turn`. */
export const shellSprite = (turn: number) => rigSprite({ ...REST, out: 0, foot: 0, spiral: turn, shellY: -2.1, shellX: -0.5 });

/**
 * Draws a sprite with its feet at (x, ground), squeezed by `turn` (1 right,
 * -1 left, narrower as it turns); `show` keeps a cell or leaves it out.
 */
function drawSprite(c: CanvasRenderingContext2D, sprite: Sprite, x: number, ground: number, turn: number, show?: (x: number, y: number) => boolean) {
  const top = Math.round(ground - (GROUND + OY + 1) * ART);
  const width = Math.max(1, Math.abs(turn) * ART);
  for (let y = 0; y < H; y++) for (let gx = 0; gx < W; gx++) {
    const m = sprite[y]![gx];
    if (!m || (show && !show(gx, y))) continue;
    c.fillStyle = colorOf(m);
    const center = x + (gx - (MID + OX)) * ART * turn;
    const left = Math.round(center - width / 2);
    c.fillRect(left, top + y * ART, Math.max(1, Math.round(center + width / 2) - left), ART);
  }
}

// ---------- smooth shapes (design units: one art pixel) ----------

function gradient(c: CanvasRenderingContext2D, color: string, x0: number, y0: number, x1: number, y1: number) {
  const g = c.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, mix(color, 0.38));
  g.addColorStop(0.45, color);
  g.addColorStop(1, mix(color, -0.3));
  return g;
}

function shape(c: CanvasRenderingContext2D, color: string, box: [number, number, number, number], path: () => void) {
  c.beginPath();
  path();
  c.fillStyle = gradient(c, color, ...box);
  c.fill();
  c.lineWidth = 0.5;
  c.strokeStyle = INK_A;
  c.lineJoin = "round";
  c.stroke();
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  if (typeof c.roundRect === "function") c.roundRect(x, y, w, h, r);
  else c.rect(x, y, w, h);
}

function smoothShell(c: CanvasRenderingContext2D, x: number, y: number) {
  shape(c, SHELL, [x - 4.5, y - 4.5, x + 4.5, y + 4.5], () => c.arc(x, y, 4.5, 0, Math.PI * 2));
  c.beginPath();
  for (let a = 0; a < Math.PI * 4.2; a += 0.15) {
    const r = 0.35 + a * 0.27;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (a === 0) c.moveTo(px, py);
    else c.lineTo(px, py);
  }
  c.strokeStyle = SPIRAL;
  c.lineWidth = 0.45;
  c.stroke();
}

/** The shell's buzz while the snail needs the person: -1..1, fast, in bursts of 420 ms every 900 ms. */
export function vibration(t: number): number {
  return t % 900 < 420 ? Math.sin(t / 16) : 0;
}

/** Everything the snail's look depends on this frame. */
export interface SnailFrame {
  look: Look;
  pose: Pose;
  /** CSS px: the middle of the body, on the ground line. */
  x: number;
  ground: number;
  /** Which way it faces, for what is drawn around it. */
  dir: 1 | -1;
  /** ms, any steadily increasing clock. */
  t: number;
  /** Walk cycle, radians, and how much of a step there is (0 still, 1 walking). */
  phase: number;
  stride: number;
  /** Distance walked so far, px. */
  walked: number;
  blink: boolean;
  /** Its parts as they are now (the page eases them); from `pose` when absent. */
  rig?: Rig;
  /** 0..1: how much of the snail there is (it forms out of the graph's nodes). */
  shown?: number;
  /** Cells come in (true) or go out (false) as `shown` moves; the smooth look scales. */
  growing?: boolean;
}

export function drawSnail(c: CanvasRenderingContext2D, f: SnailFrame): void {
  const shown = f.shown ?? 1;
  if (shown <= 0) return;
  const rig = f.rig ?? rigFor(f.pose, f.t, f.dir, Math.sin(f.phase) * f.stride);
  if (f.look === "pixel") {
    drawSprite(c, rigSprite(rig), f.x, f.ground - rig.lift, rig.turn, shown >= 1 ? undefined : (x, y) => hash(x, y) < shown);
  } else {
    drawSmooth(c, f, rig, f.growing ? backOut(shown) : shown);
  }
}

function drawSmooth(c: CanvasRenderingContext2D, f: SnailFrame, rig: Rig, scale: number) {
  if (scale <= 0.01) return;
  c.save();
  c.translate(f.x, f.ground - rig.lift);
  c.scale(rig.turn * ART * scale, ART * scale);
  c.translate(-MID, -GROUND);
  const o = rig.out;
  // The body: a strip under the shell while it is in, longer and taller as it comes out.
  if (o > 0.05 || rig.foot > 0.05) {
    c.globalAlpha = o > 0.05 ? 1 : rig.foot;
    const y = 13.3 - 1.5 * o;
    const h = 1.4 + 1.1 * o;
    shape(c, SLUG, [2.4, y, 14, y + h], () => roundRect(c, 3 - 0.6 * o, y, 8.4 + 3.2 * o + rig.stretch, h, h / 2));
    c.globalAlpha = 1;
  }
  const head = headAt(rig);
  if (o > 0.3) shape(c, SLUG, [head.x - head.r, head.y - head.r, head.x + head.r, head.y + head.r], () => c.arc(head.x, head.y, head.r, 0, Math.PI * 2));
  const shell = shellAt(rig);
  c.save();
  c.translate(shell.x, shell.y + 4.5);
  c.rotate(rig.tilt);
  c.translate(-shell.x, -shell.y - 4.5);
  smoothShell(c, shell.x, shell.y);
  c.restore();
  const stalks = stalksAt(rig);
  if (stalks.grow > 0) {
    const path = () => stalks.bases.forEach(([bx, by], i) => { c.moveTo(bx, by); c.lineTo(...stalks.tips[i]!); });
    c.lineCap = "round";
    c.beginPath(); path(); c.strokeStyle = INK_A; c.lineWidth = 1.35; c.stroke();
    c.beginPath(); path(); c.strokeStyle = SLUG; c.lineWidth = 0.45; c.stroke();
    const eye = 0.62 * stalks.grow;
    c.fillStyle = INK;
    c.beginPath();
    for (const [x, y] of stalks.tips) { c.moveTo(x + eye, y); c.arc(x, y, eye, 0, Math.PI * 2); }
    c.fill();
    if (!f.blink && stalks.grow > 0.6) {
      c.fillStyle = "#ffffff";
      c.beginPath();
      for (const [x, y] of stalks.tips) { c.moveTo(x + 0.4, y - 0.2); c.arc(x + 0.2, y - 0.2, 0.18, 0, Math.PI * 2); }
      c.fill();
    }
  }
  if (rig.hands > 0.02) {
    const r = 0.85 * rig.hands;
    for (const [hx, hy] of [[head.x + 2.8, 11], [head.x - 3.6, 11.4]] as const) shape(c, SLUG, [hx - r, hy - r, hx + r, hy + r], () => c.arc(hx, hy, r, 0, Math.PI * 2));
  }
  c.restore();
}

function backOut(t: number): number {
  const k = 1.70158;
  return 1 + (k + 1) * (t - 1) ** 3 + k * (t - 1) ** 2;
}

/** Design units to CSS px, for what is drawn with the snail (eggs). */
export function toScreen(f: Pick<SnailFrame, "x" | "ground">, rig: Rig, p: { x: number; y: number }): { x: number; y: number } {
  return { x: f.x + (p.x - MID) * ART * rig.turn, y: f.ground - rig.lift + (p.y - GROUND) * ART };
}

// ---------- what goes around the snail ----------

/** The slime trail on the ground: points where it passed, fading over `TRAIL_MS`. */
export const TRAIL_MS = 9000;

export function drawTrail(c: CanvasRenderingContext2D, look: Look, ground: number, trail: readonly { x: number; t: number }[], now: number): void {
  for (const p of trail) {
    const a = (1 - (now - p.t) / TRAIL_MS) * 0.55;
    if (a <= 0) continue;
    c.fillStyle = `rgba(126,231,135,${a.toFixed(3)})`;
    if (look === "pixel") {
      if (Math.round(p.x) % ART === 0) c.fillRect(Math.round(p.x), ground + 1, ART, 2);
    } else c.fillRect(p.x - 1, ground + 1, 2.2, 1.6);
  }
}

/** Zzz rising from the shell while it sleeps. */
export function drawZzz(c: CanvasRenderingContext2D, look: Look, f: Pick<SnailFrame, "x" | "ground" | "dir" | "t">, color: string): void {
  const x = f.x + f.dir * 2 * ART;
  const y = f.ground - 10 * ART;
  for (let i = 0; i < 3; i++) {
    const p = (f.t / 2600 + i / 3) % 1;
    const zx = x + f.dir * (6 + p * 16);
    const zy = y - 6 - p * 26;
    c.globalAlpha = Math.sin(p * Math.PI);
    c.fillStyle = color;
    if (look === "pixel") {
      const u = 2 + Math.round(p);
      for (const [a, b] of [[0, 0], [1, 0], [2, 0], [1, 1], [0, 2], [1, 2], [2, 2]] as const) c.fillRect(Math.round(zx) + a * u, Math.round(zy) + b * u, u, u);
    } else {
      c.font = `600 ${9 + p * 6}px system-ui, -apple-system, sans-serif`;
      c.fillText("z", zx, zy);
    }
  }
  c.globalAlpha = 1;
}

/** The "!" over its head while a session waits for the person. */
export function drawBang(c: CanvasRenderingContext2D, look: Look, f: Pick<SnailFrame, "x" | "ground" | "dir" | "t">): void {
  const x = f.x + f.dir * 7.5 * ART;
  const bob = Math.round(Math.sin(f.t / 160) * 2);
  if (look === "pixel") {
    const cells = [[0, 0], [0, 1], [0, 2], [0, 4]] as const;
    const left = Math.round(x - ART / 2);
    const top = Math.round(f.ground - 22 * ART + bob);
    c.fillStyle = INK;
    for (const [a, b] of cells) c.fillRect(left + (a - 1) * ART, top + (b - 1) * ART, 3 * ART, 3 * ART);
    c.fillStyle = YELLOW;
    for (const [a, b] of cells) c.fillRect(left + a * ART, top + b * ART, ART, ART);
  } else {
    const top = f.ground - 19 * ART + bob;
    c.beginPath();
    roundRect(c, x - 8, top - 10, 16, 20, 7);
    c.fillStyle = YELLOW; c.fill();
    c.lineWidth = 1.5; c.strokeStyle = INK_A; c.stroke();
    c.fillStyle = INK;
    c.font = "700 14px system-ui, -apple-system, sans-serif";
    c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText("!", x, top + 1);
    c.textAlign = "start"; c.textBaseline = "alphabetic";
  }
}

/**
 * A rattling shell: shake marks flickering around it, chips that jump off its
 * top and puffs of dust at its base, once per burst of `vibration`.
 */
export function drawRattle(c: CanvasRenderingContext2D, look: Look, f: Pick<SnailFrame, "x" | "ground" | "dir" | "t">, dust: string): void {
  const pixel = look === "pixel";
  const side = f.dir;
  const cx = pixel ? f.x - side * 2 * ART : f.x - side * 1.8 * ART;
  const cy = pixel ? f.ground - 8 * ART : f.ground - 7.1 * ART;
  const bt = f.t % 900;
  const burst = Math.floor(f.t / 900);
  const R = 4.5 * ART;
  if (bt < 420) {
    const far = Math.floor(f.t / 70) % 2;
    c.strokeStyle = c.fillStyle = "rgba(13,17,23,0.6)";
    for (const a of [Math.PI, Math.PI * 1.2, Math.PI * 1.42]) {
      for (const k of [0, 1]) {
        const rr = R + (k ? 2.6 : 1.3) * ART + far * ART * 0.6;
        const x = cx - side * Math.cos(Math.PI - a) * rr;
        const y = cy + Math.sin(a) * rr;
        if (pixel) {
          const tx = -Math.sin(a) * side;
          const ty = Math.cos(a);
          for (const t of [-0.5, 0.5]) c.fillRect(Math.round((x + tx * t * ART - ART / 2) / 2) * 2, Math.round((y + ty * t * ART - ART / 2) / 2) * 2, ART, ART);
        } else {
          const a0 = side > 0 ? a : Math.PI - a;
          c.lineWidth = 1.4; c.lineCap = "round";
          c.beginPath(); c.arc(cx, cy, rr, a0 - 0.1, a0 + 0.1); c.stroke();
        }
      }
    }
  }
  const life = bt / 650;
  if (life >= 1) return;
  for (let i = 0; i < 4; i++) {
    const vx = (-0.5 - hash(burst, i)) * side * 28 + (i % 2 ? 18 * side : 0);
    const vy = -55 - hash(i, burst) * 35;
    const t = bt / 1000;
    const x = cx + vx * t;
    const y = cy - R * 0.8 + vy * t + 0.5 * 260 * t * t;
    c.globalAlpha = 1 - life;
    c.fillStyle = i % 2 ? mix(SHELL, 0.35) : SHELL;
    if (pixel) c.fillRect(Math.round(x / ART) * ART, Math.round(y / ART) * ART, ART, ART);
    else {
      c.beginPath(); c.arc(x, y, 1.6, 0, Math.PI * 2); c.fill();
      c.lineWidth = 0.8; c.strokeStyle = INK_A; c.stroke();
    }
  }
  const spread = Math.min(1, bt / 420);
  if (spread < 1) {
    c.globalAlpha = (1 - spread) * 0.55;
    c.fillStyle = dust;
    for (const d of [-1, 1]) {
      const x = cx + d * (R * 0.7 + spread * 14);
      if (pixel) {
        const size = ART * (spread < 0.5 ? 1 : 2);
        c.fillRect(Math.round((x - size / 2) / ART) * ART, f.ground - size - 1, size, size);
      } else {
        c.beginPath(); c.ellipse(x, f.ground - 3, 2.5 + spread * 4, 1.4 + spread * 1.5, 0, 0, Math.PI * 2); c.fill();
      }
    }
  }
  c.globalAlpha = 1;
}

// ---------- working and done ----------

/** The step under way, as a ball the snail pushes: how much of it there is, and how far its burst got. */
export interface Ball {
  /** 0..1 as a new ball pops up. */
  shown: number;
  /** 0 until its step is done, then 0..1 as it turns green and bursts. */
  burst: number;
}

/** The ball sits in front of the snail's head, on the ground. */
export function drawBall(c: CanvasRenderingContext2D, look: Look, f: Pick<SnailFrame, "x" | "ground" | "dir" | "walked">, ball: Ball): void {
  const x = f.x + f.dir * 9.6 * ART;
  const y = f.ground - 6.4;
  const color = ball.burst > 0 ? GREEN : BLUE;
  const roll = f.walked / 6.4;
  if (ball.burst < 0.55 && ball.shown > 0) {
    const size = ball.shown * (1 + ball.burst * 0.6);
    if (look === "pixel") {
      const sprite = cached(`ball:${size < 0.5 ? 1 : 1.6}`, () => (P) => P.disc(9, 7, size < 0.5 ? 1 : 1.6, "b"));
      const left = Math.round(x - (9 + OX + 0.5) * ART);
      const top = Math.round(y - (7 + OY + 0.5) * ART);
      for (let gy = 0; gy < H; gy++) for (let gx = 0; gx < W; gx++) {
        const m = sprite[gy]![gx];
        if (!m) continue;
        c.fillStyle = m === "o" ? INK : m[1] === "+" ? mix(color, 0.3) : m[1] === "-" ? mix(color, -0.25) : color;
        c.fillRect(left + gx * ART, top + gy * ART, ART, ART);
      }
      // A light spot that turns as it rolls.
      c.fillStyle = "rgba(255,255,255,0.85)";
      c.fillRect(Math.round(x - ART / 2) + Math.round(Math.cos(roll)) * ART, Math.round(y - ART / 2) + Math.round(Math.sin(roll)) * ART, ART, ART);
    } else {
      const r = 6.5 * size;
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fillStyle = gradient(c, color, x - r, y - r, x + r, y + r);
      c.fill();
      c.lineWidth = 1.3; c.strokeStyle = INK_A; c.stroke();
      c.beginPath();
      c.arc(x + Math.cos(roll) * r * 0.45, y + Math.sin(roll) * r * 0.45, r * 0.22, 0, Math.PI * 2);
      c.fillStyle = "rgba(255,255,255,0.8)"; c.fill();
    }
  }
  if (ball.burst > 0) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.3;
      const d = 6 + ball.burst * 18;
      c.globalAlpha = 1 - ball.burst;
      c.fillStyle = i % 2 ? GREEN : "#ffffff";
      const px = x + Math.cos(a) * d;
      const py = y - 4 + Math.sin(a) * d * 0.8;
      if (look === "pixel") c.fillRect(Math.round(px / 2) * 2, Math.round(py / 2) * 2, ART - 1, ART - 1);
      else { c.beginPath(); c.arc(px, py, 1.6, 0, Math.PI * 2); c.fill(); }
    }
    c.globalAlpha = 1;
  }
}

/** How long the celebration lasts. */
export const CELEBRATION_MS = 2600;

/** Two happy hops in the celebration's first 700 ms, 0..1 of their height. */
export function celebrationHop(k: number): number {
  return k >= 0 && k < 700 ? Math.abs(Math.sin((k / 350) * Math.PI)) : 0;
}

/** Done: confetti from the shell and a green check over its head, `k` ms into the celebration. */
export function drawDone(c: CanvasRenderingContext2D, look: Look, f: Pick<SnailFrame, "x" | "ground" | "dir">, k: number): void {
  const pixel = look === "pixel";
  const cx = f.x - f.dir * 2 * ART;
  const cy = f.ground - 9 * ART;
  const colors = [GREEN, BLUE, WHITE, YELLOW, "#e8804a"];
  if (k < 1600) {
    for (let i = 0; i < 16; i++) {
      const t = Math.max(0, k - (i % 4) * 60) / 1000;
      const a = -Math.PI / 2 + (hash(i, 7) - 0.5) * 2.2;
      const v = 90 + hash(7, i) * 70;
      const x = cx + Math.cos(a) * v * t;
      const y = cy + Math.sin(a) * v * t + 0.5 * 320 * t * t;
      c.globalAlpha = Math.max(0, Math.min(1, 1 - t / 1.5));
      c.fillStyle = colors[i % colors.length]!;
      if (pixel) c.fillRect(Math.round(x / 2) * 2, Math.round(y / 2) * 2, ART, ART);
      else { c.save(); c.translate(x, y); c.rotate(t * 8 + i); c.fillRect(-2, -1.2, 4, 2.4); c.restore(); }
    }
    c.globalAlpha = 1;
  }
  if (k <= 250) return;
  // Above and ahead of the raised antennas, clear of them.
  const x = f.x + f.dir * 9 * ART;
  const bob = Math.round(Math.sin(k / 160) * 2);
  if (pixel) {
    const cells = [[0, 2], [1, 3], [2, 2], [3, 1], [4, 0]] as const;
    const left = Math.round(x - 2 * ART);
    const top = Math.round(f.ground - 25 * ART + bob);
    c.fillStyle = INK;
    for (const [a, b] of cells) c.fillRect(left + (a - 1) * ART, top + (b - 1) * ART, 3 * ART, 3 * ART);
    c.fillStyle = GREEN;
    for (const [a, b] of cells) c.fillRect(left + a * ART, top + b * ART, ART, ART);
  } else {
    const top = f.ground - 21 * ART + bob;
    c.beginPath();
    roundRect(c, x - 9, top - 10, 18, 20, 7);
    c.fillStyle = GREEN; c.fill();
    c.lineWidth = 1.5; c.strokeStyle = INK_A; c.stroke();
    c.beginPath();
    c.moveTo(x - 4.5, top + 0.5); c.lineTo(x - 1, top + 4); c.lineTo(x + 5, top - 3.5);
    c.lineWidth = 2.4; c.lineCap = "round"; c.lineJoin = "round"; c.strokeStyle = "#ffffff"; c.stroke();
  }
}
