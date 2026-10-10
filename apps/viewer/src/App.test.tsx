import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { GraphNode } from "../../../mod/graph/types.ts";
import { App } from "./App.tsx";
import { EFFECT_MS, ZOOM_ARM_MS, zoomStep } from "./GraphView.tsx";
import { DREAM_AFTER_MS } from "./dream.ts";
import type { Replay } from "./DevControls.tsx";
import { agent, golden, snapshotOf, task } from "./goldens.ts";
import { loadFixture, replaySnapshots } from "./player.ts";
import { createSessionStore, installBridge } from "./store.ts";

afterEach(cleanup);

function mount(...snapshots: unknown[]) {
  const store = createSessionStore();
  snapshots.forEach((snapshot) => store.push(snapshot));
  const view = render(<App store={store} />);
  return { store, ...view };
}

/** Rests the pointer on the window long enough for scroll to zoom. */
function arm(canvas: Element): void {
  const now = Date.now();
  const spy = vi.spyOn(Date, "now").mockReturnValue(now - ZOOM_ARM_MS - 1);
  fireEvent.mouseEnter(canvas);
  spy.mockRestore();
}

function node(container: HTMLElement, id: string): Element {
  const element = container.querySelector(`[data-node="${id}"]`);
  if (!element) throw new Error(`no node for ${id}`);
  return element;
}

test("waits for a session before drawing", () => {
  mount();
  expect(screen.getByText(/Waiting for a Claude Code session/)).toBeTruthy();
});

test("a session with no nodes yet says so instead of an empty canvas", () => {
  const { container } = mount(snapshotOf([], { sessionState: "working" }));
  expect(screen.getByText(/Waiting for the first turn/)).toBeTruthy();
  expect(container.querySelector("svg")).toBeNull();
});

function hover(container: HTMLElement, id: string): HTMLElement {
  fireEvent.mouseEnter(node(container, id));
  return screen.getByRole("tooltip");
}

describe("golden 03: four tasks and three subagents", () => {
  test("draws a pixel sprite per node, colored by status", () => {
    const snapshot = golden("03-subagents-with-task-graph");
    const { container } = mount(snapshot);
    for (const graphNode of snapshot.nodes) {
      const element = node(container, graphNode.id);
      expect(element.getAttribute("class")).toContain(`status-${graphNode.status}`);
      expect(element.querySelector(".px-body")).not.toBeNull();
      expect(element.getAttribute("aria-label")).toContain(graphNode.title);
    }
    expect(container.querySelectorAll("[data-node]")).toHaveLength(7);
    expect(container.querySelector("rect.card-bg")).toBeNull();
  });

  test("subagents hang off their task as satellites", () => {
    const { container } = mount(golden("03-subagents-with-task-graph"));
    expect(node(container, "agent:a4f0e422ba57dad50").getAttribute("class")).toContain("satellite");
    expect(container.querySelectorAll(".link-agent")).toHaveLength(3);
  });

  test("draws the three dependencies of Consolidar as solid arrows", () => {
    const { container } = mount(golden("03-subagents-with-task-graph"));
    const links = [...container.querySelectorAll(".link-dependency")];
    expect(links.map((link) => link.getAttribute("data-link")).sort()).toEqual([
      "task:1->task:4",
      "task:2->task:4",
      "task:3->task:4"
    ]);
    expect(links.every((link) => !link.getAttribute("class")?.includes("inferred"))).toBe(true);
  });

  test("the header is one line: folder, state and progress", () => {
    mount({ ...golden("03-subagents-with-task-graph"), cwd: "/Users/me/shop" });
    const header = screen.getByRole("banner");
    expect(within(header).getByText("shop")).toBeTruthy();
    expect(within(header).getByText("Ended")).toBeTruthy();
    expect(within(header).getByText("7/7")).toBeTruthy();
  });

  test("hovering a finished subagent shows what came of it", () => {
    const { container } = mount(golden("03-subagents-with-task-graph"));
    const card = hover(container, "agent:a4f0e422ba57dad50");
    expect(card.textContent).toContain("Revisar módulo cart");
    expect(card.textContent).toMatch(/Subagent done in \d+s/);
  });
});

