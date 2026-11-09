// Background results tracker, run by the GitHub data job after the data update. Nobody has to open the site.
//   1. prices every game on today's board with the same engine the site uses, and logs it before it starts
//      (each run re-logs it, so the record kept is the last one before first pitch / tip-off / kick-off),
//   2. grades every started game from the final score on the scoreboard route,
//   3. learns from every graded game and writes data/learned.json, which the site reads on load.
// Records live in data/track/<SPORT>/<YYYY-MM>.json (past months stop changing, so the daily commit stays small).
import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { parseFinal, finalRundown, algoReview, archiveGame, boardFinal } from "../src/postgame.js";
import { ROUTES, SITE, summaryUrl, fieldBoard, liveBoard, leagueName, pool } from "../src/routes.js";

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
  if (T.isField(sp)) continue;                              // golf / racing: leaderboards only, nothing priced
  try {
    if (T.isIndiv(sp)) { const r = await T.fetchIndiv(sp); T.trackIndiv(r); logged[sp] = r.list.filter(m => m.known).length; continue; }
    const data = await T.fetchSlate(sp, { all: true });          // every game on the board, not the slate screen's top 40
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

// ---- 2b. every finished game gets a call: one the tracker never logged before it started is rebuilt from pre-game ----
// data (closing odds, both teams' numbers with this game taken back out), logged as late, graded, and learned from.
const etDays = [2, 1, 0].map(k => new Date(Date.now() - k * 864e5).toLocaleDateString("en-CA", { timeZone: "America/New_York" }));
const compact = d => d.replace(/-/g, "");
const finals = {};                                          // sport -> finished games on the boards, last three days
for (const sp of T.SPORT_KEYS) {
  if (T.isField(sp) || !ROUTES[sp]) continue;
  const jobs = [];
  for (const d of etDays) { let lgs = []; try { lgs = await T.leaguesOn(sp, compact(d)); } catch (_) { lgs = []; } for (const lg of lgs) jobs.push([lg, d]); }
  const boards = await pool(jobs, 6, ([lg, d]) => T.board(sp, lg, compact(d)).catch(() => null));
  const seen = new Set(), list = (finals[sp] = []);
  jobs.forEach(([lg, d], i) => {
    const j = boards[i];
    if (T.isIndiv(sp)) { for (const r of liveBoard(j, sp)) if (r.state === "post" && !seen.has(r.id)) { seen.add(r.id); list.push({ league: lg, row: { ...r, slug: lg }, day: d }); } return; }
    for (const ev of j?.events || []) {
      const st = ev.competitions?.[0]?.status?.type || ev.status?.type || {};
      if (st.state === "post" && st.completed !== false && !seen.has(String(ev.id))) { seen.add(String(ev.id)); list.push({ league: lg, ev, day: d }); }
    }
  });
}
const REBUILD_MAX = 300, rebuilt = {};
let nRebuilt = 0;
const have = T.trackLoad().games;
for (const sp of Object.keys(finals)) {
  if (T.isIndiv(sp)) continue;
  for (const f of finals[sp]) {
    if (nRebuilt >= REBUILD_MAX) break;
    const c = f.ev.competitions?.[0], A = c?.competitors?.find(x => x.homeAway === "away"), H = c?.competitors?.find(x => x.homeAway === "home");
    if (!A || !H) continue;
    const key = T.trackKey(sp, T.etISO(f.ev.date), A.team?.abbreviation || "", H.team?.abbreviation || "");
    if (have[key]) continue;
    let rec = null;
    try { rec = await T.reconstructCall(sp, f.league, f.ev.id, compact(f.day)); } catch (e) { rec = null; }
    if (!rec) continue;
    const { final, ...keep } = rec;
    if (T.trackUpsert(keep) && T.trackGrade(keep.key, final.as, final.hs)) { nRebuilt++; rebuilt[sp] = (rebuilt[sp] || 0) + 1; have[keep.key] = keep; }
  }
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

// ---- 4. the archive: every finished game, every sport and league, call or no call ----
// data/games/<SPORT>/<YYYY-MM-DD>.json: the full box score (summary route), the game rundown, the algo's call and the
// post-game review of it. Committed to the repo (not shipped with the site), so future analysis can read our own logs.
const GDIR = join(ROOT, "data", "games"), SUMMARY_MAX = 300, day0 = {};
let nArchived = 0, nSummaries = 0;
const loadDay = (sp, day) => {
  const k = `${sp}/${day}`;
  if (!day0[k]) { let g = {}; try { g = JSON.parse(readFileSync(join(GDIR, sp, `${day}.json`), "utf8")).games || {}; } catch (_) { g = {}; } day0[k] = { sp, day, games: g, dirty: false }; }
  return day0[k];
};
const recs = T.trackLoad().games;
const recFor = (sp, day, a, h, eid) => recs[T.trackKey(sp, day, a, h)] || Object.values(recs).find(g => g.sport === sp && g.eid != null && String(g.eid) === String(eid)) || null;
const stale = x => x && x.partial && Date.now() - Date.parse(x.archived || 0) > 864e5;   // give up on a summary after a day
const archiveCounts = {};
for (const [sp, list] of Object.entries(finals)) {
  for (const f of list) {
    if (T.isIndiv(sp)) {                                     // tennis / MMA: the board row is the box score
      const day = T.etISO(f.row.date || new Date().toISOString()), D = loadDay(sp, day), id = String(f.row.id);
      if (D.games[id]) continue;
      const F = T.indivFinal(sp, f.row), rec = Object.values(recs).find(g => g.sport === sp && String(g.eid) === id) || null;
      D.games[id] = archiveGame(F, sp, { league: f.league, leagueName: leagueName(sp, f.league), day, date: f.row.date || "", rec, rundown: finalRundown(F, sp, rec, learned).paras, review: algoReview(F, sp, rec, learned) });
      D.dirty = true; nArchived++; archiveCounts[sp] = (archiveCounts[sp] || 0) + 1;
      continue;
    }
    const day = T.etISO(f.ev.date), D = loadDay(sp, day), id = String(f.ev.id), old = D.games[id];
    if (old && (!old.partial || stale(old))) continue;
    if (nSummaries >= SUMMARY_MAX) continue;                 // the rest wait for the next run
    nSummaries++;
    let j = null;
    try { const r = await fetch(summaryUrl(sp, f.league, id)); j = r.ok ? await r.json() : null; } catch (_) { j = null; }
    let F = j ? parseFinal(j, sp) : null, partial = false;
    if (!F || !Number.isFinite(F.away?.score) || !Number.isFinite(F.home?.score)) { if (old) continue; F = boardFinal(f.ev, sp); partial = true; }
    if (!F) continue;
    const rec = recFor(sp, day, F.away.abbr, F.home.abbr, id);
    D.games[id] = archiveGame(F, sp, { league: f.league, leagueName: leagueName(sp, f.league), day, date: f.ev.date, rec, rundown: finalRundown(F, sp, rec, learned).paras, review: algoReview(F, sp, rec, learned), partial });
    D.dirty = true; nArchived++; archiveCounts[sp] = (archiveCounts[sp] || 0) + 1;
  }
}
// golf / racing: each tour's finished event, the whole leaderboard
for (const sp of T.SPORT_KEYS.filter(T.isField)) {
  const R = ROUTES[sp];
  const evs = (await pool(R.leagues, 5, lg => fetch(`${SITE}/${R.sport}/${lg}/scoreboard`).then(r => (r.ok ? r.json() : null)).then(j => fieldBoard(j).map(e => ({ ...e, slug: lg }))).catch(() => []))).flat();
  for (const e of evs) {
    if (e.state !== "post") continue;
    const day = T.etISO(e.end || e.date), D = loadDay(sp, day);
    if (D.games[e.id]) continue;
    D.games[e.id] = { id: e.id, sport: sp, league: e.slug, leagueName: e.league || leagueName(sp, e.slug), day, date: e.date, end: e.end, name: e.name, session: e.session, detail: e.detail, rows: e.rows, archived: new Date().toISOString() };
    D.dirty = true; nArchived++; archiveCounts[sp] = (archiveCounts[sp] || 0) + 1;
  }
}
for (const D of Object.values(day0)) {
  if (!D.dirty) continue;
  mkdirSync(join(GDIR, D.sp), { recursive: true });
  const sorted = Object.fromEntries(Object.entries(D.games).sort(([a], [b]) => (a < b ? -1 : 1)));
  writeFileSync(join(GDIR, D.sp, `${D.day}.json`), JSON.stringify({ updated: new Date().toISOString(), games: sorted }));
}
console.log(JSON.stringify({ records: { before, after: Object.keys(all).length }, logged, graded, rebuilt, archived: archiveCounts, summaries: nSummaries, filesWritten: wrote, requests: calls, failed: fails }));
