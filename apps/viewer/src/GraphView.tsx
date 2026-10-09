import { useEffect, useMemo, useRef, useState } from "react";
import type { NodeStatus, Snapshot } from "../../../mod/graph/types.ts";
import { buildScene, cameraFor, centerOn, circleBox, clampPan, linkPath, type Box, type Camera, type NodeShape } from "./geometry.ts";
import { hoverCard } from "./hover.ts";
import { BANG, discSprite, PX, ringPixels, snap, steppedPath } from "./pixel.ts";
import { tellNative, type Look } from "./store.ts";
import { cue, cuesFor } from "./sound.ts";
import { errorsOf, statusesOf, transitions } from "./transitions.ts";
import { useTween } from "./useTween.ts";
import { BAR_H, dreamFit, dreamFrame, dreamOutline, dreamPoints, MORPH_MS, type DreamShape } from "./dream.ts";

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
/**
 * Scroll zooms only once the pointer has rested on the window this long, so
 * scrolling the page underneath and passing over the overlay does not zoom.
 */
export const ZOOM_ARM_MS = 400;
/** Scroll distance (px) that makes one zoom step. */
export const WHEEL_STEP = 50;
/** How far the person can zoom. */
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2;

/** The next zoom level: quarter steps for pixel art (pixels stay whole), 1.25× otherwise. */
export function zoomStep(s: number, direction: 1 | -1, pixel: boolean): number {
  const next = pixel ? Math.round((s + direction * 0.25) * 4) / 4 : direction > 0 ? s * 1.25 : s / 1.25;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
}

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
const isLive = (state: Snapshot["sessionState"]) => state === "working" || state === "waiting_you";

