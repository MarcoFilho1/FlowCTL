// Sound cues: a quiet detail for what changes in the graph, synthesized with
// Web Audio (no audio files). The smooth look plays clean tones; the pixel
// look plays the same clean tones, softer, under an 8-bit layer of square
// waves, the way a pixel game would.

import type { Look } from "./store.ts";
import type { Transitions } from "./transitions.ts";

/** What a cue announces. */
export type Cue = "appear" | "start" | "done" | "needs" | "error" | "complete";

/** Master volume: a detail, not an alert. */
const VOLUME = 0.5;
/** The same cue within this window plays once. */
const SAME_CUE_MS = 300;
/** At most this many cues per window, so a burst of events is not a burst of noise. */
const BURST = { count: 3, ms: 600 };

/**
 * The cues for one change of the graph on screen, most important first.
 * A session that just finished plays its own cue instead of the last "done".
 */
export function cuesFor(change: Transitions, wentYellow: boolean, finishedSession: boolean): Cue[] {
  const cues: Cue[] = [];
  if (wentYellow) cues.push("needs");
  if (change.flashed.length > 0) cues.push("error");
  if (finishedSession) cues.push("complete");
  else if (change.finished.length > 0) cues.push("done");
  if (change.added.length > 0) cues.push("appear");
  if (change.started.length > 0 && change.finished.length === 0) cues.push("start");
  return cues;
}

/** Decides which cues actually play: no repeats, no bursts. Pure, given the clock. */
export function createGate(now: () => number = () => Date.now()) {
  const lastByCue = new Map<Cue, number>();
  let recent: number[] = [];
  return (cue: Cue): boolean => {
    const t = now();
    if (t - (lastByCue.get(cue) ?? -Infinity) < SAME_CUE_MS) return false;
    recent = recent.filter((at) => t - at < BURST.ms);
    if (recent.length >= BURST.count) return false;
    recent.push(t);
    lastByCue.set(cue, t);
    return true;
  };
}

type Wave = OscillatorType;
interface Tone {
  /** Hz, or [from, to] for a glide. */
  freq: number | [number, number];
  /** Seconds after the cue starts. */
  at: number;
  /** Seconds. */
  dur: number;
  gain: number;
  wave: Wave;
  /** Steps for an 8-bit glide (a staircase instead of a slide). */
  steps?: number;
}

// Clean tones: sine and triangle, soft attack, gentle decay.
const CLEAN: Record<Cue, Tone[]> = {
  appear: [{ freq: [660, 990], at: 0, dur: 0.09, gain: 0.05, wave: "sine" }],
  start: [{ freq: 880, at: 0, dur: 0.06, gain: 0.04, wave: "triangle" }],
  done: [
    { freq: 1046, at: 0, dur: 0.09, gain: 0.05, wave: "sine" },
    { freq: 1568, at: 0.08, dur: 0.14, gain: 0.05, wave: "sine" }
  ],
  needs: [
    { freq: 880, at: 0, dur: 0.18, gain: 0.07, wave: "sine" },
    { freq: 659, at: 0.16, dur: 0.26, gain: 0.07, wave: "sine" }
  ],
  error: [{ freq: [220, 150], at: 0, dur: 0.14, gain: 0.07, wave: "sine" }],
  complete: [523, 659, 784, 1046].map((freq, i) => ({ freq, at: i * 0.07, dur: i === 3 ? 0.22 : 0.09, gain: 0.05, wave: "sine" as Wave }))
};

// The 8-bit layer: square waves, short notes, staircase glides.
const PIXEL: Record<Cue, Tone[]> = {
  // Power-up: a rising staircase.
  appear: [{ freq: [440, 880], at: 0, dur: 0.12, gain: 0.025, wave: "square", steps: 4 }],
  start: [{ freq: 1320, at: 0, dur: 0.035, gain: 0.02, wave: "square" }],
  // The coin: B5 then a held E6.
  done: [
    { freq: 988, at: 0, dur: 0.06, gain: 0.025, wave: "square" },
    { freq: 1319, at: 0.06, dur: 0.18, gain: 0.025, wave: "square" }
  ],
  // Two quick alert beeps.
  needs: [
    { freq: 1047, at: 0, dur: 0.06, gain: 0.03, wave: "square" },
    { freq: 1047, at: 0.1, dur: 0.06, gain: 0.03, wave: "square" }
  ],
  // A hit: a falling staircase.
  error: [{ freq: [330, 110], at: 0, dur: 0.15, gain: 0.03, wave: "square", steps: 5 }],
  // Stage clear: a quick arpeggio up to a held note.
  complete: [523, 659, 784, 1046, 1319].map((freq, i) => ({ freq, at: i * 0.06, dur: i === 4 ? 0.2 : 0.05, gain: 0.025, wave: "square" as Wave }))
};

