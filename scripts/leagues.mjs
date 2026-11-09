// npm run leagues: re-pull every sport and league ESPN lists (core API) and rewrite src/leagues.js.
// New leagues land on their sport's tab automatically (src/routes.js routes every catalog league).
import { writeFileSync } from "fs";
const CORE = "https://sports.core.api.espn.com/v2/sports";
const UA = { "User-Agent": "bobbys-boardroom-data-job/1.0", Accept: "application/json" };
async function get(url) {
  for (let i = 0; i < 3; i++) {
    try { const r = await fetch(url.replace(/^http:/, "https:"), { headers: UA }); if (r.ok) return await r.json(); } catch (_) { /* retry */ }
    await new Promise(r => setTimeout(r, 800 * (i + 1)));
  }
  return null;
}
async function pool(items, n, fn) { const out = []; let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } })); return out; }

const sports = (await get(`${CORE}?limit=200`))?.items || [];
if (!sports.length) { console.error("couldn't read the sports list"); process.exit(1); }
const C = {};
for (const it of sports) {
  const sp = await get(it.$ref);
  if (!sp?.slug) continue;
  const ls = (await get(`${CORE}/${sp.slug}/leagues?limit=1000`))?.items || [];
  C[sp.slug] = (await pool(ls, 10, async x => { const d = await get(x.$ref); return d?.slug ? [d.slug, Number(d.id), String(d.name || d.slug)] : null; })).filter(Boolean);
}
const date = new Date().toISOString().slice(0, 10);
let out = `// Every league ESPN lists, by ESPN sport: [route slug, ESPN league id, name]. Pulled from the core API\n// (sports.core.api.espn.com/v2/sports/{sport}/leagues) on ${date}. Refresh with \`npm run leagues\` (scripts/leagues.mjs).\n// The league id is how a sport-wide "all" scoreboard tags each game (uid "s:600~l:3918~e:...").\n// Cricket is listed as a sport but ESPN lists no cricket leagues, so it has nothing to route.\nexport const CATALOG = {\n`;
for (const [k, v] of Object.entries(C).sort(([a], [b]) => a.localeCompare(b))) out += `  ${JSON.stringify(k)}: [\n${v.map(r => "    " + JSON.stringify(r) + ",").join("\n")}${v.length ? "\n" : ""}  ],\n`;
out += "};\n";
writeFileSync("src/leagues.js", out);
console.log(Object.entries(C).map(([k, v]) => `${k} ${v.length}`).join(", "));
console.log("A sport ESPN adds that the app has no tab for yet needs one in src/routes.js (ROUTES) and src/boardroom.jsx (SPORT_CFG, LEAGUE, SCHED).");
