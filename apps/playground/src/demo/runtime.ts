import {
  createControlPlane,
  dispatchCommand,
  getEventLogSnapshot,
  getTaskGraphSnapshot,
  selectReadyTaskIds
} from "@flowctl/control-plane";
import type {
  CommandProcessingResult,
  ControlPlane
} from "@flowctl/control-plane";
import type { FlowctlCommand, FlowctlEvent, TaskGraph } from "@flowctl/protocol";
import { getMaterializedReadyTaskIds } from "../model/graph-projection.js";
import { createDemoControlPlaneOptions } from "./control-plane.js";
import { createDemoTaskGraph } from "./fixture.js";

export type PlaygroundSnapshot = Readonly<{
  graph: TaskGraph;
  events: readonly FlowctlEvent[];
  readyTaskIds: readonly string[];
  candidateTaskIds: readonly string[];
  lastResult: CommandProcessingResult | null;
}>;

export type DemoRuntime = Readonly<{
  controlPlane: ControlPlane;
  nextCommandId(): string;
}>;

export function createDemoRuntime(): DemoRuntime {
  const created = createControlPlane(
    createDemoTaskGraph(),
    createDemoControlPlaneOptions()
  );

  if (!created.ok) {
    throw new Error("Invariant violation: the demo graph is invalid.");
  }

  let commandCounter = 0;

  return {
    controlPlane: created.controlPlane,
    nextCommandId: () => `demo-command-${++commandCounter}`
  };
}

export function getPlaygroundSnapshot(
  runtime: DemoRuntime,
  schedulerLimit: number,
  lastResult: CommandProcessingResult | null
): PlaygroundSnapshot {
  const graph = getTaskGraphSnapshot(runtime.controlPlane);
  const events = getEventLogSnapshot(runtime.controlPlane);
  const readyTaskIds = getMaterializedReadyTaskIds(graph);
  const candidateTaskIds = selectReadyTaskIds(graph, { limit: schedulerLimit });

  return structuredClone({
    graph,
    events,
    readyTaskIds,
    candidateTaskIds,
    lastResult
  });
}

export function dispatchAndSync(
  runtime: DemoRuntime,
  command: FlowctlCommand,
  schedulerLimit: number
): { result: CommandProcessingResult; snapshot: PlaygroundSnapshot } {
  const result = structuredClone(dispatchCommand(runtime.controlPlane, command));
  const snapshot = getPlaygroundSnapshot(runtime, schedulerLimit, result);

  return { result, snapshot };
}
