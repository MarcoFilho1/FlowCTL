# FlowCTL Protocol v0 Design

## Context

FlowCTL will eventually provide an agent-agnostic layer for visualizing,
organizing, and controlling coding-agent workflows. This increment creates the
TypeScript monorepo foundation and implements only `@flowctl/protocol`.

The Protocol defines the data, entities, commands, events, and graph mutation
contracts shared by future FlowCTL components. It does not implement execution
logic, state transitions, scheduling, lease management, graph validation, or
runtime validation.

## Goals and boundaries

The implementation must:

- use Node.js, TypeScript strict mode, and pnpm workspaces;
- keep `@flowctl/protocol` free of production dependencies;
- expose small interfaces, type aliases, discriminated unions, and protocol
  constants;
- represent one project per FlowCTL execution while retaining `Project` as a
  protocol entity for future evolution;
- make hierarchy and execution dependencies separate concepts;
- make commands distinguishable from confirmed events;
- allow graph mutation proposals without applying or validating them.

The implementation must not add the Core, scheduler, state machine, graph
execution or validation, lease timers or managers, HTTP/WebSocket APIs, event
store, database, UI, desktop/overlay application, adapters, LLM features,
parallel execution, or a complete CLI.

## Repository structure

The repository will use a private root workspace with the implemented package
at `packages/protocol`:

```text
FlowCTL/
├── apps/
├── adapters/
├── packages/
│   └── protocol/
│       ├── src/
│       │   ├── project.ts
│       │   ├── task.ts
│       │   ├── graph.ts
│       │   ├── worker.ts
│       │   ├── lease.ts
│       │   ├── command.ts
│       │   ├── event.ts
│       │   ├── mutation.ts
│       │   └── index.ts
│       ├── test/
│       ├── package.json
│       └── tsconfig.json
├── docs/
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .gitignore
└── README.md
```

`apps/` and `adapters/` remain reserved areas. No artificial executable files
or future subsystem structure will be added to them in this increment.

## Public version and shared actor

The protocol source of truth for the wire-contract version is:

```ts
export const PROTOCOL_VERSION = "0.1" as const;
```

Envelopes reference `typeof PROTOCOL_VERSION`, so their version literal cannot
drift from the exported constant.

Commands and events share an `Actor` concept:

```ts
type ActorType = "system" | "worker" | "user";

interface Actor {
  type: ActorType;
  id: string;
}
```

`Actor` identifies who originated a command or event. A payload's `workerId`
identifies the worker involved in the operation; the two concepts may coincide
but are intentionally not interchangeable.

## Domain entities

### Project

```ts
interface Project {
  id: string;
  name: string;
  repositoryPath: string;
}
```

The protocol does not implement multi-project management.

### Task and hierarchy

```ts
type TaskLevel = "epic" | "task" | "subtask" | "atomic";

type TaskStatus =
  | "pending"
  | "ready"
  | "claimed"
  | "running"
  | "blocked"
  | "review"
  | "completed"
  | "failed"
  | "cancelled";

interface AcceptanceCriterion {
  id: string;
  description: string;
}

interface Task {
  id: string;
  parentId?: string;
  level: TaskLevel;
  title: string;
  description?: string;
  status: TaskStatus;
  dependencies: string[];
  acceptanceCriteria: AcceptanceCriterion[];
  assignedWorkerId?: string;
  createdAt: string;
  updatedAt: string;
}
```

`parentId` expresses organizational hierarchy only. The hierarchy is
`epic -> task -> subtask -> atomic`.

`dependencies` contains IDs of tasks on which the current task depends. Thus,
`T4.dependencies = ["T2", "T3"]` means T4 depends on T2 and T3. Dependencies
may cross hierarchy branches and are not duplicate edges stored elsewhere.

### TaskGraph

```ts
interface TaskGraph {
  projectId: string;
  rootTaskIds: string[];
  tasks: Record<string, Task>;
}
```

Edges are derived from task dependencies. The protocol does not validate roots,
parents, missing references, cycles, levels, or statuses.

### Worker and Lease

```ts
type WorkerProvider = "codex" | "claude" | "opencode" | "demo";
type WorkerStatus = "idle" | "busy" | "offline";

interface Worker {
  id: string;
  provider: WorkerProvider;
  status: WorkerStatus;
  currentTaskId?: string;
  capabilities?: string[];
}

interface Lease {
  id: string;
  taskId: string;
  workerId: string;
  acquiredAt: string;
  expiresAt: string;
  lastHeartbeatAt: string;
}
```

