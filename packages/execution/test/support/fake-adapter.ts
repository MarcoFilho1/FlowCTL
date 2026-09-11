import type { AgentAdapter, ExecutionInput, ExecutionResult } from "../../src/index.js";

export class FakeAdapter implements AgentAdapter {
  readonly calls: ExecutionInput[] = [];

  constructor(
    private readonly result: ExecutionResult = { kind: "succeeded" },
    private readonly trace: string[] = []
  ) {}

  async execute(input: ExecutionInput): Promise<ExecutionResult> {
    this.trace.push("adapter.execute");
    this.calls.push(input);
    return this.result;
  }
}
