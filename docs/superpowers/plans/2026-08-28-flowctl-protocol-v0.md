# FlowCTL Protocol v0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the pnpm TypeScript monorepo foundation and implement the dependency-free `@flowctl/protocol` Protocol v0 contract.

**Architecture:** Keep the protocol as small, behavior-free TypeScript declarations split by domain responsibility. Compile source and tests with strict TypeScript; run compiled tests with Node's built-in `node:test`. Keep `apps/` and `adapters/` as reserved concepts only, without artificial files or executable structure.

**Tech Stack:** Node.js, pnpm workspaces, TypeScript strict mode, Node `node:test`, Node `node:assert/strict`.

**Spec:** `docs/superpowers/specs/2026-08-28-flowctl-protocol-v0-design.md`

## Global Constraints

- Use Node.js, TypeScript strict mode, and pnpm workspaces.
- Keep `@flowctl/protocol` free of production dependencies.
- Export `PROTOCOL_VERSION = "0.1" as const` as the protocol version source of truth.
- Keep `parentId` exclusively for hierarchy and `dependencies` exclusively for execution prerequisites.
- `dependencies` contains IDs of tasks on which the current task depends.
- Do not add a second edge collection to `TaskGraph`.
- Commands are requests; events are confirmed facts.
- `Actor` identifies the command/event originator; payload `workerId` identifies the worker involved.
- `task.claim` remains a request containing `taskId` and `workerId`; it grants no authority and the future Core may accept or reject it.
- Do not implement Core, scheduler behavior, state machines, graph validation, cycle detection, lease management, timers, APIs, storage, UI, desktop, overlay, adapters, LLM behavior, parallel execution, or a complete CLI.
- Do not add runtime schemas or runtime validation dependencies.
- Keep `task.update` limited to `title`, `description`, `parentId`, `level`, and `acceptanceCriteria`.
- `dependency.add(taskId, dependsOnTaskId)` means `taskId` depends on `dependsOnTaskId`.
- Include `task.review_requested` as a contract only; do not implement review behavior.

## File Map

- Create `package.json`: private workspace scripts and the root TypeScript development dependency.
- Create `pnpm-workspace.yaml`: workspace package discovery for `packages/*`.
- Create `tsconfig.base.json`: shared strict compiler settings.
- Create `.gitignore`: generated artifacts, dependencies, and local files.
- Modify `README.md`: FlowCTL purpose, future direction, and Protocol v0 status.
- Create `packages/protocol/package.json`: package metadata, exports, and package scripts.
- Create `packages/protocol/tsconfig.json`: source build configuration.
- Create `packages/protocol/tsconfig.test.json`: source-plus-test compilation configuration.
- Create `packages/protocol/src/project.ts`: `Project`.
- Create `packages/protocol/src/task.ts`: task levels, statuses, criteria, and `Task`.
- Create `packages/protocol/src/graph.ts`: `TaskGraph`.
- Create `packages/protocol/src/worker.ts`: worker providers, statuses, and `Worker`.
- Create `packages/protocol/src/lease.ts`: `Lease`.
- Create `packages/protocol/src/mutation.ts`: mutation operations and `GraphMutation`.
- Create `packages/protocol/src/command.ts`: command envelope, command payloads, and `FlowctlCommand`.
- Create `packages/protocol/src/event.ts`: actor, event envelope, event payloads, and `FlowctlEvent`.
- Create `packages/protocol/src/index.ts`: public type exports and `PROTOCOL_VERSION`.
- Create `packages/protocol/test/protocol.test.ts`: runtime representation tests and TypeScript narrowing/exhaustiveness checks.

### Task 1: Scaffold the workspace and test harness

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `packages/protocol/package.json`
- Create: `packages/protocol/tsconfig.json`
- Create: `packages/protocol/tsconfig.test.json`

