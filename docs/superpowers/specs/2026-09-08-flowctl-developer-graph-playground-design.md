# FlowCTL Developer Graph Playground v0

## Status

This document specifies FlowCTL Increment #5.5, Developer Graph Playground v0. It is an architectural design only. It adds no application, dependency, lockfile, or domain behavior.

The Playground is a developer-facing visual harness for exercising FlowCTL's public graph, lifecycle, event, and scheduling APIs. It is not the final Desktop, Overlay, or worker product.

## 1. Objective

Provide a local browser application that makes the existing Protocol v0.2, Core v0, Control Plane v0, review completion, readiness propagation, and Basic Scheduling Policy visible and interactive.

The intended flow is:

    TaskGraph snapshot → graph visualization → Control Plane Commands
    → lifecycle changes → Event Log → scheduling-policy selection

## 2. Non-goals

This increment does not implement Desktop, Overlay, Workers, adapters, a server, networking, persistence, authentication, or new behavior in Protocol, Core, or Control Plane.

## 3. Architectural boundary

    @flowctl/protocol → @flowctl/core → @flowctl/control-plane → apps/playground

The Playground may depend on @flowctl/control-plane and @flowctl/protocol as workspace packages. It must not import Core for operations, another package's src, private handlers, readiness helpers, Lease maps, ControlPlaneState, or other internals.

## 4. Location and package

