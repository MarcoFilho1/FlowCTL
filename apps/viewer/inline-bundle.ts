import type { Plugin } from "vite";

/**
 * Inlines the built script and stylesheet into index.html, so the bundle is
 * one file that opens over file:// (the overlay's WKWebView, or a browser:
 * Chrome refuses `<script type="module" src>` from a file:// page). Needs a
 * single chunk, which `codeSplitting: false` gives.
 */
export function inlineBundle(): Plugin {
  return {
    name: "flowctl-inline-bundle",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      const html = Object.values(bundle).find((file) => file.fileName === "index.html");
      if (!html || html.type !== "asset") return;
      let page = String(html.source);

      for (const file of Object.values(bundle)) {
        if (file.type === "chunk" && file.isEntry) {
          const code = file.code.replace(/<\/script/gi, "<\\/script");
          page = page.replace(
            new RegExp(`<script type="module" crossorigin src="[^"]*${escape(file.fileName)}"></script>`),
            () => `<script type="module">${code}</script>`
          );
          delete bundle[file.fileName];
        } else if (file.type === "asset" && file.fileName.endsWith(".css")) {
          const css = String(file.source).replace(/<\/style/gi, "<\\/style");
          page = page.replace(
            new RegExp(`<link rel="stylesheet" crossorigin href="[^"]*${escape(file.fileName)}">`),
            () => `<style>${css}</style>`
          );
          delete bundle[file.fileName];
        }
      }
      html.source = page;
    }
  };
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