**Interfaces:**
- Produces a private pnpm workspace containing the `@flowctl/protocol` package.
- Produces root scripts named `build`, `typecheck`, and `test`.
- Produces package scripts named `build`, `typecheck`, `build:test`, and `test`.

- [ ] **Step 1: Add the workspace configuration and a compile-time smoke test expectation**

Create the root package as a private ESM workspace with these scripts:

```json
{
  "name": "flowctl",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "pnpm --filter @flowctl/protocol build",
    "typecheck": "pnpm --filter @flowctl/protocol typecheck",
    "test": "pnpm --filter @flowctl/protocol test"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.0.0"
  }
}
```

Create `pnpm-workspace.yaml` with `packages: ["packages/*"]`. Configure strict
NodeNext compilation in `tsconfig.base.json`, including declarations,
`noEmitOnError`, `isolatedModules`, `verbatimModuleSyntax`, and consistent
casing. Ignore `node_modules/`, `dist/`, `dist-test/`, package-manager logs,
and local environment files.

- [ ] **Step 2: Install the workspace development tools**

Run: `pnpm install`

Expected: pnpm creates the workspace lockfile and installs only the root
development tools needed to compile strict TypeScript and Node tests. The
`@flowctl/protocol` package must still have no production dependencies.

- [ ] **Step 3: Add the package metadata and compiler configs**

Create `packages/protocol/package.json` with no `dependencies`, ESM metadata,
the public entrypoint, and scripts that compile source to `dist`, compile
source plus tests to `dist-test`, then run Node's test runner:

```json
{
  "name": "@flowctl/protocol",
  "version": "0.1.0",
  "private": true,
  "type": "module",
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
    "test": "pnpm run build:test && node --test dist-test/test"
  }
}
```

Set `tsconfig.json` to extend the root config, include `src/**/*.ts`, use
`src` as `rootDir`, and emit declarations to `dist`. Set
`tsconfig.test.json` to include both `src/**/*.ts` and `test/**/*.ts`, use the
package directory as `rootDir`, emit to `dist-test`, and disable declarations.

- [ ] **Step 4: Run the empty build to verify the expected missing-source failure**

Run: `pnpm --filter @flowctl/protocol build`

Expected: FAIL because `packages/protocol/src` and its entrypoint do not yet
exist. This confirms the package script is wired before source implementation.

- [ ] **Step 5: Run the compiler and record the source-not-found failure**

Run: `pnpm --filter @flowctl/protocol typecheck`

Expected: FAIL only because the package has no source entrypoint yet. Do not
silence the failure with placeholder runtime code.

- [ ] **Step 6: Commit the workspace scaffold**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json .gitignore packages/protocol/package.json packages/protocol/tsconfig.json packages/protocol/tsconfig.test.json
git commit -m "chore: scaffold FlowCTL TypeScript workspace"
```

### Task 2: Implement the domain contracts and prove graph representation

**Files:**
- Create: `packages/protocol/src/project.ts`
- Create: `packages/protocol/src/task.ts`
- Create: `packages/protocol/src/graph.ts`
- Create: `packages/protocol/src/worker.ts`
- Create: `packages/protocol/src/lease.ts`
- Create: `packages/protocol/test/protocol.test.ts`

**Interfaces:**
- Produces `Project`, `TaskLevel`, `TaskStatus`, `AcceptanceCriterion`, `Task`, `TaskGraph`, `WorkerProvider`, `WorkerStatus`, `Worker`, and `Lease`.
- Produces test fixtures that later command/event tests can reuse in the same test file.

- [ ] **Step 1: Write the failing domain representation tests**

Start `packages/protocol/test/protocol.test.ts` with imports from
`../src/index.js` and tests like these:

```ts
import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { Task, TaskGraph, Worker } from "../src/index.js";

