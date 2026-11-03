// Bundles the app into dist/ for GitHub Pages and copies data/ (with an index so the next run can restore it).
import { build } from "esbuild";
import { mkdirSync, copyFileSync, cpSync, existsSync, readdirSync, statSync, writeFileSync } from "fs";
mkdirSync("dist", { recursive: true });
await build({ entryPoints: ["src/main.jsx"], bundle: true, minify: true, outfile: "dist/app.js", format: "iife", jsx: "automatic", loader: { ".jsx": "jsx" }, define: { "process.env.NODE_ENV": '"production"' }, logLevel: "info" });
copyFileSync("index.html", "dist/index.html");
if (existsSync("data")) {
  cpSync("data", "dist/data", { recursive: true });
  const files = [], walk = d => { for (const f of readdirSync(d)) { const p = `${d}/${f}`; if (statSync(p).isDirectory()) walk(p); else if (f.endsWith(".json")) files.push(p.slice(5)); } };
  walk("data");
  writeFileSync("dist/data/index.json", JSON.stringify({ files, built: new Date().toISOString() }));
}
