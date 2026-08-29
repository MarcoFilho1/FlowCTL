import type { TaskGraph, TaskLevel } from "@flowctl/protocol";

export interface GraphValidationResult {
  valid: boolean;
  issues: readonly GraphValidationIssue[];
}

export type GraphValidationIssue =
  | { code: "TASK_KEY_MISMATCH"; taskKey: string; taskId: string }
  | { code: "ROOT_NOT_FOUND"; taskId: string }
  | { code: "DUPLICATE_ROOT"; taskId: string }
  | { code: "ROOT_HAS_PARENT"; taskId: string; parentId: string }
  | { code: "ROOT_NOT_EPIC"; taskId: string; level: TaskLevel }
  | { code: "EPIC_NOT_ROOT"; taskId: string }
  | { code: "EPIC_WITH_PARENT"; taskId: string; parentId: string }
  | { code: "NON_ROOT_WITHOUT_PARENT"; taskId: string; level: TaskLevel }
  | { code: "PARENT_NOT_FOUND"; taskId: string; parentId: string }
  | {
      code: "INVALID_PARENT_LEVEL";
      taskId: string;
      taskLevel: TaskLevel;
      parentId: string;
      parentLevel: TaskLevel;
    }
  | { code: "DEPENDENCY_NOT_FOUND"; taskId: string; dependsOnTaskId: string }
  | { code: "SELF_DEPENDENCY"; taskId: string }
  | { code: "DUPLICATE_DEPENDENCY"; taskId: string; dependsOnTaskId: string }
  | { code: "DEPENDENCY_CYCLE"; taskIds: readonly string[] }
  | { code: "HIERARCHY_CYCLE"; taskIds: readonly string[] };

const ISSUE_PRECEDENCE: Readonly<Record<GraphValidationIssue["code"], number>> = {
  TASK_KEY_MISMATCH: 0,
  ROOT_NOT_FOUND: 1,
  DUPLICATE_ROOT: 2,
  ROOT_HAS_PARENT: 3,
  ROOT_NOT_EPIC: 4,
  EPIC_NOT_ROOT: 5,
  EPIC_WITH_PARENT: 6,
  NON_ROOT_WITHOUT_PARENT: 7,
  PARENT_NOT_FOUND: 8,
  INVALID_PARENT_LEVEL: 9,
  DEPENDENCY_NOT_FOUND: 10,
  SELF_DEPENDENCY: 11,
  DUPLICATE_DEPENDENCY: 12,
  DEPENDENCY_CYCLE: 13,
  HIERARCHY_CYCLE: 14
};

const EXPECTED_PARENT_LEVEL: Readonly<Record<TaskLevel, TaskLevel | undefined>> = {
  epic: undefined,
  task: "epic",
  subtask: "task",
  atomic: "subtask"
};

