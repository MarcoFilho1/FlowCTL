// Turns a Snapshot's layout (rank, order) into a node-link drawing: each node
// a circle with a short label beside it, ranks from top to bottom. Pure, so
// it is tested on the golden snapshots without a browser.
//
// The layout treats subagents as ordinary nodes, so in a rank they can sit
// between tasks. Here an agent whose `parent` is on screen leaves the layout
// and becomes a satellite: a smaller circle stacked under its parent.

import type { GraphNode, Snapshot } from "../../../mod/graph/types.ts";

export const NODE_R = 8;
export const SATELLITE_R = 5;
const LABEL_GAP = 6;
const LABEL_CHARS = 22;
const LABEL_CHAR_W = 6.4;
const SATELLITE_LABEL_CHAR_W = 5.6;
const SATELLITE_INDENT = 14;
const SATELLITE_STEP = 18;
const SLOT_GAP = 18;
const RANK_GAP = 34;
const MARGIN = 10;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface NodeShape {
  id: string;
  node: GraphNode;
  /** The circle. */
  cx: number;
  cy: number;
  r: number;
  /** The short label drawn right of the circle, and its estimated width. */
  label: string;
  labelWidth: number;
  /** Drawn under its parent, not in a rank of its own. */
  isSatellite: boolean;
  /** How far below the circle its dependencies leave: past its satellites. */
  tail: number;
}

export interface Link {
  from: string;
  to: string;
  /** A dependency (arrow, `blockedBy`) or a subagent hanging off its task. */
  kind: "dependency" | "agent";
  inferred: boolean;
}

export interface Scene {
  width: number;
  height: number;
  nodes: NodeShape[];
  links: Link[];
}

/** A label short enough to sit beside a node; the hover card has the rest. */
export function shortLabel(title: string, max = LABEL_CHARS): string {
  const chars = Array.from(title.trim());
  return chars.length <= max ? chars.join("") : `${chars.slice(0, max - 1).join("")}…`;
}

/** The circle's bounding box, the unit the tween moves. */
export function circleBox(shape: Pick<NodeShape, "cx" | "cy" | "r">): Box {
  return { x: shape.cx - shape.r, y: shape.cy - shape.r, w: 2 * shape.r, h: 2 * shape.r };
}

/** Circle and label together: what must not overlap another node. */
export function footprint(shape: NodeShape): Box {
  return {
    x: shape.cx - shape.r,
    y: shape.cy - Math.max(shape.r, 7),
    w: 2 * shape.r + LABEL_GAP + shape.labelWidth,
    h: 2 * Math.max(shape.r, 7)
  };
}

interface Slot {
  node: GraphNode;
  satellites: GraphNode[];
  width: number;
  height: number;
}

