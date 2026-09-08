import { useMemo, useRef, useState } from "react";
import { CommandResult } from "./components/CommandResult.js";
import { EventLog } from "./components/EventLog.js";
import { GraphCanvas } from "./components/GraphCanvas.js";
import { TaskInspector } from "./components/TaskInspector.js";
import {
  createClaimCommand,
  createCompleteCommand,
  createReviewApproveCommand,
  createStartCommand
} from "./demo/command-factory.js";
import { DEMO_NODE_POSITIONS } from "./demo/fixture.js";
import {
  createDemoRuntime,
  dispatchAndSync,
  getPlaygroundSnapshot
} from "./demo/runtime.js";
import type { DemoRuntime } from "./demo/runtime.js";
import { taskGraphToEdges, taskGraphToNodes } from "./model/graph-projection.js";
import { getLeaseIdForTask } from "./model/lease-projection.js";

const TASK_4_SCHEDULER_LIMIT = 1;

export function App() {
  const runtimeRef = useRef<DemoRuntime | null>(null);
  if (runtimeRef.current === null) {
    runtimeRef.current = createDemoRuntime();
  }

  const [snapshot, setSnapshot] = useState(() =>
    getPlaygroundSnapshot(runtimeRef.current!, TASK_4_SCHEDULER_LIMIT, null)
  );
  const graph = snapshot.graph;
  const nodes = useMemo(() => taskGraphToNodes(graph, DEMO_NODE_POSITIONS), [graph]);
  const edges = useMemo(() => taskGraphToEdges(graph), [graph]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>("A");
  const selectedTask = selectedTaskId ? graph.tasks[selectedTaskId] ?? null : null;

  function dispatchSelectedTaskCommand() {
    if (!selectedTask) {
      return;
    }

    const runtime = runtimeRef.current!;
    const commandId = runtime.nextCommandId();
    const leaseId = getLeaseIdForTask(snapshot.events, selectedTask.id);
    const command = selectedTask.status === "ready"
      ? createClaimCommand(selectedTask.id, commandId)
      : selectedTask.status === "claimed" && leaseId
        ? createStartCommand(selectedTask.id, leaseId, commandId)
        : selectedTask.status === "running" && leaseId
          ? createCompleteCommand(selectedTask.id, leaseId, commandId)
          : selectedTask.status === "review"
            ? createReviewApproveCommand(selectedTask.id, commandId)
            : null;

    if (command) {
      setSnapshot(dispatchAndSync(runtime, command, TASK_4_SCHEDULER_LIMIT).snapshot);
    }
  }

  function reset() {
    const runtime = createDemoRuntime();
    runtimeRef.current = runtime;
    setSelectedTaskId("A");
    setSnapshot(getPlaygroundSnapshot(runtime, TASK_4_SCHEDULER_LIMIT, null));
  }

  const actionLabel = getActionLabel(selectedTask?.status, selectedTask?.id, snapshot.events);

  return (
    <main className="playground-shell">
      <header className="playground-header">
        <p className="eyebrow">Developer graph playground</p>
        <div className="header-row">
          <h1>FlowCTL Playground</h1>
          <button className="reset-button" onClick={reset} type="button">Reset</button>
        </div>
      </header>
      <div className="playground-layout">
        <section className="graph-panel">
          <div className="panel-heading">
            <h2>Execution dependencies</h2>
            <p>Edges represent dependencies only.</p>
          </div>
          <GraphCanvas
            edges={edges}
            nodes={nodes}
            onSelectTask={setSelectedTaskId}
            selectedTaskId={selectedTaskId}
          />
        </section>
        <div className="playground-sidebar">
          <TaskInspector task={selectedTask} />
          <section className="command-controls">
            <h2>Command</h2>
            {actionLabel ? (
              <button onClick={dispatchSelectedTaskCommand} type="button">{actionLabel}</button>
            ) : (
              <p className="empty-state">No lifecycle action available.</p>
            )}
          </section>
          <CommandResult result={snapshot.lastResult} />
        </div>
      </div>
      <EventLog events={snapshot.events} />
    </main>
  );
}

function getActionLabel(
  status: string | undefined,
  taskId: string | undefined,
  events: Parameters<typeof getLeaseIdForTask>[0]
): string | null {
  if (!taskId) {
    return null;
  }

  if (status === "ready") {
    return `Claim ${taskId}`;
  }
  if (status === "claimed" && getLeaseIdForTask(events, taskId)) {
    return `Start ${taskId}`;
  }
  if (status === "running" && getLeaseIdForTask(events, taskId)) {
    return `Complete ${taskId}`;
  }
  if (status === "review") {
    return `Approve Review ${taskId}`;
  }

  return null;
}
