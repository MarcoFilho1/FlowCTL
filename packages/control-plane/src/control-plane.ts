import { createCoreState, getTaskGraphSnapshot as getCoreTaskGraphSnapshot } from "@flowctl/core";
import type { TaskGraph } from "@flowctl/protocol";
import type { ControlPlaneCreationResult, ControlPlaneOptions } from "./results.js";
import {
  createControlPlaneHandle,
  readControlPlaneState,
  type ControlPlane
} from "./state.js";

export function createControlPlane(
  graph: TaskGraph,
  options: ControlPlaneOptions
): ControlPlaneCreationResult {
  const coreStateResult = createCoreState(graph);

  if (!coreStateResult.ok) {
    return {
      ok: false,
      code: "INVALID_GRAPH",
      issues: coreStateResult.issues
    };
  }

  return {
    ok: true,
    controlPlane: createControlPlaneHandle({
      projectId: graph.projectId,
      coreState: coreStateResult.state,
      activeLeaseByTaskId: new Map(),
      eventLog: [],
      options
    })
  };
}

export function getTaskGraphSnapshot(controlPlane: ControlPlane): TaskGraph {
  return getCoreTaskGraphSnapshot(readControlPlaneState(controlPlane).coreState);
}
