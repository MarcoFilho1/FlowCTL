import type { FlowctlEvent } from "@flowctl/protocol";
import { copyEvents } from "./command-copy.js";
import { readControlPlaneState, type ControlPlane } from "./state.js";

export function getEventLogSnapshot(controlPlane: ControlPlane): readonly FlowctlEvent[] {
  return copyEvents(readControlPlaneState(controlPlane).eventLog);
}
