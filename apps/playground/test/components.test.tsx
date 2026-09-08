import { fireEvent, render, screen, within } from "@testing-library/react";
import { selectReadyTaskIds } from "@flowctl/control-plane";
import { PROTOCOL_VERSION } from "@flowctl/protocol";
import { App } from "../src/App.js";
import { CommandResult } from "../src/components/CommandResult.js";
import { EventLog } from "../src/components/EventLog.js";

function getSchedulerTaskIds(listName: "Ready tasks" | "Scheduler candidates") {
  return within(screen.getByRole("list", { name: listName }))
    .queryAllByRole("listitem")
    .map((item) => item.textContent);
}

function approveTask(taskId: string) {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`Task ${taskId}:`) }));
  fireEvent.click(screen.getByRole("button", { name: `Claim ${taskId}` }));
  fireEvent.click(screen.getByRole("button", { name: `Start ${taskId}` }));
  fireEvent.click(screen.getByRole("button", { name: `Complete ${taskId}` }));
  fireEvent.click(screen.getByRole("button", { name: `Approve Review ${taskId}` }));
}

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

test("Event Log renders public envelope, Actor, task, worker, and Lease fields", () => {
  render(
    <EventLog
      events={[
        {
          id: "demo-event-1",
          protocolVersion: "0.2",
          timestamp: "2026-09-08T00:00:01.000Z",
          projectId: "demo-project",
          actor: { type: "user", id: "playground" },
          type: "lease.created",
          payload: {
            lease: {
              id: "demo-lease-1",
              taskId: "A",
              workerId: "demo-worker",
              acquiredAt: "2026-09-08T00:00:01.000Z",
              expiresAt: "2026-09-08T01:00:01.000Z",
              lastHeartbeatAt: "2026-09-08T00:00:01.000Z"
            }
          }
        }
      ]}
    />
  );

  const log = screen.getByRole("region", { name: "Event Log" });
  expect(log.textContent).toContain("lease.created");
  expect(log.textContent).toContain("demo-event-1");
  expect(log.textContent).toContain("2026-09-08T00:00:01.000Z");
  expect(log.textContent).toContain("user:playground");
  expect(log.textContent).toContain("A");
  expect(log.textContent).toContain("demo-worker");
  expect(log.textContent).toContain("demo-lease-1");
});

test("Command Result distinguishes accepted Event types from rejected failure codes", () => {
  const { rerender } = render(
    <CommandResult
      result={{
        ok: true,
        events: [
          {
            id: "demo-event-1",
            protocolVersion: "0.2",
            timestamp: "2026-09-08T00:00:01.000Z",
            projectId: "demo-project",
            actor: { type: "user", id: "playground" },
            type: "task.started",
            payload: { taskId: "A", workerId: "demo-worker", leaseId: "demo-lease-1" }
          }
        ]
      }}
    />
  );
  expect(screen.getByRole("status").textContent).toContain("Accepted");
  expect(screen.getByRole("status").textContent).toContain("task.started");

  rerender(
    <CommandResult
      result={{
        ok: false,
        code: "TASK_NOT_READY",
        commandId: "demo-command-2",
        taskId: "A"
      }}
    />
  );
  expect(screen.getByRole("alert").textContent).toContain("TASK_NOT_READY");
  expect(screen.queryByRole("button")).toBeNull();
});

test("Scheduler separates materialized ready tasks from policy candidates at limit 2", () => {
  render(<App />);

  expect(screen.getByRole("region", { name: "Scheduler" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Ready tasks" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Scheduler candidates" })).toBeTruthy();
  expect(getSchedulerTaskIds("Ready tasks")).toEqual(["A"]);
  expect(getSchedulerTaskIds("Scheduler candidates")).toEqual(["A"]);

  const limitInput = screen.getByRole("spinbutton", { name: "Scheduler limit" });
  expect((limitInput as HTMLInputElement).value).toBe("2");
  fireEvent.change(limitInput, { target: { value: "0" } });

  expect(getSchedulerTaskIds("Ready tasks")).toEqual(["A"]);
  expect(getSchedulerTaskIds("Scheduler candidates")).toEqual([]);
  expect(screen.getByRole("button", { name: /Task A:/ }).textContent).toContain("Ready");
  expect(screen.getByRole("region", { name: "Event Log" }).textContent).toContain("No Events yet");
});

