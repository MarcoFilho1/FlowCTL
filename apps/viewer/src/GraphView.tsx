import { useEffect, useMemo, useRef, useState } from "react";
import type { NodeStatus, Snapshot } from "../../../mod/graph/types.ts";
import { buildScene, circleBox, fitScale, linkPath, type Box, type NodeShape, type Scene } from "./geometry.ts";
import { hoverCard } from "./hover.ts";
import { tellNative } from "./store.ts";
import { useTween } from "./useTween.ts";

const FALLBACK_VIEWPORT = { width: 360, height: 420 };

export const STATUS_LABEL: Record<NodeStatus, string> = {
  pending: "Pending",
  running: "Running",
  needs_you: "Needs you",
  error: "Error",
  done: "Done"
};

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

/** The room the graph wants at full size, the open hover card included. */
export interface Extent {
  width: number;
  height: number;
}

export function GraphView({ snapshot, onExtent }: { snapshot: Snapshot; onExtent?: (extent: Extent) => void }) {
  const [ref, viewport] = useViewport();
  const scene = useMemo(() => buildScene(snapshot), [snapshot]);
  const [hovered, setHovered] = useState<string | null>(null);
  const hoveredNode = hovered ? scene.nodes.find((shape) => shape.id === hovered) : undefined;

  useEffect(() => {
    if (!onExtent) return;
    if (!hoveredNode) return onExtent({ width: scene.width, height: scene.height });
    const card = cardExtent(hoveredNode, snapshot);
    onExtent({ width: Math.max(scene.width, card.width), height: Math.max(scene.height, card.height) });
  }, [scene, hoveredNode, snapshot, onExtent]);

  const targets = useMemo(() => new Map<string, Box>(scene.nodes.map((shape) => [shape.id, circleBox(shape)])), [scene]);
  const boxes = useTween(targets);

  if (snapshot.nodes.length === 0) {
    return (
      <div className="graph">
        <p className="empty">Waiting for the first turn…</p>
      </div>
    );
  }

  // The overlay grows to fit the graph up to its limit; past it, the graph shrinks.
  const scale = fitScale(scene, viewport);
  const shapes = new Map(scene.nodes.map((shape) => [shape.id, shape]));
  const hoveredShape = hovered ? shapes.get(hovered) : undefined;
  const focus = (shape: NodeShape) => tellNative({ type: "focus", sessionId: snapshot.sessionId, nodeId: shape.id });

  return (
    <div className="graph">
      <div ref={ref} className="canvas">
        <div className="stage" style={{ width: scene.width * scale, height: scene.height * scale }}>
          <svg
            role="img"
            aria-label={`Task graph, ${snapshot.nodes.length} nodes`}
            width={scene.width * scale}
            height={scene.height * scale}
            viewBox={`0 0 ${scene.width} ${scene.height}`}
          >
            <defs>
              <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 8 4 L 0 8 z" className="arrow-head" />
              </marker>
            </defs>
            {scene.links.map((link) => {
              const from = boxes.get(link.from);
              const to = boxes.get(link.to);
              if (!from || !to) return null;
              return (
                <path
                  key={`${link.kind}:${link.from}->${link.to}`}
                  className={`link link-${link.kind}${link.inferred ? " inferred" : ""}`}
                  data-link={`${link.from}->${link.to}`}
                  d={linkPath(from, to, link.kind, shapes.get(link.from)?.tail ?? 0)}
                  {...(link.kind === "dependency" ? { markerEnd: "url(#arrow)" } : {})}
                />
              );
            })}
            {scene.nodes.map((shape) => {
              const box = boxes.get(shape.id) ?? circleBox(shape);
              return (
                <Node
                  key={shape.id}
                  shape={shape}
                  box={box}
                  onHover={(on) => setHovered(on ? shape.id : (current) => (current === shape.id ? null : current))}
                  onSelect={() => focus(shape)}
                />
              );
            })}
          </svg>
          {hoveredShape && <Card shape={hoveredShape} snapshot={snapshot} scale={scale} scene={scene} />}
        </div>
      </div>
    </div>
  );
}

function Node({
  shape,
  box,
  onHover,
  onSelect
}: {
  shape: NodeShape;
  box: Box;
  onHover: (on: boolean) => void;
  onSelect: () => void;
}) {
  const { node } = shape;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const r = box.w / 2;
  return (
    <g
      className={`node status-${node.status} kind-${node.kind}${shape.isSatellite ? " satellite" : ""}`}
      data-node={node.id}
      role="button"
      tabIndex={0}
      aria-label={`${node.title}: ${STATUS_LABEL[node.status]}`}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onFocus={() => onHover(true)}
      onBlur={() => onHover(false)}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onSelect();
      }}
    >
      {node.status === "needs_you" && <circle className="pulse" cx={cx} cy={cy} r={r + 3} />}
      <circle className="dot" cx={cx} cy={cy} r={r} />
      <text className="label" x={cx + r + 6} y={cy + 4}>
        {shape.label}
      </text>
      {/* A generous hit area: circles are small. */}
      <rect className="hit" x={box.x - 4} y={cy - 10} width={box.w + 10 + shape.labelWidth} height={20} />
    </g>
  );
}

const CARD_W = 220;

/** Where the hover card reaches at full size, so the overlay can make room for it. */
function cardExtent(shape: NodeShape, snapshot: Snapshot): Extent {
  const card = hoverCard(shape.node, snapshot);
  const bodyLines = card.body ? Math.min(6, Math.ceil(card.body.length / 34)) : 0;
  const height = 44 + bodyLines * 15;
  return { width: shape.cx - shape.r + CARD_W, height: shape.cy + shape.r + 6 + height };
}

function Card({ shape, snapshot, scale, scene }: { shape: NodeShape; snapshot: Snapshot; scale: number; scene: Scene }) {
  const card = hoverCard(shape.node, snapshot);
  // Below the node, flipped above when it would leave the stage.
  const stageW = scene.width * scale;
  const stageH = scene.height * scale;
  const left = Math.max(0, Math.min((shape.cx - shape.r) * scale, stageW - CARD_W));
  const below = (shape.cy + shape.r + 6) * scale;
  const style: React.CSSProperties =
    below + 60 > stageH && shape.cy * scale > stageH / 2
      ? { left, bottom: stageH - (shape.cy - shape.r - 6) * scale, width: CARD_W }
      : { left, top: below, width: CARD_W };
  return (
    <div className={`hover-card status-${shape.node.status}`} role="tooltip" style={style}>
      <div className="hover-title">{card.title}</div>
      <div className="hover-status">{card.status}</div>
      {card.body && <div className="hover-body">{card.body}</div>}
    </div>
  );
}
