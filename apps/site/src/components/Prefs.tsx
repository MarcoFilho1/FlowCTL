// The page's choices: language, theme, look and sound. Language, theme and look
// are remembered in this browser; sound only for this visit (browsers want a
// click before they play anything, so it starts off). A ?lang=, ?theme=, ?look=
// in the address sets the choice for that visit.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { play } from "../../../viewer/src/sound.ts";
import type { Look, Theme } from "../../../viewer/src/store.ts";
import { detectLang, LANGS, t, type Lang } from "../i18n/index.ts";

export interface Prefs {
  lang: Lang;
  setLang(lang: Lang): void;
  theme: Theme;
  setTheme(theme: Theme): void;
  look: Look;
  setLook(look: Look): void;
  sound: boolean;
  setSound(on: boolean): void;
}

const KEYS = { lang: "flowctl-site.lang", theme: "flowctl-site.theme", look: "flowctl-site.look", sound: "flowctl-site.sound" };
const THEMES: readonly Theme[] = ["auto", "dark", "light"];
const LOOKS: readonly Look[] = ["pixel", "smooth"];

/** Reads and writes that may be refused (private windows, blocked storage): the choice then lasts this visit. */
function stored(kind: "localStorage" | "sessionStorage"): Storage | undefined {
  try {
    return window[kind];
  } catch {
    return undefined;
  }
}

function read(kind: "localStorage" | "sessionStorage", key: string): string | null {
  try {
    return stored(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(kind: "localStorage" | "sessionStorage", key: string, value: string): void {
  try {
    stored(kind)?.setItem(key, value);
  } catch {
    // Nothing to do: the page works without remembering the choice.
  }
}

/** The first valid value among the address's, the remembered one, and the fallback. */
function pick<T extends string>(param: string, options: readonly T[], remembered: string | null, fallback: T): T {
  const fromUrl = new URLSearchParams(window.location.search).get(param);
  const candidates = [fromUrl, remembered];
  return (candidates.find((value): value is T => value !== null && (options as readonly string[]).includes(value)) ?? fallback) as T;
}

const PrefsContext = createContext<Prefs | null>(null);

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() =>
    pick<Lang>("lang", LANGS, read("localStorage", KEYS.lang), detectLang(navigator.language))
  );
  const [theme, setThemeState] = useState<Theme>(() => pick<Theme>("theme", THEMES, read("localStorage", KEYS.theme), "dark"));
  const [look, setLookState] = useState<Look>(() => pick<Look>("look", LOOKS, read("localStorage", KEYS.look), "pixel"));
  const [sound, setSoundState] = useState(() => read("sessionStorage", KEYS.sound) === "on");

  // The page's own words and palette follow the choices.
  useEffect(() => {
    document.documentElement.lang = lang === "pt" ? "pt-BR" : "en";
    document.documentElement.dataset["theme"] = theme;
    document.title = t(lang, "meta.title");
    document.querySelector('meta[name="description"]')?.setAttribute("content", t(lang, "meta.description"));
  }, [lang, theme]);

  const prefs: Prefs = {
    lang,
    setLang(next) {
      setLangState(next);
      write("localStorage", KEYS.lang, next);
    },
    theme,
    // The sound of the look on screen, so a change of theme is heard too.
    setTheme(next) {
      if (next === theme) return;
      setThemeState(next);
      write("localStorage", KEYS.theme, next);
      if (sound) play("done", look);
    },
    look,
    setLook(next) {
      if (next === look) return;
      setLookState(next);
      write("localStorage", KEYS.look, next);
      if (sound) play("appear", next);
    },
    sound,
    setSound(on) {
      setSoundState(on);
      write("sessionStorage", KEYS.sound, on ? "on" : "off");
      // Turning sound on is the click the browser needs before any sound plays.
      if (on) play("start", look);
    }
  };
  return <PrefsContext.Provider value={prefs}>{children}</PrefsContext.Provider>;
}

export function usePrefs(): Prefs {
  const prefs = useContext(PrefsContext);
  if (!prefs) throw new Error("usePrefs outside PrefsProvider");
  return prefs;
}
