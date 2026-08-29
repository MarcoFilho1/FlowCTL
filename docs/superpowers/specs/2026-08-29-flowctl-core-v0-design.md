# FlowCTL Core v0 Design

## Status

This document defines the architecture for Incremento #2. The FlowCTL
Protocol v0 is frozen for the MVP and is the authoritative input contract.
This document does not authorize implementation of any later subsystem.

## Context

`@flowctl/protocol` defines declarative entities and envelopes for FlowCTL. It
does not validate graphs, enforce task lifecycles, calculate readiness, or own
mutable execution state. `@flowctl/core` will provide the first controlled
behavior over those contracts while remaining small, deterministic, and
independent of execution infrastructure.

The Core consumes the public types from `@flowctl/protocol`. It must not
redeclare `Task`, `TaskGraph`, `TaskStatus`, `TaskLevel`, `Worker`, `Lease`, or
any other Protocol domain type.

## Goals and boundaries

Core v0 will implement only:

- structural validation of `TaskGraph`;
- strict hierarchy validation;
- parent and dependency reference validation;
- dependency-cycle and hierarchy-cycle detection;
- the lifecycle relation for `TaskStatus`;
- readiness calculation based exclusively on dependencies;
- a small, controlled, in-memory state owner;
- pure functions for validation, readiness, and task transitions;
- tests for the contracts and behavior listed in this document.

The only production dependency of `@flowctl/core` will be the workspace
package `@flowctl/protocol`. Core v0 will use TypeScript strict mode and the
Node.js built-in `node:test` runner, consistent with the repository foundation.

Core v0 will not modify the Protocol package or add fields to Protocol
contracts. A Protocol change would require a separately approved design
decision if an incompatibility is discovered during implementation.

## Repository structure

The package will be added as follows:

```text
packages/core/
├── src/
│   ├── graph-validation.ts
│   ├── readiness.ts
│   ├── task-state-machine.ts
│   ├── core-state.ts
│   └── index.ts
├── test/
│   └── core.test.ts
├── package.json
└── tsconfig.json
```

`index.ts` is the public facade. Internal Core modules may import directly
from one another where needed, but consumers import Core APIs through the
facade. Core source modules import Protocol contracts directly from
`@flowctl/protocol`.

No `apps/`, `adapters/`, worker implementation, persistence layer, or
execution-service structure will be created for this increment.

## Design principles

### Protocol types are the domain source of truth

The Core defines behavior-specific result types and issue types, but it does
not copy or shadow Protocol entities. A `TaskGraph` received by Core remains a
Protocol `TaskGraph`; a task returned by Core remains a Protocol `Task`.

### Pure behavior is separated from ownership of state

The following operations are pure:

- `validateTaskGraph`;
- `isTaskTransitionAllowed`;
- `transitionTask`;
- `getReadyTaskIds`.

The following operations own or mutate the internal in-memory state:

- `createCoreState`;
- `applyTaskTransition`;
- `advanceReadyTasks`.

Pure functions do not mutate their graph or task arguments. State functions are
the only supported path for changing the graph held by a `CoreState`.

### No implicit execution policy

Core v0 does not choose workers, acquire or expire leases, interpret actors,
authorize commands, emit events, or run work. In particular, a lifecycle
transition does not itself prove that a worker or lease is valid. Those
policies belong to later Core increments or other components.

## Strict task hierarchy

The hierarchy is strictly:

```text
epic -> task -> subtask -> atomic
```

The following invariants are enforced by graph validation:

| Task level | Parent rule | Root rule |
| --- | --- | --- |
| `epic` | no `parentId` | must be in `rootTaskIds` |
| `task` | required parent with level `epic` | cannot be a root |
| `subtask` | required parent with level `task` | cannot be a root |
| `atomic` | required parent with level `subtask` | cannot be a root |

`rootTaskIds` must exactly equal the set of tasks without `parentId`.
Therefore:

