import type { AgentAdapter, ExecutionInput, ExecutionResult } from "../../src/index.js";

export type FakeAdapterMode =
  | { kind: "return"; result: ExecutionResult }
  | { kind: "throw"; error: Error }
  | { kind: "reject"; error: Error }
  | { kind: "deferred" };

export class FakeAdapter implements AgentAdapter {
  readonly calls: ExecutionInput[] = [];
  private readonly waiters: { count: number; resolve: () => void }[] = [];
  private readonly pending: {
    resolve: (result: ExecutionResult) => void;
    reject: (error: Error) => void;
  }[] = [];

  constructor(
    private mode: FakeAdapterMode = { kind: "return", result: { kind: "succeeded" } },
    private readonly trace: string[] = []
  ) {}

  setMode(mode: FakeAdapterMode): void {
    this.mode = mode;
  }

  waitUntilCalled(count = 1): Promise<void> {
    if (this.calls.length >= count) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push({ count, resolve }));
  }

  resolve(result: ExecutionResult): void {
    const pending = this.pending.shift();
    if (!pending) throw new Error("No deferred Adapter call to resolve.");
    pending.resolve(result);
  }

  reject(error: Error): void {
    const pending = this.pending.shift();
    if (!pending) throw new Error("No deferred Adapter call to reject.");
    pending.reject(error);
  }

  execute(input: ExecutionInput): Promise<ExecutionResult> {
    this.trace.push("adapter.execute");
    this.calls.push(input);
    for (let index = this.waiters.length - 1; index >= 0; index--) {
      if (this.calls.length >= this.waiters[index].count) {
        this.waiters.splice(index, 1)[0].resolve();
      }
    }
    switch (this.mode.kind) {
      case "return": return Promise.resolve(this.mode.result);
      case "throw": throw this.mode.error;
      case "reject": return Promise.reject(this.mode.error);
      case "deferred": return new Promise((resolve, reject) => this.pending.push({ resolve, reject }));
    }
  }
}