test("a node that needs you pulses, and its card says why", () => {
  const graphNode: GraphNode = task("a", {
    title: "Run migrations",
    status: "needs_you",
    attention: { kind: "permission", detail: "Bash", reason: "Bash: Apply the schema", since: 1 }
  });
  const { container } = mount(snapshotOf([graphNode], { sessionState: "waiting_you" }));
  expect(node(container, "a").querySelector(".bang")).not.toBeNull();
  expect(screen.getByText("1 waiting")).toBeTruthy();
  const card = hover(container, "a");
  expect(card.textContent).toContain("Needs your permission");
  expect(card.textContent).toContain("Bash: Apply the schema");
  fireEvent.mouseLeave(node(container, "a"));
  expect(screen.queryByRole("tooltip")).toBeNull();
});

test("a running node's card shows its activeForm, an errored one its error", () => {
  const { container } = mount(
    snapshotOf([
      task("a", { status: "running", activeForm: "Running tests" }),
      task("b", { status: "error", attention: { kind: "error", detail: "Exit code 1", since: 1 } })
    ])
  );
  expect(hover(container, "a").textContent).toContain("Running tests");
  fireEvent.mouseLeave(node(container, "a"));
  expect(hover(container, "b").textContent).toContain("Exit code 1");
});

test("inferred dependencies are dashed", () => {
  const { container } = mount(
    snapshotOf([task("a"), task("b", { blockedBy: ["a"], inferred: true })], {
      layout: { a: { rank: 0, order: 0 }, b: { rank: 1, order: 0 } }
    })
  );
  expect(container.querySelector('[data-link="a->b"]')?.getAttribute("class")).toContain("inferred");
});

test("nodes carry no label: the title lives in the hover card", () => {
  const title = "Refactor the whole checkout flow into smaller modules with tests";
  const { container } = mount(snapshotOf([task("a", { title })]));
  expect(node(container, "a").querySelector("text")).toBeNull();
  expect(hover(container, "a").textContent).toContain(title);
});

describe("moving around the graph", () => {
  const messages: unknown[] = [];
  beforeEach(() => {
    messages.length = 0;
    window.webkit = { messageHandlers: { flowctl: { postMessage: (message) => void messages.push(message) } } };
  });
  afterEach(() => {
    delete window.webkit;
  });

  const canvas = (container: HTMLElement) => container.querySelector(".canvas") as HTMLElement;
  const panOf = (container: HTMLElement) => canvas(container).getAttribute("data-pan");
  const wide = () =>
    snapshotOf(
      Array.from({ length: 12 }, (_, i) => task(`t${i}`, { blockedBy: i > 0 ? [`t${i - 1}`] : [] })),
      { layout: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`t${i}`, { rank: i, order: 0 }])) }
    );

  test("a click on a node, without moving, brings its session forward", () => {
    const { container } = mount(snapshotOf([task("a")], { sessionId: "s9" }));
    fireEvent.pointerDown(node(container, "a"), { button: 0, clientX: 50, clientY: 50, pointerId: 1 });
    fireEvent.pointerUp(canvas(container), { clientX: 51, clientY: 50, pointerId: 1 });
    expect(messages).toContainEqual({ type: "focus", sessionId: "s9", nodeId: "a" });
  });

  test("dragging moves the view and is not a click", () => {
    const { container } = mount(wide());
    const before = panOf(container);
    fireEvent.pointerDown(node(container, "t11"), { button: 0, clientX: 200, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(canvas(container), { clientX: 260, clientY: 110, pointerId: 1 });
    fireEvent.pointerUp(canvas(container), { clientX: 260, clientY: 110, pointerId: 1 });
    const [bx, by] = (before ?? "0,0").split(",").map(Number);
    expect(panOf(container)).toBe(`${(bx ?? 0) + 60},${(by ?? 0) + 10}`);
    expect(messages.some((m) => (m as { type: string }).type === "focus")).toBe(false);
  });

  test("scrolling zooms while the session works too (drag is what moves)", () => {
    const { container } = mount(wide());
    const before = Number(canvas(container).getAttribute("data-scale"));
    arm(canvas(container));
    fireEvent.wheel(canvas(container), { deltaY: 100, clientX: 100, clientY: 100 });
    expect(Number(canvas(container).getAttribute("data-scale"))).toBe(before - 0.25);
  });

  test("a wide graph opens on the node that matters, not at its start", () => {
    const snapshot = wide();
    snapshot.nodes[10] = { ...snapshot.nodes[10]!, status: "needs_you" };
    const { container } = mount(snapshot);
    // The needs-you node (column 10) is pulled toward the middle of the 360 px window.
    expect(Number(panOf(container)?.split(",")[0])).toBeLessThan(-400);
  });

  test("a node that needs you out of sight shows a beacon on the edge", () => {
    const snapshot = wide();
    snapshot.nodes[0] = { ...snapshot.nodes[0]!, status: "error", attention: { kind: "error", detail: "Exit code 1", since: 0 } };
    snapshot.nodes[11] = { ...snapshot.nodes[11]!, status: "needs_you" };
    const { container } = mount(snapshot);
    expect(container.querySelector('[data-beacon="t0"]')).not.toBeNull();
    expect(container.querySelector('[data-beacon="t11"]')).toBeNull();
  });
});