- every root must exist;
- roots cannot be repeated;
- every root must be an `epic`;
- every `epic` must be listed as a root;
- `task`, `subtask`, and `atomic` cannot be roots;
- every non-`epic` task must have a parent;
- an `epic` cannot have a parent;
- every parent reference must resolve to an existing task;
- every resolved parent must have the level required by the child.

Hierarchy edges and dependency edges are independent. A dependency may cross
branches, and a parent relationship does not imply an execution dependency.

### Canonical task identity

Within a `TaskGraph`, the keys of `graph.tasks` are the canonical task
identity used for every graph lookup. This applies to:

- `rootTaskIds`;
- `parentId`;
- `dependencies`.

Every task's `task.id` must equal the key under which it is stored. A mismatch
produces `TASK_KEY_MISMATCH`. The validator must never use `task.id` as an
alternate lookup key and must not normalize, re-key, or repair the graph.

For example, when `graph.tasks["T1"].id === "WRONG"`, validation reports
`TASK_KEY_MISMATCH`. A dependency on `"WRONG"` still produces
`DEPENDENCY_NOT_FOUND` when there is no `graph.tasks["WRONG"]` key, even if a
task stored under another key has `id === "WRONG"`.

## Graph validation

### Public API

The primary public API is:

```ts
validateTaskGraph(graph: TaskGraph): GraphValidationResult
```

The function is pure, reports all detectable issues, does not mutate the
input, and never repairs or normalizes the graph.

The result is behavior-specific Core data:

```ts
interface GraphValidationResult {
  valid: boolean;
  issues: readonly GraphValidationIssue[];
}
```

`valid` is `true` exactly when `issues` is empty.

### Structured issues

`GraphValidationIssue` is a discriminated union. Each issue has a stable
`code` and fields identifying the invalid relationship. The initial issue set
is:

```ts
type GraphValidationIssue =
  | {
      code: "TASK_KEY_MISMATCH";
      taskKey: string;
      taskId: string;
    }
  | {
      code: "ROOT_NOT_FOUND";
      taskId: string;
    }
  | {
      code: "DUPLICATE_ROOT";
      taskId: string;
    }
  | {
      code: "ROOT_HAS_PARENT";
      taskId: string;
      parentId: string;
    }
  | {
      code: "ROOT_NOT_EPIC";
      taskId: string;
      level: TaskLevel;
    }
  | {
      code: "EPIC_NOT_ROOT";
      taskId: string;
    }
  | {
      code: "EPIC_WITH_PARENT";
      taskId: string;
      parentId: string;
    }
  | {
      code: "NON_ROOT_WITHOUT_PARENT";
      taskId: string;
      level: TaskLevel;
    }
  | {
      code: "PARENT_NOT_FOUND";
      taskId: string;
      parentId: string;
    }
  | {
      code: "INVALID_PARENT_LEVEL";
      taskId: string;
      taskLevel: TaskLevel;
      parentId: string;
      parentLevel: TaskLevel;
    }
  | {
      code: "DEPENDENCY_NOT_FOUND";
      taskId: string;
      dependsOnTaskId: string;
    }
  | {
      code: "SELF_DEPENDENCY";
      taskId: string;
    }
  | {
      code: "DUPLICATE_DEPENDENCY";
      taskId: string;
      dependsOnTaskId: string;
    }
  | {
      code: "DEPENDENCY_CYCLE";
      taskIds: readonly string[];
    }
  | {
      code: "HIERARCHY_CYCLE";
      taskIds: readonly string[];
    };
```

The exact TypeScript declaration may use imported `TaskLevel` directly and
may expose these types through `index.ts`, but the fields and discriminants
must remain equivalent. Free-form messages may be added for diagnostics, but
messages are not the contract used by tests or consumers.

The validator will detect at least:

- a task-map key different from `task.id`;
- a missing root;
- a duplicate root;
- a root with a parent;
- a root whose level is not `epic`;
- an `epic` missing from `rootTaskIds`;
- an `epic` with a parent;
- a non-root task without a parent;
- a missing parent;
- an invalid parent/child level pair;
- a missing dependency target;
- a self-dependency;
- a duplicated dependency edge;
- a dependency cycle;
- a hierarchy cycle.

### Cycle detection

Cycle helpers may remain private to `graph-validation.ts` or a private helper
module. Core v0 does not freeze an independent public return contract such as
`readonly string[][]` for cycle detection.

Validation may include a cycle path in the issue's `taskIds` field. The path
will identify the participating tasks and repeat the first task at the end
when that makes the cycle explicit. Missing references are reported as their
own issues and are skipped by cycle traversal; they must not cause an
uncaught exception.

Hierarchy-cycle detection follows `parentId` edges. Dependency-cycle
detection follows `task.dependencies` edges in the direction “current task
depends on target task.” Both are directed graph checks.

A self-edge is diagnosed only as `SELF_DEPENDENCY` and is excluded from cycle
traversal. For example, `T1.dependencies = ["T1"]` must not also produce a
`DEPENDENCY_CYCLE` issue. A `DEPENDENCY_CYCLE` issue represents a cycle with
at least two distinct canonical task keys. This rule does not change
hierarchy-cycle detection.

Issue production is deterministic: task IDs are processed in ascending ID
order, and cycle paths use a stable traversal order. Issue codes have this
fixed precedence, which is an internal ordering rule rather than a public API:

1. `TASK_KEY_MISMATCH`
2. `ROOT_NOT_FOUND`
3. `DUPLICATE_ROOT`
4. `ROOT_HAS_PARENT`
5. `ROOT_NOT_EPIC`
6. `EPIC_NOT_ROOT`
7. `EPIC_WITH_PARENT`
8. `NON_ROOT_WITHOUT_PARENT`
9. `PARENT_NOT_FOUND`
10. `INVALID_PARENT_LEVEL`
11. `DEPENDENCY_NOT_FOUND`
12. `SELF_DEPENDENCY`
13. `DUPLICATE_DEPENDENCY`
14. `DEPENDENCY_CYCLE`
15. `HIERARCHY_CYCLE`

The validator sorts issues by this precedence first. Within one code, it
sorts the relevant canonical identifiers lexicographically: `taskKey` then
`taskId` for `TASK_KEY_MISMATCH`, `taskId` then the related ID for parent or
dependency issues, and the complete canonical cycle path for cycle issues.
Cycle paths retain the stable traversal rule defined above. The validator may
report multiple issues for one malformed task when those are independently
true.

The validator does not validate task titles, descriptions, acceptance-criteria
content, timestamps, worker state, lease timestamps, actor identity, or command
authorization. Those are outside structural graph validation.

## Task state machine

### Lifecycle relation

The allowed lifecycle transitions are:

```text
pending   -> ready | cancelled
ready     -> claimed | cancelled
claimed   -> running | ready | blocked | failed | cancelled
running   -> review | blocked | failed | cancelled
blocked   -> ready | cancelled
review    -> running | completed | cancelled
completed -> terminal
failed    -> terminal
cancelled -> terminal
```

`review -> running` represents rework after review. Core v0 does not implement
retry from `failed`; `failed` is terminal in this lifecycle. `completed`,
`failed`, and `cancelled` have no outgoing transitions.

The pure lifecycle query is:

```ts
isTaskTransitionAllowed(from: TaskStatus, to: TaskStatus): boolean
```

It answers only whether the pair belongs to the lifecycle relation. It does
not inspect a graph, dependencies, worker, lease, actor, or timestamp.

### Pure task transition

The public pure helper is conceptually:

```ts
transitionTask(
  task: Task,
  nextStatus: TaskStatus,
  updatedAt: string
): TaskTransitionResult
```

`TaskTransitionResult` is a discriminated union with no exception-based
domain failure:

```ts
type TaskTransitionResult =
  | {
      ok: true;
      task: Task;
    }
  | {
      ok: false;
      code: "INVALID_TASK_TRANSITION";
      from: TaskStatus;
      to: TaskStatus;
    };
```

For an allowed pair it returns a new Protocol `Task`, changing only
`status` and `updatedAt`. It preserves identity, hierarchy, dependencies,
assignment, creation timestamp, and acceptance criteria. For a disallowed pair
it returns a structured transition error and leaves the input untouched.

This helper deliberately does not decide whether `pending -> ready` is
contextually valid. That decision belongs to `CoreState` and readiness.

## Readiness

### Rule

A task is a readiness candidate exactly when:

- its current status is `pending`; and
- it has no dependencies, or every dependency is in `completed` status.

Any dependency in `pending`, `ready`, `claimed`, `running`, `blocked`,
`review`, `failed`, or `cancelled` makes the task not ready.

`parentId` and hierarchy level do not affect readiness. A task may depend on a
task in another hierarchy branch. Failure and blocking are not automatically
propagated to dependents in Core v0.

The internal pure helper
`areTaskDependenciesCompleted(graph: TaskGraph, task: Task): boolean` checks
only whether every dependency of the supplied task resolves to a task with
status `completed`. It does not inspect the supplied task's own status and is
not part of the public Core API. An internal companion may collect the
incomplete dependency IDs for structured contextual errors.

### Public API and algorithm

The pure API is:

```ts
getReadyTaskIds(graph: TaskGraph): readonly string[]
```

The function evaluates pending tasks, checks the status of each referenced
dependency, does not mutate the graph, and returns IDs sorted in ascending
lexicographic order. Its expected complexity is O(V + E) for a graph with V
tasks and E dependency edges.

`getReadyTaskIds` calls the dependency predicate only for tasks whose current
status is `pending`. It never returns `claimed`, `blocked`, or any other
status, even when those tasks have all dependencies completed.

The function is intended to run after graph validation. It must still handle a
missing dependency defensively by treating that task as not ready; graph
validity remains the responsibility of `validateTaskGraph`.

## CoreState

### Invariant and creation

The Core owns a small in-memory state. The conceptual creation API is:

```ts
createCoreState(graph: TaskGraph): CoreStateResult
```

`CoreStateResult` is a discriminated union. Invalid graph structure is an
expected domain result, not an exception:

```ts
type CoreStateResult =
  | {
      ok: true;
      state: CoreState;
    }
  | {
      ok: false;
      issues: readonly GraphValidationIssue[];
    };
```

Creation first calls `validateTaskGraph`. If any issue exists, it returns the
issues and does not return a usable state. The invariant is:

> If a `CoreState` exists, its initial graph has passed structural validation.

The state keeps a defensive copy of the graph. The copy includes the graph
object, `rootTaskIds`, the task record, each task object, each dependency
array, and acceptance-criteria objects/arrays. Mutating the original graph or
its nested values after creation must not change Core state.

`CoreState` is an opaque branded handle, not a structurally constructible
object literal. Its public TypeScript shape is conceptually equivalent to:

```ts
declare const coreStateBrand: unique symbol;

type CoreState = {
  readonly [coreStateBrand]: "CoreState";
};
```

The brand symbol is private to `core-state.ts` and is not exported. Only
`createCoreState` can produce a valid `CoreState`; consumers cannot normally
construct one through an object literal. The internal graph is not part of
the public representation.

The public read API is:

```ts
getTaskGraphSnapshot(state: CoreState): TaskGraph
```

It always returns a defensive graph copy. External mutation of that snapshot
must not bypass Core state operations.

### Controlled mutations

The state APIs are:

```ts
applyTaskTransition(
  state: CoreState,
  taskId: string,
  nextStatus: TaskStatus,
  updatedAt: string
): CoreTaskTransitionResult
```

