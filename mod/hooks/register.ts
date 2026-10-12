import type { EngineInterface, PluginOptions, Register, ToolCallResult } from "claude-code";
import { apply, FLOWPLAN_TOOL, initialState, type GraphState } from "../graph/reduce.ts";
import { snapshot } from "../graph/snapshot.ts";
import type { GraphEvent, Layout, Snapshot, TerminalInfo } from "../graph/types.ts";
import { alerts, describeRequest, FLOWPLAN_SPEC, nudgeText, statusLine, summarize } from "../live/present.ts";
import { appNotice, autoUpdate, HELP, init, newerVersion, openInBackground, parseArgs, uninstall, type InstallContext } from "../live/install.ts";
import { homeOf, platformOf, type Platform } from "../live/platform.ts";
import { rebuildEvents } from "../live/rebuild.ts";
import { overlayClient, type OverlayClient, type OverlayIo } from "../live/transport.ts";
import { parentPid } from "../live/windows.ts";
import { omitKeys, Recording, trim } from "../recorder/recording.ts";

// The live mod: every hook below observes one engine event, passes it on
// untouched, and feeds it to the graph (mod/graph). Each change publishes a
// snapshot to the overlay app (mod/live/transport.ts) and to
// ~/.flowctl/sessions/<id>.json, and refreshes the status line. Nothing here
// may fail or slow down a call: all I/O is fire-and-forget.
//
// The events reach the graph in the same shape the recorder stores them, so
// the fixtures in fixtures/ replay exactly what a live session sees.

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
  "SendMessage",
  FLOWPLAN_TOOL
]);

// Fields of classic events, at any depth, that carry prompts, the model's
// text, tool payloads or paths.
const CLASSIC_DROPPED = new Set([
  "prompt",
  "delta",
  "tool_input",
  "tool_response",
  "transcript_path",
  "agent_transcript_path",
  "scratchpad_dir",
  "cwd",
  "last_assistant_message"
]);

const PUBLISH_DELAY_MS = 100;
const RECORD_FLUSH_DELAY_MS = 500;

type Entry = Omit<GraphEvent, "seq">;

interface Settings {
  errorThreshold: number;
  nudge: boolean;
  autoOpenOverlay: boolean;
  autoUpdateApp: boolean;
  recordEvents: boolean;
}

let settings: Settings = { errorThreshold: 3, nudge: true, autoOpenOverlay: true, autoUpdateApp: true, recordEvents: false };
let graph: GraphState = initialState();
let flowctlDir: string | undefined;
let overlay: OverlayClient | undefined;
// Readers drop a snapshot whose seq is not above the last one, and a reload
// of this module starts its variables over: counting from the clock keeps
// seq growing across reloads.
let seq = Date.now();
let lastSnapshot: Snapshot | undefined;
let lastLayout: Layout | undefined;
let publishScheduled = false;
let planTool = "TaskCreate";
let terminal: TerminalInfo | undefined;

// Recorder (opt-in): the same events, kept as fixtures-to-be.
let recording: Recording | undefined;
let recordingSession: string | undefined;
let recordScheduled = false;
let recordFlushing: Promise<void> = Promise.resolve();

function readSettings(options: PluginOptions): Settings {
  const threshold = Number(options["errorThreshold"]);
  return {
    errorThreshold: Number.isFinite(threshold) && threshold >= 1 ? threshold : 3,
    // On unless turned off: without it the agent rarely declares a plan.
    nudge: options["nudge"] !== false,
    autoOpenOverlay: options["autoOpenOverlay"] !== false,
    autoUpdateApp: options["autoUpdateApp"] !== false,
    recordEvents: options["recordEvents"] === true
  };
}

/** One engine event: into the graph, into the recording, then out to the surfaces. */
function observe($: EngineInterface, event: string, fields: Omit<Entry, "t" | "event">): void {
  try {
    const entry: Entry = { t: Date.now(), event, ...fields };
    apply(graph, entry);
    if (settings.recordEvents) {
      record($, entry);
    }
    schedulePublish($);
  } catch {
    // A lost event is better than a failed hook.
  }
}

