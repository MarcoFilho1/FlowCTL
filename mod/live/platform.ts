// Which system the mod runs on, as far as it needs to know: macOS and
// Windows have an overlay app; anything else (Linux, for now) does not.

export type Platform = "darwin" | "win32" | "other";

/** Windows sets OS to Windows_NT; elsewhere `uname -s` names the system. */
export function platformOf(osVariable: string | undefined, uname: string): Platform {
  if (osVariable === "Windows_NT") return "win32";
  return uname.trim() === "Darwin" ? "darwin" : "other";
}

/** The person's home folder: HOME, else USERPROFILE (Windows). */
export function homeOf(home: string | undefined, userProfile: string | undefined): string {
  return home || userProfile || "";
}
