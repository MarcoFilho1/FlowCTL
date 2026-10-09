import { useEffect, useMemo, useRef, useState } from "react";
import type { NodeStatus, Snapshot } from "../../../mod/graph/types.ts";
import { buildScene, cameraFor, centerOn, circleBox, clampPan, linkPath, type Box, type Camera, type NodeShape } from "./geometry.ts";
import { hoverCard } from "./hover.ts";
import { BANG, discSprite, PX, ringPixels, snap, steppedPath } from "./pixel.ts";
import { tellNative, type Look } from "./store.ts";
import { errorsOf, statusesOf, transitions } from "./transitions.ts";
import { useTween } from "./useTween.ts";

/** How long a finish burst and a handoff packet stay on screen. */
export const EFFECT_MS = 1000;

interface Effect {
  key: string;
  kind: "burst" | "packet" | "appear" | "flash";
  from: string;
  to?: string;
}

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

/** Eases the drawn camera toward `target`; follows it exactly while dragging or when motion is reduced. */
function useGlide(target: Camera, instant: boolean): Camera {
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
      const next = {
        x: at.x + (target.x - at.x) * 0.12,
        y: at.y + (target.y - at.y) * 0.12,
        s: at.s + (target.s - at.s) * 0.12
      };
      const settled = Math.abs(next.x - target.x) < 0.5 && Math.abs(next.y - target.y) < 0.5 && Math.abs(next.s - target.s) < 0.005;
      setShown(settled ? target : next);
      if (!settled) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target.x, target.y, target.s, instant]);
  return shown;
}

/**
 * The graph in a fixed window: nodes only, flowing left to right. Drag (or
 * scroll) to move around it; a click on a node brings its session forward;
 * hovering a node shows what it is about. Until the person moves the view,
 * the camera follows the current step while the session works and pulls back
 * to the whole graph when it rests. A finished step bursts and hands off to
 * the step it unblocked with a packet along the edge.
 */
