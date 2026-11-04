// Background results tracker, run by the GitHub data job after the data update. Nobody has to open the site.
//   1. prices every game on today's board with the same engine the site uses, and logs it before it starts
//      (each run re-logs it, so the record kept is the last one before first pitch / tip-off / kick-off),
//   2. grades every started game from the final score on the scoreboard route,
//   3. learns from every graded game and writes data/learned.json, which the site reads on load.
// Records live in data/track/<SPORT>/<YYYY-MM>.json (past months stop changing, so the daily commit stays small).
import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";

const ROOT = process.cwd(), LOCAL = "https://data.local/";
const UA = { "User-Agent": "bobbys-boardroom-data-job/1.0", Accept: "application/json" };

// ---- the engine runs here as it does in the browser: storage in memory, data/ read from disk ----
const mem = new Map();
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { mem.set(k, String(v)); }, removeItem: k => { mem.delete(k); },
  key: i => [...mem.keys()][i] ?? null, get length() { return mem.size; }, clear: () => mem.clear(),
};
globalThis.location = { protocol: "https:", href: LOCAL };
const netFetch = globalThis.fetch;
let calls = 0, fails = 0;
globalThis.fetch = async (url, opts = {}) => {
  const s = String(url);
  if (s.startsWith(LOCAL)) {
    const p = join(ROOT, decodeURIComponent(s.slice(LOCAL.length).split("?")[0]));
    return existsSync(p) ? new Response(readFileSync(p), { status: 200, headers: { "content-type": "application/json" } }) : new Response("", { status: 404 });
  }
  calls++;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await netFetch(url, { ...opts, headers: { ...UA, ...(opts.headers || {}) }, signal: AbortSignal.timeout(20000) });
      if (r.status < 500 && r.status !== 429) return r;
    } catch (_) { /* retry */ }
    await new Promise(r => setTimeout(r, 1500 * (i + 1)));
  }
  fails++;
  return new Response("", { status: 503 });
};

const out = join(ROOT, ".cache", "engine.mjs");
mkdirSync(join(ROOT, ".cache"), { recursive: true });
await build({ entryPoints: [join(ROOT, "src/boardroom.jsx")], bundle: true, platform: "node", format: "esm", outfile: out, jsx: "automatic",
  loader: { ".jsx": "jsx" }, define: { "process.env.NODE_ENV": '"production"', __BUILD__: '"tracker"' }, logLevel: "warning" });
const { tracker: T } = await import(out + "?t=" + Date.now());

// ---- load every record on file ----
const DIR = join(ROOT, "data", "track"), games = {};
const files = {};
if (existsSync(DIR)) for (const sp of readdirSync(DIR)) for (const f of readdirSync(join(DIR, sp))) {
  if (!f.endsWith(".json")) continue;
  const rel = `${sp}/${f}`, txt = readFileSync(join(DIR, sp, f), "utf8");
  files[rel] = txt;
  try { Object.assign(games, JSON.parse(txt).games || {}); } catch (_) { console.log("unreadable", rel); }
}
localStorage.setItem(T.TRACK_LS, JSON.stringify({ v: 1, games, learnOn: true }));
const before = Object.keys(T.trackLoad().games).length;
T.refreshLearned();                                         // price today's board with what has been learned so far

// ---- 1. log today's board ----
const logged = {};
for (const sp of T.SPORT_KEYS) {
  try {
    if (T.isIndiv(sp)) { const r = await T.fetchIndiv(sp); T.trackIndiv(r); logged[sp] = r.list.filter(m => m.known).length; continue; }
    const data = await T.fetchSlate(sp);
    if (!data.games.length) { logged[sp] = 0; continue; }
    logged[sp] = T.trackSlate(T.rankSlate(data.games, sp), sp, data.slateDate);
  } catch (e) { logged[sp] = `error: ${String(e.message || e).slice(0, 80)}`; }
}

// ---- 2. grade what has started (finals from the scoreboard; up to 10 days back) ----
const st = T.trackLoad(), cut = new Date(Date.now() - 10 * 864e5).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const graded = {};
for (const sp of T.SPORT_KEYS) {
  const pend = Object.values(st.games).filter(g => g.sport === sp && !g.result && g.day >= cut && T.startedET(g));
  if (!pend.length) continue;
  try { graded[sp] = await T.fetchFinals(sp, pend); } catch (e) { graded[sp] = `error: ${String(e.message || e).slice(0, 80)}`; }
}

// ---- 3. tidy, learn, write ----
const all = T.trackLoad().games;
for (const [k, g] of Object.entries(all)) if (!g.result && g.day < cut) delete all[k];   // never got a final (postponed / cancelled)
const learned = T.refreshLearned(), stats = {};
for (const sp of T.SPORT_KEYS) {
  const S = T.trackStats(all, sp);
  if (S.logged) stats[sp] = { logged: S.logged, graded: S.graded, pending: S.pending, picks: S.picks, ml: S.ml, total: S.total };
}
const by = {};
for (const g of Object.values(all)) { const rel = `${g.sport}/${g.day.slice(0, 7)}.json`; (by[rel] = by[rel] || {})[g.key] = g; }
let wrote = 0;
const now = new Date().toISOString();
for (const [rel, gs] of Object.entries(by)) {
  const sorted = Object.fromEntries(Object.entries(gs).sort(([a], [b]) => (a < b ? -1 : 1)));
  const prev = files[rel] ? (() => { try { return JSON.stringify(JSON.parse(files[rel]).games); } catch (_) { return ""; } })() : "";
  if (prev === JSON.stringify(sorted)) continue;           // unchanged: leave the file (and its timestamp) alone
  mkdirSync(join(DIR, rel.split("/")[0]), { recursive: true });
  writeFileSync(join(DIR, rel), JSON.stringify({ updated: now, games: sorted }));
  wrote++;
}
writeFileSync(join(ROOT, "data", "learned.json"), JSON.stringify({ updated: now, sports: learned, stats }));
console.log(JSON.stringify({ records: { before, after: Object.keys(all).length }, logged, graded, filesWritten: wrote, requests: calls, failed: fails }));
