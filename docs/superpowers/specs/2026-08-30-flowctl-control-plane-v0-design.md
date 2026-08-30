# FlowCTL Control Plane v0

Status: architectural specification for Incremento #3. This document defines
the first executable Control Plane slice. It does not implement the slice.

## 1. Objective and milestone

Incremento #3 introduces `@flowctl/control-plane` as the orchestration boundary
between Protocol contracts and behavior already implemented by
`@flowctl/core`.

The milestone is deliberately limited to one task:

```text
A ready
  -> task.claim
  -> Lease created
  -> A claimed
  -> task.start
  -> A running
  -> task.complete
  -> A review
```

The reference graph is:

```text
    A
   / \
  B   C
   \ /
    D
```

The milestone graph starts with A as `ready` and B, C and D as `pending`.
Initialization preserves those exact statuses. It does not call
`advanceReadyTasks` and does not emit `task.ready`.

Promotion of dependents, review approval, `review -> completed` and complete
DAG execution are future work.

## 2. Package boundaries

```text
@flowctl/protocol
  shared declarative contracts

@flowctl/core
  TaskGraph validation, readiness, TaskStatus lifecycle and CoreState

@flowctl/control-plane
  Command dispatch, orchestration, Lease authority and Events
```

`@flowctl/control-plane` has only these production dependencies:

- `@flowctl/protocol`;
- `@flowctl/core`.

The existing Protocol and Core contracts remain frozen. No change to either
package is part of this increment.

## 3. Control Plane ownership of CoreState

The primary construction API is conceptually:

```ts
createControlPlane(graph, options)
```

It must not accept a caller-owned `CoreState` as its primary input.

`createControlPlane` receives a Protocol `TaskGraph`, creates the Core
`CoreState` internally, keeps the handle private and never exposes it.

Workflow reads use:

```ts
getTaskGraphSnapshot(controlPlane)
```

which delegates to Core and returns a defensive snapshot.

Once a TaskGraph is under Control Plane execution, operational changes pass
through the Control Plane. The Control Plane must not write directly to
`TaskGraph.tasks` and must not use `Task.assignedWorkerId` as authority.

The public Control Plane handle is opaque. Its private state conceptually
contains a CoreState handle, active leases and an Event Log. The exact storage
type is an implementation detail.

## 4. Internal state and atomic candidate commits

The private state is conceptually:

```ts
{
  coreState: CoreState;
  activeLeases: Map<string, Lease>;
  eventLog: FlowctlEvent[];
}
```

There can be at most one active Lease for a task. The handle, CoreState,
active lease map and Event Log must not be constructible or readable through a
normal consumer object literal.

An implementation may stage every accepted Command on a defensive graph
snapshot and a candidate CoreState, alongside copied Lease and Event Log
collections. Only after every precondition, generated value, transition and
Event is ready does it replace the private state references. This provides
the required synchronous atomicity without transactional infrastructure.

## 5. Initialization and readiness

`createControlPlane(graph, options)` delegates structural validation and state
creation to Core.

For an invalid graph it returns a structured failure containing the original
`GraphValidationIssue[]` and does not create an externally usable handle.

For a valid graph:

- every task keeps its input `TaskStatus` exactly;
- no task is implicitly promoted from `pending` to `ready`;
- no `task.ready` Event is emitted;
- the Event Log starts empty;
- no Lease is created.

Core's readiness functions remain available internally for later increments,
but this increment does not invoke readiness promotion during initialization
or completion.

## 6. Supported Commands

The Control Plane processes only:

- `task.claim`;
- `task.start`;
- `task.complete`.

Every other member of `FlowctlCommand`, including `task.fail`, `task.block`,
`lease.heartbeat` and `graph.mutation.propose`, returns a structured
`UNSUPPORTED_COMMAND` rejection.

Unsupported Commands do not mutate CoreState, Lease state or Event Log and do
not emit Events.

