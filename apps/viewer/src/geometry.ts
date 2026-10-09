// Turns a Snapshot's layout (rank, order) into a node-only drawing that flows
// left to right: each rank a column, each node a circle, no labels (the hover
// card names it). Pure, so it is tested on the golden snapshots.
//
// The layout treats subagents as ordinary nodes, so in a rank they can sit
// between tasks. Here an agent whose `parent` is on screen leaves the layout
// and becomes a satellite: a smaller circle tucked under its parent.

import type { GraphNode, Snapshot } from "../../../mod/graph/types.ts";

export const NODE_R = 9;
export const SATELLITE_R = 5;
const COLUMN_GAP = 68;
const ROW_GAP = 36;
const SATELLITE_DX = 12;
const SATELLITE_STEP = 15;
const MARGIN = 28;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface NodeShape {
  id: string;
  node: GraphNode;
  cx: number;
  cy: number;
  r: number;
  /** Drawn under its parent, not in a column of its own. */
  isSatellite: boolean;
}

export interface Link {
  from: string;
  to: string;
  /**
   * A dependency (arrow, `blockedBy`), a sequence between two requests of the
   * session (dashed arrow, `after`), or a subagent hanging off its task.
   */
  kind: "dependency" | "sequence" | "agent";
  inferred: boolean;
}

export interface Scene {
  width: number;
  height: number;
  nodes: NodeShape[];
  links: Link[];
}

/** The circle's bounding box: the unit the tween moves and overlap is tested on. */
export function circleBox(shape: Pick<NodeShape, "cx" | "cy" | "r">): Box {
  return { x: shape.cx - shape.r, y: shape.cy - shape.r, w: 2 * shape.r, h: 2 * shape.r };
}

interface Slot {
  node: GraphNode;
  satellites: GraphNode[];
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
    if (anchor === undefined) tops.push(node);
    else satellitesOf.set(anchor.id, [...(satellitesOf.get(anchor.id) ?? []), node]);
  }

  const slotOf = (node: GraphNode): Slot => {
    const satellites = (satellitesOf.get(node.id) ?? []).sort((a, b) => order(a) - order(b));
    return { node, satellites, height: 2 * NODE_R + satellites.length * SATELLITE_STEP };
  };
  const ranks = [...new Set(tops.map(rankOf))].sort((a, b) => a - b);
  const columns = ranks.map((rank) =>
    tops
      .filter((node) => rankOf(node) === rank)
      .sort((a, b) => order(a) - order(b))
      .map(slotOf)
  );
  const columnHeight = columns.map(
    (column) => column.reduce((sum, slot) => sum + slot.height, 0) + (ROW_GAP - 2 * NODE_R) * Math.max(0, column.length - 1)
  );
  const tallest = Math.max(0, ...columnHeight);

  const shapes: NodeShape[] = [];
  columns.forEach((column, i) => {
    const cx = MARGIN + NODE_R + i * COLUMN_GAP;
    // Each column is centered on the tallest, so a lone node lines up with its neighbors.
    let y = MARGIN + (tallest - (columnHeight[i] ?? 0)) / 2;
    for (const slot of column) {
      const cy = y + NODE_R;
      shapes.push({ id: slot.node.id, node: slot.node, cx, cy, r: NODE_R, isSatellite: false });
      slot.satellites.forEach((satellite, k) => {
        shapes.push({
          id: satellite.id,
          node: satellite,
          cx: cx + SATELLITE_DX,
          cy: cy + NODE_R + (k + 1) * SATELLITE_STEP - SATELLITE_R,
          r: SATELLITE_R,
          isSatellite: true
        });
      });
      y += slot.height + ROW_GAP - 2 * NODE_R;
    }
  });

  const links: Link[] = [];
  for (const node of snapshot.nodes) {
    for (const from of new Set(node.blockedBy)) {
      if (byId.has(from) && from !== node.id) {
        links.push({ from, to: node.id, kind: "dependency", inferred: node.inferred === true });
      }
    }
  }
  for (const node of snapshot.nodes) {
    for (const from of new Set(node.after ?? [])) {
      if (byId.has(from) && from !== node.id && !node.blockedBy.includes(from)) {
        links.push({ from, to: node.id, kind: "sequence", inferred: true });
      }
    }
  }
  for (const shape of shapes) {
    if (shape.isSatellite && shape.node.parent !== undefined) {
      links.push({ from: shape.node.parent, to: shape.id, kind: "agent", inferred: false });
    }
  }

  const width = columns.length === 0 ? 2 * MARGIN : MARGIN * 2 + 2 * NODE_R + (columns.length - 1) * COLUMN_GAP + SATELLITE_DX;
  return { width, height: Math.max(tallest, 0) + 2 * MARGIN, nodes: shapes, links };
}

/**
 * A dependency leaves its source on the right and enters its target on the
 * left; a subagent's link drops from its task and turns into it.
 */
