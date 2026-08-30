# FlowCTL Control Plane v0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `@flowctl/control-plane` as the first executable vertical slice that owns CoreState privately, admits a Worker claim, authorizes start and complete through an active Lease, and ends at `review`.

**Architecture:** Build a thin opaque Control Plane around the frozen Protocol and Core packages. Keep the CoreState handle, canonical `activeLeaseByTaskId` map, and append-only in-memory Event Log in private state; process each accepted command on defensive candidate state and commit only after all domain checks, generated values, Events, and Core transitions are ready.

**Tech Stack:** Node.js ESM, pnpm workspaces, TypeScript strict mode, Node `node:test`, `@flowctl/protocol`, and `@flowctl/core`.

**Spec:** `docs/superpowers/specs/2026-08-30-flowctl-control-plane-v0-design.md`

## Global Constraints

- `@flowctl/protocol` and `@flowctl/core` are frozen and must not be modified by this increment.
- The new package is `packages/control-plane` and its only production dependencies are `@flowctl/protocol` and `@flowctl/core`.
- Consume Protocol and Core types directly; do not redeclare `Task`, `TaskGraph`, `TaskStatus`, `Lease`, `FlowctlCommand`, `FlowctlEvent`, or Core result/domain types.
- Use TypeScript strict mode, Node ESM, and the built-in `node:test` runner.
- Internal Control Plane tests import the package facade through `../src/index.js` and Protocol contracts through `@flowctl/protocol`; no internal test may import `@flowctl/control-plane`.
- The final package-resolution smoke test imports `@flowctl/control-plane` only after `pnpm build`.
- The first behavioral RED is the Control Plane creation behavior; package scaffolding and configuration are validated directly without an artificial failing test.
- Supported commands are exactly `task.claim`, `task.start`, and `task.complete`; all other `FlowctlCommand` members return `UNSUPPORTED_COMMAND` without mutation or business Events.
- Every dispatch validates project identity before command support, then performs command-specific validation.
- Claim precedence is `PROJECT_MISMATCH` → `TASK_NOT_FOUND` → `TASK_ALREADY_LEASED` → `TASK_NOT_READY`.
- `activeLeaseByTaskId: Map<string, Lease>` is the only active-Lease storage; its key is canonical `taskId`, there is at most one active Lease per task, and no inactive-Lease storage exists.
- Lease authority is never inferred from `Task.assignedWorkerId`.
- `task.start` requires `claimed -> running`; `task.complete` requires `running -> review` and removes the Lease from `activeLeaseByTaskId`.
- `task.complete` emits only `task.review_requested`; it never emits `task.completed` or `lease.released`.
- `CommandProcessingResult.events` contains only Events produced by the current dispatch; `getEventLogSnapshot` returns accumulated history.
- Expected domain failures use discriminated unions and do not use exceptions. Clock and ID generator failures may throw as programming/configuration failures, but only before state replacement.
- Event and Lease data must be deterministic under injected `now`, `nextLeaseId`, `nextEventId`, and `leaseExpiresAt` functions.
- Never `structuredClone`, inspect internals of, or reconstruct a `CoreState` handle. Candidate staging must call `getTaskGraphSnapshot(currentCoreState)`, pass that defensive `TaskGraph` to `createCoreState(snapshot)`, use the returned candidate `CoreState`, apply the transition only to that candidate, and replace the private CoreState handle only at commit. A rejection while recreating a snapshot from a valid CoreState is a programming/invariant failure, not a new domain result.
- Event actor, project ID, and protocol version are copied from the accepted Command; payload Worker IDs remain operation data and do not replace the causal actor.
- All caller-visible mutable structures are defensively copied, including the input Command data retained for Events, returned Events, Event Log snapshots, Lease payloads, and TaskGraph snapshots.
- Initialization preserves input statuses, starts with an empty Event Log, creates no Lease, does not call `advanceReadyTasks`, and emits no `task.ready` Event.
- Do not implement scheduler behavior, automatic task selection, real Workers, Fake Workers, adapters, parallel execution, Worker Registry, authentication, heartbeat, expiry, recovery, reassignment, review approval, `review -> completed`, `task.completed`, dependent readiness promotion, `task.ready`, transport, persistence, Event Store, database, runtime schemas, Zod, UI, Desktop, Overlay, Planner, LLM, Intent/Clarification Layer, GraphMutation application, Verifier, or shell/file mediation.

---

### Task 1: Scaffold the Control Plane package

**Files:**
- Create: `packages/control-plane/package.json`
- Create: `packages/control-plane/tsconfig.json`
- Create: `packages/control-plane/tsconfig.test.json`
- Create: `packages/control-plane/src/index.ts`
- Modify: `pnpm-lock.yaml` through `pnpm install`

**Interfaces:**
- Consumes: the existing `packages/*` workspace glob, root strict TypeScript configuration, and the built Protocol/Core workspace packages.
- Produces: a buildable `@flowctl/control-plane` ESM package with no artificial behavioral test and an empty source facade ready for Task 2.

- [ ] **Step 1: Create package metadata and TypeScript configuration**

Create `packages/control-plane/package.json` with exactly the two allowed production dependencies and scripts that build Core before compiling Control Plane source or tests:

```json
{
  "name": "@flowctl/control-plane",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "@flowctl/core": "workspace:*",
    "@flowctl/protocol": "workspace:*"
  },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "prepare:core": "pnpm --filter @flowctl/core build",
    "prebuild": "pnpm run prepare:core",
    "pretypecheck": "pnpm run prepare:core",
    "prebuild:test": "pnpm run prepare:core",
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "build:test": "tsc -p tsconfig.test.json",
    "test": "pnpm run build:test && node --test dist-test/test/*.test.js"
  }
}
```

Create `tsconfig.json` extending `../../tsconfig.base.json` with `rootDir: "src"`, `outDir: "dist"`, and `include: ["src/**/*.ts"]`. Create `tsconfig.test.json` extending the same base with `rootDir: "."`, `outDir: "dist-test"`, `declaration: false`, and `include: ["src/**/*.ts", "test/**/*.ts"]`.

Create `packages/control-plane/src/index.ts` containing only:

```ts
export {};
```

Do not modify `pnpm-workspace.yaml`; the existing `packages/*` glob discovers the package.

- [ ] **Step 2: Install workspace metadata**

Run:

```bash
pnpm install
```

Expected: the lockfile records the new workspace package and its links to `@flowctl/protocol` and `@flowctl/core`. No third-party production dependency is added.

- [ ] **Step 3: Validate the configuration-only scaffold**

Run:

```bash
pnpm --filter @flowctl/control-plane typecheck
pnpm --filter @flowctl/control-plane build
```

Expected: both commands pass and `packages/control-plane/dist/index.js` is generated. Do not create a failing smoke test for package setup.

- [ ] **Step 4: Commit the scaffold**

```bash
git add packages/control-plane pnpm-lock.yaml
git commit -m "chore(control-plane): scaffold package"
```

### Task 2: Add opaque ControlPlane creation and CoreState ownership

**Files:**
- Create: `packages/control-plane/src/results.ts`
- Create: `packages/control-plane/src/state.ts`
- Create: `packages/control-plane/src/control-plane.ts`
- Modify: `packages/control-plane/src/index.ts`
- Create: `packages/control-plane/test/control-plane.test.ts`

**Interfaces:**
- Consumes: Protocol `TaskGraph`, `Task`, and `TaskStatus`; Core `CoreState`, `createCoreState`, and `getTaskGraphSnapshot`.
- Produces: `ControlPlane`, `ControlPlaneOptions`, `ControlPlaneCreationResult`, `createControlPlane(graph, options)`, and `getTaskGraphSnapshot(controlPlane)`.

- [ ] **Step 1: Write the first behavioral RED**

In `control-plane.test.ts`, import the facade with `import * as ControlPlane from "../src/index.js"` and Protocol types with `import type { Task, TaskGraph, TaskLevel } from "@flowctl/protocol"`. Define a complete fixture with A=`ready` and B/C/D=`pending`, and add these tests before implementing the API:

```ts
test("creates an opaque ControlPlane and preserves initialization statuses", () => {
  const result = ControlPlane.createControlPlane(makeMilestoneGraph(), makeOptions());

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.deepEqual(
    Object.fromEntries(
      Object.entries(ControlPlane.getTaskGraphSnapshot(result.controlPlane).tasks)
        .map(([id, task]) => [id, task.status])
    ),
    { A: "ready", B: "pending", C: "pending", D: "pending" }
  );
});

test("rejects an invalid graph with the Core validation issues", () => {
  const graph = makeMilestoneGraph();
  graph.rootTaskIds = ["MISSING"];

  const result = ControlPlane.createControlPlane(graph, makeOptions());

  assert.deepEqual(result, {
    ok: false,
    code: "INVALID_GRAPH",
    issues: [{ code: "ROOT_NOT_FOUND", taskId: "MISSING" }]
  });
});
```

Add the compile-time opacity assertion:

```ts
// @ts-expect-error ControlPlane is an opaque branded handle.
const forgedControlPlane: ControlPlane.ControlPlane = {};
void forgedControlPlane;
```

- [ ] **Step 2: Run the first RED**

Run:

```bash
pnpm --filter @flowctl/control-plane test
```

Expected: FAIL because the Control Plane creation result and facade functions do not yet exist. This is the first behavioral RED; do not replace it with a configuration-only failure.

- [ ] **Step 3: Define the private branded state and result contracts**

In `results.ts`, define the public creation result and options using only types needed at this stage:

```ts
import type { GraphValidationIssue } from "@flowctl/core";
import type { ControlPlane } from "./state.js";

export interface ControlPlaneOptions {
  now: () => string;
  nextLeaseId: () => string;
  nextEventId: () => string;
  leaseExpiresAt: (acquiredAt: string) => string;
}

export type ControlPlaneCreationResult =
  | { ok: true; controlPlane: ControlPlane }
  | { ok: false; code: "INVALID_GRAPH"; issues: readonly GraphValidationIssue[] };
```

In `state.ts`, define the private brand and state store:

```ts
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
```

Export `ControlPlaneState` only from its internal module so `event-log.ts` and command handlers can share the type; do not reexport it from the package facade. Keep the brand value and state store unexported. Provide internal functions to create a branded handle, read its state, and replace the entire state record atomically. Do not expose CoreState, the Lease map, or Event Log through the facade. The public result type may import the branded `ControlPlane` type, but the facade must export no state internals.

Use these internal-module signatures:

```ts
export function createControlPlaneHandle(state: ControlPlaneState): ControlPlane;
export function readControlPlaneState(controlPlane: ControlPlane): ControlPlaneState;
export function replaceControlPlaneState(controlPlane: ControlPlane, state: ControlPlaneState): void;
```

