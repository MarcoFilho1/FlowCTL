# FlowCTL

FlowCTL is a visual and control layer for coding-agent workflows.

```text
Codex ──────┐
Claude ─────┼──→ FlowCTL Core ──→ Desktop / Overlay
OpenCode ───┘
```

**Status:** Protocol v0 / early MVP

This repository currently contains `@flowctl/protocol`: the shared TypeScript
contracts for projects, tasks, workers, leases, commands, events, and proposed
graph mutations. It does not implement FlowCTL Core, scheduling, adapters, a
desktop application, or an overlay.

See [Protocol v0](docs/protocol-v0.md) for the public contract.
