// Carries the previous run's data over between 15-minute runs without committing every run.
//   node scripts/restore-state.mjs [--dir <folder>] [<site url>]
// --dir: the folder the last run saved to the Actions cache (works wherever the site is hosted, password or not).
// site url: the live site's data/ (used only if the cache came back empty, e.g. a public GitHub Pages site).
// Files already in the checkout (daily commit) are replaced only by newer ones (by their "updated" stamp).
import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
const args = process.argv.slice(2), di = args.indexOf("--dir");
const dir = di >= 0 ? args[di + 1] : null, base = (args.filter((a, i) => a !== "--dir" && i !== di + 1)[0] || "").replace(/\/$/, "");
const newer = (txt, p) => { try { return !existsSync(p) || (JSON.parse(txt).updated || "") >= (JSON.parse(readFileSync(p, "utf8")).updated || ""); } catch (_) { return true; } };
const put = (p, txt) => { mkdirSync(p.split("/").slice(0, -1).join("/"), { recursive: true }); writeFileSync(p, txt); };

if (dir && existsSync(dir)) {
  const files = [], walk = d => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f.endsWith(".json")) files.push(p.slice(dir.length + 1)); } };
  walk(dir);
  let n = 0;
  for (const f of files) { const txt = readFileSync(join(dir, f), "utf8"), p = `data/${f}`; if (newer(txt, p)) { put(p, txt); n++; } }
  if (files.length) { console.log(`restored ${n} of ${files.length} data files from the last run (cache)`); process.exit(0); }
}
if (!base) { console.log("no cached run and no site url; starting from the committed data"); process.exit(0); }
const idx = await fetch(`${base}/data/index.json`).then(r => r.ok ? r.json() : null).catch(() => null);
if (!idx?.files) { console.log("site has no data index (or it's password-protected); starting from the committed data"); process.exit(0); }
let n = 0;
for (const f of idx.files) {
  const r = await fetch(`${base}/data/${f}`).catch(() => null);
  if (!r?.ok) continue;
  const txt = await r.text(), p = `data/${f}`;
  if (newer(txt, p)) { put(p, txt); n++; }
}
console.log(`restored ${n} of ${idx.files.length} data files from the site`);
