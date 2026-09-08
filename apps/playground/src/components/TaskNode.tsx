import { statusToPresentation } from "../model/status-presentation.js";
import type { VisualNode } from "../model/graph-projection.js";

export interface TaskNodeProps {
  node: VisualNode;
  selected: boolean;
  onSelectTask: (taskId: string) => void;
}

export function TaskNode({ node, selected, onSelectTask }: TaskNodeProps) {
  const status = statusToPresentation(node.status);

  return (
    <button
      aria-label={`Task ${node.taskId}: ${node.title}`}
      aria-pressed={selected}
      className={`task-node ${status.className}`}
      onClick={() => onSelectTask(node.taskId)}
      style={{ left: node.position.x, top: node.position.y }}
      type="button"
    >
      <span className="task-node-id">{node.taskId}</span>
      <span className="task-node-title">{node.title}</span>
      <span className="task-node-status">
        <span aria-hidden="true">{status.symbol}</span> {status.label}
      </span>
      <span className="task-node-dependencies">{node.dependencyCount} dependencies</span>
    </button>
  );
}
