import type { Register } from "claude-code";

// Phase 0 skeleton: loads and observes nothing yet. Events are wired in Phase 1.
export const register: Register = (on) => {
  on("session.start", ($, e, next) => next(e));
};
