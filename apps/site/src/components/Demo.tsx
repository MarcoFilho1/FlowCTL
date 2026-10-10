// A live demo: the viewer's own graph, fed by a scene through the store. The
// graph is drawn at the overlay's real size (Large 480x300, or Medium 360x220 for
// the floating window) and scaled with CSS to fit its card, so the layout,
// the camera and the text are the ones the overlay has. It plays while on
// screen, pauses when it scrolls away; under reduced motion it holds the frame
// that says the most until the person presses play.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { GraphView } from "../../../viewer/src/GraphView.tsx";
import { createSessionStore } from "../../../viewer/src/store.ts";
import { runScene } from "../engine/run.ts";
import { frameAt, timelineOf } from "../engine/timeline.ts";
import { hoverLabels, t } from "../i18n/index.ts";
import { sceneFor } from "../scenes/index.ts";
import type { SceneId } from "../scenes/types.ts";
import { usePrefs } from "./Prefs.tsx";

/** The overlay's window sizes, in its own points (apps/overlay PanelSize). */
export const SIZES = {
  medium: { width: 360, height: 220 },
  large: { width: 480, height: 300 }
} as const;

/** The project's name, as the overlay's header shows it. */
const PROJECT = "shop";

/** Seconds between the hover demo's pointing, and how long each card stays. */
const TOUR_EVERY_MS = 4200;
const TOUR_HOLD_MS = 2400;

export function usePrefersReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}

function useOnScreen<T extends Element>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => setVisible(entry?.isIntersecting ?? false), { threshold: 0.3 });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, visible];
}

/** The laid-out width of an element (not its scaled one), so the demo can fit it. */
function useWidth<T extends Element>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/**
 * The hover demo: points the mouse at each node of the tour in turn, so its
 * card shows on its own, the way it would if someone hovered there.
 */
function useHoverTour(screen: React.RefObject<HTMLElement | null>, nodes: readonly string[] | undefined, enabled: boolean) {
  useEffect(() => {
    if (!enabled || !nodes || nodes.length === 0) return;
    let step = 0;
    let leave: number | undefined;
    const point = () => {
      const id = nodes[step % nodes.length];
      step += 1;
      const node = id ? screen.current?.querySelector(`[data-node="${id}"]`) : null;
      node?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      leave = window.setTimeout(() => node?.dispatchEvent(new MouseEvent("mouseout", { bubbles: true })), TOUR_HOLD_MS);
    };
    const first = window.setTimeout(point, 1200);
    const every = window.setInterval(point, TOUR_EVERY_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(every);
      window.clearTimeout(leave);
    };
  }, [screen, nodes, enabled]);
}

export function SceneDemo({
  id,
  label,
  variant = "card",
  tour = false
}: {
  id: SceneId;
  label: string;
  /** "card": with its bar and the play button. "float": the bare floating window, always playing. */
  variant?: "card" | "float";
  /** Point the mouse at the scene's hover tour, one node at a time. */
  tour?: boolean;
}) {
  const { lang, look, sound } = usePrefs();
  const reduced = usePrefersReducedMotion();
  const [ref, visible] = useOnScreen<HTMLDivElement>();
  const [screen, screenWidth] = useWidth<HTMLDivElement>();
  const store = useMemo(() => createSessionStore(), []);
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const snapshot = state.sessions[0];
  const scene = useMemo(() => sceneFor(id, lang), [id, lang]);
  const size = variant === "float" ? SIZES.medium : SIZES.large;
  const scale = screenWidth > 0 ? screenWidth / size.width : 1;
  const [playing, setPlaying] = useState(!reduced);
  const [dreaming, setDreaming] = useState(false);
  const [run, setRun] = useState(0);
  const active = playing && visible;

  useEffect(() => {
    if (active) {
      return runScene(scene, store, { onDream: setDreaming, onLoop: () => setRun((n) => n + 1) });
    }
    // Paused or off screen: hold the frame that says the most, so the demo still reads.
    const frame = frameAt(timelineOf(scene), scene.still);
    store.forget(scene.sessionId);
    if (frame) store.push(frame.snapshot);
    setDreaming(false);
    return undefined;
  }, [scene, active, store]);

  useHoverTour(screen, scene.hoverTour, tour && active);

  const labels = useMemo(() => hoverLabels(lang), [lang]);
  const plan = snapshot?.nodes.filter((node) => node.kind !== "turn") ?? [];
  const finished = plan.filter((node) => node.status === "done").length;
  const stageStyle: CSSProperties = { width: size.width, height: size.height, transform: `scale(${scale})` };

  return (
    <div className={`demo demo-${variant}`} ref={ref} role="region" aria-label={label}>
      {variant === "card" && (
        <div className="demo-bar">
          <span className="demo-project">{PROJECT}</span>
          <span className="demo-progress">{`${finished}/${plan.length}`}</span>
          <button type="button" className="demo-toggle" aria-pressed={playing} onClick={() => setPlaying((on) => !on)}>
            {playing ? t(lang, "control.pause") : t(lang, "control.play")}
          </button>
        </div>
      )}
      <div className="demo-screen" ref={screen} style={{ aspectRatio: `${size.width} / ${size.height}` }}>
        <div className={`demo-stage app overlay look-${look}`} style={stageStyle}>
          {snapshot && (
            <GraphView key={run} snapshot={snapshot} look={look} sound={sound && active} sounds={look} dreaming={dreaming} labels={labels} />
          )}
        </div>
      </div>
      {scene.groups && (
        <ul className="groups">
          {scene.groups.map((group) => {
            const nodes = snapshot?.nodes.filter((node) => group.ids.includes(node.id)) ?? [];
            const done = nodes.filter((node) => node.status === "done").length;
            const live = nodes.some((node) => node.status === "running" || node.status === "needs_you");
            const progress = done === group.ids.length ? "done" : live ? "live" : "waiting";
            return (
              <li key={group.label} className={`group group-${progress}`}>
                <span className="group-dot" aria-hidden="true" />
                <span>{t(lang, group.label)}</span>
                <span className="group-count">{`${done}/${group.ids.length}`}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
