# FlowCTL Execution Boundary + Failure Finalization v0

Roadmap: Increment #6a
Status: Architectural specification for review
Date: 2026-09-09

## 1. Objective

Establish the provider-neutral asynchronous execution boundary that translates one admitted FlowCTL Task into one external execution attempt and translates the outcome back into existing Control Plane lifecycle Commands.

This increment introduces the execution package, an ExecutionCoordinator, a minimal AgentAdapter contract, a deterministic FakeAdapter, one configured local worker, and one-shot execution. It does not implement a real provider.

The Coordinator is orchestration only. It is not a second lifecycle, readiness, admission, Lease, or TaskGraph authority.

## 2. Frozen decomposition

### Increment #6a — Execution Boundary + Failure Finalization

Includes:

- package @flowctl/execution;
- ExecutionCoordinator;
- provider-neutral AgentAdapter;
- deterministic FakeAdapter test implementation;
- one configured worker with concurrency one;
- one-shot executeTask(taskId);
- claim and accepted Lease extraction;
- start before external execution;
- success mapped to task.complete, ending in review;
- failure mapped to existing task.fail, ending in failed;
- atomic active-Lease removal during accepted failure finalization;
- deterministic tests.

### Increment #6b — Codex CLI Adapter

Deferred entirely:

- Codex CLI;
- package @flowctl/adapter-codex;
- ProcessRunner;
- child processes;
- JSONL parsing;
- stdout/stderr capture;
- Codex sandbox and authentication;
- real-agent smoke tests.

No #6b implementation detail is pulled into #6a.

## 3. Existing architecture

The current package direction is:

~~~text
@flowctl/protocol
        ↓
@flowctl/core
        ↓
@flowctl/control-plane
~~~

The Control Plane synchronously owns Command admission, active Lease authority, lifecycle mutation through Core, and domain Event production.

The Protocol already defines task.fail with taskId, workerId, leaseId, and reason, plus task.failed with the same execution identity and reason. The Core already allows claimed → failed and running → failed. No Protocol or Core change is required by this specification.

## 4. Authorities

~~~text
Core                 lifecycle and readiness authority
Control Plane        Command, Lease, and Event authority
ExecutionCoordinator temporal orchestration only
AgentAdapter         external execution boundary only
~~~

The Coordinator MUST NOT mutate Core, TaskGraph, or Control Plane internals; create or remove a Lease; alter a Task status; validate lifecycle transitions independently; maintain a parallel state machine; or turn scheduling selection into admission.

The Adapter MUST NOT claim, start, complete, or fail a Task and MUST NOT access Control Plane state.

## 5. Dependency direction

The new direction is:

~~~text
@flowctl/protocol
        ↓
@flowctl/core
        ↓
@flowctl/control-plane
        ↑
@flowctl/execution
~~~

Control Plane MUST NOT depend on execution. Execution MUST use the public Control Plane façade and MUST NOT depend directly on Core for normal operation. No provider package is a dependency of Protocol, Core, or Control Plane.

## 6. Package boundary

Create packages/execution with package name @flowctl/execution. Do not create packages/worker, packages/coordinator, or packages/agent-runtime. Runtime orchestration and the provider boundary are one coherent responsibility in #6a.

The Coordinator and AgentAdapter may be public exports. FakeAdapter is test support and should remain non-public unless a concrete consumer justifies an export.

## 7. Worker model

The only worker configuration in #6a is:

~~~text
workerId
adapter
workspacePath
~~~

One Coordinator has at most one in-flight attempt. A concurrent executeTask call returns a worker-busy result before dispatching a Command or invoking the Adapter.

No Worker Registry, pool, dynamic assignment, discovery, registration, unregister operation, online/offline lifecycle, or Worker status machine is introduced. Protocol Worker remains a serializable domain contract, not a process manager.

## 8. Public API

The public semantic surface is:

~~~text
createExecutionCoordinator(options)
  → valid coordinator OR INVALID_WORKSPACE

coordinator.executeTask(taskId, { signal? })
  → Promise<ExecutionAttemptResult>
~~~

Options contain a public ControlPlane handle, one workerId, one AgentAdapter, one explicit workspacePath, an Actor for generated Commands, a deterministic Command ID generator, and a timestamp provider.

