// The overlay at work: parallel steps, a subagent, a permission prompt that
// turns a step yellow, a failing test that flashes red, and everything green.

import type { Lang } from "../i18n/index.ts";
import { t } from "../i18n/index.ts";
import { opening, plan, type Scene } from "./types.ts";

export const CWD = "/Users/you/projects/shop";

export function overlayScene(lang: Lang): Scene {
  const s = (key: Parameters<typeof t>[1]) => t(lang, key);
  return {
    id: "overlay",
    sessionId: "demo-overlay",
    cwd: CWD,
    holdMs: 4000,
    still: 6.5,
    beats: [
      ...opening(CWD, "1", 80),
      [1.6, plan([
        { id: "read", title: s("scene.overlay.read"), status: "in_progress" },
        { id: "api", title: s("scene.overlay.api"), status: "pending", blockedBy: ["read"] },
        { id: "ui", title: s("scene.overlay.ui"), status: "pending", blockedBy: ["read"] },
        { id: "tests", title: s("scene.overlay.tests"), status: "pending", blockedBy: ["api", "ui"] },
        { id: "docs", title: s("scene.overlay.docs"), status: "pending", blockedBy: ["tests"] }
      ])],
      [3.4, plan([
        { id: "read", title: s("scene.overlay.read"), status: "completed" },
        { id: "api", title: s("scene.overlay.api"), status: "in_progress", blockedBy: ["read"] },
        { id: "ui", title: s("scene.overlay.ui"), status: "in_progress", blockedBy: ["read"] }
      ])],
      [4.2, { event: "agent.spawn", input: { description: s("scene.overlay.agent") }, result: { agentId: "coupon" } }],
      [5.8, { event: "tool.check", input: { tool: "Bash" }, result: { decision: "ask", reason: s("scene.overlay.permission") } }],
      [5.85, { event: "classic.PermissionRequest", input: { tool_name: "Bash" } }],
      [8.6, { event: "tool.call", input: { tool: "Bash" }, result: {} }],
      [10.0, plan([{ id: "api", title: s("scene.overlay.api"), status: "completed" }])],
      [11.0, { event: "turn.complete", agentId: "coupon", input: { summary: s("scene.overlay.agentDone") }, result: {} }],
      [11.1, plan([
        { id: "ui", title: s("scene.overlay.ui"), status: "completed" },
        { id: "tests", title: s("scene.overlay.tests"), status: "in_progress", blockedBy: ["api", "ui"] }
      ])],
      [12.4, { event: "tool.call", input: { tool: "Bash" }, result: { isError: true, text: s("scene.overlay.error") } }],
      [13.4, { event: "classic.PostToolBatch", input: {} }],
      [14.4, plan([
        { id: "tests", title: s("scene.overlay.tests"), status: "completed", blockedBy: ["api", "ui"] },
        { id: "docs", title: s("scene.overlay.docs"), status: "in_progress", blockedBy: ["tests"] }
      ])],
      [16.0, plan([{ id: "docs", title: s("scene.overlay.docs"), status: "completed", blockedBy: ["tests"] }])],
      [16.4, { event: "turn.complete", input: { reason: "answer", summary: s("scene.overlay.done") }, result: { agents: [] } }]
    ]
  };
}