export function GraphView({ snapshot, look = "pixel" }: { snapshot: Snapshot; look?: Look }) {
  const pixel = look === "pixel";
  const [ref, viewport] = useViewport();
  const scene = useMemo(() => buildScene(snapshot), [snapshot]);
  const targets = useMemo(() => new Map<string, Box>(scene.nodes.map((shape) => [shape.id, circleBox(shape)])), [scene]);
  const boxes = useTween(targets);

  const [hovered, setHovered] = useState<string | null>(null);
  const [cam, setCam] = useState<Camera>({ x: 0, y: 0, s: 1 });
  const [dragging, setDragging] = useState(false);
  const press = useRef<{ start: Point; cam: Camera; moved: boolean; node: string | null } | null>(null);
  const lastManual = useRef(-Infinity);

  // Working: follow the current step. Resting: the whole graph ("idle" mode).
  const mode = snapshot.sessionState === "working" || snapshot.sessionState === "waiting_you" ? "follow" : "overview";
  const auto = useMemo(() => cameraFor(scene, viewport, mode, pixel), [scene, viewport, mode, pixel]);
  useEffect(() => {
    if (performance.now() - lastManual.current < FOLLOW_PAUSE_MS) return;
    setCam(auto);
  }, [auto.x, auto.y, auto.s]);

  const drawn = useGlide(cam, dragging);

  // Transition effects: compare each snapshot with the one before.
  const [effects, setEffects] = useState<Effect[]>([]);
  const previous = useRef<ReturnType<typeof statusesOf> | undefined>(undefined);
  const previousErrors = useRef<ReturnType<typeof errorsOf>>(new Map());
  useEffect(() => {
    const change = transitions(previous.current, snapshot, previousErrors.current);
    previous.current = statusesOf(snapshot);
    previousErrors.current = errorsOf(snapshot);
    const born: Effect[] = [
      ...change.added.map((id) => ({ key: `appear:${id}:${snapshot.seq}`, kind: "appear" as const, from: id })),
      ...change.flashed.map((id) => ({ key: `flash:${id}:${snapshot.seq}`, kind: "flash" as const, from: id })),
      ...change.finished.map((id) => ({ key: `burst:${id}:${snapshot.seq}`, kind: "burst" as const, from: id })),
      ...change.handoffs.map(([from, to]) => ({ key: `packet:${from}->${to}:${snapshot.seq}`, kind: "packet" as const, from, to }))
    ];
    if (born.length === 0) return;
    setEffects((current) => [...current, ...born]);
    const keys = new Set(born.map((effect) => effect.key));
    const timer = setTimeout(() => setEffects((current) => current.filter((effect) => !keys.has(effect.key))), EFFECT_MS);
    return () => clearTimeout(timer);
  }, [snapshot]);

  if (snapshot.nodes.length === 0) {
    return (
      <div className="graph">
        <p className="empty">Waiting for the first turn…</p>
      </div>
    );
  }

  const shapes = new Map(scene.nodes.map((shape) => [shape.id, shape]));
  const entering = new Set(effects.filter((effect) => effect.kind === "appear").map((effect) => effect.from));
  const flashing = new Set(effects.filter((effect) => effect.kind === "flash").map((effect) => effect.from));
  const sized = (s: number) => ({ width: scene.width * s, height: scene.height * s });
  const moveTo = (next: Point) => {
    lastManual.current = performance.now();
    setCam((current) => ({ ...clampPan(next, sized(current.s), viewport), s: current.s }));
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    const node = (event.target as Element).closest?.("[data-node]")?.getAttribute("data-node") ?? null;
    press.current = { start: { x: event.clientX, y: event.clientY }, cam, moved: false, node };
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
    moveTo({ x: held.cam.x + dx, y: held.cam.y + dy });
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
  const onWheel = (event: React.WheelEvent) => moveTo({ x: cam.x - event.deltaX, y: cam.y - event.deltaY });

  const hoveredShape = hovered && !dragging ? shapes.get(hovered) : undefined;
  const offscreen = scene.nodes.filter((shape) => {
    if (shape.node.status !== "needs_you" && shape.node.status !== "error") return false;
    const x = shape.cx * drawn.s + drawn.x;
    const y = shape.cy * drawn.s + drawn.y;
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
        data-pan={`${Math.round(cam.x)},${Math.round(cam.y)}`}
        data-scale={cam.s}
        data-mode={mode}
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
          <g
            transform={
              pixel
                ? `translate(${snap(drawn.x)} ${snap(drawn.y)}) scale(${drawn.s})`
                : `translate(${drawn.x} ${drawn.y}) scale(${drawn.s})`
            }
          >
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
                  className={`link link-${link.kind}${link.inferred ? " inferred" : ""}${live ? " live" : ""}${entering.has(link.to) ? " entering" : ""}`}
                  pathLength={entering.has(link.to) ? 1 : undefined}
                  data-link={`${link.from}->${link.to}`}
                  d={pixel && link.kind !== "agent" ? steppedLink(from, to) : linkPath(from, to, link.kind === "agent" ? "agent" : "dependency")}
                  {...(link.kind !== "agent" ? { markerEnd: "url(#arrow)" } : {})}
                />
              );
            })}
            {scene.nodes.map((shape) => (
              <NodeView
                pixel={pixel}
                entering={entering.has(shape.id)}
                flashing={flashing.has(shape.id)}
                key={shape.id}
                shape={shape}
                box={boxes.get(shape.id) ?? circleBox(shape)}
                onHover={(on) => setHovered(on ? shape.id : (current) => (current === shape.id ? null : current))}
              />
            ))}
            {effects.map((effect) => {
              const from = boxes.get(effect.from);
              if (!from) return null;
              if (effect.kind === "burst") return <Burst key={effect.key} box={from} pixel={pixel} />;
              if (effect.kind === "appear") return pixel ? <Converge key={effect.key} box={from} /> : null;
              const to = effect.to !== undefined ? boxes.get(effect.to) : undefined;
              if (!to) return null;
              return <Packet key={effect.key} path={pixel ? steppedLink(from, to) : linkPath(from, to, "dependency")} pixel={pixel} />;
            })}
          </g>
        </svg>
        {offscreen.map((shape) => (
          <Beacon
            key={shape.id}
            shape={shape}
            cam={drawn}
            viewport={viewport}
            onGo={() => {
              const at = centerOn({ cx: shape.cx * cam.s, cy: shape.cy * cam.s }, viewport);
              moveTo(at);
            }}
          />
        ))}
        {hoveredShape && <Card shape={hoveredShape} snapshot={snapshot} cam={drawn} viewport={viewport} />}
      </div>
    </div>
  );
}

