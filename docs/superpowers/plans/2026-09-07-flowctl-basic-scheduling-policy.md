# FlowCTL Basic Scheduling Policy v0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Add the first pull-oriented scheduling policy to @flowctl/control-plane. It selects eligible ready task IDs deterministically without claiming work, managing leases, or introducing scheduler infrastructure.

**Architecture:** Keep the policy as a pure module inside @flowctl/control-plane. Its input is a defensive or caller-owned TaskGraph snapshot, its output is a readonly list of canonical graph task keys, and the Control Plane remains the authority for claim admission. Expose only the selector and its options type through the existing public facade.

**Tech Stack:** TypeScript strict, pnpm workspaces, Node node:test, @flowctl/protocol TaskGraph contracts, existing @flowctl/core and @flowctl/control-plane test/build conventions.

**Spec:** docs/superpowers/specs/2026-09-07-flowctl-basic-scheduling-policy-design.md

## Global Constraints

- Do not modify @flowctl/protocol or @flowctl/core.
- Do not create @flowctl/scheduler.
- Do not add runtime validation libraries, schemas, classes, persistence, or new production dependencies.
- Do not implement claim, lease, worker assignment, Worker Registry, adapters, daemon, polling, timers, queueing, retry, priority, fairness, scoring, heartbeat, expiry, recovery, or any execution loop.
- Do not inspect or call Core validation, readiness, state, or transition APIs from the policy. The policy is intentionally a narrower pull-oriented selector.
- Do not inspect dependencies, parentId, level, assignedWorkerId, Worker, Lease, capabilities, timestamps, insertion order, topology, or hierarchy when selecting.
- Preserve the public facade boundary: one runtime selector and one options type in addition to existing exports.
- Expected stale decisions remain valid: Control Plane claim admission remains authoritative and existing TASK_ALREADY_LEASED and TASK_NOT_READY results are not changed.
- Use real TDD: each behavioral task starts with a test that fails for the intended missing behavior, then the smallest implementation, then refactoring and review.
- Each task is a complete, independently verifiable increment. Do not create a functional intermediate commit that lacks the task's stated semantics.
- Record actual test counts and command output; do not hardcode counts that have not been measured.
- If implementation uncovers a genuine Protocol/Core incompatibility, stop and report it. Do not modify either package unilaterally.

## Final file map

Task 1:
- Create packages/control-plane/src/scheduler-policy.ts
- Create packages/control-plane/test/scheduler.test.ts

Task 2:
- Modify packages/control-plane/src/index.ts
- Modify packages/control-plane/test/control-plane.test.ts
- Modify packages/control-plane/test/scheduler.test.ts only if required to exercise the public boundary

Task 3:
- Modify README.md only if the current description is stale.
- No implementation file changes are expected.

## Task 1: Implement the complete pure scheduling policy

**Files:**
- Create packages/control-plane/src/scheduler-policy.ts
- Create packages/control-plane/test/scheduler.test.ts

### RED

- Add tests importing the not-yet-public source module through ../src/scheduler-policy.js. Import TaskGraph and TaskStatus-related contracts from @flowctl/protocol.
- Build fixtures with canonical graph keys and deliberately varied task fields so the tests prove that only own graph keys and status ready affect selection.
- Cover the complete contract before writing production code:
  - empty graph returns [];
  - pending, claimed, running, blocked, review, and completed tasks are excluded;
  - only tasks with task.status equal to ready are eligible;
  - omitted options mean limit 1;
  - limit 0 returns [];
  - limits 1, 2, and larger-than-eligible return at most the requested number;
  - insertion order does not affect output;
  - task.id is not used as the returned identity when it differs from the canonical graph key;
  - inherited prototype names such as toString, constructor, and __proto__ are not selected unless they are legitimate own enumerable keys;
  - Number.MAX_SAFE_INTEGER is valid, while Number.MAX_SAFE_INTEGER + 1 is invalid;
  - negative, fractional, NaN, Infinity, and -Infinity limits throw RangeError;
  - the graph and its tasks are not mutated;
  - mutating the returned array does not affect a later call;
  - fields such as dependencies, parentId, level, assignedWorkerId, Worker, and Lease do not affect eligibility.
- Run the focused RED command from the repository root:
  pnpm --filter @flowctl/control-plane build:test
  node --test packages/control-plane/dist-test/test/scheduler.test.js
- The RED must fail because the source module and selector do not exist yet. Do not treat a missing package filter or missing package as RED; the package already exists.

### GREEN

- Create scheduler-policy.ts with:
  - SchedulerSelectionOptions containing optional readonly limit?: number;
  - selectReadyTaskIds(graph: TaskGraph, options?: SchedulerSelectionOptions): readonly string[].