executeTask(taskId, options?) receives the caller-provided AbortSignal, when present, and forwards it unchanged to ExecutionInput. The Coordinator does not create an AbortController or a timeout manager. executeNext is not part of #6a. The exact exported type spelling may follow repository conventions, but the semantic distinctions in this specification are mandatory.

## 9. Scheduling separation

selectReadyTaskIds is not required internally. A caller may select a task and then call executeTask(taskId):

~~~text
Scheduling Policy → taskId → executeTask(taskId)
~~~

This preserves selection != admission. The Coordinator always asks the Control Plane to admit through task.claim. A stale, non-ready, or already leased task is rejected by the Control Plane and the Adapter is not invoked.

No polling loop, scheduler daemon, automatic claim, queue, priority, retry, or executeNext loop is introduced.

## 10. Coordinator flow

For one request:

~~~text
receive taskId
↓
obtain public graph snapshot for projectId
↓
dispatch task.claim
↓
extract accepted Lease from public Events
↓
obtain fresh defensive Task snapshot
↓
dispatch task.start
↓
invoke AgentAdapter
↓
dispatch task.complete OR task.fail
↓
return structured attempt result
~~~

Only taskId, leaseId, and workerId are retained as ephemeral attempt context. The Coordinator has no authoritative Lease map. Once claim and start have succeeded, every unsuccessful orchestration exit MUST attempt task.fail with the accepted Lease identity whenever the lifecycle permits it. This includes a returned Adapter failure, an Adapter throw or rejected Promise, and a rejected task.complete.

## 11. AgentAdapter

The provider-neutral contract is:

~~~text
interface AgentAdapter {
  execute(input: ExecutionInput): Promise<ExecutionResult>;
}
~~~

The Adapter is the only external-execution boundary. #6a supplies a deterministic FakeAdapter that can return configured outcomes and record calls.

The contract contains no Codex fields, executable arguments, shell concepts, JSONL, process streams, provider events, CoreState, Control Plane state, or generic prompt string.

## 12. ExecutionInput

The minimum structured input is:

~~~text
Readonly<{
  projectId: string;
  taskId: string;
  task: Readonly<Task>;
  leaseId: string;
  workerId: string;
  workspacePath: string;
  signal?: AbortSignal;
}>
~~~

The Task and nested data are defensive copies. Adapter mutation cannot affect Control Plane state or subsequent attempts.

The input is operational context, not authority. It contains no CoreState, ControlPlaneState, active Lease map, mutable graph, provider configuration, executable, args, stdout, stderr, JSONL, model, or provider sandbox enum.

## 13. Prompt ruling

No prompt string is included in ExecutionInput. The future Codex adapter translates structured context into provider-specific input:

~~~text
ExecutionInput → CodexAdapter → provider-specific prompt/input
~~~

No shared PromptBuilder is introduced without evidence that multiple providers need one.

## 14. ExecutionResult

The runtime-only union is deliberately small:

~~~text
{ kind: "succeeded" }

{ kind: "failed",
  reason: "execution_failed" | "timeout" | "aborted" | "unavailable",
  message: string }
~~~

#6a must exercise succeeded and execution_failed. timeout and aborted may be supported by an adapter without adding timers or process infrastructure. No ExecutionResult is added to Protocol.

## 15. Workspace

workspacePath is a runtime/local concern and is not added to Protocol. During coordinator creation it must be absolute, present, a directory, explicitly configured, and independent of Task content.

Invalid configuration returns INVALID_WORKSPACE with a reason such as NOT_ABSOLUTE, NOT_FOUND, or NOT_DIRECTORY. It does not dispatch a Command and is not a Task domain failure.

The package does not create worktrees, select repositories, resolve multi-repository projects, or modify the workspace.

## 16. Task snapshot timing

The first graph snapshot is used only to obtain the Control Plane project identity needed for task.claim. It is not used as Adapter input.

After an accepted claim, the Coordinator obtains a fresh snapshot through getTaskGraphSnapshot and copies the canonical Task from it. That fresh Task is the Adapter boundary.

If an accepted claim cannot be followed by a canonical Task in a valid Control Plane snapshot, this is a Control Plane/public-contract invariant violation, not a normal AgentAdapter failure and not a reason to access private state. It is reported as invariant_error; the Coordinator does not fabricate Task data or a Lease identity. If the violation occurs after an admitted start and a trusted Lease identity is already available, the normal task.fail finalization attempt still applies before returning the invariant result.

## 17. Claim and Lease

