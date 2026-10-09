import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import { inlineBundle } from "./inline-bundle.ts";

/**
 * FLOWCTL_NO_FIXTURES=1 builds the overlay's bundle: the recorded fixtures
 * (`?fixture=`, dev only) are left out by emptying their glob in player.ts.
 */
function withoutFixtures(): Plugin {
  const glob = /import\.meta\.glob\(\s*"\.\.\/\.\.\/\.\.\/fixtures\/\*\.jsonl"[\s\S]*?\}\s*\)/;
  return {
    name: "flowctl-without-fixtures",
    enforce: "pre",
    transform(code, id) {
      if (!id.endsWith("/src/player.ts")) return null;
      if (!glob.test(code)) this.error("player.ts no longer has the fixtures glob this plugin removes");
      return { code: code.replace(glob, "({})"), map: null };
    }
  };
}

const noFixtures = process.env["FLOWCTL_NO_FIXTURES"] === "1";

export default defineConfig({
  base: "./",
  plugins: [...(noFixtures ? [withoutFixtures()] : []), react(), inlineBundle()],
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