- Validate limit before reading the graph. Accept undefined as 1 and accept only Number.isSafeInteger(limit) && limit >= 0. Throw RangeError for every other supplied value.
- Enumerate only Object.keys(graph.tasks). Resolve each task by that own key, filter strictly on task.status === "ready", and return the canonical keys.
- Sort eligible keys with an explicit locale-independent lexical comparator equivalent to:
  (left, right) => left < right ? -1 : left > right ? 1 : 0
- Return at most the effective limit using a non-mutating slice. A normal mutable runtime array is acceptable even though the return type is readonly.
- Keep the module pure and stateless. Do not import ControlPlane, CoreState, Core readiness functions, graph validation, Worker, Lease, or command/event modules.

### REFACTOR

- Remove fixture duplication only where it does not obscure the contract.
- Keep adversarial own-key and key/id mismatch tests explicit.
- Review that no localeCompare, insertion-order reliance, timestamp ordering, dependency inspection, mutation, or hidden state entered the implementation.
- Run focused tests and the package typecheck:
  pnpm --filter @flowctl/control-plane test
  pnpm --filter @flowctl/control-plane typecheck

### Review gate and commit

- Confirm Task 1 tests prove the full policy rather than merely a happy path.
- Confirm the implementation has no production dependency changes and no Protocol/Core diff.
- Commit the complete vertical slice:
  feat(control-plane): add basic scheduling policy

## Task 2: Expose the policy and prove the stale-admission boundary

**Files:**
- Modify packages/control-plane/src/index.ts
- Modify packages/control-plane/test/control-plane.test.ts
- Modify packages/control-plane/test/scheduler.test.ts only if a public-facade assertion is useful there

### RED

- Add a public-facade test importing the source facade through ../src/index.js and asserting that selectReadyTaskIds is available.
- Add an integration test using the existing Control Plane APIs:
  1. create a graph with a ready task;
  2. select its canonical ID from a graph snapshot;
  3. dispatch task.claim for that ID;
  4. assert the claim succeeds and the task is no longer claimable;
  5. assert the stale selection does not grant authority and the existing domain result is preserved, such as TASK_ALREADY_LEASED on a repeated claim.
- Do not add a new scheduler-owned claim API or mutate the selector result to coordinate claim.
- Run the focused test build and test command. It must fail because the facade does not export the selector yet.

### GREEN

- Add exactly these facade exports, using the existing source-module convention:
  export type { SchedulerSelectionOptions } from "./scheduler-policy.js";
  export { selectReadyTaskIds } from "./scheduler-policy.js";
- Do not expose ControlPlaneState, CoreState internals, active Lease storage, Event Log storage, handlers, staging helpers, or task lookup helpers.
- Keep production dependencies unchanged.
- Run:
  pnpm --filter @flowctl/control-plane test
  pnpm --filter @flowctl/control-plane typecheck
  pnpm --filter @flowctl/control-plane build
- After build, verify package resolution from the repository root:
  node --input-type=module -e 'const api = await import("@flowctl/control-plane"); for (const name of ["createControlPlane", "getTaskGraphSnapshot", "dispatchCommand", "getEventLogSnapshot", "selectReadyTaskIds"]) { if (typeof api[name] !== "function") throw new Error("Missing public export: " + name); } console.log("@flowctl/control-plane public import passed");'

### REFACTOR

- Keep the public import test separate from source-facade unit tests so stale or missing dist cannot hide a facade problem.
- Confirm the selector accepts TaskGraph, not ControlPlane or CoreState.
- Confirm the stale-decision test proves authority remains in Control Plane and no scheduler-side mutation, Lease, Event, or worker behavior was introduced.

### Review gate and commit

- Review the diff against the spec and the public API list.
- Confirm the only runtime addition is selectReadyTaskIds and the only new public type is SchedulerSelectionOptions.
- Commit:
  feat(control-plane): expose scheduling policy boundary

## Task 3: Documentation, regression validation, and clean-checkout proof

**Files:**
- Modify README.md only if it still omits the existing Control Plane scheduling-policy boundary or misstates the project scope.
- No empty commit is required when README already accurately describes the repository.

### Documentation

- If README is stale, make only a concise correction. Do not present the policy as a scheduler, daemon, assignment system, or execution engine.
- State that the policy is pull-oriented and selects ready task IDs only; it does not claim tasks, manage leases, assign workers, poll, or execute work.
- If README is already accurate, leave it unchanged and record that no documentation edit was necessary.

### Full regression

- Run from the repository root:
  pnpm test
  pnpm typecheck
  pnpm build
- Run the public import check after build, covering the existing public runtime exports plus selectReadyTaskIds.
- Record the measured total test count and package-level counts. Do not assume earlier counts are unchanged.
- Run:
  git diff --check

### Scope and artifact checks

- Before Task 1, record and preserve the implementation baseline in the task notes:
  IMPLEMENTATION_BASE_SHA="$(git rev-parse HEAD)"
