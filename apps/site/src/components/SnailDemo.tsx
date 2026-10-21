// The snail, live: the app's own snail page (viewer/src/pet) on a strip of
// desktop, running through its day on loop. It walks and leaves its trail,
// takes something out of its shell, works while a sample session works (a
// blue ball that bursts at each step done), celebrates when the session
// finishes, and rattles its shell when the session needs the person. Hover it
// for the session's card. It plays while on screen; under reduced motion it
// stands still.

import { useEffect, useRef, useState } from "react";
import type { Snapshot } from "../../../../mod/graph/types.ts";
import { PetPage } from "../../../viewer/src/pet/PetPage.tsx";
import { createSessionStore } from "../../../viewer/src/store.ts";
import { t, type Key } from "../i18n/index.ts";
import { usePrefersReducedMotion } from "./Demo.tsx";
import { usePrefs } from "./Prefs.tsx";

/** The snail's window, as the app sizes it. */
const WINDOW = { width: 260, height: 230 };
/** Where the snail itself is in its window: hovering there shows the card. */
const BODY = { x: 85, width: 90, height: 62 };
const STEPS: Key[] = ["scene.idle.s1", "scene.idle.s2", "scene.idle.s3", "scene.idle.s4", "scene.idle.s5", "scene.idle.s6"];

/** One loop of its day: [ms from the loop's start, what happens]. */
type Beat = "egg" | "work" | "step" | "finish" | "alert" | "calm";
const DAY: Array<[number, Beat]> = [
  [5000, "egg"],
  [14000, "work"],
  [15800, "step"],
  [17600, "step"],
  [19400, "finish"],
  [24000, "alert"],
  [27500, "calm"]
];
const DAY_MS = 31000;
const EGGS = ["coffee", "flag", "book"];

export function SnailDemo({ label }: { label: string }) {
  const { lang, theme, look } = usePrefs();
  const reduced = usePrefersReducedMotion();
  const [store] = useState(() => createSessionStore());
  const desk = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [onScreen, setOnScreen] = useState(false);

  useEffect(() => {
    const element = desk.current;
    if (!element || typeof IntersectionObserver === "undefined") return setOnScreen(true);
    const observer = new IntersectionObserver(([entry]) => setOnScreen(entry?.isIntersecting ?? false), { threshold: 0.3 });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // The look and the theme follow the page's choices.
  useEffect(() => {
    window.flowctlPet?.setLook(look);
    window.flowctlPet?.setTheme(theme);
  });

  useEffect(() => {
    if (!onScreen) return;
    let left = 0;
    let seq = 1;
    let loop = 0;
    const timers: number[] = [];
    const snapshot = (state: Snapshot["sessionState"], done: number): Snapshot => ({
      schema: 1,
      seq: seq++,
      sessionId: "site",
      cwd: "/work/shop",
      updatedAt: Date.now(),
      sessionState: state,
      planSource: "tasks",
      nodes: STEPS.map((key, i) => ({
        id: `s${i}`,
        kind: "task" as const,
        title: t(lang, key),
        status: i < done ? ("done" as const) : i === done && state === "working" ? ("running" as const) : i === done && state === "waiting_you" ? ("needs_you" as const) : ("pending" as const),
        blockedBy: i ? [`s${i - 1}`] : [],
        ...(i < done ? { finishedAt: Date.now() - (done - i) * 60_000 } : {})
      })),
      layout: { width: 0, height: 0, positions: {} },
      warnings: []
    } as unknown as Snapshot);
    // The page moves the snail's "window" by the steps the snail asks for, as the app does.
    const place = () => {
      const width = desk.current?.clientWidth ?? 600;
      left = Math.max(-WINDOW.width / 2 + 60, Math.min(width - WINDOW.width / 2 - 60, left));
      if (box.current) box.current.style.left = `${left}px`;
      window.flowctlPet?.setRoom(left + WINDOW.width / 2 - 30, width - left - WINDOW.width / 2 - 30);
    };
    window.flowctlNative = {
      postMessage: (message) => {
        if (message.type !== "petMove") return;
        left += message.dx;
        place();
      }
    };
    const start = () => {
      const pet = window.flowctlPet;
      if (!pet) return void timers.push(window.setTimeout(start, 50));
      left = ((desk.current?.clientWidth ?? 600) - WINDOW.width) / 2;
      place();
      pet.setLook(look);
      pet.setTheme(theme);
      store.push(snapshot("idle", 2));
      pet.land();
      if (reduced) return;
      const run = () => {
        let done = 2;
        for (const [at, beat] of DAY) {
          timers.push(
            window.setTimeout(() => {
              if (beat === "egg") pet.playEgg?.(EGGS[loop % EGGS.length]!);
              if (beat === "work") store.push(snapshot("working", (done = 2)));
              if (beat === "step") store.push(snapshot("working", ++done));
              if (beat === "finish") store.push(snapshot("idle", (done = STEPS.length)));
              if (beat === "alert") {
                store.push(snapshot("waiting_you", 3));
                pet.setMood("alert");
              }
              if (beat === "calm") {
                store.push(snapshot("idle", 3));
                pet.setMood("calm");
              }
            }, at)
          );
        }
        timers.push(window.setTimeout(() => { loop++; run(); }, DAY_MS));
      };
      run();
    };
    start();
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      delete window.flowctlNative;
    };
  }, [onScreen, reduced, store, lang]);

  // The mouse, as the app sees it: near the snail it turns to look; on it, the card.
  const hover = useRef(false);
  const onMove = (event: React.PointerEvent) => {
    const pet = window.flowctlPet;
    const area = box.current?.getBoundingClientRect();
    if (!pet || !area) return;
    const x = event.clientX - area.left;
    const fromBottom = area.bottom - event.clientY;
    pet.setMouse(Math.abs(x - WINDOW.width / 2) < 140 && fromBottom < WINDOW.height ? x : null);
    const on = x > BODY.x && x < BODY.x + BODY.width && fromBottom >= 0 && fromBottom < BODY.height;
    if (on !== hover.current) {
      hover.current = on;
      pet.setHover(on);
    }
  };
  const onLeave = () => {
    window.flowctlPet?.setMouse(null);
    if (hover.current) {
      hover.current = false;
      window.flowctlPet?.setHover(false);
    }
  };

  return (
    <div className="snail-desk" ref={desk} role="img" aria-label={label} onPointerMove={onMove} onPointerLeave={onLeave}>
      <div className="snail-dock" />
      <div className="snail-window" ref={box}>
        <PetPage store={store} embedded />
      </div>
    </div>
  );
}
