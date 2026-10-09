import type { NodeStatus, SessionState, Snapshot } from "../../../mod/graph/types.ts";
import { STATUS_LABEL } from "./GraphView.tsx";
import { sessionKey } from "./store.ts";

const STATE_LABEL: Record<SessionState, string> = {
  working: "Working",
  waiting_you: "Waiting for you",
  idle: "Idle",
  ended: "Ended"
};

const COUNTED: readonly NodeStatus[] = ["needs_you", "error", "running", "pending", "done"];

/** The last part of a path: the project's folder name. */
export function folderName(cwd: string): string {
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? "Claude Code";
}

export function Header({ snapshot }: { snapshot: Snapshot }) {
  const counts = new Map<NodeStatus, number>();
  snapshot.nodes.forEach((node) => counts.set(node.status, (counts.get(node.status) ?? 0) + 1));
  return (
    <header className="header">
      <div className="header-row">
        <span className="folder" title={snapshot.cwd}>
          {folderName(snapshot.cwd)}
        </span>
        <span className={`state state-${snapshot.sessionState}`}>{STATE_LABEL[snapshot.sessionState]}</span>
      </div>
      <ul className="counters" aria-label="Nodes by status">
        {COUNTED.filter((status) => counts.has(status)).map((status) => (
          <li key={status} className={`counter status-${status}`} title={STATUS_LABEL[status]}>
            <span className="dot" aria-hidden="true" />
            <span className="count">{counts.get(status)}</span>
            <span className="visually-hidden">{STATUS_LABEL[status]}</span>
          </li>
        ))}
        {snapshot.warnings.length > 0 && (
          <li className="counter warnings" title={snapshot.warnings.join("\n")}>
            ⚠ {snapshot.warnings.length}
          </li>
        )}
      </ul>
    </header>
  );
}

export function Tabs({
  sessions,
  active,
  onSelect
}: {
  sessions: readonly Snapshot[];
  active: string | null;
  onSelect: (key: string) => void;
}) {
  if (sessions.length < 2) return null;
  const folders = sessions.map((session) => (session.cwd ? folderName(session.cwd) : ""));
  const label = (session: Snapshot, i: number) => {
    const folder = folders[i] ?? "";
    const key = sessionKey(session);
    if (!folder) return key;
    // Two sessions in the same folder are told apart by their id.
    return folders.filter((other) => other === folder).length > 1 ? `${folder} · ${key.slice(0, 8)}` : folder;
  };
  return (
    <nav className="tabs" role="tablist" aria-label="Sessions">
      {sessions.map((session, i) => {
        const key = sessionKey(session);
        const waiting = session.sessionState === "waiting_you";
        return (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={key === active}
            className={`tab${waiting ? " waiting" : ""}`}
            title={session.cwd || key}
            onClick={() => onSelect(key)}
          >
            {label(session, i)}
          </button>
        );
      })}
    </nav>
  );
}
