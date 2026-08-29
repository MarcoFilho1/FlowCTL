# FlowCTL Protocol v0 final fix report

## Scope

Applied only the two final whole-branch documentation findings:

1. Replaced README wording that said the private workspace package is
   "currently publishes" with "currently contains."
2. Documented the intentional distinction between envelope `actor` (the
   originator) and payload `workerId` (the worker involved), including that
   they may differ.

## Scope boundaries preserved

- No protocol source or contract changed.
- No runtime behavior, dependencies, validation, Core, scheduler, UI, or
  adapters changed.
- No files under `apps/` or `adapters/` changed.

## Verification

- `pnpm typecheck`
- `pnpm test`
- Reviewed the final diff and changed-file list for scope compliance.
