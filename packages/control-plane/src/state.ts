import type { CoreState } from "@flowctl/core";
import type { FlowctlEvent, Lease } from "@flowctl/protocol";
import type { ControlPlaneOptions } from "./results.js";

const controlPlaneBrand: unique symbol = Symbol("ControlPlane");

export type ControlPlane = {
  readonly [controlPlaneBrand]: "ControlPlane";
};

export interface ControlPlaneState {
  readonly projectId: string;
  readonly coreState: CoreState;
  readonly activeLeaseByTaskId: Map<string, Lease>;
  readonly eventLog: FlowctlEvent[];
  readonly options: ControlPlaneOptions;
}

const stateStore = new WeakMap<ControlPlane, ControlPlaneState>();

export function createControlPlaneHandle(state: ControlPlaneState): ControlPlane {
  const controlPlane = { [controlPlaneBrand]: "ControlPlane" } as ControlPlane;
  stateStore.set(controlPlane, state);
  return controlPlane;
}

export function readControlPlaneState(controlPlane: ControlPlane): ControlPlaneState {
  const state = stateStore.get(controlPlane);

  if (state === undefined) {
    throw new TypeError("Unknown ControlPlane handle.");
  }

  return state;
}

export function replaceControlPlaneState(
  controlPlane: ControlPlane,
  state: ControlPlaneState
): void {
  if (!stateStore.has(controlPlane)) {
    throw new TypeError("Unknown ControlPlane handle.");
  }

  stateStore.set(controlPlane, state);
}
