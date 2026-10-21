// The snail's little scenes, now and then while it rests. It grows hands,
// tosses its shell off its back to the ground in front of it, pokes its head
// in and rummages, pulls something out, puts the shell back on and uses
// what it found: a flag that says KEEP FOCUSED, a cup of coffee, a book. At
// the end it tosses the thing back into its shell. One timeline drives the
// rig (hands, shell off, head reaching in), the loose shell and the item.

import type { Look } from "../store.ts";
import { ART, drawLooseShell, headAt, mix, toScreen, type Rig, type SnailFrame } from "./snail.ts";

export type Egg = "flag" | "coffee" | "book";
export const EGGS: readonly Egg[] = ["flag", "coffee", "book"];

/** The scene's beats, ms from its start. */
const TOSS: [number, number] = [350, 950];
const SETTLE: [number, number] = [950, 1100];
const SEARCH: [number, number] = [1100, 2600];
const PULL: [number, number] = [2600, 3200];
const BACK: [number, number] = [3200, 3800];
const USE: [number, number] = [3800, 6800];
const STOW: [number, number] = [6800, 7500];
/** How long a scene lasts, ms. */
export const EGG_MS = 8000;

/** Where the shell sits on its back, and where it lands in front of its head (design units). */
const ON_BACK = { x: 7, y: 7.5 };
const IN_FRONT = { x: 20.6, y: 10.9 };

const INK = "#0d1117";
const INK_A = "rgba(13,17,23,0.82)";
const FLAG = "#e3b341";

const clamp = (v: number) => Math.max(0, Math.min(1, v));
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const backOut = (t: number) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;
const within = (k: number, [a, b]: [number, number]) => clamp((k - a) / (b - a));
const during = (k: number, [a, b]: [number, number]) => k >= a && k < b;
const bump = (k: number, at: number) => (k >= at && k < at + 160 ? Math.sin(((k - at) / 160) * Math.PI) : 0);

/** How far its head reaches forward: into the shell while it rummages, a yank back as it pulls. */
function reach(k: number): number {
  if (during(k, SEARCH)) {
    const inside = ease(within(k, [SEARCH[0], SEARCH[0] + 300]));
    return inside * (2.4 + Math.sin((k - SEARCH[0]) / 110) * 0.6);
  }
  if (during(k, PULL)) {
    const q = within(k, PULL);
    return q < 0.6 ? 2.4 - 3 * ease(q / 0.6) : -0.6 + 0.6 * ease((q - 0.6) / 0.4);
  }
  return 0;
}

/** What the rig does `k` ms into a scene. */
export function eggRig(rig: Rig, k: number): Rig {
  const searching = during(k, SEARCH);
  return {
    ...rig,
    out: 1,
    foot: 1,
    hands: k < STOW[1] + 100 ? 1 : 0,
    shellOff: k >= TOSS[0] && k < BACK[1] ? 1 : 0,
    reach: reach(k),
    // The shell lands back on with a little bounce, and again as the thing drops in.
    shellY: -0.8 * (bump(k, BACK[1]) + bump(k, STOW[1])),
    lid: 0,
    stalk: searching ? 0.6 : 0.3,
    gazeX: searching ? Math.sin(k / 80) * 0.8 : during(k, USE) ? 0.8 : rig.gazeX,
    gazeY: searching || during(k, USE) ? 1 : rig.gazeY
  };
}

/** The loose shell while it is off its back: where (design units) and how turned. */
function looseShell(k: number): { at: { x: number; y: number }; angle: number } | null {
  if (!(k >= TOSS[0] && k < BACK[1])) return null;
  const lerp = (a: { x: number; y: number }, b: { x: number; y: number }, p: number, arc: number) => ({
    x: a.x + (b.x - a.x) * p,
    y: a.y + (b.y - a.y) * p - Math.sin(p * Math.PI) * arc
  });
  if (during(k, TOSS)) {
    const p = ease(within(k, TOSS));
    return { at: lerp(ON_BACK, IN_FRONT, p, 7), angle: (p * Math.PI) / 2 };
  }
  if (during(k, BACK)) {
    const p = ease(within(k, BACK));
    return { at: lerp(IN_FRONT, ON_BACK, p, 8), angle: ((1 - p) * Math.PI) / 2 };
  }
  // On the ground in front of it: a hop as it lands, a jiggle while the head rummages, a rock as the thing comes out.
  const settle = during(k, SETTLE) ? Math.sin(within(k, SETTLE) * Math.PI) * 0.8 : 0;
  const jiggle = during(k, SEARCH) ? within(k, [SEARCH[0], SEARCH[0] + 300]) : 0;
  const rock = during(k, PULL) ? Math.sin(within(k, PULL) * Math.PI) * 0.15 : 0;
  return {
    at: { x: IN_FRONT.x + Math.sin(k / 45) * 0.35 * jiggle, y: IN_FRONT.y - settle - Math.abs(Math.sin(k / 90)) * 0.3 * jiggle },
    angle: Math.PI / 2 + Math.sin(k / 70) * 0.08 * jiggle - rock
  };
}

