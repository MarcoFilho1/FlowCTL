// The snail as it forms in the overlay, out of the nodes that flew into its
// shell, and as it melts back into them when the overlay returns. A canvas
// over the graph, at the bottom middle of the view.

import { useEffect, useRef } from "react";
import type { Look } from "../store.ts";
import { FEET_UP, formProgress, FORMED_MS, UNFORM_MS } from "./gather.ts";
import { drawSnail } from "./snail.ts";

export function SnailForm({ active, look, onFormed }: { active: boolean; look: Look; onFormed?: (feet: { x: number; y: number }) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const formed = useRef(onFormed);
  formed.current = onFormed;
  /** When it began to form (active) or to melt (not), and how much of it there was then. */
  const since = useRef<{ at: number; from: number } | null>(null);
  const shown = useRef(0);

  useEffect(() => {
    // Timed from the first frame drawn (see useTween): a panel coming back on screen draws nothing at first.
    since.current = null;
    let told = false;
    let frame = 0;
    const tick = (now: number) => {
      const el = canvas.current;
      since.current ??= { at: now, from: shown.current };
      const begun = since.current;
      const elapsed = now - begun.at;
      shown.current = active ? formProgress(elapsed) : Math.max(0, begun.from * (1 - elapsed / UNFORM_MS));
      if (el) paint(el, look, shown.current, active, now);
      if (active && !told && elapsed >= FORMED_MS && el) {
        told = true;
        const box = el.getBoundingClientRect();
        formed.current?.({ x: box.left + box.width / 2, y: box.bottom - FEET_UP });
      }
      if (active || shown.current > 0) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, look]);

  return <canvas ref={canvas} className="snail-form" aria-hidden="true" />;
}

function paint(el: HTMLCanvasElement, look: Look, shown: number, growing: boolean, now: number) {
  const ratio = window.devicePixelRatio || 1;
  const width = el.clientWidth;
  const height = el.clientHeight;
  if (el.width !== Math.round(width * ratio) || el.height !== Math.round(height * ratio)) {
    el.width = Math.round(width * ratio);
    el.height = Math.round(height * ratio);
  }
  const c = el.getContext("2d");
  if (!c) return;
  c.setTransform(ratio, 0, 0, ratio, 0, 0);
  c.clearRect(0, 0, width, height);
  drawSnail(c, {
    look,
    pose: "look",
    x: width / 2,
    ground: height - FEET_UP,
    dir: 1,
    t: now,
    phase: 0,
    stride: 0,
    walked: 0,
    blink: false,
    shown,
    growing
  });
}