function schedulePublish($: EngineInterface): void {
  if (publishScheduled) {
    return;
  }
  publishScheduled = true;
  $.clock.after(PUBLISH_DELAY_MS, () => {
    publishScheduled = false;
    publish($);
  });
}

function publish($: EngineInterface): void {
  try {
    seq += 1;
    const next = snapshot(graph, {
      seq,
      now: Date.now(),
      ...(lastLayout ? { previous: lastLayout } : {}),
      ...(terminal ? { terminal } : {})
    });
    lastLayout = next.layout;
    for (const line of alerts(lastSnapshot, next)) {
      $.ui.toast(line);
    }
    lastSnapshot = next;
    $.ui.status(statusLine(next));
    if (flowctlDir === undefined || next.sessionId === "") {
      return;
    }
    const body = JSON.stringify(next);
    void overlay?.request("POST", "/snapshot", body).catch(() => undefined);
    void $.fs.write(`${flowctlDir}/sessions/${next.sessionId}.json`, body).catch(() => undefined);
  } catch {
    // The next event publishes again.
  }
}

/** The host's platform: Windows by its OS variable, else what uname says. */
async function hostPlatform($: EngineInterface): Promise<Platform> {
  const osName = await $.env.get("OS");
  const uname = osName === "Windows_NT" ? "" : await $.process.run(["uname", "-s"]).then((run) => run.stdout).catch(() => "");
  return platformOf(osName, uname);
}

/** The host's file and HTTP calls, for the overlay client. */
function overlayIo($: EngineInterface): OverlayIo {
  return {
    fetch: (url, init) => $.http.fetch(url, init),
    read: (path) => $.fs.read(path),
    mtime: async (path) => (await $.fs.stat(path)).mtimeMs
  };
}

/**
 * Where this session runs: the terminal app, its tty and its own ids, so the
 * overlay can bring this terminal forward when a node is clicked.
 */
async function findTerminal($: EngineInterface, platform: Platform): Promise<TerminalInfo> {
  // $.env.get takes literal names, so the variables the mod reads are listed.
  const read = (value: string | undefined) => (value === undefined || value === "" ? undefined : value);
  const ids: Record<string, string> = {};
  const iterm = read(await $.env.get("ITERM_SESSION_ID").catch(() => undefined));
  const apple = read(await $.env.get("TERM_SESSION_ID").catch(() => undefined));
  const maestri = read(await $.env.get("MAESTRI_TERMINAL_ID").catch(() => undefined));
  const windowsTerminal = read(await $.env.get("WT_SESSION").catch(() => undefined));
  if (iterm !== undefined) ids["ITERM_SESSION_ID"] = iterm;
  if (apple !== undefined) ids["TERM_SESSION_ID"] = apple;
  if (maestri !== undefined) ids["MAESTRI_TERMINAL_ID"] = maestri;
  if (windowsTerminal !== undefined) ids["WT_SESSION"] = windowsTerminal;
  const app = read(await $.env.get("__CFBundleIdentifier").catch(() => undefined));
  const program = read(await $.env.get("TERM_PROGRAM").catch(() => undefined));
  // The shell's parent is this Claude Code process: its pid, and on Unix its
  // tty, which is the session's (Windows has no tty).
  const [pidText = "", tty = ""] = await $.process
    .run(platform === "win32" ? parentPid() : ["sh", "-c", "echo $PPID; ps -o tty= -p $PPID"])
    .then((run) => run.stdout.trim().split(/\s+/))
    .catch(() => []);
  const pid = Number(pidText);
  return {
    ...(app !== undefined ? { app } : {}),
    ...(program !== undefined ? { program } : {}),
    ...(tty !== "" && tty !== "??" ? { tty } : {}),
    ...(Number.isInteger(pid) && pid > 1 ? { pid } : {}),
    ...(Object.keys(ids).length > 0 ? { ids } : {})
  };
}

/**
 * Replays the plan the transcript already holds: after a reload of the mod
 * (its memory starts over) or when a session is resumed, the graph would
 * otherwise be empty until the agent touched its plan again.
 */
