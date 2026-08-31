import type { FlowctlCommand } from "@flowctl/protocol";
import { dispatchClaimCommand } from "./claim.js";
import { dispatchStartCommand } from "./start.js";
import type { CommandProcessingResult } from "./results.js";
import { readControlPlaneState, type ControlPlane } from "./state.js";

export function dispatchCommand(
  controlPlane: ControlPlane,
  command: FlowctlCommand
): CommandProcessingResult {
  const state = readControlPlaneState(controlPlane);

  if (command.projectId !== state.projectId) {
    return {
      ok: false,
      code: "PROJECT_MISMATCH",
      commandId: command.id,
      commandProjectId: command.projectId,
      controlPlaneProjectId: state.projectId
    };
  }

  switch (command.type) {
    case "task.claim":
      return dispatchClaimCommand(controlPlane, command);
    case "task.start":
      return dispatchStartCommand(controlPlane, command);
    default:
      return {
        ok: false,
        code: "UNSUPPORTED_COMMAND",
        commandId: command.id,
        commandType: command.type
      };
  }
}
