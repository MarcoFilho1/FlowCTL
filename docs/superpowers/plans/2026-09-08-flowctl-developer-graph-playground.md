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
- `dev` starts Vite after preparing the existing Control Plane build boundary.
- `test` runs Vitest in one-shot mode with a DOM environment; `typecheck` uses strict TypeScript; `build` typechecks and runs the Vite production build.
- The root `dev` script delegates to `@flowctl/playground`; root recursive scripts continue to discover the new workspace package.

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

Confirm that the root build includes the app, the app emits a Vite production bundle, no package script reads another package’s `src`, and no stale `dist` workaround or alias was introduced.

**Review gate:** Fresh subagent review checks workspace discovery, dependency scope, strict TS/Vite configuration, root lifecycle preservation, and absence of Protocol/Core/Control Plane changes. Correct findings before advancing.

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
export function createDemoControlPlane(): ControlPlane;

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
```

`createDemoControlPlane` supplies deterministic `ControlPlaneOptions` and treats rejection of the official fixture as an invariant/programming error at this demo boundary. It must not change Control Plane behavior or add a second state authority. The fixture uses the exact hierarchy `A epic -> B task -> C subtask -> D atomic`, dependencies `A: []`, `B: [A]`, `C: [A]`, `D: [B,C]`, and statuses A ready with B/C/D pending.

**RED:** Add tests that fail because the modules and functions do not yet exist. The tests must prove:

- the official fixture is accepted by `createControlPlane`;
- canonical own graph keys are A, B, C, and D and `task.id` matches each key;
- `taskGraphToNodes` returns all four nodes at their fixed positions and preserves explicit statuses;
- `taskGraphToEdges` returns exactly A→B, A→C, B→D, and C→D, never a parent edge;
- the output ordering is deterministic and independent of object insertion order;
- `statusToPresentation` is exhaustive across pending, ready, claimed, running, blocked, review, completed, failed, and cancelled, with visible text and a non-color signal.

**Expected failure:** Vitest cannot resolve the missing fixture/projection modules or the assertions fail because no projection exists.

**GREEN:** Implement only the deterministic fixture and pure presentation functions. Use own canonical `graph.tasks` keys, a locale-independent comparator, and dependency arrays as the sole edge source. Do not add command dispatch, React state, scheduler behavior, or Lease logic in this task.

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
export type CommandCounter = { nextCommandId(): string; reset(): void };

export function createClaimCommand(taskId: string, id: string): FlowctlCommand;
export function createStartCommand(taskId: string, leaseId: string, id: string): FlowctlCommand;
export function createCompleteCommand(taskId: string, leaseId: string, id: string): FlowctlCommand;
export function createReviewApproveCommand(taskId: string, id: string): FlowctlCommand;

export function getLeaseIdForTask(
  events: readonly FlowctlEvent[],
  taskId: string
): string | undefined;

export type PlaygroundSnapshot = Readonly<{
  graph: TaskGraph;
  events: readonly FlowctlEvent[];
  candidates: readonly string[];
  lastResult: CommandProcessingResult | null;
}>;

export function getPlaygroundSnapshot(
  controlPlane: ControlPlane,
  schedulerLimit: number,
  lastResult: CommandProcessingResult | null
): PlaygroundSnapshot;

export function dispatchAndSync(
  controlPlane: ControlPlane,
  command: FlowctlCommand,
  schedulerLimit: number
): { result: CommandProcessingResult; snapshot: PlaygroundSnapshot };

export function createFreshDemoControlPlane(): ControlPlane;
```

The runtime is a thin synchronous orchestration layer. `App` keeps the returned opaque `ControlPlane` in `useRef`; React state stores only selection, scheduler limit, last result, and a revision/snapshot projection. `getPlaygroundSnapshot` calls `getTaskGraphSnapshot`, `getEventLogSnapshot`, and `selectReadyTaskIds` in that order. `dispatchAndSync` calls public `dispatchCommand`, then obtains a new projection. Reset replaces the ref handle with `createFreshDemoControlPlane`, resets counters and selection, and never rewinds an existing handle.

`getLeaseIdForTask` reads only public `lease.created` Events and applies deterministic latest-event semantics for the requested task. It is a presentation/command-plumbing projection, not an active Lease store. Start and Complete obtain their IDs from that helper immediately before factory construction.

**RED:** Add tests that fail because the factory, runtime, Event Log, and controls do not exist. Prove:

- each factory emits the exact supported Protocol command shape, deterministic ID, project, timestamp, Actor, and demo worker values;
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

**GREEN:** Implement the four factories, public-snapshot runtime, Lease-ID extraction, and synchronous App refresh flow. Use one refresh path after every command; do not duplicate dispatch/snapshot logic across buttons. Render rejected results without adding fake unsupported controls. Use `structuredClone` only at the app projection boundary if needed to prevent UI mutation; never inspect or clone the opaque ControlPlane handle.

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
  limit: number;
  onLimitChange: (limit: number) => void;
}
```

The panel owns only the UI limit. It calls the existing `selectReadyTaskIds(graph, { limit })` through the runtime projection. The UI initial limit is 2 for the demo, explicitly distinct from the policy API default of 1. Invalid limits are rejected at the input boundary and shown as a simple message. The panel labels ready candidates separately from selected candidates.

**RED:** Add integration/component tests that fail because the panel and final flow are absent. Prove:

- initial candidates show A and the default limit is 2 without mutating the graph or Event Log;
- after approving A, B and C are both ready and both are selected at limit 2;
- after B completes, C remains ready and D remains pending;
- after C completes, D becomes ready and is selectable;
- changing the limit changes selection only, never task status or Lease history;
- a rejected command result is visible without a permanent invalid/unsupported command button;
- unsupported Protocol commands have no controls in the rendered UI;
- the full A → B/C → D browser-flow assertions pass, including Event ordering and Reset.

**Expected failure:** No scheduler panel exists, candidates are not projected with the configured limit, and the full DAG progression cannot be observed in the UI.

**GREEN:** Add the panel and complete the composition. Keep readiness exclusively in Core through Control Plane snapshots and selection exclusively in the existing scheduling policy. Use the approved fixture-specific positions and the dark technical visual direction without marketing gradients, 3D effects, or elaborate animation. Update README only with concise, factual Playground status and run instructions if needed; do not document future features as present.

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
6. Trigger one rejected command through a real stale/duplicate interaction path and verify the result panel; verify no unsupported controls are present.
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

For fresh-checkout validation, create an archive checkout in a temporary directory from the final commit, explicitly ensure the archive contains no pre-existing `dist`, `dist-test`, or `node_modules`, then run:

```bash
git archive HEAD | tar -x -C "$CLEAN_CHECKOUT"
cd "$CLEAN_CHECKOUT"
find . -type d \( -name dist -o -name dist-test -o -name node_modules \) -prune -exec rm -rf {} +
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
```

The clean archive `pnpm build` must compile workspace packages and the Vite browser bundle from source. After the normal build, verify the browser package by opening the Vite production output through the normal dev/preview path and repeat the manual smoke. No automated browser dependency is added.

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
- [ ] Candidate state is always rebuilt from public Control Plane snapshots; the opaque handle is never cloned or inspected.
- [ ] No app code imports private modules or mutates domain structures.
- [ ] No Protocol/Core/Control Plane source or contract changes are planned.
- [ ] No scheduler automation, workers, adapters, leases management, transport, persistence, UI package, or desktop integration is planned.
- [ ] Fresh archive validation proves that no stale build artifact is required.
- [ ] No blocking architectural ambiguity remains before execution.
