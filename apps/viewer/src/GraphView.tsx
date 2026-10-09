import { useEffect, useMemo, useRef, useState } from "react";
import type { NodeStatus, Snapshot } from "../../../mod/graph/types.ts";
import { buildScene, centerOn, circleBox, clampPan, focusNode, linkPath, type Box, type NodeShape } from "./geometry.ts";
import { hoverCard } from "./hover.ts";
import { BANG, discSprite, PX, ringPixels, snap, steppedPath } from "./pixel.ts";
import { tellNative, type Look } from "./store.ts";
import { useTween } from "./useTween.ts";

const FALLBACK_VIEWPORT = { width: 360, height: 200 };
/** A press that moves less than this is a click, not a drag. */
export const DRAG_THRESHOLD = 4;
/** After the person pans, the view stops following the work for this long. */
export const FOLLOW_PAUSE_MS = 8000;
const CARD_W = 210;

export const STATUS_LABEL: Record<NodeStatus, string> = {
  pending: "Pending",
  running: "Running",
  needs_you: "Needs you",
  error: "Error",
  done: "Done"
};

type Point = { x: number; y: number };
type Size = { width: number; height: number };

function useViewport(): [React.RefObject<HTMLDivElement | null>, Size] {
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

/** Eases the drawn pan toward `target`; follows it exactly while dragging or when motion is reduced. */
function useGlide(target: Point, instant: boolean): Point {
  const [shown, setShown] = useState(target);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  useEffect(() => {
    const motion =
      typeof requestAnimationFrame === "function" &&
      typeof matchMedia === "function" &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (instant || !motion) {
      setShown(target);
      return;
    }
    let frame = 0;
    const step = () => {
      const at = shownRef.current;
      const next = { x: at.x + (target.x - at.x) * 0.18, y: at.y + (target.y - at.y) * 0.18 };
      const settled = Math.abs(next.x - target.x) < 0.5 && Math.abs(next.y - target.y) < 0.5;
      setShown(settled ? target : next);
      if (!settled) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target.x, target.y, instant]);
  return shown;
}

/**
 * The graph in a fixed window: nodes only, flowing left to right. Drag (or
 * scroll) to move around it; a click on a node brings its session forward;
 * hovering a node shows what it is about. Until the person moves the view,
 * it follows the node that matters (needs you, failing, running).
 */
export function GraphView({ snapshot, look = "pixel" }: { snapshot: Snapshot; look?: Look }) {
  const pixel = look === "pixel";
  const [ref, viewport] = useViewport();
  const scene = useMemo(() => buildScene(snapshot), [snapshot]);
  const targets = useMemo(() => new Map<string, Box>(scene.nodes.map((shape) => [shape.id, circleBox(shape)])), [scene]);
  const boxes = useTween(targets);

  const [hovered, setHovered] = useState<string | null>(null);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const press = useRef<{ start: Point; pan: Point; moved: boolean; node: string | null } | null>(null);
  const lastManual = useRef(-Infinity);

  const focus = focusNode(scene);
  useEffect(() => {
    if (performance.now() - lastManual.current < FOLLOW_PAUSE_MS) return;
    const fits = scene.width <= viewport.width && scene.height <= viewport.height;
    const wanted = fits
      ? { x: (viewport.width - scene.width) / 2, y: (viewport.height - scene.height) / 2 }
      : focus
        ? centerOn(focus, viewport)
        : { x: 0, y: 0 };
    setPan(clampPan(wanted, scene, viewport));
  }, [scene, viewport, focus?.id, focus?.node.status]);

  const drawn = useGlide(pan, dragging);

  if (snapshot.nodes.length === 0) {
    return (
      <div className="graph">
        <p className="empty">Waiting for the first turn…</p>
      </div>
    );
  }

  const shapes = new Map(scene.nodes.map((shape) => [shape.id, shape]));
  const moveTo = (next: Point) => {
    lastManual.current = performance.now();
    setPan(clampPan(next, scene, viewport));
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    const node = (event.target as Element).closest?.("[data-node]")?.getAttribute("data-node") ?? null;
    press.current = { start: { x: event.clientX, y: event.clientY }, pan, moved: false, node };
    try {
      (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    } catch {
      // Synthetic events from the overlay have no capturable pointer.
    }
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const held = press.current;
    if (!held) return;
    const dx = event.clientX - held.start.x;
    const dy = event.clientY - held.start.y;
    if (!held.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!held.moved) {
      held.moved = true;
      setDragging(true);
      setHovered(null);
    }
    moveTo({ x: held.pan.x + dx, y: held.pan.y + dy });
  };
  const onPointerUp = () => {
    const held = press.current;
    press.current = null;
    setDragging(false);
    // A press that did not move is a click: on a node, bring its session forward.
    if (held && !held.moved && held.node) {
      tellNative({ type: "focus", sessionId: snapshot.sessionId, nodeId: held.node });
    }
  };
  const onWheel = (event: React.WheelEvent) => moveTo({ x: pan.x - event.deltaX, y: pan.y - event.deltaY });

  const hoveredShape = hovered && !dragging ? shapes.get(hovered) : undefined;
  const offscreen = scene.nodes.filter((shape) => {
    if (shape.node.status !== "needs_you" && shape.node.status !== "error") return false;
    const x = shape.cx + drawn.x;
    const y = shape.cy + drawn.y;
    return x < 0 || y < 0 || x > viewport.width || y > viewport.height;
  });

  return (
    <div className="graph">
      <div
        ref={ref}
        className={`canvas${dragging ? " dragging" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        data-pan={`${Math.round(pan.x)},${Math.round(pan.y)}`}
      >
        <svg
          role="img"
          aria-label={`Task graph, ${snapshot.nodes.length} nodes`}
          width="100%"
          height="100%"
          {...(pixel ? { shapeRendering: "crispEdges" } : {})}
        >
          <defs>
            <pattern id="dots" width="16" height="16" patternUnits="userSpaceOnUse">
              {pixel ? <rect x="0" y="0" width={PX} height={PX} className="grid-dot" /> : <circle cx="1" cy="1" r="0.8" className="grid-dot" />}
            </pattern>
            {pixel ? (
              // A stepped arrowhead, 3 art pixels long.
              <marker id="arrow" viewBox="0 0 3 5" refX="3" refY="2.5" markerWidth="3" markerHeight="5" markerUnits="userSpaceOnUse" orient="auto">
                <path d="M0 0h1v1h1v1h1v1h-1v1h-1v1h-1z" className="arrow-head" transform={`scale(${PX / 2})`} />
              </marker>
            ) : (
              <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                <path d="M 0 0 L 8 4 L 0 8 z" className="arrow-head" />
              </marker>
            )}
          </defs>
          <g transform={pixel ? `translate(${snap(drawn.x)} ${snap(drawn.y)})` : `translate(${drawn.x} ${drawn.y})`}>
            {/* A faint grid that moves with the graph, so a drag reads as a drag. */}
            <rect className="grid" x={-2000} y={-2000} width={scene.width + 4000} height={scene.height + 4000} fill="url(#dots)" />
            {scene.links.map((link) => {
              const from = boxes.get(link.from);
              const to = boxes.get(link.to);
              if (!from || !to) return null;
              const live = link.kind === "dependency" && shapes.get(link.to)?.node.status === "running";
              return (
                <path
                  key={`${link.kind}:${link.from}->${link.to}`}
                  className={`link link-${link.kind}${link.inferred ? " inferred" : ""}${live ? " live" : ""}`}
                  data-link={`${link.from}->${link.to}`}
                  d={pixel && link.kind === "dependency" ? steppedLink(from, to) : linkPath(from, to, link.kind)}
                  {...(link.kind === "dependency" ? { markerEnd: "url(#arrow)" } : {})}
                />
              );
            })}
            {scene.nodes.map((shape) => (
              <NodeView
                pixel={pixel}
                key={shape.id}
                shape={shape}
                box={boxes.get(shape.id) ?? circleBox(shape)}
                onHover={(on) => setHovered(on ? shape.id : (current) => (current === shape.id ? null : current))}
              />
            ))}
          </g>
        </svg>
        {offscreen.map((shape) => (
          <Beacon
            key={shape.id}
            shape={shape}
            pan={drawn}
            viewport={viewport}
            onGo={() => moveTo(centerOn(shape, viewport))}
          />
        ))}
        {hoveredShape && <Card shape={hoveredShape} snapshot={snapshot} pan={drawn} viewport={viewport} />}
      </div>
    </div>
  );
}

function steppedLink(from: Box, to: Box): string {
  return steppedPath(from.x + from.w, from.y + from.h / 2, to.x, to.y + to.h / 2);
}

function NodeView({ pixel, ...props }: { pixel: boolean; shape: NodeShape; box: Box; onHover: (on: boolean) => void }) {
  return pixel ? <PixelNode {...props} /> : <Node {...props} />;
}

/** A node as a pixel-art sprite: outline, body, light and shade, with its status effects. */
function PixelNode({ shape, box, onHover }: { shape: NodeShape; box: Box; onHover: (on: boolean) => void }) {
  const { node } = shape;
  const size = shape.isSatellite ? 5 : 9;
  const sprite = discSprite(size);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const left = snap(cx - (size * PX) / 2);
  const top = snap(cy - (size * PX) / 2);
  return (
    <g
      className={`node pixel status-${node.status} kind-${node.kind}${shape.isSatellite ? " satellite" : ""}`}
      data-node={node.id}
      role="button"
      tabIndex={0}
      aria-label={`${node.title}: ${STATUS_LABEL[node.status]}`}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onFocus={() => onHover(true)}
      onBlur={() => onHover(false)}
    >
      <g transform={`translate(${left} ${top}) scale(${PX})`}>
        {node.status === "running" &&
          ringPixels(size).map(([x, y], i) => (
            <rect key={i} className="chaser" x={x} y={y} width={1} height={1} style={{ animationDelay: `${i * 0.1}s` }} />
          ))}
        {(node.status === "needs_you" || node.status === "error") &&
          ringPixels(size, 1).map(([x, y], i) => <rect key={i} className="halo-px" x={x} y={y} width={1} height={1} />)}
        <path className="px-body" d={sprite.body} />
        <path className="px-light" d={sprite.light} />
        <path className="px-shade" d={sprite.shade} />
        <path className="px-outline" d={sprite.outline} />
        {node.status === "needs_you" && <path className="bang" d={BANG} transform={`translate(${(size - 1) / 2} -7)`} />}
      </g>
      <circle className="hit" cx={cx} cy={cy} r={box.w / 2 + 7} />
    </g>
  );
}

function Node({ shape, box, onHover }: { shape: NodeShape; box: Box; onHover: (on: boolean) => void }) {
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
    >
      <circle className="glow" cx={cx} cy={cy} r={r + 5} />
      {node.status === "needs_you" && <circle className="pulse" cx={cx} cy={cy} r={r + 2} />}
      {node.status === "running" && <circle className="orbit" cx={cx} cy={cy} r={r + 3.5} style={{ transformOrigin: `${cx}px ${cy}px` }} />}
      <circle className="dot" cx={cx} cy={cy} r={r} />
      <circle className="shine" cx={cx - r * 0.3} cy={cy - r * 0.35} r={r * 0.35} />
      {/* A generous hit area: circles are small. */}
      <circle className="hit" cx={cx} cy={cy} r={r + 7} />
    </g>
  );
}

/** A marker on the edge of the view pointing at a node that needs attention out of sight. */
function Beacon({ shape, pan, viewport, onGo }: { shape: NodeShape; pan: Point; viewport: Size; onGo: () => void }) {
  const sx = shape.cx + pan.x;
  const sy = shape.cy + pan.y;
  const x = Math.min(Math.max(sx, 10), viewport.width - 10);
  const y = Math.min(Math.max(sy, 10), viewport.height - 10);
  const angle = (Math.atan2(sy - viewport.height / 2, sx - viewport.width / 2) * 180) / Math.PI;
  return (
    <button
      type="button"
      className={`beacon status-${shape.node.status}`}
      data-beacon={shape.id}
      aria-label={`${shape.node.title}: ${STATUS_LABEL[shape.node.status]}, out of view`}
      style={{ left: x - 8, top: y - 8, transform: `rotate(${angle}deg)` }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={onGo}
    >
      ➤
    </button>
  );
}

function Card({ shape, snapshot, pan, viewport }: { shape: NodeShape; snapshot: Snapshot; pan: Point; viewport: Size }) {
  const card = hoverCard(shape.node, snapshot);
  const x = shape.cx + pan.x;
  const y = shape.cy + pan.y;
  const width = Math.min(CARD_W, viewport.width - 12);
  // Beside the node, on whichever side has room, kept inside the window.
  const left = x + shape.r + 10 + width <= viewport.width ? x + shape.r + 10 : Math.max(6, x - shape.r - 10 - width);
  const style: React.CSSProperties = { left, width };
  if (y < viewport.height / 2) style.top = Math.max(6, y - 14);
  else style.bottom = Math.max(6, viewport.height - y - 14);
  return (
    <div className={`hover-card status-${shape.node.status}`} role="tooltip" style={style}>
      <div className="hover-title">{card.title}</div>
      <div className="hover-status">{card.status}</div>
      {card.body && <div className="hover-body">{card.body}</div>}
    </div>
  );
}
