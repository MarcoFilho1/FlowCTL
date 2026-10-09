import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { inlineBundle } from "./inline-bundle.ts";

export default defineConfig({
  base: "./",
  plugins: [react(), inlineBundle()],
  server: {
    // The viewer reads mod/graph and fixtures/ from the repository root.
    fs: { allow: ["../.."] }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    rolldownOptions: { output: { codeSplitting: false } }
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"]
  }
});