/** The tones a cue plays in a look: clean alone, or clean (softer) under the 8-bit layer. */
export function tonesFor(cue: Cue, look: Look): Tone[] {
  if (look === "smooth") return CLEAN[cue];
  return [...CLEAN[cue].map((tone) => ({ ...tone, gain: tone.gain * 0.5 })), ...PIXEL[cue]];
}

let context: AudioContext | undefined;
/** When the context was last asked to resume and was not running yet. */
let resumeAskedAt: number | undefined;
/** The context's clock against the wall clock, at the last cue. */
let lastSeen: { audio: number; wall: number } | undefined;

/** A context that cannot be trusted to sound: made again from scratch. */
const STUCK_MS = 1000;

function audio(): AudioContext | undefined {
  if (typeof AudioContext !== "function") return undefined;
  const wall = Date.now();
  if (context !== undefined && isDead(context, wall)) {
    void context.close?.().catch(() => undefined);
    context = undefined;
  }
  if (context === undefined) {
    context = new AudioContext();
    resumeAskedAt = undefined;
    lastSeen = undefined;
  }
  // Not only suspended: WebKit leaves it "interrupted" after the computer
  // sleeps or the output device changes, and it stays silent until resumed.
  if (context.state !== "running") {
    resumeAskedAt ??= wall;
    void context.resume().catch(() => undefined);
  } else {
    resumeAskedAt = undefined;
  }
  lastSeen = { audio: context.currentTime, wall };
  return context;
}

/**
 * Closed; or asked to resume a while ago and still not running; or "running"
 * with a clock that stopped: after the Mac sleeps or the output device goes
 * away (a monitor's speakers), WebKit can keep a context that says running
 * and plays nothing. Its clock is what gives it away.
 */
function isDead(ctx: AudioContext, wall: number): boolean {
  if (ctx.state === "closed") return true;
  if (ctx.state !== "running") return resumeAskedAt !== undefined && wall - resumeAskedAt >= STUCK_MS;
  if (lastSeen === undefined) return false;
  const elapsed = wall - lastSeen.wall;
  return elapsed >= STUCK_MS && (ctx.currentTime - lastSeen.audio) * 1000 < elapsed / 2;
}

/**
 * Drops the context so the next cue makes a new one. The overlay app calls
 * it when the Mac wakes, before the first cue can fall on a dead context.
 */
export function resetAudio(): void {
  void context?.close?.().catch(() => undefined);
  context = undefined;
  resumeAskedAt = undefined;
  lastSeen = undefined;
}

/** Plays a cue now. Silently does nothing where audio is unavailable. */
export function play(cue: Cue, look: Look): void {
  const ctx = audio();
  if (!ctx) return;
  const start = ctx.currentTime + 0.01;
  for (const tone of tonesFor(cue, look)) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = tone.wave;
    const t0 = start + tone.at;
    const t1 = t0 + tone.dur;
    if (Array.isArray(tone.freq)) {
      const [from, to] = tone.freq;
      if (tone.steps) {
        for (let i = 0; i < tone.steps; i += 1) {
          osc.frequency.setValueAtTime(from + ((to - from) * i) / (tone.steps - 1), t0 + (tone.dur * i) / tone.steps);
        }
      } else {
        osc.frequency.setValueAtTime(from, t0);
        osc.frequency.exponentialRampToValueAtTime(to, t1);
      }
    } else {
      osc.frequency.setValueAtTime(tone.freq, t0);
    }
    const peak = tone.gain * VOLUME;
    gain.gain.setValueAtTime(0, t0);
    // Square waves start and stop sharp (the 8-bit click); clean tones ease in and out.
    gain.gain.linearRampToValueAtTime(peak, t0 + (tone.wave === "square" ? 0.002 : 0.012));
    gain.gain.setValueAtTime(peak, t0 + tone.dur * (tone.wave === "square" ? 0.85 : 0.3));
    gain.gain.linearRampToValueAtTime(0, t1);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t1 + 0.02);
  }
}

const gate = createGate();

/** Plays a cue unless the same one just played or too many did. */
export function cue(which: Cue, look: Look): void {
  if (gate(which)) play(which, look);
}
