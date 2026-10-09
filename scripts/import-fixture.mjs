#!/usr/bin/env node
// Copies one recording (~/.flowctl/recordings/<sessionId>/) into fixtures/
// as a single JSONL file, with machine-specific paths replaced.
//
//   node scripts/import-fixture.mjs <recording dir> <fixture name> [project dir]

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { basename, join } from "node:path";

const [source, name, project] = process.argv.slice(2);
if (!source || !name) {
  console.error("usage: import-fixture.mjs <recording dir> <fixture name> [project dir]");
  process.exit(1);
}

// Paths also appear spelled as folder keys ("/a/b" as "-a-b") and under the
// per-user temp root.
const replacements = [
  ...(project ? [[project, "<project>"], [project.replaceAll("/", "-"), "-project"]] : []),
  ["/private/tmp/claude-" + userInfo().uid, "<tmp>"],
  ["-private-tmp-claude-" + userInfo().uid, "-tmp"],
  [homedir(), "~"],
  [userInfo().username, "<user>"]
];
// Fields that only name places on this machine, or carry payloads the
// recorder now leaves out (older recordings kept them).
const dropped = new Set([
  "scratchpad_dir",
  "transcript_path",
  "agent_transcript_path",
  "outputFile",
  "tool_input",
  "tool_response",
  "prompt",
  "delta"
]);

function scrub(value) {
  if (typeof value === "string") {
    return replacements.reduce((text, [from, to]) => text.split(from).join(to), value);
  }
  if (Array.isArray(value)) {
    return value.map(scrub);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).filter(([key]) => !dropped.has(key)).map(([key, item]) => [key, scrub(item)])
    );
  }
  return value;
}

// Chunks of one run are in order by name; runs (a resumed session) by their start time.
const events = readdirSync(source)
  .filter((file) => /^rec-.*\.jsonl$/.test(file))
  .sort()
  .flatMap((file) => readFileSync(join(source, file), "utf8").split("\n").filter(Boolean))
  .map((line) => scrub(JSON.parse(line)));

mkdirSync("fixtures", { recursive: true });
const target = join("fixtures", `${name}.jsonl`);
writeFileSync(target, events.map((event) => JSON.stringify(event)).join("\n") + "\n");
console.log(`${target}: ${events.length} events from ${basename(source)}`);
