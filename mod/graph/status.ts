// Color rules: which of the five statuses a node shows, and which tool errors
// count against it. Pure, no engine calls.

import type { Attention, NodeStatus } from "./types.ts";

/** A node's own progress, before attention is laid over it. */
export type BaseStatus = "pending" | "in_progress" | "completed";

/** Consecutive tool errors in one loop that turn its current node red. */
export const DEFAULT_ERROR_THRESHOLD = 3;

/**
 * What a node shows. Done wins (a finished node needs nothing), then error,
 * then needs-you, then its own progress. A paused node (the turn ended, or
 * was aborted with Esc, while it ran) shows as pending: stopping is not failing.
 */
export function displayStatus(base: BaseStatus, attention?: Attention, paused = false): NodeStatus {
  if (base === "completed") {
    return "done";
  }
  if (attention?.kind === "error") {
    return "error";
  }
  if (attention !== undefined) {
    return "needs_you";
  }
  if (base === "in_progress") {
    return paused ? "pending" : "running";
  }
  return "pending";
}

/**
 * Whether a failed tool call is the person stopping it (a denied permission,
 * Esc) rather than the work failing. Those never count toward red.
 */
export function isStoppedByUser(text: string | undefined): boolean {
  if (text === undefined) {
    return false;
  }
  return (
    text.startsWith("The user doesn't want to proceed") ||
    text.includes("Request interrupted by user") ||
    text.includes("The tool use was rejected")
  );
}

/** The first line of an error, short enough for a label. */
export function errorDetail(text: string | undefined): string {
  const line = (text ?? "tool error").split("\n", 1)[0] ?? "tool error";
  return line.length > 120 ? `${line.slice(0, 119)}…` : line;
}
