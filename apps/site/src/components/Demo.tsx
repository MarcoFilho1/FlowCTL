// A live demo: the viewer's own graph, fed by a scene through the store. It plays
// while it is on screen, pauses when it scrolls away, and under reduced motion
// it holds the frame that says the most until the person presses play.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { GraphView } from "../../../viewer/src/GraphView.tsx";
import { createSessionStore } from "../../../viewer/src/store.ts";
import { runScene } from "../engine/run.ts";
import { frameAt, timelineOf } from "../engine/timeline.ts";
import { hoverLabels, t } from "../i18n/index.ts";
import { sceneFor } from "../scenes/index.ts";
import type { SceneId } from "../scenes/types.ts";
import { usePrefs } from "./Prefs.tsx";

/** The project's name, as the overlay's header shows it. */
const PROJECT = "shop";

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

export function SceneDemo({ id, label }: { id: SceneId; label: string }) {
  const { lang, look, sound } = usePrefs();
  const reduced = usePrefersReducedMotion();
  const [ref, visible] = useOnScreen<HTMLDivElement>();
  const store = useMemo(() => createSessionStore(), []);
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const snapshot = state.sessions[0];
  const [playing, setPlaying] = useState(!reduced);
  const [dreaming, setDreaming] = useState(false);
  const [run, setRun] = useState(0);
  const active = playing && visible;

  useEffect(() => {
    const scene = sceneFor(id, lang);
    if (active) {
      return runScene(scene, store, { onDream: setDreaming, onLoop: () => setRun((n) => n + 1) });
    }
    // Paused or off screen: hold the frame that says the most, so the demo still reads.
    const frame = frameAt(timelineOf(scene), scene.still);
    store.forget(scene.sessionId);
    if (frame) store.push(frame.snapshot);
    setDreaming(false);
    return undefined;
  }, [id, lang, active, store]);

  const labels = useMemo(() => hoverLabels(lang), [lang]);
  const plan = snapshot?.nodes.filter((node) => node.kind !== "turn") ?? [];
  const finished = plan.filter((node) => node.status === "done").length;

  return (
    <div className="demo" ref={ref} role="region" aria-label={label}>
      <div className="demo-bar">
        <span className="demo-project">{PROJECT}</span>
        <span className="demo-progress">{`${finished}/${plan.length}`}</span>
        <button type="button" className="demo-toggle" aria-pressed={playing} onClick={() => setPlaying((on) => !on)}>
          {playing ? t(lang, "control.pause") : t(lang, "control.play")}
        </button>
      </div>
      <div className={`demo-screen app overlay look-${look}`}>
        {snapshot && (
          <GraphView key={run} snapshot={snapshot} look={look} sound={sound && active} sounds={look} dreaming={dreaming} labels={labels} />
        )}
      </div>
    </div>
  );
}
