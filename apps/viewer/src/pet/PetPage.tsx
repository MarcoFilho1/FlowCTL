// The pet's window (?ui=pet): the snail, drawn at the bottom middle of a
// transparent window that the overlay app moves along the bottom of the
// screen. The page thinks (brain.ts) and draws (snail.ts); the app moves the
// window by the steps the page asks for and tells it what it cannot see: the
// room to each edge, the mouse, whether a session waits for the person, and
// whether the snail is being carried. It also gets the sessions, as the
// overlay does, to tell the person how the current one stands while the
// mouse is on the snail.
//
// In (window.flowctlPet): setLook, setTheme, setMood, setMouse, setHover, setHeld, setRoom, land, leave;
// and window.flowctl.push / remove, the overlay's own.
// Out (tellNative): petMove { dx }, petTucked.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createSessionStore, installBridge, tellNative, type Look, type SessionStore, type Theme } from "../store.ts";
import { SPEED, start, think, WORK_SPEED, type Brain } from "./brain.ts";
import { progress, type Seen } from "./events.ts";
import { drawEgg, EGG_MS, EGGS, eggRig, type Egg } from "./eggs.ts";
import { ART, CELEBRATION_MS, celebrationHop, drawBall, drawBang, drawDone, drawRattle, drawSnail, drawTrail, drawZzz, follow, rigFor, TRAIL_MS, type Pose, type Rig } from "./snail.ts";
import { summarize, type SessionSummary } from "./summary.ts";

declare global {
  interface Window {
    flowctlPet?: {
      setLook(look: Look): void;
      setTheme(theme: Theme): void;
      /** "alert" while a session waits for the person. */
      setMood(mood: "calm" | "alert"): void;
      /** The mouse's x in page points, or null when it is not near. */
      setMouse(x: number | null): void;
      /** The mouse is on the snail itself: the summary shows. */
      setHover(on: boolean): void;
      /** Carried by the person (hanging by its shell), or put down. */
      setHeld(held: boolean): void;
      /** Room to walk before the screen's edges, px. */
      setRoom(left: number, right: number): void;
      /** The window reached the ground: the snail comes out of its shell. */
      land(): void;
      /** Going back to the overlay: into the shell; petTucked follows. */
      leave(): void;
      /** Plays a little scene now: flag, coffee or book (demos, checks). */
      playEgg?(kind: string): void;
    };
  }
}

/** Where the snail is in its life in this window. */
type Phase = "flying" | "living" | "leaving";

/** A mouse resting on the snail this long makes it hide in its shell. */
export const SHY_AFTER_MS = 2500;

interface PetState {
  look: Look;
  theme: Theme;
  alert: boolean;
  mouse: number | null;
  /** Since when the mouse is on the snail itself, or null. */
  hoverSince: number | null;
  held: boolean;
  room: { left: number; right: number };
  phase: Phase;
  brain: Brain;
  /** How far it has walked (px): the trail's frame of reference. */
  world: number;
  /** Steps not yet sent to the app, under a pixel. */
  owed: number;
  trail: { x: number; t: number }[];
  walk: number;
  stride: number;
  blinkUntil: number;
  nextBlink: number;
  /** A session works: it pushes a ball, the step under way. */
  working: boolean;
  /** When the current ball popped up, and when its step was done (it bursts), if it was. */
  ballAt: number;
  burstAt: number | null;
  /** When it began celebrating a session that finished, if it is. */
  celebrateAt: number | null;
  /** Its parts as drawn now, easing toward each pose. */
  rig: Rig;
  /** Until when it stays in its shell after being put down or landing. */
  emergeAt: number;
  /** The little scene it is playing, and when the next may come. */
  egg: { kind: Egg; at: number } | null;
  nextEggAt: number;
}

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const dark = (theme: Theme) => theme === "dark" || (theme === "auto" && typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches);

/** The snail's height on screen, px: the card sits above it. */
const SNAIL_TALL = 66;

