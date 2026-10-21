// `/flowctl init`: installs the overlay app the mod talks to. It downloads
// the app of the mod's own version from the GitHub Release that CI publishes
// (.github/workflows/release.yml), checks its SHA-256, and puts it where an
// older copy was, else in ~/Applications (macOS) or %LOCALAPPDATA%\Programs
// (Windows). Every step is a host command run through `run`, so the whole
// flow is tested without a network or either system.

import type { Platform } from "./platform.ts";
import * as windows from "./windows.ts";

/** The mod's version; the release CI refuses a tag that differs from plugin.json's. */
export const MOD_VERSION = "1.0.11";
export const REPO = "MarcoFilho1/FlowCTL";
export const APP_NAME = "FlowCTL.app";
const APP_ID = "dev.flowctl.overlay";
const APP_TITLE = "FlowCTL";
const LSREGISTER =
  "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}
export type Run = (argv: readonly string[], timeoutMs?: number) => Promise<RunResult>;

export interface InstallContext {
  run: Run;
  home: string;
  platform: Platform;
  /** Windows folders: %LOCALAPPDATA% (the app's folder), %APPDATA% (Start menu), %TEMP% (downloads). */
  localAppData?: string;
  appData?: string;
  temp?: string;
  version?: string;
  /**
   * Where the release files are instead of GitHub, `<base>/v<version>/<file>`:
   * FLOWCTL_RELEASE_BASE, to try a build before it is tagged.
   */
  releaseBase?: string;
  /** Progress, one short line at a time (the status line). */
  progress?: (line: string) => void;
}

/** What finding and checking the app needs. */
type AppHost = Pick<InstallContext, "run" | "home" | "platform" | "localAppData">;

export function zipName(version: string, platform: Platform): string {
  return platform === "win32" ? windows.winZipName(version) : `FlowCTL-${version}-macos.zip`;
}

export function releaseUrl(version: string, file: string, base = `https://github.com/${REPO}/releases/download`): string {
  return `${base.replace(/\/+$/, "")}/v${version}/${file}`;
}

/** Where an installed app may be: the person's own folder first on macOS; the one install folder on Windows. */
export function appPlaces(host: Pick<AppHost, "home" | "platform" | "localAppData">): string[] {
  if (host.platform === "win32") return host.localAppData ? [windows.installedExe(host.localAppData)] : [];
  if (host.platform === "darwin") return [`${host.home}/Applications/${APP_NAME}`, `/Applications/${APP_NAME}`];
  return [];
}

/** -1, 0 or 1 as `a` is older, the same or newer than `b` (x.y.z). */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** The first word of a `shasum` line: the hex digest. */
export function digestOf(line: string): string {
  return line.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
}

export interface Installed {
  path: string;
  version: string;
}

/** The installed app and its version, if there is one. */
export async function findApp(host: AppHost): Promise<Installed | undefined> {
  for (const path of appPlaces(host)) {
    const read = await host.run(
      host.platform === "win32"
        ? windows.versionOf(path)
        : ["/usr/libexec/PlistBuddy", "-c", "Print :CFBundleShortVersionString", `${path}/Contents/Info.plist`]
    );
    if (read.exitCode === 0) return { path, version: read.stdout.trim() };
  }
  return undefined;
}

/** What a session start should say about the app, if anything. */
export async function appNotice(ctx: AppHost & Pick<InstallContext, "version">): Promise<string | undefined> {
  // Linux has no app yet: nothing to install or update.
  if (ctx.platform === "other") return undefined;
  const want = ctx.version ?? MOD_VERSION;
  const app = await findApp(ctx);
  if (!app) return "FlowCTL: the overlay app is not installed. Run /flowctl init to install it.";
  if (compareVersions(app.version, want) < 0) return `FlowCTL: the overlay app is ${app.version}; run /flowctl init to update it to ${want}.`;
  return undefined;
}

/**
 * A session start with an app older than this mod: updates it, the way
 * `/flowctl init` does, so updating the plugin is all it takes. Returns the
 * line to show, or nothing when there is nothing to do (no app, an up to date
 * one, Linux) or another session is already updating it.
 */
