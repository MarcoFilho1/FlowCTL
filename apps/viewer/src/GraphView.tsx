import { useEffect, useMemo, useRef, useState } from "react";
import type { GraphNode, NodeStatus, Snapshot } from "../../../mod/graph/types.ts";
import {
  buildScene,
  chooseOrientation,
  edgePath,
  fitScale,
  type Box,
  type CardBox,
  type Orientation
} from "./geometry.ts";
import { useTween } from "./useTween.ts";

/** Above this many nodes the graph scrolls instead of shrinking to fit. */
export const SCROLL_THRESHOLD = 30;
const MIN_SCROLL_SCALE = 0.6;
const FALLBACK_VIEWPORT = { width: 360, height: 420 };

export const STATUS_LABEL: Record<NodeStatus, string> = {
  pending: "Pending",
  running: "Running",
  needs_you: "Needs you",
  error: "Error",
  done: "Done"
};

const STATUS_GLYPH: Record<NodeStatus, string> = {
  pending: "○",
  running: "◐",
  needs_you: "!",
  error: "×",
  done: "✓"
};

const KIND_LABEL: Record<GraphNode["kind"], string> = { task: "Task", agent: "Agent", turn: "Turn" };

function useViewport(): [React.RefObject<HTMLDivElement | null>, { width: number; height: number }] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState(FALLBACK_VIEWPORT);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(([entry]) => {
      const box = entry?.contentRect;
      if (box && box.width > 0 && box.height > 0) setSize({ width: box.width, height: box.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, size];
}

export function GraphView({ snapshot }: { snapshot: Snapshot }) {
  const [ref, viewport] = useViewport();
  const orientationRef = useRef<Orientation | undefined>(undefined);
  const orientation = useMemo(
    () => (orientationRef.current = chooseOrientation(snapshot, viewport, orientationRef.current)),
    [snapshot, viewport]
  );
  const scene = useMemo(() => buildScene(snapshot, orientation), [snapshot, orientation]);

  const targets = useMemo(() => {
    const boxes = new Map<string, Box>();
    scene.frames.forEach((frame) => boxes.set(`frame:${frame.id}`, frame));
    scene.cards.forEach((card) => boxes.set(card.id, card));
    return boxes;
  }, [scene]);
  const boxes = useTween(targets);

  if (snapshot.nodes.length === 0) {
    return (
      <div className="graph">
        <p className="empty">Nothing to show yet: the graph starts with the session's first turn.</p>
      </div>
    );
  }

  const scrolls = snapshot.nodes.length > SCROLL_THRESHOLD;
  const scale = scrolls
    ? Math.max(MIN_SCROLL_SCALE, Math.min(1, viewport.width / scene.width))
    : fitScale(scene, viewport);

  return (
    // The measured box is absolutely placed, so the drawing never changes its size.
    <div className="graph">
      <div ref={ref} className={`canvas ${scrolls ? "scrolls" : "fits"}`} data-orientation={orientation}>
      <svg
        role="img"
        aria-label={`Task graph, ${snapshot.nodes.length} nodes`}
        width={scene.width * scale}
        height={scene.height * scale}
        viewBox={`0 0 ${scene.width} ${scene.height}`}
      >
        <defs>
          <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 8 4 L 0 8 z" className="arrow-head" />
          </marker>
        </defs>
        {scene.frames.map((frame) => {
          const box = boxes.get(`frame:${frame.id}`) ?? frame;
          return <rect key={frame.id} className="cluster" data-cluster={frame.id} x={box.x} y={box.y} width={box.w} height={box.h} rx={12} />;
        })}
        {scene.edges.map((edge) => {
          const from = boxes.get(edge.from);
          const to = boxes.get(edge.to);
          if (!from || !to) return null;
          return (
            <path
              key={`${edge.from}->${edge.to}`}
              className={`edge${edge.inferred ? " inferred" : ""}`}
              data-edge={`${edge.from}->${edge.to}`}
              d={edgePath(from, to, orientation)}
              markerEnd="url(#arrow)"
            />
          );
        })}
        {scene.cards.map((card) => (
          <Card key={card.id} card={card} box={boxes.get(card.id) ?? card} />
        ))}
      </svg>
      </div>
    </div>
  );
}

function subtitle(node: GraphNode): string {
  if (node.attention) {
    const what = node.attention.kind === "permission" ? "Permission" : node.attention.kind === "question" ? "Question" : "Error";
    return node.attention.detail ? `${what}: ${node.attention.detail}` : what;
  }
  if (node.status === "running" && node.activeForm) return node.activeForm;
  return `${KIND_LABEL[node.kind]} · ${STATUS_LABEL[node.status]}`;
}

/** Cuts text to roughly fit `width` pixels at the card's font size. */
export function truncate(text: string, width: number, charWidth = 6.8): string {
  const max = Math.max(4, Math.floor(width / charWidth));
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join("")}…`;
}

function Card({ card, box }: { card: CardBox; box: Box }) {
  const { node } = card;
  const textWidth = box.w - 38;
  const sub = subtitle(node);
  return (
    <g
      className={`card status-${node.status} kind-${node.kind}${card.isChild ? " child" : ""}`}
      data-node={node.id}
      transform={`translate(${box.x} ${box.y})`}
    >
      <title>{`${node.title}\n${sub}`}</title>
      {node.status === "needs_you" && <rect className="halo" x={-3} y={-3} width={box.w + 6} height={box.h + 6} rx={12} />}
      <rect className="card-bg" width={box.w} height={box.h} rx={9} />
      <rect className="card-bar" x={0} y={0} width={4} height={box.h} rx={2} />
      <text className="glyph" x={17} y={box.h / 2 + 5} textAnchor="middle">
        {STATUS_GLYPH[node.status]}
      </text>
      <text className="title" x={30} y={20}>
        {truncate(node.title, textWidth)}
      </text>
      <text className="sub" x={30} y={37}>
        {truncate(sub, textWidth, 6)}
      </text>
    </g>
  );
}
