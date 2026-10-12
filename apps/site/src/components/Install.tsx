// The two commands to install, with a copy button for each.

import { useState } from "react";
import { t } from "../i18n/index.ts";
import { usePrefs } from "./Prefs.tsx";

export const INSTALL_COMMANDS = ["/plugin install flowctl --marketplace MarcoFilho1/FlowCTL", "/flowctl init"] as const;

export function CopyLine({ command }: { command: string }) {
  const { lang } = usePrefs();
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setState("copied");
    } catch {
      setState("failed");
    }
    window.setTimeout(() => setState("idle"), 1800);
  };
  return (
    <div className="copy-line">
      <code>{command}</code>
      <button type="button" className="copy-button" onClick={copy} aria-live="polite">
        {state === "copied" ? t(lang, "install.copied") : state === "failed" ? t(lang, "install.copyFailed") : t(lang, "install.copy")}
      </button>
    </div>
  );
}

export function InstallCommands() {
  return (
    <div className="install-commands">
      {INSTALL_COMMANDS.map((command) => (
        <CopyLine key={command} command={command} />
      ))}
    </div>
  );
}
