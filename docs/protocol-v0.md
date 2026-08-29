# FlowCTL Protocol v0

`@flowctl/protocol` defines the shared TypeScript contracts for a future
FlowCTL workflow. It is a declaration package: it performs no semantic
validation and does not authorize, apply, schedule, or execute work.

## Projects and tasks

A `Project` identifies a repository-backed FlowCTL execution. A `Task` has an
ID, level, status, acceptance criteria, timestamps, and optional `parentId`.
The hierarchy is organizational: `epic -> task -> subtask -> atomic`.

Prerequisites are separate from hierarchy. `parentId` says where a task belongs;
`dependencies` says which tasks must precede it. Dependencies may cross
hierarchy branches. For example, T4 depends on T2 and T3:

```ts
const T4 = { dependencies: ["T2", "T3"] };
```

`TaskGraph` stores a project's root task IDs and tasks by ID. The Protocol does
not check missing references, roots, levels, task statuses, or dependency
cycles.

## Workers and leases

`Worker` represents a provider (`codex`, `claude`, `opencode`, or `demo`) and
its availability. `Lease` is a temporary authorization record relating a task
and worker, with acquisition, expiry, and heartbeat timestamps. Lease expiry,
heartbeats, timers, and management are not implemented here.

## Commands and events

`FlowctlCommand` is a discriminated union of requests for a future Core;
`FlowctlEvent` is a discriminated union of confirmed facts for consumers. Both
use an envelope with `id`, `protocolVersion`, `timestamp`, `projectId`, and an
`actor`. A command does not change state or become an event in this package.

The envelope `actor` identifies who originated the command or event. A payload
`workerId` identifies the worker involved in that operation; the two may differ.

One possible future flow is:

```text
task.claim command -> future Core decision -> task.claimed event
```

The event contract includes `task.review_requested`; it is an event only and
does not implement review behavior.

## Graph mutation proposals

`GraphMutation` describes a proposed dynamic graph change with an ID, optional
source task, reason, and operations. It is not an envelope and therefore does
not repeat actor, timestamp, project, or protocol-version fields. Its
`task.create` operation carries a `TaskCreationInput` containing only `id`,
optional `parentId`, `level`, `title`, optional `description`, and
`acceptanceCriteria`. It cannot carry status, dependencies, worker assignment,
timestamps, or lease information. Other operations can add or remove a
dependency or update only task title, description, parent, level, and
acceptance criteria.

For example, a task can propose a migration subtask and require it first:

```ts
const mutation = {
  id: "M1",
  sourceTaskId: "T4",
  reason: "Create the migration before implementation.",
  operations: [
    { type: "task.create", task: migrationTask },
    { type: "dependency.add", taskId: "T4", dependsOnTaskId: migrationTask.id }
  ]
};
```

`graph.mutation.propose` requests this change. The future system may emit
`graph.mutation.proposed`, `graph.mutation.approved`, or
`graph.mutation.rejected`; the Protocol neither evaluates nor applies it.

## Versioning and scope

`PROTOCOL_VERSION` is the single exported version source and is currently
`"0.1"`. Command and event envelopes reference that literal type.

All protocol timestamps remain typed as `string` and must use RFC 3339 / ISO
8601 in UTC, for example `2026-08-29T13:42:18.321Z`. The Protocol does not
perform runtime timestamp validation.

Protocol v0 deliberately excludes Core implementation, state machines,
scheduling, semantic graph validation, dependency-cycle detection, lease
managers or timers, execution, HTTP/WebSocket APIs, persistence, databases,
adapters, UI, desktop and overlay applications, and runtime validation.
