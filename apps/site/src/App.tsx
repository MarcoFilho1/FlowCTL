import { SiteHeader } from "./components/Controls.tsx";
import { PrefsProvider } from "./components/Prefs.tsx";
import { Colors, Features, Footer, Hero, Install, How, LaunchVideo, Privacy, Problem } from "./components/Sections.tsx";

export function App() {
  return (
    <PrefsProvider>
      <SiteHeader />
      <main>
        <Hero />
        <Problem />
        <Colors />
        <Features />
        <Install />
        <Privacy />
        <How />
        <LaunchVideo />
      </main>
      <Footer />
    </PrefsProvider>
  );
}