```ts
advanceReadyTasks(
  state: CoreState,
  updatedAt: string
): readonly string[]
```

`applyTaskTransition` must:

1. resolve the task in the internal graph;
2. reject an unknown task without mutation;
3. check `isTaskTransitionAllowed`;
4. when `nextStatus` is `ready`, require
   `areTaskDependenciesCompleted` to be true, regardless of whether the
   current status is `pending`, `claimed`, or `blocked`;
5. apply the new task returned by `transitionTask` only after all checks pass.

Thus no public state API can manually bypass dependencies by setting a task to
`ready`, while valid `claimed -> ready` and `blocked -> ready` transitions
remain possible. Other lifecycle transitions are checked for lifecycle
validity only; worker, lease, actor, and command context remain outside Core
v0.

`advanceReadyTasks` finds all currently eligible pending tasks with
`getReadyTaskIds`, transitions them to `ready` using the supplied timestamp,
and returns the changed IDs in deterministic order. It does not revert an
already-ready task, propagate failure, or execute work.

`advanceReadyTasks` promotes only tasks currently in `pending`; it does not
promote `claimed` or `blocked` tasks. Those tasks can reach `ready` only by an
explicit `applyTaskTransition` call that passes both the lifecycle check and
the dependency-completion check.

The contextual transition result is a separate discriminated union from the
pure transition result:

```ts
type CoreTaskTransitionResult =
  | {
      ok: true;
      task: Task;
    }
  | {
      ok: false;
      code: "TASK_NOT_FOUND";
      taskId: string;
    }
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
```

`incompleteDependencyIds` is sorted in ascending lexicographic order. Domain
failures from `applyTaskTransition` are returned through this union; they are
not thrown as exceptions.

Core v0 has no graph mutation application API. The internal graph can only
change through the explicitly supported status operations in this increment.

## Public surface

`packages/core/src/index.ts` will reexport the selected Core behavior and
result types:

- `validateTaskGraph` and its structured result/issue types;
- `getReadyTaskIds`;
- `isTaskTransitionAllowed`;
- `transitionTask` and its result types;
- `createCoreState` and its result type;
- `getTaskGraphSnapshot`;
- `applyTaskTransition` and `CoreTaskTransitionResult`;
- `advanceReadyTasks`;
- `CoreState` and state-creation result types.

Cycle traversal helpers, clone helpers, and other implementation details do
not become public contracts in Core v0.

## Testing strategy

Tests use TypeScript strict mode and Node `node:test`. They will import
Protocol entities directly from `@flowctl/protocol` and Core behavior from the
Core public facade.

The test suite must cover:

### Graph validity

- valid `Epic -> Task -> Subtask -> Atomic` graph;
- correct roots;
- root not found;
- duplicate root;
- root with a parent;
- root with a non-`epic` level;
- `epic` absent from `rootTaskIds`;
- non-root without a parent;
- parent not found;
- invalid parent-level relation;
- task-map key different from `task.id`;
- dependency not found;
- self-dependency;
- duplicate dependency;
- dependency cycle;
- hierarchy cycle;
- dependencies crossing hierarchy branches;
- validator result shape and deterministic issue ordering;
- validator not mutating its input.

### Readiness

- pending task with no dependencies is ready;
- pending task whose dependencies are all completed is ready;
- incomplete dependency prevents readiness;
- every non-completed dependency status prevents readiness;
- hierarchy alone does not affect readiness;
- dependencies may cross branches;
- result ordering is deterministic and sorted by ID;
- the pure function does not mutate the graph.

### State machine

- every listed lifecycle transition is allowed;
- transitions not listed are rejected;
- completed, failed, and cancelled are terminal;
- `review -> running` is allowed for rework;
- failed retry is not allowed;
- `transitionTask` returns a new task and changes only `status` and
  `updatedAt`;
- rejected pure transitions do not mutate the input task.

### CoreState