export function PetPage({ store: given }: { store?: SessionStore } = {}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [store] = useState(() => given ?? createSessionStore());
  const [hovering, setHovering] = useState(false);
  const [theme, setTheme] = useState<Theme>("auto");

  // The palette's tokens hang off the root, as in the overlay.
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "auto") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    installBridge(store);
    const now = performance.now();
    const pet: PetState = {
      look: "pixel",
      theme: "auto",
      alert: false,
      mouse: null,
      hoverSince: null,
      held: false,
      room: { left: Infinity, right: Infinity },
      phase: "flying",
      brain: start(now),
      world: 0,
      owed: 0,
      trail: [],
      walk: 0,
      stride: 0,
      blinkUntil: 0,
      nextBlink: now + 2000,
      working: false,
      ballAt: now,
      burstAt: null,
      celebrateAt: null,
      rig: rigFor("tucked", now, 1),
      emergeAt: 0,
      egg: null,
      nextEggAt: now + 25_000
    };
    // Steps done and sessions finished, from the snapshots as they come.
    let seen: Seen = new Map();
    const look = () => {
      const result = progress(seen, store.getState().sessions);
      seen = result.seen;
      const at = performance.now();
      if (result.working && !pet.working) pet.ballAt = at;
      pet.working = result.working;
      if (result.steps > 0 && pet.burstAt === null) pet.burstAt = at;
      if (result.finished > 0 && !result.working) pet.celebrateAt = at;
    };
    look();
    const unsubscribe = store.subscribe(look);
    window.flowctlPet = {
      setLook: (look) => { pet.look = look; },
      setTheme: (next) => { pet.theme = next; setTheme(next); },
      setMood: (mood) => { pet.alert = mood === "alert"; },
      setMouse: (x) => { pet.mouse = x; },
      setHover: (on) => {
        pet.hoverSince = on ? (pet.hoverSince ?? performance.now()) : null;
        setHovering(on);
      },
      setHeld: (held) => {
        pet.held = held;
        // Carried elsewhere: the trail behind it no longer leads anywhere.
        if (held) pet.trail = [];
        // Put down: it stays in its shell a moment, then peeks out and sets off.
        else {
          pet.emergeAt = performance.now() + 700;
          pet.brain = start(pet.emergeAt);
        }
      },
      setRoom: (left, right) => { pet.room = { left, right }; },
      // Out of the shell, it sets off walking (its day starts now, not when the page loaded).
      land: () => {
        pet.phase = "living";
        pet.brain = start(performance.now());
        pet.emergeAt = performance.now() + 700;
      },
      playEgg: (kind) => {
        pet.egg = { kind: EGGS.includes(kind as Egg) ? (kind as Egg) : "flag", at: performance.now() };
      },
      leave: () => {
        pet.phase = "leaving";
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
      unsubscribe();
      delete window.flowctlPet;
    };
  }, [store]);

  return (
    <div className="pet-page">
      <canvas ref={canvas} className="pet" aria-label="FlowCTL snail" />
      {hovering && <SummaryCard store={store} />}
    </div>
  );
}

/** The current session at a glance, above the snail while the mouse is on it. */
function SummaryCard({ store }: { store: SessionStore }) {
  const state = useSyncExternalStore(store.subscribe, store.getState);
  // "4 min ago" moves on while it shows.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  const summary = summarize(state.sessions, state.active, now);
  return (
    <div className="pet-card" role="status" style={{ bottom: SNAIL_TALL }}>
      {summary ? <SummaryBody summary={summary} /> : <p className="pet-card-empty">No session yet</p>}
    </div>
  );
}

