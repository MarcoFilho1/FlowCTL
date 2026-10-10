import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The site draws the viewer's own components and styles, so Vite may read the
// repository root (the viewer's sources and the plugin's graph code live there).
export default defineConfig({
  plugins: [react()],
  server: {
    fs: { allow: ["../.."] }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});
