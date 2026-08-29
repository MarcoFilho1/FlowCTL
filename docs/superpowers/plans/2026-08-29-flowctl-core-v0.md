# FlowCTL Core v0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `@flowctl/core` as a deterministic, in-memory behavior layer over the frozen `@flowctl/protocol` TaskGraph contracts.

**Architecture:** Build pure graph validation, readiness, and task-lifecycle functions first. Add a thin state owner backed by a private graph store and an opaque branded `CoreState`; expose only controlled state operations and defensive snapshots through the public facade.

**Tech Stack:** Node.js ESM, pnpm workspaces, TypeScript strict mode, Node `node:test`, and the existing `@flowctl/protocol` workspace package.

**Spec:** `docs/superpowers/specs/2026-08-29-flowctl-core-v0-design.md`

## Global Constraints

- `@flowctl/protocol` is frozen and must not be modified.
- The only production dependency of `@flowctl/core` is the workspace package `@flowctl/protocol`.
- Core consumes Protocol types directly and does not redeclare `Task`, `TaskGraph`, `TaskStatus`, `TaskLevel`, `Worker`, `Lease`, or other Protocol domain types.
- Use TypeScript strict mode and the Node.js built-in `node:test` runner.
- Pure functions do not mutate their graph or task arguments.
- Expected domain failures are returned as discriminated unions; do not throw exceptions for them.
- `CoreState` is an opaque branded handle produced only by `createCoreState`; its internal graph is never exposed as a mutable reference.
- Graph lookup identity is always the key of `graph.tasks`; never use `task.id` as an alternate key or repair mismatches.
- `getReadyTaskIds` returns only `pending` tasks with all dependencies completed; contextual `-> ready` transitions use dependency completion independently of the current status.
- `advanceReadyTasks` promotes only `pending` tasks.
- `failed`, `completed`, and `cancelled` are terminal; failed-task retry is not implemented.
- Do not implement Commands, Events, command handlers, event emission, scheduling, workers, adapters, parallelism, timers, heartbeats, lease management, HTTP/WebSocket, Event Store, database, complete CLI, UI, desktop, overlay, LLM, Planner, Actor authorization, runtime schemas, Zod, graph mutation application, or immutable-data infrastructure.

---

### Task 1: Scaffold the Core package and workspace scripts

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/tsconfig.test.json`
- Create: `packages/core/src/index.ts`
- Create: `packages/core/test/core.test.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml` through `pnpm install`

**Interfaces:**
- Consumes: existing root workspace configuration and `@flowctl/protocol` package metadata.
- Produces: a buildable `@flowctl/core` ESM package with empty public facade and Node test compilation; later tasks add facade exports and behavior.

- [ ] **Step 1: Write the failing package smoke test**

Add a Node test that imports the package entry point and proves the package can be resolved as ESM:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

test("loads the public Core package", async () => {
  const core = await import("@flowctl/core");

  assert.equal(typeof core, "object");
});
```

At this stage the test may fail until package metadata and the compiled entry point exist.

- [ ] **Step 2: Run the smoke test to verify the scaffold is absent**

Run:

```bash
pnpm --filter @flowctl/core test
```

Expected: FAIL because `@flowctl/core` does not yet exist in the workspace.

- [ ] **Step 3: Add the package and TypeScript configuration**

Create `packages/core/package.json` with no production dependency other than Protocol:

```json
{
  "name": "@flowctl/core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "@flowctl/protocol": "workspace:*"
  },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "build:test": "tsc -p tsconfig.test.json",
    "test": "pnpm run build:test && node --test dist-test/test/*.test.js"
  }
}
```

Create `tsconfig.json` extending `../../tsconfig.base.json` with `rootDir: "src"`, `outDir: "dist"`, and `include: ["src/**/*.ts"]`. Create `tsconfig.test.json` extending the same base with `rootDir: "."`, `outDir: "dist-test"`, `declaration: false`, and both `src/**/*.ts` and `test/**/*.ts` in `include`.

Create an initially empty `src/index.ts` so the package entry point compiles.

- [ ] **Step 4: Update root scripts to run all workspace packages**

Change the root scripts to run package scripts recursively in dependency order:

```json
{
  "scripts": {
    "build": "pnpm -r --if-present build",
    "typecheck": "pnpm -r --if-present typecheck",
    "test": "pnpm -r --if-present test"
  }
}
```

Do not add a new external dependency. Run `pnpm install` so the workspace lockfile records `@flowctl/core` and its local Protocol dependency.