async function rebuildFromTranscript($: EngineInterface): Promise<void> {
  const messages = await $.session.messages();
  if (!Array.isArray(messages) || messages.length === 0) {
    return;
  }
  const agents = await $.agent.list().catch(() => []);
  const events = rebuildEvents(messages, { flowPlanTool: FLOWPLAN_TOOL, agents, at: Date.now() });
  if (events.length === 0) {
    return;
  }
  const { sessionId, cwd } = graph;
  graph = initialState({ errorThreshold: settings.errorThreshold });
  graph.sessionId = sessionId;
  graph.cwd = cwd;
  for (const event of events) {
    apply(graph, event);
  }
  schedulePublish($);
}

/** The newer plugin version already announced, and when the folder was last looked at. */
let announced: string | undefined;
let lookedAt = 0;
/** At a session start, then at most once a day while it stays open. */
const LOOK_EVERY_MS = 24 * 60 * 60 * 1000;

/**
 * A session that stays open keeps the plugin it started with. When a newer
 * version lands next to it (an update from /plugin, in this session or
 * another), say once that it, and the overlay app with it, comes with the
 * next session start or /reload-plugins. Only the local plugin folder is
 * read; nothing goes out.
 */
async function lookForNewer($: EngineInterface): Promise<void> {
  const now = Date.now();
  if (now - lookedAt < LOOK_EVERY_MS) return;
  lookedAt = now;
  const root = $.plugin.root.replace(/[\\/]+$/, "");
  const parent = root.slice(0, Math.max(root.lastIndexOf("/"), root.lastIndexOf("\\")));
  if (parent === "") return;
  const entries = await $.fs.list(parent);
  const newer = newerVersion(entries.filter((entry) => entry.kind === "dir").map((entry) => entry.name));
  if (newer === undefined || newer === announced) return;
  announced = newer;
  $.ui.toast(`FlowCTL ${newer} is ready: the plugin and the overlay app update with the next session start, or now with /reload-plugins.`);
}

/** Whether this load of the plugin has done its start (the session may have started before a reload). */
let started = false;

/**
 * At a session start: an app older than this mod is updated (it is opened
 * again after), whether or not it is running; else the app is opened when it
 * is installed and not already listening.
 */
async function startOverlay($: EngineInterface, client: OverlayClient): Promise<void> {
  if (settings.autoUpdateApp) {
    const updated = await autoUpdate(await installContext($)).catch(() => undefined);
    if (updated !== undefined) {
      $.ui.toast(updated);
      $.ui.status(undefined);
      if (!updated.includes("could not be updated")) return;
    }
  }
  if (settings.autoOpenOverlay) {
    await openOverlay($, client);
  }
}

/** Opens the overlay app when it is installed and not already listening. */
async function openOverlay($: EngineInterface, client: OverlayClient): Promise<void> {
  const alive = await client.request("GET", "/health");
  if (alive) {
    return;
  }
  // Not installed, or older than this mod: say how to fix it, once per session.
  const ctx = await installContext($);
  const notice = await appNotice(ctx).catch(() => undefined);
  if (notice) {
    $.ui.toast(notice);
    if (notice.includes("not installed")) return;
  }
  await openInBackground(ctx).catch(() => undefined);
}

async function installContext($: EngineInterface): Promise<InstallContext> {
  const releaseBase = await $.env.get("FLOWCTL_RELEASE_BASE");
  const localAppData = await $.env.get("LOCALAPPDATA");
  const appData = await $.env.get("APPDATA");
  const temp = (await $.env.get("TEMP")) ?? (await $.env.get("TMP"));
  return {
    home: homeOf(await $.env.get("HOME"), await $.env.get("USERPROFILE")),
    platform: await hostPlatform($),
    ...(localAppData ? { localAppData } : {}),
    ...(appData ? { appData } : {}),
    ...(temp ? { temp } : {}),
    ...(releaseBase ? { releaseBase } : {}),
    run: (argv, timeoutMs) =>
      $.process.run(argv, timeoutMs === undefined ? {} : { timeoutMs }).catch((error: unknown) => ({ exitCode: 127, stdout: "", stderr: String(error) })),
    progress: (line) => $.ui.status(line)
  };
}

