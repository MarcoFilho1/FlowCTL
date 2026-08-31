# FlowCTL

FlowCTL is a visual and control layer for coding-agent workflows.

```text
Codex ──────┐
Claude ─────┼──→ FlowCTL Core ──→ Desktop / Overlay
OpenCode ───┘
```

**Status:** Protocol v0, Core v0, and Control Plane v0

This repository contains:

- `@flowctl/protocol` — Protocol v0, with shared TypeScript contracts for
  projects, tasks, workers, leases, commands, events, and proposed graph
  mutations;
- `@flowctl/core` — Core v0, currently implementing structural graph
  validation, strict hierarchy validation, dependency and cycle validation,
  readiness, the `TaskStatus` state machine, and controlled in-memory
  `CoreState`.
- `@flowctl/control-plane` — Control Plane v0, currently supporting
  `task.claim`, Lease authority, `task.start`, `task.complete` into `review`,
  protocol Events, and an in-memory Event Log.

The following are not implemented: review approval into `completed`, dependent
readiness promotion, scheduler, real Workers or adapters, heartbeat/expiry/
recovery, persistence/networking, UI/Desktop/Overlay, or the Planner/LLM/Intent
Layer.

See [Protocol v0](docs/protocol-v0.md) for the public contract.
