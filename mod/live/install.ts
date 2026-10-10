// `/flowctl init`: installs the overlay app the mod talks to. It downloads
// the app of the mod's own version from the GitHub Release that CI publishes
// (.github/workflows/release.yml), checks its SHA-256, and puts it where an
// older copy was, else in ~/Applications. Every step is a host command run
// through `run`, so the whole flow is tested without a network or a Mac.

/** The mod's version; the release CI refuses a tag that differs from plugin.json's. */
export const MOD_VERSION = "0.1.0";
export const REPO = "MarcoFilho1/FlowCTL";
export const APP_NAME = "FlowCTL.app";
const APP_ID = "dev.flowctl.overlay";
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
  version?: string;
  /** Progress, one short line at a time (the status line). */
  progress?: (line: string) => void;
}

export function zipName(version: string): string {
  return `FlowCTL-${version}-macos.zip`;
}

export function releaseUrl(version: string, file: string): string {
  return `https://github.com/${REPO}/releases/download/v${version}/${file}`;
}

/** Where an installed app may be, the person's own folder first. */
export function appPlaces(home: string): string[] {
  return [`${home}/Applications/${APP_NAME}`, `/Applications/${APP_NAME}`];
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
export async function findApp(ctx: Pick<InstallContext, "run" | "home">): Promise<Installed | undefined> {
  for (const path of appPlaces(ctx.home)) {
    const read = await ctx.run(["/usr/libexec/PlistBuddy", "-c", "Print :CFBundleShortVersionString", `${path}/Contents/Info.plist`]);
    if (read.exitCode === 0) return { path, version: read.stdout.trim() };
  }
  return undefined;
}

/** What a session start should say about the app, if anything. */
export async function appNotice(ctx: Pick<InstallContext, "run" | "home" | "version">): Promise<string | undefined> {
  const want = ctx.version ?? MOD_VERSION;
  const app = await findApp(ctx);
  if (!app) return "FlowCTL: the overlay app is not installed. Run /flowctl init to install it.";
  if (compareVersions(app.version, want) < 0) return `FlowCTL: the overlay app is ${app.version}; run /flowctl init to update it to ${want}.`;
  return undefined;
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
  await ctx.run(["osascript", "-e", `tell application id "${APP_ID}" to quit`]);
  for (let i = 0; i < 10; i += 1) {
    if ((await ctx.run(["pgrep", "-x", "FlowCTL"])).exitCode !== 0) return;
    await ctx.run(["sleep", "0.5"]);
  }
  await ctx.run(["pkill", "-x", "FlowCTL"]);
}

/** Puts the app at `source` in place of any installed copy, registers and opens it. */
async function place(ctx: InstallContext, source: string, existing: Installed | undefined): Promise<string> {
  const target = existing?.path ?? appPlaces(ctx.home)[0]!;
  await quitApp(ctx);
  await must(ctx, ["mkdir", "-p", target.slice(0, target.lastIndexOf("/"))], "Creating the Applications folder");
  await must(ctx, ["rm", "-rf", target], `Removing the old ${target}`);
  await must(ctx, ["ditto", source, target], `Copying the app to ${target}`);
  await ctx.run([LSREGISTER, "-f", target]);
  await ctx.run(["open", target]);
  return target;
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
  try {
    const os = await ctx.run(["uname", "-s"]);
    if (os.stdout.trim() !== "Darwin") {
      return "FlowCTL's overlay runs on macOS only for now; Linux and Windows are on the roadmap. The graph still shows in the status line.";
    }
    const existing = await findApp(ctx);
    if (existing && !options.force && compareVersions(existing.version, version) >= 0) {
      await ctx.run(["open", existing.path]);
      return `FlowCTL ${existing.version} is already installed at ${existing.path}; opened it. (/flowctl init --force installs it again.)`;
    }
    const work = (await must(ctx, ["mktemp", "-d", "-t", "flowctl"], "Making a temporary folder")).stdout.trim();
    try {
      const app = options.fromSource ? await build(ctx, work, version) : await download(ctx, work, version);
      ctx.progress?.("FlowCTL: installing…");
      const target = await place(ctx, app, existing);
      const was = existing ? ` (was ${existing.version})` : "";
      return `FlowCTL ${version} installed at ${target}${was} and opened. It shows this session's graph from the next change on.`;
    } finally {
      await ctx.run(["rm", "-rf", work]);
    }
  } catch (error) {
    const message = error instanceof Failure ? error.message : String(error);
    return `FlowCTL could not be installed: ${message}. Try again, or /flowctl init --from-source.`;
  }
}

async function download(ctx: InstallContext, work: string, version: string): Promise<string> {
  const zip = zipName(version);
  ctx.progress?.(`FlowCTL: downloading ${version}…`);
  await must(ctx, ["curl", "-fsSL", "--retry", "2", "-o", `${work}/${zip}`, releaseUrl(version, zip)], `Downloading ${zip}`, 180_000);
  await must(ctx, ["curl", "-fsSL", "--retry", "2", "-o", `${work}/${zip}.sha256`, releaseUrl(version, `${zip}.sha256`)], "Downloading its checksum", 60_000);
  ctx.progress?.("FlowCTL: checking the download…");
  const expected = digestOf((await must(ctx, ["cat", `${work}/${zip}.sha256`], "Reading the checksum")).stdout);
  const actual = digestOf((await must(ctx, ["shasum", "-a", "256", `${work}/${zip}`], "Checking the download")).stdout);
  if (expected.length !== 64 || actual !== expected) {
    throw new Failure("the download does not match its published SHA-256");
  }
  await must(ctx, ["ditto", "-x", "-k", `${work}/${zip}`, `${work}/out`], "Unzipping the app");
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
  "/flowctl init --from-source   build it from the tagged source instead (needs pnpm, Node 22 and Swift)",
  "/flowctl uninstall            remove the app"
].join("\n");
