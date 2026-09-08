import { TaskNode } from "./TaskNode.js";
import type { VisualEdge, VisualNode } from "../model/graph-projection.js";

export interface GraphCanvasProps {
  nodes: readonly VisualNode[];
  edges: readonly VisualEdge[];
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
}

const NODE_WIDTH = 200;
const NODE_HEIGHT = 112;

export function GraphCanvas({ nodes, edges, selectedTaskId, onSelectTask }: GraphCanvasProps) {
  const nodesById = new Map(nodes.map((node) => [node.taskId, node]));

  return (
    <section aria-label="Dependency graph" className="graph-canvas">
      <svg aria-label="Task dependency edges" className="graph-edges" viewBox="0 0 920 540">
        <defs>
          <marker id="edge-arrow" markerHeight="8" markerWidth="8" orient="auto" refX="7" refY="4">
            <path d="M 0 0 L 8 4 L 0 8 z" />
          </marker>
        </defs>
        {edges.map((edge) => {
          const from = nodesById.get(edge.fromTaskId);
          const to = nodesById.get(edge.toTaskId);

          if (!from || !to) return null;

          return (
            <line
              aria-label={`Dependency ${edge.fromTaskId} → ${edge.toTaskId}`}
              key={`${edge.fromTaskId}-${edge.toTaskId}`}
              markerEnd="url(#edge-arrow)"
              x1={from.position.x + NODE_WIDTH / 2}
              x2={to.position.x + NODE_WIDTH / 2}
              y1={from.position.y + NODE_HEIGHT}
              y2={to.position.y}
            />
          );
        })}
      </svg>
      <div className="graph-nodes">
        {nodes.map((node) => (
          <TaskNode
            key={node.taskId}
            node={node}
            onSelectTask={onSelectTask}
            selected={node.taskId === selectedTaskId}
          />
        ))}
      </div>
    </section>
  );
}
