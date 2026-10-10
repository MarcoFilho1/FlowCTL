// A second request continues the graph: its steps land to the right of the
// first request's, linked to the last steps it came after.

import type { Lang } from "../i18n/index.ts";
import { t } from "../i18n/index.ts";
import { CWD } from "./overlay.ts";
import { opening, plan, type Scene } from "./types.ts";

export function followupScene(lang: Lang): Scene {
  const s = (key: Parameters<typeof t>[1]) => t(lang, key);
  return {
    id: "followup",
    sessionId: "demo-followup",
    cwd: CWD,
    holdMs: 4000,
    still: 12.8,
    beats: [
      ...opening(CWD, "1", 60),
      [1.4, plan([
        { id: "read", title: s("scene.fu.read"), status: "in_progress" },
        { id: "code", title: s("scene.fu.code"), status: "pending", blockedBy: ["read"] },
        { id: "tests", title: s("scene.fu.tests"), status: "pending", blockedBy: ["code"] }
      ])],
      [3.2, plan([
        { id: "read", title: s("scene.fu.read"), status: "completed" },
        { id: "code", title: s("scene.fu.code"), status: "in_progress", blockedBy: ["read"] },
        { id: "tests", title: s("scene.fu.tests"), status: "pending", blockedBy: ["code"] }
      ])],
      [5.0, plan([
        { id: "code", title: s("scene.fu.code"), status: "completed", blockedBy: ["read"] },
        { id: "tests", title: s("scene.fu.tests"), status: "in_progress", blockedBy: ["code"] }
      ])],
      [6.8, plan([{ id: "tests", title: s("scene.fu.tests"), status: "completed", blockedBy: ["code"] }])],
      [7.2, { event: "turn.complete", input: { reason: "answer", summary: s("scene.fu.turn1") }, result: { agents: [] } }],
      [9.5, { event: "prompt.submit", input: { chars: 50 } }],
      [9.6, { event: "turn.start", input: { turnId: "2" } }],
      [10.6, plan([
        { id: "expire", title: s("scene.fu.expire"), status: "in_progress" },
        { id: "expireTests", title: s("scene.fu.expireTests"), status: "pending", blockedBy: ["expire"] },
        { id: "changelog", title: s("scene.fu.changelog"), status: "pending", blockedBy: ["expireTests"] }
      ])],
      [12.8, plan([
        { id: "expire", title: s("scene.fu.expire"), status: "completed" },
        { id: "expireTests", title: s("scene.fu.expireTests"), status: "in_progress", blockedBy: ["expire"] },
        { id: "changelog", title: s("scene.fu.changelog"), status: "pending", blockedBy: ["expireTests"] }
      ])],
      [14.6, plan([
        { id: "expireTests", title: s("scene.fu.expireTests"), status: "completed", blockedBy: ["expire"] },
        { id: "changelog", title: s("scene.fu.changelog"), status: "in_progress", blockedBy: ["expireTests"] }
      ])],
      [16.6, plan([{ id: "changelog", title: s("scene.fu.changelog"), status: "completed", blockedBy: ["expireTests"] }])],
      [17.0, { event: "turn.complete", input: { reason: "answer", summary: s("scene.fu.turn2") }, result: { agents: [] } }]
    ]
  };
}