function SummaryBody({ summary }: { summary: SessionSummary }) {
  const share = summary.total > 0 ? summary.done / summary.total : 0;
  return (
    <>
      <div className="pet-card-head">
        <span className="pet-card-name">{summary.name}</span>
        <span className={`pet-card-state state-${summary.state}`}>{summary.stateLabel}</span>
      </div>
      {summary.total > 0 && (
        <div className="pet-card-progress">
          <span className="pet-card-bar"><span style={{ width: `${Math.round(share * 100)}%` }} /></span>
          <span>{`${summary.done}/${summary.total} steps`}</span>
        </div>
      )}
      {summary.focus && (
        <p className="pet-card-focus">
          <span className="pet-card-label">{summary.focus.label}</span>
          <span className="pet-card-title">{summary.focus.title}</span>
        </p>
      )}
      {(summary.since || summary.others > 0) && (
        <p className="pet-card-foot">
          {[
            summary.since && `Updated ${summary.since}`,
            summary.others > 0 && `+${summary.others} other session${summary.others > 1 ? "s" : ""}${summary.othersWaiting > 0 ? `, ${summary.othersWaiting} need${summary.othersWaiting > 1 ? "" : "s"} you` : ""}`
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
    </>
  );
}

/** The pose this frame, from the brain's and what the person is doing with the snail. */
export function poseFor(
  thought: Pose,
  pet: { alert: boolean; held: boolean; mouse: number | null; hoverSince: number | null; celebrateAt?: number | null },
  now: number
): Pose {
  if (pet.held) return "held";
  if (pet.alert) return "alert";
  if (pet.celebrateAt != null && now - pet.celebrateAt < CELEBRATION_MS) return "done";
  if (pet.hoverSince !== null && now - pet.hoverSince >= SHY_AFTER_MS) return "shy";
  if (pet.mouse !== null) return "curious";
  return thought;
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
  let wants = false;
  if (pet.phase === "living") {
    const mouse = pet.mouse === null ? null : pet.mouse - x;
    const thought = think(pet.brain, { now: t, mouse, room: pet.room, alert: pet.alert, working: pet.working });
    pet.brain = thought.brain;
    pose = poseFor(thought.pose, pet, t);
    wants = thought.moving && (pose === "walk" || pose === "work") && !reducedMotion();
    // Resting with nothing going on, now and then it plays a little scene.
    const quiet = pose === "look" && thought.pose === "look" && pet.mouse === null && !pet.working && !reducedMotion();
    if (pet.egg === null && quiet && t > pet.nextEggAt) pet.egg = { kind: EGGS[Math.floor(Math.random() * EGGS.length)]!, at: t };
  }
  if (pet.egg && (t - pet.egg.at > EGG_MS || pose === "alert" || pose === "held" || pose === "work")) {
    pet.egg = null;
    pet.nextEggAt = t + 60_000 + Math.random() * 90_000;
  }
  if (pet.egg) {
    pose = "look";
    wants = false;
  }

  // Its parts ease toward what it is doing: it never jumps from one pose to the next.
  const step = Math.sin(pet.walk / 6) * pet.stride;
  let target = rigFor(pose, t, pet.brain.dir, step);
  // Just put down or landed: a moment in its shell before it peeks out.
  if (t < pet.emergeAt) target = { ...target, out: 0, foot: 1, stalk: 0 };
  if (pet.egg) target = eggRig(target, t - pet.egg.at);
  if (pose === "done" && pet.celebrateAt !== null) target = { ...target, lift: celebrationHop(t - pet.celebrateAt) * 3 * ART };
  pet.rig = follow(pet.rig, target, dt);
  // It walks only once it faces the way it goes and is out of its shell.
  const moving = wants && pet.rig.turn * pet.brain.dir > 0.85 && pet.rig.out > 0.9;
  if (!moving && pose === "walk") pose = "look";

  if (moving) {
    const dx = (pet.brain.dir * (pose === "work" ? WORK_SPEED : SPEED) * dt) / 1000;
    pet.world += dx;
    pet.walk += Math.abs(dx);
    pet.owed += dx;
    const whole = Math.trunc(pet.owed);
    if (whole !== 0) {
      pet.owed -= whole;
      tellNative({ type: "petMove", dx: whole });
      pet.room = { left: pet.room.left + whole, right: pet.room.right - whole };
    }
    // The trail starts where its body ends.
    const tail = pet.world - pet.brain.dir * 24;
    if (!pet.trail.length || Math.abs(pet.trail[pet.trail.length - 1]!.x - tail) >= 1.5) pet.trail.push({ x: tail, t });
  }
  pet.trail = pet.trail.filter((p) => t - p.t < TRAIL_MS);
  pet.stride = Math.max(0, Math.min(1, pet.stride + (moving ? dt : -dt) / 200));
  if (t > pet.nextBlink) {
    pet.blinkUntil = t + 130;
    pet.nextBlink = t + 2200 + Math.random() * 3300;
  }

  const muted = dark(pet.theme) ? "#c9d1d9" : "#5b6573";
  if (!pet.held) drawTrail(c, pet.look, ground, pet.trail.map((p) => ({ x: x + (p.x - pet.world), t: p.t })), t);
  const facing: 1 | -1 = pet.rig.turn >= 0 ? 1 : -1;
  const frame = {
    look: pet.look,
    pose,
    x,
    ground,
    dir: facing,
    t,
    phase: pet.walk / 6,
    stride: pet.stride,
    walked: pet.walk,
    blink: t < pet.blinkUntil,
    rig: pet.rig
  };
  drawSnail(c, frame);
  if (pet.egg) drawEgg(c, pet.look, frame, pet.rig, pet.egg.kind, t - pet.egg.at);
  if (pose === "work") {
    // The ball: it pops up, and bursts when its step is done; then the next one.
    if (pet.burstAt !== null && t - pet.burstAt >= 420) {
      pet.burstAt = null;
      pet.ballAt = t;
    }
    const burst = pet.burstAt === null ? 0 : (t - pet.burstAt) / 420;
    drawBall(c, pet.look, frame, { shown: Math.min(1, (t - pet.ballAt) / 220) * pet.rig.out, burst });
  } else if (pet.burstAt !== null && t - pet.burstAt >= 420) pet.burstAt = null;
  if (pose === "done" && pet.celebrateAt !== null) drawDone(c, pet.look, { ...frame, ground: ground - pet.rig.lift }, t - pet.celebrateAt);
  if (pose === "sleep" && pet.rig.out < 0.3) drawZzz(c, pet.look, frame, muted);
  if (pose === "alert") {
    drawRattle(c, pet.look, frame, "#8b949e");
    drawBang(c, pet.look, frame);
  }
}