function steppedLink(from: Box, to: Box): string {
  return steppedPath(from.x + from.w, from.y + from.h / 2, to.x, to.y + to.h / 2);
}

function NodeView({
  pixel,
  entering,
  flashing,
  ...props
}: {
  pixel: boolean;
  entering: boolean;
  flashing: boolean;
  shape: NodeShape;
  box: Box;
  onHover: (on: boolean) => void;
}) {
  const drawn = pixel ? <PixelNode {...props} /> : <Node {...props} />;
  // A tool error just happened here: blink red, then back to its own color.
  const node = flashing ? <g className="flashing">{drawn}</g> : drawn;
  // A node that just appeared materializes: wrapped so its own transforms stay untouched.
  return entering ? <g className={pixel ? "entering entering-px" : "entering"}>{node}</g> : node;
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
function Beacon({ shape, cam, viewport, onGo }: { shape: NodeShape; cam: Camera; viewport: Size; onGo: () => void }) {
  const sx = shape.cx * cam.s + cam.x;
  const sy = shape.cy * cam.s + cam.y;
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

function Card({ shape, snapshot, cam, viewport }: { shape: NodeShape; snapshot: Snapshot; cam: Camera; viewport: Size }) {
  const card = hoverCard(shape.node, snapshot);
  const x = shape.cx * cam.s + cam.x;
  const y = shape.cy * cam.s + cam.y;
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

/** A finished step flashes: rings spread out from it, in whole frames for the pixel look. */
function Burst({ box, pixel }: { box: Box; pixel: boolean }) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  if (!pixel) return <circle className="burst" cx={cx} cy={cy} r={box.w / 2 + 2} />;
  const size = Math.round(box.w / PX);
  const left = snap(cx - (size * PX) / 2);
  const top = snap(cy - (size * PX) / 2);
  return (
    <g className="burst-px" transform={`translate(${left} ${top}) scale(${PX})`}>
      {[1, 3, 5].map((gap, ring) =>
        ringPixels(size, gap).map(([x, y], i) => (
          <rect key={`${ring}:${i}`} x={x} y={y} width={1} height={1} style={{ animationDelay: `${ring * 0.12}s` }} />
        ))
      )}
    </g>
  );
}

/** The handoff: a packet travels the edge from the finished step to the next one. */
function Packet({ path, pixel }: { path: string; pixel: boolean }) {
  return (
    <g className={pixel ? "packet packet-px" : "packet"}>
      {pixel ? <rect x={-2} y={-2} width={4} height={4} /> : <circle r={3} />}
      <animateMotion dur="0.7s" path={path} fill="freeze" calcMode={pixel ? "discrete" : "spline"} {...(pixel ? { keyPoints: "0;0.2;0.4;0.6;0.8;1", keyTimes: "0;0.2;0.4;0.6;0.8;1" } : { keySplines: "0.4 0 0.2 1", keyTimes: "0;1", keyPoints: "0;1" })} />
    </g>
  );
}

/** Pixels gather into a node that just appeared: the burst, played inward. */
function Converge({ box }: { box: Box }) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const size = Math.round(box.w / PX);
  const left = snap(cx - (size * PX) / 2);
  const top = snap(cy - (size * PX) / 2);
  return (
    <g className="converge-px" transform={`translate(${left} ${top}) scale(${PX})`}>
      {[6, 4, 2].map((gap, ring) =>
        ringPixels(size, gap).map(([x, y], i) => (
          <rect key={`${ring}:${i}`} x={x} y={y} width={1} height={1} style={{ animationDelay: `${ring * 0.1}s` }} />
        ))
      )}
    </g>
  );
}