The Adapter is never invoked before claim succeeds. The Lease comes exclusively from public claim Events:

~~~text
claimResult.events → lease.created → payload.lease.id
~~~

The Coordinator verifies taskId and workerId against the extracted Lease. It never reads activeLeaseByTaskId, ControlPlaneState, CoreState, or assignedWorkerId.

An accepted claim without a matching lease.created Event is a Control Plane/public-contract invariant violation. The normal Control Plane contract makes this path unreachable, and tests must defend that premise. It is not a normal AgentAdapter failure: the Coordinator MUST NOT access private Lease state, fabricate a leaseId, create a release Command, or silently map the condition to execution_failed. If surfaced, it is reported as invariant_error and the busy gate is released. Without a trusted Lease identity, no task.fail recovery attempt is possible or permitted.

## 18. Start semantics

The order is frozen:

~~~text
claim accepted
↓
Lease exists
↓
task.start accepted
↓
AgentAdapter.execute()
~~~

The Adapter MUST NOT start before task.start succeeds. task.started means FlowCTL began an admitted execution attempt; it does not assert that a provider process has executed instructions.

The Coordinator forwards an optional caller-provided signal from executeTask(taskId, { signal }) to ExecutionInput.signal. No internal AbortController, timeout manager, cancellation UI, or Control Plane cancellation Command is introduced.

## 19. Start rejection

After this Coordinator has accepted its claim, a rejected task.start is not silently returned. The Coordinator dispatches task.fail with the accepted Lease identity. The Control Plane decides whether the claimed Task and Lease still permit finalization.

The result distinguishes start rejected and finalization accepted from start rejected and finalization rejected. Adapter call count is zero in both cases.

If finalization is rejected, the Coordinator reports both failures and does not mutate state directly. The busy gate is still released.

## 20. Success mapping

An Adapter success maps to:

~~~text
adapter succeeded
↓
task.complete
↓
task.review_requested
↓
Task = review
~~~

Success MUST NOT map directly to completed. The Coordinator MUST NOT dispatch task.review.approve or infer review approval.

If task.complete is rejected, the Coordinator MUST immediately attempt task.fail with the same taskId, workerId, and leaseId. The result distinguishes completion rejected with failure finalization accepted from completion rejected with failure finalization rejected. No retry or approval is attempted.

## 21. Failure mapping

Every non-success Adapter result representing an admitted attempt maps to existing task.fail:

~~~text
adapter failed
↓
task.fail
↓
task.failed
↓
Task = failed
~~~

The failure Command contains taskId, configured workerId, extracted leaseId, and a mapped reason string. The Coordinator must not leave an admitted attempt silently in claimed or running.

An Adapter throw or rejected Promise is caught and normalized to an ExecutionResult failure before this same mapping. A normalized message is short and sanitized; the full stack, provider secrets, prompt, and chain-of-thought are not exposed by default.

## 22. Control Plane failure support

#6a MUST add support for the existing task.fail Command. No new failure Command, lease.release, retry, requeue, attempt counter, or reassignment semantics are introduced.

Failure is terminal in this increment:

~~~text
CLAIMED → FAILED
RUNNING → FAILED
~~~

Accepted failure removes the active Lease atomically.

## 23. Failure atomicity

The task.fail handler follows the existing candidate-state pattern:

~~~text
validate project
↓
resolve canonical Task
↓
validate lifecycle
↓
resolve active Lease by taskId
↓
validate Lease ID and worker ID
↓
stage Core transition through public Core APIs
↓
prepare task.failed Event
↓
remove Lease in candidate state
↓
append Event
↓
commit candidate state atomically
~~~

Rejected task.fail leaves Core state, active Lease state, and Event Log unchanged. Accepted task.fail produces exactly one task.failed Event, changes the Task to failed, and leaves no active Lease.

## 24. Failure Event

Use only the existing task.failed Event with payload:

~~~text
{ taskId, workerId, leaseId, reason }
~~~

The Event actor is the Command actor. No process-specific Event is created. Current Protocol inspection found no representation gap.

## 25. Failure-finalization failure

The Coordinator result distinguishes:

~~~text
Adapter failed + task.fail accepted
Adapter failed + task.fail rejected
~~~

The second result contains the original Adapter failure and the finalization rejection. It never removes a Lease directly or claims recovery. The authoritative resulting state is obtained from the public Control Plane snapshot.

