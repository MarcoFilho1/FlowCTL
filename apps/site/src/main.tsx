import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Page views on Vercel (no cookies); see the project's Analytics tab.
import { Analytics } from "@vercel/analytics/react";
import "@fontsource/pixelify-sans/400.css";
import "@fontsource/pixelify-sans/600.css";
import "@fontsource/silkscreen/400.css";
// The viewer's own styles: the graph's look (pixel and smooth), its colors and its motion rules.
import "../../viewer/src/styles.css";
import "./styles/site.css";
import { App } from "./App.tsx";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
      <Analytics />
    </StrictMode>
  );
}