- invalid graphs are rejected by `createCoreState`;
- a valid graph creates a usable state;
- changes to the original graph after creation do not affect state;
- `getTaskGraphSnapshot` does not expose mutable internal state;
- contextual `pending -> ready` is rejected when dependencies are incomplete;
- contextual `pending -> ready` succeeds when dependencies are complete;
- contextual `claimed -> ready` succeeds when dependencies are complete;
- contextual `blocked -> ready` succeeds when dependencies are complete;
- contextual `claimed -> ready` and `blocked -> ready` return
  `DEPENDENCIES_NOT_COMPLETED` with deterministic incomplete dependency IDs
  when dependencies are incomplete;
- `advanceReadyTasks` updates only eligible pending tasks;
- state mutations are limited to the internal state;
- unknown task IDs are rejected without mutation;
- state operations preserve the Protocol task fields not involved in the
  transition;
- public exports are available from `@flowctl/core`.

No test will implement Commands, Events, command handlers, event emission,
scheduling, lease behavior, worker execution, timers, persistence, or runtime
schemas.

## Explicitly out of scope

Core v0 does not implement:

- Protocol contract changes;
- Commands or Events;
- command handlers;
- event emission;
- scheduler behavior;
- worker implementations or real workers;
- adapters;
- real parallelism;
- timers;
- real heartbeats;
- lease expiration;
- lease managers;
- HTTP;
- WebSocket;
- Event Store;
- database or other persistence;
- a complete CLI;
- UI;
- desktop;
- overlay;
- LLM integration;
- Planner implementation;
- Actor authorization;
- runtime schemas;
- Zod or another runtime-validation dependency;
- automatic failure/blockage propagation;
- retry of failed tasks;
- graph mutation application;
- immutable-data infrastructure.

## Future architecture: Intent / Clarification Layer

Future FlowCTL architecture may introduce an `Intent / Clarification Layer`
before planning:

```text
Human Request
  -> Intent / Clarification
  -> Planner
  -> TaskGraph
  -> FlowCTL Core
  -> execution
```

Its purpose is to identify material ambiguity before a Planner generates a
graph. It may classify an intent as `READY_TO_PLAN` or
`NEEDS_CLARIFICATION`. A vague request such as “refactor the project” may
need clarification about objective, scope, preserved behavior, constraints,
and success criteria, while a clear small request such as “fix the typo in the
README” should not trigger unnecessary questions.

This layer is a future architectural boundary only. It is not part of
`@flowctl/core`, does not add an LLM or Planner, and must not be implemented in
Core v0.

## Self-review rulings

The following decisions are explicit to prevent arbitrary implementation
choices:

1. Strict hierarchy validation requires roots to be exactly the no-parent
   tasks, and only `epic` tasks may be roots.
2. Both parent edges and dependency edges are checked for cycles, but cycle
   helpers are not independent public APIs.
3. `GraphValidationIssue` is a discriminated union with stable codes and
   relationship-specific fields; consumers must not depend on free-form
   messages.
4. Readiness is based only on dependency status `completed`; hierarchy does
   not imply readiness. `getReadyTaskIds` filters to `pending`, while
   contextual transitions to `ready` check dependency completion for every
   lifecycle source that permits `-> ready`.
5. The pure state machine knows only lifecycle pairs. Contextual readiness is
   enforced by `CoreState`.
6. Pure and contextual task transitions have distinct result unions, and
   expected domain failures are returned rather than thrown.
7. `failed` is terminal and has no retry transition in this increment.
8. Core state owns a defensive copy and does not expose a mutable graph
   reference.
9. Core v0 changes only task status and `updatedAt`; it does not assign
   workers, manage leases, interpret actors, or emit events.
10. No Protocol changes, runtime schema library, or external production
   dependency is required by this design.

## Implementation handoff

After this spec is approved, a separate implementation plan may decompose the
work into small test-driven tasks. That plan must preserve the global
constraints and scope in this document. No implementation is part of this
specification step.
