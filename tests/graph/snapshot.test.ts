import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { apply, initialState } from "../../mod/graph/reduce.ts";
import { snapshot } from "../../mod/graph/snapshot.ts";
import { SNAPSHOT_SCHEMA, type GraphEvent, type Snapshot } from "../../mod/graph/types.ts";

// Golden files: the final snapshot of each fixture, replayed event by event
// with the layout carried over as the mod does live. Regenerate after an
// intended change with UPDATE_GOLDEN=1 pnpm test, and review the diff.

const fixtures = new URL("../../fixtures/", import.meta.url);
const golden = new URL("golden/", fixtures);
const update = process.env["UPDATE_GOLDEN"] === "1";

function live(events: readonly GraphEvent[]): Snapshot {
  const state = initialState();
  let last: Snapshot | undefined;
  events.forEach((event, i) => {
    apply(state, event);
    last = snapshot(state, { seq: i + 1, now: event.t, ...(last ? { previous: last.layout } : {}) });
  });
  assert.ok(last, "empty fixture");
  return last;
}

for (const file of readdirSync(fixtures).filter((name) => name.endsWith(".jsonl")).sort()) {
  const name = file.replace(/\.jsonl$/, "");
  test(`golden snapshot: ${name}`, () => {
    const events = readFileSync(new URL(file, fixtures), "utf8").trim().split("\n").map((line) => JSON.parse(line) as GraphEvent);
    const actual = live(events);
    assert.equal(actual.schema, SNAPSHOT_SCHEMA);
    assert.deepEqual(Object.keys(actual.layout).sort(), actual.nodes.map((node) => node.id).sort());

    const target = new URL(`${name}.json`, golden);
    if (update) {
      mkdirSync(golden, { recursive: true });
      writeFileSync(target, JSON.stringify(actual, null, 2) + "\n");
      return;
    }
    assert.deepEqual(actual, JSON.parse(readFileSync(target, "utf8")));
  });
}
