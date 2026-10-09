import { expect, test } from "claude-code/testing";

// Phase 0: the mod loads beside the engine and leaves the session's own events untouched.
test("the mod loads and lets session events through", async ($, on) => {
  on("classic.SessionStart", () => ({}));
  await expect($.classic.SessionStart({ source: "startup" })).resolves.toEqual({});
});
