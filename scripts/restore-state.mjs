// Pulls the previous run's data files from the live site so state carries over between 15-minute runs
// without committing every run. Files already in the checkout (daily commit) are replaced only by newer ones.
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "fs";
const base = (process.argv[2] || "").replace(/\/$/, "");
if (!base) { console.log("no site url yet; starting from the committed data"); process.exit(0); }
const idx = await fetch(`${base}/data/index.json`).then(r => r.ok ? r.json() : null).catch(() => null);
if (!idx?.files) { console.log("site has no data index yet"); process.exit(0); }
let n = 0;
for (const f of idx.files) {
  const r = await fetch(`${base}/data/${f}`).catch(() => null);
  if (!r?.ok) continue;
  const txt = await r.text(), p = `data/${f}`;
  const newer = () => { try { return !existsSync(p) || (JSON.parse(txt).updated || "") >= (JSON.parse(readFileSync(p, "utf8")).updated || ""); } catch (_) { return true; } };
  if (newer()) { mkdirSync(p.split("/").slice(0, -1).join("/"), { recursive: true }); writeFileSync(p, txt); n++; }
}
console.log(`restored ${n} of ${idx.files.length} data files from the site`);
