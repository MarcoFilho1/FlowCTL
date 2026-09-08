import { fireEvent, render, screen } from "@testing-library/react";
import { selectReadyTaskIds } from "@flowctl/control-plane";
import { PROTOCOL_VERSION } from "@flowctl/protocol";
import { App } from "../src/App.js";

test("renders the dependency graph with accessible task nodes and visible statuses", () => {
  render(<App />);

  expect(screen.getByRole("heading", { name: "FlowCTL Playground" })).toBeTruthy();
  for (const taskId of ["A", "B", "C", "D"]) {
    const node = screen.getByRole("button", { name: new RegExp(`Task ${taskId}`) });
    expect(node.tabIndex).toBe(0);
  }

  expect(screen.getByText("Ready")).toBeTruthy();
  expect(screen.getAllByText("Pending")).toHaveLength(3);
  expect(screen.getByLabelText("Dependency A → B")).toBeTruthy();
  expect(screen.getByLabelText("Dependency A → C")).toBeTruthy();
  expect(screen.getByLabelText("Dependency B → D")).toBeTruthy();
  expect(screen.getByLabelText("Dependency C → D")).toBeTruthy();
  expect(screen.queryByLabelText("Dependency B → C")).toBeNull();
  expect(selectReadyTaskIds).toBeTypeOf("function");
  expect(PROTOCOL_VERSION).toBeTypeOf("string");
});

test("selecting a task updates its public inspector data without changing dependency edges", () => {
  render(<App />);

  fireEvent.click(screen.getByRole("button", { name: /Task B/ }));

  const inspector = screen.getByRole("complementary", { name: "Task inspector" });
  expect(inspector.textContent).toContain("B");
  expect(inspector.textContent).toContain("Project the task graph for the canvas");
  expect(inspector.textContent).toContain("Parent ID");
  expect(inspector.textContent).toContain("A");
  expect(inspector.textContent).toContain("Dependencies");
  expect(inspector.textContent).toContain("A");
  expect(screen.getByLabelText("Dependency A → B")).toBeTruthy();
  expect(screen.getByLabelText("Dependency A → C")).toBeTruthy();
  expect(screen.getByLabelText("Dependency B → D")).toBeTruthy();
  expect(screen.getByLabelText("Dependency C → D")).toBeTruthy();
});
