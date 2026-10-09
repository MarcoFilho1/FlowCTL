# FlowCTL viewer

Draws a session's `Snapshot` (contract: `mod/graph/types.ts`) as a graph: one
card per node in the five colors, Bézier edges for dependencies (dashed when
inferred), subagents framed under the task they were spawned from. Vite +
React + plain SVG; the graph logic comes from `mod/graph/*.ts` by relative
import, so the viewer and the mod never disagree.

```
pnpm viewer:dev      # http://localhost:5173/?fixture=03-subagents-with-task-graph
pnpm viewer:test     # Vitest + Testing Library, on fixtures/golden
pnpm viewer:build    # apps/viewer/dist/index.html: one file, opens over file://
```

## Inputs

- **Overlay**: the native app calls `window.flowctl.push(snapshot)`. It
  returns `false` for anything that is not a schema 1 snapshot, and for a
  `seq` not newer than the one shown for that `sessionId`. Each session is a
  tab; a tab whose session waits for you is marked.
- **Dev**: `?fixture=<name>[,<name>…]` (or `?fixture=all`) replays
  `fixtures/<name>.jsonl` through the mod's reducer and snapshot builder, one
  snapshot per event, with play/pause, step, restart and speed. `&at=<n>`
  opens paused on event `n` (1-based), `&at=end` on the last one.

## Drawing

- The layout's ranks are drawn as rows (top to bottom) or columns (left to
  right), whichever shows the graph larger in the panel; the choice is sticky
  so a growing graph does not flip back and forth.
- An agent whose `parent` is on screen leaves its rank and is drawn inside
  its parent's frame (nested agents nest further).
- Up to 30 nodes the drawing shrinks to fit; past that it scrolls.
- Positions animate over 300 ms in JS (WebKit cannot transition an SVG
  path's `d`), colors in CSS; both stop under `prefers-reduced-motion`.
- Light and dark follow `prefers-color-scheme`. The page is transparent with
  a translucent panel, for the overlay's blur; in dev mode it is opaque.

`dist/` embeds the fixtures (about 160 KB) so `?fixture=` works from the
built file too.