- [ ] **Step 4: Implement creation and defensive graph snapshots**

In `control-plane.ts`, call `createCoreState(graph)`. Return `{ ok: false, code: "INVALID_GRAPH", issues }` unchanged when Core rejects the graph. On success, store the project ID, CoreState handle, an empty `activeLeaseByTaskId`, an empty `eventLog`, and the injected options.

Implement:

```ts
export function createControlPlane(
  graph: TaskGraph,
  options: ControlPlaneOptions
): ControlPlaneCreationResult;

export function getTaskGraphSnapshot(controlPlane: ControlPlane): TaskGraph;
```

Delegate snapshotting to Core's `getTaskGraphSnapshot`; do not retain the caller's graph and do not accept a CoreState argument. Reexport only the public functions and types from `src/index.ts`.

- [ ] **Step 5: Run GREEN and typecheck**

Run:

```bash
pnpm --filter @flowctl/control-plane test
pnpm --filter @flowctl/control-plane typecheck
```

Expected: creation, invalid-graph, status-preservation, and compile-time opacity tests pass. Add a runtime test that mutates the original graph after creation and confirms the Control Plane snapshot is unchanged.

- [ ] **Step 6: Commit ownership**

```bash
git add packages/control-plane/src packages/control-plane/test/control-plane.test.ts
git commit -m "feat(control-plane): own CoreState privately"
```

### Task 3: Expose the empty in-memory Event Log boundary

**Files:**
- Create: `packages/control-plane/src/event-log.ts`
- Modify: `packages/control-plane/src/index.ts`
- Modify: `packages/control-plane/test/control-plane.test.ts`

**Interfaces:**
- Consumes: private Control Plane state from Task 2 and the empty Protocol `FlowctlEvent[]` collection.
- Produces: `getEventLogSnapshot(controlPlane): readonly FlowctlEvent[]` with a fresh array boundary. Real Event append and deep cloning are produced by Task 4, when an accepted claim first makes those behaviors observable.

- [ ] **Step 1: Write failing Event Log boundary tests**

Add the empty initial snapshot assertion before implementing the new API:

```ts
test("starts with an empty Event Log", () => {
  const result = ControlPlane.createControlPlane(makeMilestoneGraph(), makeOptions());
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.deepEqual(ControlPlane.getEventLogSnapshot(result.controlPlane), []);
});

test("does not expose the internal Event Log array", () => {
  const result = ControlPlane.createControlPlane(makeMilestoneGraph(), makeOptions());
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const first = ControlPlane.getEventLogSnapshot(result.controlPlane);
  const second = ControlPlane.getEventLogSnapshot(result.controlPlane);
  assert.deepEqual(first, []);
  assert.notStrictEqual(first, second);
});
```

- [ ] **Step 2: Run the focused RED**

Run:

```bash
pnpm --filter @flowctl/control-plane test
```

Expected: FAIL because `getEventLogSnapshot` is not yet exported. Do not create a RED for deep Event copying before real Events exist.

- [ ] **Step 3: Implement Event Log ownership isolation**

For this task, implement only the empty-log read boundary. Return a fresh array from the private `eventLog` collection, which proves that the public API does not expose the internal array even though no real Event exists yet. Do not implement Event append or deep Event cloning in this task; those become exercisable only after the first accepted claim in Task 4. Use Node's built-in `structuredClone` for the later Event and Lease copies; no dependency or runtime schema is introduced.

Implement the empty-log helper with this signature:

```ts
export function getEventLogSnapshot(controlPlane: ControlPlane): readonly FlowctlEvent[];
```

At this stage `eventLog` is empty by construction, so a fresh shallow array is sufficient. Keep `ControlPlaneState` as an internal-module type; expose only the read function through `index.ts`.

- [ ] **Step 4: Run GREEN and typecheck**

Run:

```bash
pnpm --filter @flowctl/control-plane test
pnpm --filter @flowctl/control-plane typecheck
```

Expected: empty-log and internal-array isolation tests pass. Confirm the Protocol and Core working files are unchanged.

- [ ] **Step 5: Commit the Event Log**

```bash
git add packages/control-plane/src packages/control-plane/test/control-plane.test.ts
git commit -m "feat(control-plane): expose event log boundary"
```

### Task 4: Implement claim admission and Lease creation

**Files:**
- Create: `packages/control-plane/src/dispatch.ts`
- Create: `packages/control-plane/src/claim.ts`
- Create: `packages/control-plane/src/command-copy.ts`
- Create: `packages/control-plane/src/task-lookup.ts`
- Modify: `packages/control-plane/src/results.ts`
- Modify: `packages/control-plane/src/index.ts`
- Modify: `packages/control-plane/test/control-plane.test.ts`

**Interfaces:**
- Consumes: `ControlPlane`, private state replacement, Event Log append helper, Core `isTaskTransitionAllowed`/`applyTaskTransition`, and Protocol `FlowctlCommand`, `Lease`, `FlowctlEvent`, and `Actor`.
- Produces: the first real `dispatchCommand(controlPlane, command): CommandProcessingResult`, claim admission, deterministic Lease construction, and the claim Event pair.

- [ ] **Step 1: Add the exact dispatch result union**

In `results.ts`, now add the imports required for the dispatch result and define `CommandProcessingResult` with these exact variants and fields:

```ts
import type { FlowctlCommand, FlowctlEvent, TaskStatus } from "@flowctl/protocol";

export type CommandProcessingResult =
  | { ok: true; events: readonly FlowctlEvent[] }
  | { ok: false; code: "UNSUPPORTED_COMMAND"; commandId: string; commandType: FlowctlCommand["type"] }
  | { ok: false; code: "PROJECT_MISMATCH"; commandId: string; commandProjectId: string; controlPlaneProjectId: string }
  | { ok: false; code: "TASK_NOT_FOUND"; commandId: string; taskId: string }
  | { ok: false; code: "TASK_NOT_READY"; commandId: string; taskId: string }
  | { ok: false; code: "TASK_ALREADY_LEASED"; commandId: string; taskId: string }
  | { ok: false; code: "LEASE_NOT_FOUND"; commandId: string; leaseId: string }
  | { ok: false; code: "LEASE_MISMATCH"; commandId: string; taskId: string; leaseId: string; workerId: string }
  | { ok: false; code: "INVALID_TASK_TRANSITION"; commandId: string; taskId: string; from: TaskStatus; to: TaskStatus };
```

Use Protocol/Core types in the union; do not create local substitutes.

- [ ] **Step 2: Write failing claim tests**

Add command fixtures that use a mutable Protocol `Actor` object and deterministic options. Test the accepted path:

```ts
test("claims ready A with one active Lease and ordered Events", () => {
  const result = ControlPlane.createControlPlane(makeMilestoneGraph(), makeOptions());
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const command = makeClaimCommand({ actor: { type: "worker", id: "W1" } });
  const dispatch = ControlPlane.dispatchCommand(result.controlPlane, command);

  assert.equal(dispatch.ok, true);
  if (!dispatch.ok) return;
  assert.deepEqual(dispatch.events.map((event) => event.type), ["lease.created", "task.claimed"]);
  if (dispatch.events[0]?.type === "lease.created" && dispatch.events[1]?.type === "task.claimed") {
    assert.equal(dispatch.events[0].payload.lease.id, "L1");
    assert.equal(dispatch.events[1].payload.leaseId, dispatch.events[0].payload.lease.id);
  }
  assert.equal(ControlPlane.getTaskGraphSnapshot(result.controlPlane).tasks.A?.status, "claimed");
});
```

Add atomic failure tests for missing task, pending task, and a second claim. The second claim must assert `TASK_ALREADY_LEASED` even though A is already `claimed`. Add a foreign-project claim assertion for `PROJECT_MISMATCH`.

Add an own-key regression test using inherited names that are absent as own keys in the fixture:

```ts
for (const taskId of ["toString", "constructor", "__proto__"]) {
  test(`does not resolve inherited task key ${taskId}`, () => {
    const { controlPlane } = makeReadyControlPlane();
    const beforeGraph = ControlPlane.getTaskGraphSnapshot(controlPlane);
    const beforeLog = ControlPlane.getEventLogSnapshot(controlPlane);
    const result = ControlPlane.dispatchCommand(
      controlPlane,
      makeClaimCommand({ taskId })
    );

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "TASK_NOT_FOUND");
    assert.deepEqual(ControlPlane.getTaskGraphSnapshot(controlPlane), beforeGraph);
    assert.deepEqual(ControlPlane.getEventLogSnapshot(controlPlane), beforeLog);
  });
}
```

- [ ] **Step 3: Run the claim RED**

Run:

```bash
pnpm --filter @flowctl/control-plane test
```

Expected: FAIL because dispatch, claim validation, and claim Events are not implemented.

- [ ] **Step 4: Implement claim validation in the required order**

Create `task-lookup.ts` with the shared internal helper below and reuse it from claim, start, and complete handlers:

```ts
export function getCanonicalTask(graph: TaskGraph, taskId: string): Task | undefined {
  return Object.hasOwn(graph.tasks, taskId) ? graph.tasks[taskId] : undefined;
}
```

Implement the initial dispatch path with project validation followed by `task.claim` handling. Use this own-key lookup against the graph snapshot; do not use `task.id` as an alternate key. Claim-specific validation must be exactly:

```text
project
task lookup
activeLeaseByTaskId.get(taskId)
task status === "ready"
```

Return `TASK_ALREADY_LEASED` before checking status when the map already contains the canonical task ID. Use `isTaskTransitionAllowed(task.status, "claimed")` before value generation and return `INVALID_TASK_TRANSITION` if that invariant ever fails.

For accepted claims, copy `command.actor`, obtain one timestamp, call generators in this order:

```text
now()
nextLeaseId()
leaseExpiresAt(timestamp)
nextEventId() for lease.created
nextEventId() for task.claimed
```

Construct a Protocol `Lease` with `taskId`, requested `workerId`, `acquiredAt` and `lastHeartbeatAt` equal to the dispatch timestamp, and `expiresAt` from `leaseExpiresAt`. Construct `lease.created` followed by `task.claimed`, copying actor/project/protocolVersion from the Command and preserving the Lease ID in both payloads.

Stage without cloning the opaque handle: call `getTaskGraphSnapshot(currentCoreState)`, pass that defensive `TaskGraph` to `createCoreState(snapshot)`, and use the returned candidate `CoreState`. If `createCoreState(snapshot)` rejects even though the current handle was valid, throw a programming/invariant error rather than returning a new domain result. Copy the active-Lease map and Event Log into the candidate state, apply `ready -> claimed` only to the candidate CoreState, add the Lease under `activeLeaseByTaskId.set(taskId, lease)`, append cloned Events, replace the private state once, and return a separately cloned `[lease.created, task.claimed]` result. Do not modify `Task.assignedWorkerId`.

