// A quick answer, then nothing: after a short rest the nodes form their shape
// (the real overlay waits a minute; the demo waits a few seconds).

import type { Lang } from "../i18n/index.ts";
import { t } from "../i18n/index.ts";
import { CWD } from "./overlay.ts";
import { opening, plan, type Scene } from "./types.ts";

export function idleScene(lang: Lang): Scene {
  const s = (key: Parameters<typeof t>[1]) => t(lang, key);
  return {
    id: "idle",
    sessionId: "demo-idle",
    cwd: CWD,
    dreamAt: 6.0,
    holdMs: 14000,
    still: 4.0,
    beats: [
      ...opening(CWD, "1", 30),
      [1.2, plan([
        { id: "read", title: s("scene.idle.read"), status: "in_progress" },
        { id: "answer", title: s("scene.idle.answer"), status: "pending", blockedBy: ["read"] }
      ])],
      [2.6, plan([
        { id: "read", title: s("scene.idle.read"), status: "completed" },
        { id: "answer", title: s("scene.idle.answer"), status: "in_progress", blockedBy: ["read"] }
      ])],
      [3.8, plan([{ id: "answer", title: s("scene.idle.answer"), status: "completed", blockedBy: ["read"] }])],
      [4.0, { event: "turn.complete", input: { reason: "answer", summary: s("scene.idle.done") }, result: { agents: [] } }]
    ]
  };
}
