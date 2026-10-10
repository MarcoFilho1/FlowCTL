import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  appNotice,
  compareVersions,
  digestOf,
  init,
  MOD_VERSION,
  parseArgs,
  releaseUrl,
  uninstall,
  type RunResult
} from "../../mod/live/install.ts";

const HOME = "/Users/ana";
const DIGEST = "a".repeat(64);

/** A pretend Mac: the installed apps by path, and how each command answers. */
function mac(options: { os?: string; apps?: Record<string, string>; digest?: string; curlFails?: boolean } = {}) {
  const apps = new Map(Object.entries(options.apps ?? {}));
  const calls: string[][] = [];
  const ok = (stdout = ""): RunResult => ({ exitCode: 0, stdout, stderr: "" });
  const fail = (stderr = ""): RunResult => ({ exitCode: 1, stdout: "", stderr });
  const run = async (argv: readonly string[]): Promise<RunResult> => {
    calls.push([...argv]);
    const [cmd, ...rest] = argv;
    switch (cmd) {
      case "uname":
        return ok(`${options.os ?? "Darwin"}\n`);
      case "/usr/libexec/PlistBuddy": {
        const app = rest[2]!.replace("/Contents/Info.plist", "");
        return apps.has(app) ? ok(`${apps.get(app)}\n`) : fail("Does Not Exist");
      }
      case "mktemp":
        return ok("/tmp/flowctl.x\n");
      case "curl":
        return options.curlFails ? fail("curl: (22) The requested URL returned error: 404") : ok();
      case "cat":
        return ok(`${DIGEST}  FlowCTL-${MOD_VERSION}-macos.zip\n`);
      case "shasum":
        return ok(`${options.digest ?? DIGEST}  /tmp/flowctl.x/FlowCTL-${MOD_VERSION}-macos.zip\n`);
      case "pgrep":
        return fail();
      case "ditto":
        if (rest[0] !== "-x") apps.set(rest[1]!, MOD_VERSION);
        return ok();
      case "rm":
        apps.delete(rest[1]!);
        return ok();
      default:
        return ok();
    }
  };
  return { run, calls, apps, ran: (cmd: string) => calls.some((c) => c[0] === cmd) };
}

test("init downloads the release of the mod's version, checks it and installs it in ~/Applications", async () => {
  const m = mac();
  const text = await init({ run: m.run, home: HOME });
  assert.match(text, new RegExp(`FlowCTL ${MOD_VERSION} installed at ${HOME}/Applications/FlowCTL.app`));
  const urls = m.calls.filter((c) => c[0] === "curl").map((c) => c.at(-1));
  assert.deepEqual(urls, [releaseUrl(MOD_VERSION, `FlowCTL-${MOD_VERSION}-macos.zip`), releaseUrl(MOD_VERSION, `FlowCTL-${MOD_VERSION}-macos.zip.sha256`)]);
  assert.ok(m.ran("codesign"), "the app's signature is checked");
  assert.deepEqual(m.calls.at(-2), ["open", `${HOME}/Applications/FlowCTL.app`], "and opened");
  assert.equal(m.apps.get(`${HOME}/Applications/FlowCTL.app`), MOD_VERSION);
  assert.deepEqual(m.calls.at(-1), ["rm", "-rf", "/tmp/flowctl.x"], "the download is cleaned up");
});

test("a download that does not match its checksum is not installed", async () => {
  const m = mac({ digest: "b".repeat(64) });
  const text = await init({ run: m.run, home: HOME });
  assert.match(text, /could not be installed: the download does not match its published SHA-256/);
  assert.equal(m.apps.size, 0);
  assert.ok(!m.ran("open"));
});

test("a failed download says why", async () => {
  const m = mac({ curlFails: true });
  const text = await init({ run: m.run, home: HOME });
  assert.match(text, /Downloading FlowCTL-.*-macos\.zip failed: curl: \(22\).*404/);
});

test("the same version already installed is only opened; --force installs it again", async () => {
  const m = mac({ apps: { "/Applications/FlowCTL.app": MOD_VERSION } });
  assert.match(await init({ run: m.run, home: HOME }), /already installed at \/Applications\/FlowCTL.app/);
  assert.ok(!m.ran("curl"));
  const again = await init({ run: m.run, home: HOME }, { force: true });
  assert.match(again, /installed at \/Applications\/FlowCTL.app/, "replaced where it was");
});

test("an older app is replaced where it is", async () => {
  const m = mac({ apps: { "/Applications/FlowCTL.app": "0.0.9" } });
  const text = await init({ run: m.run, home: HOME });
  assert.match(text, /installed at \/Applications\/FlowCTL.app \(was 0\.0\.9\)/);
  assert.ok(m.ran("osascript"), "the running app is quit first");
});

test("not a Mac: nothing is downloaded", async () => {
  const m = mac({ os: "Linux" });
  assert.match(await init({ run: m.run, home: HOME }), /macOS only/);
  assert.ok(!m.ran("curl"));
});

test("--from-source clones the tag and builds it", async () => {
  const m = mac();
  const text = await init({ run: m.run, home: HOME }, { fromSource: true });
  assert.match(text, /installed/);
  const clone = m.calls.find((c) => c[0] === "git");
  assert.deepEqual(clone?.slice(0, 6), ["git", "clone", "--depth", "1", "--branch", `v${MOD_VERSION}`]);
  assert.ok(m.calls.some((c) => c[0]?.endsWith("scripts/install-overlay.sh") && c[1] === "--build-only"));
  assert.ok(!m.ran("curl"));
});

test("a session start says when the app is missing or older", async () => {
  assert.match((await appNotice({ run: mac().run, home: HOME }))!, /not installed\. Run \/flowctl init/);
  assert.match((await appNotice({ run: mac({ apps: { [`${HOME}/Applications/FlowCTL.app`]: "0.0.9" } }).run, home: HOME }))!, /0\.0\.9; run \/flowctl init to update/);
  assert.equal(await appNotice({ run: mac({ apps: { "/Applications/FlowCTL.app": MOD_VERSION } }).run, home: HOME }), undefined);
});

test("uninstall quits and removes the app", async () => {
  const m = mac({ apps: { "/Applications/FlowCTL.app": MOD_VERSION } });
  assert.match(await uninstall({ run: m.run, home: HOME }), /Removed \/Applications\/FlowCTL.app/);
  assert.equal(m.apps.size, 0);
  assert.match(await uninstall({ run: m.run, home: HOME }), /not installed/);
});

test("arguments, versions and checksums", () => {
  assert.deepEqual(parseArgs("init --force"), { action: "init", options: { force: true, fromSource: false } });
  assert.equal(parseArgs("").action, "help");
  assert.equal(parseArgs("remove").action, "help");
  assert.equal(compareVersions("0.1.0", "0.1.0"), 0);
  assert.equal(compareVersions("0.0.9", "0.1.0"), -1);
  assert.equal(compareVersions("0.10.0", "0.9.1"), 1);
  assert.equal(digestOf(`${DIGEST.toUpperCase()}  file.zip\n`), DIGEST);
});

test("the mod's version is plugin.json's, so it downloads the app the release CI published for it", () => {
  const plugin = JSON.parse(readFileSync(new URL("../../mod/.claude-plugin/plugin.json", import.meta.url), "utf8")) as { version: string };
  assert.equal(MOD_VERSION, plugin.version);
});
