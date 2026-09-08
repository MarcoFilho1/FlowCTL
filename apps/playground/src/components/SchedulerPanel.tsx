export interface SchedulerPanelProps {
  readyTaskIds: readonly string[];
  candidateTaskIds: readonly string[];
  rawLimitInput: string;
  schedulerError: string | null;
  onRawLimitInputChange: (value: string) => void;
}

export function SchedulerPanel({
  readyTaskIds,
  candidateTaskIds,
  rawLimitInput,
  schedulerError,
  onRawLimitInputChange
}: SchedulerPanelProps) {
  return (
    <section aria-label="Scheduler" className="scheduler-panel">
      <div className="scheduler-heading">
        <div>
          <h2>Scheduler</h2>
          <p>Selection only. No tasks are claimed.</p>
        </div>
        <label className="scheduler-limit">
          <span>Limit</span>
          <input
            aria-label="Scheduler limit"
            min="0"
            onChange={(event) => onRawLimitInputChange(event.target.value)}
            step="1"
            type="number"
            value={rawLimitInput}
          />
        </label>
      </div>
      {schedulerError ? <p className="scheduler-error" role="alert">{schedulerError}</p> : null}
      <div className="scheduler-lists">
        <TaskIdList
          accessibleName="Ready tasks"
          heading="READY TASKS"
          taskIds={readyTaskIds}
        />
        <TaskIdList
          accessibleName="Scheduler candidates"
          heading="SCHEDULER CANDIDATES"
          taskIds={candidateTaskIds}
        />
      </div>
    </section>
  );
}

function TaskIdList({
  accessibleName,
  heading,
  taskIds
}: {
  accessibleName: string;
  heading: string;
  taskIds: readonly string[];
}) {
  return (
    <section className="scheduler-list-group">
      <h3 aria-label={accessibleName}>{heading}</h3>
      <ul aria-label={accessibleName} className="scheduler-task-list">
        {taskIds.map((taskId) => <li key={taskId}>{taskId}</li>)}
      </ul>
      {taskIds.length === 0 ? <p className="scheduler-empty">None</p> : null}
    </section>
  );
}