- [ ] **Step 5: Run the scaffold checks**

Run:

```bash
pnpm --filter @flowctl/core test
pnpm --filter @flowctl/core typecheck
pnpm --filter @flowctl/core build
```

Expected: the smoke test passes, typecheck passes, and `dist/index.js` is generated.

- [ ] **Step 6: Commit the scaffold**

```bash
git add package.json pnpm-lock.yaml packages/core
git commit -m "chore(core): scaffold Core package"
```

### Task 2: Implement structured TaskGraph validation

**Files:**
- Modify: `packages/core/src/graph-validation.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/test/core.test.ts`

**Interfaces:**
- Consumes: `TaskGraph`, `Task`, and `TaskLevel` from `@flowctl/protocol`.
- Produces: `GraphValidationIssue`, `GraphValidationResult`, and `validateTaskGraph(graph: TaskGraph): GraphValidationResult`.

- [ ] **Step 1: Add failing validation tests and fixtures**

In `core.test.ts`, import Protocol types from `@flowctl/protocol` and define a local test fixture factory that creates complete Protocol `Task` objects. Add tests for:

```ts
test("accepts a strict Epic to Atomic hierarchy", () => {
  const graph = makeValidGraph();
  assert.deepEqual(validateTaskGraph(graph), { valid: true, issues: [] });
});

test("uses graph.tasks keys as canonical identity", () => {
  const graph = makeValidGraph();
  graph.tasks.T1.id = "WRONG";
  graph.tasks.T4.dependencies = ["WRONG"];

  const result = validateTaskGraph(graph);

  assert.deepEqual(result.issues, [
    { code: "TASK_KEY_MISMATCH", taskKey: "T1", taskId: "WRONG" },
    { code: "DEPENDENCY_NOT_FOUND", taskId: "T4", dependsOnTaskId: "WRONG" }
  ]);
});
```

Add focused tests for root not found, duplicate root, root with parent, root not Epic, Epic not root, Epic with parent, non-root without parent, missing parent, invalid parent level, missing dependency, self-dependency, duplicate dependency, dependency cycle, hierarchy cycle, cross-branch dependency, and input immutability.

Add a test containing several issue codes and assert the exact precedence from the spec: `TASK_KEY_MISMATCH`, `ROOT_NOT_FOUND`, `DUPLICATE_ROOT`, `ROOT_HAS_PARENT`, `ROOT_NOT_EPIC`, `EPIC_NOT_ROOT`, `EPIC_WITH_PARENT`, `NON_ROOT_WITHOUT_PARENT`, `PARENT_NOT_FOUND`, `INVALID_PARENT_LEVEL`, `DEPENDENCY_NOT_FOUND`, `SELF_DEPENDENCY`, `DUPLICATE_DEPENDENCY`, `DEPENDENCY_CYCLE`, `HIERARCHY_CYCLE`. Add same-code cases asserting lexicographic ordering of relevant canonical IDs.

- [ ] **Step 2: Run the validation tests to verify failure**

Run:

```bash
pnpm --filter @flowctl/core test
```

Expected: FAIL because `validateTaskGraph` and its result types are not implemented.

- [ ] **Step 3: Define the structured validation result types**

In `graph-validation.ts`, import `TaskGraph` and `TaskLevel` from `@flowctl/protocol` and define the Core-specific discriminated union with the exact issue codes and fields from the spec:

```ts
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
  | { code: "INVALID_PARENT_LEVEL"; taskId: string; taskLevel: TaskLevel; parentId: string; parentLevel: TaskLevel }
  | { code: "DEPENDENCY_NOT_FOUND"; taskId: string; dependsOnTaskId: string }
  | { code: "SELF_DEPENDENCY"; taskId: string }
  | { code: "DUPLICATE_DEPENDENCY"; taskId: string; dependsOnTaskId: string }
  | { code: "DEPENDENCY_CYCLE"; taskIds: readonly string[] }
  | { code: "HIERARCHY_CYCLE"; taskIds: readonly string[] };
```

Keep cycle traversal helpers private to this module. Do not export a standalone cycle result API.

- [ ] **Step 4: Implement canonical lookup and structural checks**

Implement `validateTaskGraph` using `Object.keys(graph.tasks)` as the only task identity set. Process task keys and root IDs deterministically. Check key/id equality, exact roots, parent existence and level pairs, dependency existence, self-dependencies, and duplicate dependency IDs. A mismatched `task.id` must not create an alias for any lookup.

- [ ] **Step 5: Implement private cycle detection and issue ordering**

