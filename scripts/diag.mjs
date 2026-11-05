// Diagnose one matchup: run the same engine the site uses and print every input behind its numbers.
//   node scripts/diag.mjs <SPORT> "<away>" "<home>"
import { build } from "esbuild";
import { mkdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
const [sport, away, home] = process.argv.slice(2), ROOT = process.cwd(), LOCAL = "https://data.local/";
const mem = new Map();
globalThis.localStorage = { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k), key: i => [...mem.keys()][i] ?? null, get length() { return mem.size; }, clear: () => mem.clear() };
globalThis.location = { protocol: "https:", href: LOCAL };
const net = globalThis.fetch;
globalThis.fetch = async (url, o = {}) => { const s = String(url); if (s.startsWith(LOCAL)) { const p = join(ROOT, decodeURIComponent(s.slice(LOCAL.length).split("?")[0])); return existsSync(p) ? new Response(readFileSync(p), { status: 200 }) : new Response("", { status: 404 }); } return net(url, { ...o, headers: { "User-Agent": "bobbys-boardroom-diag/1.0", ...(o.headers || {}) } }); };
mkdirSync(join(ROOT, ".cache"), { recursive: true });
const out = join(ROOT, ".cache", "diag.mjs");
await build({ entryPoints: [join(ROOT, "src/boardroom.jsx")], bundle: true, platform: "node", format: "esm", outfile: out, jsx: "automatic", loader: { ".jsx": "jsx" }, define: { "process.env.NODE_ENV": '"production"', __BUILD__: '"diag"' }, logLevel: "warning" });
const { engine: E } = await import(out);
const md = await E.fetchMatchup(sport, away, home, false);
const plan = E.buildPlan(md.home, md.away, sport, md, {});
const t = x => ({ name: x.name, abbr: x.abbr, id: x.espnId || x.id, rec: x.record, gp: x.gp, gpg: x.gpg, gaa: x.gaa, has: x.has, prev: x.prev, hist: (x.hist || []).slice(-3) });
console.log(JSON.stringify({ sport, L: plan.L, leagueGpg: md.league?.gpg, live: md.live || null, away: t(md.away), home: t(md.home), advAway: md.advancedAway || null, advHome: md.advancedHome || null,
  parts: { away: { off: plan.parts.away.off, def: plan.parts.away.def }, home: { off: plan.parts.home.off, def: plan.parts.home.def } }, muA: plan.muA, muH: plan.muH, learn: plan.learn, teamAdj: plan.teamAdj, factors: plan.factors?.display }, null, 1));