export function drawEgg(c: CanvasRenderingContext2D, look: Look, f: Pick<SnailFrame, "x" | "ground">, rig: Rig, egg: Egg, k: number): void {
  const pixel = look === "pixel";
  const side = rig.turn >= 0 ? 1 : -1;
  const head = headAt(rig);
  const hand = { x: head.x + 3.4, y: 11 };
  const shell = looseShell(k);
  if (shell) {
    drawLooseShell(c, look, f, rig, shell.at, shell.angle);
    // Rummaging: bits fly out of the shell's mouth now and then.
    if (during(k, SEARCH)) {
      for (let i = 0; i < 3; i++) {
        const q = ((k - SEARCH[0]) / 520 + i / 3) % 1;
        const mouth = toScreen(f, rig, { x: IN_FRONT.x - 2.5, y: IN_FRONT.y - 1 });
        const x = mouth.x - side * q * 10 + side * i * 3;
        const y = mouth.y - Math.sin(q * Math.PI) * 14;
        c.globalAlpha = 1 - q;
        c.fillStyle = i === 1 ? "#d29922" : "#8b949e";
        c.fillRect(Math.round(x), Math.round(y), pixel ? ART / 2 : 2.5, pixel ? ART / 2 : 2.5);
      }
      c.globalAlpha = 1;
    }
  }
  // The thing it found: out of the shell's mouth with a pop, in its hands, then tossed back into the shell.
  let at: { x: number; y: number } | null = null;
  let scale = 1;
  if (during(k, PULL)) {
    const q = within(k, PULL);
    const mouth = { x: IN_FRONT.x - 2.5, y: IN_FRONT.y };
    const p = backOut(q);
    at = { x: mouth.x + (hand.x - mouth.x) * p, y: mouth.y + (hand.y - mouth.y) * p - Math.sin(q * Math.PI) * 2 };
    scale = 0.3 + 0.7 * Math.min(1, q * 1.6);
  } else if (k >= PULL[1] && k < STOW[0]) {
    at = hand;
  } else if (during(k, STOW)) {
    const q = ease(within(k, STOW));
    const top = { x: ON_BACK.x, y: ON_BACK.y - 3 };
    at = { x: hand.x + (top.x - hand.x) * q, y: hand.y + (top.y - hand.y) * q - Math.sin(q * Math.PI) * 6 };
    scale = 1 - 0.7 * q;
  }
  if (!at) return;
  const screen = toScreen(f, rig, at);
  const use = during(k, USE) ? k - USE[0] : -1;
  c.save();
  c.translate(screen.x, screen.y);
  c.scale(scale, scale);
  c.translate(-screen.x, -screen.y);
  if (egg === "flag") drawFlag(c, pixel, screen, side, use);
  else if (egg === "coffee") drawCoffee(c, pixel, screen, side, use, toScreen(f, rig, { x: head.x + 1.2, y: head.y + 0.4 }));
  else drawBook(c, pixel, screen, use);
  c.restore();
}

// ---------- a flag: KEEP FOCUSED ----------

/** A 3x5 pixel font, just the letters it needs. */
const FONT: Record<string, string[]> = {
  K: ["101", "101", "110", "101", "101"],
  E: ["111", "100", "110", "100", "111"],
  P: ["110", "101", "110", "100", "100"],
  F: ["111", "100", "110", "100", "100"],
  O: ["010", "101", "101", "101", "010"],
  C: ["011", "100", "100", "100", "011"],
  U: ["101", "101", "101", "101", "111"],
  S: ["011", "100", "010", "001", "110"],
  D: ["110", "101", "101", "101", "110"],
  " ": ["000", "000", "000", "000", "000"]
};
const MOTTO = "KEEP FOCUSED";

