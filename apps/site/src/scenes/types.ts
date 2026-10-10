// A scene is a script: what the engine (the mod's reducer) is told, and when.
// Pure data, so the same scene drives the live page and the launch video.

import { FLOWPLAN_TOOL } from "../../../../mod/graph/reduce.ts";
import type { GraphEvent } from "../../../../mod/graph/types.ts";

/** One engine event at a time in seconds from the start of the scene (`t` is added by the engine). */
export type Beat = [seconds: number, event: Omit<GraphEvent, "t">];

export type SceneId = "overlay" | "subagents" | "followup" | "idle";

export interface Scene {
  id: SceneId;
  sessionId: string;
  cwd: string;
  beats: Beat[];
  /** Seconds from the start when the idle animation starts; absent when the scene never rests long enough. */
  dreamAt?: number;
  /** Milliseconds after the last beat before the scene starts over. */
  holdMs: number;
  /** Seconds of the frame shown still when motion is reduced: the one that says the most. */
  still: number;
}

export interface PlanStep {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "completed";
  blockedBy?: string[];
}

/** The agent declaring its plan with FlowCTL's own tool, as the mod receives it. */
export function plan(steps: PlanStep[]): Omit<GraphEvent, "t"> {
  return { event: "tool.call", input: { tool: FLOWPLAN_TOOL, steps }, result: { result: [] } };
}

/** The first beats every scene shares: a session starts, a prompt is sent, its turn begins. */
export function opening(cwd: string, turnId: string, chars: number): Beat[] {
  return [
    [0.3, { event: "session.start", input: { cwd } }],
    [0.4, { event: "prompt.submit", input: { chars } }],
    [0.5, { event: "turn.start", input: { turnId } }]
  ];
}
