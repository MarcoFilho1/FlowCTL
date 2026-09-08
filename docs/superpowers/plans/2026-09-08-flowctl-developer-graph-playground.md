# FlowCTL Developer Graph Playground v0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a browser-only developer Playground that makes the existing Protocol v0.2, Core v0, Control Plane v0, review completion, readiness propagation, and Basic Scheduling Policy visible through one deterministic four-task graph.

**Architecture:** `apps/playground` is a React/Vite consumer of public `@flowctl/control-plane` and `@flowctl/protocol` exports. The opaque `ControlPlane` handle remains in a React ref; every UI projection is rebuilt from public graph and Event Log snapshots after a synchronous dispatch. Graph edges are rendered by a local SVG layer and interactive HTML task nodes use deterministic fixture positions.

**Tech Stack:** React, React DOM, Vite, TypeScript strict, Vitest, `@testing-library/react`, and a DOM test environment. Existing package tests remain on Node `node:test`. No graph, state, transport, persistence, or desktop framework is added.

**Spec:** docs/superpowers/specs/2026-09-08-flowctl-developer-graph-playground-design.md

## Global Constraints

- Do not modify any file under `packages/protocol`, `packages/core`, or `packages/control-plane`.
- Do not modify Protocol/Core/Control Plane contracts, add their dependencies, or work around package exports with source aliases.
- The app may import only public exports from `@flowctl/control-plane` and public types/contracts from `@flowctl/protocol`.
- Use the existing public APIs: `createControlPlane`, `getTaskGraphSnapshot`, `dispatchCommand`, `getEventLogSnapshot`, and `selectReadyTaskIds`.
- Treat the Control Plane as the only operational authority. Do not copy or mutate a `TaskGraph`, `Task`, CoreState, ControlPlaneState, active Lease map, or Event Log.
- Keep hierarchy (`parentId`) separate from execution dependencies (`dependencies`); render edges only from dependencies.
- Keep the opaque Control Plane handle in `useRef`, never in React state and never reconstructed from internals.
- Use deterministic demo IDs, timestamps, Lease IDs, `workerId = "demo-worker"`, and Actor `{ type: "user", id: "playground" }`.
- Derive Lease IDs for Start and Complete from public accepted claim Events or the public Event Log. Do not create a second authoritative Lease map.
- Expose only the four supported UI actions: Claim, Start, Complete, and Approve Review. Do not add controls for Fail, Block, Heartbeat, Graph Mutation, Retry, or unsupported automation.
- Scheduler selection is a pure display operation. It must not claim, reserve, mutate readiness, create a Lease, or execute work.
- Use deterministic fixture-specific layout. Do not add React Flow, dagre, ELK, Zustand, Redux, Context-based global state, Tauri, a backend, networking, persistence, or a shared UI package.
- Target evergreen browsers with native `structuredClone`; do not add a polyfill or Node-only production import.
- Preserve root `pnpm test`, `pnpm typecheck`, and `pnpm build` behavior. The root `pnpm dev` command must delegate to the Playground after its compiled workspace dependency boundary is prepared.
- Do not add Playwright or Storybook in v0. The complete browser flow is a documented manual smoke test.
- Use a fresh subagent for every task, run the task review gate before advancing, and commit only a green task boundary. Do not leave a broken intermediate commit.

## Repository and file map

The implementation creates one app and keeps all view-specific code local to it:

```text
apps/playground/
  index.html
  package.json
  tsconfig.json
  tsconfig.node.json
  vite.config.ts
  src/main.tsx
  src/App.tsx
  src/styles.css
  src/demo/fixture.ts
  src/demo/control-plane.ts
  src/demo/command-factory.ts
  src/demo/runtime.ts
  src/model/graph-projection.ts
  src/model/status-presentation.ts
  src/model/lease-projection.ts
  src/components/GraphCanvas.tsx
  src/components/TaskNode.tsx
  src/components/TaskInspector.tsx
  src/components/SchedulerPanel.tsx
  src/components/EventLog.tsx
  src/components/CommandResult.tsx
  test/fixture-and-projection.test.ts
  test/components.test.tsx
  test/runtime.test.ts
```

Task ownership is cumulative only where explicitly stated below. `App.tsx` and `styles.css` are scaffolded in Task 1, then extended by Tasks 3–5. Each later task owns its additions and must preserve the earlier behavior. The app package owns its test configuration; no root test runner configuration is replaced.

