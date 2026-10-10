# FlowCTL

A live graph of what Claude Code is doing and what comes next.

FlowCTL is a read-only [Claude Code mod](https://code.claude.com/docs/en/plugins/mods/overview)
that turns the agent's own tasks (`TaskCreate` / `TaskUpdate`, subagents,
permission prompts) into a dependency graph, and streams it to a floating
macOS overlay. It never changes how the agent plans; it only draws it.

| Color  | Meaning                              |
| ------ | ------------------------------------ |
| white  | pending                              |
| blue   | in progress                          |
| yellow | needs your input or permission       |
| red    | unrecoverable error                  |
| green  | done                                 |

## Install

macOS 13 or later, Claude Code 2.1.295 or later. In a Claude Code session:

```
/plugin install flowctl-graph --marketplace MarcoFilho1/FlowCTL
/flowctl init
```

The first line adds this repository as a plugin marketplace (answer `y`) and
installs the mod. The second downloads the overlay app of the same version
from the GitHub Release, checks its SHA-256, installs it in `~/Applications`
and opens it. `/flowctl uninstall` removes the app.

## Layout

```
mod/             the Claude Code mod (plugin)
  hooks/         hooks module: register.ts
  graph/         graph logic, pure TypeScript with no imports
  tests/         mod tests, run by `claude plugin test`
  types-vendor/  Claude Code's API types, versioned for CI
tests/graph/     unit tests for mod/graph, run by node --test
docs/            roadmap and design notes
```

## Develop

Requires Node 22.6+, pnpm and Claude Code 2.1.295+.

```sh
pnpm install
pnpm typecheck   # tsc over the mod and the tests
pnpm test        # graph unit tests
pnpm validate    # claude plugin validate + claude plugin test

claude --plugin-dir ./mod   # run a session with the mod, hot-reloaded
```

After a Claude Code upgrade, refresh `mod/types-vendor/claude-code.d.ts` from
`mod/.claude-plugin/types/claude-code/index.d.ts` (written each time a session
loads the mod) and bump `CLAUDE_CODE_VERSION` in CI.
