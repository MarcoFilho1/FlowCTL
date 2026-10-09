# Events: what a session really emits

Recorded in Phase 1 with Claude Code **2.1.295** (Fable 5.1), by the recorder
in `mod/hooks/register.ts`. Every claim below has a fixture in `fixtures/`.
Where this disagrees with the roadmap, this file wins.

## Fixtures

| Fixture | Scenario | Mode |
| --- | --- | --- |
| `01-no-task-tools-big-task-then-subagents` | 4-part refactor, then 3 parallel subagents asked to track tasks, with task tools **unavailable** (default) | auto |
| `02-task-tools-on-big-task-without-tasks` | Same refactor with task tools on; the agent created **no** tasks | auto |
| `03-subagents-with-task-graph` | 4 tasks, `consolidar` blocked by the other 3, 3 background subagents | auto |
| `04-permission-approved-then-denied` | Two Bash prompts: approved after 8 s, then denied | manual |
| `05-ask-user-question` | `AskUserQuestion` with two options, answered after 8 s | manual |
| `06-repeated-tool-error` | The same failing Bash command 3 times | auto |
| `07-esc-with-task-in-progress` | Esc while a task is `in_progress` and Bash is running | auto |
| `08-resume-then-short-request` | `claude --continue` then a one-line question | auto |

Each line is `{ seq, t, event, agentId?, input?, result? }`. Prompts, the
model's text, tool payloads (other than task/agent/question tools) and paths
are not recorded.

## Findings

### 1. Task tools are off by default on current models
`TaskCreate`/`TaskGet`/`TaskUpdate`/`TaskList` are enabled when
`CLAUDE_CODE_ENABLE_TASKS` is not `false` (default) **and** any of:
- `CLAUDE_CODE_ENABLE_TODO_TOOLS` is true (env, or `"env"` in settings);
- `--allowedTools` / `--tools` on the command line names any task tool (`permissions.allow` in settings does not count);
- the main model is on a legacy list (Claude 3.x, Opus 4.0–4.7, Sonnet 4.0–4.6, Haiku 4.5) or a Bedrock inference profile;
- the session is a background job.

Fable 5.1 is not on the list, so with no opt-in the tools are off, interactive
or `-p` (the earlier `-p` test had them only through `--allowedTools`). This is
why the old transcripts had zero task calls. `TodoWrite` appears only with an
opt-in **and** `CLAUDE_CODE_ENABLE_TASKS=false`. Proven in a real TTY session
for each switch (Claude Code #3, binary 2.1.295).

The name and the legacy model list suggest the product is phasing these tools
out for new models: depending on them is fragile.

### 2. With task tools on, the agent still rarely creates tasks unasked
Fixture 02: a 4-part refactor finished in 43 s with 2 Bash calls and no task.
Fable 5.1 writes files through Bash heredocs, so there are few tool calls to
hang nodes on either. When asked (fixture 03) it builds exactly the graph
requested, dependencies included.

### 3. Tasks: everything the graph needs, in order
- `tool.call TaskCreate` → result `{ task: { id, subject } }`; ids are `"1"`, `"2"`… per session.
- `tool.call TaskUpdate { taskId, addBlockedBy: [...] }` → `updatedFields: ["blockedBy"]`.
- `tool.call TaskUpdate { taskId, status }` → `statusChange: { from, to }`.
- `classic.TaskCreated` / `classic.TaskCompleted` duplicate creation and completion.
- Tasks carry no owner when subagents do the work: linking a task to a
  subagent needs a heuristic (the task `in_progress` when `Agent` is called).

### 4. Subagents: fully observable
- `agent.spawn` → result `{ agentId, model }`, input `{ tool_use_id, description, subagentType, background }`.
- `tool.call Agent` (main loop) carries `description`; the subagent's own calls carry its `agentId`.
- Each subagent ends with `tool.call SubagentHandback` and a `turn.complete` carrying its `agentId`.
- `$.agent.list()` on every `turn.complete` gives `{ id, status: running|completed, description, type }`.
- `classic.SubagentStop` also fires for engine forks no `agent.spawn` announced (fixture 01, seq 28): ignore agent ids that were never spawned.

### 5. Yellow: `classic.PermissionRequest` is the trigger
| Signal | Manual mode | Auto mode |
| --- | --- | --- |
| `tool.check` → `decision: "ask"` | yes | **yes, without any prompt** (the classifier answers) |
| `classic.PermissionRequest` | **10 ms after the check** | absent |
| `classic.Notification permission_prompt` | **6.0 s later**, only if unanswered | absent |

- `AskUserQuestion` also raises `classic.PermissionRequest` with `tool_name: "AskUserQuestion"`: one trigger covers both yellow cases. Its `tool.call` result carries the answers.
- Approval: the matching `tool.call` completes normally.
- Denial: no `classic.PermissionDenied`; the `tool.call` ends with `isError: true` and text starting `The user doesn't want to proceed`.
- `PermissionRequest` carries no `tool_use_id`: pair it with the latest `tool.check` of the same tool.

### 6. Red and Esc
- Repeated failures are `tool.call` results with `isError: true` (fixture 06, 3 in a row).
- Esc: the running tool ends with `isError: true` (`Exit code 137 [Request interrupted by user…]`), then `turn.complete` with `reason: "aborted"`, `isAborted: true`. The task stays `in_progress` (fixture 07): the graph must show it as pending, not red.
- The engine also blocks some commands itself (`Blocked: standalone sleep`): an error, not a failure of the task.

### 7. Session lifecycle
- `session.start` fires once per process. `/clear` and `--continue`/`--resume` do not raise it; `classic.SessionStart` does, with `source: "clear" | "resume"` and the session id. `/clear` gets a **new** id; `--continue` keeps the old one.
- `classic.SessionEnd` / `session.end` carry `reason: "clear" | "other"`.
- A resumed session does not replay its tasks: rebuilding the graph needs a `TaskList`.

### 8. Engine facts confirmed
- `$.fs.write` to `~/.flowctl/...` (outside the cwd) works without a prompt, interactive and `-p`.
- Hooks must pass `$` only to functions declared at the top of the module (`claude plugin validate` refuses otherwise).
- A hooks module hot-reloads on save under `--plugin-dir`; module variables start over.
- `claude plugin validate` and `claude plugin test` do not typecheck.

## Open
- Your real day-to-day sessions: how often the agent creates tasks there (gate).
- `classic.StopFailure` and subagent `failed` were never observed.
