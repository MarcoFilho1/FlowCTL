import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { GraphNode } from "../../../mod/graph/types.ts";
import { App } from "./App.tsx";
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
  const { container } = mount(snapshotOf([], { sessionState: "idle" }));
  expect(screen.getByText(/Waiting for the first turn/)).toBeTruthy();
  expect(container.querySelector("svg")).toBeNull();
});

function hover(container: HTMLElement, id: string): HTMLElement {
  fireEvent.mouseEnter(node(container, id));
  return screen.getByRole("tooltip");
}

describe("golden 03: four tasks and three subagents", () => {
  test("draws a circle per node, colored by status, with a short label", () => {
    const snapshot = golden("03-subagents-with-task-graph");
    const { container } = mount(snapshot);
    for (const graphNode of snapshot.nodes) {
      const element = node(container, graphNode.id);
      expect(element.getAttribute("class")).toContain(`status-${graphNode.status}`);
      expect(element.querySelector("circle.dot")).not.toBeNull();
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
  expect(node(container, "a").querySelector(".pulse")).not.toBeNull();
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

test("long titles are cut with an ellipsis; the card has the full title", () => {
  const title = "Refactor the whole checkout flow into smaller modules with tests";
  const { container } = mount(snapshotOf([task("a", { title })]));
  expect(node(container, "a").querySelector(".label")?.textContent).toMatch(/…$/);
  expect(hover(container, "a").textContent).toContain(title);
});

describe("talking to the overlay app", () => {
  const messages: unknown[] = [];
  beforeEach(() => {
    messages.length = 0;
    window.webkit = { messageHandlers: { flowctl: { postMessage: (message) => void messages.push(message) } } };
  });
  afterEach(() => {
    delete window.webkit;
  });

  test("asks for a small window for a small graph, and more as it grows", () => {
    const { store } = mount(snapshotOf([task("a")]));
    const first = messages.filter((m): m is { type: "size"; width: number; height: number } => (m as { type: string }).type === "size").at(-1);
    expect(first!.width).toBeLessThan(150);
    expect(first!.height).toBeLessThan(90);
    act(() => {
      store.push(
        snapshotOf([task("a"), task("b", { blockedBy: ["a"] }), task("c", { blockedBy: ["a"] }), task("d", { blockedBy: ["b", "c"] })], {
          seq: 2,
          layout: { a: { rank: 0, order: 0 }, b: { rank: 1, order: 0 }, c: { rank: 1, order: 1 }, d: { rank: 2, order: 0 } }
        })
      );
    });
    const grown = messages.filter((m): m is { type: "size"; width: number; height: number } => (m as { type: string }).type === "size").at(-1);
    expect(grown!.width).toBeGreaterThan(first!.width);
    expect(grown!.height).toBeGreaterThan(first!.height);
  });

  test("clicking a node asks to bring its session forward", () => {
    const { container } = mount(snapshotOf([task("a")], { sessionId: "s9" }));
    fireEvent.click(node(container, "a"));
    expect(messages).toContainEqual({ type: "focus", sessionId: "s9", nodeId: "a" });
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