export async function autoUpdate(ctx: InstallContext): Promise<string | undefined> {
  if (ctx.platform === "other") return undefined;
  const want = ctx.version ?? MOD_VERSION;
  const app = await findApp(ctx);
  if (!app || compareVersions(app.version, want) >= 0) return undefined;
  // One update at a time: several sessions may start (or reload the plugin) together.
  const win = ctx.platform === "win32";
  const lock = win ? `${ctx.home}\\.flowctl\\updating` : `${ctx.home}/.flowctl/updating`;
  const taken = await ctx.run(
    win ? windows.takeLock(lock) : ["sh", "-c", 'find "$1" -maxdepth 0 -mmin +10 -exec rm -rf {} + 2>/dev/null; mkdir "$1"', "sh", lock]
  );
  if (taken.exitCode !== 0) return undefined;
  try {
    ctx.progress?.(`FlowCTL: updating the overlay app from ${app.version} to ${want}…`);
    const text = await init(ctx);
    return text.startsWith("FlowCTL could not be installed")
      ? `FlowCTL: the overlay app is ${app.version} and could not be updated to ${want} (${text.replace(/^FlowCTL could not be installed: /, "").replace(/\. Try again.*$/, "")}). Run /flowctl init to try again.`
      : `FlowCTL: the overlay app was updated from ${app.version} to ${want}.`;
  } finally {
    await ctx.run(win ? windows.removeTree(lock) : ["rm", "-rf", lock]);
  }
}

/**
 * A newer version of this plugin among the folder names next to it (the
 * plugin cache keeps one folder per version): the one to announce, if any.
 */
export function newerVersion(names: readonly string[], current = MOD_VERSION): string | undefined {
  const versions = names.filter((name) => /^\d+\.\d+\.\d+$/.test(name)).sort(compareVersions);
  const newest = versions.at(-1);
  return newest !== undefined && compareVersions(newest, current) > 0 ? newest : undefined;
}

class Failure extends Error {}

async function must(ctx: InstallContext, argv: readonly string[], what: string, timeoutMs?: number): Promise<RunResult> {
  const result = await ctx.run(argv, timeoutMs);
  if (result.exitCode !== 0) {
    const why = (result.stderr || result.stdout).trim().split("\n")[0] ?? "";
    throw new Failure(`${what} failed${why ? `: ${why}` : ""}`);
  }
  return result;
}

async function quitApp(ctx: InstallContext): Promise<void> {
  if (ctx.platform === "win32") {
    await ctx.run(windows.KILL_APP);
    return;
  }
  await ctx.run(["osascript", "-e", `tell application id "${APP_ID}" to quit`]);
  for (let i = 0; i < 10; i += 1) {
    if ((await ctx.run(["pgrep", "-x", "FlowCTL"])).exitCode !== 0) return;
    await ctx.run(["sleep", "0.5"]);
  }
  await ctx.run(["pkill", "-x", "FlowCTL"]);
}

/** The command that opens the app at `path` in the foreground. */
function openArgs(ctx: InstallContext, path: string): readonly string[] {
  return ctx.platform === "win32" ? windows.startProcess(path) : ["open", path];
}

/**
 * Opens the installed app in the background, when it is not listening
 * (session start). By its path, not its name: macOS opens whichever copy it
 * knows by a name, and a build left in a checkout can be an old one.
 */
export async function openInBackground(ctx: InstallContext): Promise<void> {
  const app = await findApp(ctx);
  if (ctx.platform === "win32") {
    if (app) await ctx.run(windows.startProcess(app.path));
    return;
  }
  await ctx.run(app ? ["open", "-g", app.path] : ["open", "-g", "-a", APP_TITLE]);
}

