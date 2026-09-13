import { statSync } from "node:fs";
import { isAbsolute } from "node:path";

export type WorkspaceValidationResult =
  | { ok: true; reason?: never }
  | {
      ok: false;
      reason: "NOT_ABSOLUTE" | "NOT_FOUND" | "NOT_DIRECTORY";
    };

export function validateWorkspacePath(
  workspacePath: string
): WorkspaceValidationResult {
  if (!isAbsolute(workspacePath)) {
    return { ok: false, reason: "NOT_ABSOLUTE" };
  }

  let workspaceStat;
  try {
    workspaceStat = statSync(workspacePath);
  } catch {
    return { ok: false, reason: "NOT_FOUND" };
  }

  if (!workspaceStat.isDirectory()) {
    return { ok: false, reason: "NOT_DIRECTORY" };
  }

  return { ok: true };
}
