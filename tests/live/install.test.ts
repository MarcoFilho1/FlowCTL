import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  appNotice,
  autoUpdate,
  compareVersions,
  digestOf,
  init,
  MOD_VERSION,
  newerVersion,
  openInBackground,
  parseArgs,
  releaseUrl,
  uninstall,
  zipName,
  type InstallContext,
  type RunResult
} from "../../mod/live/install.ts";
import { homeOf, platformOf } from "../../mod/live/platform.ts";
import { psQuote } from "../../mod/live/windows.ts";

const HOME = "/Users/ana";
const DIGEST = "a".repeat(64);

const WIN_HOME = "C:\\Users\\ana";
const LOCAL_APP_DATA = `${WIN_HOME}\\AppData\\Local`;
const APP_DATA = `${WIN_HOME}\\AppData\\Roaming`;
const TEMP = `${LOCAL_APP_DATA}\\Temp`;
const WIN_EXE = `${LOCAL_APP_DATA}\\Programs\\FlowCTL\\FlowCTL.exe`;
const WIN_ZIP = `FlowCTL-${MOD_VERSION}-windows-x64.zip`;

const ok = (stdout = ""): RunResult => ({ exitCode: 0, stdout, stderr: "" });
const fail = (stderr = ""): RunResult => ({ exitCode: 1, stdout: "", stderr });

/** The single-quoted paths of a PowerShell script, unquoted, in order. */
function quoted(script: string): string[] {
  return [...script.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1]!.replaceAll("''", "'"));
}

