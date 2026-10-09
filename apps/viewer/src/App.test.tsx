import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { GraphNode } from "../../../mod/graph/types.ts";
import { App } from "./App.tsx";
import { EFFECT_MS } from "./GraphView.tsx";
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
    expect(within(header).getByText("Idle")).toBeTruthy();
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

  test("scrolling moves the view too", () => {
    const { container } = mount(wide());
    const [bx] = (panOf(container) ?? "0,0").split(",").map(Number);
    fireEvent.wheel(canvas(container), { deltaX: 40, deltaY: 0 });
    expect(Number(panOf(container)?.split(",")[0])).toBe((bx ?? 0) - 40);
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

test("several sessions become tabs; a tab shows its own graph", () => {
  const { container } = mount(
    snapshotOf([task("a")], { sessionId: "s1", cwd: "/w/api" }),
    snapshotOf([task("b"), agent("agent:x", "b")], { sessionId: "s2", cwd: "/w/web", sessionState: "waiting_you" })
  );
  const tabs = screen.getAllByRole("tab");
  expect(tabs.map((tab) => tab.textContent)).toEqual(["api", "web"]);
  expect(tabs[1]?.getAttribute("class")).toContain("waiting");
  expect(container.querySelector('[data-node="a"]')).not.toBeNull();

  fireEvent.click(tabs[1] as HTMLElement);
  expect(container.querySelector('[data-node="a"]')).toBeNull();
  expect(container.querySelector('[data-node="agent:x"]')).not.toBeNull();
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

test("window.flowctl.remove drops an expired session's tab without a reload", () => {
  const store = createSessionStore();
  installBridge(store);
  render(<App store={store} />);
  act(() => {
    window.flowctl?.push(snapshotOf([task("a")], { sessionId: "s1", cwd: "/w/api" }));
    window.flowctl?.push(snapshotOf([task("b")], { sessionId: "s2", cwd: "/w/web" }));
  });
  expect(screen.getAllByRole("tab")).toHaveLength(2);
  act(() => window.flowctl?.remove("s1"));
  expect(screen.queryAllByRole("tab")).toHaveLength(0);
  expect(store.getState().sessions.map((session) => session.sessionId)).toEqual(["s2"]);
});


test("a session with nothing drawn and nothing going on gets no tab", () => {
  mount(
    snapshotOf([task("a")], { sessionId: "s1", cwd: "/w/api" }),
    snapshotOf([], { sessionId: "s2", cwd: "/w/stale", sessionState: "idle" })
  );
  expect(screen.queryAllByRole("tab")).toHaveLength(0);
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
