// Builds the Snapshot every surface draws: the reducer's nodes, placed by
// the layout, with the session around them.

import { layout } from "./layout.ts";
import { nodes, sessionState, type GraphState } from "./reduce.ts";
import { SNAPSHOT_SCHEMA, type Layout, type Snapshot, type TerminalInfo } from "./types.ts";

export interface SnapshotMeta {
  seq: number;
  now: number;
  /** The previous snapshot's layout, so nodes keep their places. */
  previous?: Layout;
  terminal?: TerminalInfo;
}

export function snapshot(state: GraphState, meta: SnapshotMeta): Snapshot {
  const shown = nodes(state);
  const placed = layout(shown, meta.previous);
  const warnings = [
    ...state.warnings,
    ...placed.brokenEdges.map(([from, to]) => `dependency cycle: ignored ${from} → ${to}`)
  ];
  return {
    schema: SNAPSHOT_SCHEMA,
    seq: meta.seq,
    sessionId: state.sessionId ?? "",
    cwd: state.cwd ?? "",
    updatedAt: meta.now,
    sessionState: sessionState(state),
    ...(meta.terminal !== undefined ? { terminal: meta.terminal } : {}),
    planSource: state.planSource,
    nodes: shown,
    layout: placed.layout,
    warnings
  };
}
