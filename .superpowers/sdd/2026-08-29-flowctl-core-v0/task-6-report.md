# Task 6 Report

## Summary

Completed the final public facade validation for `@flowctl/core` by extending the internal source-facade test suite with explicit runtime-surface checks and exhaustive TypeScript union narrowing coverage. The public barrel in `packages/core/src/index.ts` already matched the approved Task 6 surface, so no facade export changes were required.

## Implementation Commit

- Commit SHA: `3cfb1a6`
- Commit message: `test(core): verify public Core v0 contract`

## Changed Files

- `packages/core/test/core.test.ts`
- `.superpowers/sdd/2026-08-29-flowctl-core-v0/task-6-report.md`

## Tests And Validation

- `CI=true pnpm --filter @flowctl/core test`
- `CI=true pnpm test`
- `CI=true pnpm typecheck`
- `CI=true pnpm build`
- `cd packages/core && node --input-type=module -e 'const core = await import("@flowctl/core"); if (typeof core.validateTaskGraph !== "function") process.exit(1); console.log("public import: @flowctl/core")'`
- `git diff --check`
- `rg -n 'from "\./index\.js"' packages/core/src`
- `rg -n 'zod|json schema|runtime schema|scheduler|lease manager|heartbeat|http|websocket|event store|database|adapter|overlay|llm|planner' packages/core/src`
- `git diff --name-only origin/main..HEAD`
- `git status --short --branch`

## What The New Coverage Verifies

- The source barrel exports exactly the intended runtime facade functions and no extra runtime symbols.
- `GraphValidationIssue` narrowing remains exhaustive across every public issue code.
- `TaskTransitionResult`, `CoreStateResult`, and `CoreTaskTransitionResult` narrowing remains exhaustive across every public union branch.
- The built package resolves through `import("@flowctl/core")` after `pnpm build`.

## Concerns

- No functional concerns remain for Task 6.
- `git diff --name-only origin/main..HEAD` shows prior branch history from earlier Core tasks as expected; this task itself changed only `packages/core/test/core.test.ts` plus this report file.
- The local untracked `.pnpm-store/` directory existed before this task and was left untouched.
