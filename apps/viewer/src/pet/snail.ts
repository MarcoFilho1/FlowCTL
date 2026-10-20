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

/**
 * The snail's sprite for a pose. `step` (0 or 1) is the walk's stretch,
 * `gaze` (0, 1, 2) where its antennas point while it looks around. While it
 * rattles (alert) and while it flies (tucked) the shell is drawn on its own:
 * see `shellSprite`.
 */
export function snailPainter(pose: Pose, step: number, gaze: number): (p: Painter) => void {
  return (P) => {
    if (pose === "sleep" || pose === "tucked" || pose === "shy" || pose === "held") {
      if (pose === "sleep" || pose === "shy") P.rect(3, 14, 9, 1, "b");
      P.disc(7.5, 9.6, 4.4, "a");
      P.pts(SPIRAL_PIXELS.map(([x, y]) => [x, y + 2]), "r");
      return;
    }
    const st = pose === "walk" || pose === "work" ? step : 0;
    P.rect(2, 12, 12 + st, 2, "b");
    P.disc(14.5 + st, 11, 1.8, "b");
    if (pose === "alert" || pose === "done" || (pose === "curious" && gaze === 0)) {
      P.line(14, 9, 13, 3, "b"); P.line(15, 9, 16, 3, "b"); P.px(13, 2, "k"); P.px(16, 2, "k");
    } else if (pose === "curious") {
      P.line(14, 9, 12, 4, "b"); P.line(15, 9, 17, 4, "b"); P.px(12, 3, "k"); P.px(17, 3, "k");
    } else if (gaze === 1) {
      P.line(14 + st, 9, 14 + st, 7, "b"); P.line(15 + st, 9, 17 + st, 8, "b"); P.px(14 + st, 6, "k"); P.px(17 + st, 7, "k");
    } else if (gaze === 2) {
      P.line(14 + st, 9, 12 + st, 8, "b"); P.line(15 + st, 9, 15 + st, 7, "b"); P.px(12 + st, 7, "k"); P.px(15 + st, 6, "k");
    } else {
      P.line(14 + st, 9, 13 + st, 7, "b"); P.line(15 + st, 9, 16 + st, 7, "b"); P.px(13 + st, 6, "k"); P.px(16 + st, 6, "k");
    }
    if (pose !== "alert" && pose !== "done") {
      P.disc(7, 7.5, 4.4, "a");
      P.pts(SPIRAL_PIXELS, "r");
    }
  };
}

/** The shell alone; `turn` shifts its spiral a pixel, so a rattling shell seems to twist. */
export function shellPainter(turn: number): (p: Painter) => void {
  return (P) => {
    P.disc(7, 7.5, 4.4, "a");
    P.pts(SPIRAL_PIXELS.map(([x, y]): [number, number] => [x + turn, y]).filter(([x, y]) => (x - 7) ** 2 + (y - 7.5) ** 2 <= 3.6 ** 2), "r");
  };
}

const sprites = new Map<string, Sprite>();
function cached(key: string, paint: () => (p: Painter) => void): Sprite {
  let sprite = sprites.get(key);
  if (!sprite) {
    sprite = build(paint());
    sprites.set(key, sprite);
  }
  return sprite;
}
export const snailSprite = (pose: Pose, step: number, gaze: number) => cached(`${pose}:${step}:${gaze}`, () => snailPainter(pose, step, gaze));
export const shellSprite = (turn: number) => cached(`shell:${turn}`, () => shellPainter(turn));

