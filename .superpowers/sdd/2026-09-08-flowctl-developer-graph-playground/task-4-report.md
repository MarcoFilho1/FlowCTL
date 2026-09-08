# Task 4 Report

## Status

Implemented Task 4 only: exact public Protocol command factories for `task.claim`, `task.start`, `task.complete`, and `task.review.approve`; a closure-owned demo runtime; public snapshot and dispatch/sync helpers; Event-only Lease projection; lifecycle controls; Command Result; Event Log; and Reset.

No scheduler panel or unsupported lifecycle controls were added. No files under `packages/protocol`, `packages/core`, or `packages/control-plane` were modified. No subagent or reviewer was spawned.

## TDD evidence

Initial RED:

```text
pnpm --filter @flowctl/playground test -- runtime components
FAIL test/runtime.test.ts: missing ../src/demo/command-factory.js
FAIL test/components.test.tsx: missing ../src/components/CommandResult.js
Test Files 2 failed | 1 passed
```

Defensive-boundary RED found during self-review:

```text
pnpm --filter @flowctl/playground test -- runtime
FAIL runtime snapshots and dispatch results are defensive at command, Event, and result boundaries
Expected Actor id playground, received mutated
Test Files 1 failed | 2 passed; Tests 1 failed | 18 passed
```

GREEN fix: each command envelope now owns a fresh Actor value. Runtime projections use `structuredClone` without cloning or inspecting the opaque `ControlPlane` handle.

## Verification evidence

All required commands exited successfully:

```text
pnpm --filter @flowctl/playground test -- runtime components
Test Files 3 passed (3); Tests 19 passed (19)

pnpm --filter @flowctl/playground typecheck
exit 0

pnpm --filter @flowctl/playground build
48 modules transformed; built successfully

pnpm test
all workspace test suites passed, including Playground 19/19

pnpm typecheck
all four workspace project typechecks passed

pnpm build
all four workspace project builds passed; Playground built 48 modules
```

## Self-review

- Imports use only public `@flowctl/control-plane` and `@flowctl/protocol` entry points plus Task 2/3 local modules.
- The opaque runtime/Control Plane handle remains in `useRef`; it is not inspected, cloned, or stored in React state.
- There is no local authoritative Lease map; Start and Complete derive the latest Lease ID only from public `lease.created` Events.
- `CommandProcessingResult.events` renders only the current dispatch; Event Log renders accumulated public history.
- Accepted and rejected results, no-mutation rejection behavior, defensive command/Event/result/snapshot boundaries, action gating, terminal no-action behavior, deterministic counter isolation, and Reset are covered.
- Every action uses one `dispatchAndSync` refresh path. Reset replaces the runtime ref with a fresh closure-owned runtime.
- No scheduler panel, persistence, networking, private source alias, or unsupported command control was added.

## Concerns

None. Task 5 still owns the scheduler panel and editable scheduler limit UI.