The repository currently has no frontend dependency convention. Task 1 must inspect current compatible React/Vite/Vitest/testing-library package metadata before editing `apps/playground/package.json`; it must record the selected compatible versions in that package and the generated lockfile rather than inventing versions in this plan. Runtime dependencies are limited to `@flowctl/control-plane`, `@flowctl/protocol`, `react`, and `react-dom`. Build/test dependencies are limited to the Vite React plugin, Vite, React type packages, Vitest, the DOM environment, and `@testing-library/react`.

The public type strategy is fixed before implementation: `ControlPlane`, `CommandProcessingResult`, `FlowctlCommand`, `FlowctlEvent`, `TaskGraph`, `Task`, and `TaskStatus` are imported only from their public façades, as currently exported by Control Plane or Protocol. If an annotation is not publicly exported, derive it locally from a public function such as `ReturnType<typeof getTaskGraphSnapshot>` or omit the annotation. Do not change an upstream package merely to improve Playground typing.

## Task 1: Scaffold the executable Playground and workspace lifecycle

**Files:**

- Create `apps/playground/package.json`.
- Create `apps/playground/index.html`.
- Create `apps/playground/tsconfig.json` and `apps/playground/tsconfig.node.json`.
- Create `apps/playground/vite.config.ts`.
- Create `apps/playground/src/main.tsx`, `apps/playground/src/App.tsx`, and `apps/playground/src/styles.css`.
- Create the initial `apps/playground/test/components.test.tsx` with a shell render assertion.
- Modify `pnpm-workspace.yaml` to include `apps/*` while preserving `packages/*`.
- Modify root `package.json` to add `pnpm dev` delegation while preserving recursive test/typecheck/build scripts.
- Update `pnpm-lock.yaml` only through the package-manager operation required to record the declared app dependencies.

**Shared interfaces established:**

- `@flowctl/playground` is a private ESM workspace package.
- Scripts are explicit and compatible with the existing lifecycle: `dev`, `test`, `typecheck`, and `build`.
- `predev`, `pretest`, `pretypecheck`, and `prebuild` each invoke one local `prepare:flowctl` script, which runs `pnpm --filter @flowctl/control-plane build`. The existing Control Plane lifecycle then runs its `prepare:core` build, and Core runs its `prepare:protocol` build. This is the single workspace dependency preparation boundary for the app.
- `dev` starts Vite only after `prepare:flowctl` succeeds; `test` runs Vitest in one-shot mode with a DOM environment only after that preparation; `typecheck` runs strict TypeScript only after that preparation; `build` runs strict TypeScript and the Vite production build only after that preparation.
- The root `dev` script delegates to `@flowctl/playground`; root recursive scripts continue to discover the new workspace package.

