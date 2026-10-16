import { afterEach, describe, expect, test, vi } from "vitest";
import { createGate, cuesFor, play, tonesFor, type Cue } from "./sound.ts";
import type { Transitions } from "./transitions.ts";

const none: Transitions = { added: [], finished: [], started: [], handoffs: [], flashed: [] };

describe("which cues a change plays", () => {
  test("each kind of change has its own cue", () => {
    expect(cuesFor({ ...none, added: ["a"] }, false, false)).toEqual(["appear"]);
    expect(cuesFor({ ...none, started: ["a"] }, false, false)).toEqual(["start"]);
    expect(cuesFor({ ...none, finished: ["a"], started: ["b"] }, false, false)).toEqual(["done"]);
    expect(cuesFor({ ...none, flashed: ["a"] }, false, false)).toEqual(["error"]);
    expect(cuesFor(none, true, false)).toEqual(["needs"]);
  });

  test("a finished session plays its own cue instead of the last step's", () => {
    expect(cuesFor({ ...none, finished: ["a"] }, false, true)).toEqual(["complete"]);
  });

  test("the most important comes first", () => {
    expect(cuesFor({ ...none, finished: ["a"], added: ["b"], flashed: ["c"] }, true, false)).toEqual(["needs", "error", "done", "appear"]);
  });

  test("nothing changed, nothing plays", () => {
    expect(cuesFor(none, false, false)).toEqual([]);
  });
});

describe("the gate keeps it a detail", () => {
  test("the same cue twice in a row plays once", () => {
    let t = 0;
    const gate = createGate(() => t);
    expect(gate("done")).toBe(true);
    t = 100;
    expect(gate("done")).toBe(false);
    t = 400;
    expect(gate("done")).toBe(true);
  });

  test("a burst of different cues is capped", () => {
    const gate = createGate(() => 0);
    const played = (["appear", "start", "done", "needs", "error"] as Cue[]).filter((cue) => gate(cue));
    expect(played).toHaveLength(3);
  });
});

describe("the two looks", () => {
  test("smooth plays clean tones only", () => {
    for (const cue of ["appear", "start", "done", "needs", "error", "complete"] as Cue[]) {
      expect(tonesFor(cue, "smooth").every((tone) => tone.wave === "sine" || tone.wave === "triangle")).toBe(true);
    }
  });

  test("pixel plays the same clean tones, softer, under an 8-bit layer", () => {
    for (const cue of ["appear", "start", "done", "needs", "error", "complete"] as Cue[]) {
      const clean = tonesFor(cue, "smooth");
      const pixel = tonesFor(cue, "pixel");
      const soft = pixel.filter((tone) => tone.wave !== "square");
      expect(soft.map((tone) => tone.freq)).toEqual(clean.map((tone) => tone.freq));
      expect(soft.every((tone, i) => tone.gain === clean[i]!.gain / 2)).toBe(true);
      expect(pixel.some((tone) => tone.wave === "square")).toBe(true);
    }
  });

  test("every cue stays quiet", () => {
    for (const look of ["smooth", "pixel"] as const) {
      for (const cue of ["appear", "start", "done", "needs", "error", "complete"] as Cue[]) {
        expect(Math.max(...tonesFor(cue, look).map((tone) => tone.gain))).toBeLessThanOrEqual(0.07);
      }
    }
  });
});

describe("the audio context", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("wakes up from any state but running, and is made again once closed", () => {
    const made: FakeContext[] = [];
    class FakeContext {
      state = "interrupted";
      currentTime = 0;
      destination = {};
      resumes = 0;
      constructor() {
        made.push(this);
      }
      resume() {
        this.resumes += 1;
        return Promise.resolve();
      }
      createOscillator() {
        return { type: "", frequency: param(), connect: (node: unknown) => node, start() {}, stop() {} };
      }
      createGain() {
        return { gain: param(), connect: (node: unknown) => node };
      }
    }
    const param = () => ({ setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
    vi.stubGlobal("AudioContext", FakeContext);

    play("done", "smooth");
    expect(made).toHaveLength(1);
    expect(made[0]!.resumes).toBe(1);

    made[0]!.state = "running";
    play("done", "smooth");
    expect(made[0]!.resumes).toBe(1);

    made[0]!.state = "closed";
    play("done", "smooth");
    expect(made).toHaveLength(2);
    expect(made[1]!.resumes).toBe(1);
  });

  test("is made again when resuming does not wake it, or when it says running and its clock stopped", () => {
    vi.useFakeTimers();
    const made: FakeContext[] = [];
    class FakeContext {
      state = "running";
      currentTime = 0;
      destination = {};
      closed = 0;
      constructor() {
        made.push(this);
      }
      resume() {
        return Promise.resolve();
      }
      close() {
        this.closed += 1;
        return Promise.resolve();
      }
      createOscillator() {
        return { type: "", frequency: param(), connect: (node: unknown) => node, start() {}, stop() {} };
      }
      createGain() {
        return { gain: param(), connect: (node: unknown) => node };
      }
    }
    const param = () => ({ setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
    vi.stubGlobal("AudioContext", FakeContext);

    // The context left by the test above is interrupted: after a second it is replaced.
    vi.advanceTimersByTime(2000);
    play("done", "smooth");
    const first = made.length;
    expect(first).toBe(1);

    // A healthy clock keeps the context.
    vi.advanceTimersByTime(5000);
    made.at(-1)!.currentTime += 5;
    play("done", "smooth");
    expect(made).toHaveLength(first);

    // The Mac slept: still "running", but the clock stood still.
    vi.advanceTimersByTime(60_000);
    play("done", "smooth");
    expect(made).toHaveLength(first + 1);
    expect(made.at(-2)!.closed).toBe(1);

    // Interrupted, and a resume a second ago did not help.
    made.at(-1)!.state = "interrupted";
    play("done", "smooth");
    expect(made).toHaveLength(first + 1);
    vi.advanceTimersByTime(1500);
    play("done", "smooth");
    expect(made).toHaveLength(first + 2);
    vi.useRealTimers();
  });
});
