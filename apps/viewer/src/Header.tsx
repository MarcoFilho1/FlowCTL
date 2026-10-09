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
export function Header({ snapshot, showWarnings = false }: { snapshot: Snapshot; showWarnings?: boolean }) {
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
      {/* Graph warnings are diagnostics for development, not for the overlay. */}
      {showWarnings && snapshot.warnings.length > 0 && (
        <span className="warnings" title={snapshot.warnings.join("\n")}>
          ⚠ {snapshot.warnings.length}
        </span>
      )}
    </header>
  );
}

/**
 * Moves between sessions: ‹ 2/3 ›. A dot marks another session that needs
 * the person. Shown only with more than one session.
 */
export function Pager({
  sessions,
  active,
  onSelect
}: {
  sessions: readonly Snapshot[];
  active: string | null;
  onSelect: (key: string) => void;
}) {
  if (sessions.length < 2) return null;
  const keys = sessions.map(sessionKey);
  const at = Math.max(0, keys.indexOf(active ?? ""));
  const go = (step: number) => onSelect(keys[(at + step + keys.length) % keys.length] as string);
  const othersWaiting = sessions.some((session, i) => i !== at && session.sessionState === "waiting_you");
  const name = (i: number) => folderName(sessions[i]?.cwd ?? "") || keys[i];
  return (
    <nav className="pager" aria-label="Sessions">
      <button type="button" className="pager-step" aria-label={`Previous session: ${name((at - 1 + keys.length) % keys.length)}`} onClick={() => go(-1)}>
        ‹
      </button>
      <span className="pager-count" aria-live="polite">
        {at + 1}/{keys.length}
      </span>
      <button type="button" className="pager-step" aria-label={`Next session: ${name((at + 1) % keys.length)}`} onClick={() => go(1)}>
        ›
      </button>
      {othersWaiting && <span className="pager-waiting" title="Another session needs you" aria-label="Another session needs you" />}
    </nav>
  );
}