test("represents the four-level task hierarchy and cross-branch dependencies", () => {
  const epic: Task = {
    id: "E1",
    level: "epic",
    title: "Authentication",
    status: "pending",
    dependencies: [],
    acceptanceCriteria: [],
    createdAt: "2026-08-28T00:00:00.000Z",
    updatedAt: "2026-08-28T00:00:00.000Z"
  };
  const backend: Task = { ...epic, id: "T1", parentId: epic.id, level: "task", title: "Backend" };
  const login: Task = { ...epic, id: "S1", parentId: backend.id, level: "subtask", title: "Login" };
  const signToken: Task = { ...epic, id: "A1", parentId: login.id, level: "atomic", title: "Sign token" };
  const frontend: Task = { ...epic, id: "T2", parentId: epic.id, level: "task", title: "Frontend" };
  const authContext: Task = {
    ...epic,
    id: "S2",
    parentId: frontend.id,
    level: "subtask",
    title: "Auth context",
    dependencies: [login.id]
  };

  const graph: TaskGraph = {
    projectId: "P1",
    rootTaskIds: [epic.id],
    tasks: Object.fromEntries([epic, backend, login, signToken, frontend, authContext].map((task) => [task.id, task]))
  };

  assert.equal(graph.tasks[authContext.id]?.dependencies[0], login.id);
  assert.equal(graph.tasks[signToken.id]?.parentId, login.id);
  assert.deepEqual(Object.keys(graph.tasks), ["E1", "T1", "S1", "A1", "T2", "S2"]);
});

test("uses one Worker contract for different providers", () => {
  const workers: Worker[] = [
    { id: "W1", provider: "codex", status: "idle" },
    { id: "W2", provider: "claude", status: "busy", currentTaskId: "T1" },
    { id: "W3", provider: "opencode", status: "offline" }
  ];

  assert.deepEqual(workers.map(({ provider }) => provider), ["codex", "claude", "opencode"]);
});
```

- [ ] **Step 2: Run the domain tests to verify they fail because public contracts are absent**

Run: `pnpm --filter @flowctl/protocol test`

Expected: FAIL during TypeScript compilation because `../src/index.js` and the
domain types do not exist yet.

- [ ] **Step 3: Implement the domain interfaces**

Define the exact literal unions and interfaces from the approved spec. Keep
`Task.dependencies: string[]` as prerequisite task IDs and do not add an edge
array to `TaskGraph`. Keep `capabilities` optional on `Worker`; include
`currentTaskId?`; and represent all lease timestamps as strings.

- [ ] **Step 4: Add the temporary public entrypoint needed by the tests**

Create `packages/protocol/src/index.ts` with type exports for the five domain
modules. The version constant and message-module exports will be added in
Task 3 after their definitions exist.

- [ ] **Step 5: Run the domain tests to verify the representation passes**

Run: `pnpm --filter @flowctl/protocol test`

Expected: PASS for the hierarchy, cross-branch dependency, DAG-shaped graph,
and shared worker-provider tests.

- [ ] **Step 6: Commit the domain contracts**

```bash
git add packages/protocol/src packages/protocol/test/protocol.test.ts
git commit -m "feat(protocol): add core domain contracts"
```

### Task 3: Implement mutations, commands, events, and discriminated unions

**Files:**
- Create: `packages/protocol/src/mutation.ts`
- Create: `packages/protocol/src/command.ts`
- Create: `packages/protocol/src/event.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/test/protocol.test.ts`

**Interfaces:**
- Consumes: domain types from Task 2 and `PROTOCOL_VERSION` from the package entrypoint.
- Produces `GraphMutation`, `GraphMutationOperation`, `CommandEnvelope`, `FlowctlCommand`, `Actor`, `EventEnvelope`, and `FlowctlEvent`.

- [ ] **Step 1: Extend the tests with failing mutation, command, event, and exhaustiveness checks**

Add runtime tests using concrete values and compile-time narrowing helpers:

```ts
import {
  PROTOCOL_VERSION,
} from "../src/index.js";
import type {
  Actor,
  FlowctlCommand,
  FlowctlEvent,
  GraphMutation,
  GraphMutationOperation,
} from "../src/index.js";