test("several sessions get a pager, ‹ 1/2 ›, that steps through their graphs", () => {
  const { container } = mount(
    snapshotOf([task("a")], { sessionId: "s1", cwd: "/w/api" }),
    snapshotOf([task("b"), agent("agent:x", "b")], { sessionId: "s2", cwd: "/w/web" })
  );
  const pager = screen.getByRole("navigation", { name: "Sessions" });
  expect(within(pager).getByText("1/2")).toBeTruthy();
  expect(screen.queryAllByRole("tab")).toHaveLength(0);
  expect(container.querySelector('[data-node="a"]')).not.toBeNull();

  fireEvent.click(within(pager).getByLabelText("Next session: web"));
  expect(within(pager).getByText("2/2")).toBeTruthy();
  expect(container.querySelector('[data-node="a"]')).toBeNull();
  expect(container.querySelector('[data-node="agent:x"]')).not.toBeNull();
  expect(screen.getByRole("banner").textContent).toContain("web");

  // It wraps around.
  fireEvent.click(within(pager).getByLabelText("Next session: api"));
  expect(within(pager).getByText("1/2")).toBeTruthy();
});

test("the pager marks another session that needs the person", () => {
  mount(
    snapshotOf([task("a", { status: "running" })], { sessionId: "s1", cwd: "/w/api" }),
    snapshotOf([task("b", { status: "needs_you" })], { sessionId: "s2", cwd: "/w/web", sessionState: "waiting_you" })
  );
  expect(screen.getByLabelText("Another session needs you")).toBeTruthy();
});

test("graph warnings stay out of the overlay's header", () => {
  mount(snapshotOf([task("a")], { warnings: ["dependency cycle: ignored a → b"] }));
  expect(screen.getByRole("banner").textContent).not.toContain("⚠");
});

test("window.flowctl.push redraws, and an older seq is ignored", () => {
  const store = createSessionStore();
  installBridge(store);
  const { container } = render(<App store={store} />);

  act(() => {
    window.flowctl?.push(snapshotOf([task("a", { status: "running" })], { seq: 2 }));
  });
  expect(node(container, "a").getAttribute("class")).toContain("status-running");

  act(() => {
    window.flowctl?.push(snapshotOf([task("a", { status: "done" })], { seq: 3 }));
    window.flowctl?.push(snapshotOf([task("a", { status: "pending" })], { seq: 1 }));
  });
  expect(node(container, "a").getAttribute("class")).toContain("status-done");
});

describe("fixture player", () => {
  const name = "04-permission-approved-then-denied";
  const events = loadFixture(name) ?? [];
  const replays: Replay[] = [{ name, events, snapshots: replaySnapshots(events, name) }];

  test("opens where asked, paused, and steps one event at a time", () => {
    const store = createSessionStore();
    render(<App store={store} replays={replays} startAt={8} />);
    expect(screen.getByText(`8/${events.length}`)).toBeTruthy();
    expect(screen.getByText("Waiting for you")).toBeTruthy();

    fireEvent.click(screen.getByTitle("Next event"));
    expect(screen.getByText(`9/${events.length}`)).toBeTruthy();
    expect(store.getState().sessions[0]?.seq).toBe(9);
  });

  test("restart starts the session over from its first event", () => {
    const store = createSessionStore();
    render(<App store={store} replays={replays} startAt="end" />);
    expect(store.getState().sessions[0]?.seq).toBe(events.length);
    fireEvent.click(screen.getByTitle("Restart"));
    expect(store.getState().sessions[0]?.seq).toBe(1);
  });
});

