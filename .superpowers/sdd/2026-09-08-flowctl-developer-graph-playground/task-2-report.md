# Task 2 report: deterministic demo graph projections

## Scope delivered

- Added the official A/B/C/D demo `TaskGraph` and fixed fixture-specific positions.
- Added a fresh closure-owned `ControlPlaneOptions` factory with deterministic Event, Lease, and time counters.
- Added pure node, dependency-edge, and materialized-ready projections over canonical own `graph.tasks` keys.
- Added exhaustive, visible status presentations with a text label and symbol for every Protocol task status.
- Added focused fixture/projection tests.

## TDD record

1. RED: added `fixture-and-projection.test.ts` before the implementation.
2. RED verification: `pnpm --filter @flowctl/playground test -- fixture-and-projection` failed because Vite could not resolve the missing `src/demo/fixture.js` module.
3. GREEN: added the fixture, options factory, and pure projections; the focused test command passed with 7 tests.
4. REFACTOR: removed a redundant fixture wrapper and repeated the full validation suite.

## Boundary review

- The fixture is accepted by public `createControlPlane` and has the required hierarchy, dependencies, and initial statuses.
- `Object.keys(graph.tasks)` supplies the canonical own keys; ordering uses code-unit comparison rather than locale collation.
- Edges are generated only from dependency arrays. `parentId` is not read by edge projection.
- Ready IDs filter only materialized `status === "ready"`; they do not inspect dependencies or call Core/scheduler readiness APIs.
- The implementation imports only public Protocol and Control Plane types/APIs and does not modify Protocol, Core, or Control Plane.
- No commands, React state, scheduler selection, or Lease storage were added. `nextLeaseId` is the required public options callback, not storage.
- External review was not requested because the task explicitly prohibited spawning reviewers; this self-review covered the stated review gate checks.

## Verification

- `pnpm --filter @flowctl/playground test -- fixture-and-projection` — passed: 2 files, 7 tests.
- `pnpm --filter @flowctl/playground typecheck` — passed.
- `pnpm test` — passed.
- `pnpm typecheck` — passed.
- `pnpm build` — passed.
- `git diff --check` — passed.

## Concerns

None. The fixed coordinates are intentionally fixture-specific; generic graph layout remains out of scope.