/**
 * The plan source (docs/roadmap-agent-graph.md, Phase 1 gate): the session's
 * own task tools when it has them, else the FlowPlan tool this mod serves.
 */
async function choosePlanTool($: EngineInterface): Promise<void> {
  const tools = await $.tool.list();
  if (tools.some((tool) => tool.name === "TaskCreate")) {
    planTool = "TaskCreate";
    return;
  }
  const registered = await $.tool.register(FLOWPLAN_SPEC);
  planTool = registered.tool;
}

function record($: EngineInterface, entry: Entry): void {
  if (flowctlDir === undefined) {
    return;
  }
  const sessionId = graph.sessionId;
  if (sessionId !== undefined && sessionId !== recordingSession) {
    flushRecording($);
    recordingSession = sessionId;
    recording = new Recording(`${flowctlDir}/recordings/${sessionId}`, String(Date.now()));
  }
  recording?.add(entry);
  if (!recordScheduled) {
    recordScheduled = true;
    $.clock.after(RECORD_FLUSH_DELAY_MS, () => {
      recordScheduled = false;
      void flushRecording($);
    });
  }
}

function flushRecording($: EngineInterface): Promise<void> {
  // Taken now, so a session switch right after cannot redirect these writes.
  const writes = recording?.flush() ?? [];
  recordFlushing = recordFlushing.then(async () => {
    for (const write of writes) {
      await $.fs.write(write.file, write.text).catch(() => undefined);
    }
  });
  return recordFlushing;
}

/**
 * Serves the FlowPlan tool: the plan itself reaches the graph as the call is
 * observed. A plugin tool's result must be text or MCP content blocks; any
 * other shape fails the call for the model, which then stops updating the plan.
 */
function serveFlowPlan(e: Record<string, unknown>): ToolCallResult {
  const steps = Array.isArray(e["steps"]) ? e["steps"].length : 0;
  const text = `Plan updated: ${steps} step(s). The person sees it as a live graph.`;
  return { result: [{ type: "text", text }], text };
}