test("window.flowctl.remove drops an expired session without a reload", () => {
  const store = createSessionStore();
  installBridge(store);
  render(<App store={store} />);
  act(() => {
    window.flowctl?.push(snapshotOf([task("a")], { sessionId: "s1", cwd: "/w/api" }));
    window.flowctl?.push(snapshotOf([task("b")], { sessionId: "s2", cwd: "/w/web" }));
  });
  expect(screen.getByText("1/2")).toBeTruthy();
  act(() => window.flowctl?.remove("s1"));
  expect(screen.queryByRole("navigation", { name: "Sessions" })).toBeNull();
  expect(store.getState().sessions.map((session) => session.sessionId)).toEqual(["s2"]);
});


test("a session with nothing drawn and nothing going on is left out of the pager", () => {
  mount(
    snapshotOf([task("a")], { sessionId: "s1", cwd: "/w/api" }),
    snapshotOf([], { sessionId: "s2", cwd: "/w/stale", sessionState: "idle" })
  );
  expect(screen.queryByRole("navigation", { name: "Sessions" })).toBeNull();
  expect(screen.queryByText("stale")).toBeNull();
});

describe("looks", () => {
  test("pixel art by default: sprites, stepped edges, crisp rendering", () => {
    const { container } = mount(
      snapshotOf([task("a", { status: "running" }), task("b", { blockedBy: ["a"] })], {
        layout: { a: { rank: 0, order: 0 }, b: { rank: 1, order: 0 } }
      })
    );
    expect(container.querySelector("main")?.className).toContain("look-pixel");
    expect(container.querySelector("svg")?.getAttribute("shape-rendering")).toBe("crispEdges");
    expect(node(container, "a").querySelectorAll(".chaser")).toHaveLength(8);
    expect(container.querySelector('[data-link="a->b"]')?.getAttribute("d")).toMatch(/^M [\d.]+ [\d.]+ H/);
  });

  test("the overlay can switch to the smooth look", () => {
    const store = createSessionStore();
    installBridge(store);
    const { container } = render(<App store={store} />);
    act(() => {
      window.flowctl?.push(snapshotOf([task("a", { status: "needs_you" })], { sessionState: "waiting_you" }));
      window.flowctl?.setLook("smooth");
    });
    expect(container.querySelector("main")?.className).toContain("look-smooth");
    expect(node(container, "a").querySelector("circle.dot")).not.toBeNull();
    expect(node(container, "a").querySelector(".pulse")).not.toBeNull();
    expect(container.querySelector("svg")?.getAttribute("shape-rendering")).toBeNull();
  });

  test("the chosen theme lands on the root; auto leaves it to macOS", () => {
    const store = createSessionStore();
    installBridge(store);
    const { container } = render(<App store={store} />);
    act(() => window.flowctl?.push(snapshotOf([task("a", { status: "running" })])));
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    act(() => window.flowctl?.setTheme("dark"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    act(() => window.flowctl?.setTheme("auto"));
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    // The graph's marks sit in the outlined layer, outside the camera.
    expect(container.querySelector(".ink [data-node='a']")).not.toBeNull();
  });
});

describe("transitions and the camera", () => {
  const steps = (a: string, b: string, state: "working" | "idle" = "working", seq = 1) =>
    snapshotOf([task("a", { status: a as never }), task("b", { status: b as never, blockedBy: ["a"] })], {
      seq,
      sessionState: state,
      layout: { a: { rank: 0, order: 0 }, b: { rank: 1, order: 0 } }
    });

  test("a finished step bursts and hands off to the next, then the effects clear", () => {
    vi.useFakeTimers();
    try {
      const { container, store } = mount(steps("running", "pending"));
      expect(container.querySelector(".burst-px")).toBeNull();
      act(() => {
        store.push(steps("done", "running", "working", 2));
      });
      expect(container.querySelector(".burst-px")).not.toBeNull();
      expect(container.querySelectorAll(".packet")).toHaveLength(1);
      expect(container.querySelector(".packet animateMotion")?.getAttribute("path")).toMatch(/^M /);
      act(() => {
        vi.advanceTimersByTime(EFFECT_MS + 10);
      });
      expect(container.querySelector(".burst-px")).toBeNull();
      expect(container.querySelector(".packet")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  test("a new error flashes the node red, then it carries on in its own color", () => {
    vi.useFakeTimers();
    try {
      const running = (seq: number, error?: number) =>
        snapshotOf([task("a", { status: "running", ...(error ? { lastError: { detail: "Exit code 1", at: error } } : {}) })], { seq, updatedAt: 9000 });
      const { container, store } = mount(running(1));
      act(() => {
        store.push(running(2, 5000));
      });
      expect(container.querySelector('.flashing [data-node="a"]')).not.toBeNull();
      expect(node(container, "a").getAttribute("class")).toContain("status-running");
      act(() => {
        vi.advanceTimersByTime(EFFECT_MS + 10);
      });
      expect(container.querySelector(".flashing")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
    const { container } = mount(snapshotOf([task("b", { status: "running", lastError: { detail: "Exit code 1", at: 1000 } })], { updatedAt: 13000 }));
    expect(hover(container, "b").textContent).toContain("Last error 12s ago: Exit code 1");
  });

  test("a new request's first step is linked to the last request's ends by a dashed arrow", () => {
    const { container } = mount(
      snapshotOf([task("a", { status: "done" }), task("b", { after: ["a"] })], { layout: { a: { rank: 0, order: 0 }, b: { rank: 1, order: 0 } } })
    );
    const link = container.querySelector('[data-link="a->b"]');
    expect(link?.getAttribute("class")).toContain("link-sequence");
    expect(link?.getAttribute("marker-end")).toBe("url(#arrow)");
  });

  test("a node that appears materializes, and the edge into it draws itself", () => {
    vi.useFakeTimers();
    try {
      const one = snapshotOf([task("a", { status: "running" })], { seq: 1, layout: { a: { rank: 0, order: 0 } } });
      const two = snapshotOf([task("a", { status: "running" }), task("b", { blockedBy: ["a"] })], {
        seq: 2,
        layout: { a: { rank: 0, order: 0 }, b: { rank: 1, order: 0 } }
      });
      const { container, store } = mount(one);
      expect(container.querySelector(".entering")).toBeNull();
      act(() => {
        store.push(two);
      });
      expect(container.querySelector('.entering [data-node="b"]')).not.toBeNull();
      expect(container.querySelector('.entering [data-node="a"]')).toBeNull();
      expect(container.querySelector('[data-link="a->b"]')?.getAttribute("class")).toContain("entering");
      expect(container.querySelector(".converge-px")).not.toBeNull();
      act(() => {
        vi.advanceTimersByTime(EFFECT_MS + 10);
      });
      expect(container.querySelector(".entering")).toBeNull();
      expect(container.querySelector('[data-node="b"]')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  test("while the session works the camera follows; at rest it shows the whole graph", () => {
    const wide = (state: "working" | "idle", seq: number) =>
      snapshotOf(
        Array.from({ length: 12 }, (_, i) => task(`t${i}`, { blockedBy: i > 0 ? [`t${i - 1}`] : [], status: i < 6 ? "done" : i === 6 ? "running" : "pending" })),
        { seq, sessionState: state, layout: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`t${i}`, { rank: i, order: 0 }])) }
      );
    const { container, store } = mount(wide("working", 1));
    const canvas = container.querySelector(".canvas")!;
    expect(canvas.getAttribute("data-mode")).toBe("follow");
    expect(canvas.getAttribute("data-scale")).toBe("1");
    act(() => {
      store.push(wide("idle", 2));
    });
    expect(canvas.getAttribute("data-mode")).toBe("overview");
    expect(Number(canvas.getAttribute("data-scale"))).toBeLessThan(1);
  });
});

describe("subagents can be hidden", () => {
  test("shown by default under their tasks", () => {
    const { container } = mount(golden("03-subagents-with-task-graph"));
    expect(container.querySelectorAll(".node.kind-agent")).toHaveLength(3);
    expect(container.querySelectorAll(".link-agent")).toHaveLength(3);
  });

  test("the overlay can hide them: nodes, links and counts go", () => {
    const store = createSessionStore();
    installBridge(store);
    const { container } = render(<App store={store} />);
    act(() => {
      window.flowctl?.push({ ...golden("03-subagents-with-task-graph"), cwd: "/w/shop" });
      window.flowctl?.setShowSubagents(false);
    });
    expect(container.querySelectorAll(".node.kind-agent")).toHaveLength(0);
    expect(container.querySelectorAll(".link-agent")).toHaveLength(0);
    expect(container.querySelectorAll(".node")).toHaveLength(4);
    expect(within(screen.getByRole("banner")).getByText("4/4")).toBeTruthy();
    act(() => window.flowctl?.setShowSubagents(true));
    expect(container.querySelectorAll(".node.kind-agent")).toHaveLength(3);
  });
});

describe("arrows and zoom", () => {
  const chain = (state: "working" | "idle", running: number, seq = 1) =>
    snapshotOf(
      Array.from({ length: 6 }, (_, i) =>
        task(`t${i}`, { blockedBy: i > 0 ? [`t${i - 1}`] : [], status: i < running ? "done" : i === running ? "running" : "pending" })
      ),
      { seq, sessionState: state, layout: Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`t${i}`, { rank: i, order: 0 }])) }
    );

  test("the edge into the running step is blue with a packet travelling it, and a blue arrowhead", () => {
    const { container } = mount(chain("working", 2));
    const live = container.querySelector('[data-link="t1->t2"]');
    expect(live?.getAttribute("class")).toContain("live");
    expect(live?.getAttribute("marker-end")).toBe("url(#arrow-live)");
    expect(live?.parentElement?.querySelector(".flow animateMotion")?.getAttribute("repeatCount")).toBe("indefinite");
    expect(container.querySelector('[data-link="t0->t1"]')?.getAttribute("marker-end")).toBe("url(#arrow)");
    expect(container.querySelectorAll(".flow")).toHaveLength(1);
  });

  test("scrolling zooms around the cursor; at rest the zoom holds until the session works again", () => {
    const { container, store } = mount(chain("working", 2));
    expect(screen.queryByLabelText("Zoom in")).toBeNull();
    act(() => {
      store.push(chain("idle", 6, 2));
    });
    const canvas = container.querySelector(".canvas")!;
    const before = Number(canvas.getAttribute("data-scale"));
    arm(canvas);
    fireEvent.wheel(canvas, { deltaY: -100, clientX: 100, clientY: 100 });
    const zoomed = Number(canvas.getAttribute("data-scale"));
    expect(zoomed).toBe(before + 0.25);
    act(() => {
      store.push(chain("idle", 6, 3));
    });
    expect(Number(canvas.getAttribute("data-scale"))).toBe(zoomed);
    act(() => {
      store.push(chain("working", 3, 4));
    });
    expect(canvas.getAttribute("data-mode")).toBe("follow");
  });

  test("small trackpad scrolls add up to one step instead of jittering", () => {
    const { container } = mount(chain("idle", 6));
    const canvas = container.querySelector(".canvas")!;
    const before = Number(canvas.getAttribute("data-scale"));
    arm(canvas);
    for (let i = 0; i < 4; i += 1) fireEvent.wheel(canvas, { deltaY: -10 });
    expect(Number(canvas.getAttribute("data-scale"))).toBe(before);
    for (let i = 0; i < 2; i += 1) fireEvent.wheel(canvas, { deltaY: -10 });
    expect(Number(canvas.getAttribute("data-scale"))).toBe(before + 0.25);
    fireEvent.wheel(canvas, { deltaY: 120 });
    expect(Number(canvas.getAttribute("data-scale"))).toBe(before);
  });
});

test("zoom steps stay on quarter steps for pixels, within half and double size", () => {
  expect(zoomStep(0.75, 1, true)).toBe(1);
  expect(zoomStep(0.5, -1, true)).toBe(0.5);
  expect(zoomStep(2, 1, true)).toBe(2);
  expect(zoomStep(1, 1, false)).toBeCloseTo(1.25);
});

describe("the top bar", () => {
  const messages: unknown[] = [];
  beforeEach(() => {
    messages.length = 0;
    window.webkit = { messageHandlers: { flowctl: { postMessage: (message) => void messages.push(message) } } };
  });
  afterEach(() => {
    delete window.webkit;
  });

  test("the whole bar but the pager and the × drags the window, and the overlay is told where", () => {
    const { container } = mount(snapshotOf([task("a")], { sessionId: "s1", cwd: "/w/api" }), snapshotOf([task("b")], { sessionId: "s2", cwd: "/w/web" }));
    const bar = container.querySelector(".topbar")!;
    expect([...bar.children].map((child) => child.className)).toEqual(["drag-zone", "pager", "close"]);
    expect([...bar.querySelector(".drag-zone")!.children].map((child) => child.className)).toEqual(["header", "grip"]);
    expect(messages.some((message) => (message as { type: string }).type === "grip")).toBe(true);
  });

  test("the × asks the overlay to close", () => {
    mount(snapshotOf([task("a")]));
    fireEvent.click(screen.getByLabelText("Close the overlay"));
    expect(messages).toContainEqual({ type: "close" });
  });
});

test("scroll does not zoom until the pointer has rested on the window for 400 ms", () => {
  const { container } = mount(snapshotOf([task("a"), task("b", { blockedBy: ["a"] })], { sessionState: "idle", layout: { a: { rank: 0, order: 0 }, b: { rank: 1, order: 0 } } }));
  const canvas = container.querySelector(".canvas")!;
  const before = canvas.getAttribute("data-scale");
  // Passing by while scrolling something else: no zoom.
  fireEvent.mouseEnter(canvas);
  fireEvent.wheel(canvas, { deltaY: -100 });
  expect(canvas.getAttribute("data-scale")).toBe(before);
  // Resting there: zoom.
  arm(canvas);
  fireEvent.wheel(canvas, { deltaY: -100 });
  expect(canvas.getAttribute("data-scale")).not.toBe(before);
});

describe("the idle animation", () => {
  const graph = (state: "working" | "idle") =>
    snapshotOf([task("a", { status: "done" }), task("b", { status: "done", blockedBy: ["a"] }), task("c", { status: "done", blockedBy: ["b"] })], {
      sessionState: state,
      layout: { a: { rank: 0, order: 0 }, b: { rank: 1, order: 0 }, c: { rank: 2, order: 0 } }
    });
  const place = (container: HTMLElement, id: string) => node(container, id).innerHTML;
  const canvas = (container: HTMLElement) => container.querySelector("[data-mode]")!;

  test("a minute with nothing working forms a shape; a working session brings the graph back", () => {
    vi.useFakeTimers();
    try {
      const store = createSessionStore();
      store.push(graph("idle"));
      const { container } = render(<App store={store} />);
      const before = place(container, "c");
      act(() => vi.advanceTimersByTime(DREAM_AFTER_MS - 10));
      expect(canvas(container).getAttribute("data-mode")).toBe("overview");
      act(() => vi.advanceTimersByTime(20));
      expect(canvas(container).getAttribute("data-mode")).toBe("dream");
      expect(container.querySelector("svg.dreaming")).not.toBeNull();
      expect(place(container, "c")).not.toBe(before);
      act(() => void store.push({ ...graph("working"), seq: 2 }));
      expect(canvas(container).getAttribute("data-mode")).toBe("follow");
      expect(container.querySelector("svg.dreaming")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  test("hovering a node in the shape shows its card", () => {
    vi.useFakeTimers();
    try {
      const store = createSessionStore();
      store.push(graph("idle"));
      const { container } = render(<App store={store} />);
      act(() => vi.advanceTimersByTime(DREAM_AFTER_MS + 10));
      expect(canvas(container).getAttribute("data-mode")).toBe("dream");
      expect(hover(container, "c")).not.toBeNull();
      fireEvent.mouseLeave(node(container, "c"));
      expect(screen.queryByRole("tooltip")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  test("the overlay can turn it off", () => {
    vi.useFakeTimers();
    try {
      const store = createSessionStore();
      installBridge(store);
      store.push(graph("idle"));
      const { container } = render(<App store={store} />);
      act(() => window.flowctl?.setIdleAnimation(false));
      act(() => vi.advanceTimersByTime(DREAM_AFTER_MS * 2));
      expect(canvas(container).getAttribute("data-mode")).toBe("overview");
    } finally {
      vi.useRealTimers();
    }
  });
});
