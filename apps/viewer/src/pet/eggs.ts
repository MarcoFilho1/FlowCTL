// The snail's little scenes, now and then while it rests: it grows hands,
// lifts its shell, takes something out from under it, uses it a while and
// puts it back. A flag that says KEEP FOCUSED, a cup of coffee, a book.
// Timed as one timeline, so the rig (hands, shell lid) and the item move together.

import type { Look } from "../store.ts";
import { ART, headAt, mix, shellAt, toScreen, type Rig, type SnailFrame } from "./snail.ts";

export type Egg = "flag" | "coffee" | "book";
export const EGGS: readonly Egg[] = ["flag", "coffee", "book"];

/** How long a scene lasts, ms. */
export const EGG_MS = 5600;
/** Out of the shell into its hands, then used, then back. */
const CARRY_OUT: [number, number] = [450, 1050];
const USE: [number, number] = [1100, 4300];
const CARRY_BACK: [number, number] = [4350, 4950];

const INK = "#0d1117";
const INK_A = "rgba(13,17,23,0.82)";
const FLAG = "#e3b341";

const clamp = (v: number) => Math.max(0, Math.min(1, v));
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const within = (k: number, [a, b]: [number, number]) => clamp((k - a) / (b - a));

/** What the rig does during a scene `k` ms in: hands out, the shell lifted while the item goes in or out, eyes on the item. */
export function eggRig(rig: Rig, k: number): Rig {
  const lifting = (k > 300 && k < 1100) || (k > 4300 && k < 5000);
  return {
    ...rig,
    hands: k < 5100 ? 1 : 0,
    lid: lifting ? 3 : 0,
    stalk: 0.4,
    gazeX: k > USE[0] && k < USE[1] ? 0.8 : rig.gazeX,
    gazeY: k > USE[0] && k < USE[1] ? 1 : rig.gazeY
  };
}

/** 0 inside the shell .. 1 in its hands. */
function carry(k: number): number {
  if (k < CARRY_OUT[1]) return ease(within(k, CARRY_OUT));
  if (k < CARRY_BACK[0]) return 1;
  return 1 - ease(within(k, CARRY_BACK));
}

export function drawEgg(c: CanvasRenderingContext2D, look: Look, f: Pick<SnailFrame, "x" | "ground">, rig: Rig, egg: Egg, k: number): void {
  const held = carry(k);
  if (held <= 0) return;
  const head = headAt(rig);
  const shell = shellAt(rig);
  const hand = { x: head.x + 3.4, y: 11 };
  const from = { x: shell.x, y: shell.y - 3.5 };
  const at = toScreen(f, rig, { x: from.x + (hand.x - from.x) * held, y: from.y + (hand.y - from.y) * held });
  const side = rig.turn >= 0 ? 1 : -1;
  const use = k > USE[0] && k < USE[1] ? (k - USE[0]) / (USE[1] - USE[0]) : 0;
  const pixel = look === "pixel";
  if (egg === "flag") drawFlag(c, pixel, at, side, k, held);
  else if (egg === "coffee") drawCoffee(c, pixel, at, side, k, toScreen(f, rig, { x: head.x + 1.2, y: head.y + 0.4 }));
  else drawBook(c, pixel, at, k, use > 0);
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

function drawFlag(c: CanvasRenderingContext2D, pixel: boolean, hand: { x: number; y: number }, side: number, k: number, held: number) {
  // The pole: short while it comes out of the shell, full height in its hand.
  // Tall enough that the cloth flies above its shell.
  const pole = (6 + 58 * held) * (ART / 4);
  const top = { x: hand.x, y: hand.y - pole };
  c.fillStyle = "#8a5a00";
  if (pixel) c.fillRect(Math.round(hand.x - 1), Math.round(top.y), 2, Math.round(pole));
  else {
    c.beginPath(); c.moveTo(hand.x, hand.y); c.lineTo(top.x, top.y);
    c.lineWidth = 2; c.lineCap = "round"; c.strokeStyle = "#8a5a00"; c.stroke();
  }
  // The cloth unfurls, waves, and rolls up again before it goes back.
  const open = Math.min(within(k, [1050, 1450]), 1 - within(k, [3900, 4300]));
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

function drawCoffee(c: CanvasRenderingContext2D, pixel: boolean, hand: { x: number; y: number }, side: number, k: number, mouth: { x: number; y: number }) {
  // Two sips: the cup goes up to its mouth and back.
  const sip = Math.max(sipAt(k, 1600), sipAt(k, 2900));
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
  if (k > 1100 && k < 4300 && sip < 0.3) {
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

function drawBook(c: CanvasRenderingContext2D, pixel: boolean, hand: { x: number; y: number }, k: number, open: boolean) {
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
  const flip = ((k - 1100) % 1100) / 300;
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