At this point implement the real Event boundaries from Task 3: append cloned Events to the candidate Event Log, return separately cloned Events in `CommandProcessingResult.events`, and ensure the copied Command actor and nested Lease payload are not shared with either destination.

- [ ] **Step 5: Prove atomicity and defensive input ownership**

Add tests where `now`, `nextLeaseId`, `nextEventId`, or `leaseExpiresAt` throws. For each, assert that the graph snapshot and Event Log remain exactly as before the dispatch. Add the accepted-command adversarial test:

```ts
const command = makeClaimCommand({ actor: { type: "worker", id: "W1" } });
const result = ControlPlane.dispatchCommand(controlPlane, command);
assert.equal(result.ok, true);
if (!result.ok) return;

command.actor.id = "MUTATED";
if (result.events[1] !== undefined) {
  result.events[1].actor.id = "RESULT_MUTATED";
}

const history = ControlPlane.getEventLogSnapshot(controlPlane);
if (result.events[0]?.type === "lease.created") {
  result.events[0].payload.lease.workerId = "RESULT_LEASE_MUTATED";
}
assert.equal(history[1]?.actor.id, "W1");
const snapshot = ControlPlane.getEventLogSnapshot(controlPlane);
if (snapshot[0]?.type === "lease.created") {
  snapshot[0].payload.lease.workerId = "SNAPSHOT_LEASE_MUTATED";
}
assert.equal(history[0]?.type, "lease.created");
if (history[0]?.type === "lease.created") {
  assert.equal(history[0].payload.lease.workerId, "W1");
}
const freshSnapshot = ControlPlane.getEventLogSnapshot(controlPlane);
if (freshSnapshot[0]?.type === "lease.created") {
  assert.equal(freshSnapshot[0].payload.lease.workerId, "W1");
}
```

The implementation must copy the command-derived actor before Event construction and clone Events at both result and log boundaries.

- [ ] **Step 6: Run GREEN and commit claim**

Run:

```bash
pnpm --filter @flowctl/control-plane test
pnpm --filter @flowctl/control-plane typecheck
```

Expected: all creation, Event Log, claim, precedence, generator-failure, and copy-boundary tests pass.

```bash
git add packages/control-plane/src packages/control-plane/test/control-plane.test.ts
git commit -m "feat(control-plane): admit claims and create leases"
```

### Task 5: Implement start authorization through the active Lease

**Files:**
- Create: `packages/control-plane/src/start.ts`
- Modify: `packages/control-plane/src/dispatch.ts`
- Modify: `packages/control-plane/src/control-plane.ts`
- Modify: `packages/control-plane/test/control-plane.test.ts`

**Interfaces:**
- Consumes: the private state/candidate helpers from Tasks 2–4, Protocol `task.start`, and Core `isTaskTransitionAllowed` plus `applyTaskTransition`.
- Produces: start handling for `claimed -> running`, `task.started`, and `LEASE_NOT_FOUND`/`LEASE_MISMATCH`/`INVALID_TASK_TRANSITION` outcomes.

- [ ] **Step 1: Write failing start tests**

Create the accepted state by dispatching a deterministic claim, extract its Lease ID from `lease.created`, then add:

```ts
test("starts only with the active Lease and emits task.started", () => {
  const { controlPlane, leaseId } = makeClaimedControlPlane();
  const result = ControlPlane.dispatchCommand(
    controlPlane,
    makeStartCommand({ leaseId, workerId: "W1" })
  );

  assert.deepEqual(result.ok && result.events.map((event) => event.type), ["task.started"]);
  assert.equal(ControlPlane.getTaskGraphSnapshot(controlPlane).tasks.A?.status, "running");
});
```

Add tests for start without a Lease, wrong Lease ID, wrong Worker ID, and a lifecycle-invalid start. For every rejection, snapshot the graph and Event Log before dispatch and assert both are unchanged. Assert the implementation never authorizes start through a matching `Task.assignedWorkerId` when the active map has no Lease.

- [ ] **Step 2: Run the start RED**

Run:

```bash
pnpm --filter @flowctl/control-plane test
```

Expected: accepted start and its rejection cases fail because the dispatch path does not yet handle `task.start`.

- [ ] **Step 3: Implement the exact start validation sequence**

In `start.ts`, resolve the canonical graph task, check `isTaskTransitionAllowed(task.status, "running")`, then look up `activeLeaseByTaskId.get(taskId)`. If absent return `{ ok: false, code: "LEASE_NOT_FOUND", commandId, leaseId }`. If `lease.id !== command.payload.leaseId` or `lease.workerId !== command.payload.workerId`, return `LEASE_MISMATCH`; do not inspect `assignedWorkerId`.

Only after these checks, create the candidate CoreState by calling `getTaskGraphSnapshot(currentCoreState)`, passing that defensive snapshot to `createCoreState(snapshot)`, and using the returned candidate handle. Never clone or inspect the current opaque handle. Obtain the dispatch timestamp and Event ID, apply `claimed -> running` only to the candidate, construct one `task.started` Event with copied causal envelope and `{ taskId, workerId, leaseId }`, append it to the candidate log, replace private state, and return a cloned one-Event result. If candidate creation rejects a snapshot from a valid current handle, throw a programming/invariant error. Do not remove or replace the active Lease on start.

- [ ] **Step 4: Run GREEN, review the diff, and commit**

Run:

```bash
pnpm --filter @flowctl/control-plane test
pnpm --filter @flowctl/control-plane typecheck
git diff --check
```

Expected: start behavior passes, no Protocol/Core file appears in the diff, and no `assignedWorkerId` authority path exists.

```bash
git add packages/control-plane/src packages/control-plane/test/control-plane.test.ts
git commit -m "feat(control-plane): authorize task start by lease"
```

### Task 6: Implement complete-to-review and Lease removal

**Files:**
- Create: `packages/control-plane/src/complete.ts`
- Modify: `packages/control-plane/src/dispatch.ts`
- Modify: `packages/control-plane/test/control-plane.test.ts`

**Interfaces:**
- Consumes: the same private state, staging, and Lease authority helpers used by start; Protocol `task.complete` and `task.review_requested`.
- Produces: complete handling for `running -> review`, removal from `activeLeaseByTaskId`, and exactly one `task.review_requested` Event.

- [ ] **Step 1: Write failing complete tests**

Build a running control plane through claim and start. Add:

```ts
test("completes implementation into review and removes the active Lease", () => {
  const { controlPlane, leaseId } = makeRunningControlPlane();
  const result = ControlPlane.dispatchCommand(
    controlPlane,
    makeCompleteCommand({ leaseId, workerId: "W1" })
  );

  assert.deepEqual(result.ok && result.events.map((event) => event.type), ["task.review_requested"]);
  assert.equal(ControlPlane.getTaskGraphSnapshot(controlPlane).tasks.A?.status, "review");

  const history = ControlPlane.getEventLogSnapshot(controlPlane);
  assert.deepEqual(history.map((event) => event.type), [
    "lease.created",
    "task.claimed",
    "task.started",
    "task.review_requested"
  ]);
  assert.equal(history.some((event) => event.type === "task.completed"), false);
});
```

Add tests for complete without Lease, wrong Lease ID, wrong Worker ID, and complete outside `running`. Prove rejected complete leaves both graph and Event Log unchanged. The required black-box claim test below is the Lease-removal proof; do not rely only on a later start/complete rejection, do not add an inactive-Lease store, and do not add a `lease.released` Event.

The required black-box removal proof is a new claim after completion:

```ts
const claimAgain = ControlPlane.dispatchCommand(
  controlPlane,
  makeClaimCommand({ taskId: "A", workerId: "W2" })
);

assert.equal(claimAgain.ok, false);
if (!claimAgain.ok) assert.equal(claimAgain.code, "TASK_NOT_READY");
```

Because claim checks an active Lease before readiness, `TASK_NOT_READY` proves that the old Lease was removed without exposing `activeLeaseByTaskId`; an incorrectly retained Lease would produce `TASK_ALREADY_LEASED`.

- [ ] **Step 2: Run the complete RED**

Run:

```bash
pnpm --filter @flowctl/control-plane test
```

Expected: complete handling and Lease removal tests fail because `task.complete` is not yet dispatched.

- [ ] **Step 3: Implement complete using the start authority sequence**

Validate project in the dispatcher, then in `complete.ts` resolve the task, require `isTaskTransitionAllowed(task.status, "review")`, look up `activeLeaseByTaskId.get(taskId)`, return `LEASE_NOT_FOUND` when absent, and return `LEASE_MISMATCH` when the active Lease ID or Worker ID differs from the command. Only after those checks, stage the Core transition using the public snapshot → `createCoreState(snapshot)` sequence, generate one timestamp and one Event ID, apply `running -> review` only to the candidate, delete `candidate.activeLeaseByTaskId` at the canonical task key, append exactly one `task.review_requested`, commit, and return only that Event. If candidate creation rejects a snapshot from a valid current handle, throw a programming/invariant error rather than returning a domain result.

The Lease is removed, not marked inactive. Preserve the historical `lease.created` Event in the Event Log. Do not emit `task.completed`, `lease.released`, or `task.ready`, and do not promote B/C/D.

- [ ] **Step 4: Run GREEN, review, and commit**

Run:

```bash
pnpm --filter @flowctl/control-plane test
pnpm --filter @flowctl/control-plane typecheck
git diff --check
```

Expected: the milestone reaches `review`, the old Lease no longer authorizes anything, and no inactive-Lease storage appears.

```bash
git add packages/control-plane/src packages/control-plane/test/control-plane.test.ts
git commit -m "feat(control-plane): complete tasks into review"
```

### Task 7: Finalize generic dispatch and rejection precedence

**Files:**
- Modify: `packages/control-plane/src/dispatch.ts`
- Modify: `packages/control-plane/src/results.ts`
- Modify: `packages/control-plane/src/index.ts`
- Modify: `packages/control-plane/test/control-plane.test.ts`

**Interfaces:**
- Consumes: claim/start/complete handlers and all Protocol `FlowctlCommand` members.
- Produces: exhaustive support narrowing, common project-first dispatch, complete unsupported-command behavior, and the final public `CommandProcessingResult` contract.

- [ ] **Step 1: Add failing support and precedence tests**

Use one fixture for each unsupported Protocol command and assert no graph or Event Log mutation:

```ts
for (const command of [
  makeFailCommand(),
  makeBlockCommand(),
  makeHeartbeatCommand(),
  makeGraphMutationCommand()
]) {
  test(`rejects ${command.type} as unsupported`, () => {
    const { controlPlane } = makeReadyControlPlane();
    const beforeGraph = ControlPlane.getTaskGraphSnapshot(controlPlane);
    const beforeLog = ControlPlane.getEventLogSnapshot(controlPlane);
    const result = ControlPlane.dispatchCommand(controlPlane, command);

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "UNSUPPORTED_COMMAND");
    assert.deepEqual(ControlPlane.getTaskGraphSnapshot(controlPlane), beforeGraph);
    assert.deepEqual(ControlPlane.getEventLogSnapshot(controlPlane), beforeLog);
  });
}
```