const actor: Actor = { type: "worker", id: "W1" };

function commandType(command: FlowctlCommand): string {
  switch (command.type) {
    case "task.claim":
      assert.equal(command.payload.workerId, "W1");
      return command.type;
    case "task.start":
    case "task.complete":
    case "task.fail":
    case "task.block":
    case "lease.heartbeat":
    case "graph.mutation.propose":
      return command.type;
  }
}

function eventType(event: FlowctlEvent): string {
  switch (event.type) {
    case "task.created":
    case "task.ready":
    case "task.claimed":
    case "task.started":
    case "task.review_requested":
    case "task.completed":
    case "task.failed":
    case "task.blocked":
    case "task.cancelled":
    case "lease.created":
    case "lease.expired":
    case "worker.connected":
    case "worker.disconnected":
    case "graph.mutation.proposed":
    case "graph.mutation.approved":
    case "graph.mutation.rejected":
      return event.type;
  }
}

test("commands and events narrow by their discriminant", () => {
  const mutation: GraphMutation = {
    id: "M1",
    sourceTaskId: "S1",
    reason: "The implementation needs a migration first.",
    operations: [
      {
        type: "task.create",
        task: {
          id: "A2",
          parentId: "S1",
          level: "atomic",
          title: "Create migration",
          status: "pending",
          dependencies: [],
          acceptanceCriteria: [],
          createdAt: "2026-08-28T00:00:00.000Z",
          updatedAt: "2026-08-28T00:00:00.000Z"
        }
      },
      { type: "dependency.add", taskId: "S1", dependsOnTaskId: "A2" }
    ]
  };
  const command: FlowctlCommand = {
    id: "C1",
    protocolVersion: "0.1",
    timestamp: "2026-08-28T00:00:00.000Z",
    projectId: "P1",
    actor,
    type: "graph.mutation.propose",
    payload: { mutation }
  };
  const proposed: FlowctlEvent = {
    id: "EV1",
    protocolVersion: "0.1",
    timestamp: "2026-08-28T00:00:00.000Z",
    projectId: "P1",
    actor: { type: "system", id: "core" },
    type: "graph.mutation.proposed",
    payload: { mutation }
  };
  const approved: FlowctlEvent = {
    ...proposed,
    id: "EV2",
    type: "graph.mutation.approved",
    payload: { mutation }
  };

  assert.equal(PROTOCOL_VERSION, "0.1");
  assert.equal(commandType(command), "graph.mutation.propose");
  assert.equal(eventType(proposed), "graph.mutation.proposed");
  assert.equal(eventType(approved), "graph.mutation.approved");
});

test("represents all mutation operations and the limited update patch", () => {
  const operations: GraphMutationOperation[] = [
    { type: "task.create", task: {} as never },
    { type: "dependency.add", taskId: "T2", dependsOnTaskId: "T1" },
    { type: "dependency.remove", taskId: "T2", dependsOnTaskId: "T1" },
    { type: "task.update", taskId: "T2", changes: { title: "Updated" } }
  ];

  assert.deepEqual(operations.map(({ type }) => type), [
    "task.create",
    "dependency.add",
    "dependency.remove",
    "task.update"
  ]);
});
```

The `{} as never` fixture is acceptable only in this test because the test is
checking operation discrimination rather than constructing a real task; all
production contracts must remain fully typed. Add a compile-time negative
check comment or `@ts-expect-error` assertion showing that an update patch
cannot include `status`, `dependencies`, `assignedWorkerId`, timestamps, or
lease fields.

- [ ] **Step 2: Run the extended tests to verify missing message contracts fail**

Run: `pnpm --filter @flowctl/protocol test`

Expected: FAIL during TypeScript compilation because mutation, command, and
event modules and the complete public exports do not exist yet.

- [ ] **Step 3: Implement `GraphMutation` and its operation union**

Define:

```ts
type TaskUpdatePatch = Partial<
  Pick<Task, "title" | "description" | "parentId" | "level" | "acceptanceCriteria">
