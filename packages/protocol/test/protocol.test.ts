import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { Task, TaskGraph, Worker } from "../src/index.js";

test("represents the four-level task hierarchy and cross-branch dependencies", () => {
  const epic: Task = {
    id: "E1",
    level: "epic",
    title: "Authentication",
    status: "pending",
    dependencies: [],
    acceptanceCriteria: [],
    createdAt: "2026-08-28T00:00:00.000Z",
    updatedAt: "2026-08-28T00:00:00.000Z"
  };
  const backend: Task = { ...epic, id: "T1", parentId: epic.id, level: "task", title: "Backend" };
  const login: Task = { ...epic, id: "S1", parentId: backend.id, level: "subtask", title: "Login" };
  const signToken: Task = { ...epic, id: "A1", parentId: login.id, level: "atomic", title: "Sign token" };
  const frontend: Task = { ...epic, id: "T2", parentId: epic.id, level: "task", title: "Frontend" };
  const authContext: Task = {
    ...epic,
    id: "S2",
    parentId: frontend.id,
    level: "subtask",
    title: "Auth context",
    dependencies: [login.id]
  };

  const graph: TaskGraph = {
    projectId: "P1",
    rootTaskIds: [epic.id],
    tasks: Object.fromEntries([epic, backend, login, signToken, frontend, authContext].map((task) => [task.id, task]))
  };

  assert.equal(graph.tasks[authContext.id]?.dependencies[0], login.id);
  assert.equal(graph.tasks[signToken.id]?.parentId, login.id);
  assert.deepEqual(Object.keys(graph.tasks), ["E1", "T1", "S1", "A1", "T2", "S2"]);
});

test("uses one Worker contract for different providers", () => {
  const workers: Worker[] = [
    { id: "W1", provider: "codex", status: "idle" },
    { id: "W2", provider: "claude", status: "busy", currentTaskId: "T1" },
    { id: "W3", provider: "opencode", status: "offline" }
  ];

  assert.deepEqual(workers.map(({ provider }) => provider), ["codex", "claude", "opencode"]);
});