Adapter failure reasons and Coordinator/finalization reasons are distinct concepts. A returned Adapter failure preserves its provider-neutral reason in the execution result. A thrown/rejected Adapter is normalized as execution_failed and maps to a deterministic task.fail reason such as adapter_exception. A rejected task.complete maps to a deterministic task.fail reason such as execution_completion_rejected. A rejected task.start after claim maps to execution_start_rejected. These values use the existing Protocol reason string and do not create a new Protocol enum.

## 26. Coordinator result union

The result must represent at least these variants:

~~~text
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
~~~

Each variant includes taskId and the relevant Command or Adapter result. completion_rejected_finalized and completion_rejected_unfinalized contain both the task.complete rejection and the task.fail result. execution_failed_finalized and execution_failed_unfinalized contain the normalized Adapter failure and the task.fail result. start_rejected_finalized and start_rejected_unfinalized contain the start rejection and the task.fail result. invariant_error is reserved for a Control Plane/public-contract invariant violation and may include a finalization result when the violation occurs after accepted start with a trusted Lease identity. The result is a discriminated union, not a boolean.

## 27. Current-dispatch Events

The Coordinator consumes Events produced by the current dispatch only. It never owns or reconstructs the accumulated Event Log.

~~~text
claim    → [lease.created, task.claimed]
start    → [task.started]
complete → [task.review_requested]
fail     → [task.failed]
~~~

getEventLogSnapshot remains the API for accumulated history. No historical Event is returned as if produced by the current Command.

## 28. Busy gate and async boundaries

The Coordinator's in-flight/busy state is ephemeral orchestration state, not Worker domain state. It is acquired before the first Command and released on every exit path with semantics equivalent to:

~~~text
acquire busy gate
try
  attempt
finally
  release busy gate
~~~

The gate is released after admission rejection, start rejection, successful submission to review, execution failure finalized, execution failure unfinalized, completion rejection, completion finalization failure, Adapter throw/rejection, and invariant/programming error. A subsequent executeTask call is then allowed.

Control Plane and Core remain synchronous and deterministic. ExecutionCoordinator.executeTask and AgentAdapter.execute are asynchronous. External nondeterminism begins at AgentAdapter.execute.

Command order, FakeAdapter outcomes, Lease extraction, result classification, rejection paths, and worker-busy behavior remain deterministic.

## 29. FakeAdapter

FakeAdapter supports deterministic success, returned failure, and thrown/rejected failure, records call count and input, and allows tests to assert ordering relative to Control Plane Events. A table-driven test proves that all retained failed reasons use the same finalization semantics.

It does not call a process, network, provider, token, or private package state. Mutation of its received input cannot alter the Control Plane.

## 30. Defensive public boundary

Execution may use only createControlPlane output, getTaskGraphSnapshot, dispatchCommand, and public Protocol types.

It must not import ControlPlaneState, CoreState internals, activeLeaseByTaskId, Event Log storage, handlers, staging helpers, or private task lookup functions.

## 31. Security boundary

#6a introduces no process execution. The boundary nevertheless reserves for #6b:

- no shell command concatenation;
- no executable from Task content;
- explicit workspace;
- least-privilege provider execution;
- no Protocol credentials;
- no chain-of-thought capture;
- no unbounded output in domain Events.

These are boundary constraints, not provider behavior implemented in #6a.

## 32. Adapter exception normalization

AgentAdapter implementations are not assumed to be total. The Coordinator wraps the awaited Adapter call in try/catch. A thrown exception or rejected Promise is normalized to an execution failure and then follows task.fail exactly like a returned failed result.

The normalized message is short and sanitized. It does not expose a full stack by default, provider secrets, prompts, or chain-of-thought. The original exception is not allowed to escape after accepted start before finalization has been attempted.

## 33. Testing strategy

Control Plane tests cover task.fail from claimed and running, exact task.failed payload, Lease cleanup, invalid project/task/lifecycle/Lease, rejection atomicity, existing dispatch precedence, and own-key lookup.

Execution tests cover admission rejection with zero Adapter calls, public Lease extraction, fresh Task snapshot, start-before-Adapter ordering, success to review, no auto approval, returned Adapter failure to failed, Adapter throw/rejected Promise to failed, Lease removal, start-rejection finalization, completion rejection followed by task.fail, visible finalization failure, defensive input, concurrent-call rejection, busy-gate release after every exit path, AbortSignal forwarding, all retained failed reasons using identical finalization semantics, and workspace validation.