Create one executable application at apps/playground named @flowctl/playground. The workspace must include apps/* in addition to packages/*.

Do not create @flowctl/ui, @flowctl/graph, or @flowctl/visualization. Components stay local until a second real consumer justifies extraction.

## 5. Chosen architecture

Choose Architecture A: a browser-only React app consuming Control Plane directly. It has no Node demo server and no transport protocol.

Architecture B, a Node server plus browser frontend, is rejected because it adds networking, serialization, another state layer, and a second boundary. Architecture C, a CLI/TUI, is rejected because it does not provide the browser graph and inspector experience required by this increment.

## 6. Frontend stack

Use React, Vite, TypeScript, and an SVG/CSS graph renderer implemented in the app. React provides the smallest healthy component model for this screen; Vite provides the browser build and dev server.

Do not add React Flow, dagre, ELK, Zustand, Redux, or another graph/layout/state framework in v0.

## 7. Dependencies

Runtime dependencies may be:

- @flowctl/control-plane;
- @flowctl/protocol;
- react;
- react-dom.

Build/test tooling may include the Vite React plugin, Vite, React type packages, Vitest, a DOM environment, and @testing-library/react.

No dependency is added by this spec. Protocol, Core, and Control Plane receive no new dependency.

## 8. Browser compatibility

Target evergreen browsers with native structuredClone.

The current production packages use browser-available primitives including Map, WeakMap, Object.hasOwn, Number.isSafeInteger, and structuredClone. They do not import node APIs, filesystem, process, crypto, or test-runner APIs. structuredClone is a browser requirement, not a Node-only dependency.

Do not add a polyfill. Do not use Vite aliases that bypass package exports.

## 9. Dev and build lifecycle

Current packages export compiled entry points under dist. The desired root flow is:

    pnpm dev
    → delegate to @flowctl/playground
    → build @flowctl/control-plane and its workspace dependencies
    → start Vite

The Playground's predev preparation must invoke the existing Control Plane build boundary. Control Plane already prepares Core, and Core prepares Protocol. This is an explicit build prerequisite, not a stale-dist workaround.

The existing root commands remain available and include the app:

    pnpm test
    pnpm typecheck
    pnpm build

The app must use real package exports in dev, tests, and build.

## 10. Authoritative public APIs

All operations use only:

    createControlPlane
    getTaskGraphSnapshot
    dispatchCommand
    getEventLogSnapshot
    selectReadyTaskIds

Public Protocol contracts may be used for fixture construction and typing. No new public API is required. A real API gap discovered during implementation must be reported before changing Protocol, Core, or Control Plane.

## 11. Official fixture

The fixture must be accepted by Core:

    Hierarchy:
    A epic
    └── B task
        └── C subtask
            └── D atomic

    Execution dependencies:
    A: []
    B: [A]
    C: [A]
    D: [B, C]

    Initial status:
    A = ready
    B = pending
    C = pending
    D = pending

The dependency DAG is:

        A
       / \
      B   C
       \ /
        D

The distinction is deliberate: hierarchy and execution dependencies are independent concepts. parentId never creates a dependency edge.

## 12. Primary acceptance path

    pnpm dev → open Playground → see A → B/C → D
    → Claim A → Start A → Complete A → A is review
    → Approve Review → A is completed → B/C are ready
    → scheduler limit 2 selects B,C → Event Log shows real Events

The Playground never claims, starts, computes readiness, or creates Leases automatically.

## 13. Graph source of truth

    Control Plane → getTaskGraphSnapshot(controlPlane) → UI projection

The app must not maintain an operational mutable TaskGraph copy or mutate Tasks directly.

## 14. TaskGraph projection

Pure app-local functions may live in apps/playground/src/model/, for example:

    taskGraphToNodes(graph, positions)
    taskGraphToEdges(graph)
    statusToPresentation(status)

These are presentation functions, not domain models or authorities. Nodes use own canonical graph.tasks keys. For B.dependencies = [A], the edge is A → B. Edges are never inferred from parentId.

## 15. Layout ruling

v0 has no generic DAG auto-layout. Use deterministic positions specific to the four-node fixture, such as DEMO_NODE_POSITIONS:

    A at the top; B and C in the middle; D at the bottom.

Positions are UI data only. React Flow, dagre, and ELK are excluded. Generic layout may be reconsidered only for dynamic/larger graphs, real pan/zoom, or a proven #6/Desktop need.

## 16. Graph rendering

GraphCanvas renders dependency edges beneath interactive Task nodes using SVG/CSS. Nodes are selectable and keyboard reachable. SVG text must not be the only interaction mechanism when that harms accessibility; use semantic interactive elements or suitable labels and focus behavior.

## 17. Node and inspector contents

The graph summary shows canonical Task ID, explicit status, short title, and dependency count.

The inspector shows canonical Task ID, title, level, status, parentId, dependencies, acceptance criteria, and assignedWorkerId when present.

Do not show chain-of-thought, private state, Lease maps, or invented data.

## 18. Status presentation

All Protocol statuses must have an explicit presentation:

    pending, ready, claimed, running, blocked,
    review, completed, failed, cancelled

Use visible text, badge, color, icon or symbol, and border/contrast. Color is never the sole signal. statusToPresentation must be exhaustive and tested.

## 19. Control Plane handle lifecycle

Store the opaque handle with useRef(controlPlane), not React state. After a Command:

    dispatchCommand
    → getTaskGraphSnapshot
    → getEventLogSnapshot
    → selectReadyTaskIds
    → React rerender

The handle is never inspected or reconstructed by the app.

## 20. React state model

Use useRef, useState, and useMemo for:

- the opaque Control Plane handle;
- selected Task ID;
- scheduler limit;
- last Command result;
- a revision counter or derived snapshots;
- nodes, edges, status projections, and candidates.

Do not add Redux, Zustand, global Context architecture, or another store. Do not put a second authoritative TaskGraph in React state.

## 21. Supported controls

    ready    → Claim
    claimed  → Start
    running  → Complete
    review   → Approve Review
    terminal → no action

Do not show Fail, Block, Heartbeat, Graph Mutation, Retry, or another unsupported Command.

## 22. Command factory

Use a small transparent local module such as apps/playground/src/demo/command-factory.ts. It constructs only the four supported Commands and uses deterministic Command IDs.

Start and Complete obtain Lease IDs only from the accepted claim's public lease.created Event or the public Event Log. The factory never accesses activeLeaseByTaskId.

## 23. Demo Worker and Actor

Use only:

    workerId = demo-worker

This is a demonstration payload value. Do not create a Worker Registry, Worker object authority, dropdown, connection state, availability model, or Worker lifecycle.

Commands triggered by the UI use:

    { type: user, id: playground }

Actor represents causal provenance, not authentication. No auth is added.

## 24. Deterministic IDs and clock

Because the real createControlPlane API requires ControlPlaneOptions, the fixture supplies deterministic functions for Event IDs, Lease IDs, timestamps, and Lease expiry values. Counters reset on Reset. Avoid random IDs and the real clock unless a later requirement proves they are needed.

## 25. Scheduler panel

The panel shows:

    Scheduler
    limit [N]
    Candidates [...]

It calls selectReadyTaskIds(currentSnapshot, { limit }) and distinguishes ready from selected by Scheduling Policy.

Selection does not claim, reserve, mutate, create a Lease, or recompute readiness. Invalid limits are caught at the UI boundary and shown simply.

## 26. Event Log

The sole source is getEventLogSnapshot(controlPlane). Useful fields are Event type, Event ID, timestamp, Actor, Task ID, Worker ID when applicable, and Lease ID when applicable.

The primary flow should visibly produce:

    lease.created
    task.claimed
    task.started
    task.review_requested
    task.completed
    task.ready

No subscription or persistence is added.

## 27. Command result

Use a simple result panel showing either success and produced Event types or a failure code such as TASK_NOT_READY. It must make this boundary visible:

    scheduling candidate != claim admission

Do not add a toast framework.

## 28. Reset

Reset creates a new Control Plane from the official fixture and fresh demo options. It resets Event, Lease, and Command counters, selection, and last result. It does not undo Events or mutate an existing graph backward.

## 29. UI structure

Use one developer-tooling screen:

    ┌──────────────────────────────────────────────────────┐
    │ FlowCTL Playground                              Reset │
    ├────────────────────────────────┬─────────────────────┤
    │                                │ Task Inspector      │
    │ Dependency DAG                 ├─────────────────────┤
    │                                │ Scheduler           │
    │                                ├─────────────────────┤
    │                                │ Last Result         │
    ├────────────────────────────────┴─────────────────────┤
    │ Event Log                                             │
    └──────────────────────────────────────────────────────┘

The canvas gets most space, the sidebar is about 280–360px on desktop/small laptop, and the Event Log is at the bottom. Narrow viewports may stack panels; mobile product-quality is out of scope.

## 30. Visual direction

Use a dark technical graph-debugger/control-plane-inspector direction with high legibility, restrained status colors, and clear borders. No marketing gradients, 3D, elaborate animation, or branding project.

## 31. Testing strategy

The existing repository uses strict TypeScript and Node node:test, but has no frontend tooling. The minimum frontend stack is Vitest, @testing-library/react, and a DOM test environment. Existing package tests remain unchanged.

Unit coverage includes node projection, dependency edges, all status presentations, fixture layout, Command factory, public Lease-ID extraction, and scheduler limits.

Component/integration coverage includes initial DAG, selection/inspector, Claim/Start/Complete/Approve Review, A→completed and B/C→ready, limit 2, Event Log, Reset, rejected Commands, and absence of unsupported controls.

Do not add Playwright in v0. The complete browser flow is a manual acceptance smoke; automation can be reconsidered after the UI stabilizes.

## 32. Root scripts

The root exposes:

    pnpm dev
    pnpm test
    pnpm typecheck
    pnpm build

pnpm dev delegates to the Playground and prepares compiled dependencies. Recursive test, typecheck, and build behavior must remain intact.

## 33. Demo milestone

The increment is accepted when a developer can execute the primary path in a browser and observe the valid A/B/C/D dependency DAG, A initially ready, claim/start/complete/review approval through public dispatch, A completed, B/C ready through Core propagation, scheduler limit 2 returning B/C, real Events, rejected Command results, and Reset to the initial fixture.

## 34. Relationship to Increment #6

The Playground leaves room to display Worker, Lease, and execution-progress information later, but implements none. demo-worker can later be replaced by a real Worker integration without rewriting the graph projection, inspector, scheduler panel, or Event Log.

No Worker Registry, Coordinator, adapter, subprocess, heartbeat, or Lease recovery abstraction is introduced.

## 35. Relationship to Desktop

Do not couple the app to Tauri or create packages/ui. Keep GraphCanvas, TaskNode, TaskInspector, SchedulerPanel, EventLog, and CommandResult local to apps/playground. Extract only after a second real consumer exists.

## 36. Architectural invariants

- Control Plane remains the operational authority.
- Core remains lifecycle/readiness authority.
- The TaskGraph snapshot is the only graph source of truth.
- Own canonical graph.tasks keys identify Tasks.
- Dependency edges come only from task.dependencies.
- parentId is never treated as a dependency.
- No direct TaskGraph/Task mutation occurs in the app.
- Private Control Plane and Lease state are inaccessible.
- Scheduling selection never claims, reserves, or executes work.
- Actor is provenance, not authentication.
- demo-worker is not a Worker Registry.
- Unsupported Commands have no controls.
- No networking, persistence, backend, or worker infrastructure exists.
- Protocol, Core, and Control Plane remain unchanged.
- Real package exports are used; stale dist is not relied upon.

## 37. Risks and mitigations

- Package dist is absent in a clean checkout: use explicit predev build preparation and never source aliases.
- Older browsers lack structuredClone: target evergreen browsers without a polyfill.
- Manual layout does not scale: keep it fixture-specific and add generic layout only with proven demand.
- No event subscription exists: synchronous dispatch plus immediate snapshots are sufficient for this local harness.
- Lease IDs are not directly exposed: derive them from public claim Events.

## 38. Evolution criteria

Reconsider initial choices only when concrete evidence exists:

- dynamic/larger graphs or pan/zoom justify React Flow or a layout engine;
- a stable browser regression suite justifies Playwright;
- a second consumer justifies shared UI extraction;
- asynchronous external actors justify event subscriptions;
- real Worker integration replaces demo-worker.

These are future criteria, not v0 commitments.

## 39. Exact out-of-scope list

React Flow, dagre, ELK, Tauri, Desktop, Overlay, always-on-top, tray, Worker Registry, Coordinator, real Workers, Codex/Claude/OpenCode integrations, adapters, subprocesses, REST, HTTP, WebSocket, SSE, persistence, database, heartbeat, Lease expiry/recovery, priority, fairness, scoring, retry, Planner, LLM integration, GraphMutation application, multi-repo, authentication, automatic scheduling, automatic claim, and shared UI packages.

## 40. Preliminary acceptance criteria

- pnpm dev starts the browser Playground from a clean install after build preparation.
- The app imports only public package exports and Protocol contracts.
- The official fixture is accepted by createControlPlane.
- The graph renders A, B, C, D and dependency edges A→B, A→C, B→D, C→D.
- No edge is derived from parentId.
- All nine statuses have explicit accessible presentations.
- Claim uses demo-worker and Actor { type: user, id: playground }.
- Start and Complete use Lease IDs obtained through public Events.
- Approval does not create or require a Lease.
- Approval of A produces Core-driven readiness for B/C.
- Scheduler limit 2 returns B/C without mutation or Lease creation.
- Event Log renders real Control Plane Events.
- Rejected Commands render their result and do not mutate state.
- Unsupported Commands have no buttons.
- Reset creates a fresh Control Plane and restores the fixture.
- Protocol, Core, and Control Plane source trees remain unchanged.
- Existing root tests, typecheck, and build continue to pass.

## 41. Self-review rulings

The design was checked for UI authority, graph duplication, hierarchy/dependency confusion, direct Task mutation, private Lease access, fake Worker Registry, unsupported controls, stale-dist dependence, Node-only assumptions, unnecessary backend, premature layout dependency, unnecessary state library, React Flow, excessive testing infrastructure, Tauri leakage, shared UI prematurity, and scope creep into #6. Each was rejected or addressed by the rules above.

No blocking architectural ambiguity remains. The implementation prerequisite is starting from main synchronized to the merged Increment #5 baseline.
