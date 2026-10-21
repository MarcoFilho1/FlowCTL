// The overlay's side of the snail: the graph's nodes gather at the bottom of
// the panel, one after another, and the snail forms where they met. Pure
// timings, so the order is tested without a browser.

import { ART } from "./snail.ts";

/** Each node's flight to the snail. */
export const FLIGHT_MS = 700;
/** The snail starts to form once most nodes are in... */
export const FORM_START_MS = 800;
/** ...and takes this long. */
export const FORM_MS = 600;
/** Then the overlay hands it to the app's own window. */
export const FORMED_MS = FORM_START_MS + FORM_MS + 150;
/** Back from the snail, it melts away while the nodes fly home. */
export const UNFORM_MS = 600;
/** The snail's feet sit this far above the bottom of the graph's area, px. */
export const FEET_UP = 10;
/** The nodes fly into the shell, this far above the feet. */
export const INTO_SHELL = 8 * ART;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const clamp = (v: number) => Math.max(0, Math.min(1, v));

/** 0 at home, 1 inside the shell: node `i` of `n`, `elapsed` ms into the gathering. */
export function gatherProgress(i: number, n: number, elapsed: number): number {
  const stagger = Math.min(40, 400 / Math.max(1, n));
  return ease(clamp((elapsed - i * stagger) / FLIGHT_MS));
}

/** How much of the snail there is, `elapsed` ms into the gathering. */
export function formProgress(elapsed: number): number {
  return clamp((elapsed - FORM_START_MS) / FORM_MS);
}