export function validateTaskGraph(graph: TaskGraph): GraphValidationResult {
  const issues: GraphValidationIssue[] = [];
  const taskKeys = Object.keys(graph.tasks).sort();
  const rootCounts = countValues(graph.rootTaskIds);
  const sortedRootIds = Array.from(rootCounts.keys()).sort();

  for (const taskKey of taskKeys) {
    const task = graph.tasks[taskKey];
    if (task.id !== taskKey) {
      issues.push({ code: "TASK_KEY_MISMATCH", taskKey, taskId: task.id });
    }
  }

  for (const rootId of sortedRootIds) {
    const rootTask = graph.tasks[rootId];

    if (rootTask === undefined) {
      issues.push({ code: "ROOT_NOT_FOUND", taskId: rootId });
    }

    if ((rootCounts.get(rootId) ?? 0) > 1) {
      issues.push({ code: "DUPLICATE_ROOT", taskId: rootId });
    }

    if (rootTask === undefined) {
      continue;
    }

    if (rootTask.parentId !== undefined) {
      issues.push({ code: "ROOT_HAS_PARENT", taskId: rootId, parentId: rootTask.parentId });
    }

    if (rootTask.level !== "epic") {
      issues.push({ code: "ROOT_NOT_EPIC", taskId: rootId, level: rootTask.level });
    }
  }

  for (const taskKey of taskKeys) {
    const task = graph.tasks[taskKey];
    const isRoot = rootCounts.has(taskKey);

    if (task.level === "epic") {
      if (!isRoot) {
        issues.push({ code: "EPIC_NOT_ROOT", taskId: taskKey });
      }

      if (task.parentId !== undefined) {
        issues.push({ code: "EPIC_WITH_PARENT", taskId: taskKey, parentId: task.parentId });
      }
    }

    if (!isRoot && task.level !== "epic" && task.parentId === undefined) {
      issues.push({ code: "NON_ROOT_WITHOUT_PARENT", taskId: taskKey, level: task.level });
    }

    if (task.parentId !== undefined) {
      const parentTask = graph.tasks[task.parentId];

      if (parentTask === undefined) {
        issues.push({ code: "PARENT_NOT_FOUND", taskId: taskKey, parentId: task.parentId });
      } else if (EXPECTED_PARENT_LEVEL[task.level] !== parentTask.level) {
        issues.push({
          code: "INVALID_PARENT_LEVEL",
          taskId: taskKey,
          taskLevel: task.level,
          parentId: task.parentId,
          parentLevel: parentTask.level
        });
      }
    }

    const dependencyCounts = countValues(task.dependencies);
    const dependencyIds = Array.from(dependencyCounts.keys()).sort();

    for (const dependencyId of dependencyIds) {
      if (dependencyId === taskKey) {
        issues.push({ code: "SELF_DEPENDENCY", taskId: taskKey });
      } else if (graph.tasks[dependencyId] === undefined) {
        issues.push({
          code: "DEPENDENCY_NOT_FOUND",
          taskId: taskKey,
          dependsOnTaskId: dependencyId
        });
      }

      if ((dependencyCounts.get(dependencyId) ?? 0) > 1) {
        issues.push({
          code: "DUPLICATE_DEPENDENCY",
          taskId: taskKey,
          dependsOnTaskId: dependencyId
        });
      }
    }
  }

  for (const taskIds of findDependencyCycles(graph, taskKeys)) {
    issues.push({ code: "DEPENDENCY_CYCLE", taskIds });
  }

  for (const taskIds of findHierarchyCycles(graph, taskKeys)) {
    issues.push({ code: "HIERARCHY_CYCLE", taskIds });
  }

  issues.sort(compareIssues);

  return {
    valid: issues.length === 0,
    issues
  };
}

function findDependencyCycles(
  graph: TaskGraph,
  taskKeys: readonly string[]
): readonly (readonly string[])[] {
  return findCycles(taskKeys, (taskKey) => {
    const dependencies = graph.tasks[taskKey]?.dependencies ?? [];

    return Array.from(
      new Set(
        dependencies.filter((dependencyId) => dependencyId !== taskKey && graph.tasks[dependencyId] !== undefined)
      )
    ).sort();
  }, 2);
}

function findHierarchyCycles(
  graph: TaskGraph,
  taskKeys: readonly string[]
): readonly (readonly string[])[] {
  return findCycles(taskKeys, (taskKey) => {
    const parentId = graph.tasks[taskKey]?.parentId;
    return parentId !== undefined && graph.tasks[parentId] !== undefined ? [parentId] : [];
  }, 1);
}

function findCycles(
  taskKeys: readonly string[],
  getNeighbors: (taskKey: string) => readonly string[],
  minDistinctTaskCount: number
): readonly (readonly string[])[] {
  const cycles = new Map<string, readonly string[]>();
  const visited = new Set<string>();
  const path: string[] = [];

  function visit(taskKey: string): void {
    visited.add(taskKey);
    path.push(taskKey);

    for (const neighbor of getNeighbors(taskKey)) {
      const cycleStartIndex = path.indexOf(neighbor);

      if (cycleStartIndex !== -1) {
        const rawCycle = [...path.slice(cycleStartIndex), neighbor];
        const distinctTaskCount = new Set(rawCycle.slice(0, -1)).size;

        if (distinctTaskCount >= minDistinctTaskCount) {
          const normalizedCycle = normalizeCyclePath(rawCycle);
          cycles.set(normalizedCycle.join("\u0000"), normalizedCycle);
        }

        continue;
      }

      if (!visited.has(neighbor)) {
        visit(neighbor);
      }
    }

    path.pop();
  }

  for (const taskKey of taskKeys) {
    if (!visited.has(taskKey)) {
      visit(taskKey);
    }
  }

  return Array.from(cycles.values()).sort(compareCyclePaths);
}