/** Draws a sprite with its feet at (x, ground); `show` keeps a cell or leaves it out (a dissolve). */
function drawSprite(c: CanvasRenderingContext2D, sprite: Sprite, x: number, ground: number, mirror: boolean, dx = 0, dy = 0, show?: (x: number, y: number) => boolean) {
  const left = Math.round(x - (MID + OX + 0.5) * ART) + dx;
  const top = Math.round(ground - (GROUND + OY + 1) * ART) + dy;
  for (let y = 0; y < H; y++) for (let gx = 0; gx < W; gx++) {
    const m = sprite[y]![gx];
    if (!m || (show && !show(gx, y))) continue;
    c.fillStyle = colorOf(m);
    c.fillRect(left + (mirror ? W - 1 - gx : gx) * ART, top + y * ART, ART, ART);
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
  /** Which way it faces. */
  dir: 1 | -1;
  /** ms, any steadily increasing clock. */
  t: number;
  /** Walk cycle, radians, and how much of a step there is (0 still, 1 walking). */
  phase: number;
  stride: number;
  /** Distance walked so far, px: the pixel look's step. */
  walked: number;
  blink: boolean;
  /** 0..1: how much of the snail there is (it forms out of the graph's nodes). */
  shown?: number;
  /** Cells come in (true) or go out (false) as `shown` moves; the smooth look scales. */
  growing?: boolean;
}

export function drawSnail(c: CanvasRenderingContext2D, f: SnailFrame): void {
  const shown = f.shown ?? 1;
  if (shown <= 0) return;
  if (f.look === "pixel") drawPixel(c, f, shown);
  else drawSmooth(c, f, shown);
}

function drawPixel(c: CanvasRenderingContext2D, f: SnailFrame, shown: number) {
  const mirror = f.dir < 0;
  const step = (f.pose === "walk" || f.pose === "work") && f.stride > 0.5 ? Math.floor(f.walked / 7) % 2 : 0;
  const gaze = f.pose === "look" ? Math.floor(f.t / 1100) % 3 : f.pose === "curious" ? Math.floor(f.t / 260) % 2 : 0;
  const show = shown >= 1 ? undefined : (x: number, y: number) => hash(x, y) < shown;
  if (f.pose === "tucked") {
    drawSprite(c, shellSprite(Math.floor(f.t / 90) % 3 - 1), f.x, f.ground - 2 * ART, mirror, 0, 0, show);
    return;
  }
  if (f.pose === "held") {
    // Hanging by its shell: a slow swing.
    drawSprite(c, shellSprite(0), f.x, f.ground - 2 * ART, mirror, Math.round(Math.sin(f.t / 220) * 3), 0, show);
    return;
  }
  if (f.pose === "shy") {
    // Hiding in its shell, trembling now and then.
    drawSprite(c, snailSprite("shy", 0, 0), f.x, f.ground, mirror, Math.floor(f.t / 90) % 5 === 0 ? 1 : 0, 0, show);
    return;
  }
  drawSprite(c, snailSprite(f.pose, step, gaze), f.x, f.ground, mirror, 0, 0, show);
  if (f.pose === "done") drawSprite(c, shellSprite(0), f.x, f.ground, mirror, 0, 0, show);
  if (f.pose === "alert") {
    const buzz = vibration(f.t);
    const turn = buzz ? (Math.floor(f.t / 50) % 3) - 1 : 0;
    drawSprite(c, shellSprite(turn), f.x, f.ground, mirror, Math.round(buzz * 2), buzz && Math.floor(f.t / 40) % 2 ? -1 : 0, show);
  }
}

function drawSmooth(c: CanvasRenderingContext2D, f: SnailFrame, shown: number) {
  const scale = f.growing ? backOut(shown) : shown;
  if (scale <= 0.01) return;
  c.save();
  c.translate(f.x, f.ground);
  c.scale(f.dir * ART * scale, ART * scale);
  c.translate(-MID, -GROUND);
  const sw = Math.sin(f.phase) * f.stride;
  if (f.pose === "sleep" || f.pose === "tucked" || f.pose === "shy" || f.pose === "held") {
    if (f.pose === "sleep" || f.pose === "shy") shape(c, SLUG, [3, 13, 11.4, 14.8], () => roundRect(c, 3, 13.3, 8.4, 1.4, 0.7));
    const breath = f.pose === "sleep" ? Math.sin(f.t / 800) * 0.12 : 0;
    // Tucked spins as it flies; held swings from the hand; shy trembles.
    const turn = f.pose === "tucked" ? f.t / 120 : f.pose === "held" ? Math.sin(f.t / 260) * 0.3 : f.pose === "shy" ? Math.sin(f.t / 25) * 0.03 : 0;
    if (turn) {
      c.translate(7.5, 9.9);
      c.rotate(turn);
      c.translate(-7.5, -9.9);
    }
    smoothShell(c, 7.5, 9.9 - breath);
    c.restore();
    return;
  }
  // Needs you (alert) and done both raise the antennas; only alert rattles the shell.
  const alert = f.pose === "alert" || f.pose === "done";
  const wave = alert ? Math.sin(f.t / (f.pose === "done" ? 110 : 160)) : 0;
  const buzz = f.pose === "alert" ? vibration(f.t) : 0;
  const st = f.pose === "walk" || f.pose === "work" ? sw * 0.5 : 0;
  shape(c, SLUG, [2.4, 11.5, 14 + st, 14.4], () => roundRect(c, 2.4, 11.8, 11.6 + st, 2.5, 1.2));
  let tips: [number, number][];
  if (alert) tips = [[12.8 - wave * 0.6, 3.4], [16.4 + wave * 0.6, 3.6]];
  else if (f.pose === "curious") {
    // Antennas up and waving at the mouse, one then the other.
    const w = Math.sin(f.t / 110);
    tips = [[12.8 - w * 0.8, 3.6 + Math.abs(w) * 0.3], [16.4 + w * 0.8, 3.8 + Math.abs(w) * 0.3]];
  }
  else {
    const sway = f.pose === "look" ? Math.sin(f.t / 700) * 0.9 : Math.sin(f.t / 900) * 0.3;
    tips = [[13.2 + st + sway, 6.7 + Math.cos(f.t / 650) * 0.3], [16.2 + st + sway * 0.7, 6.9 - Math.cos(f.t / 650) * 0.3]];
  }
  const stalks = () => { c.moveTo(13.9 + st, 9.7); c.lineTo(...tips[0]!); c.moveTo(15 + st, 9.7); c.lineTo(...tips[1]!); };
  c.lineCap = "round";
  c.beginPath(); stalks(); c.strokeStyle = INK_A; c.lineWidth = 1.35; c.stroke();
  c.beginPath(); stalks(); c.strokeStyle = SLUG; c.lineWidth = 0.45; c.stroke();
  shape(c, SLUG, [12.5 + st, 9, 16.3 + st, 12.8], () => c.arc(14.4 + st, 10.9, 1.9, 0, Math.PI * 2));
  c.fillStyle = INK;
  c.beginPath();
  for (const [x, y] of tips) { c.moveTo(x + 0.62, y); c.arc(x, y, 0.62, 0, Math.PI * 2); }
  c.fill();
  if (!f.blink || alert) {
    c.fillStyle = "#ffffff";
    c.beginPath();
    for (const [x, y] of tips) { c.moveTo(x + 0.4, y - 0.2); c.arc(x + 0.2, y - 0.2, 0.18, 0, Math.PI * 2); }
    c.fill();
  }
  if (buzz) {
    const lift = Math.floor(f.t / 40) % 2 ? -0.2 : 0;
    c.save();
    c.translate(7.2, 12.4); c.rotate(buzz * 0.08); c.translate(-7.2, -12.4);
    smoothShell(c, 7.2 + buzz * 0.15, 7.9 + lift);
    c.restore();
  } else smoothShell(c, 7.2, 7.9);
  c.restore();
}

function backOut(t: number): number {
  const k = 1.70158;
  return 1 + (k + 1) * (t - 1) ** 3 + k * (t - 1) ** 2;
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