export const register: Register = (on, options) => {
  settings = readSettings(options);
  graph = initialState({ errorThreshold: settings.errorThreshold });

  on("session.start", async ($, e, next) => {
    const result = await next(e);
    try {
      const platform = await hostPlatform($);
      const home = homeOf(await $.env.get("HOME"), await $.env.get("USERPROFILE"));
      if (home !== "") {
        flowctlDir = `${home}/.flowctl`;
        overlay = overlayClient(overlayIo($), flowctlDir, platform);
      }
      graph.sessionId ??= await $.session.id();
      terminal = await findTerminal($, platform).catch(() => undefined);
      observe($, "session.start", { input: { cwd: e.cwd } });
      await choosePlanTool($).catch(() => undefined);
      await rebuildFromTranscript($).catch(() => undefined);
      await $.command
        .register({ name: "flowctl", description: "Install, update or remove the FlowCTL overlay app", argumentHint: "init | uninstall" })
        .catch(() => undefined);
      if (overlay !== undefined) {
        started = true;
        void startOverlay($, overlay).catch(() => undefined);
      }
      void lookForNewer($).catch(() => undefined);
    } catch {
      // Without its home folder the mod still draws the status line.
    }
    return result;
  });

  on("command.run", { command: "flowctl" }, async ($, e) => {
    const { action, options } = parseArgs(e.args);
    if (action === "help") return { text: HELP };
    const ctx = await installContext($);
    const text = action === "init" ? await init(ctx, options) : await uninstall(ctx);
    if (lastSnapshot) $.ui.status(statusLine(lastSnapshot));
    return { text };
  });

  on("session.end", async ($, e, next) => {
    observe($, "session.end", { input: trim(e) });
    publish($);
    if (settings.recordEvents) {
      await flushRecording($);
    }
    return next(e);
  });

  on("prompt.submit", async ($, e, next) => {
    // Where it came from: the person (composer, bridge, sdk) or the engine
    // (a background agent's task notification, an auto-continuation...).
    observe($, "prompt.submit", { input: { chars: e.text.length, ...(e.origin ? { origin: e.origin.kind } : {}) } });
    // Loaded again mid-session (/reload-plugins) without a session start: do the start's app check now.
    if (!started && overlay !== undefined) {
      started = true;
      void startOverlay($, overlay).catch(() => undefined);
    }
    void lookForNewer($).catch(() => undefined);
    return next(e);
  });

  on("prompt.compose", async ($, e, next) => {
    const result = await next(e);
    if (!settings.nudge) {
      return result;
    }
    return { ...result, sections: [...result.sections, { id: "flowctl-nudge", text: nudgeText(planTool), scope: "session" as const }] };
  });

  on("turn.start", async ($, e, next) => {
    const result = await next(e);
    observe($, "turn.start", { input: { turnId: e.turnId } });
    return result;
  });

  on("turn.complete", async ($, e, next) => {
    const result = await next(e);
    const { answer, ...fields } = e;
    const agents = await $.agent.list().catch(() => []);
    const summary = summarize(answer);
    observe($, "turn.complete", {
      ...(e.agentId !== undefined ? { agentId: e.agentId } : {}),
      input: { ...(trim(fields) as object), ...(summary !== undefined ? { summary } : {}) },
      result: { agents: agents.map(({ id, status, parentId, description, type }) => ({ id, status, parentId, description, type })) }
    });
    return result;
  });

  on("tool.call", async ($, e, next) => {
    const result = e.tool === FLOWPLAN_TOOL ? serveFlowPlan(e as Record<string, unknown>) : await next(e);
    const outcome = { isError: result.isError, deny: result.deny };
    const agent = e.agentId !== undefined ? { agentId: e.agentId } : {};
    if (GRAPH_TOOLS.has(e.tool)) {
      // An Agent call's prompt is the subagent's brief: code and context the
      // graph does not need. Its description names the node.
      const { tool: _tool, agentId: _agentId, prompt: _prompt, ...input } = e as typeof e & { prompt?: unknown };
      observe($, "tool.call", {
        ...agent,
        input: { tool: e.tool, ...(trim(input) as object) },
        result: { ...outcome, result: trim(result.result) }
      });
    } else {
      observe($, "tool.call", {
        ...agent,
        input: { tool: e.tool, tool_use_id: e.tool_use_id },
        result: { ...outcome, text: result.isError ? trim(result.text?.slice(0, 300)) : undefined }
      });
    }
    return result;
  });

  on("tool.check", async ($, e, next) => {
    const result = await next(e);
    // Why it asks, in words, only when it asks: the hover card shows it.
    const reason = result.decision === "ask" ? describeRequest(e.tool, e.input) : undefined;
    observe($, "tool.check", {
      ...(e.agentId !== undefined ? { agentId: e.agentId } : {}),
      input: { tool: e.tool, tool_use_id: e.tool_use_id, ceiling: e.ceiling, ...(reason !== undefined ? { reason } : {}) },
      result: { decision: result.decision, reason: result.reason, rule: result.rule }
    });
    return result;
  });

  on("agent.spawn", async ($, e, next) => {
    const result = await next(e);
    const { prompt: _prompt, ...input } = e as typeof e & { prompt?: unknown };
    observe($, "agent.spawn", { input: trim(input), result: trim(result) });
    return result;
  });

  on("classic.*", async ($, e, next) => {
    const result = await next(e);
    // classic.PreToolUse carries the bare tool call (no hook_event_name, every
    // argument): tool.call already observes what the graph needs from it.
    if (!("hook_event_name" in e)) {
      return result;
    }
    const fields = omitKeys(e, CLASSIC_DROPPED) as Record<string, unknown>;
    observe($, `classic.${String(fields["hook_event_name"])}`, { input: trim(fields) });
    if (fields["hook_event_name"] === "SessionStart" && fields["source"] === "resume") {
      await rebuildFromTranscript($).catch(() => undefined);
    }
    return result;
  });
};