/** Puts the app at `source` in place of any installed copy, registers and opens it. */
async function place(ctx: InstallContext, source: string, existing: Installed | undefined): Promise<string> {
  if (ctx.platform === "win32") return placeWindows(ctx, source);
  const target = existing?.path ?? appPlaces(ctx)[0]!;
  await quitApp(ctx);
  await must(ctx, ["mkdir", "-p", target.slice(0, target.lastIndexOf("/"))], "Creating the Applications folder");
  await must(ctx, ["rm", "-rf", target], `Removing the old ${target}`);
  await must(ctx, ["ditto", source, target], `Copying the app to ${target}`);
  await ctx.run([LSREGISTER, "-f", target]);
  await ctx.run(openArgs(ctx, target));
  return target;
}

/** Windows: the exe into its folder, a Start menu shortcut (best effort), then opened. */
async function placeWindows(ctx: InstallContext, source: string): Promise<string> {
  const localAppData = ctx.localAppData ?? "";
  const exe = windows.installedExe(localAppData);
  await quitApp(ctx);
  await must(ctx, windows.makeDir(windows.installDir(localAppData)), "Creating the install folder");
  await must(ctx, windows.copyFile(source, exe), `Copying the app to ${exe}`);
  if (ctx.appData) {
    await ctx.run(windows.shortcut(windows.startMenuShortcut(ctx.appData), exe, windows.installDir(localAppData)));
  }
  await ctx.run(openArgs(ctx, exe));
  return exe;
}

export interface InitOptions {
  /** Install again even when this version is there. */
  force?: boolean;
  /** Build from the tagged source instead of downloading (needs pnpm, Node 22, Swift). */
  fromSource?: boolean;
}

/** `/flowctl init`: the line to show the person. Never throws. */
export async function init(ctx: InstallContext, options: InitOptions = {}): Promise<string> {
  const version = ctx.version ?? MOD_VERSION;
  if (ctx.platform === "other") {
    return "FlowCTL's overlay does not run on Linux yet. The graph still shows in the status line.";
  }
  if (ctx.platform === "win32" && options.fromSource) {
    return "FlowCTL's --from-source is not supported on Windows yet. Run /flowctl init to install the release.";
  }
  try {
    if (ctx.platform === "win32" && (!ctx.localAppData || !ctx.temp)) {
      throw new Failure("%LOCALAPPDATA% and %TEMP% must be set");
    }
    const existing = await findApp(ctx);
    if (existing && !options.force && compareVersions(existing.version, version) >= 0) {
      await ctx.run(openArgs(ctx, existing.path));
      return `FlowCTL ${existing.version} is already installed at ${existing.path}; opened it. (/flowctl init --force installs it again.)`;
    }
    const work = await makeWork(ctx);
    try {
      const app = options.fromSource ? await build(ctx, work, version) : await download(ctx, work, version);
      ctx.progress?.("FlowCTL: installing…");
      const target = await place(ctx, app, existing);
      const was = existing ? ` (was ${existing.version})` : "";
      return `FlowCTL ${version} installed at ${target}${was} and opened. It shows this session's graph from the next change on.`;
    } finally {
      await ctx.run(ctx.platform === "win32" ? windows.removeTree(work) : ["rm", "-rf", work]);
    }
  } catch (error) {
    const message = error instanceof Failure ? error.message : String(error);
    return `FlowCTL could not be installed: ${message}. Try again, or /flowctl init --from-source.`;
  }
}

/** A new empty folder for the download: mktemp on macOS, a folder in %TEMP% on Windows. */
async function makeWork(ctx: InstallContext): Promise<string> {
  if (ctx.platform === "win32") {
    const dir = `${ctx.temp}\\flowctl-${Math.random().toString(36).slice(2, 10)}`;
    await must(ctx, windows.makeDir(dir), "Making a temporary folder");
    return dir;
  }
  return (await must(ctx, ["mktemp", "-d", "-t", "flowctl"], "Making a temporary folder")).stdout.trim();
}