- In the final validation shell session, set IMPLEMENTATION_BASE_SHA to that exact recorded pre-Task-1 SHA and verify the frozen packages remain untouched:
  git diff --name-only "$IMPLEMENTATION_BASE_SHA"..HEAD -- packages/protocol packages/core
  The command must print nothing. Do not replace the recorded pre-Task-1 SHA with a post-task SHA, because that would make the comparison vacuous.
- Also verify production dependencies:
  node --input-type=module -e 'const pkg = JSON.parse(require("node:fs").readFileSync("packages/control-plane/package.json", "utf8")); const deps = Object.keys(pkg.dependencies ?? {}).sort(); const expected = ["@flowctl/core", "@flowctl/protocol"]; if (JSON.stringify(deps) !== JSON.stringify(expected)) throw new Error("Unexpected production dependencies: " + deps.join(", ")); console.log("production dependencies passed");'
- Verify no operational SDD artifacts are tracked:
  git ls-files | grep -E '(^|/)\.superpowers/|task-[0-9]+-report|final-fix-report|review-.*\.diff|progress\.md' || true
- Verify public facade exports and inspect that no internal state helper is exported.

### Fresh-checkout validation

- Use a temporary directory outside the repository. Create a clean archive from the implementation HEAD and validate without pre-existing dist, dist-test, node_modules, or ignored build output:
  TMP_DIR="$(mktemp -d)"
  git archive --format=tar HEAD | tar -xf - -C "$TMP_DIR"
  cd "$TMP_DIR"
  test ! -e packages/control-plane/dist
  test ! -e packages/control-plane/dist-test
  test ! -e node_modules
  pnpm install --frozen-lockfile
  pnpm test
  pnpm typecheck
  pnpm build
  node --input-type=module -e 'const api = await import("@flowctl/control-plane"); if (typeof api.selectReadyTaskIds !== "function") throw new Error("Missing public selector"); console.log("clean-checkout public import passed");'
- Remove the temporary directory after collecting results. This is a recoverable temporary validation artifact, not a repository change.
- If any command fails because the clean checkout reveals a real packaging or workspace problem, diagnose and fix within scope before declaring the plan complete. Do not solve it with stale artifacts or a root dependency workaround.

### Final review gate

- Review the complete diff against the approved spec.
- Confirm no Protocol/Core source or contract changes.
- Confirm no new production dependency.
- Confirm no scheduler package, Worker Registry, claim/lease mutation, daemon, timer, queue, retry, priority, fairness, scoring, adapter, persistence, network, UI, desktop, or LLM scheduling code.
- Confirm the public API and all invalid-limit behavior are covered.
- If README changed, commit the documentation-only change; otherwise do not create an empty documentation commit.
- Final implementation commits should be limited to the two functional task commits and an optional README documentation commit.

## Expected public API

Runtime:
- selectReadyTaskIds(graph, options?)

Type:
- SchedulerSelectionOptions

Existing Control Plane runtime and types remain unchanged.

## Deterministic behavior summary

- Eligibility: own enumerable graph.tasks keys whose task status is exactly ready.
- Identity: return canonical graph keys, never task.id.
- Ordering: locale-independent lexical ordering with the explicit relational comparator.
- Default limit: 1.
- Valid zero: [].
- Valid positive safe integers: select up to N.
- Invalid values: RangeError for negative, fractional, NaN, Infinity, -Infinity, and unsafe integers.
- Purity: no mutation, no hidden state, no side effects.
- Staleness: selection is advisory; Control Plane admission is authoritative.

## Review rulings captured by this plan

- The policy lives in @flowctl/control-plane because only one consumer exists and it is a narrow boundary over existing Control Plane state; no @flowctl/scheduler package is justified in this increment.
- The selector deliberately does not call Core readiness helpers. It answers the policy question “which canonical task keys are currently ready?” and leaves graph validity, lifecycle, claims, and leases to their existing authorities.
- Own-key semantics are intentional: Object.keys excludes inherited toString, constructor, and __proto__ entries, while a legitimate own enumerable key remains eligible.
- task.id mismatch does not change canonical identity; the graph key is authoritative for this selector.
- A selector result may become stale between selection and claim; this is expected optimistic behavior, not a transaction guarantee.
- Limit validation is the only expected exception in the API; no domain result union or runtime schema is added.
- A public import from the repository root validates the built package. A direct root import of @flowctl/protocol is not a required check because the root package intentionally has no direct Protocol dependency.
- Extraction to @flowctl/scheduler is deferred until multiple consumers, independent strategies, or a stable shared scheduling contract justify it.

## Definition of done

- Task 1 and Task 2 each have RED, GREEN, REFACTOR evidence.
- All policy edge cases and adversarial cases are tested.
- Public facade and stale-admission boundary are tested.
- Full test, typecheck, build, public import, scope, and clean-checkout validations pass.
- Protocol and Core remain untouched.
- No out-of-scope functionality is implemented.
- The plan remains implementation-only guidance; this commit must not include code.
