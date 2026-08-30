# FlowCTL

FlowCTL is a visual and control layer for coding-agent workflows.

```text
Codex ──────┐
Claude ─────┼──→ FlowCTL Core ──→ Desktop / Overlay
OpenCode ───┘
```

**Status:** Protocol v0 and Core v0 / early MVP

This repository contains:

- `@flowctl/protocol` — Protocol v0, with shared TypeScript contracts for
  projects, tasks, workers, leases, commands, events, and proposed graph
  mutations;
- `@flowctl/core` — Core v0, currently implementing structural graph
  validation, strict hierarchy validation, dependency and cycle validation,
  readiness, the `TaskStatus` state machine, and controlled in-memory
  `CoreState`.

The following are not implemented: scheduler, real workers or adapters, lease
management, Commands/Events processing, persistence, HTTP/WebSocket, UI,
Desktop/Overlay, or the Planner/LLM/Intent Layer.

See [Protocol v0](docs/protocol-v0.md) for the public contract.