export function GraphView({
  snapshot,
  look = "pixel",
  sound = false,
  sounds = look,
  dreaming = false
}: {
  snapshot: Snapshot;
  look?: Look;
  sound?: boolean;
  /** Which set of sounds plays; the look's own unless chosen otherwise. */
  sounds?: Look;
  /** Nothing has worked for a while: the nodes form shapes (the idle animation). */
  dreaming?: boolean;
}) {
  const pixel = look === "pixel";
  const [ref, viewport] = useViewport();
  const scene = useMemo(() => buildScene(snapshot), [snapshot]);
  const layoutBoxes = useMemo(() => new Map<string, Box>(scene.nodes.map((shape) => [shape.id, circleBox(shape)])), [scene]);

  // The dream: the nodes leave the graph for a shape, centered on the graph's middle.
  const [hovered, setHovered] = useState<string | null>(null);
  // Hovering a node holds the dream still, so its card can be read.
  const elapsed = useDreamClock(dreaming, pixel, hovered !== null);
  const center = { x: scene.width / 2, y: scene.height / 2 };
  const fit = dreamFit(scene.nodes.length, Math.max(1, ...scene.nodes.map((shape) => shape.r)), viewport, pixel);
  const dreamBoxes = useMemo(() => {
    if (!dreaming) return layoutBoxes;
    const frame = dreamFrame(scene.nodes.length, elapsed);
    const points = dreamPoints(scene.nodes.length, frame);
    const leaving = frame.from === "graph" ? frame.mix : 1;
    return new Map<string, Box>(
      scene.nodes.map((shape, i) => {
        const p = points[i]!;
        const cx = center.x + p.x * fit.radius;
        const cy = center.y + p.y * fit.radius;
        return [shape.id, circleBox({ r: shape.r, cx: shape.cx + (cx - shape.cx) * leaving, cy: shape.cy + (cy - shape.cy) * leaving })];
      })
    );
  }, [dreaming, elapsed, layoutBoxes, fit.radius]);
  const frame = dreaming ? dreamFrame(scene.nodes.length, elapsed) : undefined;
  const outlinePath = (shape: DreamShape) => {
    const points = dreamOutline(shape);
    if (!points) return null;
    const at = (p: { x: number; y: number }) => {
      const x = center.x + p.x * fit.radius;
      const y = center.y + p.y * fit.radius;
      return pixel ? `${snap(x)} ${snap(y)}` : `${x.toFixed(1)} ${y.toFixed(1)}`;
    };
    return `M ${points.map(at).join(" L ")} Z`;
  };
  // Back from the dream, the nodes fly home a little slower than a layout change.
  const boxes = useTween(dreamBoxes, { instant: dreaming, ms: dreaming ? undefined : 900 });

  const [cam, setCam] = useState<Camera>({ x: 0, y: 0, s: 1 });
  const [dragging, setDragging] = useState(false);
  const press = useRef<{ start: Point; cam: Camera; moved: boolean; node: string | null } | null>(null);
  const lastManual = useRef(-Infinity);

  // Working: follow the current step. Resting: the whole graph ("idle" mode).
  const mode = snapshot.sessionState === "working" || snapshot.sessionState === "waiting_you" ? "follow" : "overview";
  const auto = useMemo(
    () =>
      dreaming
        ? { x: viewport.width / 2 - center.x * fit.s, y: (viewport.height + BAR_H) / 2 - center.y * fit.s, s: fit.s }
        : cameraFor(scene, viewport, mode, pixel),
    [scene, viewport, mode, pixel, dreaming, fit.s]
  );
  // While the session rests, a view the person chose (zoom, pan) stays until
  // the session works again; while it works, the camera takes over again
  // after a short pause.
  const heldAtRest = useRef(false);
  useEffect(() => {
    if (mode === "follow") heldAtRest.current = false;
  }, [mode]);
  useEffect(() => {
    // The dream frames itself, whatever view the person chose before.
    if (dreaming) {
      heldAtRest.current = false;
      setCam(auto);
      return;
    }
    if (mode === "overview" && heldAtRest.current) return;
    if (performance.now() - lastManual.current < FOLLOW_PAUSE_MS) return;
    setCam(auto);
  }, [auto.x, auto.y, auto.s, dreaming]);

  const drawn = useGlide(cam, dragging);

  // A trackpad pinch zooms too: WebKit (the overlay) reports it as gesture
  // events, every 15% of pinch is one zoom step.
  const zoomRef = useRef<((direction: 1 | -1) => void) | undefined>(undefined);
  const wheelSum = useRef(0);
  /** When the pointer came onto the window (Date.now), or null while it is away. */
  const hoverSince = useRef<number | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let last = 1;
    const start = (event: Event) => {
      event.preventDefault();
      last = 1;
    };
    const change = (event: Event) => {
      event.preventDefault();
      const scale = (event as Event & { scale?: number }).scale ?? 1;
      if (scale > last * 1.15) {
        zoomRef.current?.(1);
        last = scale;
      } else if (scale < last / 1.15) {
        zoomRef.current?.(-1);
        last = scale;
      }
    };
    element.addEventListener("gesturestart", start);
    element.addEventListener("gesturechange", change);
    return () => {
      element.removeEventListener("gesturestart", start);
      element.removeEventListener("gesturechange", change);
    };
  }, [ref]);

  // Transition effects: compare each snapshot with the one before.
  const [effects, setEffects] = useState<Effect[]>([]);
  const previous = useRef<ReturnType<typeof statusesOf> | undefined>(undefined);
  const previousErrors = useRef<ReturnType<typeof errorsOf>>(new Map());
  const previousState = useRef<Snapshot["sessionState"] | undefined>(undefined);
  useEffect(() => {
    const before = previous.current;
    const change = transitions(before, snapshot, previousErrors.current);
    previous.current = statusesOf(snapshot);
    previousErrors.current = errorsOf(snapshot);
    const wasLive = previousState.current !== undefined && isLive(previousState.current);
    previousState.current = snapshot.sessionState;
    if (sound && before !== undefined) {
      const wentYellow = snapshot.nodes.some((node) => node.status === "needs_you" && before.get(node.id) !== "needs_you");
      const finishedSession =
        wasLive && !isLive(snapshot.sessionState) && snapshot.nodes.length > 0 && snapshot.nodes.every((node) => node.status === "done");
      for (const which of cuesFor(change, wentYellow, finishedSession)) cue(which, sounds);
    }
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
    // The canvas is there from the start, so the window is measured (and
    // gestures heard) before the first node arrives.
    return (
      <div className="graph">
        <div ref={ref} className="canvas">
          <p className="empty">Waiting for the first turn…</p>
        </div>
      </div>
    );
  }

  const shapes = new Map(scene.nodes.map((shape) => [shape.id, shape]));
  const entering = new Set(effects.filter((effect) => effect.kind === "appear").map((effect) => effect.from));
  const flashing = new Set(effects.filter((effect) => effect.kind === "flash").map((effect) => effect.from));
  const sized = (s: number) => ({ width: scene.width * s, height: scene.height * s });
  const moveTo = (next: Point) => {
    lastManual.current = performance.now();
    if (mode === "overview") heldAtRest.current = true;
    setCam((current) => ({ ...clampPan(next, sized(current.s), viewport), s: current.s }));
  };
  // Zoom at rest, around a point of the window (the cursor, or the middle).
  const zoom = (direction: 1 | -1, around: Point = { x: viewport.width / 2, y: viewport.height / 2 }) => {
    lastManual.current = performance.now();
    if (mode === "overview") heldAtRest.current = true;
    setCam((current) => {
      const s = zoomStep(current.s, direction, pixel);
      if (s === current.s) return current;
      const x = around.x - ((around.x - current.x) * s) / current.s;
      const y = around.y - ((around.y - current.y) * s) / current.s;
      return { ...clampPan({ x, y }, sized(s), viewport), s };
    });
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
  zoomRef.current = zoom;
  // Scroll zooms around the cursor (drag moves). A mouse notch is one step; a
  // trackpad's small deltas add up to a step, so the zoom does not jitter.
  const onWheel = (event: React.WheelEvent) => {
    const delta = event.deltaY !== 0 ? event.deltaY : event.deltaX;
    if (delta === 0) return;
    if (hoverSince.current === null || Date.now() - hoverSince.current < ZOOM_ARM_MS) {
      // Not armed yet: the person may be scrolling something else and passing by.
      hoverSince.current ??= Date.now();
      wheelSum.current = 0;
      return;
    }
    const held = wheelSum.current;
    wheelSum.current = Math.sign(held) === Math.sign(delta) || held === 0 ? held + delta : delta;
    if (Math.abs(wheelSum.current) < WHEEL_STEP) return;
    const direction: 1 | -1 = wheelSum.current < 0 ? 1 : -1;
    wheelSum.current = 0;
    const box = (event.currentTarget as Element).getBoundingClientRect();
    zoom(direction, { x: event.clientX - box.left, y: event.clientY - box.top });
  };

  const hoveredShape = hovered && !dragging ? shapes.get(hovered) : undefined;
  const offscreen = scene.nodes.filter((shape) => {
    if (dreaming) return false;
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
        onMouseEnter={() => {
          hoverSince.current = Date.now();
        }}
        onMouseLeave={() => {
          hoverSince.current = null;
          wheelSum.current = 0;
        }}
        data-pan={`${Math.round(cam.x)},${Math.round(cam.y)}`}
        data-scale={cam.s}
        data-mode={dreaming ? "dream" : mode}
      >
        <svg
          role="img"
          aria-label={`Task graph, ${snapshot.nodes.length} nodes`}
          className={dreaming ? "dreaming" : undefined}
          width="100%"
          height="100%"
          {...(pixel ? { shapeRendering: "crispEdges" } : {})}
        >
          <defs>
            <pattern id="dots" width="16" height="16" patternUnits="userSpaceOnUse">
              {pixel ? <rect x="0" y="0" width={PX} height={PX} className="grid-dot" /> : <circle cx="1" cy="1" r="0.8" className="grid-dot" />}
            </pattern>
            {/* Arrowheads: a stepped 4×7 art-pixel triangle, or a vector one; blue on edges into running steps. */}
            {(["arrow", "arrow-live"] as const).map((id) =>
              pixel ? (
                <marker key={id} id={id} viewBox="0 0 4 7" refX="4" refY="3.5" markerWidth="6" markerHeight="10.5" markerUnits="userSpaceOnUse" orient="auto">
                  <path d="M0 0h1v1h1v1h1v1h1v1h-1v1h-1v1h-1v1h-1z" className={`arrow-head${id === "arrow-live" ? " live" : ""}`} />
                </marker>
              ) : (
                <marker key={id} id={id} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto">
                  <path d="M 0 0 L 10 5 L 0 10 z" className={`arrow-head${id === "arrow-live" ? " live" : ""}`} />
                </marker>
              )
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
              const live = link.kind !== "agent" && shapes.get(link.to)?.node.status === "running";
              const d = pixel && link.kind !== "agent" ? steppedLink(from, to) : linkPath(from, to, link.kind === "agent" ? "agent" : "dependency");
              return (
                <g key={`${link.kind}:${link.from}->${link.to}`}>
                <path
                  className={`link link-${link.kind}${link.inferred ? " inferred" : ""}${live ? " live" : ""}${entering.has(link.to) ? " entering" : ""}`}
                  pathLength={entering.has(link.to) ? 1 : undefined}
                  data-link={`${link.from}->${link.to}`}
                  d={d}
                  {...(link.kind !== "agent" ? { markerEnd: live ? "url(#arrow-live)" : "url(#arrow)" } : {})}
                />
                {/* Into the running step, a packet keeps travelling the edge: the direction of the work. */}
                {live && <Flow path={d} pixel={pixel} />}
                </g>
              );
            })}
            {frame &&
              [
                { shape: frame.shape, opacity: frame.mix },
                ...(frame.from !== "graph" && frame.mix < 1 ? [{ shape: frame.from, opacity: 1 - frame.mix }] : [])
              ].map(({ shape, opacity }) => {
                const d = outlinePath(shape);
                return d && <path key={shape} className="dream-outline" d={d} style={{ opacity: opacity * 0.5 }} />;
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
            {!dreaming && effects.map((effect) => {
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
        {hoveredShape && (
          <Card shape={hoveredShape} box={boxes.get(hoveredShape.id) ?? circleBox(hoveredShape)} snapshot={snapshot} cam={drawn} viewport={viewport} />
        )}
      </div>
    </div>
  );
}

/**
 * Milliseconds since the dream began, ticking while it lasts: every frame for
 * the smooth look, at 12 fps for pixel art (its shapes step like a sprite).
 * With reduced motion the shape is shown still, already formed. While
 * `paused` the clock holds, and it goes on from there.
 */
function useDreamClock(dreaming: boolean, pixel: boolean, paused: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  const elapsedRef = useRef(0);
  useEffect(() => {
    if (!dreaming) {
      elapsedRef.current = 0;
      setElapsed(0);
      return;
    }
    if (paused) return;
    const motion =
      typeof requestAnimationFrame === "function" &&
      typeof matchMedia === "function" &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!motion) {
      setElapsed(MORPH_MS);
      return;
    }
    const began = performance.now() - elapsedRef.current;
    const every = pixel ? 1000 / 12 : 1000 / 30;
    let last = -Infinity;
    let frame = 0;
    const step = (now: number) => {
      if (now - last >= every) {
        last = now;
        elapsedRef.current = now - began;
        setElapsed(now - began);
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [dreaming, pixel, paused]);
  return elapsed;
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

function Card({ shape, box, snapshot, cam, viewport }: { shape: NodeShape; box: Box; snapshot: Snapshot; cam: Camera; viewport: Size }) {
  const card = hoverCard(shape.node, snapshot);
  // Where the node is drawn now: in the dream, away from its place in the graph.
  const x = (box.x + box.w / 2) * cam.s + cam.x;
  const y = (box.y + box.h / 2) * cam.s + cam.y;
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

/** A packet looping along an edge into the running step. */
function Flow({ path, pixel }: { path: string; pixel: boolean }) {
  return (
    <g className={pixel ? "flow flow-px" : "flow"}>
      {pixel ? <rect x={-2} y={-2} width={4} height={4} /> : <circle r={2.5} />}
      <animateMotion
        dur="1.4s"
        repeatCount="indefinite"
        path={path}
        calcMode={pixel ? "discrete" : "linear"}
        {...(pixel ? { keyPoints: "0;0.125;0.25;0.375;0.5;0.625;0.75;0.875;1", keyTimes: "0;0.111;0.222;0.333;0.444;0.556;0.667;0.778;0.889" } : {})}
      />
    </g>
  );
}