function normalizeCyclePath(taskIds: readonly string[]): readonly string[] {
  const cycle = taskIds.slice(0, -1);
  let bestPath = [...cycle, cycle[0]];
  let bestKey = bestPath.join("\u0000");

  for (let index = 1; index < cycle.length; index += 1) {
    const rotated = cycle.slice(index).concat(cycle.slice(0, index));
    const candidate = [...rotated, rotated[0]];
    const candidateKey = candidate.join("\u0000");

    if (candidateKey < bestKey) {
      bestKey = candidateKey;
      bestPath = candidate;
    }
  }

  return bestPath;
}

function countValues(values: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();

  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return counts;
}

function compareIssues(left: GraphValidationIssue, right: GraphValidationIssue): number {
  const precedenceDifference = ISSUE_PRECEDENCE[left.code] - ISSUE_PRECEDENCE[right.code];

  if (precedenceDifference !== 0) {
    return precedenceDifference;
  }

  switch (left.code) {
    case "TASK_KEY_MISMATCH": {
      const other = right as Extract<GraphValidationIssue, { code: "TASK_KEY_MISMATCH" }>;
      return compareTuples([left.taskKey, left.taskId], [other.taskKey, other.taskId]);
    }
    case "ROOT_NOT_FOUND":
    case "DUPLICATE_ROOT":
    case "EPIC_NOT_ROOT": {
      const other = right as Extract<
        GraphValidationIssue,
        { code: "ROOT_NOT_FOUND" | "DUPLICATE_ROOT" | "EPIC_NOT_ROOT" }
      >;
      return left.taskId.localeCompare(other.taskId);
    }
    case "ROOT_HAS_PARENT":
    case "EPIC_WITH_PARENT":
    case "PARENT_NOT_FOUND": {
      const other = right as Extract<
        GraphValidationIssue,
        { code: "ROOT_HAS_PARENT" | "EPIC_WITH_PARENT" | "PARENT_NOT_FOUND" }
      >;
      return compareTuples([left.taskId, left.parentId], [other.taskId, other.parentId]);
    }
    case "ROOT_NOT_EPIC":
    case "NON_ROOT_WITHOUT_PARENT": {
      const other = right as Extract<
        GraphValidationIssue,
        { code: "ROOT_NOT_EPIC" | "NON_ROOT_WITHOUT_PARENT" }
      >;
      return compareTuples([left.taskId, left.level], [other.taskId, other.level]);
    }
    case "INVALID_PARENT_LEVEL": {
      const other = right as Extract<GraphValidationIssue, { code: "INVALID_PARENT_LEVEL" }>;
      return compareTuples(
        [left.taskId, left.parentId, left.taskLevel, left.parentLevel],
        [other.taskId, other.parentId, other.taskLevel, other.parentLevel]
      );
    }
    case "DEPENDENCY_NOT_FOUND":
    case "DUPLICATE_DEPENDENCY": {
      const other = right as Extract<
        GraphValidationIssue,
        { code: "DEPENDENCY_NOT_FOUND" | "DUPLICATE_DEPENDENCY" }
      >;
      return compareTuples(
        [left.taskId, left.dependsOnTaskId],
        [other.taskId, other.dependsOnTaskId]
      );
    }
    case "SELF_DEPENDENCY": {
      const other = right as Extract<GraphValidationIssue, { code: "SELF_DEPENDENCY" }>;
      return left.taskId.localeCompare(other.taskId);
    }
    case "DEPENDENCY_CYCLE":
    case "HIERARCHY_CYCLE": {
      const other = right as Extract<
        GraphValidationIssue,
        { code: "DEPENDENCY_CYCLE" | "HIERARCHY_CYCLE" }
      >;
      return compareCyclePaths(left.taskIds, other.taskIds);
    }
  }
}

function compareCyclePaths(left: readonly string[], right: readonly string[]): number {
  return compareTuples(left, right);
}

function compareTuples(left: readonly string[], right: readonly string[]): number {
  const length = Math.min(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const difference = left[index]?.localeCompare(right[index] ?? "") ?? 0;
    if (difference !== 0) {
      return difference;
    }
  }

  return left.length - right.length;
}
