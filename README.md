# FlowCTL

FlowCTL is a visual and control layer for coding-agent workflows.

```text
Codex ──────┐
Claude ─────┼──→ FlowCTL Core ──→ Desktop / Overlay
OpenCode ───┘
```

**Status:** Protocol v0.2, Core v0, and Control Plane v0

This repository contains:

- `@flowctl/protocol` — Protocol v0.2, with shared TypeScript contracts for
  projects, tasks, workers, leases, commands, events, and proposed graph
  mutations;
- `@flowctl/core` — Core v0, currently implementing structural graph
  validation, strict hierarchy validation, dependency and cycle validation,
  readiness, the `TaskStatus` state machine, and controlled in-memory
  `CoreState`.
- `@flowctl/control-plane` — Control Plane v0, currently supporting
  `task.claim`, Lease authority, `task.start`, `task.complete` into `review`,
  and `task.review.approve` from `review` into `completed`. Approval delegates
  global readiness reconciliation to Core, emits `task.completed` followed by
  any resulting `task.ready` Events, and records protocol Events in an
  in-memory Event Log.

The following are not implemented: review rejection or rework, Scheduler, real
Workers or adapters, heartbeat/expiry/recovery, persistence/networking,
UI/Desktop/Overlay, Planner/LLM/Intent Layer, Verifier, or GraphMutation
application.

See [Protocol v0.2](docs/protocol-v0.md) for the public contract.