The Control Plane receives typed `FlowctlCommand` values. JSON decoding,
generic runtime schemas and transport-boundary validation are out of scope.

## 7. Command processing and atomicity

An expected Command is applied completely or produces no observable mutation.

Conceptually, each dispatch performs:

1. resolve the Command and project context;
2. validate every domain precondition;
3. obtain all required timestamps;
4. generate all required Lease IDs;
5. generate all required Event IDs;
6. construct all Lease data and Events;
7. prepare the Core transition on candidate state;
8. replace private CoreState and Lease state;
9. replace the Event Log with its prepared append-only copy;
10. return defensive copies of accepted Events.

For an expected rejection:

- CoreState is unchanged;
- Lease state is unchanged;
- Event Log is unchanged;
- no new business Event is emitted.

Clock and ID generator failures are programming/configuration failures, not
domain rejections. They must occur before state replacement, so they cannot
leave a partial Command application. They need not be converted into a
domain-error union.

## 8. Result types and expected failures

The construction operation has a distinct result equivalent to:

```ts
type ControlPlaneCreationResult =
  | { ok: true; controlPlane: ControlPlane }
  | {
      ok: false;
      code: "INVALID_GRAPH";
      issues: readonly GraphValidationIssue[];
    };
```

Command dispatch has a separate discriminated result equivalent to:

```ts
type CommandProcessingResult =
  | { ok: true; events: readonly FlowctlEvent[] }
  | {
      ok: false;
      code: "UNSUPPORTED_COMMAND";
      commandId: string;
      commandType: FlowctlCommand["type"];
    }
  | {
      ok: false;
      code: "PROJECT_MISMATCH";
      commandId: string;
      commandProjectId: string;
      controlPlaneProjectId: string;
    }
  | { ok: false; code: "TASK_NOT_FOUND"; commandId: string; taskId: string }
  | { ok: false; code: "TASK_NOT_READY"; commandId: string; taskId: string }
  | {
      ok: false;
      code: "TASK_ALREADY_LEASED";
      commandId: string;
      taskId: string;
    }
  | { ok: false; code: "LEASE_NOT_FOUND"; commandId: string; leaseId: string }
  | {
      ok: false;
      code: "LEASE_MISMATCH";
      commandId: string;
      taskId: string;
      leaseId: string;
      workerId: string;
    }
  | {
      ok: false;
      code: "INVALID_TASK_TRANSITION";
      commandId: string;
      taskId: string;
      from: TaskStatus;
      to: TaskStatus;
    };
```

Every expected failure has the fields shown above and remains discriminated by
`code`. `LEASE_EXPIRED` is absent: expiry is not operationally enforced in
this increment.

Expected domain failures are not represented by exceptions.

## 9. Claim admission

`task.claim` remains a request, not authority. It is accepted only when:

- the task exists in the canonical Core graph;
- the task status is `ready`;
- there is no active Lease for the task.

For deterministic failures, claim validation resolves the project first, then
looks up the task, checks `ready`, and finally checks for an active Lease.

There is no Worker Registry in this increment. The Control Plane does not
check whether a Worker is connected, available or authenticated. It does not
require `actor.id === workerId`; the actor may be a user, scheduler or system
originating an action involving a Worker.

On success, the Control Plane atomically:

1. prepares a Lease for the task and requested Worker;
2. applies `ready -> claimed` through Core;
3. records the Lease as active;
4. emits `lease.created` followed by `task.claimed`.

`task.claimed` contains the Lease ID created by the same Command.
`Task.assignedWorkerId` is not changed.

## 10. Lease authority and limits

In this slice, Lease is the sole authority for the Worker ↔ Task relationship.

The Lease uses the Protocol `Lease` shape. Its `acquiredAt`,
`lastHeartbeatAt` and `expiresAt` values are filled deterministically, but
`expiresAt` is not used to authorize or reject execution yet.

There is no operational expiry policy in this increment. The following remain
out of scope:

- `LEASE_EXPIRED`;
- lazy expiration;
- `lease.expired`;
- heartbeat processing;
- timers and background jobs;
- recovery;
- reassignment;
- expiry behavior while `running`.

When `task.complete` succeeds and the task enters `review`, the Lease is
removed or marked inactive internally and cannot authorize further execution.
No `lease.released` Protocol Event is added.

## 11. Start

`task.start` requires:

- the task exists;
- the lifecycle allows `claimed -> running`;
- a Lease exists;
- the Lease belongs to the task;
- the Lease belongs to the requested `workerId`;
- the supplied `leaseId` matches.

When multiple preconditions could fail, validation is deterministic: resolve
the project, look up the task, validate the lifecycle pair, look up the Lease,
then validate its task, Worker and ID associations.

On success, the task moves from `claimed` to `running` and the Control Plane
emits `task.started`. The Event inherits the causal actor and envelope context
from the accepted Command.

## 12. Complete, review and completed

`task.complete` does not mean definitive completion. It means:

> The Worker finished implementation and submitted the work for review.

An accepted `task.complete` requires the task lifecycle pair
`running -> review` and the same task, Worker and Lease association rules as
`task.start`.

Its result is the transition `running -> review` followed by exactly one
`task.review_requested` Event. It must not emit `task.completed`.

After this transition, the Lease is removed or marked inactive internally and
cannot authorize further execution.

The future transition is `review -> completed` and requires explicit
Verifier/System authority in a later increment. The Control Plane must not
reuse `task.complete` with `actor.type = "system"` to hide the absence of that
authority.

## 13. Events, actor and deterministic order

Business Events are emitted only after the corresponding Command is accepted
and its state change is prepared.

For every Event generated from an accepted Command, the Control Plane copies:

- `actor` from the Command;
- `projectId` from the Command;
- `protocolVersion` from the Command.

The Control Plane generates a new Event ID, the Event timestamp and the
payload describing the confirmed fact. The payload `workerId` remains the
Worker involved in the operation and is not substituted for the causal actor.

Within one dispatch, one timestamp is obtained and used consistently for the
Lease and all Events from that dispatch.

Event order is fixed:

| Command | Event order |
| --- | --- |
| `task.claim` | `lease.created`, then `task.claimed` |
| `task.start` | `task.started` |
| `task.complete` | `task.review_requested` |

There are no initialization Events and no rejection Events.

## 14. In-memory Event Log

The Control Plane contains a small append-only in-memory Event Log. It:

- contains only confirmed Events;
- preserves append order;
- is not persistent;
- is not an Event Store;
- does not implement durable replay;
- does not require a sequence number;
- is lost when the process exits.

The conceptual read API is `getEventLogSnapshot(controlPlane)`, returning a
defensive `readonly FlowctlEvent[]` snapshot.

Defensive copies are mandatory when Events enter the internal log, when the
log snapshot is returned and when Events are returned in
`CommandProcessingResult`. Nested mutable payloads, including Lease objects,
must not share references with internal log state.

## 15. Determinism and injected dependencies

Construction options must provide these responsibilities:

- `now: () => string`;
- `nextLeaseId: () => string`;
- `nextEventId: () => string`;
- `leaseExpiresAt: (acquiredAt: string) => string`.

These dependencies are required for deterministic tests. No external library
is necessary.

For an accepted claim, preparation order is fixed:

1. obtain the dispatch timestamp;
2. generate the Lease ID;
3. derive Lease `expiresAt` metadata;
4. generate the `lease.created` Event ID;
5. generate the `task.claimed` Event ID;
6. construct the Lease and Events;
7. prepare the Core transition;
8. commit the staged state.

`Lease.acquiredAt` and `Lease.lastHeartbeatAt` use the dispatch timestamp.
Generators must provide unique IDs within their respective namespaces. This
increment does not implement collision detection or retry.

## 16. Public API surface

The initial façade is conceptually:

- `createControlPlane(graph, options)`;
- `getTaskGraphSnapshot(controlPlane)`;
- `dispatchCommand(controlPlane, command)`;
- `getEventLogSnapshot(controlPlane)`.

The façade may export the associated Control Plane result, options and failure
types. It must not export the private CoreState handle, active Lease storage
or Event Log storage. No scheduler API is introduced.

## 17. Tests and acceptance criteria

Tests use Protocol types and the Core façade rather than duplicate domain
types.

Required coverage:

1. initialization preserves A=`ready`, B/C/D=`pending` exactly;
2. initialization does not promote readiness or emit `task.ready`;
3. invalid graphs return structured creation failure;
4. accepted claim creates one Lease and changes A to `claimed`;
5. claim emits `lease.created` before `task.claimed`;
6. Events preserve Command actor, project and protocol version;
7. claim rejection for missing, non-ready or already-leased tasks is atomic;
8. accepted start changes A to `running` and emits `task.started`;
9. start rejects missing, mismatched and wrong-Worker leases atomically;
10. accepted complete changes A to `review` and emits only
    `task.review_requested`;
11. accepted complete deactivates the Lease internally;
12. later execution through the inactive Lease is rejected;
13. unsupported Commands return `UNSUPPORTED_COMMAND` without mutation;
14. Event Log order is append-only and deterministic;
15. Event Log snapshots and Command result Events are defensive copies;
16. broken ID/clock dependencies fail before observable mutation;
17. injected dependencies produce reproducible Lease/Event data;
18. `Task.assignedWorkerId` remains unchanged;
19. B, C and D are not promoted during this milestone.

The full DAG scenario is not an acceptance criterion for this increment. Its
later target is `A completed -> B/C ready -> B/C completed -> D ready`.

## 18. Explicitly out of scope

- Scheduler package or module;
- prioritization, fairness, queues or worker pools;
- automatic task selection;
- real Workers;
- Codex, Claude Code or OpenCode adapters;
- parallel execution;
- Worker Registry;
- authentication;
- heartbeat;
- lease expiry and background processing;
- recovery and reassignment;
- `lease.expired` or `lease.released` additions;
- review approval;
- `task.completed` emission;
- dependent readiness promotion;
- HTTP/WebSocket;
- Event Store;
- persistence or database;
- runtime schemas or Zod;
- UI, Desktop or Overlay;
- Planner;
- LLM integration;
- Intent / Clarification Layer;
- GraphMutation application;
- sophisticated Verifier;
- shell or file mediation.

## 19. Risks and future decisions

The current Protocol/Core contracts are sufficient for this slice. No
Protocol or Core change is required now.

Explicit future decisions include:

- Command idempotency and deduplication;
- explicit review approval authority;
- the `review -> completed` operation;
- `task.completed` Event production;
- dependent readiness promotion and `task.ready` emission;
- lease expiry policy;
- recovery after expiry during `running`;
- observable Lease release;
- heartbeat semantics;
- Worker Registry and authentication;
- distributed execution and persistence.

Protocol already contains `task.completed` and Core permits
`review -> completed`, but no Protocol Command currently expresses
Verifier/System approval. This is a future design concern, not a blocker for
ending Incremento #3 at `review`.

`Task.assignedWorkerId` remains descriptive and is not the source of authority
for this slice. Lease ownership is the authoritative association.

## 20. Architectural invariants

The implementation must preserve:

1. CoreState is created and owned privately by Control Plane;
2. Commands and Events remain semantically distinct;
3. only accepted Commands produce business Events;
4. expected rejections produce no observable mutation;
5. claim authority comes from an active Lease, not `assignedWorkerId`;
6. `task.complete` ends at `review`, never directly at `completed`;
7. initialization does not promote readiness;
8. Event actor remains the causal Command actor;
9. Event and Lease data are deterministic under injected dependencies;
10. all externally returned mutable structures are defensive copies;
11. no expiry behavior is inferred from `expiresAt` in this increment;
12. no scheduler exists beyond direct claim admission.
