import { expect, test } from "vitest";
import { ENGLISH_LABELS, hoverCard } from "../../../viewer/src/hover.ts";
import { agent, snapshotOf, task } from "../../../viewer/src/goldens.ts";
import { detectLang, hoverLabels, LANGS, t } from "./index.ts";
import { en } from "./en.ts";
import { pt, type Key } from "./pt.ts";

const keys = (dict: object) => Object.keys(dict).sort();

test("Portuguese and English have exactly the same keys", () => {
  expect(keys(en)).toEqual(keys(pt));
});

test("every text is filled in both languages", () => {
  for (const dict of [pt, en] as Array<Record<string, string>>) {
    for (const [key, value] of Object.entries(dict)) expect(value.trim(), key).not.toBe("");
  }
});

test("every placeholder is filled by the variables the page passes", () => {
  const vars = { kind: "K", took: "T", titles: "X", detail: "D", ago: "A", n: 3 };
  for (const lang of LANGS) {
    for (const key of keys(pt) as Key[]) {
      expect(t(lang, key, vars), `${lang} ${key}`).not.toMatch(/\{\w+\}/);
    }
  }
});

test("the browser's language picks the default", () => {
  expect(detectLang("pt-BR")).toBe("pt");
  expect(detectLang("pt")).toBe("pt");
  expect(detectLang("en-US")).toBe("en");
  expect(detectLang("fr-FR")).toBe("en");
  expect(detectLang(undefined)).toBe("en");
});

test("the hover card in English says what the viewer says by default", () => {
  const labels = hoverLabels("en");
  expect(labels.done("Subagent", "42s")).toBe(ENGLISH_LABELS.done("Subagent", "42s"));
  expect(labels.done("Step")).toBe(ENGLISH_LABELS.done("Step"));
  expect(labels.lastError("Exit code 1", "5s")).toBe(ENGLISH_LABELS.lastError("Exit code 1", "5s"));
  expect(labels.waitingOn("Build, Lint")).toBe(ENGLISH_LABELS.waitingOn("Build, Lint"));
  expect(labels.graph(4)).toBe(ENGLISH_LABELS.graph(4));
  expect(labels.outOfView).toBe(ENGLISH_LABELS.outOfView);
  const node = agent("a", undefined, { status: "done", title: "Review cart", startedAt: 1_000, finishedAt: 43_000, summary: "Found 2 issues." });
  expect(hoverCard(node, snapshotOf([node]), labels)).toEqual(hoverCard(node, snapshotOf([node])));
});

test("the hover card in Portuguese reads in Portuguese", () => {
  const node = task("a", { status: "pending", title: "Build", blockedBy: [] });
  const waiting = task("b", { status: "pending", title: "Ship", blockedBy: ["a"] });
  const card = hoverCard(waiting, snapshotOf([node, waiting]), hoverLabels("pt"));
  expect(card.status).toBe("Aguardando Build");
});
