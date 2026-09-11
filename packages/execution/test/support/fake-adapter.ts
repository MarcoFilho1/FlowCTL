import type { AgentAdapter, ExecutionInput, ExecutionResult } from "../../src/index.js";

export type FakeAdapterMode =
  | { kind: "return"; result: ExecutionResult }
  | { kind: "throw"; error: Error }
  | { kind: "reject"; error: Error };

export class FakeAdapter implements AgentAdapter {
  readonly calls: ExecutionInput[] = [];

  constructor(
    private readonly mode: FakeAdapterMode = { kind: "return", result: { kind: "succeeded" } },
    private readonly trace: string[] = []
  ) {}

  execute(input: ExecutionInput): Promise<ExecutionResult> {
    this.trace.push("adapter.execute");
    this.calls.push(input);
    switch (this.mode.kind) {
      case "return": return Promise.resolve(this.mode.result);
      case "throw": throw this.mode.error;
      case "reject": return Promise.reject(this.mode.error);
    }
  }
}
