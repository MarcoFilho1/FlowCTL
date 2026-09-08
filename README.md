# FlowCTL

FlowCTL is a visual and control layer for coding-agent workflows.

```text
Codex ──────┐
Claude ─────┼──→ FlowCTL Core ──→ Desktop / Overlay
OpenCode ───┘
```

**Status:** Protocol v0.2, Core v0, Control Plane v0, and Developer Graph
Playground v0

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
  in-memory Event Log. It also exposes a pull-oriented scheduling-policy
  boundary that only selects ready task IDs; it does not claim tasks, manage
  leases, assign workers, poll, or execute work.
- `@flowctl/playground` — browser-only developer harness for the deterministic
  A → B/C → D graph. It exposes task inspection, the supported lifecycle,
  materialized ready tasks, scheduling-policy candidates, public Events, and
  Reset without adding scheduler automation or another domain authority.

The following are not implemented: review rejection or rework, a scheduler
daemon or worker assignment/execution system, real Workers or adapters,
heartbeat/expiry/recovery, persistence/networking, Desktop/Overlay,
Planner/LLM/Intent Layer, Verifier, or GraphMutation application.

Run `pnpm install --frozen-lockfile`, then `pnpm dev`, and open the Vite URL
printed in the terminal. Use `pnpm test`, `pnpm typecheck`, and `pnpm build`
for repository-wide validation.

See [Protocol v0.2](docs/protocol-v0.md) for the public contract.