The app package scripts must have this lifecycle shape (with the package's selected tool commands in the final values):

```text
prepare:flowctl  = pnpm --filter @flowctl/control-plane build
predev           = prepare:flowctl; dev = vite
pretest          = prepare:flowctl; test = vitest run
pretypecheck     = prepare:flowctl; typecheck = tsc -p tsconfig.json --noEmit
prebuild         = prepare:flowctl; build = tsc -p tsconfig.json --noEmit && vite build
```

The existing Control Plane `prebuild` invokes `prepare:core`, and Core `prebuild` invokes `prepare:protocol`. Thus every Playground command prepares the real package-export chain before Vite, TypeScript, or Vitest resolves it. Root `pnpm test`, `pnpm typecheck`, and `pnpm build` are recursive workspace commands; their correctness must not be attributed to recursion alone, because the Playground lifecycle scripts provide the explicit artifact guarantee.

**Setup sequence (not a fabricated RED):**

1. Capture `IMPLEMENTATION_BASE_SHA=$(git rev-parse HEAD)` before changing files.
2. Verify the clean synchronized baseline with `pnpm install --frozen-lockfile`, `pnpm test`, `pnpm typecheck`, and `pnpm build`; record the actual test count.
3. Inspect compatible current package metadata for React, Vite, the React Vite plugin, Vitest, the DOM environment, React types, and testing-library before selecting versions. Do not add a package without a use in the app or tests.
4. Create the scaffold and a minimal accessible shell with the title “FlowCTL Playground”. Do not pretend the final graph or controls exist yet.
5. Run `pnpm install` to update the workspace lockfile, then run the app and root validations.

Configuration is direct setup work, so there is no meaningful failing test for missing package metadata. The first behavioral RED starts in Task 2. The shell test may start GREEN after the scaffold exists.

**Verification:**

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
pnpm --filter @flowctl/playground test
pnpm --filter @flowctl/playground typecheck
pnpm --filter @flowctl/playground build
```

The filtered app commands must work before any manual package build because each app lifecycle script prepares `@flowctl/control-plane`, which prepares `@flowctl/core`, which prepares `@flowctl/protocol`. The root commands use pnpm recursive workspace execution, but do not rely on recursion alone to create artifacts. Confirm that the root build includes the app, the app emits a Vite production bundle, no package script reads another package’s `src`, and no stale `dist` workaround or alias was introduced.

**Review gate:** Fresh subagent review checks workspace discovery, dependency scope, strict TS/Vite configuration, root lifecycle preservation, the clean-checkout chain `Playground → Control Plane → Core → Protocol` for test/typecheck/build/dev, and absence of Protocol/Core/Control Plane changes. It must verify that the Playground test resolves public package exports with no pre-existing `dist`. Correct findings before advancing.

**Commit:** `feat(playground): scaffold browser playground`

## Task 2: Add the official demo runtime inputs and pure graph projections

**Files:**

- Create `apps/playground/src/demo/fixture.ts`.
- Create `apps/playground/src/demo/control-plane.ts`.
- Create `apps/playground/src/model/graph-projection.ts`.
- Create `apps/playground/src/model/status-presentation.ts`.
- Extend `apps/playground/test/fixture-and-projection.test.ts`.

**Shared interfaces:**

```ts
export type DemoNodePosition = Readonly<{ x: number; y: number }>;

export const DEMO_PROJECT_ID = "demo-project" as const;
export const DEMO_WORKER_ID = "demo-worker" as const;
export const DEMO_ACTOR = { type: "user", id: "playground" } as const;

export function createDemoTaskGraph(): TaskGraph;
export const DEMO_NODE_POSITIONS: Readonly<Record<string, DemoNodePosition>>;
export function createDemoControlPlaneOptions(): ControlPlaneOptions;

export type VisualNode = Readonly<{
  taskId: string;
  title: string;
  status: TaskStatus;
  dependencyCount: number;
  position: DemoNodePosition;
}>;

export type VisualEdge = Readonly<{
  fromTaskId: string;
  toTaskId: string;
}>;

export type StatusPresentation = Readonly<{
  label: string;
  symbol: string;
  className: string;
}>;

export function taskGraphToNodes(
  graph: TaskGraph,
  positions: Readonly<Record<string, DemoNodePosition>>
): readonly VisualNode[];
export function taskGraphToEdges(graph: TaskGraph): readonly VisualEdge[];
export function statusToPresentation(status: TaskStatus): StatusPresentation;
export function getMaterializedReadyTaskIds(graph: TaskGraph): readonly string[];
```

`createDemoControlPlaneOptions` creates fresh closure-owned Event/Lease/time counters for one future demo runtime; it is not a module-level singleton. The fixture uses the exact hierarchy `A epic -> B task -> C subtask -> D atomic`, dependencies `A: []`, `B: [A]`, `C: [A]`, `D: [B,C]`, and statuses A ready with B/C/D pending.

**RED:** Add tests that fail because the modules and functions do not yet exist. The tests must prove:

- the official fixture is accepted by `createControlPlane`;
- fresh calls to `createDemoControlPlaneOptions` do not share counters;
- canonical own graph keys are A, B, C, and D and `task.id` matches each key;
- `taskGraphToNodes` returns all four nodes at their fixed positions and preserves explicit statuses;
- `taskGraphToEdges` returns exactly A→B, A→C, B→D, and C→D, never a parent edge;
- the output ordering is deterministic and independent of object insertion order;
- `statusToPresentation` is exhaustive across pending, ready, claimed, running, blocked, review, completed, failed, and cancelled, with visible text and a non-color signal;
- `getMaterializedReadyTaskIds` returns only tasks whose snapshot status is `ready`, using own graph keys and no dependency/readiness recomputation.

**Expected failure:** Vitest cannot resolve the missing fixture/projection modules or the assertions fail because no projection exists.

**GREEN:** Implement the deterministic fixture options, pure projections, and status presentation. Use own canonical `graph.tasks` keys, a locale-independent comparator, and dependency arrays as the sole edge source. `getMaterializedReadyTaskIds` reads materialized status only; it is not a second readiness authority. Do not add command dispatch, React state, scheduler selection, or Lease storage in this task.

**Verification:**

```bash
pnpm --filter @flowctl/playground test -- fixture-and-projection
pnpm --filter @flowctl/playground typecheck
pnpm test
pnpm typecheck
pnpm build
```

**Review gate:** Fresh subagent verifies the fixture against the approved spec, checks hierarchy/dependency separation, exhaustive status rendering, deterministic ordering, and pure-function boundaries. Correct findings before advancing.

**Commit:** `feat(playground): add deterministic demo graph projections`

## Task 3: Render the graph and inspector with accessible selection

**Files:**

- Create `apps/playground/src/components/GraphCanvas.tsx`.
- Create `apps/playground/src/components/TaskNode.tsx`.
- Create `apps/playground/src/components/TaskInspector.tsx`.
- Extend `apps/playground/src/App.tsx` with graph and inspector composition.
- Extend `apps/playground/src/styles.css` with the dark technical layout, node states, SVG edge layer, sidebar, and responsive stacking rules.
- Extend `apps/playground/test/components.test.tsx`.

**Shared interfaces:**

```ts
export interface GraphCanvasProps {
  nodes: readonly VisualNode[];
  edges: readonly VisualEdge[];
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
}

export interface TaskInspectorProps {
  task: Task | null;
}
```

`GraphCanvas` renders dependency edges in an SVG layer behind interactive `TaskNode` buttons. `TaskNode` exposes task ID, title, status, and dependency count. `TaskInspector` exposes task ID, title, level, status, parentId, dependencies, acceptance criteria, and assignedWorkerId when present. The inspector never receives private state.

**RED:** Add component tests that fail because the graph/inspector components and their wiring are absent. Prove:

- the initial screen renders A, B, C, D and four dependency edge labels/accessible descriptions;
- selecting B updates the inspector to B without changing the graph source;
- every node is keyboard reachable and has an accessible name containing its canonical ID;
- status text remains visible alongside color/border treatment;
- parentId is shown as hierarchy metadata, while dependency labels represent only dependency edges.

**Expected failure:** The shell does not render the graph, selection has no handler, and inspector queries cannot find the selected task data.

**GREEN:** Wire the app to the fixture snapshot and local projection functions, keep selected Task ID in `useState`, and use deterministic positions from the fixture. Keep layout fixture-specific; do not add a generic layout engine or interactive canvas state. Preserve a clear one-screen developer-tool layout with graph, inspector, and reserved panel regions for later tasks.

**Verification:**

```bash
pnpm --filter @flowctl/playground test -- components
pnpm --filter @flowctl/playground typecheck
pnpm --filter @flowctl/playground build
```

**Review gate:** Fresh subagent checks keyboard access, visible non-color status signals, edge direction, absence of parent-derived edges, and no accidental domain state copy. Correct findings before advancing.

**Commit:** `feat(playground): render graph and task inspector`

## Task 4: Add command construction, lifecycle interaction, and Event Log projections

**Files:**

- Create `apps/playground/src/demo/command-factory.ts`.
- Create `apps/playground/src/demo/runtime.ts`.
- Create `apps/playground/src/model/lease-projection.ts`.
- Create `apps/playground/src/components/EventLog.tsx`.
- Create `apps/playground/src/components/CommandResult.tsx`.
- Extend `apps/playground/src/App.tsx` and `apps/playground/src/styles.css` with command controls, Reset, result panel, and Event Log.
- Extend `apps/playground/test/runtime.test.ts` and `apps/playground/test/components.test.tsx`.

**Shared interfaces:**

```ts
export function createClaimCommand(taskId: string, commandId: string): FlowctlCommand;
export function createStartCommand(taskId: string, leaseId: string, commandId: string): FlowctlCommand;
export function createCompleteCommand(taskId: string, leaseId: string, commandId: string): FlowctlCommand;
export function createReviewApproveCommand(taskId: string, commandId: string): FlowctlCommand;

export function getLeaseIdForTask(
  events: readonly FlowctlEvent[],
  taskId: string
): string | undefined;

export type PlaygroundSnapshot = Readonly<{
  graph: TaskGraph;
  events: readonly FlowctlEvent[];
  readyTaskIds: readonly string[];
  candidateTaskIds: readonly string[];
  lastResult: CommandProcessingResult | null;
}>;

export type DemoRuntime = Readonly<{
  controlPlane: ControlPlane;
  nextCommandId(): string;
}>;

export function createDemoRuntime(): DemoRuntime;

export function getPlaygroundSnapshot(
  runtime: DemoRuntime,
  schedulerLimit: number,
  lastResult: CommandProcessingResult | null
): PlaygroundSnapshot;

export function dispatchAndSync(
  runtime: DemoRuntime,
  command: FlowctlCommand,
  schedulerLimit: number
): { result: CommandProcessingResult; snapshot: PlaygroundSnapshot };
```

The runtime is a thin synchronous orchestration layer. `createDemoRuntime` is the one factory for a fresh Control Plane and all closure-owned demo counters: the Control Plane option counters come from `createDemoControlPlaneOptions`, and command IDs are owned by the runtime closure. There are no module-level mutable counters. `App` keeps the returned runtime handle in `useRef`; its nested opaque `ControlPlane` is never inspected, cloned, placed in state, or reconstructed. React state stores only the raw scheduler input, selection, last result, and a revision/snapshot projection. Reset discards the old ref value and assigns a new `createDemoRuntime()` result, isolating old/new counters and state.

`getPlaygroundSnapshot` calls `getTaskGraphSnapshot`, `getEventLogSnapshot`, `getMaterializedReadyTaskIds`, and `selectReadyTaskIds` in that order. `readyTaskIds` is the direct status projection; `candidateTaskIds` is the result of the scheduling policy. `dispatchAndSync` calls public `dispatchCommand`, then obtains a new projection. `getLeaseIdForTask` reads only public `lease.created` Events and applies deterministic latest-event semantics for the requested task. It is a presentation/command-plumbing projection, not an active Lease store. Start and Complete obtain their IDs from that helper immediately before factory construction.

**RED:** Add tests that fail because the factory, runtime, Event Log, and controls do not exist. Prove:

- each factory emits exactly the existing public `FlowctlCommand` shape for its discriminant, with no convenience fields invented by the Playground; deterministic IDs and any required envelope values come from the real Protocol contract and existing Control Plane options;
- Claim → Start → Complete → Review Approve produces the expected result Events and graph statuses through public dispatch;
- `CommandProcessingResult.events` represents only the current dispatch while `getEventLogSnapshot` represents accumulated history;
- Event Log renders real Event type, ID, timestamp, Actor, task, worker, and Lease fields where present;
- accepted results appear in `CommandResult` with Event types;
- a rejected result is rendered with its failure code and produces no graph/Event Log mutation;
- a mutation to the original command object after dispatch cannot change rendered or stored Events;
- mutation of an Event returned in a result or snapshot cannot change later snapshots or displayed history;
- after a claim, the UI offers Start; after start, Complete; after complete, Approve Review; terminal tasks expose no action;
- Reset restores the initial fixture, empties the Event Log, and resets deterministic IDs.

**Expected failure:** Missing factory/runtime APIs and UI controls leave the lifecycle tests unresolved; boundary mutation assertions fail because no clone-safe UI path exists.

**GREEN:** Implement the four factories against the actual public Protocol definitions, the single `createDemoRuntime` factory, public-snapshot runtime, Lease-ID extraction, and synchronous App refresh flow. Use one refresh path after every command; do not duplicate dispatch/snapshot logic across buttons. Render rejected results without adding fake unsupported controls. Use `structuredClone` only at the app projection boundary if needed to prevent UI mutation; never inspect or clone the opaque ControlPlane handle.

**Verification:**

```bash
pnpm --filter @flowctl/playground test -- runtime components
pnpm --filter @flowctl/playground typecheck
pnpm test
pnpm typecheck
pnpm build
```

**Review gate:** Fresh subagent verifies exact public API usage, no private-state access, Event Log/result separation, defensive boundaries, Actor provenance, Lease extraction, action gating, and atomic refresh behavior. Correct findings before advancing.

**Commit:** `feat(playground): exercise control plane lifecycle`

## Task 5: Add the scheduler panel, complete the milestone, and document operation

**Files:**

- Create `apps/playground/src/components/SchedulerPanel.tsx`.
- Extend `apps/playground/src/App.tsx` and `apps/playground/src/styles.css` with the scheduler panel and final layout polish.
- Extend `apps/playground/test/components.test.tsx` and `apps/playground/test/runtime.test.ts` with scheduler and full-flow coverage.
- Modify `README.md` only if it does not already accurately describe Protocol v0, Core v0, Control Plane v0, and the Playground v0 boundary.

**Shared interfaces:**

```ts
export interface SchedulerPanelProps {
  readyTaskIds: readonly string[];
  candidateTaskIds: readonly string[];
  rawLimitInput: string;
  schedulerError: string | null;
  onRawLimitInputChange: (value: string) => void;
}
```

The panel owns only the visual `rawLimitInput` string and displays two distinct lists: `readyTaskIds` comes from the snapshot status projection, while `candidateTaskIds` comes from `selectReadyTaskIds(graph, { limit })`. The UI initial value is `"2"`, explicitly distinct from the policy API default of 1. On each input change, parse the raw string only enough to pass a number to the existing policy; an empty string becomes an invalid numeric value, and decimal, negative, unsafe, or oversized values are allowed to reach the policy boundary. Catch the policy's `RangeError`, show its simple message, and clear candidates for that render. Do not duplicate the policy's semantic validation rules in the UI. HTML `min`/`step` may improve affordance but are not authority.

**RED:** Add integration/component tests that fail because the panel and final flow are absent. Prove:

- initial ready tasks show A, selected candidates show A, and the default limit is 2 without mutating the graph or Event Log;
- after approving A, ready tasks show B and C and both are selected at limit 2;
- after B is approved into completed, C remains ready and D remains pending;
- after C is approved into completed, D becomes ready and is selectable;
- changing the limit changes selection only, never task status or Lease history;
- a rejected command result is visible without a permanent invalid/unsupported command button;
- unsupported Protocol commands have no controls in the rendered UI;
- the full A → B/C → D browser-flow assertions pass, including Event ordering and Reset.

**Expected failure:** No scheduler panel exists, candidates are not projected with the configured limit, and the full DAG progression cannot be observed in the UI.

**GREEN:** Add the panel and complete the composition. Keep readiness exclusively in Core through the materialized status in Control Plane snapshots and selection exclusively in the existing scheduling policy. Use the approved fixture-specific positions and the dark technical visual direction without marketing gradients, 3D effects, or elaborate animation. Update README only with concise, factual Playground status and run instructions if needed; do not document future features as present.

**Verification:**

```bash
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

The Playground does not need to expose an application API for production use; the Vite browser build is the public validation. Do not add an artificial package export solely to create an import smoke test.

**Manual browser smoke:** From the implementation checkout after dependency installation, run `pnpm dev`, open the printed Vite URL, and verify:

1. The initial graph shows A above B/C above D with edges A→B, A→C, B→D, C→D; A is ready and the scheduler limit is 2.
2. Select a node and inspect its canonical fields, hierarchy metadata, dependencies, status, and acceptance criteria.
3. Claim A, start A, complete A, approve review; observe the status sequence and Event Log ordering.
4. Observe B and C become ready, and scheduler selection returns B/C without claiming either task.
5. Claim/start/complete/approve B and C in separate flows; observe D become ready only after both dependencies are approved into completed.
6. Verify no unsupported controls are present.
7. Press Reset and verify the initial graph, empty Event Log, cleared result, selection reset, and deterministic first IDs.

**Review gate:** Fresh subagent performs the full spec checklist, verifies the app contains no out-of-scope infrastructure, checks documentation accuracy, and reviews the final diff for stale-dist dependence and protected-package changes. Resolve all findings before final validation.

**Commit:** `feat(playground): complete scheduler playground milestone`

## Final validation (no validation-only commit)

Run these checks after Task 5 and before publication. Do not create a commit when they produce no file change.

```bash
git diff --name-only "$IMPLEMENTATION_BASE_SHA"..HEAD -- packages/protocol packages/core packages/control-plane
git diff --check "$IMPLEMENTATION_BASE_SHA"..HEAD
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
```

For fresh-checkout validation, create an archive checkout in a temporary directory from the final commit, assert that the archive contains no pre-existing `dist`, `dist-test`, or `node_modules`, then run the normal lifecycle without manually building a dependency first:

```bash
CLEAN_CHECKOUT="$(mktemp -d)"
mkdir -p "$CLEAN_CHECKOUT"
git archive HEAD | tar -x -C "$CLEAN_CHECKOUT"
test ! -e "$CLEAN_CHECKOUT/packages/protocol/dist"
test ! -e "$CLEAN_CHECKOUT/packages/protocol/dist-test"
test ! -e "$CLEAN_CHECKOUT/packages/core/dist"
test ! -e "$CLEAN_CHECKOUT/packages/core/dist-test"
test ! -e "$CLEAN_CHECKOUT/packages/control-plane/dist"
test ! -e "$CLEAN_CHECKOUT/packages/control-plane/dist-test"
test ! -e "$CLEAN_CHECKOUT/apps/playground/dist"
test ! -e "$CLEAN_CHECKOUT/apps/playground/dist-test"
test ! -e "$CLEAN_CHECKOUT/node_modules"
cd "$CLEAN_CHECKOUT"
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
```

The app lifecycle scripts make each root command prepare the same dependency chain: Playground lifecycle → Control Plane build → Core build → Protocol build → requested app test/typecheck/build. After installation in the archive, run `pnpm dev` separately for the manual interaction smoke; do not describe that dev server as production-bundle evidence. The automated evidence is the Vite production build from `pnpm build`; no preview lifecycle or automated browser dependency is added.

The final review records:

- actual test count and package breakdown;
- typecheck, build, and clean-archive results;
- manual browser smoke result;
- exact protected-path diff result;
- `git diff --check` result;
- dependency and scope review confirming only the Playground changed beyond approved root workspace/configuration files.

## Planned commit sequence

1. `feat(playground): scaffold browser playground`
2. `feat(playground): add deterministic demo graph projections`
3. `feat(playground): render graph and task inspector`
4. `feat(playground): exercise control plane lifecycle`
5. `feat(playground): complete scheduler playground milestone`

Each commit is made by its task subagent only after its RED/GREEN/refactor cycle, task tests, typecheck/build checks, and independent review gate pass. The plan itself is the only artifact created in the current planning session; implementation, dependency installation, branch creation, and lockfile changes begin only after explicit execution approval.

## Final self-review checklist

- [ ] Task 1 performs direct scaffold setup and does not claim a configuration failure as behavioral RED.
- [ ] Task 2 is the first behavioral RED and has exact fixture/projection assertions.
- [ ] Task 3 tests graph, SVG dependency edges, keyboard selection, and inspector content.
- [ ] Task 4 tests all four supported lifecycle Commands, result-vs-history separation, defensive boundaries, Lease extraction, and Reset.
- [ ] Task 5 tests scheduler limit 2, DAG progression, rejected results, unsupported-control absence, documentation, and manual browser flow.
- [ ] Every app lifecycle command prepares the public package-export chain without relying on recursive execution alone or pre-existing `dist`.
- [ ] Candidate state is always rebuilt from public Control Plane snapshots; the opaque handle is never cloned or inspected.
- [ ] No app code imports private modules or mutates domain structures.
- [ ] Command factories satisfy the actual existing Protocol discriminants and add no convenience fields.
- [ ] All app annotations use public upstream types or local derivations from public functions.
- [ ] The Scheduler panel shows materialized ready tasks separately from policy-selected candidates.
- [ ] Raw scheduler input can represent empty, fractional, negative, unsafe, and oversized values; semantic validation remains in `selectReadyTaskIds`.
- [ ] Rejection is tested without requiring an invalid UI control.
- [ ] All deterministic counters are closure-owned per runtime and Reset creates a fresh runtime.
- [ ] There is one demo runtime factory, not duplicate Control Plane factories.
- [ ] Lease IDs are projected only from public Events and no local authoritative Lease map exists.
- [ ] Archive validation asserts artifact absence before install instead of removing artifacts.
- [ ] Production build evidence and manual dev interaction evidence are reported separately.
- [ ] No Protocol/Core/Control Plane source or contract changes are planned.
- [ ] No scheduler automation, workers, adapters, leases management, transport, persistence, UI package, or desktop integration is planned.
- [ ] Fresh archive validation proves that no stale build artifact is required.
- [ ] No implementation, branch creation, dependency installation, or lockfile change occurs during this planning-only revision.
- [ ] No blocking architectural ambiguity remains before execution.
