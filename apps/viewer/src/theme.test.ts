import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const css = readFileSync(join(__dirname, "styles.css"), "utf8");

/** The custom properties a rule block declares, in order. */
function tokens(block: string): string[] {
  return [...block.matchAll(/--[\w-]+:\s*[^;]+;/g)].map((m) => m[0].replace(/\s+/g, " "));
}

describe("theme tokens", () => {
  test("the chosen dark theme is the same palette as macOS's dark mode", () => {
    const media = css.match(/:root:not\(\[data-theme="light"\]\) \{([^}]*)\}/)?.[1] ?? "";
    const chosen = css.match(/:root\[data-theme="dark"\] \{([^}]*)\}/)?.[1] ?? "";
    expect(tokens(media).length).toBeGreaterThan(10);
    expect(tokens(chosen)).toEqual(tokens(media));
  });
});
