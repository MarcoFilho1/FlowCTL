import type { GraphValidationIssue } from "./graph-validation.js";
import { validateTaskGraph } from "./graph-validation.js";
import { areTaskDependenciesCompleted, getIncompleteDependencyIds, getReadyTaskIds } from "./readiness.js";
import { transitionTask } from "./task-state-machine.js";
import type { Task, TaskGraph, TaskStatus } from "@flowctl/protocol";

const coreStateBrand: unique symbol = Symbol("CoreState");

type CoreStateHandle = {
  readonly [coreStateBrand]: "CoreState";
};

export type CoreState = CoreStateHandle;

export type CoreStateResult =
  | { ok: true; state: CoreState }
  | { ok: false; issues: readonly GraphValidationIssue[] };

export type CoreTaskTransitionResult =
  | { ok: true; task: Task }
  | { ok: false; code: "TASK_NOT_FOUND"; taskId: string }
  | {
      ok: false;
      code: "INVALID_TASK_TRANSITION";
      taskId: string;
      from: TaskStatus;
      to: TaskStatus;
    }
  | {
      ok: false;
      code: "DEPENDENCIES_NOT_COMPLETED";
      taskId: string;
      incompleteDependencyIds: readonly string[];
    };

const stateStore = new WeakMap<CoreStateHandle, TaskGraph>();

export function createCoreState(graph: TaskGraph): CoreStateResult {
  const validation = validateTaskGraph(graph);
  if (!validation.valid) {
    return {
      ok: false,
      issues: validation.issues
    };
  }

  const state = { [coreStateBrand]: "CoreState" } as CoreStateHandle;
  stateStore.set(state, cloneTaskGraph(graph));

  return {
    ok: true,
    state
  };
}

export function getTaskGraphSnapshot(state: CoreState): TaskGraph {
  return cloneTaskGraph(getStoredGraph(state));
}

export function applyTaskTransition(
  state: CoreState,
  taskId: string,
  nextStatus: TaskStatus,
  updatedAt: string
): CoreTaskTransitionResult {
  const graph = getStoredGraph(state);
  const task = graph.tasks[taskId];

  if (task === undefined) {
    return {
      ok: false,
      code: "TASK_NOT_FOUND",
      taskId
    };
  }

  const transitionResult = transitionTask(task, nextStatus, updatedAt);
  if (!transitionResult.ok) {
    return {
      ok: false,
      code: "INVALID_TASK_TRANSITION",
      taskId,
      from: transitionResult.from,
      to: transitionResult.to
    };
  }

  if (nextStatus === "ready" && !areTaskDependenciesCompleted(graph, task)) {
    return {
      ok: false,
      code: "DEPENDENCIES_NOT_COMPLETED",
      taskId,
      incompleteDependencyIds: getIncompleteDependencyIds(graph, task)
    };
  }

  graph.tasks[taskId] = transitionResult.task;

  return transitionResult;
}

export function advanceReadyTasks(state: CoreState, updatedAt: string): readonly string[] {
  const graph = getStoredGraph(state);
  const readyTaskIds = getReadyTaskIds(graph);

  for (const taskId of readyTaskIds) {
    const transitionResult = transitionTask(graph.tasks[taskId], "ready", updatedAt);
    if (!transitionResult.ok) {
      continue;
    }

    graph.tasks[taskId] = transitionResult.task;
  }

  return readyTaskIds;
}

function getStoredGraph(state: CoreState): TaskGraph {
  const graph = stateStore.get(state);

  if (graph === undefined) {
    throw new TypeError("Unknown CoreState handle.");
  }

  return graph;
}

function cloneTaskGraph(graph: TaskGraph): TaskGraph {
  return {
    projectId: graph.projectId,
    rootTaskIds: [...graph.rootTaskIds],
    tasks: Object.fromEntries(
      Object.entries(graph.tasks).map(([taskId, task]) => [taskId, cloneTask(task)])
    )
  };
}

function cloneTask(task: Task): Task {
  return {
    ...task,
    dependencies: [...task.dependencies],
    acceptanceCriteria: task.acceptanceCriteria.map((criterion) => ({ ...criterion }))
  };
}
