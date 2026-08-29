# Final Fix Report: Core v0 review findings

Date: 2026-08-29

## Scope completed

This pass addressed every finding from the final Core v0 review without
modifying `@flowctl/protocol`.

- Fixed the `CoreState` success-path reference leak by storing a defensive
  cloned task and returning a second defensive clone from
  `applyTaskTransition`.
- Replaced inherited-property lookups with canonical own-key task resolution
  across validation, readiness, cycle traversal, and state lookup so missing
  IDs such as `toString`, `constructor`, and `__proto__` return domain results
  instead of leaking object-prototype behavior.
- Added package-level `prepare:protocol` hooks for `build`, `typecheck`, and
  `build:test` so `@flowctl/core` establishes Protocol build output from a
  clean checkout before compiling or testing.
- Replaced locale-sensitive ordering with one explicit locale-independent
  comparator for task IDs, related IDs, cycle paths, and readiness ordering.
- Replaced cycle deduplication by delimiter-joined string keys with
  comparator-based structural deduplication, including regression coverage for
  task IDs containing NUL.

## Implementation commit

- Commit SHA: `ec0a72a`
- Commit message: `fix(core): address final review findings`

## Changed files

- `packages/core/package.json`
- `packages/core/src/core-state.ts`
- `packages/core/src/graph-validation.ts`
- `packages/core/src/readiness.ts`
- `packages/core/src/task-graph-helpers.ts`
- `packages/core/test/core.test.ts`

## Test and validation results

Working tree validation in `/Users/marcofilho1/Desktop/things/FlowCTL`:

- `CI=true pnpm --filter @flowctl/core test`
  - passed, 61 tests, 0 failures
- `CI=true pnpm --filter @flowctl/core typecheck`
  - passed
- `CI=true pnpm --filter @flowctl/core build`
  - passed
- `CI=true pnpm test`
  - passed (`@flowctl/protocol` 6 tests, `@flowctl/core` 61 tests)
- `CI=true pnpm typecheck`
  - passed
- `CI=true pnpm build`
  - passed
- `git diff --check`
  - passed

## Clean-checkout reproducibility evidence

Temporary archive checkout source:

- Commit archived: `ec0a72a`
- Temporary path: `/private/tmp/flowctl-core-final-fix-eyWqWx`

Artifact check before install:

- `find /private/tmp/flowctl-core-final-fix-eyWqWx \( -name dist -o -name dist-test \) -type d`
  - no output; the archive started without tracked `dist` or `dist-test`

Commands run in the temporary checkout after `CI=true pnpm install`:

- `CI=true pnpm --filter @flowctl/core test`
  - passed, 61 tests, 0 failures
- `CI=true pnpm --filter @flowctl/core typecheck`
  - passed
- `CI=true pnpm --filter @flowctl/core build`
  - passed
- `CI=true pnpm test`
  - passed
- `CI=true pnpm typecheck`
  - passed
- `CI=true pnpm build`
  - passed

Observed behavior:

- `@flowctl/core` now runs `prepare:protocol` before its local build,
  typecheck, and test compilation steps.
- The clean archive required no pre-existing Protocol `dist` output.

## Concerns

- No source or contract files under `packages/protocol` were modified.
- The pre-existing untracked `.pnpm-store/` directory in the main workspace was
  left untouched.
- No generated build artifacts were added to git.
