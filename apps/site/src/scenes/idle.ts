// A session of nine steps finishes, then rests: the nodes form their shape
// (the real overlay waits a minute; the demo waits a few seconds). A graph this
// size gives the shape enough points to read.

import type { Lang } from "../i18n/index.ts";
import { t } from "../i18n/index.ts";
import { CWD } from "./overlay.ts";
import { opening, plan, type PlanStep, type Scene } from "./types.ts";

type Status = PlanStep["status"];

/** The nine steps and what each waits on. */
const STEPS: Array<{ id: string; blockedBy: string[] }> = [
  { id: "s1", blockedBy: [] },
  { id: "s2", blockedBy: ["s1"] },
  { id: "s3", blockedBy: ["s1"] },
  { id: "s4", blockedBy: ["s3"] },
  { id: "s5", blockedBy: ["s2"] },
  { id: "s6", blockedBy: ["s4", "s5"] },
  { id: "s7", blockedBy: ["s6"] },
  { id: "s8", blockedBy: ["s7"] },
  { id: "s9", blockedBy: ["s8"] }
];

/** The whole plan with the given statuses; the steps not named are pending. */
function planWith(lang: Lang, statuses: Record<string, Status>): PlanStep[] {
  return STEPS.map(({ id, blockedBy }) => ({
    id,
    title: t(lang, `scene.idle.${id}` as "scene.idle.s1"),
    status: statuses[id] ?? "pending",
    blockedBy
  }));
}

export function idleScene(lang: Lang): Scene {
  return {
    id: "idle",
    sessionId: "demo-idle",
    cwd: CWD,
    dreamAt: 10.6,
    holdMs: 14000,
    still: 8.6,
    beats: [
      ...opening(CWD, "1", 30),
      [1.2, plan(planWith(lang, { s1: "in_progress" }))],
      [2.4, plan(planWith(lang, { s1: "completed", s2: "in_progress", s3: "in_progress" }))],
      [3.6, plan(planWith(lang, { s1: "completed", s2: "completed", s3: "completed", s4: "in_progress", s5: "in_progress" }))],
      [4.8, plan(planWith(lang, { s1: "completed", s2: "completed", s3: "completed", s4: "completed", s5: "completed", s6: "in_progress" }))],
      [5.8, plan(planWith(lang, { s1: "completed", s2: "completed", s3: "completed", s4: "completed", s5: "completed", s6: "completed", s7: "in_progress" }))],
      [6.6, plan(planWith(lang, { s1: "completed", s2: "completed", s3: "completed", s4: "completed", s5: "completed", s6: "completed", s7: "completed", s8: "in_progress" }))],
      [7.4, plan(planWith(lang, { s1: "completed", s2: "completed", s3: "completed", s4: "completed", s5: "completed", s6: "completed", s7: "completed", s8: "completed", s9: "in_progress" }))],
      [8.2, plan(planWith(lang, Object.fromEntries(STEPS.map(({ id }) => [id, "completed" as Status]))))],
      [8.6, { event: "turn.complete", input: { reason: "answer", summary: t(lang, "scene.idle.done") }, result: { agents: [] } }]
    ]
  };
}
