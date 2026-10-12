// A plan whose steps start subagents: each hangs from the step that spawned it
// and shows what it answered when it finishes.

import type { Lang } from "../i18n/index.ts";
import { t } from "../i18n/index.ts";
import { CWD } from "./overlay.ts";
import { opening, plan, type Scene } from "./types.ts";

export function subagentsScene(lang: Lang): Scene {
  const s = (key: Parameters<typeof t>[1]) => t(lang, key);
  return {
    id: "subagents",
    sessionId: "demo-subagents",
    cwd: CWD,
    holdMs: 4000,
    still: 8.0,
    beats: [
      ...opening(CWD, "1", 120),
      [1.5, plan([
        { id: "explore", title: s("scene.sub.explore"), status: "in_progress" },
        { id: "spec", title: s("scene.sub.spec"), status: "pending", blockedBy: ["explore"] },
        { id: "impl", title: s("scene.sub.impl"), status: "pending", blockedBy: ["spec"] },
        { id: "check", title: s("scene.sub.check"), status: "pending", blockedBy: ["impl"] }
      ])],
      [3.0, { event: "agent.spawn", input: { description: s("scene.sub.agentMap") }, result: { agentId: "map" } }],
      [3.8, { event: "agent.spawn", input: { description: s("scene.sub.agentRules") }, result: { agentId: "rules" } }],
      [4.6, { event: "agent.spawn", input: { description: s("scene.sub.agentTests") }, result: { agentId: "tests" } }],
      [7.0, { event: "turn.complete", agentId: "map", input: { summary: s("scene.sub.mapDone") }, result: {} }],
      [6.5, plan([
        { id: "explore", title: s("scene.sub.explore"), status: "completed" },
        { id: "spec", title: s("scene.sub.spec"), status: "in_progress", blockedBy: ["explore"] },
        { id: "impl", title: s("scene.sub.impl"), status: "pending", blockedBy: ["spec"] },
        { id: "check", title: s("scene.sub.check"), status: "pending", blockedBy: ["impl"] }
      ])],
      [8.2, { event: "turn.complete", agentId: "rules", input: { summary: s("scene.sub.rulesDone") }, result: {} }],
      [9.2, { event: "turn.complete", agentId: "tests", input: { summary: s("scene.sub.testsDone") }, result: {} }],
      [8.5, plan([
        { id: "spec", title: s("scene.sub.spec"), status: "completed", blockedBy: ["explore"] },
        { id: "impl", title: s("scene.sub.impl"), status: "in_progress", blockedBy: ["spec"] },
        { id: "check", title: s("scene.sub.check"), status: "pending", blockedBy: ["impl"] }
      ])],
      [10.0, plan([
        { id: "impl", title: s("scene.sub.impl"), status: "completed", blockedBy: ["spec"] },
        { id: "check", title: s("scene.sub.check"), status: "in_progress", blockedBy: ["impl"] }
      ])],
      [11.5, plan([{ id: "check", title: s("scene.sub.check"), status: "completed", blockedBy: ["impl"] }])],
      [12.0, { event: "turn.complete", input: { reason: "answer" }, result: { agents: [] } }]
    ]
  };
}