`Lease` is only a temporary-authorization contract here. No expiration,
heartbeat, timer, or lease manager is implemented.

## Commands

Commands are requests sent to the future Core. They do not directly change
global state and are never converted into events by the Protocol package.

```ts
interface CommandEnvelope {
  id: string;
  protocolVersion: typeof PROTOCOL_VERSION;
  timestamp: string;
  projectId: string;
  actor: Actor;
}
```

The public `FlowctlCommand` union includes:

- `task.claim` with `taskId` and `workerId`;
- `task.start` with `taskId`, `workerId`, and `leaseId`;
- `task.complete` with `taskId`, `workerId`, and `leaseId`;
- `task.fail` with `taskId`, `workerId`, `leaseId`, and `reason`;
- `task.block` with `taskId`, `workerId`, `leaseId`, and `reason`;
- `lease.heartbeat` with `leaseId`, `taskId`, and `workerId`;
- `graph.mutation.propose` with a `GraphMutation`.

Each member has a lowercase dot-notation `type` literal and a typed payload.
The Protocol does not decide whether any command is valid.

## Events

Events are confirmed facts emitted by the future system. UI, desktop, and
overlay consumers will react to events rather than commands.

```ts
interface EventEnvelope {
  id: string;
  protocolVersion: typeof PROTOCOL_VERSION;
  timestamp: string;
  projectId: string;
  actor: Actor;
}
```

The public `FlowctlEvent` union includes:

- `task.created`, `task.ready`, `task.claimed`, `task.started`,
  `task.completed`, `task.failed`, `task.blocked`, and `task.cancelled`;
- `lease.created` and `lease.expired`;
- `worker.connected` and `worker.disconnected`;
- `graph.mutation.proposed`, `graph.mutation.approved`, and
  `graph.mutation.rejected`.

Each event has a specific typed payload. Mutation events follow this exact
convention:

- `graph.mutation.proposed` carries the complete `GraphMutation`;
- `graph.mutation.approved` carries at least `mutationId`;
- `graph.mutation.rejected` carries `mutationId` and `reason`.

## Graph mutations

`GraphMutation` represents a proposed graph change and domain context, not an
envelope duplicate:

```ts
interface GraphMutation {
  id: string;
  sourceTaskId?: string;
  reason: string;
  operations: GraphMutationOperation[];
}
```

It deliberately excludes `actor`, `timestamp`, `projectId`, and
`protocolVersion`; those belong to the command/event envelope. Its operations
are:

- `task.create`, carrying a complete `Task`;
- `dependency.add`, carrying `taskId` and `dependsOnTaskId`;
- `dependency.remove`, carrying `taskId` and `dependsOnTaskId`;
- `task.update`, carrying `taskId` and a deliberately limited patch:
  `Partial<Pick<Task, "title" | "description" | "parentId" | "level" | "acceptanceCriteria">>`.

The update patch cannot alter `id`, `status`, `dependencies`,
`assignedWorkerId`, `createdAt`, `updatedAt`, or any lease information.
Dependency relationships can only be expressed through the dedicated add and
remove operations. The Protocol does not validate, authorize, apply, or
sequence mutations.

## Testing strategy

Tests use TypeScript and the Node.js built-in `node:test` runner. TypeScript
compiles the tests before Node executes them; no type-testing or runtime-schema
library is added.

Tests will prove that:

1. an Epic can contain Tasks, Subtasks, and Atomic Tasks;
2. dependencies can cross hierarchy branches;
3. a simple DAG is representable by `TaskGraph`;
4. different worker providers share the same `Worker` contract;
5. commands narrow by `type`;
6. events narrow by `type` and can be checked exhaustively by TypeScript;
7. a mutation can create a dynamic subtask and add a dependency;
8. all public entities, unions, and `PROTOCOL_VERSION` are importable from
   `@flowctl/protocol`.

No test will implement scheduler behavior, state-machine transitions, cycle
detection, lease timing, or semantic graph validation.

## README and follow-ups

The root README will describe FlowCTL as a visual and control layer for coding
agent workflows, show the future agent-to-Core-to-desktop direction, and label
the current status as Protocol v0 / early MVP. It will not promise features
outside this increment.

Potential future work such as Core validation, state transitions, scheduling,
lease management, and adapters remains explicitly deferred rather than
implemented here.