async function download(ctx: InstallContext, work: string, version: string): Promise<string> {
  const win = ctx.platform === "win32";
  const zip = zipName(version, ctx.platform);
  const file = win ? `${work}\\${zip}` : `${work}/${zip}`;
  const curl = win ? windows.CURL : "curl";
  ctx.progress?.(`FlowCTL: downloading ${version}…`);
  await must(ctx, [curl, "-fsSL", "--retry", "2", "-o", file, releaseUrl(version, zip, ctx.releaseBase)], `Downloading ${zip}`, 180_000);
  await must(ctx, [curl, "-fsSL", "--retry", "2", "-o", `${file}.sha256`, releaseUrl(version, `${zip}.sha256`, ctx.releaseBase)], "Downloading its checksum", 60_000);
  ctx.progress?.("FlowCTL: checking the download…");
  const expected = digestOf((await must(ctx, win ? windows.readText(`${file}.sha256`) : ["cat", `${file}.sha256`], "Reading the checksum")).stdout);
  const actual = digestOf((await must(ctx, win ? windows.hashOf(file) : ["shasum", "-a", "256", file], "Checking the download")).stdout);
  if (expected.length !== 64 || actual !== expected) {
    throw new Failure("the download does not match its published SHA-256");
  }
  if (win) {
    await must(ctx, windows.makeDir(`${work}\\out`), "Making the unzip folder");
    await must(ctx, [windows.TAR, "-xf", file, "-C", `${work}\\out`], "Unzipping the app");
    return `${work}\\out\\${windows.WIN_EXE}`;
  }
  await must(ctx, ["ditto", "-x", "-k", file, `${work}/out`], "Unzipping the app");
  const app = `${work}/out/${APP_NAME}`;
  await must(ctx, ["codesign", "--verify", app], "Checking the app's signature");
  return app;
}

async function build(ctx: InstallContext, work: string, version: string): Promise<string> {
  ctx.progress?.(`FlowCTL: building ${version} from source (a few minutes)…`);
  const src = `${work}/src`;
  await must(ctx, ["git", "clone", "--depth", "1", "--branch", `v${version}`, `https://github.com/${REPO}.git`, src], "Cloning the source", 180_000);
  await must(ctx, [`${src}/scripts/install-overlay.sh`, "--build-only"], "Building the app (needs pnpm, Node 22 and Swift)", 600_000);
  return `${src}/apps/overlay/build/${APP_NAME}`;
}

/** `/flowctl uninstall`: quits and removes the app; ~/.flowctl stays. */
export async function uninstall(ctx: InstallContext): Promise<string> {
  const app = await findApp(ctx);
  if (!app) return "FlowCTL's overlay app is not installed.";
  await quitApp(ctx);
  if (ctx.platform === "win32") {
    const dir = app.path.slice(0, app.path.lastIndexOf("\\"));
    const lnk = ctx.appData ? windows.startMenuShortcut(ctx.appData) : undefined;
    const removed = await ctx.run(windows.removeInstall(dir, lnk));
    if (removed.exitCode !== 0) return `Could not remove ${dir}: ${removed.stderr.trim()}`;
    return `Removed ${dir} and its Start menu shortcut. Session files stay in ~/.flowctl; the plugin itself is removed with /plugin.`;
  }
  await ctx.run([LSREGISTER, "-u", app.path]);
  const removed = await ctx.run(["rm", "-rf", app.path]);
  if (removed.exitCode !== 0) return `Could not remove ${app.path}: ${removed.stderr.trim()}`;
  return `Removed ${app.path}. Session files stay in ~/.flowctl; the plugin itself is removed with /plugin.`;
}

/** Parses `/flowctl <args>`. */
export function parseArgs(args: string): { action: "init" | "uninstall" | "help"; options: InitOptions } {
  const words = args.trim().split(/\s+/).filter(Boolean);
  const action = words[0] === "init" || words[0] === "uninstall" ? words[0] : "help";
  return { action, options: { force: words.includes("--force"), fromSource: words.includes("--from-source") } };
}

export const HELP = [
  "/flowctl init                 install or update the overlay app (downloads the release of this plugin's version)",
  "/flowctl init --force         install it again",
  "/flowctl init --from-source   build it from the tagged source instead (macOS only; needs pnpm, Node 22 and Swift)",
  "/flowctl uninstall            remove the app"
].join("\n");