The required black-box proof is that after failed execution is finalized, a new claim does not observe the old Lease, without exposing the Lease map.

## 34. CI

The existing workflow remains sufficient:

~~~text
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
~~~

CI requires no Codex installation, provider authentication, network, secrets, child process, or real workspace.

## 35. Protocol, Core, and Playground freeze

Expected diffs:

~~~text
packages/protocol/** = unchanged
packages/core/** = unchanged
apps/playground/** = unchanged
~~~

No Protocol version bump, new field, Command, Event, Core transition, Worker UI, or Playground execution control is permitted by this specification.

## 36. Out of scope

The following are explicitly excluded:

- Codex, Claude, and OpenCode adapters;
- @flowctl/adapter-codex;
- ProcessRunner and child processes;
- JSONL, stdout, stderr, sandbox, and provider authentication;
- real-agent smoke;
- Worker Registry, worker pool, multiple workers, or concurrency greater than one;
- scheduler daemon, polling, automatic claim, queue, and executeNext loop;
- lease.release, heartbeat, expiry, retry, requeue, reassignment, and post-failure recovery beyond terminal task.fail finalization;
- persistence, Event Store, database, REST, HTTP, WebSocket, and SSE;
- UI, desktop, overlay, and Playground changes;
- Planner, LLM, Intent, Clarification Layer, GraphMutation application, and multi-repository orchestration;
- review approval, review rejection, and rework.

## 37. Risks and rulings

The main risk is failure after claim/start. It is resolved in #6a by adding existing task.fail support and terminal failure semantics. There is no Lease release or retry workaround.

Start rejection after an accepted claim attempts task.fail. If that finalization is rejected, the result explicitly reports the unresolved state.

The absence of ProcessRunner is intentional: #6a proves orchestration and finalization through FakeAdapter; #6b proves provider process integration.

## 38. Preliminary acceptance criteria

Success:

~~~text
READY
↓ executeTask(taskId)
↓ claim accepted and Lease extracted from public Events
↓ start accepted
↓ FakeAdapter succeeds
↓ task.complete accepted
↓ Task = REVIEW
~~~

Failure:

~~~text
READY
↓ executeTask(taskId)
↓ claim accepted
↓ start accepted
↓ FakeAdapter fails
↓ task.fail accepted
↓ Task = FAILED
↓ no active Lease
~~~

Stale or non-ready:

~~~text
task.claim rejected
↓
FakeAdapter calls = 0
~~~

All rejected Commands leave Core state, active Lease state, and Event Log unchanged.

Adapter exception:

~~~text
READY
↓ claim
↓ start
↓ Adapter throws or rejects
↓ task.fail
↓ FAILED
↓ no active Lease
~~~

Completion rejection:

~~~text
READY
↓ claim
↓ start
↓ Adapter succeeds
↓ task.complete rejected
↓ task.fail attempted
↓ finalized as FAILED OR unresolved finalization result
~~~

Busy gate:

~~~text
any attempt exit path
↓
Coordinator busy gate released
↓
next executeTask may proceed
~~~

## 39. #6b handoff

After #6a, #6b may add @flowctl/adapter-codex on top of the provider-neutral execution contract. It will own Codex CLI arguments, ProcessRunner integration, JSONL parsing, bounded output, sandbox/auth configuration, and manual smoke.

It will still use the Coordinator and Control Plane Commands and will not bypass admission or lifecycle authority.

## 40. Final self-review

The scope was checked for:

- no Protocol or Core modification;
- no provider implementation, ProcessRunner, Worker Registry, scheduler daemon, retry, requeue, or Lease release;
- no direct Lease/Core access;
- Adapter only after accepted start;
- success ending in review;
- failure finalized through task.fail;
- completion rejection also finalized through task.fail;
- Adapter throw/rejection cannot bypass task.fail;
- busy gate released on every exit path;
- invariant failures do not access private state;
- AbortSignal has an explicit caller-to-Adapter path;
- atomic Lease removal on accepted failure;
- synchronous Control Plane and asynchronous execution;
- unchanged Playground;
- provider-free CI.

Current repository inspection confirmed the existing task.fail/task.failed contracts and Core failure transitions. No blocking Protocol incompatibility was found. The document is limited to one implementation plan for #6a and leaves provider details to #6b.
