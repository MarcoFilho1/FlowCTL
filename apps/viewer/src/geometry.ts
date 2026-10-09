// Turns a Snapshot's layout (rank, order) into pixels. Pure, so it is tested
// on the golden snapshots without a browser.
//
// The layout treats subagents as ordinary nodes, so in a rank they can sit
// between tasks. Here an agent whose `parent` is on screen leaves the layout
// and is drawn inside its parent's cluster instead, stacked under it.

import type { GraphNode, Snapshot } from "../../../mod/graph/types.ts";

export type Orientation = "rows" | "columns";

export const CARD_W = 184;
export const CARD_H = 48;
const CHILD_INDENT = 14;
const MIN_CARD_W = 128;
const CHILD_GAP = 6;
const FRAME_PAD = 6;
const SLOT_GAP = 14;
const RANK_GAP = 40;
const MARGIN = 12;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CardBox extends Box {
  id: string;
  node: GraphNode;
  /** Drawn inside a parent's cluster. */
  isChild: boolean;
}

export interface FrameBox extends Box {
  /** The parent node the frame belongs to. */
  id: string;
}

export interface EdgeLine {
  from: string;
  to: string;
  inferred: boolean;
}

export interface Scene {
  orientation: Orientation;
  width: number;
  height: number;
  cards: CardBox[];
  frames: FrameBox[];
  edges: EdgeLine[];
}

interface Cluster {
  node: GraphNode;
  w: number;
  h: number;
  children: Cluster[];
}

export function buildScene(snapshot: Snapshot, orientation: Orientation): Scene {
  const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const childrenOf = new Map<string, GraphNode[]>();
  const nests = (node: GraphNode) =>
    node.kind === "agent" && node.parent !== undefined && node.parent !== node.id && byId.has(node.parent);
  // A child only if its chain of parents ends at a top-level node: agents
  // that name each other as parents would otherwise never be drawn.
  const childFlag = new Map<string, boolean>();
  const isChild = (node: GraphNode): boolean => {
    const known = childFlag.get(node.id);
    if (known !== undefined) return known;
    const chain = new Set<string>();
    let at: GraphNode | undefined = node;
    while (at && nests(at) && !chain.has(at.id)) {
      chain.add(at.id);
      at = byId.get(at.parent as string);
    }
    const anchored = at !== undefined && !chain.has(at.id);
    childFlag.set(node.id, nests(node) && anchored);
    return childFlag.get(node.id) as boolean;
  };

  for (const node of snapshot.nodes) {
    if (isChild(node)) {
      const siblings = childrenOf.get(node.parent as string) ?? [];
      siblings.push(node);
      childrenOf.set(node.parent as string, siblings);
    }
  }
  const order = (node: GraphNode) => snapshot.layout[node.id]?.order ?? 0;
  childrenOf.forEach((siblings) => siblings.sort((a, b) => order(a) - order(b)));

  const visiting = new Set<string>();
  const cluster = (node: GraphNode, width: number): Cluster => {
    visiting.add(node.id);
    const kids = (childrenOf.get(node.id) ?? []).filter((kid) => !visiting.has(kid.id));
    const childWidth = Math.max(MIN_CARD_W, width - CHILD_INDENT);
    const children = kids.map((kid) => cluster(kid, childWidth));
    visiting.delete(node.id);
    if (children.length === 0) {
      return { node, w: width, h: CARD_H, children };
    }
    const inner = Math.max(width, ...children.map((child) => CHILD_INDENT + child.w));
    const h = CARD_H + children.reduce((sum, child) => sum + CHILD_GAP + child.h, 0);
    return { node, w: inner + 2 * FRAME_PAD, h: h + 2 * FRAME_PAD, children };
  };

  // Top-level clusters grouped by rank; ranks left empty by children close up.
  const tops = snapshot.nodes.filter((node) => !isChild(node));
  const rankOf = (node: GraphNode) => snapshot.layout[node.id]?.rank ?? 0;
  const ranks = [...new Set(tops.map(rankOf))].sort((a, b) => a - b);
  const lanes = ranks.map((rank) =>
    tops
      .filter((node) => rankOf(node) === rank)
      .sort((a, b) => order(a) - order(b))
      .map((node) => cluster(node, CARD_W))
  );

  const cards: CardBox[] = [];
  const frames: FrameBox[] = [];
  const place = (c: Cluster, x: number, y: number, child: boolean) => {
    if (c.children.length === 0) {
      cards.push({ id: c.node.id, node: c.node, isChild: child, x, y, w: c.w, h: c.h });
      return;
    }
    frames.push({ id: c.node.id, x, y, w: c.w, h: c.h });
    const cardW = c.w - 2 * FRAME_PAD;
    cards.push({ id: c.node.id, node: c.node, isChild: child, x: x + FRAME_PAD, y: y + FRAME_PAD, w: cardW, h: CARD_H });
    let cy = y + FRAME_PAD + CARD_H;
    for (const kid of c.children) {
      cy += CHILD_GAP;
      place(kid, x + FRAME_PAD + CHILD_INDENT, cy, true);
      cy += kid.h;
    }
  };

  // Along a lane clusters follow each other; across lanes ranks follow each other.
  const along = (c: Cluster) => (orientation === "rows" ? c.w : c.h);
  const across = (c: Cluster) => (orientation === "rows" ? c.h : c.w);
  const laneLength = lanes.map((lane) => lane.reduce((sum, c) => sum + along(c), 0) + SLOT_GAP * Math.max(0, lane.length - 1));
  const laneThickness = lanes.map((lane) => Math.max(0, ...lane.map(across)));
  const longest = Math.max(0, ...laneLength);

  let offset = MARGIN;
  lanes.forEach((lane, i) => {
    let cursor = MARGIN + (longest - (laneLength[i] ?? 0)) / 2;
    for (const c of lane) {
      // Centered across the lane, so a lone node lines up with its neighbors.
      const shift = ((laneThickness[i] ?? 0) - across(c)) / 2;
      if (orientation === "rows") place(c, cursor, offset + shift, false);
      else place(c, offset + shift, cursor, false);
      cursor += along(c) + SLOT_GAP;
    }
    offset += (laneThickness[i] ?? 0) + RANK_GAP;
  });

  const depth = offset - RANK_GAP + MARGIN;
  const breadth = longest + 2 * MARGIN;
  const width = Math.max(orientation === "rows" ? breadth : depth, 2 * MARGIN);
  const height = Math.max(orientation === "rows" ? depth : breadth, 2 * MARGIN);

  const edges: EdgeLine[] = [];
  for (const node of snapshot.nodes) {
    for (const from of new Set(node.blockedBy)) {
      if (byId.has(from) && from !== node.id) {
        edges.push({ from, to: node.id, inferred: node.inferred === true });
      }
    }
  }

  return { orientation, width, height, cards, frames, edges };
}

