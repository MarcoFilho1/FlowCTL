# Task 3 Report

## Summary

Implemented pure readiness calculation in `packages/core/src/readiness.ts` and exposed `getReadyTaskIds` through the core facade.

## RED

- Added readiness tests in `packages/core/test/core.test.ts` before implementation.
- Initial verification failed as expected with:
  - `TS2339: Property 'getReadyTaskIds' does not exist on type 'typeof import(.../packages/core/src/index')'`

## GREEN

- Implemented `getReadyTaskIds(graph: TaskGraph): readonly string[]`.
- Implemented module-internal `areTaskDependenciesCompleted(graph, task)`.
- Added private incomplete-dependency collection helper sorted lexicographically.
- Verified:
  - `CI=true pnpm --filter @flowctl/core test` ✅
  - `CI=true pnpm --filter @flowctl/core typecheck` ✅

## Changed Files

- `packages/core/src/readiness.ts`
- `packages/core/src/index.ts`
- `packages/core/test/core.test.ts`

## Self-Review

- Readiness is based only on pending status plus dependency completion.
- Missing dependencies resolve to not ready.
- Hierarchy and parent relationships are ignored.
- Input graphs are not mutated.
- Ready task ids are returned in lexicographic order.
- The internal dependency helper is not exported from `packages/core/src/index.ts`.

## Concerns

- No functional concerns remain from this task.
- The local untracked `.pnpm-store/` directory was left untouched and is not part of the commit.

## Fix Round 1

### Changed Files

- `packages/core/test/core.test.ts`
- `.superpowers/sdd/2026-08-29-flowctl-core-v0/task-3-report.md`

### Command

- `CI=true pnpm --filter @flowctl/core test`

### Output

- `31` tests passed, `0` failed.
- Added coverage for a pending task whose dependency is completed in another hierarchy branch.
