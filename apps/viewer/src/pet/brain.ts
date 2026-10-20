// What the snail does next, as a pure function of what it was doing, the
// time and what it senses: it walks, stops to look around, rests and falls
// asleep; the mouse coming near wakes it and turns it around; a session that
// needs the person sets its shell rattling. Tested without a canvas.

import type { Pose } from "./snail.ts";

export type Activity = "walk" | "pause" | "rest" | "sleep";

export interface Brain {
  activity: Activity;
  /** When the activity ends (ms, the same clock as `Senses.now`). */
  until: number;
  dir: 1 | -1;
}

export interface Senses {
  now: number;
  /** The mouse's x relative to the snail (px, + to its right), or null when it is not near. */
  mouse: number | null;
  /** Room left to walk on each side before the screen's edge, px. */
  room: { left: number; right: number };
  /** A session waits for the person. */
  alert: boolean;
  /** 0..1, Math.random by default. */
  random?: () => number;
}

/** Snail speed, px per second: slow and steady. */
export const SPEED = 9;
/** It turns back this far from an edge. */
export const EDGE = 12;

const DURATION: Record<Activity, [number, number]> = {
  walk: [7000, 15000],
  pause: [1500, 3000],
  rest: [4000, 7000],
  sleep: [20000, 45000]
};

export function start(now: number, random: () => number = Math.random): Brain {
  return { activity: "walk", until: now + span("walk", random), dir: random() < 0.5 ? -1 : 1 };
}

function span(activity: Activity, random: () => number): number {
  const [low, high] = DURATION[activity];
  return low + (high - low) * random();
}

/** The next activity when one ends. */
function next(activity: Activity, random: () => number): Activity {
  const r = random();
  switch (activity) {
    case "walk": return r < 0.55 ? "pause" : "rest";
    case "pause": return "walk";
    case "rest": return r < 0.45 ? "sleep" : "walk";
    case "sleep": return "walk";
  }
}

/** One step of thought: the brain afterwards, the pose to draw and whether it moves. */
export function think(brain: Brain, senses: Senses): { brain: Brain; pose: Pose; moving: boolean } {
  const random = senses.random ?? Math.random;
  let { activity, until, dir } = brain;
  if (senses.alert) {
    if (senses.mouse !== null) dir = senses.mouse < 0 ? -1 : 1;
    return { brain: { activity, until, dir }, pose: "alert", moving: false };
  }
  if (senses.mouse !== null) {
    // Someone is near: it wakes, stops and looks their way, and rests a while after.
    dir = senses.mouse < 0 ? -1 : 1;
    return { brain: { activity: "rest", until: senses.now + span("rest", random), dir }, pose: "look", moving: false };
  }
  if (senses.now >= until) {
    activity = next(activity, random);
    until = senses.now + span(activity, random);
    if (activity === "walk" && random() < 0.4) dir = dir === 1 ? -1 : 1;
  }
  if (activity === "walk") {
    // At an edge it turns around; with no room either way it stays put.
    if ((dir === 1 ? senses.room.right : senses.room.left) < EDGE) dir = dir === 1 ? -1 : 1;
    const moving = (dir === 1 ? senses.room.right : senses.room.left) >= EDGE;
    return { brain: { activity, until, dir }, pose: moving ? "walk" : "look", moving };
  }
  return { brain: { activity, until, dir }, pose: activity === "sleep" ? "sleep" : "look", moving: false };
}