>;

interface GraphMutation {
  id: string;
  sourceTaskId?: string;
  reason: string;
  operations: GraphMutationOperation[];
}
```

Use `task.create`, `dependency.add`, `dependency.remove`, and `task.update`
literal discriminants. `dependency.add(taskId, dependsOnTaskId)` must preserve
the prerequisite direction. Do not put envelope fields or lease information
inside `GraphMutation`.

- [ ] **Step 4: Implement the command envelope and complete command union**

Define `CommandEnvelope` using `protocolVersion: typeof PROTOCOL_VERSION` and
the shared `Actor`. Add exactly these command types and typed payloads:
`task.claim`, `task.start`, `task.complete`, `task.fail`, `task.block`,
`lease.heartbeat`, and `graph.mutation.propose`. Keep `task.claim` as a
request with `taskId` and `workerId`; do not model it as authority or a lease.

- [ ] **Step 5: Implement the event envelope and complete event union**

Define `Actor`, `ActorType`, and `EventEnvelope` using the same version literal.
Add events for all required task, lease, worker, and mutation facts, plus
`task.review_requested`. Ensure the mutation payloads are exactly:

```ts
"graph.mutation.proposed" // payload: { mutation: GraphMutation }
"graph.mutation.approved" // payload: { mutation: GraphMutation }
"graph.mutation.rejected" // payload: { mutationId: string; reason: string }
```

Use these payload shapes for the remaining events:

```ts
"task.created"           // { task: Task }
"task.ready"             // { taskId: string }
"task.claimed"           // { taskId: string; workerId: string; leaseId: string }
"task.started"           // { taskId: string; workerId: string; leaseId: string }
"task.review_requested"  // { taskId: string; workerId: string; leaseId: string }
"task.completed"         // { taskId: string; workerId: string; leaseId: string }
"task.failed"            // { taskId: string; workerId: string; leaseId: string; reason: string }
"task.blocked"           // { taskId: string; workerId: string; leaseId: string; reason: string }
"task.cancelled"         // { taskId: string; reason?: string }
"lease.created"          // { lease: Lease }
"lease.expired"          // { leaseId: string; taskId: string; workerId: string }
"worker.connected"       // { worker: Worker }
"worker.disconnected"    // { workerId: string }
```

- [ ] **Step 6: Complete the public exports**

Export `PROTOCOL_VERSION` as a runtime value and export every public contract
as a type from `src/index.ts`, including complete `FlowctlCommand` and
`FlowctlEvent` unions. Export `TaskUpdatePatch` if useful to consumers; do not
export private helper implementation details.

- [ ] **Step 7: Run the full package tests and typecheck**

Run: `pnpm --filter @flowctl/protocol test`

Expected: PASS for all representation tests, including the command/event
narrowing and complete union handling.

Run: `pnpm --filter @flowctl/protocol typecheck`

Expected: PASS with strict TypeScript and no generated output changes.

- [ ] **Step 8: Commit the protocol messages**

```bash
git add packages/protocol/src packages/protocol/test/protocol.test.ts
git commit -m "feat(protocol): add Protocol v0 messages"
```

### Task 4: Document the public contract and perform release verification

**Files:**
- Modify: `README.md`
- Create: `docs/protocol-v0.md`
- Modify: `packages/protocol/test/protocol.test.ts` if a final public-export assertion is needed

**Interfaces:**
- Consumes the completed public package surface from Tasks 2 and 3.
- Produces user-facing Protocol v0 documentation and a repository-level release checklist result.

- [ ] **Step 1: Add the public documentation/export coverage assertion**

Add a test that imports `Project`, `Task`, `TaskGraph`, `Worker`, `Lease`,
`FlowctlCommand`, `FlowctlEvent`, and `GraphMutation` through
`../src/index.js`, then creates a value using each. The test must also assert
`PROTOCOL_VERSION === "0.1"`. Use this shape for the version and public-import
assertions:

```ts
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { PROTOCOL_VERSION } from "../src/index.js";
import type {
  FlowctlCommand,
  FlowctlEvent,
  GraphMutation,
  Lease,
  Project,
  Task,
  TaskGraph,
  Worker
} from "../src/index.js";

