# FlowCTL Basic Scheduling Policy v0

Status: architectural specification for Increment #5.

## 1. Objective

Increment #5 introduces the smallest useful scheduling boundary for FlowCTL:
a deterministic policy that selects ready Task IDs from a `TaskGraph` snapshot.

This increment does not execute work, assign Workers, create Leases, or run a
scheduler loop. It prepares the boundary for a future Coordinator and Worker
Adapter without moving lifecycle authority out of Core or admission authority
out of the Control Plane.

## 2. Architectural boundary

The responsibilities remain separated:

```text
Core
  lifecycle and readiness authority

Scheduling Policy
  candidate selection only

Control Plane
  admission, mutation, Lease and Event authority

Worker / Coordinator
  future execution and assignment layer
```

Scheduling decisions are optimistic. The Control Plane remains the final
authority for accepting or rejecting a later `task.claim`.

## 3. Package ownership

Do not create `@flowctl/scheduler` in v0.

The policy is hosted temporarily inside `@flowctl/control-plane`, in a pure
module such as:

```text
packages/control-plane/src/scheduler-policy.ts
```

This is a hosting boundary only. The policy does not receive or own
`ControlPlaneState`.

The policy may depend on the `TaskGraph` contract from `@flowctl/protocol`.
It must not depend on Core internals, Control Plane state, Lease storage,
Event Log storage or a Worker Registry.

## 4. Public API

The public façade of `@flowctl/control-plane` will expose the pure selection
function and its options type:

```ts
export interface SchedulerSelectionOptions {
  readonly limit?: number;
}

export function selectReadyTaskIds(
  graph: TaskGraph,
  options?: SchedulerSelectionOptions
): readonly string[];
```

The function receives a `TaskGraph`, not a `ControlPlane` handle. A caller may
obtain the input through:

```ts
const snapshot = getTaskGraphSnapshot(controlPlane);
const taskIds = selectReadyTaskIds(snapshot, { limit: 2 });
```

Do not create `createScheduler`, a `Scheduler` class, `SchedulingPlan`, a queue
or scheduler state.

## 5. Input assumptions

The policy assumes that its `TaskGraph` input is a structurally valid snapshot
produced by normal FlowCTL boundaries.

It is not a graph validator and must not call:

- `validateTaskGraph`;
- `createCoreState`;
- `getReadyTaskIds`;
- `advanceReadyTasks`.

The policy must not reconstruct readiness or validate dependencies. A malformed
external object is outside the additional guarantees of this typed function.

## 6. Canonical identity

The canonical identity of a Task for selection is the own enumerable key of
`graph.tasks`.

The policy must enumerate those keys using own-key semantics, such as
`Object.keys(graph.tasks)`. It must return the canonical key, never use
`task.id` as an alternative lookup key and never repair or normalize a key/id
divergence.

For example, if `graph.tasks.A.id === "WRONG"` and the task is `ready`, the
policy returns `"A"`.

Inherited properties such as `toString`, `constructor` and `__proto__` are not
Tasks unless they are own enumerable keys in `graph.tasks`.

## 7. Eligibility

Eligibility is exactly:

```text
task.status === "ready"
```

The policy must not inspect or interpret:

- dependencies;
- `parentId`;
- `level`;
- `assignedWorkerId`;
- Worker objects;
- Leases;
- capabilities;
- priority.

If a Task is already `ready`, the policy trusts the lifecycle/readiness state
established by Core and the Control Plane.

## 8. Deterministic ordering

The policy sorts canonical Task IDs using locale-independent lexical string
ordering.

The ordering must not depend on:

- insertion order;
- object or Map iteration order;
- timestamps;
- topology;
- hierarchy;
- `localeCompare`;
- an implicit priority field.

The comparison must be stable for the same set of canonical IDs regardless of
the input object's insertion order.

No priority field is added to Protocol for this increment.

## 9. Limit semantics

`limit` controls only the maximum number of candidate Task IDs returned by one
invocation. It is not global concurrency, Worker capacity, Lease capacity or
the maximum number of running Tasks.

The semantics are frozen as follows:

| Input | Result |
|---|---|
| `limit === undefined` | default to `1` |
| `limit === 0` | `[]` |
| positive safe integer `N` | up to `N` ordered candidates |
| negative number | `RangeError` |
| fractional number | `RangeError` |
| `NaN` | `RangeError` |
| `Infinity` or `-Infinity` | `RangeError` |
| unsafe integer | `RangeError` |

The guard is equivalent to requiring `Number.isSafeInteger(limit) && limit >= 0`.
Configuration/argument misuse uses `RangeError`; no result union is introduced
for this programmer-facing argument error. No Zod, JSON Schema or runtime
schema framework is added.

## 10. Stateless behavior

The policy is a pure snapshot-in/selection-out function.

It must not retain:

- previous selections;
- queues;
- retry history;
- running counts;
- Worker load;
- timers;
- polling state;
- fairness state;
- dispatch history.

It must not mutate the graph, its Tasks, arrays or nested values.

## 11. Pull-oriented usage

The v0 boundary is pull-oriented:

```text
caller requests candidates
        ↓
policy returns canonical Task IDs
```

There is no polling loop, timer, daemon, background process or push dispatcher.

A future push Coordinator may invoke the same function from a poll/event loop
without changing its contract.

## 12. Stale-decision and admission boundary

The architectural invariant is:

> Scheduling decisions are optimistic; Control Plane admission is authoritative.

The expected race is:

```text
Scheduler reads A = ready
        ↓
returns A
        ↓
another actor claims A
        ↓
caller submits task.claim(A)
        ↓
Control Plane rejects with TASK_ALREADY_LEASED or TASK_NOT_READY
```

The policy does not retain state to invalidate old decisions. It does not
retry or compensate for a rejected claim.

## 13. Protocol/Core freeze

`@flowctl/protocol` and `@flowctl/core` remain unchanged.

The increment introduces no:

- Command;
- Event;
- ActorType;
- TaskStatus;
- Lease field;
- readiness contract;
- graph contract.

Any implementation discovery that appears to require a Protocol or Core
change must be reported as an incompatibility before implementation. No
workaround may silently alter either contract.

## 14. Selection-only milestone

Given:

```text
        A
       / \\
      B   C
       \\ /
        D

A = completed
B = ready
C = ready
D = pending
```

The policy must produce:

```ts
selectReadyTaskIds(snapshot)
// ["B"]

selectReadyTaskIds(snapshot, { limit: 2 })
// ["B", "C"]
```

No Task status, Lease or Event Log entry changes as a result.

## 15. Tests and acceptance criteria

The implementation must prove at least:

- no ready Tasks returns `[]`;
- ready, pending and running inputs return only ready IDs;
- different insertion orders return the same result;
- undefined `limit` returns one candidate;
- `limit: 0` returns `[]`;
- `limit: 1` returns the first candidate;
- `limit: 2` returns two candidates in canonical order;
- a limit larger than the candidate count returns all candidates;
- negative, fractional, `NaN`, infinite and unsafe limits throw `RangeError`;
- a key/id mismatch still returns the own canonical key;
- inherited properties are not treated as Tasks;
- the input graph and nested values are not mutated;
- selection does not create a Lease, change a status or emit an Event;
- a stale selected Task remains subject to existing Control Plane claim
  rejection behavior;
- the existing Protocol, Core and Control Plane suites remain passing.

The stale-decision case may be an integration test in the Control Plane
package. It must prove the admission boundary, not add claim logic to the
policy.

## 16. Relation to Increment #6

The intended future flow is:

```text
Scheduling Policy
        ↓ taskId
future Coordinator chooses workerId
        ↓
Control Plane task.claim
        ↓
Lease
        ↓
Worker Adapter receives admitted work
        ↓
Codex / Claude / OpenCode
```

An Adapter must not start execution merely because selection returned a Task
ID. It operates only after Control Plane admission and Lease creation.

Worker assignment and Worker Registry begin in a later increment.

## 17. Relation to Increment #7

Heartbeat, expiry, recovery and reassignment remain outside this increment.

The stateless policy remains compatible with those features:

```text
recovery changes Control Plane state
        ↓
new graph snapshot
        ↓
new selection
```

There is no internal Scheduler queue or retry state to reconcile after Lease
expiry or Worker failure.

## 18. Architectural invariants

The following must remain true:

1. Core is the only lifecycle/readiness authority.
2. The policy only selects candidate canonical Task IDs.
3. The Control Plane is the only admission/mutation/Lease/Event authority.
4. The policy never accesses `CoreState` or `ControlPlaneState`.
5. The policy never accesses `activeLeaseByTaskId` or the Event Log.
6. Selection never creates Commands or Events.
7. Selection never calls `task.claim`.
8. Selection never calculates dependencies or readiness.
9. Selection is deterministic and locale-independent.
10. Selection is stateless and non-mutating.
11. Multiple selected IDs do not imply atomic multiple claim.
12. Protocol and Core remain frozen.

## 19. Explicitly out of scope

The increment does not implement:

- Worker assignment;
- Worker Registry;
- Scheduler daemon;
- auto-claim;
- batch claim;
- priority;
- fairness;
- scoring;
- retries;
- heartbeat;
- Lease expiry;
- recovery;
- persistence;
- networking;
- subprocess execution;
- adapters;
- ACP or MCP integration;
- execution worktrees;
- Codex, Claude or OpenCode integration;
- UI, Desktop or Overlay;
- LLM scheduling;
- resource optimization;
- multi-repository scheduling.

## 20. Future extraction criteria

The policy may move to `@flowctl/scheduler` only when at least one of these
conditions is true:

- a second package needs the policy independently of Control Plane;
- Worker/Coordinator integration creates a stable shared scheduling contract;
- the policy gains multiple independently versioned strategies;
- package-level dependency isolation materially improves testing or reuse.

Extraction must preserve the selection semantics and must not move lifecycle,
Lease or Event authority into the extracted package.

## 21. Research boundary

External orchestration systems were considered as architectural references,
not as implementation dependencies. Their common separation between selection,
bounded dispatch and execution authority supports this smaller FlowCTL slice.

FlowCTL intentionally does not import their polling, workspace, retry,
provider, persistence or worker-pool infrastructure into v0.

## 22. Preliminary acceptance summary

Increment #5 is complete when `@flowctl/control-plane` exposes the pure
`selectReadyTaskIds` API, its deterministic and validated `limit` behavior is
covered, canonical own-key identity is proven, no graph mutation occurs, stale
decisions remain governed by Control Plane admission, and Protocol/Core remain
unchanged.

No scheduler infrastructure is required for this milestone.
