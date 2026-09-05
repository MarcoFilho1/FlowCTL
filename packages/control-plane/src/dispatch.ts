import type { FlowctlCommand } from "@flowctl/protocol";
import { dispatchClaimCommand } from "./claim.js";
import { dispatchCompleteCommand } from "./complete.js";
import { dispatchStartCommand } from "./start.js";
import type { CommandProcessingResult } from "./results.js";
import { readControlPlaneState, type ControlPlane } from "./state.js";

type SupportedCommand = Extract<
  FlowctlCommand,
  { type: "task.claim" | "task.start" | "task.complete" }
>;

function isSupportedCommand(command: FlowctlCommand): command is SupportedCommand {
  return command.type === "task.claim"
    || command.type === "task.start"
    || command.type === "task.complete";
}

function assertNever(value: never): never {
  throw new Error(`Unexpected command: ${String(value)}`);
}

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

  if (!isSupportedCommand(command)) {
    return {
      ok: false,
      code: "UNSUPPORTED_COMMAND",
      commandId: command.id,
      commandType: command.type
    };
  }

  switch (command.type) {
    case "task.claim":
      return dispatchClaimCommand(controlPlane, command);
    case "task.start":
      return dispatchStartCommand(controlPlane, command);
    case "task.complete":
      return dispatchCompleteCommand(controlPlane, command);
    default:
      return assertNever(command);
  }
}
