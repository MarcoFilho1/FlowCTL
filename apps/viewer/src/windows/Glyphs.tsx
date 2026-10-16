// The flyout's toggle glyphs, drawn in Fluent's line style (1.5 px strokes,
// round caps, 20 px box), each acting out its option as it switches: the
// nodes gather into a ring, the pin goes in or comes off, the window rises
// from the taskbar or sinks under a moon. The same ideas as the macOS app's.

import { useEffect, useRef, useState } from "react";

export type Glyph = "overlay" | "onTop" | "animation" | "autoShow" | "hideWhenIdle" | "subagents";

function reducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** 0 when off, 1 when on, eased between them over `ms`. */
function useProgress(on: boolean, ms = 420): number {
  const [progress, setProgress] = useState(on ? 1 : 0);
  const shown = useRef(progress);
  useEffect(() => {
    const target = on ? 1 : 0;
    if (reducedMotion() || typeof requestAnimationFrame !== "function") {
      shown.current = target;
      setProgress(target);
      return;
    }
    const from = shown.current;
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      // A soft overshoot, as Fluent's "point to point" motion.
      const eased = 1 - (1 - t) ** 3 * (1 - 1.6 * t);
      shown.current = from + (target - from) * eased;
      setProgress(shown.current);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [on, ms]);
  return progress;
}

// Animation: five nodes, a small graph off, a ring on (the ring's order keeps each node's neighbours).
const GRAPH: [number, number][] = [
  [2.5, 10], [8, 4.5], [8, 15.5], [13, 10], [17.5, 10]
];
const RING: [number, number][] = (() => {
  const points: [number, number][] = Array.from({ length: 5 }, () => [0, 0]);
  [0, 1, 3, 4, 2].forEach((node, slot) => {
    const angle = -Math.PI / 2 + (slot * 2 * Math.PI) / 5;
    points[node] = [10 + 7 * Math.cos(angle), 10 + 7 * Math.sin(angle)];
  });
  return points;
})();
const SHARED: [number, number][] = [[0, 1], [1, 3], [3, 4]];
const GRAPH_ONLY: [number, number][] = [[0, 2], [2, 3]];
const RING_ONLY: [number, number][] = [[4, 2], [2, 0]];

function GraphRing({ p }: { p: number }) {
  const at = (i: number): [number, number] => {
    const [ax, ay] = GRAPH[i]!;
    const [bx, by] = RING[i]!;
    return [ax + (bx - ax) * p, ay + (by - ay) * p];
  };
  const lines = (edges: [number, number][], opacity: number) =>
    edges.map(([a, b]) => {
      const [x1, y1] = at(a);
      const [x2, y2] = at(b);
      return <line key={`${a}-${b}`} x1={x1} y1={y1} x2={x2} y2={y2} opacity={opacity} />;
    });
  return (
    <g className={p > 0.98 ? "fl-spin" : undefined}>
      {lines(SHARED, 1)}
      {lines(GRAPH_ONLY, 1 - p)}
      {lines(RING_ONLY, p)}
      {GRAPH.map((_, i) => {
        const [cx, cy] = at(i);
        return <circle key={i} cx={cx} cy={cy} r={1.9} className="fl-fill" />;
      })}
    </g>
  );
}

export function GlyphIcon({ glyph, on }: { glyph: Glyph; on: boolean }) {
  const p = useProgress(on);
  const clamp = Math.max(0, Math.min(1, p));
  return (
    <svg className="fl-glyph" viewBox="0 0 20 20" width={20} height={20} aria-hidden="true">
      {glyph === "animation" && <GraphRing p={p} />}

      {glyph === "overlay" && (
        <g>
          {/* The panel, its graph showing when on. */}
          <rect x={2.5} y={4} width={15} height={12} rx={2} />
          <g opacity={clamp}>
            <circle cx={6.5} cy={10} r={1.4} className="fl-fill" />
            <circle cx={13.5} cy={7.5} r={1.4} className="fl-fill" />
            <circle cx={13.5} cy={12.5} r={1.4} className="fl-fill" />
            <line x1={6.5} y1={10} x2={13.5} y2={7.5} />
            <line x1={6.5} y1={10} x2={13.5} y2={12.5} />
          </g>
          <line x1={4} y1={17.5} x2={16} y2={2.5} opacity={1 - clamp} />
        </g>
      )}

      {glyph === "onTop" && (
        <g>
          <rect x={2} y={8} width={10} height={8} rx={1.5} opacity={0.55} />
          <rect x={6} y={5} width={11} height={9} rx={1.5} className="fl-solid" />
          {/* The pin: pushed into the front window's corner when on, pulled out and gone when off. */}
          <g transform={`translate(${15 + (1 - p) * 4} ${3 - (1 - p) * 5}) rotate(${45 - (1 - p) * 30})`} opacity={clamp}>
            <line x1={0} y1={1} x2={0} y2={5} />
            <rect x={-2.2} y={-3.5} width={4.4} height={4.5} rx={1} className="fl-fill" />
            <line x1={-3.4} y1={1} x2={3.4} y2={1} />
          </g>
        </g>
      )}

      {glyph === "autoShow" && (
        <g>
          {/* The taskbar, and the window rising from it. */}
          <line x1={2.5} y1={17.5} x2={17.5} y2={17.5} opacity={0.55} />
          <rect x={4.5} y={17 - 11 * p} width={11} height={Math.max(0.5, 9 * p)} rx={1.5} className={p > 0.5 ? "fl-solid" : undefined} />
          <path d="M16.5 1.5 l0.7 1.6 1.6 0.7 -1.6 0.7 -0.7 1.6 -0.7 -1.6 -1.6 -0.7 1.6 -0.7z" className="fl-fill" opacity={clamp} transform={`translate(0 ${(1 - p) * 6})`} />
        </g>
      )}

      {glyph === "hideWhenIdle" && (
        <g>
          <rect x={2.5} y={6 + 3 * p} width={11} height={8} rx={1.5} strokeDasharray={p > 0.5 ? "2 1.6" : undefined} opacity={1 - 0.4 * clamp} />
          <path d="M15.5 2.2 a3.4 3.4 0 1 0 3 4.8 a2.7 2.7 0 0 1 -3 -4.8z" className="fl-fill" opacity={clamp} transform={`translate(0 ${(1 - p) * 5})`} />
        </g>
      )}

      {glyph === "subagents" && (
        <g>
          <circle cx={6} cy={6} r={2.4} className="fl-fill" />
          <line x1={6} y1={8.4} x2={6} y2={13.5 - 0 * p} />
          {/* The subagents branch out from the task when on. */}
          <line x1={6} y1={13.5} x2={6 + 7 * clamp} y2={13.5} opacity={clamp} />
          <circle cx={6 + 7.5 * clamp} cy={13.5} r={2 * clamp} className="fl-fill" />
          <circle cx={6} cy={15} r={1.6} opacity={1 - clamp} className="fl-fill" />
        </g>
      )}
    </svg>
  );
}

/** Small line icons for the rest of the pages, in the same style. */
export function Icon({ name }: { name: "settings" | "power" | "opacity" | "look" | "theme" | "size" | "sound" | "info" | "window" | "graph" }) {
  return (
    <svg className="fl-glyph" viewBox="0 0 20 20" width={16} height={16} aria-hidden="true">
      {name === "settings" && (
        <g>
          <circle cx={10} cy={10} r={2.6} />
          <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" />
          <circle cx={10} cy={10} r={5.4} />
        </g>
      )}
      {name === "power" && <path d="M10 2.5v7M6 4.6a6.5 6.5 0 1 0 8 0" />}
      {name === "opacity" && (
        <g>
          <circle cx={10} cy={10} r={7} />
          <path d="M10 3a7 7 0 0 1 0 14z" className="fl-fill" />
        </g>
      )}
      {name === "look" && <path d="M4 16l1-3.5 8.5-8.5 2.5 2.5-8.5 8.5zM11.5 6l2.5 2.5" />}
      {name === "theme" && (
        <g>
          <circle cx={10} cy={10} r={7} />
          <path d="M10 3a7 7 0 0 0 0 14z" className="fl-fill" />
        </g>
      )}
      {name === "size" && <path d="M3.5 8V3.5H8M12 3.5h4.5V8M16.5 12v4.5H12M8 16.5H3.5V12" />}
      {name === "sound" && <path d="M3 8h3l4-3.5v11L6 12H3zM13 7.5a3.5 3.5 0 0 1 0 5M15 5.5a6.5 6.5 0 0 1 0 9" />}
      {name === "info" && (
        <g>
          <circle cx={10} cy={10} r={7.5} />
          <path d="M10 9v5M10 6.2v0.3" />
        </g>
      )}
      {name === "window" && (
        <g>
          <rect x={2.5} y={4} width={15} height={12} rx={2} />
          <path d="M2.5 7.5h15" />
        </g>
      )}
      {name === "graph" && (
        <g>
          <circle cx={4.5} cy={10} r={2} />
          <circle cx={15.5} cy={5} r={2} />
          <circle cx={15.5} cy={15} r={2} />
          <path d="M6.3 9.2l7.4-3.4M6.3 10.8l7.4 3.4" />
        </g>
      )}
    </svg>
  );
}
