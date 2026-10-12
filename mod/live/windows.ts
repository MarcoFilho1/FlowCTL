// The Windows commands of the install flow, as argument vectors (no shell).
// PowerShell does what the Mac tools do: a version, a hash, a copy, a
// shortcut. Paths are written with backslashes, as a person sees them.

export const WIN_EXE = "FlowCTL.exe";
export const CURL = "curl.exe";
export const TAR = "tar.exe";
/** Closes the app; a failure (it is not running) is fine. */
export const KILL_APP = ["taskkill", "/IM", WIN_EXE, "/F"];

/** The release zip of a version: FlowCTL-X.Y.Z-windows-x64.zip. */
export function winZipName(version: string): string {
  return `FlowCTL-${version}-windows-x64.zip`;
}

/** A PowerShell single-quoted string: quotes doubled, so a path stays one argument. */
export function psQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/** One PowerShell command, with no profile and no prompts. */
export function powershell(command: string): string[] {
  return ["powershell", "-NoProfile", "-NonInteractive", "-Command", command];
}

/** Where the app is installed: %LOCALAPPDATA%\Programs\FlowCTL. */
export function installDir(localAppData: string): string {
  return `${localAppData}\\Programs\\FlowCTL`;
}

export function installedExe(localAppData: string): string {
  return `${installDir(localAppData)}\\${WIN_EXE}`;
}

/** The Start menu shortcut, in %APPDATA%. */
export function startMenuShortcut(appData: string): string {
  return `${appData}\\Microsoft\\Windows\\Start Menu\\Programs\\FlowCTL.lnk`;
}

export function versionOf(exe: string): string[] {
  return powershell(`(Get-Item -LiteralPath ${psQuote(exe)}).VersionInfo.ProductVersion`);
}

/** The SHA-256 hex digest of a file, upper case. */
export function hashOf(file: string): string[] {
  return powershell(`(Get-FileHash -Algorithm SHA256 -LiteralPath ${psQuote(file)}).Hash`);
}

export function readText(file: string): string[] {
  return powershell(`Get-Content -Raw -LiteralPath ${psQuote(file)}`);
}

export function makeDir(dir: string): string[] {
  return powershell(`New-Item -ItemType Directory -Force -Path ${psQuote(dir)} | Out-Null`);
}

/**
 * Takes the update lock: makes `dir`, failing when it is there (another
 * session is updating). A lock older than ten minutes was left by an update
 * that never finished; it is taken over.
 */
export function takeLock(dir: string): string[] {
  const d = psQuote(dir);
  return powershell(
    `if ((Test-Path -LiteralPath ${d}) -and ((Get-Item -LiteralPath ${d}).LastWriteTime -lt (Get-Date).AddMinutes(-10))) { Remove-Item -LiteralPath ${d} -Recurse -Force }; ` +
      `New-Item -ItemType Directory -Path ${d} -ErrorAction Stop | Out-Null`
  );
}

export function copyFile(from: string, to: string): string[] {
  return powershell(`Copy-Item -LiteralPath ${psQuote(from)} -Destination ${psQuote(to)} -Force`);
}

export function shortcut(lnk: string, target: string, workDir: string): string[] {
  return powershell(
    `$s = (New-Object -ComObject WScript.Shell).CreateShortcut(${psQuote(lnk)}); ` +
      `$s.TargetPath = ${psQuote(target)}; $s.WorkingDirectory = ${psQuote(workDir)}; $s.Save()`
  );
}

export function startProcess(exe: string): string[] {
  return powershell(`Start-Process -FilePath ${psQuote(exe)}`);
}

/** Removes the install folder, and the shortcut when there is one. */
export function removeInstall(dir: string, lnk: string | undefined): string[] {
  const shortcutPart = lnk === undefined ? "" : `; Remove-Item -LiteralPath ${psQuote(lnk)} -Force -ErrorAction SilentlyContinue`;
  return powershell(`Remove-Item -LiteralPath ${psQuote(dir)} -Recurse -Force${shortcutPart}`);
}

export function removeTree(dir: string): string[] {
  return removeInstall(dir, undefined);
}

/** The pid of the process that started this PowerShell: the Claude Code process. */
export function parentPid(): string[] {
  return powershell('(Get-CimInstance Win32_Process -Filter "ProcessId=$PID").ParentProcessId');
}
