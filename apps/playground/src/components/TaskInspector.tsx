import type { Task } from "@flowctl/protocol";
import { statusToPresentation } from "../model/status-presentation.js";

export interface TaskInspectorProps {
  task: Task | null;
}

export function TaskInspector({ task }: TaskInspectorProps) {
  if (!task) {
    return (
      <aside aria-label="Task inspector" className="task-inspector">
        <h2>Task inspector</h2>
        <p>Select a task to inspect its public fields.</p>
      </aside>
    );
  }

  const status = statusToPresentation(task.status);

  return (
    <aside aria-label="Task inspector" className="task-inspector">
      <h2>Task inspector</h2>
      <dl>
        <Field label="Task ID" value={task.id} />
        <Field label="Title" value={task.title} />
        <Field label="Level" value={task.level} />
        <Field label="Status" value={`${status.symbol} ${status.label}`} />
        <Field label="Parent ID" value={task.parentId ?? "None"} />
        <Field label="Dependencies" value={task.dependencies.join(", ") || "None"} />
        <Field label="Acceptance criteria" value={task.acceptanceCriteria.join(", ") || "None"} />
        {task.assignedWorkerId ? <Field label="Assigned worker ID" value={task.assignedWorkerId} /> : null}
      </dl>
    </aside>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
