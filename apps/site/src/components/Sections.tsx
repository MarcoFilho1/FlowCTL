// The page's sections, in reading order. Every word comes from the dictionary.

import { t, type Key } from "../i18n/index.ts";
import type { SceneId } from "../scenes/types.ts";
import { InstallCommands } from "./Install.tsx";
import { SceneDemo } from "./Demo.tsx";
import { SnailDemo } from "./SnailDemo.tsx";
import { Terminal } from "./Terminal.tsx";
import { LookSwitch, ThemeSwitch } from "./Controls.tsx";
import { usePrefs } from "./Prefs.tsx";

function Section({ id, title, children, className }: { id: string; title: string; children: React.ReactNode; className?: string }) {
  return (
    <section id={id} className={`section ${className ?? ""}`} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="section-title">
        {title}
      </h2>
      {children}
    </section>
  );
}

function useWords() {
  const { lang } = usePrefs();
  return (key: Key) => t(lang, key);
}

export function Hero() {
  const w = useWords();
  return (
    <section id="top" className="hero">
      <div className="hero-copy">
        <p className="kicker">{w("hero.kicker")}</p>
        <h1 className="hero-title">{w("hero.title")}</h1>
        <p className="hero-lead">{w("hero.lead")}</p>
        <div className="hero-actions">
          <a className="button primary" href="#install">
            {w("hero.cta.install")}
          </a>
          <a className="button" href="https://github.com/MarcoFilho1/FlowCTL" target="_blank" rel="noreferrer">
            {w("hero.cta.github")}
          </a>
        </div>
      </div>
      <figure className="hero-figure">
        <Terminal className="hero-term">
          <div className="hero-float">
            <SceneDemo id="overlay" label={w("hero.caption")} variant="float" />
          </div>
        </Terminal>
        <figcaption>{w("hero.caption")}</figcaption>
      </figure>
    </section>
  );
}

export function Problem() {
  const w = useWords();
  return (
    <Section id="problem" title={w("problem.title")}>
      <div className="split">
        <div>
          <p>{w("problem.body")}</p>
          <p>{w("problem.answer")}</p>
          <p>{w("problem.waiting")}</p>
        </div>
        <Terminal className="problem-term" />
      </div>
    </Section>
  );
}

const COLORS: Array<{ key: "pending" | "running" | "needs" | "error" | "done"; token: string }> = [
  { key: "pending", token: "--pending" },
  { key: "running", token: "--running" },
  { key: "needs", token: "--needs-you" },
  { key: "error", token: "--error" },
  { key: "done", token: "--done" }
];

