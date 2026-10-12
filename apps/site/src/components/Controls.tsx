// The top bar: the wordmark, the section links, and the four switches (language,
// theme, look, sound). Each switch is a plain button group, so it reads the same
// with a keyboard or a screen reader.

import type { Look, Theme } from "../../../viewer/src/store.ts";
import { LANGS, t, type Key, type Lang } from "../i18n/index.ts";
import { usePrefs } from "./Prefs.tsx";

interface Option<T extends string> {
  value: T;
  label: string;
}

function Segmented<T extends string>({ label, options, value, onChange }: { label: string; options: Option<T>[]; value: T; onChange(next: T): void }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="segmented-option"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function LanguageSwitch() {
  const { lang, setLang } = usePrefs();
  return (
    <Segmented<Lang>
      label={t(lang, "control.language")}
      value={lang}
      options={LANGS.map((code) => ({ value: code, label: code === "pt" ? "PT" : "EN" }))}
      onChange={setLang}
    />
  );
}

export function ThemeSwitch() {
  const { lang, theme, setTheme } = usePrefs();
  return (
    <Segmented<Theme>
      label={t(lang, "control.theme")}
      value={theme}
      options={[
        { value: "auto", label: t(lang, "control.theme.auto") },
        { value: "dark", label: t(lang, "control.theme.dark") },
        { value: "light", label: t(lang, "control.theme.light") }
      ]}
      onChange={setTheme}
    />
  );
}

export function LookSwitch() {
  const { lang, look, setLook } = usePrefs();
  return (
    <Segmented<Look>
      label={t(lang, "control.look")}
      value={look}
      options={[
        { value: "pixel", label: t(lang, "control.look.pixel") },
        { value: "smooth", label: t(lang, "control.look.smooth") }
      ]}
      onChange={setLook}
    />
  );
}

export function SoundToggle() {
  const { lang, sound, setSound } = usePrefs();
  return (
    <button type="button" className="sound-toggle" aria-pressed={sound} title={t(lang, "control.sound.hint")} onClick={() => setSound(!sound)}>
      <span className={`sound-dot${sound ? " on" : ""}`} aria-hidden="true" />
      {sound ? t(lang, "control.sound.on") : t(lang, "control.sound.off")}
    </button>
  );
}

/** The four switches: language, theme, look and sound. */
export function Switches() {
  return (
    <div className="switches">
      <LanguageSwitch />
      <ThemeSwitch />
      <LookSwitch />
      <SoundToggle />
    </div>
  );
}

export function SiteHeader() {
  const { lang } = usePrefs();
  const links: Array<{ href: string; key: Key }> = [
    { href: "#problem", key: "nav.problem" },
    { href: "#features", key: "nav.features" },
    { href: "#install", key: "nav.install" },
    { href: "#privacy", key: "nav.privacy" }
  ];
  return (
    <header className="site-header">
      <div className="site-header-row">
        <a className="wordmark" href="#top" aria-label="FlowCTL">
          <span className="wordmark-mark" aria-hidden="true" />
          FlowCTL
        </a>
        <nav aria-label={t(lang, "nav.label")} className="site-nav">
          {links.map((link) => (
            <a key={link.href} href={link.href}>
              {t(lang, link.key)}
            </a>
          ))}
          <a href="https://github.com/MarcoFilho1/FlowCTL" target="_blank" rel="noreferrer">
            {t(lang, "nav.github")}
          </a>
        </nav>
      </div>
      <Switches />
    </header>
  );
}
