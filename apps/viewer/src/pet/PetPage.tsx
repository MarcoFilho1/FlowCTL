// The pet's window (?ui=pet): the snail, drawn in the middle of a small
// transparent window that the overlay app moves along the bottom of the
// screen. The page thinks (brain.ts) and draws (snail.ts); the app moves the
// window by the steps the page asks for and tells it what it cannot see: the
// room to each edge, the mouse, and whether a session waits for the person.
//
// In (window.flowctlPet): setLook, setTheme, setMood, setMouse, setRoom, land, leave.
// Out (tellNative): petMove { dx }, petTucked, petClick.

import { useEffect, useRef } from "react";
import { tellNative, type Look, type Theme } from "../store.ts";
import { SPEED, start, think, type Brain } from "./brain.ts";
import { drawBang, drawRattle, drawSnail, drawTrail, drawZzz, TRAIL_MS, type Pose } from "./snail.ts";

declare global {
  interface Window {
    flowctlPet?: {
      setLook(look: Look): void;
      setTheme(theme: Theme): void;
      /** "alert" while a session waits for the person. */
      setMood(mood: "calm" | "alert"): void;
      /** The mouse's x in page points, or null when it is not near. */
      setMouse(x: number | null): void;
      /** Room to walk before the screen's edges, px. */
      setRoom(left: number, right: number): void;
      /** The window reached the ground: the snail comes out of its shell. */
      land(): void;
      /** Going back to the overlay: into the shell; petTucked follows. */
      leave(): void;
    };
  }
}

/** Where the snail is in its life in this window. */
type Phase = "flying" | "living" | "leaving";

interface PetState {
  look: Look;
  theme: Theme;
  alert: boolean;
  mouse: number | null;
  room: { left: number; right: number };
  phase: Phase;
  brain: Brain;
  /** How far it has walked (px): the trail's frame of reference. */
  world: number;
  /** Steps not yet sent to the app, under a pixel. */
  owed: number;
  trail: { x: number; t: number }[];
  phaseAt: number;
  walk: number;
  stride: number;
  blinkUntil: number;
  nextBlink: number;
}

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const dark = (theme: Theme) => theme === "dark" || (theme === "auto" && typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches);

export function PetPage() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const now = performance.now();
    const pet: PetState = {
      look: "pixel",
      theme: "auto",
      alert: false,
      mouse: null,
      room: { left: Infinity, right: Infinity },
      phase: "flying",
      brain: start(now),
      world: 0,
      owed: 0,
      trail: [],
      phaseAt: now,
      walk: 0,
      stride: 0,
      blinkUntil: 0,
      nextBlink: now + 2000
    };
    window.flowctlPet = {
      setLook: (look) => { pet.look = look; },
      setTheme: (theme) => { pet.theme = theme; },
      setMood: (mood) => { pet.alert = mood === "alert"; },
      setMouse: (x) => { pet.mouse = x; },
      setRoom: (left, right) => { pet.room = { left, right }; },
      // Out of the shell, it sets off walking (its day starts now, not when the page loaded).
      land: () => { pet.phase = "living"; pet.phaseAt = performance.now(); pet.brain = start(pet.phaseAt); },
      leave: () => {
        pet.phase = "leaving";
        pet.phaseAt = performance.now();
        // A moment to pull into the shell, then the app flies it home.
        setTimeout(() => tellNative({ type: "petTucked" }), 260);
      }
    };

    let last = now;
    let frame = 0;
    const tick = (t: number) => {
      const dt = Math.min(64, t - last);
      last = t;
      const el = canvas.current;
      if (el) draw(el, pet, t, dt);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      delete window.flowctlPet;
    };
  }, []);

  return (
    <canvas
      ref={canvas}
      className="pet"
      aria-label="FlowCTL snail"
      onClick={() => tellNative({ type: "petClick" })}
    />
  );
}

function draw(el: HTMLCanvasElement, pet: PetState, t: number, dt: number) {
  const ratio = window.devicePixelRatio || 1;
  const width = el.clientWidth;
  const height = el.clientHeight;
  if (el.width !== Math.round(width * ratio) || el.height !== Math.round(height * ratio)) {
    el.width = Math.round(width * ratio);
    el.height = Math.round(height * ratio);
  }
  const c = el.getContext("2d");
  if (!c) return;
  c.setTransform(ratio, 0, 0, ratio, 0, 0);
  c.clearRect(0, 0, width, height);
  const x = width / 2;
  const ground = height - 2;

  let pose: Pose = "tucked";
  let moving = false;
  if (pet.phase === "living") {
    const mouse = pet.mouse === null ? null : pet.mouse - x;
    const thought = think(pet.brain, { now: t, mouse, room: pet.room, alert: pet.alert });
    pet.brain = thought.brain;
    pose = thought.pose;
    moving = thought.moving && !reducedMotion();
    if (!moving && pose === "walk") pose = "look";
  }
  if (moving) {
    const dx = (pet.brain.dir * SPEED * dt) / 1000;
    pet.world += dx;
    pet.walk += Math.abs(dx);
    pet.owed += dx;
    const whole = Math.trunc(pet.owed);
    if (whole !== 0) {
      pet.owed -= whole;
      tellNative({ type: "petMove", dx: whole });
      pet.room = { left: pet.room.left + whole, right: pet.room.right - whole };
    }
    const tail = pet.world - pet.brain.dir * 18;
    if (!pet.trail.length || Math.abs(pet.trail[pet.trail.length - 1]!.x - tail) >= 2) pet.trail.push({ x: tail, t });
  }
  pet.trail = pet.trail.filter((p) => t - p.t < TRAIL_MS);
  pet.stride = Math.max(0, Math.min(1, pet.stride + (moving ? dt : -dt) / 200));
  if (t > pet.nextBlink) {
    pet.blinkUntil = t + 130;
    pet.nextBlink = t + 2200 + Math.random() * 3300;
  }

  const muted = dark(pet.theme) ? "#c9d1d9" : "#5b6573";
  const placed = pet.trail.map((p) => ({ x: x + (p.x - pet.world), t: p.t }));
  drawTrail(c, pet.look, ground, placed, t);
  const frame = {
    look: pet.look,
    pose,
    x,
    ground,
    dir: pet.brain.dir,
    t,
    phase: pet.walk / 6,
    stride: pet.stride,
    walked: pet.walk,
    blink: t < pet.blinkUntil
  };
  drawSnail(c, frame);
  if (pose === "sleep") drawZzz(c, pet.look, frame, muted);
  if (pose === "alert") {
    drawRattle(c, pet.look, frame, "#8b949e");
    drawBang(c, pet.look, frame);
  }
}