function drawFlag(c: CanvasRenderingContext2D, pixel: boolean, hand: { x: number; y: number }, side: number, use: number) {
  const k = use;
  // Tall enough that the cloth flies above its shell.
  const pole = 64 * (ART / 4);
  const top = { x: hand.x, y: hand.y - pole };
  c.fillStyle = "#8a5a00";
  if (pixel) c.fillRect(Math.round(hand.x - 1), Math.round(top.y), 2, Math.round(pole));
  else {
    c.beginPath(); c.moveTo(hand.x, hand.y); c.lineTo(top.x, top.y);
    c.lineWidth = 2; c.lineCap = "round"; c.strokeStyle = "#8a5a00"; c.stroke();
  }
  // The cloth unfurls, waves, and rolls up again before it goes back.
  if (use < 0) return;
  const open = Math.min(within(k, [0, 400]), 1 - within(k, [2600, 3000]));
  if (open <= 0) return;
  const textWidth = MOTTO.length * 4 * 2 - 2;
  const width = (textWidth + 8) * open;
  const height = 16;
  // It flies away from the snail's head, over its shell, so it stays in the window.
  const dirX = -side;
  const wave = (u: number) => Math.sin(u * Math.PI * 2 - k / 170) * 2 * u;
  if (pixel) {
    for (let col = 0; col < width; col += 2) {
      const u = col / Math.max(1, width);
      const x = Math.round(top.x + dirX * col - (dirX < 0 ? 2 : 0));
      const y = Math.round(top.y + wave(u));
      c.fillStyle = INK;
      c.fillRect(x, y - 1, 2, height + 2);
      c.fillStyle = col < 2 ? INK : FLAG;
      if (col >= 2) c.fillRect(x, y, 2, height);
    }
    if (open < 1) return;
    // The motto, letter by letter, riding the wave.
    let cursor = 0;
    const start = dirX > 0 ? top.x + 5 : top.x - width + 3;
    for (const letter of MOTTO) {
      const glyph = FONT[letter]!;
      for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < 3; gx++) {
        if (glyph[gy]![gx] !== "1") continue;
        const px = start + cursor + gx * 2;
        const u = Math.abs(px - top.x) / width;
        c.fillStyle = INK;
        c.fillRect(Math.round(px), Math.round(top.y + 3 + wave(u)) + gy * 2, 2, 2);
      }
      cursor += 8;
    }
  } else {
    const steps = 24;
    const pointAt = (i: number, edge: number) => {
      const u = i / steps;
      return { x: top.x + dirX * width * u, y: top.y + edge + wave(u) };
    };
    c.beginPath();
    for (let i = 0; i <= steps; i++) { const p = pointAt(i, 0); if (i) c.lineTo(p.x, p.y); else c.moveTo(p.x, p.y); }
    for (let i = steps; i >= 0; i--) { const p = pointAt(i, height); c.lineTo(p.x, p.y); }
    c.closePath();
    const g = c.createLinearGradient(top.x, top.y, top.x, top.y + height);
    g.addColorStop(0, mix(FLAG, 0.25)); g.addColorStop(1, mix(FLAG, -0.15));
    c.fillStyle = g; c.fill();
    c.lineWidth = 1.2; c.strokeStyle = INK_A; c.stroke();
    if (open < 1) return;
    c.fillStyle = INK;
    c.font = "800 9px -apple-system, system-ui, sans-serif";
    c.textBaseline = "middle";
    let x = dirX > 0 ? top.x + 6 : top.x - width + 5;
    for (const letter of MOTTO) {
      const u = Math.abs(x - top.x) / width;
      c.fillText(letter, x, top.y + height / 2 + wave(u));
      x += c.measureText(letter).width + 0.6;
    }
    c.textBaseline = "alphabetic";
  }
}

// ---------- a cup of coffee ----------