export function linkPath(from: Box, to: Box, kind: "dependency" | "agent"): string {
  const fy = from.y + from.h / 2;
  const ty = to.y + to.h / 2;
  if (kind === "agent") {
    const x1 = from.x + from.w / 2;
    return `M ${x1} ${from.y + from.h} L ${x1} ${ty} L ${to.x} ${ty}`;
  }
  const x1 = from.x + from.w;
  const x2 = to.x;
  const bend = Math.max(14, Math.abs(x2 - x1) / 2);
  return `M ${x1} ${fy} C ${x1 + bend} ${fy}, ${x2 - bend} ${ty}, ${x2} ${ty}`;
}

/** The node the eye should be on: one that needs the person, else one failing, else the latest running. */
export function focusNode(scene: Scene): NodeShape | undefined {
  const by = (status: GraphNode["status"]) => scene.nodes.filter((shape) => shape.node.status === status);
  return by("needs_you")[0] ?? by("error")[0] ?? by("running").at(-1) ?? scene.nodes.at(-1);
}

/**
 * Keeps at least `keep` px of the scene inside the viewport whichever way it
 * is dragged; a scene smaller than the viewport stays wholly inside it.
 */
export function clampPan(
  pan: { x: number; y: number },
  scene: Pick<Scene, "width" | "height">,
  viewport: { width: number; height: number },
  keep = 48
): { x: number; y: number } {
  const axis = (value: number, size: number, room: number) => {
    if (size <= room) return Math.min(Math.max(value, 0), room - size);
    return Math.min(Math.max(value, keep - size), room - keep);
  };
  return { x: axis(pan.x, scene.width, viewport.width), y: axis(pan.y, scene.height, viewport.height) };
}

/** The pan that puts `shape` in the middle of the viewport. */
export function centerOn(shape: Pick<NodeShape, "cx" | "cy">, viewport: { width: number; height: number }): { x: number; y: number } {
  return { x: viewport.width / 2 - shape.cx, y: viewport.height / 2 - shape.cy };
}

/** Where the view looks and how close: screen = scene × s + (x, y). */
export interface Camera {
  x: number;
  y: number;
  s: number;
}

/** The nodes the work is on now: those that need the person, else everything running. */
export function currentNodes(scene: Scene): NodeShape[] {
  const waiting = scene.nodes.filter((shape) => shape.node.status === "needs_you");
  if (waiting.length > 0) return waiting;
  return scene.nodes.filter((shape) => shape.node.status === "running" && !shape.isSatellite);
}

const MIN_OVERVIEW_SCALE = 0.5;
const OVERVIEW_PAD = 14;
/** Room kept around the followed nodes. */
const FOLLOW_PAD = 28;

/**
 * The camera for a session. While it works it follows the current nodes at
 * full size (their middle, so parallel steps stay in view together); when it
 * rests it pulls back to show the whole graph, down to half size, in steps
 * of a quarter for the pixel look so art pixels stay whole.
 */
export function cameraFor(
  scene: Scene,
  viewport: { width: number; height: number },
  mode: "follow" | "overview",
  pixel: boolean
): Camera {
  if (mode === "overview") {
    let s = Math.min(1, (viewport.width - 2 * OVERVIEW_PAD) / scene.width, (viewport.height - 2 * OVERVIEW_PAD) / scene.height);
    if (pixel) s = Math.floor(s * 4) / 4;
    s = Math.max(MIN_OVERVIEW_SCALE, s);
    const sized = { width: scene.width * s, height: scene.height * s };
    return { ...clampPan({ x: (viewport.width - sized.width) / 2, y: (viewport.height - sized.height) / 2 }, sized, viewport), s };
  }
  const current = currentNodes(scene);
  // Between steps (one just finished, the next not marked yet) aim at the
  // steps that are now free to start, rather than at the end of the graph.
  const status = new Map(scene.nodes.map((shape) => [shape.id, shape.node.status]));
  const ready = scene.nodes.filter(
    (shape) => !shape.isSatellite && shape.node.status === "pending" && shape.node.blockedBy.every((id) => status.get(id) === "done")
  );
  const target = current.length > 0 ? current : ready.length > 0 ? ready.slice(0, 1) : scene.nodes.slice(-1);
  if (target.length === 0) return { x: 0, y: 0, s: 1 };
  // Frame the current nodes: centered on them, zoomed out only as far as
  // needed to fit them all (parallel steps), never in past full size. No
  // clamping here: the node in the middle matters more than the graph's edge.
  const left = Math.min(...target.map((shape) => shape.cx - shape.r)) - FOLLOW_PAD;
  const right = Math.max(...target.map((shape) => shape.cx + shape.r)) + FOLLOW_PAD;
  const top = Math.min(...target.map((shape) => shape.cy - shape.r)) - FOLLOW_PAD;
  const bottom = Math.max(...target.map((shape) => shape.cy + shape.r)) + FOLLOW_PAD;
  let s = Math.min(1, viewport.width / (right - left), viewport.height / (bottom - top));
  if (pixel) s = Math.floor(s * 4) / 4;
  s = Math.max(MIN_OVERVIEW_SCALE, s);
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  return { x: viewport.width / 2 - cx * s, y: viewport.height / 2 - cy * s, s };
}
