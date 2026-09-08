import { useMemo, useState } from "react";
import { GraphCanvas } from "./components/GraphCanvas.js";
import { TaskInspector } from "./components/TaskInspector.js";
import { createDemoTaskGraph, DEMO_NODE_POSITIONS } from "./demo/fixture.js";
import { taskGraphToEdges, taskGraphToNodes } from "./model/graph-projection.js";

export function App() {
  const graph = useMemo(createDemoTaskGraph, []);
  const nodes = useMemo(() => taskGraphToNodes(graph, DEMO_NODE_POSITIONS), [graph]);
  const edges = useMemo(() => taskGraphToEdges(graph), [graph]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>("A");
  const selectedTask = selectedTaskId ? graph.tasks[selectedTaskId] ?? null : null;

  return (
    <main className="playground-shell">
      <header className="playground-header">
        <p className="eyebrow">Developer graph playground</p>
        <h1>FlowCTL Playground</h1>
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
        <TaskInspector task={selectedTask} />
      </div>
      <section aria-label="Reserved panels" className="reserved-panels">
        <p>Command controls and runtime events will appear here in later tasks.</p>
      </section>
    </main>
  );
}