function drawCoffee(c: CanvasRenderingContext2D, pixel: boolean, hand: { x: number; y: number }, side: number, use: number, mouth: { x: number; y: number }) {
  const k = use;
  // Two sips: the cup goes up to its mouth and back.
  const sip = use < 0 ? 0 : Math.max(sipAt(k, 500), sipAt(k, 1800));
  const x = hand.x + 4 * side + (mouth.x - hand.x) * sip;
  const y = hand.y - 2 + (mouth.y - hand.y) * sip;
  const tilt = sip * 0.5 * side;
  c.save();
  c.translate(x, y);
  c.rotate(tilt);
  if (pixel) {
    const u = ART / 2;
    c.fillStyle = INK; c.fillRect(-4 * u, -4 * u, 7 * u, 8 * u); c.fillRect(side > 0 ? 3 * u : -6 * u, -2 * u, 3 * u, 4 * u);
    c.fillStyle = "#ffffff"; c.fillRect(-3 * u, -3 * u, 5 * u, 6 * u);
    c.fillStyle = "#ffffff"; c.fillRect(side > 0 ? 3 * u : -5 * u, -1 * u, 2 * u, 2 * u);
    c.fillStyle = "#6b3f1d"; c.fillRect(-3 * u, -3 * u, 5 * u, u);
  } else {
    c.beginPath(); c.roundRect ? c.roundRect(-6, -7, 11, 13, 2.5) : c.rect(-6, -7, 11, 13);
    c.fillStyle = "#ffffff"; c.fill(); c.lineWidth = 1.2; c.strokeStyle = INK_A; c.stroke();
    c.beginPath(); c.arc(side > 0 ? 6 : -7, -1, 3, -Math.PI / 2, Math.PI / 2, side < 0); c.lineWidth = 1.8; c.strokeStyle = INK_A; c.stroke();
    c.beginPath(); c.ellipse(-0.5, -6, 4.6, 1.3, 0, 0, Math.PI * 2); c.fillStyle = "#6b3f1d"; c.fill();
  }
  c.restore();
  // Steam while it is hot, between sips.
  if (use >= 0 && sip < 0.3) {
    c.strokeStyle = "rgba(160,170,180,0.7)";
    c.lineWidth = pixel ? 2 : 1.2;
    for (const dx of [-2, 2]) {
      c.beginPath();
      for (let i = 0; i <= 8; i++) {
        const py = y - 10 - i * 1.6;
        const px = x + dx + Math.sin(i * 0.9 - k / 200 + dx) * 1.6;
        if (pixel) c.fillRect(Math.round(px / 2) * 2, Math.round(py / 2) * 2, 2, 2);
        else if (i) c.lineTo(px, py); else c.moveTo(px, py);
      }
      if (!pixel) c.stroke();
    }
  }
}

function sipAt(k: number, start: number): number {
  const t = (k - start) / 900;
  return t <= 0 || t >= 1 ? 0 : Math.sin(t * Math.PI);
}

// ---------- a book ----------

function drawBook(c: CanvasRenderingContext2D, pixel: boolean, hand: { x: number; y: number }, use: number) {
  const k = use;
  const open = use >= 0;
  const x = hand.x;
  const y = hand.y - 8;
  if (!open) {
    if (pixel) {
      c.fillStyle = INK; c.fillRect(Math.round(x - 6), Math.round(y - 7), 12, 14);
      c.fillStyle = "#58a6ff"; c.fillRect(Math.round(x - 4), Math.round(y - 5), 8, 10);
    } else {
      c.beginPath(); c.roundRect ? c.roundRect(x - 5, y - 6, 10, 12, 1.5) : c.rect(x - 5, y - 6, 10, 12);
      c.fillStyle = "#58a6ff"; c.fill(); c.lineWidth = 1.2; c.strokeStyle = INK_A; c.stroke();
    }
    return;
  }
  // Open in its hands; now and then it turns a page.
  const flip = (k % 1100) / 300;
  const pageW = 11;
  const pageH = 13;
  const page = (left: number, width: number, shade: string) => {
    if (pixel) {
      c.fillStyle = INK; c.fillRect(Math.round(left) - 1, Math.round(y - pageH / 2) - 1, Math.round(width) + 2, pageH + 2);
      c.fillStyle = shade; c.fillRect(Math.round(left), Math.round(y - pageH / 2), Math.max(1, Math.round(width)), pageH);
    } else {
      c.beginPath(); c.rect(left, y - pageH / 2, width, pageH);
      c.fillStyle = shade; c.fill(); c.lineWidth = 1; c.strokeStyle = INK_A; c.stroke();
    }
  };
  page(x - pageW, pageW, "#ffffff");
  page(x, pageW, "#ffffff");
  // The lines of text.
  c.fillStyle = "rgba(13,17,23,0.35)";
  for (let i = 0; i < 4; i++) {
    c.fillRect(Math.round(x - pageW + 2), Math.round(y - 4 + i * 3), pageW - 4, 1);
    c.fillRect(Math.round(x + 2), Math.round(y - 4 + i * 3), pageW - 4, 1);
  }
  if (flip > 0 && flip < 1) {
    // The page swings over the spine: wide, narrow, wide on the other side.
    const w = Math.cos(flip * Math.PI) * pageW;
    page(w >= 0 ? x : x + w, Math.abs(w), "#f2f2f2");
  }
}
