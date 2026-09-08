import type { FlowctlEvent } from "@flowctl/protocol";

export interface EventLogProps {
  events: readonly FlowctlEvent[];
}

export function EventLog({ events }: EventLogProps) {
  return (
    <section aria-label="Event Log" className="event-log">
      <div className="panel-heading">
        <h2>Event Log</h2>
        <p>Accumulated public Control Plane Events.</p>
      </div>
      {events.length === 0 ? (
        <p className="empty-state">No Events yet.</p>
      ) : (
        <ol className="event-list">
          {events.map((event) => (
            <li className="event-entry" key={event.id}>
              <strong>{event.type}</strong>
              <dl>
                <Field label="Event ID" value={event.id} />
                <Field label="Timestamp" value={event.timestamp} />
                <Field label="Actor" value={`${event.actor.type}:${event.actor.id}`} />
                {getTaskId(event) ? <Field label="Task" value={getTaskId(event)!} /> : null}
                {getWorkerId(event) ? <Field label="Worker" value={getWorkerId(event)!} /> : null}
                {getLeaseId(event) ? <Field label="Lease" value={getLeaseId(event)!} /> : null}
              </dl>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function getTaskId(event: FlowctlEvent): string | undefined {
  if (event.type === "lease.created") {
    return event.payload.lease.taskId;
  }

  return "taskId" in event.payload ? event.payload.taskId : undefined;
}

function getWorkerId(event: FlowctlEvent): string | undefined {
  if (event.type === "lease.created") {
    return event.payload.lease.workerId;
  }

  return "workerId" in event.payload ? event.payload.workerId : undefined;
}

function getLeaseId(event: FlowctlEvent): string | undefined {
  if (event.type === "lease.created") {
    return event.payload.lease.id;
  }

  return "leaseId" in event.payload ? event.payload.leaseId : undefined;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