Add the decisive pair:

```ts
test("project mismatch precedes unsupported-command detection", () => {
  const { controlPlane } = makeReadyControlPlane();
  const result = ControlPlane.dispatchCommand(
    controlPlane,
    makeGraphMutationCommand({ projectId: "OTHER" })
  );

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "PROJECT_MISMATCH");
});

test("a supported-project unsupported command returns UNSUPPORTED_COMMAND", () => {
  const { controlPlane } = makeReadyControlPlane();
  const result = ControlPlane.dispatchCommand(controlPlane, makeGraphMutationCommand());

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "UNSUPPORTED_COMMAND");
});
```

- [ ] **Step 2: Run the support RED**

Run:

```bash
pnpm --filter @flowctl/control-plane test
```

Expected: unsupported members and the project/support precedence case fail until the dispatcher is exhaustive.

- [ ] **Step 3: Implement common dispatch before command-specific validation**

Store the supported command type as a private union and implement a type predicate over `FlowctlCommand`:

```ts
type SupportedCommand = Extract<
  FlowctlCommand,
  { type: "task.claim" | "task.start" | "task.complete" }
>;

function isSupportedCommand(command: FlowctlCommand): command is SupportedCommand {
  return command.type === "task.claim"
    || command.type === "task.start"
    || command.type === "task.complete";
}
```

`dispatchCommand` must first compare `command.projectId` to the private project ID and return `PROJECT_MISMATCH`; only then call `isSupportedCommand` and return `UNSUPPORTED_COMMAND`; only then narrow to the three handlers. Keep all command-specific task/Lease/lifecycle checks inside their handlers.

Ensure every accepted handler returns only current-dispatch Events, while the private append helper accumulates those Events in the Event Log. Preserve the exact result fields from Task 4 and do not introduce `LEASE_EXPIRED`.

- [ ] **Step 4: Add discriminated-union narrowing tests**

Use `switch (result.code)` and `switch (event.type)` in tests or private assertions to exercise the public unions. Include an exhaustive `never` helper:

```ts
function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}
```

The tests must verify `CommandProcessingResult` fields for each relevant code and event payload narrowing by `type`; do not add a type-testing dependency.

- [ ] **Step 5: Run GREEN and commit dispatch finalization**

Run:

```bash
pnpm --filter @flowctl/control-plane test
pnpm --filter @flowctl/control-plane typecheck
```

Expected: all supported/unsupported commands, common precedence, result unions, and atomic rejection tests pass.

```bash
git add packages/control-plane/src packages/control-plane/test/control-plane.test.ts
git commit -m "feat(control-plane): finalize command dispatch precedence"
```

### Task 8: Prove the complete milestone and package facade

**Files:**
- Modify: `packages/control-plane/src/index.ts`
- Modify: `packages/control-plane/test/control-plane.test.ts`

**Interfaces:**
- Consumes: all completed Control Plane APIs and Protocol/Core workspace packages.
- Produces: the final public facade and an end-to-end acceptance test that proves the frozen Incremento #3 boundary.

- [ ] **Step 1: Add the mandatory end-to-end test**

Add one test that starts from A=`ready`, B/C/D=`pending` and executes the exact sequence:

```ts
const claim = ControlPlane.dispatchCommand(controlPlane, makeClaimCommand());
const leaseId = getLeaseId(claim);
const start = ControlPlane.dispatchCommand(
  controlPlane,
  makeStartCommand({ leaseId, workerId: "W1" })
);
const complete = ControlPlane.dispatchCommand(
  controlPlane,
  makeCompleteCommand({ leaseId, workerId: "W1" })
);
```

Assert:

```ts
assert.equal(ControlPlane.getTaskGraphSnapshot(controlPlane).tasks.A?.status, "review");
assert.equal(ControlPlane.getTaskGraphSnapshot(controlPlane).tasks.B?.status, "pending");
assert.equal(ControlPlane.getTaskGraphSnapshot(controlPlane).tasks.C?.status, "pending");
assert.equal(ControlPlane.getTaskGraphSnapshot(controlPlane).tasks.D?.status, "pending");
assert.deepEqual(claim.ok && claim.events.map((event) => event.type), ["lease.created", "task.claimed"]);
assert.deepEqual(start.ok && start.events.map((event) => event.type), ["task.started"]);
assert.deepEqual(complete.ok && complete.events.map((event) => event.type), ["task.review_requested"]);
assert.deepEqual(
  ControlPlane.getEventLogSnapshot(controlPlane).map((event) => event.type),
  ["lease.created", "task.claimed", "task.started", "task.review_requested"]
);
assert.equal(ControlPlane.getEventLogSnapshot(controlPlane).some((event) => event.type === "task.ready"), false);
assert.equal(ControlPlane.getEventLogSnapshot(controlPlane).some((event) => event.type === "task.completed"), false);
```

Also assert that the result of each dispatch contains only that dispatch's Events and never the prior accumulated history.

- [ ] **Step 2: Finalize the public facade exports**

`packages/control-plane/src/index.ts` must export only the intended public surface:

```ts
export { createControlPlane, getTaskGraphSnapshot } from "./control-plane.js";
export { dispatchCommand } from "./dispatch.js";
export { getEventLogSnapshot } from "./event-log.js";
export type {
  CommandProcessingResult,
  ControlPlaneCreationResult,
  ControlPlaneOptions
} from "./results.js";
export type { ControlPlane } from "./state.js";
```

Do not export private state, active-Lease storage, staging helpers, command handlers, CoreState, or Event Log internals. Confirm `createControlPlane` accepts only a `TaskGraph` and options.

- [ ] **Step 3: Run the complete internal validation**

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

Expected: the full workspace suite passes, TypeScript emits no errors, all packages build from the checkout, and `git diff --check` is clean.

- [ ] **Step 4: Run the real public-import smoke test after build**

Run exactly after `pnpm build`:

```bash
node --input-type=module -e 'const api = await import("@flowctl/control-plane"); for (const name of ["createControlPlane", "getTaskGraphSnapshot", "dispatchCommand", "getEventLogSnapshot"]) { if (typeof api[name] !== "function") throw new Error(`Missing public export: ${name}`); } console.log("@flowctl/control-plane public import passed");'
```

This is the only test that resolves the package through its `exports` entry; internal tests continue to use `../src/index.js`.

- [ ] **Step 5: Validate a clean archive checkout**

Run this exact sequence from the repository root after the implementation commits exist. It creates a temporary checkout from Git, so ignored `dist` and `dist-test` directories from the working tree are not present:

```bash
CLEAN_CHECKOUT_DIR="$(mktemp -d /tmp/flowctl-control-plane-clean.XXXXXX)"
git archive --format=tar HEAD | tar -x -C "$CLEAN_CHECKOUT_DIR"
cd "$CLEAN_CHECKOUT_DIR"
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
node --input-type=module -e 'const api = await import("@flowctl/control-plane"); for (const name of ["createControlPlane", "getTaskGraphSnapshot", "dispatchCommand", "getEventLogSnapshot"]) { if (typeof api[name] !== "function") throw new Error(`Missing public export: ${name}`); } console.log("@flowctl/control-plane clean-checkout public import passed");'
```

Expected: install/workspace resolution, tests, typecheck, build, and public package import all pass from the archive checkout without relying on pre-existing compilation artifacts. Record the temporary checkout path and return to the original repository before continuing the review.

- [ ] **Step 6: Perform final scope and ownership review**

Run:

```bash
git status --short --branch
git diff --name-only origin/main..HEAD -- packages/protocol packages/core
rg -n "zod|zod-to|scheduler|worker pool|heartbeat|lease\.expired|lease\.released|task\.completed|GraphMutation|fetch\(|WebSocket|Event Store|database|Planner|LLM|Intent" packages/control-plane/src packages/control-plane/test
```

The Protocol/Core path query must be empty. Review the source to confirm there is no scheduler, runtime schema, adapter, transport, persistence, or GraphMutation application. The grep may match explicit rejection tests or comments; inspect matches and ensure they are scope assertions, not implementations.

- [ ] **Step 7: Commit the final facade and acceptance coverage**

```bash
git add packages/control-plane
git commit -m "test(control-plane): prove v0 execution milestone"
```

## Plan Self-Review

Before execution, verify this plan against every spec section:

- Section 1: Tasks 2 and 8 preserve A/B/C/D initialization and prove the exact `ready -> claimed -> running -> review` milestone.
- Section 2: Task 1 restricts production dependencies to Protocol/Core and leaves frozen packages untouched.
- Sections 3–4: Task 2 brands ControlPlane and privately owns CoreState; Tasks 4–6 stage candidates through the public Core snapshot → `createCoreState(snapshot)` sequence and store `activeLeaseByTaskId`.
- Section 5: Task 2 preserves statuses, empty log, no Lease, no readiness promotion, and no `task.ready`.
- Section 6: Task 7 covers every unsupported Protocol command.
- Section 7: Tasks 4–7 enforce project-first support checks, atomic staging, generator-failure safety, and no partial mutation.
- Section 8: Task 4 defines exact creation/dispatch result unions; Task 7 tests discriminated narrowing and exhaustive event handling.
- Sections 9–12: Tasks 4–6 implement claim precedence, Lease authority, start, complete-to-review, exact Event order, and Lease removal.
- Sections 13–14: Task 3 proves the empty-log and array boundary; Tasks 4–8 cover causal Command copying, deterministic IDs/timestamps, current-dispatch result Events, accumulated Event Log history, nested Lease copies, and snapshot defensive copies.
- Section 15: Task 4 fixes generator order; all tasks use injected dependencies and no collision retry.
- Section 16: Task 8 exposes only the four public functions and public result/options/handle types.
- Section 17: Tasks 2–8 cover all listed acceptance and adversarial cases, including project-plus-unsupported precedence, inherited own-key lookup regression, black-box Lease removal, and post-dispatch Command mutation.
- Sections 18–20: the Global Constraints and final scope review explicitly exclude every listed future subsystem and preserve all architectural invariants.

Placeholder scan: no placeholder markers or unspecified implementation steps remain. Every behavior has an owning file, public/private interface, RED command, GREEN command, and commit boundary. No task clones or inspects an opaque CoreState handle.

Execution rule: after each task, run the task's tests and typecheck, review the diff against the spec, resolve findings, and commit before starting the next task. At Task 8, run the full workspace validation and the package-resolution smoke test before claiming completion.
