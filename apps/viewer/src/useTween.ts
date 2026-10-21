// Moves boxes from where they were drawn to where the new scene puts them,
// in JS rather than CSS: WebKit (the overlay) cannot transition an SVG path's
// `d`, and edges must follow their cards frame by frame.

import { useEffect, useRef, useState } from "react";
import type { Box } from "./geometry.ts";

export const TWEEN_MS = 300;

type Boxes = ReadonlyMap<string, Box>;

function prefersMotion(): boolean {
  if (typeof requestAnimationFrame !== "function" || typeof matchMedia !== "function") return false;
  return !matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function ease(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function lerp(from: Box, to: Box, t: number): Box {
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    w: from.w + (to.w - from.w) * t,
    h: from.h + (to.h - from.h) * t
  };
}

/**
 * The boxes to draw this frame. A box that existed keeps moving from its
 * current drawn place (even mid-animation); a new one appears in place.
 * `instant` draws the target as it is (it already moves every frame, as the
 * idle animation does); the next tween starts from there, over `ms`.
 */
export function useTween(target: Boxes, { instant = false, ms = TWEEN_MS }: { instant?: boolean; ms?: number } = {}): Boxes {
  const [shown, setShown] = useState<Boxes>(target);
  const drawnRef = useRef<Boxes>(target);
  /** Whether the last committed frame drew the target as it was (instant). */
  const wasInstant = useRef(instant);
  useEffect(() => {
    wasInstant.current = instant;
  });

  useEffect(() => {
    if (instant) return;
    const start = drawnRef.current;
    // `shown` is stale after an instant spell: start from where the boxes were drawn.
    setShown(start);
    if (!prefersMotion()) {
      setShown(target);
      return;
    }
    // Timed from the first frame drawn, not from now: a page coming back on
    // screen (the overlay returning from the snail) draws nothing for a while,
    // and the tween would otherwise be over before anyone saw it.
    let began = -1;
    let frame = 0;
    const step = (now: number) => {
      if (began < 0) began = now;
      const t = Math.min(1, (now - began) / ms);
      const k = ease(t);
      const next = new Map<string, Box>();
      target.forEach((to, id) => {
        const from = start.get(id);
        next.set(id, from ? lerp(from, to, k) : to);
      });
      setShown(next);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, instant]);

  // Right after an instant spell, the boxes are where it last drew them, not
  // where the last tween left them (the nodes come home from the snail's shell).
  let drawn: Boxes = instant ? target : wasInstant.current ? drawnRef.current : shown;
  // Boxes added since the last frame show at once; removed ones vanish.
  if (![...target.keys()].every((id) => drawn.has(id)) || drawn.size !== target.size) {
    const merged = new Map<string, Box>();
    target.forEach((to, id) => merged.set(id, drawn.get(id) ?? to));
    drawn = merged;
  }
  drawnRef.current = drawn;
  return drawn;
}