/** A pretend Mac: the installed apps by path, and how each command answers. */
function mac(options: { apps?: Record<string, string>; digest?: string; curlFails?: boolean } = {}) {
  const apps = new Map(Object.entries(options.apps ?? {}));
  const calls: string[][] = [];
  const run = async (argv: readonly string[]): Promise<RunResult> => {
    calls.push([...argv]);
    const [cmd, ...rest] = argv;
    switch (cmd) {
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

/** A pretend Windows PC: the installed exe by path, and how each command answers. */
function win(options: { apps?: Record<string, string>; digest?: string; curlFails?: boolean } = {}) {
  const apps = new Map(Object.entries(options.apps ?? {}));
  const calls: string[][] = [];
  const scripts = () => calls.filter((c) => c[0] === "powershell").map((c) => c.at(-1)!);
  const run = async (argv: readonly string[]): Promise<RunResult> => {
    calls.push([...argv]);
    const [cmd] = argv;
    if (cmd === "powershell") {
      const script = argv.at(-1)!;
      const [first = "", second = ""] = quoted(script);
      if (script.includes("VersionInfo.ProductVersion")) {
        return apps.has(first) ? ok(`${apps.get(first)}\n`) : fail("Cannot find path because it does not exist.");
      }
      if (script.includes("Get-FileHash")) return ok(`${(options.digest ?? DIGEST).toUpperCase()}\n`);
      if (script.includes("Get-Content")) return ok(`${DIGEST}  ${WIN_ZIP}\n`);
      if (script.includes("Copy-Item")) {
        apps.set(second, MOD_VERSION);
        return ok();
      }
      if (script.includes("Remove-Item")) {
        for (const path of [...apps.keys()]) if (path === first || path.startsWith(`${first}\\`)) apps.delete(path);
        return ok();
      }
      return ok();
    }
    if (cmd === "curl.exe") return options.curlFails ? fail("curl: (22) The requested URL returned error: 404") : ok();
    if (cmd === "taskkill") return fail("ERROR: The process was not found.");
    return ok();
  };
  return { run, calls, apps, scripts, ran: (cmd: string) => calls.some((c) => c[0] === cmd) };
}

test("init downloads the release of the mod's version, checks it and installs it in ~/Applications", async () => {
  const m = mac();
  const text = await init({ run: m.run, home: HOME, platform: "darwin" });
  assert.match(text, new RegExp(`FlowCTL ${MOD_VERSION} installed at ${HOME}/Applications/FlowCTL.app`));
  const urls = m.calls.filter((c) => c[0] === "curl").map((c) => c.at(-1));
  assert.deepEqual(urls, [releaseUrl(MOD_VERSION, `FlowCTL-${MOD_VERSION}-macos.zip`), releaseUrl(MOD_VERSION, `FlowCTL-${MOD_VERSION}-macos.zip.sha256`)]);
  assert.ok(m.ran("codesign"), "the app's signature is checked");
  assert.deepEqual(m.calls.at(-2), ["open", `${HOME}/Applications/FlowCTL.app`], "and opened");
  assert.equal(m.apps.get(`${HOME}/Applications/FlowCTL.app`), MOD_VERSION);
  assert.deepEqual(m.calls.at(-1), ["rm", "-rf", "/tmp/flowctl.x"], "the download is cleaned up");
});

test("FLOWCTL_RELEASE_BASE points the download elsewhere, to try a build before it is tagged", async () => {
  const m = mac();
  await init({ run: m.run, home: HOME, platform: "darwin", releaseBase: "http://127.0.0.1:8765/" });
  const urls = m.calls.filter((c) => c[0] === "curl").map((c) => c.at(-1));
  assert.equal(urls[0], `http://127.0.0.1:8765/v${MOD_VERSION}/FlowCTL-${MOD_VERSION}-macos.zip`);
});

test("a download that does not match its checksum is not installed", async () => {
  const m = mac({ digest: "b".repeat(64) });
  const text = await init({ run: m.run, home: HOME, platform: "darwin" });
  assert.match(text, /could not be installed: the download does not match its published SHA-256/);
  assert.equal(m.apps.size, 0);
  assert.ok(!m.ran("open"));
});

test("a failed download says why", async () => {
  const m = mac({ curlFails: true });
  const text = await init({ run: m.run, home: HOME, platform: "darwin" });
  assert.match(text, /Downloading FlowCTL-.*-macos\.zip failed: curl: \(22\).*404/);
});

test("the same version already installed is only opened; --force installs it again", async () => {
  const m = mac({ apps: { "/Applications/FlowCTL.app": MOD_VERSION } });
  assert.match(await init({ run: m.run, home: HOME, platform: "darwin" }), /already installed at \/Applications\/FlowCTL.app/);
  assert.ok(!m.ran("curl"));
  const again = await init({ run: m.run, home: HOME, platform: "darwin" }, { force: true });
  assert.match(again, /installed at \/Applications\/FlowCTL.app/, "replaced where it was");
});

test("an older app is replaced where it is", async () => {
  const m = mac({ apps: { "/Applications/FlowCTL.app": "0.0.9" } });
  const text = await init({ run: m.run, home: HOME, platform: "darwin" });
  assert.match(text, /installed at \/Applications\/FlowCTL.app \(was 0\.0\.9\)/);
  assert.ok(m.ran("osascript"), "the running app is quit first");
});

test("Linux: nothing is downloaded, and it says so", async () => {
  const m = mac();
  assert.match(await init({ run: m.run, home: HOME, platform: "other" }), /does not run on Linux yet/);
  assert.ok(!m.ran("curl"));
  assert.equal(await appNotice({ run: m.run, home: HOME, platform: "other" }), undefined, "and no notice at a session start");
});

test("--from-source clones the tag and builds it", async () => {
  const m = mac();
  const text = await init({ run: m.run, home: HOME, platform: "darwin" }, { fromSource: true });
  assert.match(text, /installed/);
  const clone = m.calls.find((c) => c[0] === "git");
  assert.deepEqual(clone?.slice(0, 6), ["git", "clone", "--depth", "1", "--branch", `v${MOD_VERSION}`]);
  assert.ok(m.calls.some((c) => c[0]?.endsWith("scripts/install-overlay.sh") && c[1] === "--build-only"));
  assert.ok(!m.ran("curl"));
});

test("a session start says when the app is missing or older", async () => {
  assert.match((await appNotice({ run: mac().run, home: HOME, platform: "darwin" }))!, /not installed\. Run \/flowctl init/);
  assert.match(
    (await appNotice({ run: mac({ apps: { [`${HOME}/Applications/FlowCTL.app`]: "0.0.9" } }).run, home: HOME, platform: "darwin" }))!,
    /0\.0\.9; run \/flowctl init to update/
  );
  assert.equal(await appNotice({ run: mac({ apps: { "/Applications/FlowCTL.app": MOD_VERSION } }).run, home: HOME, platform: "darwin" }), undefined);
});

test("a session start opens the installed app by its path, not by a name another copy also has", async () => {
  const installed = mac({ apps: { [`${HOME}/Applications/FlowCTL.app`]: MOD_VERSION } });
  await openInBackground({ run: installed.run, home: HOME, platform: "darwin" });
  assert.deepEqual(installed.calls.at(-1), ["open", "-g", `${HOME}/Applications/FlowCTL.app`]);

  // Not where the installer puts it: Launch Services finds it by name.
  const elsewhere = mac();
  await openInBackground({ run: elsewhere.run, home: HOME, platform: "darwin" });
  assert.deepEqual(elsewhere.calls.at(-1), ["open", "-g", "-a", "FlowCTL"]);
});

test("a session start updates an older app where it is, and leaves a current one alone", async () => {
  const old = mac({ apps: { [`${HOME}/Applications/FlowCTL.app`]: "0.1.0" } });
  const text = await autoUpdate({ run: old.run, home: HOME, platform: "darwin" });
  assert.equal(text, `FlowCTL: the overlay app was updated from 0.1.0 to ${MOD_VERSION}.`);
  assert.equal(old.apps.get(`${HOME}/Applications/FlowCTL.app`), MOD_VERSION);
  assert.ok(old.calls.some((c) => c[0] === "sh" && c.at(-1) === `${HOME}/.flowctl/updating`), "it takes the update lock");
  assert.deepEqual(old.calls.at(-1), ["rm", "-rf", `${HOME}/.flowctl/updating`], "and lets it go");

  const current = mac({ apps: { [`${HOME}/Applications/FlowCTL.app`]: MOD_VERSION } });
  assert.equal(await autoUpdate({ run: current.run, home: HOME, platform: "darwin" }), undefined);
  assert.ok(!current.ran("curl"), "nothing is downloaded");

  const none = mac();
  assert.equal(await autoUpdate({ run: none.run, home: HOME, platform: "darwin" }), undefined, "a missing app is left to the notice");
  assert.ok(!none.ran("curl"));
});

test("a session start does not update while another session holds the lock", async () => {
  const m = mac({ apps: { [`${HOME}/Applications/FlowCTL.app`]: "0.1.0" } });
  const busy = async (argv: readonly string[]) => (argv[0] === "sh" ? fail("mkdir: File exists") : m.run(argv));
  assert.equal(await autoUpdate({ run: busy, home: HOME, platform: "darwin" }), undefined);
  assert.ok(!m.ran("curl"));
  assert.equal(m.apps.get(`${HOME}/Applications/FlowCTL.app`), "0.1.0");
});

test("a failed update says so and how to retry, and lets the lock go", async () => {
  const m = mac({ apps: { [`${HOME}/Applications/FlowCTL.app`]: "0.1.0" }, curlFails: true });
  const text = await autoUpdate({ run: m.run, home: HOME, platform: "darwin" });
  assert.match(text!, /is 0\.1\.0 and could not be updated to .*404.*Run \/flowctl init to try again\./);
  assert.deepEqual(m.calls.at(-1), ["rm", "-rf", `${HOME}/.flowctl/updating`]);
});

test("Windows: a session start updates an older app in place", async () => {
  const w = win({ apps: { [WIN_EXE]: "0.1.0" } });
  const text = await autoUpdate(winContext(w.run));
  assert.equal(text, `FlowCTL: the overlay app was updated from 0.1.0 to ${MOD_VERSION}.`);
  assert.equal(w.apps.get(WIN_EXE), MOD_VERSION);
  assert.ok(w.scripts().some((script) => script.includes("New-Item") && script.includes("updating") && script.includes("AddMinutes(-10)")), "the lock");
});

test("uninstall quits and removes the app", async () => {
  const m = mac({ apps: { "/Applications/FlowCTL.app": MOD_VERSION } });
  assert.match(await uninstall({ run: m.run, home: HOME, platform: "darwin" }), /Removed \/Applications\/FlowCTL.app/);
  assert.equal(m.apps.size, 0);
  assert.match(await uninstall({ run: m.run, home: HOME, platform: "darwin" }), /not installed/);
});

test("Windows: downloads the release, checks it, installs it under %LOCALAPPDATA% and opens it", async () => {
  const m = win();
  const text = await init(winContext(m.run));
  assert.equal(text, `FlowCTL ${MOD_VERSION} installed at ${WIN_EXE} and opened. It shows this session's graph from the next change on.`);

  const urls = m.calls.filter((c) => c[0] === "curl.exe").map((c) => c.at(-1));
  assert.deepEqual(urls, [releaseUrl(MOD_VERSION, WIN_ZIP), releaseUrl(MOD_VERSION, `${WIN_ZIP}.sha256`)]);
  assert.ok(m.calls.some((c) => c[0] === "tar.exe" && c[1] === "-xf" && c.includes("-C")), "the zip is extracted with tar.exe");
  assert.ok(m.calls.some((c) => c[0] === "taskkill" && c.includes("FlowCTL.exe")), "a running app is closed first");

  const scripts = m.scripts();
  assert.ok(scripts.some((s) => s.includes("Get-FileHash") && s.includes(`${TEMP}\\flowctl-`)), "the zip's hash is checked");
  assert.ok(scripts.some((s) => s.includes("Copy-Item") && quoted(s)[1] === WIN_EXE), "the exe is copied to the install folder");
  assert.ok(scripts.some((s) => s.includes("WScript.Shell") && quoted(s).includes(`${APP_DATA}\\Microsoft\\Windows\\Start Menu\\Programs\\FlowCTL.lnk`)), "a Start menu shortcut is made");
  assert.ok(scripts.some((s) => s.includes("Start-Process") && quoted(s)[0] === WIN_EXE), "the app is started");
  assert.equal(m.apps.get(WIN_EXE), MOD_VERSION);
  assert.ok(!m.ran("open") && !m.ran("codesign"), "no macOS commands ran");
  const cleanup = m.calls.at(-1)!;
  assert.equal(cleanup[0], "powershell", "the download folder is removed last");
  assert.match(cleanup.at(-1)!, /Remove-Item -LiteralPath '.*flowctl-[a-z0-9]+' -Recurse -Force/);
});

test("Windows: a download that does not match its checksum is not installed", async () => {
  const m = win({ digest: "b".repeat(64) });
  const text = await init(winContext(m.run));
  assert.match(text, /could not be installed: the download does not match its published SHA-256/);
  assert.equal(m.apps.size, 0);
  assert.ok(!m.scripts().some((s) => s.includes("Copy-Item")));
  assert.ok(!m.scripts().some((s) => s.includes("Start-Process")));
});

test("Windows: a failed download says why", async () => {
  const m = win({ curlFails: true });
  assert.match(await init(winContext(m.run)), /Downloading FlowCTL-.*-windows-x64\.zip failed: curl: \(22\).*404/);
});

test("Windows: the same version already installed is only opened; --force installs it again", async () => {
  const m = win({ apps: { [WIN_EXE]: MOD_VERSION } });
  const text = await init(winContext(m.run));
  assert.match(text, /already installed at .*FlowCTL\.exe; opened it/);
  assert.ok(!m.ran("curl.exe"));
  assert.ok(m.scripts().some((s) => s.includes("Start-Process")));
  assert.match(await init(winContext(m.run), { force: true }), /installed at .*FlowCTL\.exe/, "replaced where it was");
});

test("Windows: an older app is replaced in place", async () => {
  const m = win({ apps: { [WIN_EXE]: "0.0.9.0" } });
  assert.match(await init(winContext(m.run)), new RegExp(`installed at .*FlowCTL\\.exe \\(was 0\\.0\\.9\\.0\\)`));
});

test("Windows: --from-source is not supported yet, and nothing runs", async () => {
  const m = win();
  assert.match(await init(winContext(m.run), { fromSource: true }), /--from-source is not supported on Windows yet/);
  assert.equal(m.calls.length, 0);
});

test("Windows: without %LOCALAPPDATA% or %TEMP% nothing is downloaded", async () => {
  const m = win();
  assert.match(await init({ ...winContext(m.run), localAppData: undefined }), /%LOCALAPPDATA% and %TEMP% must be set/);
  assert.ok(!m.ran("curl.exe"));
});

test("Windows: the app's version and missing app for a session start", async () => {
  assert.match((await appNotice(winContext(win().run)))!, /not installed\. Run \/flowctl init/);
  assert.match((await appNotice(winContext(win({ apps: { [WIN_EXE]: "0.0.9" } }).run)))!, /0\.0\.9; run \/flowctl init to update/);
  assert.equal(await appNotice(winContext(win({ apps: { [WIN_EXE]: MOD_VERSION } }).run)), undefined);
});

test("Windows: uninstall closes the app and removes its folder and shortcut", async () => {
  const m = win({ apps: { [WIN_EXE]: MOD_VERSION } });
  assert.match(await uninstall(winContext(m.run)), new RegExp(`Removed ${LOCAL_APP_DATA.replaceAll("\\", "\\\\")}\\\\Programs\\\\FlowCTL and its Start menu shortcut`));
  assert.equal(m.apps.size, 0);
  const removal = m.scripts().at(-1)!;
  assert.deepEqual(quoted(removal), [`${LOCAL_APP_DATA}\\Programs\\FlowCTL`, `${APP_DATA}\\Microsoft\\Windows\\Start Menu\\Programs\\FlowCTL.lnk`]);
  assert.ok(m.calls.some((c) => c[0] === "taskkill"));
  assert.match(await uninstall(winContext(m.run)), /not installed/);
});

test("a newer plugin version is found among the cache's version folders", () => {
  assert.equal(newerVersion(["0.1.0", "1.0.0", "1.0.1", "notes"], "1.0.0"), "1.0.1");
  assert.equal(newerVersion(["0.1.0", "1.0.0"], "1.0.0"), undefined);
  assert.equal(newerVersion(["1.0.10", "1.0.9"], "1.0.2"), "1.0.10", "compared as versions, not text");
  assert.equal(newerVersion(["mod", "apps"], "1.0.0"), undefined, "a plugin run from a folder, not the cache");
});

test("arguments, versions and checksums", () => {
  assert.deepEqual(parseArgs("init --force"), { action: "init", options: { force: true, fromSource: false } });
  assert.equal(parseArgs("").action, "help");
  assert.equal(parseArgs("remove").action, "help");
  assert.equal(compareVersions("0.1.0", "0.1.0"), 0);
  assert.equal(compareVersions("0.0.9", "0.1.0"), -1);
  assert.equal(compareVersions("0.10.0", "0.9.1"), 1);
  assert.equal(compareVersions("0.1.0", "0.1.0.0"), 0, "a Windows ProductVersion with a fourth part");
  assert.equal(digestOf(`${DIGEST.toUpperCase()}  file.zip\n`), DIGEST);
  assert.equal(zipName(MOD_VERSION, "darwin"), `FlowCTL-${MOD_VERSION}-macos.zip`);
  assert.equal(zipName(MOD_VERSION, "win32"), WIN_ZIP);
});

test("PowerShell strings: single quotes doubled, so a path stays one argument", () => {
  assert.equal(psQuote("C:\\Users\\O'Brien\\x.exe"), "'C:\\Users\\O''Brien\\x.exe'");
});

test("platform: Windows by its OS variable, Darwin by uname, anything else is other; HOME falls back to USERPROFILE", () => {
  assert.equal(platformOf("Windows_NT", ""), "win32");
  assert.equal(platformOf(undefined, "Darwin\n"), "darwin");
  assert.equal(platformOf(undefined, "Linux\n"), "other");
  assert.equal(homeOf("/Users/ana", "C:\\Users\\ana"), "/Users/ana");
  assert.equal(homeOf("", "C:\\Users\\ana"), "C:\\Users\\ana");
  assert.equal(homeOf(undefined, undefined), "");
});

test("the mod's version is plugin.json's, so it downloads the app the release CI published for it", () => {
  const plugin = JSON.parse(readFileSync(new URL("../../mod/.claude-plugin/plugin.json", import.meta.url), "utf8")) as { version: string };
  assert.equal(MOD_VERSION, plugin.version);
});

/** The Windows host for a test: the folders a Windows session has, and the given commands. */
function winContext(run: InstallContext["run"]): InstallContext {
  return { run, home: WIN_HOME, platform: "win32", localAppData: LOCAL_APP_DATA, appData: APP_DATA, temp: TEMP };
}
