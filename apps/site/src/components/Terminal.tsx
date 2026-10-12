// A terminal full of agent output, generic on purpose: scrolling text is what a
// long session looks like before FlowCTL draws it. Decorative for screen
// readers; the words around it say what it stands for.

import type { ReactNode } from "react";
import { t } from "../i18n/index.ts";
import { usePrefs } from "./Prefs.tsx";

const LINES = 15;

export function Terminal({ children, className }: { children?: ReactNode; className?: string }) {
  const { lang } = usePrefs();
  const text = Array.from({ length: LINES }, (_, i) => t(lang, `terminal.${i + 1}` as "terminal.1")).join("\n");
  return (
    <div className={`term ${className ?? ""}`} aria-hidden="true">
      <div className="term-bar">
        <span />
        <span />
        <span />
      </div>
      <pre className="term-text">{text}</pre>
      {children}
    </div>
  );
}