test("exports the complete public protocol surface", () => {
  const project = {} as Project;
  const task = {} as Task;
  const graph = {} as TaskGraph;
  const worker = {} as Worker;
  const lease = {} as Lease;
  const mutation = {} as GraphMutation;
  const command = {} as FlowctlCommand;
  const event = {} as FlowctlEvent;

  assert.equal(PROTOCOL_VERSION, "0.1");
  assert.ok(project && task && graph && worker && lease && mutation && command && event);
});
```

- [ ] **Step 2: Run the export test before documentation changes**

Run: `pnpm --filter @flowctl/protocol test`

Expected: PASS after the message contracts are complete. If it fails, add the
missing public export before proceeding. Documentation is not used to mask a
type failure.

- [ ] **Step 3: Write concise Protocol v0 documentation**

Create `docs/protocol-v0.md` covering the protocol purpose, project/task
concepts, hierarchy versus prerequisite dependencies, workers, leases,
commands versus events, graph mutation proposals, versioning, and the explicit
out-of-scope list. Include one small example for `T4.dependencies`, one
command-to-event flow, and one dynamic mutation proposal. State that the
Protocol declares contracts only and performs no semantic validation.

Update `README.md` with:

```text
Codex ──────┐
Claude ─────┼──→ FlowCTL Core ──→ Desktop / Overlay
OpenCode ───┘
```

Describe FlowCTL as a visual and control layer for coding-agent workflows and
label the current status `Protocol v0 / early MVP`. Do not promise Core,
scheduler, adapter, desktop, or overlay behavior.

- [ ] **Step 4: Run the package and repository checks**

Run: `pnpm install --lockfile-only`

Expected: pnpm resolves the workspace lockfile without adding production
dependencies to `@flowctl/protocol`.

Run: `pnpm test`

Expected: PASS for all Node `node:test` contract tests.

Run: `pnpm typecheck`

Expected: PASS with strict TypeScript.

Run: `pnpm build`

Expected: PASS and emit only the package build artifacts under
`packages/protocol/dist`.

- [ ] **Step 5: Review the complete diff and out-of-scope boundaries**

Run:

```bash
git diff --check HEAD~4..HEAD
git status --short
rg -n 'scheduler|state machine|cycle|Fastify|WebSocket|React|Tauri|Prisma|Redis|adapter' packages/protocol README.md docs/protocol-v0.md
```

Confirm there are no conflict markers, no generated files staged, no runtime
dependencies, no classes, no semantic validators, no Core implementation, and
no executable files under `apps/` or `adapters/`.

- [ ] **Step 6: Commit documentation and final test coverage**

```bash
git add README.md docs/protocol-v0.md packages/protocol/test/protocol.test.ts pnpm-lock.yaml
git commit -m "docs: document FlowCTL Protocol v0"
```

## Final Verification Checklist

- [ ] `pnpm test` passes.
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm build` passes.
- [ ] Public imports work from `@flowctl/protocol`.
- [ ] `PROTOCOL_VERSION` is the single exported version source.
- [ ] `FlowctlCommand` and `FlowctlEvent` are complete discriminated unions.
- [ ] `task.review_requested` exists only as an event contract.
- [ ] `task.update` cannot patch Core-controlled fields.
- [ ] `parentId` and `dependencies` remain separate concepts.
- [ ] No `@flowctl/core` or out-of-scope runtime was added.