export function Colors() {
  const w = useWords();
  return (
    <Section id="colors" title={w("colors.title")} className="narrow">
      <ul className="legend">
        {COLORS.map((color) => (
          <li key={color.key}>
            <span className="legend-chip" style={{ background: `var(${color.token})` }} aria-hidden="true" />
            <div>
              <strong>{w(`colors.${color.key}` as Key)}</strong>
              <span>{w(`colors.${color.key}.desc` as Key)}</span>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

interface FeatureCard {
  title: Key;
  body: Key;
  demo?: SceneId;
  tour?: boolean;
  controls?: "look" | "theme";
  note?: Key;
  /** The live snail instead of a graph demo. */
  snail?: boolean;
  /** More paragraphs, after the body. */
  more?: Key[];
  /** Across the whole grid. */
  wide?: boolean;
}

const FEATURES: FeatureCard[] = [
  { title: "features.plan.title", body: "features.plan.body", demo: "overlay" },
  { title: "features.subagents.title", body: "features.subagents.body", demo: "subagents" },
  { title: "features.followup.title", body: "features.followup.body", demo: "followup" },
  { title: "features.looks.title", body: "features.looks.body", demo: "overlay", controls: "look" },
  { title: "features.theme.title", body: "features.theme.body", demo: "overlay", controls: "theme" },
  { title: "features.hover.title", body: "features.hover.body", demo: "overlay", tour: true },
  { title: "features.idle.title", body: "features.idle.body", demo: "idle", note: "features.idle.note" },
  { title: "features.sessions.title", body: "features.sessions.body", note: "features.sessions.note" },
  { title: "features.snail.title", body: "features.snail.body", more: ["features.snailOnly.body"], snail: true, note: "features.snail.note", wide: true }
];

export function Features() {
  const w = useWords();
  return (
    <Section id="features" title={w("features.title")}>
      <p className="lead">{w("features.lead")}</p>
      <div className="feature-grid">
        {FEATURES.map((feature) => (
          <article key={feature.title} className={`feature${feature.wide ? " wide" : ""}`}>
            <h3>{w(feature.title)}</h3>
            <p>{w(feature.body)}</p>
            {feature.more?.map((key) => <p key={key}>{w(key)}</p>)}
            {feature.controls === "look" && <LookSwitch />}
            {feature.controls === "theme" && <ThemeSwitch />}
            {feature.demo && <SceneDemo id={feature.demo} label={w(feature.title)} tour={feature.tour} />}
            {feature.snail && <SnailDemo label={w(feature.title)} />}
            {feature.note && <p className="note">{w(feature.note)}</p>}
            {feature.snail && <p className="note">{w("features.snailOnly.note")}</p>}
          </article>
        ))}
      </div>
    </Section>
  );
}

export function Install() {
  const w = useWords();
  return (
    <Section id="install" title={w("install.section.title")}>
      <p className="lead">{w("install.requirements")}</p>
      <div className="install-card">
        <h3>{w("install.title")}</h3>
        <p>{w("install.lead")}</p>
        <InstallCommands />
      </div>
      <div className="steps">
        <article className="card">
          <h3>{w("install.step1.title")}</h3>
          <p>{w("install.step1.body")}</p>
        </article>
        <article className="card">
          <h3>{w("install.step2.title")}</h3>
          <p>{w("install.step2.body")}</p>
        </article>
      </div>
      <div className="split">
        <div className="card">
          <h3>{w("install.daily.title")}</h3>
          <ul className="list">
            <li>{w("install.daily.1")}</li>
            <li>{w("install.daily.2")}</li>
            <li>{w("install.daily.3")}</li>
            <li>{w("install.daily.4")}</li>
          </ul>
        </div>
        <div className="card">
          <h3>{w("install.commands.title")}</h3>
          <dl className="commands">
            <dt>
              <code>/flowctl init</code>
            </dt>
            <dd>{w("install.commands.init")}</dd>
            <dt>
              <code>/flowctl init --force</code>
            </dt>
            <dd>{w("install.commands.force")}</dd>
            <dt>
              <code>/flowctl init --from-source</code>
            </dt>
            <dd>{w("install.commands.source")}</dd>
            <dt>
              <code>/flowctl uninstall</code>
            </dt>
            <dd>{w("install.commands.uninstall")}</dd>
          </dl>
          <p className="note">{w("install.update")}</p>
        </div>
      </div>
    </Section>
  );
}

export function Privacy() {
  const w = useWords();
  return (
    <Section id="privacy" title={w("privacy.title")}>
      <ul className="list privacy">
        <li>{w("privacy.1")}</li>
        <li>{w("privacy.2")}</li>
        <li>{w("privacy.3")}</li>
        <li>{w("privacy.4")}</li>
        <li>{w("privacy.5")}</li>
      </ul>
    </Section>
  );
}

export function How() {
  const w = useWords();
  return (
    <Section id="how" title={w("how.title")}>
      <p className="lead">{w("how.lead")}</p>
      <ol className="pipeline">
        <li className="stage">
          <strong>{w("how.session")}</strong>
          <span>{w("how.session.desc")}</span>
        </li>
        <li className="arrow" aria-label={w("how.arrow.hooks")}>
          {w("how.arrow.hooks")}
        </li>
        <li className="stage">
          <strong>{w("how.plugin")}</strong>
          <span>{w("how.plugin.desc")}</span>
        </li>
        <li className="arrow" aria-label={w("how.arrow.snapshot")}>
          {w("how.arrow.snapshot")}
        </li>
        <li className="stage">
          <strong>{w("how.app")}</strong>
          <span>{w("how.app.desc")}</span>
        </li>
      </ol>
    </Section>
  );
}

/**
 * The launch video. Pass `src` (a file under public/, say /launch.mp4, and a
 * `poster`) once it is rendered; until then the page shows only a quiet line.
 */
export function LaunchVideo({ src, poster }: { src?: string; poster?: string } = {}) {
  const w = useWords();
  if (!src) {
    return (
      <p className="video-soon">
        <span>{w("video.title")}</span>
        <span>{w("video.soon")}</span>
      </p>
    );
  }
  return (
    <Section id="video" title={w("video.title")} className="narrow">
      <video className="launch-video" controls playsInline preload="metadata" src={src} poster={poster} />
    </Section>
  );
}

export function Footer() {
  const w = useWords();
  return (
    <footer className="site-footer">
      <p className="footer-star">{w("footer.star")}</p>
      <a className="button primary" href="https://github.com/MarcoFilho1/FlowCTL" target="_blank" rel="noreferrer">
        {w("footer.github")}
      </a>
      <p className="note">{w("footer.license")}</p>
      <a href="#top">{w("footer.back")}</a>
    </footer>
  );
}