export function buildScene(snapshot: Snapshot): Scene {
  const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const order = (node: GraphNode) => snapshot.layout[node.id]?.order ?? 0;
  const rankOf = (node: GraphNode) => snapshot.layout[node.id]?.rank ?? 0;

  // A satellite hangs off a top-level node: an agent whose parent is an agent
  // hangs off that agent's own top-level ancestor, and agents that name each
  // other as parents stay top-level, so every node is drawn.
  const anchorOf = (node: GraphNode): GraphNode | undefined => {
    const seen = new Set<string>([node.id]);
    let at: GraphNode | undefined = node;
    while (at?.kind === "agent" && at.parent !== undefined && byId.has(at.parent)) {
      if (seen.has(at.parent)) return undefined;
      seen.add(at.parent);
      at = byId.get(at.parent);
    }
    return at === node ? undefined : at;
  };
  const satellitesOf = new Map<string, GraphNode[]>();
  const tops: GraphNode[] = [];
  for (const node of snapshot.nodes) {
    const anchor = anchorOf(node);
    if (anchor === undefined) {
      tops.push(node);
    } else {
      satellitesOf.set(anchor.id, [...(satellitesOf.get(anchor.id) ?? []), node]);
    }
  }

  const labelWidth = (node: GraphNode, satellite: boolean) =>
    Array.from(shortLabel(node.title)).length * (satellite ? SATELLITE_LABEL_CHAR_W : LABEL_CHAR_W);
  const slotOf = (node: GraphNode): Slot => {
    const satellites = (satellitesOf.get(node.id) ?? []).sort((a, b) => order(a) - order(b));
    const own = 2 * NODE_R + LABEL_GAP + labelWidth(node, false);
    const hanging = satellites.map((s) => SATELLITE_INDENT + 2 * SATELLITE_R + LABEL_GAP + labelWidth(s, true));
    return {
      node,
      satellites,
      width: Math.max(own, ...hanging),
      height: 2 * NODE_R + satellites.length * SATELLITE_STEP
    };
  };

  const ranks = [...new Set(tops.map(rankOf))].sort((a, b) => a - b);
  const rows = ranks.map((rank) =>
    tops
      .filter((node) => rankOf(node) === rank)
      .sort((a, b) => order(a) - order(b))
      .map(slotOf)
  );
  const rowWidth = rows.map((row) => row.reduce((sum, slot) => sum + slot.width, 0) + SLOT_GAP * Math.max(0, row.length - 1));
  const widest = Math.max(0, ...rowWidth);

  const shapes: NodeShape[] = [];
  let y = MARGIN;
  rows.forEach((row, i) => {
    let x = MARGIN + (widest - (rowWidth[i] ?? 0)) / 2;
    for (const slot of row) {
      const cx = x + NODE_R;
      const cy = y + NODE_R;
      shapes.push({
        id: slot.node.id,
        node: slot.node,
        cx,
        cy,
        r: NODE_R,
        label: shortLabel(slot.node.title),
        labelWidth: labelWidth(slot.node, false),
        isSatellite: false,
        tail: slot.satellites.length * SATELLITE_STEP
      });
      slot.satellites.forEach((satellite, k) => {
        shapes.push({
          id: satellite.id,
          node: satellite,
          cx: cx + SATELLITE_INDENT,
          cy: cy + (k + 1) * SATELLITE_STEP,
          r: SATELLITE_R,
          label: shortLabel(satellite.title),
          labelWidth: labelWidth(satellite, true),
          isSatellite: true,
          tail: 0
        });
      });
      x += slot.width + SLOT_GAP;
    }
    y += Math.max(0, ...row.map((slot) => slot.height)) + RANK_GAP;
  });

  const links: Link[] = [];
  for (const node of snapshot.nodes) {
    for (const from of new Set(node.blockedBy)) {
      if (byId.has(from) && from !== node.id) {
        links.push({ from, to: node.id, kind: "dependency", inferred: node.inferred === true });
      }
    }
  }
  for (const shape of shapes) {
    const parent = shape.node.parent;
    if (shape.isSatellite && parent !== undefined) {
      links.push({ from: parent, to: shape.id, kind: "agent", inferred: false });
    }
  }

  return {
    width: Math.max(widest + 2 * MARGIN, 2 * MARGIN),
    height: rows.length === 0 ? 2 * MARGIN : y - RANK_GAP + MARGIN,
    nodes: shapes,
    links
  };
}

/** How much a scene must shrink to fit: 1 when it already fits. */
export function fitScale(scene: Pick<Scene, "width" | "height">, viewport: { width: number; height: number }): number {
  return Math.min(1, viewport.width / scene.width, viewport.height / scene.height);
}

/**
 * A dependency runs from below its source (past its satellites, `tail`) to
 * the top of its target; a subagent's link drops from its task's circle and
 * turns into its own.
 */
export function linkPath(from: Box, to: Box, kind: Link["kind"], tail = 0): string {
  const x1 = from.x + from.w / 2;
  const x2 = to.x + to.w / 2;
  if (kind === "agent") {
    const y1 = from.y + from.h;
    const y2 = to.y + to.h / 2;
    return `M ${x1} ${y1} L ${x1} ${y2} L ${to.x} ${y2}`;
  }
  const y1 = from.y + from.h + tail;
  const y2 = to.y;
  const bend = Math.max(12, Math.abs(y2 - y1) / 2);
  return `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}`;
}
