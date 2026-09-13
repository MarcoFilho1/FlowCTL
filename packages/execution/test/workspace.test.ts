import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { validateWorkspacePath } from "../src/workspace.js";

test("classifies workspace paths by absolute directory availability", () => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "flowctl-execution-"));
  const tempFile = join(tempDirectory, "file.txt");
  writeFileSync(tempFile, "not a workspace");

  try {
    assert.equal(validateWorkspacePath("relative/path").reason, "NOT_ABSOLUTE");
    assert.equal(
      validateWorkspacePath("/path/that/does/not/exist").reason,
      "NOT_FOUND"
    );
    assert.equal(validateWorkspacePath(tempFile).reason, "NOT_DIRECTORY");
    assert.equal(validateWorkspacePath(tempDirectory).ok, true);
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true });
  }
});
