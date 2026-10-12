// Keeps the repository's numbers past GitHub's 14 days: views and unique
// visitors per day, clones per day, where visitors came from, release
// downloads per file (one per `/flowctl init`, by OS) and stars.
//
//   GITHUB_TOKEN=… node scripts/traffic.mjs [dir]      (default dir: stats)
//
// Merges what GitHub reports now into <dir>/traffic.json (days already there
// keep their numbers unless GitHub reports more) and writes <dir>/README.md,
// a summary to read on GitHub. Run daily by .github/workflows/traffic.yml;
// locally, `GITHUB_TOKEN=$(gh auth token) node scripts/traffic.mjs` works too.
//
// The traffic endpoints need a token that can administer the repository:
// a fine-grained token with "Administration: Read-only" on it, or `gh`'s own.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REPO = process.env.GITHUB_REPOSITORY ?? "MarcoFilho1/FlowCTL";
const TOKEN = process.env.GITHUB_TOKEN;
const DIR = process.argv[2] ?? "stats";

if (!TOKEN) {
  console.error("Set GITHUB_TOKEN (a token that can administer the repository).");
  process.exit(1);
}

async function api(path) {
  const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    headers: { authorization: `Bearer ${TOKEN}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" }
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

const today = new Date().toISOString().slice(0, 10);
const file = join(DIR, "traffic.json");
const data = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { views: {}, clones: {}, snapshots: {} };

const [repo, views, clones, referrers, paths, releases] = await Promise.all([
  api(""),
  api("/traffic/views"),
  api("/traffic/clones"),
  api("/traffic/popular/referrers"),
  api("/traffic/popular/paths"),
  api("/releases?per_page=100")
]);

// A day's numbers only grow while GitHub still reports it (today is partial).
const merge = (into, days) => {
  for (const { timestamp, count, uniques } of days) {
    const day = timestamp.slice(0, 10);
    const had = into[day] ?? { count: 0, uniques: 0 };
    into[day] = { count: Math.max(had.count, count), uniques: Math.max(had.uniques, uniques) };
  }
};
merge(data.views, views.views);
merge(data.clones, clones.clones);

const downloads = {};
for (const release of releases) {
  for (const asset of release.assets) {
    if (asset.name.endsWith(".zip")) downloads[`${release.tag_name} ${asset.name}`] = asset.download_count;
  }
}
data.snapshots[today] = {
  stars: repo.stargazers_count,
  forks: repo.forks_count,
  watchers: repo.subscribers_count,
  // GitHub's own unique counts over its last 14 days (daily uniques can't be added up).
  uniqueVisitors14d: views.uniques,
  uniqueCloners14d: clones.uniques,
  referrers: referrers.map(({ referrer, count, uniques }) => ({ referrer, count, uniques })),
  paths: paths.map(({ path, count, uniques }) => ({ path, count, uniques })),
  downloads
};

const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
data.views = sorted(data.views);
data.clones = sorted(data.clones);
data.snapshots = sorted(data.snapshots);
mkdirSync(DIR, { recursive: true });
writeFileSync(file, JSON.stringify(data, null, 2) + "\n");

// MARK: the summary
const sum = (o, key) => Object.values(o).reduce((n, d) => n + d[key], 0);
const now = data.snapshots[today];
const os = (name) => (name.includes("macos") ? "macOS" : name.includes("windows") ? "Windows" : "other");
const byOs = {};
for (const [name, count] of Object.entries(now.downloads)) byOs[os(name)] = (byOs[os(name)] ?? 0) + count;
const days = Object.keys(data.views);
const table = (rows, head) => [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");

const summary = `# FlowCTL in numbers

Updated ${today} by \`scripts/traffic.mjs\`. GitHub keeps traffic for 14 days;
this file keeps it from ${days[0] ?? today} on. The site's visitors are in
Vercel (the project's Analytics tab).

## Totals

${table(
  [
    ["Repository views", sum(data.views, "count")],
    ["Unique visitors, last 14 days (GitHub)", now.uniqueVisitors14d],
    ["Clones (plugin installs and updates, CI included)", sum(data.clones, "count")],
    ["App downloads (one per \`/flowctl init\`)", Object.values(byOs).reduce((a, b) => a + b, 0)],
    ...Object.entries(byOs).map(([name, n]) => [`↳ ${name}`, n]),
    ["Stars", now.stars],
    ["Forks", now.forks]
  ],
  ["", "Count"]
)}

## Where visitors came from (last 14 days)

${now.referrers.length ? table(now.referrers.map((r) => [r.referrer, r.count, r.uniques]), ["Site", "Views", "Unique"]) : "Nobody yet."}

## Per day

${table(
  days
    .slice()
    .reverse()
    .map((day) => [day, data.views[day].count, data.views[day].uniques, data.clones[day]?.count ?? 0]),
  ["Day", "Views", "Unique visitors", "Clones"]
)}
`;
writeFileSync(join(DIR, "README.md"), summary);
console.log(`${DIR}/traffic.json and ${DIR}/README.md updated (${days.length} days)`);
