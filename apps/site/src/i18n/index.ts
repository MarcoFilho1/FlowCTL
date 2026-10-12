// Languages of the page: Portuguese and English. The browser's language picks
// the default (any Portuguese locale is Portuguese); the switch overrides it.

import type { HoverLabels } from "../../../viewer/src/hover.ts";
import { en } from "./en.ts";
import { pt, type Key } from "./pt.ts";

export type { Key };

export type Lang = "pt" | "en";
export const LANGS: readonly Lang[] = ["pt", "en"];

const DICTS: Record<Lang, Record<Key, string>> = { pt, en };

/** The text for a key, with `{name}` replaced by the variables given. */
export function t(lang: Lang, key: Key, vars: Record<string, string | number> = {}): string {
  return DICTS[lang][key].replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

/** Portuguese for any `pt` locale (pt-BR, pt-PT), English for the rest. */
export function detectLang(language: string | undefined): Lang {
  return language?.toLowerCase().startsWith("pt") ? "pt" : "en";
}

/**
 * The viewer's hover card and labels in the page's language. The viewer keeps
 * its own English default; the page hands it these words.
 */
export function hoverLabels(lang: Lang): HoverLabels {
  const say = (key: Key, vars?: Record<string, string | number>) => t(lang, key, vars);
  return {
    kind: { task: say("hover.kind.task"), agent: say("hover.kind.agent"), turn: say("hover.kind.turn") },
    status: {
      pending: say("colors.pending"),
      running: say("colors.running"),
      needs_you: say("colors.needs"),
      error: say("colors.error"),
      done: say("colors.done")
    },
    done: (kind, took) => (took ? say("hover.done.took", { kind, took }) : say("hover.done", { kind })),
    failed: (kind) => say("hover.failed", { kind }),
    question: say("hover.question"),
    permission: say("hover.permission"),
    running: say("hover.running"),
    waitingOn: (titles) => say("hover.waitingOn", { titles }),
    paused: say("hover.paused"),
    notStarted: say("hover.notStarted"),
    skipped: say("hover.skipped"),
    lastError: (detail, ago) => (ago ? say("hover.lastError.ago", { detail, ago }) : say("hover.lastError", { detail })),
    graph: (nodes) => say("hover.graph", { n: nodes }),
    outOfView: say("hover.outOfView")
  };
}
