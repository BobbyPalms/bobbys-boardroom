// Bundles the app into dist/ for GitHub Pages and copies data/ (with an index so the next run can restore it).
import { build } from "esbuild";
import { mkdirSync, cpSync, existsSync, readdirSync, statSync, writeFileSync, readFileSync } from "fs";
import { createHash } from "crypto";
import { join } from "path";
mkdirSync("dist", { recursive: true });
// build id: a hash of the sources, so caches on the device are dropped when the model changes
const srcHash = createHash("sha256");
for (const f of readdirSync("src").sort()) srcHash.update(f).update(readFileSync(join("src", f)));
const buildId = srcHash.digest("hex").slice(0, 10);
await build({ entryPoints: ["src/main.jsx"], bundle: true, minify: true, outfile: "dist/app.js", format: "iife", jsx: "automatic", loader: { ".jsx": "jsx" }, define: { "process.env.NODE_ENV": '"production"', __BUILD__: JSON.stringify(buildId) }, logLevel: "info" });
// cache-bust: the page asks for app.js?v=<content hash>, so a new build is never served from an old cache
const hash = createHash("sha256").update(readFileSync("dist/app.js")).digest("hex").slice(0, 12);
writeFileSync("dist/index.html", readFileSync("index.html", "utf8").replace('src="app.js"', `src="app.js?v=${hash}"`));
if (existsSync("data")) {
  cpSync("data", "dist/data", { recursive: true });
  const files = [], walk = d => { for (const f of readdirSync(d)) { const p = `${d}/${f}`; if (statSync(p).isDirectory()) walk(p); else if (f.endsWith(".json")) files.push(p.slice(5)); } };
  walk("data");
  writeFileSync("dist/data/index.json", JSON.stringify({ files, built: new Date().toISOString() }));
}
