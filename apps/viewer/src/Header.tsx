import type { SessionState, Snapshot } from "../../../mod/graph/types.ts";
import { sessionKey } from "./store.ts";

const STATE_LABEL: Record<SessionState, string> = {
  working: "Working",
  waiting_you: "Waiting for you",
  idle: "Idle",
  ended: "Ended"
};

/** The last part of a path: the project's folder name. */
export function folderName(cwd: string): string {
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? "Claude Code";
}

/** One quiet line: where the session runs, how it stands, how far the plan got. */
export function Header({ snapshot }: { snapshot: Snapshot }) {
  const plan = snapshot.nodes.filter((node) => node.kind !== "turn");
  const done = plan.filter((node) => node.status === "done").length;
  const waiting = snapshot.nodes.filter((node) => node.status === "needs_you").length;
  return (
    <header className="header">
      <span className={`state-dot state-${snapshot.sessionState}`} title={STATE_LABEL[snapshot.sessionState]} />
      <span className="folder" title={snapshot.cwd}>
        {folderName(snapshot.cwd)}
      </span>
      {plan.length > 0 && <span className="progress">{`${done}/${plan.length}`}</span>}
      {waiting > 0 && <span className="waiting">{waiting} waiting</span>}
      <span className="visually-hidden">{STATE_LABEL[snapshot.sessionState]}</span>
      {snapshot.warnings.length > 0 && (
        <span className="warnings" title={snapshot.warnings.join("\n")}>
          ⚠ {snapshot.warnings.length}
        </span>
      )}
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
