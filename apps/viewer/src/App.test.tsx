import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import type { GraphNode } from "../../../mod/graph/types.ts";
import { App } from "./App.tsx";
import type { Replay } from "./DevControls.tsx";
import { SCROLL_THRESHOLD } from "./GraphView.tsx";
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

function card(container: HTMLElement, id: string): Element {
  const element = container.querySelector(`[data-node="${id}"]`);
  if (!element) throw new Error(`no card for ${id}`);
  return element;
}

test("waits for a session before drawing", () => {
  mount();
  expect(screen.getByText(/Waiting for a Claude Code session/)).toBeTruthy();
});

test("a session with no nodes yet says so instead of an empty canvas", () => {
  const { container } = mount(snapshotOf([], { sessionState: "idle" }));
  expect(screen.getByText(/Nothing to show yet/)).toBeTruthy();
  expect(container.querySelector("svg")).toBeNull();
});

describe("golden 03: four tasks and three subagents", () => {
  test("draws a card per node with its title and status", () => {
    const snapshot = golden("03-subagents-with-task-graph");
    const { container } = mount(snapshot);
    for (const node of snapshot.nodes) {
      const element = card(container, node.id);
      expect(element.getAttribute("class")).toContain(`status-${node.status}`);
      expect(element.querySelector("title")?.textContent).toContain(node.title);
    }
    expect(container.querySelectorAll("[data-node]")).toHaveLength(7);
  });

  test("frames each subagent with its parent task", () => {
    const { container } = mount(golden("03-subagents-with-task-graph"));
    expect([...container.querySelectorAll("[data-cluster]")].map((el) => el.getAttribute("data-cluster")).sort()).toEqual([
      "task:1",
      "task:2",
      "task:3"
    ]);
    expect(card(container, "agent:a4f0e422ba57dad50").getAttribute("class")).toContain("child");
  });

  test("draws the three dependencies of Consolidar as solid edges", () => {
    const { container } = mount(golden("03-subagents-with-task-graph"));
    const edges = [...container.querySelectorAll("[data-edge]")];
    expect(edges.map((edge) => edge.getAttribute("data-edge")).sort()).toEqual([
      "task:1->task:4",
      "task:2->task:4",
      "task:3->task:4"
    ]);
    expect(edges.every((edge) => !edge.getAttribute("class")?.includes("inferred"))).toBe(true);
  });

  test("the header shows the folder, the session state and the counters", () => {
    mount({ ...golden("03-subagents-with-task-graph"), cwd: "/Users/me/shop" });
    const header = screen.getByRole("banner");
    expect(within(header).getByText("shop")).toBeTruthy();
    expect(within(header).getByText("Idle")).toBeTruthy();
    expect(within(header).getByTitle("Done").textContent).toContain("7");
  });
});

test("a node that needs you pulses and says why", () => {
  const node: GraphNode = task("a", {
    title: "Run migrations",
    status: "needs_you",
    attention: { kind: "permission", detail: "Bash", since: 1 }
  });
  const { container } = mount(snapshotOf([node], { sessionState: "waiting_you" }));
  const element = card(container, "a");
  expect(element.querySelector(".halo")).not.toBeNull();
  expect(element.textContent).toContain("Permission: Bash");
  expect(screen.getByText("Waiting for you")).toBeTruthy();
});

test("a running node shows its activeForm, an errored one its error", () => {
  const { container } = mount(
    snapshotOf([
      task("a", { status: "running", activeForm: "Running tests" }),
      task("b", { status: "error", attention: { kind: "error", detail: "Exit code 1", since: 1 } })
    ])
  );
  expect(card(container, "a").textContent).toContain("Running tests");
  expect(card(container, "b").textContent).toContain("Error: Exit code 1");
});

test("inferred edges are dashed", () => {
  const { container } = mount(
    snapshotOf([task("a"), task("b", { blockedBy: ["a"], inferred: true })], {
      layout: { a: { rank: 0, order: 0 }, b: { rank: 1, order: 0 } }
    })
  );
  expect(container.querySelector('[data-edge="a->b"]')?.getAttribute("class")).toContain("inferred");
});

test("long titles are cut with an ellipsis, the full title stays in the tooltip", () => {
  const title = "Refactor the whole checkout flow into smaller modules with tests";
  const { container } = mount(snapshotOf([task("a", { title })]));
  const element = card(container, "a");
  expect(element.querySelector(".title")?.textContent).toMatch(/…$/);
  expect(element.querySelector("title")?.textContent).toContain(title);
});

test(`fits up to ${SCROLL_THRESHOLD} nodes, scrolls beyond`, () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => task(`t${i}`));
  const { container, store } = mount(snapshotOf(many(SCROLL_THRESHOLD)));
  expect(container.querySelector(".canvas")?.getAttribute("class")).toContain("fits");
  act(() => {
    store.push(snapshotOf(many(SCROLL_THRESHOLD + 1), { seq: 2 }));
  });
  expect(container.querySelector(".canvas")?.getAttribute("class")).toContain("scrolls");
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
  expect(card(container, "a").getAttribute("class")).toContain("status-running");

  act(() => {
    window.flowctl?.push(snapshotOf([task("a", { status: "done" })], { seq: 3 }));
    window.flowctl?.push(snapshotOf([task("a", { status: "pending" })], { seq: 1 }));
  });
  expect(card(container, "a").getAttribute("class")).toContain("status-done");
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