/** How much a scene must shrink to fit: 1 when it already fits. */
export function fitScale(scene: Pick<Scene, "width" | "height">, viewport: { width: number; height: number }): number {
  return Math.min(1, viewport.width / scene.width, viewport.height / scene.height);
}

/**
 * The orientation that shows the graph larger. Sticky: it only changes when
 * the other one is clearly better, so a growing graph does not flip back and
 * forth between snapshots.
 */
export function chooseOrientation(
  snapshot: Snapshot,
  viewport: { width: number; height: number },
  current?: Orientation
): Orientation {
  const rows = fitScale(buildScene(snapshot, "rows"), viewport);
  const columns = fitScale(buildScene(snapshot, "columns"), viewport);
  const STICKINESS = 1.2;
  if (current === "rows") return columns > rows * STICKINESS ? "columns" : "rows";
  if (current === "columns") return rows > columns * STICKINESS ? "rows" : "columns";
  return columns > rows ? "columns" : "rows";
}

/** Where an edge leaves its source and enters its target. */
export function edgePath(from: Box, to: Box, orientation: Orientation): string {
  if (orientation === "rows") {
    const x1 = from.x + from.w / 2;
    const y1 = from.y + from.h;
    const x2 = to.x + to.w / 2;
    const y2 = to.y;
    const bend = Math.max(18, Math.abs(y2 - y1) / 2);
    return `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}`;
  }
  const x1 = from.x + from.w;
  const y1 = from.y + from.h / 2;
  const x2 = to.x;
  const y2 = to.y + to.h / 2;
  const bend = Math.max(18, Math.abs(x2 - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
}
