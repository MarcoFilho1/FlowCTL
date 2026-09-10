# FlowCTL Execution Boundary + Failure Finalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Add a provider-neutral, one-shot asynchronous execution boundary that admits one Task through the Control Plane, runs one configured Adapter attempt, and finalizes success or failure through existing lifecycle Commands.

**Architecture:** Add @flowctl/execution above @flowctl/control-plane. The ExecutionCoordinator uses only public Control Plane APIs, extracts Lease identity from accepted public Events, passes a defensive Task snapshot to an AgentAdapter, and maps outcomes to task.complete or the existing task.fail Command. The only upstream behavior change is Control Plane support for task.fail; Protocol, Core, and Playground remain unchanged.

**Tech Stack:** TypeScript strict mode, NodeNext ESM, Node built-ins for workspace checks, pnpm workspaces, and Node node:test with deterministic FakeAdapter test support. No provider SDK, subprocess, network, runtime schema, or new production dependency outside the workspace packages.

**Spec:** docs/superpowers/specs/2026-09-09-flowctl-execution-boundary-design.md

## Global Constraints

- Implement Increment #6a only; do not implement #6b or any provider adapter.
- Core = lifecycle/readiness authority.
- Control Plane = Command/Lease/Event authority.
- ExecutionCoordinator = temporal orchestration only.
- AgentAdapter = external execution boundary only.
- Coordinator code uses public Control Plane APIs and public Protocol types only.
- The Coordinator never mutates Core, TaskGraph, Task status, Lease storage, or Control Plane internals.
- The Adapter never dispatches lifecycle Commands and never accesses Control Plane state.
- task.fail is the only Control Plane behavior added; use the existing Protocol Command/Event and existing Core transitions.
- Accepted failure is terminal: claimed/running -> failed, with active Lease removal in the same Control Plane commit.
- Success means task.complete was accepted and the Task entered review; never auto-approve review.
- Every unsuccessful exit after accepted task.start attempts task.fail when a trusted Lease identity and permitted lifecycle are available.
- Missing trusted Lease identity is invariant_error with no fabricated Lease, no private lookup, and no task.fail.
- A trusted Lease plus a post-claim invariant failure attempts task.fail before returning invariant_error.
- Concurrency is at most one in-flight executeTask per Coordinator instance; no global worker uniqueness or cross-Coordinator exclusion is added.
- executeTask(taskId, { signal? }) forwards the caller signal unchanged; no internal timer or AbortController is added.
- packages/protocol/**, packages/core/**, and apps/playground/** remain unchanged.
- Do not add Codex, Claude, OpenCode, @flowctl/adapter-codex, ProcessRunner, child_process, JSONL, stdout/stderr capture, provider auth, sandbox configuration, or real-agent smoke.
- Do not add Worker Registry, worker pool, scheduler daemon, polling, executeNext, retry, requeue, lease.release, heartbeat, expiry, reassignment, persistence, transport, UI, Planner, LLM, or GraphMutation application.
- Expected domain outcomes use discriminated unions; Adapter exceptions are normalized before failure finalization.
- CI remains provider-free: no Codex installation, token, network, subprocess, or real workspace.

---

## Repository map and rules

The current Control Plane source uses these focused modules:

```text
packages/control-plane/src/claim.ts
packages/control-plane/src/start.ts
packages/control-plane/src/complete.ts
packages/control-plane/src/review-approve.ts
packages/control-plane/src/dispatch.ts
packages/control-plane/src/results.ts
packages/control-plane/src/state.ts
packages/control-plane/src/control-plane.ts
packages/control-plane/src/event-log.ts
packages/control-plane/src/command-copy.ts
packages/control-plane/src/task-lookup.ts
```

The current package scripts are:

```bash
pnpm --filter @flowctl/control-plane test
pnpm --filter @flowctl/control-plane typecheck
pnpm --filter @flowctl/control-plane build
```

Execution tests import the execution source facade through ../src/index.js, the public Control Plane through @flowctl/control-plane, and Protocol through @flowctl/protocol. The execution package builds Control Plane before its own test build, so tests do not depend on stale output.

## Public interfaces fixed before dependent tasks

Task 2 defines these names and signatures; later tasks use them unchanged:

```text
interface AgentAdapter {
  execute(input: ExecutionInput): Promise<ExecutionResult>;
}

type ExecutionInput = Readonly<{
  projectId: string;
  taskId: string;
  task: Readonly<Task>;
  leaseId: string;
  workerId: string;
  workspacePath: string;
  signal?: AbortSignal;
}>;

type ExecutionResult =
  | { kind: "succeeded" }
  | {
      kind: "failed";
      reason: "execution_failed" | "timeout" | "aborted" | "unavailable";
      message: string;
    };

interface ExecutionCoordinatorOptions {
  controlPlane: ControlPlane;
  workerId: string;
  adapter: AgentAdapter;
  workspacePath: string;
  actor: Actor;
  nextCommandId: () => string;
  now: () => string;
}

interface ExecuteTaskOptions {
  signal?: AbortSignal;
}

interface ExecutionCoordinator {
  executeTask(
    taskId: string,
    options?: ExecuteTaskOptions
  ): Promise<ExecutionAttemptResult>;
}

type ExecutionCoordinatorCreationResult =
  | { ok: true; coordinator: ExecutionCoordinator }
  | {
      ok: false;
      code: "INVALID_WORKSPACE";
      workspacePath: string;
      reason: "NOT_ABSOLUTE" | "NOT_FOUND" | "NOT_DIRECTORY";
    };
```

ExecutionAttemptResult is a flat discriminated union with exactly these semantic variants:

```text
worker_busy
admission_rejected
start_rejected_finalized
start_rejected_unfinalized
submitted_for_review
completion_rejected_finalized
completion_rejected_unfinalized
execution_failed_finalized
execution_failed_unfinalized
invariant_error
```

Command-bearing variants use narrowed public CommandProcessingResult values. invariant_error carries taskId, stage, message, and an optional finalization result. Missing Lease identity has no finalization result; trusted Lease paths carry finalized or rejected finalization context.

## Task 1: Control Plane task.fail support

**Files:**

- Create: packages/control-plane/src/fail.ts
- Modify: packages/control-plane/src/dispatch.ts
- Test: packages/control-plane/test/control-plane.test.ts

**Interfaces:**

- Consumes: existing task.fail Command, applyTaskTransition, isTaskTransitionAllowed, recreateCoreState, getCanonicalTask, active Lease state, copy helpers, and neighboring handler patterns.
- Produces: internal dispatchFailCommand(controlPlane, command); dispatchCommand routes task.fail; accepted failure returns the existing CommandProcessingResult success shape with one task.failed Event.

- [ ] **Step 1: Write the failing tests**

Remove makeFailCommand from the unsupportedCommands fixture. Extend makeFailCommand with id, projectId, taskId, workerId, leaseId, and reason overrides. Add these tests:

```ts
test("fails a claimed task and removes its Lease", () => {
  const { controlPlane, leaseId } = makeClaimedControlPlane();
  const result = ControlPlane.dispatchCommand(
    controlPlane,
    makeFailCommand({ leaseId, reason: "adapter_failed" })
  );

  assert.equal(result.ok, true);
  assert.equal(ControlPlane.getTaskGraphSnapshot(controlPlane).tasks.A?.status, "failed");
  assert.deepEqual(
    ControlPlane.getEventLogSnapshot(controlPlane).map((event) => event.type),
    ["lease.created", "task.claimed", "task.failed"]
  );
  const claimAfterFailure = ControlPlane.dispatchCommand(
    controlPlane,
    makeClaimCommand({ id: "C-after-fail" })
  );
  assert.equal(claimAfterFailure.ok, false);
  if (!claimAfterFailure.ok) assert.equal(claimAfterFailure.code, "TASK_NOT_READY");
});

test("fails a running task with the exact task.failed payload", () => {
  const { controlPlane, leaseId } = makeRunningControlPlane();
  const result = ControlPlane.dispatchCommand(
    controlPlane,
    makeFailCommand({ id: "F-running", leaseId, reason: "execution_failed" })
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.events[0]?.payload, {
    taskId: "A",
    workerId: "W1",
    leaseId,
    reason: "execution_failed"
  });
});
```

Also add rejection and atomicity tests for foreign project, missing task, own-key IDs toString/constructor/__proto__, invalid lifecycle from ready, missing Lease, wrong Lease ID, and wrong Worker ID. For every rejection assert unchanged graph snapshot and unchanged Event Log.

- [ ] **Step 2: Run the focused tests to verify RED**

Run:

```bash
pnpm --filter @flowctl/control-plane test
```

Expected: FAIL because task.fail is still classified as UNSUPPORTED_COMMAND and no task.failed Event or terminal Lease cleanup exists.

- [ ] **Step 3: Implement the minimal failure handler**

Create fail.ts following start.ts and complete.ts:

```text
read current state
-> obtain Core graph snapshot
-> resolve canonical task by own key
-> validate claimed/running -> failed
-> read activeLeaseByTaskId.get(taskId)
-> validate Lease ID and Worker ID
-> recreate candidate CoreState through public Core APIs
-> applyTaskTransition(candidate, taskId, "failed", timestamp)
-> prepare one task.failed Event
-> delete taskId from candidate activeLeaseByTaskId
-> append copied Event
-> replace Control Plane state once
```

Preserve the current lifecycle-before-Lease validation order used by start and complete. Use copyActor, copyLease, and copyEvents. Expected domain failures remain discriminated results; no Protocol or Core type changes.

- [ ] **Step 4: Route task.fail through dispatch**

Update dispatch.ts so SupportedCommand includes task.fail and the switch calls dispatchFailCommand. Keep project mismatch before support detection and keep task.block, lease.heartbeat, and graph.mutation.propose unsupported.

- [ ] **Step 5: Run focused regression and package checks**

```bash
pnpm --filter @flowctl/control-plane test
pnpm --filter @flowctl/control-plane typecheck
pnpm --filter @flowctl/control-plane build
```

Expected: all Control Plane tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/control-plane/src/fail.ts packages/control-plane/src/dispatch.ts packages/control-plane/test/control-plane.test.ts
git commit -m "feat(control-plane): support task failure finalization"
```

## Task 2: Execution package contracts and workspace validation

**Files:**

- Create: packages/execution/package.json
- Create: packages/execution/tsconfig.json
- Create: packages/execution/tsconfig.test.json
- Create: packages/execution/src/index.ts
- Create: packages/execution/src/types.ts
- Create: packages/execution/src/workspace.ts
- Create: packages/execution/test/workspace.test.ts
- Modify: pnpm-lock.yaml through pnpm install

**Interfaces:**

- Consumes: public ControlPlane and CommandProcessingResult from @flowctl/control-plane, plus Task and Actor from @flowctl/protocol.
- Produces: the exact interfaces in the fixed-contract block and internal validateWorkspacePath(workspacePath).

- [ ] **Step 1: Create metadata and TypeScript configuration**

Create package metadata with only @flowctl/control-plane and @flowctl/protocol as production dependencies, package exports from dist, and scripts matching the existing package pattern:

```json
{
  "name": "@flowctl/execution",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "@flowctl/control-plane": "workspace:*",
    "@flowctl/protocol": "workspace:*"
  },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "prepare:control-plane": "pnpm --filter @flowctl/control-plane build",
    "prebuild": "pnpm run prepare:control-plane",
    "pretypecheck": "pnpm run prepare:control-plane",
    "prebuild:test": "pnpm run prepare:control-plane",
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "build:test": "tsc -p tsconfig.test.json",
    "test": "pnpm run build:test && node --test dist-test/test/*.test.js"
  }
}
```

Use tsconfig shapes from packages/control-plane. No runtime schema dependency.

- [ ] **Step 2: Implement types.ts and workspace.ts**

Define AgentAdapter, ExecutionInput, ExecutionResult, ExecutionCoordinatorOptions, ExecuteTaskOptions, ExecutionCoordinator, ExecutionCoordinatorCreationResult, and the ten-variant ExecutionAttemptResult. Narrow public CommandProcessingResult with local CommandSuccess and CommandFailure aliases.

Use node:path.isAbsolute and node:fs.statSync in validateWorkspacePath:

```text
relative path -> NOT_ABSOLUTE
missing path -> NOT_FOUND
file path -> NOT_DIRECTORY
existing directory -> valid
```

The helper never reads Task content and never creates worktrees.

- [ ] **Step 3: Write workspace tests**

Create workspace.test.ts with node:test and a temporary directory/file. Import the helper through ../src/workspace.js and prove:

```ts
assert.equal(validateWorkspacePath("relative/path").reason, "NOT_ABSOLUTE");
assert.equal(validateWorkspacePath("/path/that/does/not/exist").reason, "NOT_FOUND");
assert.equal(validateWorkspacePath(tempFile).reason, "NOT_DIRECTORY");
assert.equal(validateWorkspacePath(tempDirectory).ok, true);
```

- [ ] **Step 4: Run the focused package test**

```bash
pnpm install
pnpm --filter @flowctl/execution test
```

Expected: workspace tests and TypeScript test build pass. No Coordinator behavior is exercised yet.

- [ ] **Step 5: Run typecheck and build**

```bash
pnpm --filter @flowctl/execution typecheck
pnpm --filter @flowctl/execution build
```

- [ ] **Step 6: Commit**

```bash
git add packages/execution pnpm-lock.yaml
git commit -m "feat(execution): add provider-neutral execution contracts"
```

## Task 3: Coordinator admission, Lease extraction, fresh snapshot, and success

**Files:**

- Create: packages/execution/src/coordinator.ts
- Modify: packages/execution/src/index.ts
- Create: packages/execution/test/support/fake-adapter.ts
- Create: packages/execution/test/coordinator.test.ts

**Interfaces:**

- Consumes: Task 1 task.fail support; Task 2 contracts and workspace helper; public getTaskGraphSnapshot and dispatchCommand; public Protocol PROTOCOL_VERSION, Actor, FlowctlCommand, and FlowctlEvent.
- Produces: createExecutionCoordinator(options), executeTask(taskId, options?), public Lease extraction, defensive fresh Task input, start ordering, submitted_for_review, and the baseline returned execution_failed -> task.fail path.

- [ ] **Step 1: Write RED tests**

Create a valid fixture with ready epic A and temporary absolute workspace. FakeAdapter records inputs and returns succeeded. Write:

```ts
test("rejects a non-ready task before invoking the Adapter", async () => {
  const { coordinator, adapter } = makeExecutionFixture();
  const result = await coordinator.executeTask("B");

  assert.equal(result.kind, "admission_rejected");
  assert.equal(adapter.calls.length, 0);
});

test("extracts the Lease from claim Events and starts before Adapter execution", async () => {
  const { coordinator, adapter, controlPlane } = makeExecutionFixture();
  const result = await coordinator.executeTask("A");

  assert.equal(result.kind, "submitted_for_review");
  assert.equal(adapter.calls.length, 1);
  assert.equal(adapter.calls[0].taskId, "A");
  assert.equal(adapter.calls[0].leaseId, "L1");
  assert.equal(adapter.calls[0].workerId, "W1");
  assert.equal(adapter.calls[0].task.status, "claimed");
  assert.equal(
    ControlPlane.getTaskGraphSnapshot(controlPlane).tasks.A?.status,
    "review"
  );
});

test("success stops at REVIEW and never approves automatically", async () => {
  const { coordinator, controlPlane } = makeExecutionFixture();
  const result = await coordinator.executeTask("A");

  assert.equal(result.kind, "submitted_for_review");
  assert.equal(ControlPlane.getTaskGraphSnapshot(controlPlane).tasks.A?.status, "review");
  assert.deepEqual(
    ControlPlane.getEventLogSnapshot(controlPlane).map((event) => event.type),
    ["lease.created", "task.claimed", "task.started", "task.review_requested"]
  );
});

test("returned execution failure finalizes the admitted Task", async () => {
  const { coordinator, adapter, controlPlane } = makeExecutionFixture({
    adapterResult: {
      kind: "failed",
      reason: "execution_failed",
      message: "fake failure"
    }
  });
  const result = await coordinator.executeTask("A");

  assert.equal(result.kind, "execution_failed_finalized");
  assert.equal(adapter.calls.length, 1);
  assert.equal(ControlPlane.getTaskGraphSnapshot(controlPlane).tasks.A?.status, "failed");
  assert.deepEqual(
    ControlPlane.getEventLogSnapshot(controlPlane).map((event) => event.type),
    ["lease.created", "task.claimed", "task.started", "task.failed"]
  );
});
```

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @flowctl/execution test
```

Expected: FAIL because the factory and Coordinator orchestration do not yet exist.

- [ ] **Step 3: Implement the minimal success path**

Implement the factory with workspace validation and the Coordinator with this exact sequence:

```text
public graph snapshot -> projectId
-> task.claim
-> if rejected: admission_rejected, Adapter calls = 0
-> locate exactly matching lease.created in current claim Events
-> fresh public graph snapshot
-> canonical own-key Task lookup
-> task.start
-> if rejected: return start rejection for Task 4 finalization
-> defensive ExecutionInput
-> Adapter.execute
-> on succeeded: task.complete
-> on accepted complete: submitted_for_review
-> on returned failed: task.fail with the same Lease identity
-> on accepted task.fail: execution_failed_finalized
-> on rejected task.fail: execution_failed_unfinalized
```

Use Object.hasOwn for Task lookup. Construct Commands with PROTOCOL_VERSION, configured Actor, now(), nextCommandId(), graph projectId, workerId, and extracted leaseId. Never use Event Log history, assignedWorkerId, private Lease state, CoreState, or a pre-claim Task reference.

Production source imports only public Control Plane functions:

```ts
import {
  dispatchCommand,
  getTaskGraphSnapshot
} from "@flowctl/control-plane";
```

- [ ] **Step 4: Run focused tests and inspect declarations**

```bash
pnpm --filter @flowctl/execution test
pnpm --filter @flowctl/execution typecheck
pnpm --filter @flowctl/execution build
```

Expected: all admission, Lease, snapshot, ordering, and success tests pass; dist declarations expose only the planned facade.

- [ ] **Step 5: Add focused regressions**

Prove stale/non-ready/already-leased admission has zero Adapter calls; the Adapter sees claimed status and a fresh Task snapshot; mutation of Task arrays cannot affect future snapshots; mutation of returned Events cannot affect Event Log history; and no review approval Command is dispatched.

```bash
pnpm --filter @flowctl/execution test
```

- [ ] **Step 6: Commit**

```bash
git add packages/execution/src packages/execution/test
git commit -m "feat(execution): orchestrate admitted task success"
```

## Task 4: Failure normalization and terminal finalization

**Files:**

- Modify: packages/execution/src/coordinator.ts
- Modify: packages/execution/src/types.ts
- Create: packages/execution/src/test-support.ts
- Modify: packages/execution/test/support/fake-adapter.ts
- Modify: packages/execution/test/coordinator.test.ts

**Interfaces:**

- Consumes: task.fail support, fixed result unions, and Task 3 admission/start/success flow.
- Produces: generalized returned-failure, throw/rejection, start-rejection, and completion-rejection finalization with visible finalized/unfinalized variants; a minimal source-test Control Plane operations seam.

- [ ] **Step 1: Extend FakeAdapter deterministically**

Support:

```ts
type FakeAdapterMode =
  | { kind: "return"; result: ExecutionResult }
  | { kind: "throw"; error: Error }
  | { kind: "reject"; error: Error };
```

Retain call recording. A test-only beforeResolve callback may simulate an external public Control Plane mutation; it is not part of AgentAdapter.

Create test-support.ts with this minimal source-test-only seam:

```ts
export interface ControlPlaneOperations {
  getTaskGraphSnapshot: typeof getTaskGraphSnapshot;
  dispatchCommand: typeof dispatchCommand;
}

export function createExecutionCoordinatorForTest(
  options: ExecutionCoordinatorOptions,
  operations: ControlPlaneOperations
): ExecutionCoordinatorCreationResult;
```

It routes Coordinator calls through exactly those public operations. Do not re-export this module from src/index.ts or expose it through package exports.

- [ ] **Step 2: Write RED tests**

Add table-driven cases:

```text
execution_failed -> task.fail -> FAILED -> Lease removed
timeout          -> task.fail -> FAILED -> Lease removed
aborted          -> task.fail -> FAILED -> Lease removed
unavailable      -> task.fail -> FAILED -> Lease removed
Adapter throw    -> task.fail reason adapter_exception
Promise reject   -> task.fail reason adapter_exception
start reject     -> task.fail reason execution_start_rejected
complete reject  -> task.fail reason execution_completion_rejected
```

For completion rejection, the test-only callback dispatches task.fail through the public Control Plane before returning Adapter success. The Coordinator's task.complete then rejects, requiring a second task.fail attempt. Test both completion_rejected_finalized and completion_rejected_unfinalized.

Use public snapshots and claim attempts to prove Lease cleanup. Use createExecutionCoordinatorForTest with the minimal ControlPlaneOperations seam to simulate rejected finalization; it carries no private state and is not exported from the package root.

- [ ] **Step 3: Run RED**

```bash
pnpm --filter @flowctl/execution test
pnpm --filter @flowctl/control-plane test
```

Expected: FAIL because the Coordinator does not catch Adapter failures, dispatch task.fail, or finalize rejected start/complete.

- [ ] **Step 4: Implement normalization and finalization**

Wrap the awaited Adapter call:

```ts
let execution: ExecutionResult;
try {
  execution = await adapter.execute(input);
} catch (error) {
  execution = {
    kind: "failed",
    reason: "execution_failed",
    message: sanitizeAdapterError(error)
  };
}
```

Use deterministic task.fail reasons:

```text
returned Adapter failure -> preserve its provider-neutral reason
Adapter throw/rejection  -> adapter_exception
start rejection          -> execution_start_rejected
complete rejection       -> execution_completion_rejected
```

Implement one internal finalizeFailure(taskId, workerId, leaseId, reason) helper that creates and dispatches existing task.fail. It never mutates state directly.

- [ ] **Step 5: Run focused regression**

```bash
pnpm --filter @flowctl/control-plane test
pnpm --filter @flowctl/control-plane typecheck
pnpm --filter @flowctl/execution test
pnpm --filter @flowctl/execution typecheck
```

Expected: all finalization, exact-reason, terminal-status, and Lease-cleanup tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/execution
git commit -m "feat(execution): finalize execution failures through control plane"
```

## Task 5: Invariants, busy gate, signal forwarding, integration, and final verification

**Files:**

- Modify: packages/execution/src/coordinator.ts
- Modify: packages/execution/src/types.ts
- Modify: packages/execution/test/support/fake-adapter.ts
- Modify: packages/execution/test/coordinator.test.ts
- Modify: package.json
- Modify: pnpm-lock.yaml through pnpm install

**Interfaces:**

- Consumes: all prior Control Plane and execution contracts.
- Produces: trusted/missing Lease invariant handling, per-instance busy semantics, caller signal forwarding, root public-import wiring, and reproducible final validation.

- [ ] **Step 1: Write RED tests for invariants**

Use createExecutionCoordinatorForTest with the minimal public-operation gateway to prove:

```text
accepted claim + matching lease.created + fresh Task absent
-> task.fail with trusted taskId/workerId/leaseId
-> invariant_error with finalized context
-> Task FAILED and Lease removed

same anomaly + task.fail rejected
-> invariant_error with rejected finalization context
-> rejection visible

accepted claim + no trustworthy lease.created
-> invariant_error
-> no task.fail
-> no fabricated leaseId
```

Tests count public Command calls and inspect only public graph/Event snapshots. No private state or fake Lease map is used.

- [ ] **Step 2: Write RED tests for per-instance busy behavior**

Use a deferred FakeAdapter, not sleeps:

```ts
const first = coordinator.executeTask("A");
await adapter.waitUntilCalled();
const second = coordinator.executeTask("A");

assert.deepEqual(await second, { kind: "worker_busy", taskId: "A" });
adapter.resolve({ kind: "succeeded" });
await first;
```

Add a table-driven test that a subsequent executeTask is allowed after admission rejection, start rejection, successful review submission, finalized failure, unfinalized failure, completion rejection in both forms, Adapter throw/rejection, and invariant/programming error.

- [ ] **Step 3: Write RED test for AbortSignal**

```ts
const controller = new AbortController();
await coordinator.executeTask("A", { signal: controller.signal });
assert.strictEqual(adapter.calls[0].signal, controller.signal);
```

- [ ] **Step 4: Run RED**

```bash
pnpm --filter @flowctl/execution test
```

Expected: FAIL for invariant finalization metadata, busy release, overlapping-call rejection, or signal forwarding.

- [ ] **Step 5: Implement invariant handling and busy gate**

Use:

```ts
if (busy) return { kind: "worker_busy", taskId };
busy = true;
try {
  return await runAttempt(taskId, options);
} finally {
  busy = false;
}
```

Keep busy private to one Coordinator instance. For lease_extraction with no trusted Lease, return invariant_error without task.fail. For post_claim_snapshot or post_start with trusted Lease and permitted lifecycle, attempt task.fail and include finalized/rejected finalization context. Never normalize these conditions as Adapter failure.

Forward options?.signal unchanged to ExecutionInput.signal. Do not create an internal AbortController, timer, cancellation Command, global worker map, singleton, or registry.

- [ ] **Step 6: Run all focused checks**

```bash
pnpm --filter @flowctl/control-plane test
pnpm --filter @flowctl/control-plane typecheck
pnpm --filter @flowctl/execution test
pnpm --filter @flowctl/execution typecheck
```

- [ ] **Step 7: Add root public-import wiring**

Add @flowctl/execution as a root development dependency only:

```json
"devDependencies": {
  "@flowctl/control-plane": "workspace:*",
  "@flowctl/execution": "workspace:*",
  "@types/node": "^22.0.0",
  "typescript": "^5.0.0"
}
```

Run:

```bash
pnpm install
```

No production dependency outside execution's two workspace dependencies is allowed.

- [ ] **Step 8: Run repository validation**

```bash
pnpm test
pnpm typecheck
pnpm build
node --input-type=module -e 'const api = await import("@flowctl/execution"); if (typeof api.createExecutionCoordinator !== "function") throw new Error("Missing public export: createExecutionCoordinator"); console.log("@flowctl/execution public import passed");'
```

Expected: existing Protocol/Core/Control Plane/Playground tests plus execution tests pass; typecheck, build, and public import pass.

- [ ] **Step 9: Verify protected paths and SDD artifacts**

```bash
IMPLEMENTATION_BASE_SHA="$(git rev-parse origin/main)"
git diff --name-only "$IMPLEMENTATION_BASE_SHA"..HEAD -- \
  packages/protocol \
  packages/core \
  apps/playground
```

Expected: empty output.

```bash
git ls-files | grep -E '(^|/)\.superpowers/|task-[0-9]+-report|final-fix-report|review-.*\.diff|progress\.md' || true
```

Expected: no operational SDD artifacts. Public specs and plans may remain.

- [ ] **Step 10: Perform clean archive validation**

```bash
CLEAN_ARCHIVE_DIR="$(mktemp -d /tmp/flowctl-execution-clean.XXXXXX)"
git archive --format=tar HEAD | tar -xf - -C "$CLEAN_ARCHIVE_DIR"
cd "$CLEAN_ARCHIVE_DIR"
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
node --input-type=module -e 'const api = await import("@flowctl/execution"); if (typeof api.createExecutionCoordinator !== "function") throw new Error("Missing public export: createExecutionCoordinator"); console.log("@flowctl/execution clean public import passed");'
```

Expected: all commands pass without pre-existing dist, dist-test, node_modules, or untracked files.

- [ ] **Step 11: Run final hygiene**

```bash
git diff --check
git status --short --branch
IMPLEMENTATION_BASE_SHA="$(git rev-parse origin/main)"
git diff --name-only "$IMPLEMENTATION_BASE_SHA"..HEAD -- packages/protocol packages/core apps/playground
git diff --stat "$IMPLEMENTATION_BASE_SHA"..HEAD
```

Expected: clean diff check, clean working tree, empty protected-path diff, and only the planned Control Plane, execution, root integration, and documentation changes.

- [ ] **Step 12: Commit**

```bash
git add packages/execution package.json pnpm-lock.yaml
git commit -m "test(execution): harden invariants and package integration"
```

## Plan self-review

### Spec coverage

- Objective/decomposition: Global Constraints, Tasks 2–5.
- Authorities/dependency direction: Global Constraints, Tasks 3 and 5.
- Single worker/per-instance concurrency: Task 5.
- Public contracts: fixed interface block, Task 2.
- Workspace validation: Task 2 and Task 3.
- Claim, Lease extraction, fresh snapshot, and start ordering: Task 3.
- Success to review: Task 3.
- Existing task.fail and Lease cleanup: Task 1.
- Returned failure reasons: Task 4.
- Adapter throw/rejection: Task 4.
- Start and completion rejection finalization: Task 4.
- Trusted-Lease invariant: Task 5.
- Missing-Lease invariant: Task 5.
- invariant_error context: Tasks 2 and 5.
- Busy gate and signal forwarding: Task 5.
- Defensive boundaries: Task 3.
- Protocol/Core/Playground freeze: Global Constraints and Task 5.
- Provider-free CI and no ProcessRunner: Global Constraints and Task 5.
- Clean archive reproducibility: Task 5.

### Placeholder scan

No TODO, TBD, FIXME, “implement appropriately”, “add tests” without a named behavior, or unresolved path/API placeholder is present. Every behavior task has an exact failing test, expected failure, minimal implementation direction, focused command, regression command, and commit.

### Type consistency

The same names and signatures are used throughout:

```text
AgentAdapter.execute(input: ExecutionInput): Promise<ExecutionResult>
ExecutionCoordinator.executeTask(taskId, options?): Promise<ExecutionAttemptResult>
createExecutionCoordinator(options): ExecutionCoordinatorCreationResult
ExecutionInput.task: Readonly<Task>
ExecutionInput.signal?: AbortSignal
ExecutionAttemptResult.kind: ten fixed variants
```

Later tasks use public CommandProcessingResult narrowing and do not introduce a second contract name.

### Scope confirmation

This is one implementation plan for #6a. It does not implement Codex, any provider, ProcessRunner, process execution, Worker Registry, scheduler, retry/requeue, lease release, persistence, transport, UI, Planner, LLM, or Protocol/Core/Playground changes.

## Commits planned

```text
feat(control-plane): support task failure finalization
feat(execution): add provider-neutral execution contracts
feat(execution): orchestrate admitted task success
feat(execution): finalize execution failures through control plane
test(execution): harden invariants and package integration
```

## Execution handoff

Plan complete and saved to docs/superpowers/plans/2026-09-10-flowctl-execution-boundary.md. REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

After user approval, execute with:

```text
fresh implementer per task
-> independent reviewer
-> fix loop
-> next task
-> broad final review
-> verification-before-completion
```

Do not begin implementation until the user approves this plan.