Use stable DFS traversal over canonical task keys. Traverse `parentId` for hierarchy cycles and `dependencies` for dependency cycles; skip missing references because those already produce reference issues. Report cycle paths in `taskIds` without exposing cycle helpers publicly.

Sort all issues first by the fixed code precedence from the spec, then by relevant canonical identifiers lexicographically. For cycle issues, compare the complete canonical cycle path. Do not normalize or mutate the graph.

- [ ] **Step 6: Export the validation API and run tests**

Reexport `GraphValidationIssue`, `GraphValidationResult`, and `validateTaskGraph` from `packages/core/src/index.ts`.

Run:

```bash
pnpm --filter @flowctl/core test
pnpm --filter @flowctl/core typecheck
```

Expected: all validation tests pass and no Protocol files change.

- [ ] **Step 7: Commit validation**

```bash
git add packages/core/src/graph-validation.ts packages/core/src/index.ts packages/core/test/core.test.ts
git commit -m "feat(core): validate task graph structure"
```

### Task 3: Implement pure readiness calculation

**Files:**
- Create: `packages/core/src/readiness.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/test/core.test.ts`

**Interfaces:**
- Consumes: Protocol `TaskGraph` and `Task` plus validated canonical task lookup semantics from Task 2.
- Produces: public `getReadyTaskIds(graph: TaskGraph): readonly string[]`; module-internal `areTaskDependenciesCompleted(graph: TaskGraph, task: Task): boolean` and incomplete-dependency helper.

- [ ] **Step 1: Add failing readiness tests**

Add tests proving:

```ts
test("returns pending tasks with no dependencies", () => {
  assert.deepEqual(getReadyTaskIds(graphWithPendingTask()), ["T1"]);
});

test("returns pending tasks only after all dependencies complete", () => {
  const graph = graphWithDependencies({ T2: "completed", T3: "completed" });
  assert.deepEqual(getReadyTaskIds(graph), ["T4"]);
});
```

Also test every non-completed dependency status, hierarchy independence, cross-branch dependencies, deterministic lexicographic ordering, missing dependency defensive behavior, and input immutability. Include `claimed` and `blocked` tasks with completed dependencies and assert they are not returned.

- [ ] **Step 2: Run readiness tests to verify failure**

Run:

```bash
pnpm --filter @flowctl/core test
```

Expected: FAIL because `getReadyTaskIds` is not implemented.

- [ ] **Step 3: Implement the internal dependency predicate**

In `readiness.ts`, import `TaskGraph` and `Task` from `@flowctl/protocol`. Implement the non-barrel internal helper:

```ts
export function areTaskDependenciesCompleted(
  graph: TaskGraph,
  task: Task
): boolean
```

It must resolve dependency IDs only through `graph.tasks`, require every resolved dependency to have `status === "completed"`, and return `false` for a missing dependency. Keep it out of `index.ts`. Add a private helper that returns incomplete dependency IDs sorted lexicographically for later CoreState contextual errors.

- [ ] **Step 4: Implement `getReadyTaskIds`**

Filter only tasks with `status === "pending"`, call the internal dependency predicate, and return matching canonical task keys sorted lexicographically. Do not mutate tasks or statuses. Do not consider `parentId` or task level.

- [ ] **Step 5: Export and run readiness checks**

Reexport only `getReadyTaskIds` from `index.ts`.

Run:

```bash
pnpm --filter @flowctl/core test
pnpm --filter @flowctl/core typecheck
```

Expected: readiness tests pass and the internal predicate is not part of the package facade.

- [ ] **Step 6: Commit readiness**

```bash
git add packages/core/src/readiness.ts packages/core/src/index.ts packages/core/test/core.test.ts
git commit -m "feat(core): calculate task readiness"
```

### Task 4: Implement the pure TaskStatus state machine

**Files:**
- Create: `packages/core/src/task-state-machine.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/test/core.test.ts`

**Interfaces:**
- Consumes: Protocol `Task` and `TaskStatus`.
- Produces: `isTaskTransitionAllowed(from, to): boolean`, `TaskTransitionResult`, and `transitionTask(task, nextStatus, updatedAt): TaskTransitionResult`.

- [ ] **Step 1: Add failing lifecycle tests**

Generate tests from the exact allowed relation and assert each pair:

```ts
test("allows review rework", () => {
  assert.equal(isTaskTransitionAllowed("review", "running"), true);
});

test("rejects retry from failed", () => {
  assert.equal(isTaskTransitionAllowed("failed", "running"), false);
});
```

