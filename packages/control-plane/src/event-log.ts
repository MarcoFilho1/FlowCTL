import type { FlowctlEvent } from "@flowctl/protocol";
import { readControlPlaneState, type ControlPlane } from "./state.js";

export function getEventLogSnapshot(controlPlane: ControlPlane): readonly FlowctlEvent[] {
  return [...readControlPlaneState(controlPlane).eventLog];
}