test("Scheduler delegates invalid raw limits to policy RangeError without changing runtime state", () => {
  render(<App />);

  const limitInput = screen.getByRole("spinbutton", { name: "Scheduler limit" });
  for (const rawLimit of ["", "1.5", "-1", "9007199254740992"]) {
    fireEvent.change(limitInput, { target: { value: rawLimit } });
    expect(screen.getByRole("alert").textContent).toBe(
      "limit must be a non-negative safe integer"
    );
    expect(getSchedulerTaskIds("Ready tasks")).toEqual(["A"]);
    expect(getSchedulerTaskIds("Scheduler candidates")).toEqual([]);
    expect(screen.getByRole("button", { name: /Task A:/ }).textContent).toContain("Ready");
    expect(screen.getByRole("region", { name: "Event Log" }).textContent).toContain(
      "No Events yet"
    );
  }

  fireEvent.change(limitInput, { target: { value: "2" } });
  expect(screen.queryByRole("alert")).toBeNull();
  expect(getSchedulerTaskIds("Scheduler candidates")).toEqual(["A"]);
});

test("App gates lifecycle actions by status and renders current result separately from Event Log", () => {
  render(<App />);

  expect(screen.getByRole("button", { name: "Claim A" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Start A|Complete A|Approve Review A/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Claim A" }));

  expect(screen.getByRole("button", { name: "Start A" })).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain("lease.created");
  expect(screen.getByRole("status").textContent).toContain("task.claimed");
  expect(screen.getByRole("region", { name: "Event Log" }).textContent).toContain("demo-event-1");
  expect(screen.getByRole("region", { name: "Event Log" }).textContent).toContain("demo-event-2");

  fireEvent.click(screen.getByRole("button", { name: "Start A" }));
  expect(screen.getByRole("button", { name: "Complete A" })).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain("task.started");
  expect(screen.getByRole("status").textContent).not.toContain("task.claimed");
  expect(screen.getByRole("region", { name: "Event Log" }).textContent).toContain("task.claimed");

  fireEvent.click(screen.getByRole("button", { name: "Complete A" }));
  expect(screen.getByRole("button", { name: "Approve Review A" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Approve Review A" }));

  expect(screen.queryByRole("button", { name: /Claim A|Start A|Complete A|Approve Review A/ })).toBeNull();
  expect(screen.getByRole("button", { name: /Task A:/ }).textContent).toContain("Completed");
  expect(screen.getByRole("button", { name: /Task B:/ }).textContent).toContain("Ready");
  expect(screen.getByRole("button", { name: /Task C:/ }).textContent).toContain("Ready");
});

test("App completes A through B and C to D with ordered Events and no unsupported controls", () => {
  render(<App />);

  for (const unsupportedAction of [
    /Fail /,
    /Block /,
    /Heartbeat/,
    /Graph Mutation/
  ]) {
    expect(screen.queryByRole("button", { name: unsupportedAction })).toBeNull();
  }

  approveTask("A");
  expect(getSchedulerTaskIds("Ready tasks")).toEqual(["B", "C"]);
  expect(getSchedulerTaskIds("Scheduler candidates")).toEqual(["B", "C"]);
  const eventCountBeforeLimitChange = within(
    screen.getByRole("region", { name: "Event Log" })
  ).getAllByRole("listitem").length;
  fireEvent.change(screen.getByRole("spinbutton", { name: "Scheduler limit" }), {
    target: { value: "1" }
  });
  expect(getSchedulerTaskIds("Ready tasks")).toEqual(["B", "C"]);
  expect(getSchedulerTaskIds("Scheduler candidates")).toEqual(["B"]);
  expect(screen.getByRole("button", { name: /Task B:/ }).textContent).toContain("Ready");
  expect(screen.getByRole("button", { name: /Task C:/ }).textContent).toContain("Ready");
  expect(within(screen.getByRole("region", { name: "Event Log" })).getAllByRole("listitem"))
    .toHaveLength(eventCountBeforeLimitChange);
  fireEvent.change(screen.getByRole("spinbutton", { name: "Scheduler limit" }), {
    target: { value: "2" }
  });

  approveTask("B");
  expect(screen.getByRole("button", { name: /Task B:/ }).textContent).toContain("Completed");
  expect(screen.getByRole("button", { name: /Task C:/ }).textContent).toContain("Ready");
  expect(screen.getByRole("button", { name: /Task D:/ }).textContent).toContain("Pending");
  expect(getSchedulerTaskIds("Ready tasks")).toEqual(["C"]);
  expect(getSchedulerTaskIds("Scheduler candidates")).toEqual(["C"]);

  approveTask("C");
  expect(screen.getByRole("button", { name: /Task C:/ }).textContent).toContain("Completed");
  expect(screen.getByRole("button", { name: /Task D:/ }).textContent).toContain("Ready");
  expect(getSchedulerTaskIds("Ready tasks")).toEqual(["D"]);
  expect(getSchedulerTaskIds("Scheduler candidates")).toEqual(["D"]);

  const eventTypes = within(screen.getByRole("region", { name: "Event Log" }))
    .getAllByRole("listitem")
    .map((item) => item.querySelector("strong")?.textContent);
  expect(eventTypes).toEqual([
    "lease.created",
    "task.claimed",
    "task.started",
    "task.review_requested",
    "task.completed",
    "task.ready",
    "task.ready",
    "lease.created",
    "task.claimed",
    "task.started",
    "task.review_requested",
    "task.completed",
    "lease.created",
    "task.claimed",
    "task.started",
    "task.review_requested",
    "task.completed",
    "task.ready"
  ]);
});

test("Reset restores the fixture, clears projections, and restarts deterministic IDs", () => {
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "Claim A" }));
  expect(screen.getByRole("region", { name: "Event Log" }).textContent).toContain("demo-event-2");

  fireEvent.click(screen.getByRole("button", { name: /Task C:/ }));
  expect(screen.getByRole("complementary", { name: "Task inspector" }).textContent).toContain("C");
  fireEvent.change(screen.getByRole("spinbutton", { name: "Scheduler limit" }), {
    target: { value: "-1" }
  });
  expect(screen.getByRole("alert").textContent).toBe("limit must be a non-negative safe integer");

  fireEvent.click(screen.getByRole("button", { name: "Reset" }));

  expect(screen.getByRole("button", { name: /Task A:/ }).textContent).toContain("Ready");
  expect(screen.getByRole("button", { name: /Task A:/ }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("button", { name: /Task C:/ }).getAttribute("aria-pressed")).toBe("false");
  expect(screen.getByRole("complementary", { name: "Task inspector" }).textContent).toContain("A");
  expect(screen.getAllByText("Pending")).toHaveLength(3);
  expect(screen.getByRole("region", { name: "Event Log" }).textContent).toContain("No Events yet");
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("button", { name: "Claim A" })).toBeTruthy();
  expect((screen.getByRole("spinbutton", { name: "Scheduler limit" }) as HTMLInputElement).value)
    .toBe("2");
  expect(getSchedulerTaskIds("Ready tasks")).toEqual(["A"]);
  expect(getSchedulerTaskIds("Scheduler candidates")).toEqual(["A"]);

  fireEvent.click(screen.getByRole("button", { name: "Claim A" }));
  expect(screen.getByRole("region", { name: "Event Log" }).textContent).toContain("demo-event-1");
  expect(screen.getByRole("region", { name: "Event Log" }).textContent).toContain("demo-lease-1");
});