Cover all allowed and representative disallowed transitions, terminal states, pure-task success, invalid result narrowing, preservation of every unrelated Task field, and input immutability.

- [ ] **Step 2: Run state-machine tests to verify failure**

Run:

```bash
pnpm --filter @flowctl/core test
```

Expected: FAIL because the state-machine module and result type do not exist.

- [ ] **Step 3: Define the pure result union**

Define and export:

```ts
export type TaskTransitionResult =
  | { ok: true; task: Task }
  | {
      ok: false;
      code: "INVALID_TASK_TRANSITION";
      from: TaskStatus;
      to: TaskStatus;
    };
```

Use Protocol types directly; do not copy the Task shape.

- [ ] **Step 4: Implement the lifecycle relation and `transitionTask`**

Represent only the exact transitions from the spec. `isTaskTransitionAllowed` must inspect only the two statuses. `transitionTask` must first reject disallowed pairs, then return a new Task object with only `status` and `updatedAt` changed. It must not inspect graph dependencies, workers, leases, actors, or timestamps beyond assigning the supplied string.

- [ ] **Step 5: Export and run state-machine checks**

Reexport `TaskTransitionResult`, `isTaskTransitionAllowed`, and `transitionTask` from `index.ts`.

Run:

```bash
pnpm --filter @flowctl/core test
pnpm --filter @flowctl/core typecheck
```

Expected: all lifecycle and purity tests pass.

- [ ] **Step 6: Commit the state machine**

```bash
git add packages/core/src/task-state-machine.ts packages/core/src/index.ts packages/core/test/core.test.ts
git commit -m "feat(core): add task status state machine"
```

### Task 5: Implement opaque in-memory CoreState and contextual transitions

**Files:**
- Create: `packages/core/src/core-state.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/test/core.test.ts`

**Interfaces:**
- Consumes: `TaskGraph`, `Task`, and `TaskStatus` from Protocol; `validateTaskGraph`, internal dependency helpers, `getReadyTaskIds`, and `transitionTask` from earlier tasks.
- Produces: opaque `CoreState`, `CoreStateResult`, `CoreTaskTransitionResult`, `createCoreState`, `getTaskGraphSnapshot`, `applyTaskTransition`, and `advanceReadyTasks`.

- [ ] **Step 1: Add failing CoreState tests**

Add tests for invalid-state rejection, valid-state creation, opaque construction, defensive isolation from the original graph, defensive snapshots, unknown task IDs, contextual ready rejection, contextual ready success from `pending`, `claimed`, and `blocked`, deterministic incomplete dependency IDs, allowed non-ready lifecycle transitions, no mutation on failed operations, and `advanceReadyTasks` promoting only pending tasks.

Use compile-time proof that a normal object literal cannot construct the branded state:

```ts
// @ts-expect-error CoreState is an opaque branded handle.
const forgedState: CoreState = {};
void forgedState;
```

- [ ] **Step 2: Run CoreState tests to verify failure**

Run:

```bash
pnpm --filter @flowctl/core test
```

Expected: FAIL because `CoreState` and its state operations are not implemented.

- [ ] **Step 3: Define the opaque state and result unions**

In `core-state.ts`, use a private brand and a private `WeakMap` or equivalent module-owned store:

```ts
declare const coreStateBrand: unique symbol;

export type CoreState = {
  readonly [coreStateBrand]: "CoreState";
};

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
```

The brand symbol must not be exported. No public constructor may exist.

- [ ] **Step 4: Implement defensive graph cloning and creation**

Implement a private clone that copies the graph object, root ID array, task record, task objects, dependency arrays, acceptance-criteria arrays, and criterion objects. `createCoreState` must call `validateTaskGraph` first; return `{ ok: false, issues }` for any invalid graph and create no state entry. On success, create only the branded handle and store the defensive clone in the private map.

- [ ] **Step 5: Implement snapshot access**

Implement:

```ts
getTaskGraphSnapshot(state: CoreState): TaskGraph
```

Read the private graph and return a new defensive clone. Do not return the internal graph or any nested mutable reference.

- [ ] **Step 6: Implement contextual `applyTaskTransition`**

Implement the checks in this order:

1. resolve `taskId` through the internal `graph.tasks` key map;
2. return `TASK_NOT_FOUND` without mutation if absent;
3. call `transitionTask`/`isTaskTransitionAllowed` and return contextual `INVALID_TASK_TRANSITION` if the lifecycle pair is invalid;
4. when `nextStatus === "ready"`, call the internal dependency-completion predicate without requiring current status `pending`;
5. return `DEPENDENCIES_NOT_COMPLETED` with sorted incomplete dependency IDs when required;
6. replace the internal task with the successful pure transition result.

