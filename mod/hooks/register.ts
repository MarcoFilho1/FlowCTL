import type { EngineInterface, Register } from "claude-code";
import { Recording, trim } from "../recorder/recording.ts";

// Phase 1: record the events the graph will be built from, one session per
// folder under ~/.flowctl/recordings/<sessionId>/. Observe only: every hook
// passes the event on untouched and recording never fails a call.

// Tools whose input and result the graph reads. Every other tool call keeps
// only its name, agent and outcome, so file contents and commands stay out.
const GRAPH_TOOLS = new Set([
  "TaskCreate",
  "TaskUpdate",
  "TaskGet",
  "TaskList",
  "TaskStop",
  "TodoWrite",
  "Agent",
  "AskUserQuestion",
  "SendMessage"
]);

// Fields of classic events that carry prompts, the model's text, tool
// payloads or paths.
const CLASSIC_DROPPED = ["prompt", "delta", "tool_input", "tool_response", "transcript_path", "cwd", "last_assistant_message"];

const FLUSH_DELAY_MS = 500;

type Entry = Parameters<Recording["add"]>[0];

let recording: Recording | undefined;
const pending: Entry[] = [];
let flushScheduled = false;
let flushing: Promise<void> = Promise.resolve();

function record($: EngineInterface, event: string, fields: Omit<Entry, "t" | "event">): void {
  try {
    const entry = { t: Date.now(), event, ...fields };
    if (recording === undefined) {
      pending.push(entry);
      return;
    }
    recording.add(entry);
    scheduleFlush($);
  } catch {
    // A lost event is better than a failed hook.
  }
}

function scheduleFlush($: EngineInterface): void {
  if (flushScheduled) {
    return;
  }
  flushScheduled = true;
  $.clock.after(FLUSH_DELAY_MS, () => {
    flushScheduled = false;
    void flush($);
  });
}

function flush($: EngineInterface): Promise<void> {
  flushing = flushing.then(async () => {
    for (const write of recording?.flush() ?? []) {
      await $.fs.write(write.file, write.text).catch(() => undefined);
    }
  });
  return flushing;
}

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    const result = await next(e);
    try {
      const home = await $.env.get("HOME");
      const sessionId = await $.session.id();
      recording ??= new Recording(`${home}/.flowctl/recordings/${sessionId}`);
      for (const entry of pending.splice(0)) {
        recording.add(entry);
      }
      record($, "session.start", { input: { cwd: e.cwd } });
    } catch {
      // No recording for this session; the session itself is unaffected.
    }
    return result;
  });

  on("session.end", async ($, e, next) => {
    record($, "session.end", { input: trim(e) });
    await flush($);
    return next(e);
  });

  on("prompt.submit", async ($, e, next) => {
    record($, "prompt.submit", { input: { chars: e.text.length } });
    return next(e);
  });

  on("turn.start", async ($, e, next) => {
    const result = await next(e);
    record($, "turn.start", { input: { turnId: e.turnId } });
    return result;
  });

  on("turn.complete", async ($, e, next) => {
    const result = await next(e);
    const { answer: _answer, ...fields } = e;
    const agents = await $.agent.list().catch(() => []);
    record($, "turn.complete", {
      agentId: e.agentId,
      input: trim(fields),
      result: { agents: agents.map(({ id, status, parentId, description, type }) => ({ id, status, parentId, description, type })) }
    });
    return result;
  });

  on("tool.call", async ($, e, next) => {
    const result = await next(e);
    const outcome = { isError: result.isError, deny: result.deny };
    if (GRAPH_TOOLS.has(e.tool)) {
      const { tool: _tool, agentId: _agentId, ...input } = e;
      record($, "tool.call", {
        agentId: e.agentId,
        input: { tool: e.tool, ...(trim(input) as object) },
        result: { ...outcome, result: trim(result.result) }
      });
    } else {
      record($, "tool.call", {
        agentId: e.agentId,
        input: { tool: e.tool, tool_use_id: e.tool_use_id },
        result: { ...outcome, text: result.isError ? trim(result.text?.slice(0, 300)) : undefined }
      });
    }
    return result;
  });

  on("tool.check", async ($, e, next) => {
    const result = await next(e);
    record($, "tool.check", {
      agentId: e.agentId,
      input: { tool: e.tool, tool_use_id: e.tool_use_id, ceiling: e.ceiling },
      result: { decision: result.decision, reason: result.reason, rule: result.rule }
    });
    return result;
  });

  on("agent.spawn", async ($, e, next) => {
    const result = await next(e);
    const { prompt: _prompt, ...input } = e as typeof e & { prompt?: unknown };
    record($, "agent.spawn", { input: trim(input), result: trim(result) });
    return result;
  });

  on("classic.*", async ($, e, next) => {
    const result = await next(e);
    // classic.PreToolUse carries the bare tool call (no hook_event_name, every
    // argument): tool.call already records what the graph needs from it.
    if (!("hook_event_name" in e)) {
      return result;
    }
    const fields: Record<string, unknown> = { ...(e as Record<string, unknown>) };
    for (const key of CLASSIC_DROPPED) {
      delete fields[key];
    }
    record($, `classic.${String(fields["hook_event_name"])}`, { input: trim(fields) });
    return result;
  });
};