This permits `pending -> ready`, `claimed -> ready`, and `blocked -> ready` only when dependencies are complete. It does not inspect worker, lease, actor, or command context.

- [ ] **Step 7: Implement `advanceReadyTasks`**

Call `getReadyTaskIds` so only pending tasks are selected. Apply `transitionTask(task, "ready", updatedAt)` to each selected task in sorted order, replace each internal task, and return the changed IDs. Do not promote claimed or blocked tasks, revert ready tasks, propagate failures, or execute work.

- [ ] **Step 8: Export state APIs and run focused checks**

Reexport all public state types and functions except private clone/predicate helpers.

Run:

```bash
pnpm --filter @flowctl/core test
pnpm --filter @flowctl/core typecheck
```

Expected: state isolation, contextual readiness, result narrowing, and mutation-boundary tests pass.

- [ ] **Step 9: Commit CoreState**

```bash
git add packages/core/src/core-state.ts packages/core/src/index.ts packages/core/test/core.test.ts
git commit -m "feat(core): add controlled in-memory state"
```

### Task 6: Complete the public facade and repository validation

**Files:**
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/test/core.test.ts`
- No Protocol files may be modified.

**Interfaces:**
- Consumes: all Core modules and public types defined in Tasks 2–5.
- Produces: complete `@flowctl/core` public surface and final green workspace validation.

- [ ] **Step 1: Add public-surface and exhaustive narrowing tests**

Import every intended public function/type through `@flowctl/core` and import the domain fixture types through `@flowctl/protocol`. Add a runtime smoke test for the package import and `PROTOCOL_VERSION` through the unchanged Protocol package. Add TypeScript narrowing tests for every `GraphValidationIssue` code and every result union branch; use an exhaustive `never` assertion where appropriate.

- [ ] **Step 2: Run the public-surface test to verify any missing export**

Run:

```bash
pnpm --filter @flowctl/core test
```

Expected: FAIL if any intended public export or exhaustive union branch is missing.

- [ ] **Step 3: Finalize `index.ts` as the facade**

Export only the intended Core functions, result types, and `CoreState` type. Keep cycle traversal, graph clone, dependency predicate, and private storage implementation details out of the facade.

- [ ] **Step 4: Run all required validation**

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
cd packages/core && node --input-type=module -e 'const core = await import("@flowctl/core"); if (typeof core.validateTaskGraph !== "function") process.exit(1); console.log("public import: @flowctl/core")'
cd ../..
git diff --check
```

Expected: Protocol and Core tests pass, both packages typecheck and build, the public import succeeds, and `git diff --check` produces no output.

- [ ] **Step 5: Run the scope and dependency review**

Run:

```bash
rg -n 'from "\./index\.js"' packages/core/src
rg -n 'zod|json schema|runtime schema|scheduler|lease manager|heartbeat|http|websocket|event store|database|adapter|overlay|llm|planner' packages/core/src
git diff --name-only origin/main..HEAD
git status --short --branch
```

Expected: no internal barrel imports, no out-of-scope implementation in Core source, changed files limited to the Core package, root scripts/lockfile, and tests/docs explicitly required by this plan, and a clean working tree after committing.

- [ ] **Step 6: Commit the completed facade and test coverage**

```bash
git add packages/core/src/index.ts packages/core/test/core.test.ts
git commit -m "test(core): verify public Core v0 contract"
```

## Plan self-review

- Spec coverage: Tasks 1–6 cover package setup, Protocol-only dependency, strict hierarchy and canonical identity, structured validation and issue ordering, private cycle checks, pure readiness, exact lifecycle relation, distinct result unions, opaque state, defensive snapshots, contextual ready transitions, state mutation limits, public exports, and all required tests.
- Placeholder scan: no task contains an unresolved marker, vague handling instruction, or undefined follow-up implementation.
- Type consistency: `TaskTransitionResult` is the pure result; `CoreTaskTransitionResult` is the contextual result; `CoreStateResult` is the creation result; all later signatures use those exact names.
- Scope check: no Commands, Events, scheduler, worker runtime, lease behavior, persistence, transport, UI, Planner, LLM, or runtime schema work is assigned.
- Protocol boundary: every domain entity is imported from `@flowctl/protocol`; no Protocol source or test file is assigned for modification.
