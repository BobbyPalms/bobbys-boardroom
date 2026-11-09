// GitHub data job (every 15 min, plus on demand). Builds data/ for the site:
//   history/<SPORT>.json     every team's scoring for every season the standings route has
//   live/<SPORT>.json        yesterday / today / tomorrow: every game, status, score, odds
//   lines/<SPORT>.json       line snapshots per game (spread, total, moneylines) when they change
//   splits/<SPORT>.json      public % of bets and money (Action Network + DraftKings Network), every run
//   officials/<SPORT>.json   each finished game's officials with its final score (referee tendencies)
//   matches/<SPORT>/<YEAR>.json  tennis matches / UFC fights, every one on record
//   ratings/<SPORT>.json     Elo for every player / fighter, fitted and back-tested on held-out matches
// State carries over between runs through the deployed site (scripts/restore-state.mjs) and a daily commit.
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { powerTeamUrl, parsePower, SPLITS, anSplitsUrl, dkSplitsUrl, parseANSplits, parseDKSplits } from "../src/routes.js";
import { ROUTES, TEAM_SPORTS, scoreboardUrl, standingsUrl, summaryUrl, parseStandings, leagueAvg, parseScoreboard, parseSummary, finalsFrom, espnSeason, ymd, makeBoards, seasonStartYear } from "../src/routes.js";
import { parseTennis, parseUFC, fitElo, tennisProfiles, h2hShard } from "../src/ratings.js";

const FORCE_BACKFILL = process.argv.includes("--backfill");
const ONLY = (process.argv.find(a => a.startsWith("--sports=")) || "").slice(9).split(",").filter(Boolean);
const UA = { "User-Agent": "bobbys-boardroom-data-job/1.0", Accept: "application/json" };
const sleep = ms => new Promise(r => setTimeout(r, ms));
let calls = 0, fails = 0;
async function get(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try { calls++; const r = await fetch(url, { headers: UA }); if (r.ok) return await r.json(); if (r.status === 404 || r.status === 400) return null; }
    catch (_) { /* network blip */ }
    await sleep(700 * (i + 1));
  }
  fails++; return null;
}
async function pool(items, size, fn) { const out = []; let i = 0; await Promise.all(Array.from({ length: size }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } })); return out; }
const read = (p, d) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch (_) { return d; } };
// one scoreboard per league per day; soccer, MMA, rugby and golf read every league in one call (src/routes.js)
const BOARDS = makeBoards(async url => { const j = await get(url); if (!j) throw new Error("no board"); return j; });
// write only when the content (ignoring the timestamp) changed, so unchanged files never churn
function write(p, o) {
  const body = JSON.stringify({ ...o, updated: undefined });
  const old = existsSync(p) ? JSON.stringify({ ...read(p, {}), updated: undefined }) : null;
  if (old === body) return false;
  mkdirSync(p.split("/").slice(0, -1).join("/"), { recursive: true });
  writeFileSync(p, JSON.stringify({ ...o, updated: new Date().toISOString() }));
  return true;
}
const startYearNow = sport => seasonStartYear(sport, new Date());
const sports = ONLY.length ? ONLY : Object.keys(ROUTES);
// Standings and the UFC schedule change slowly: refresh them hourly (first run of each hour), live boards every run.
// Runs come every few minutes now, so the slow jobs (standings history, UFC year list) go by the clock of the last
// time they ran, kept in data/meta/jobs.json, not by the minute of the hour.
const JOBS = (() => { try { return JSON.parse(readFileSync("data/meta/jobs.json", "utf8")); } catch (_) { return {}; } })();
const due = (name, mins) => FORCE_BACKFILL || process.argv.includes("--all") || !(Date.now() - Date.parse(JOBS[name] || 0) < mins * 60e3);
const HOURLY = due("hourly", 55);

// ---- 1. team history: standings for every season back as far as the route goes ----
async function history(sport) {
  const file = `data/history/${sport}.json`, backfill = FORCE_BACKFILL || !existsSync(file);
  const H = read(file, { teams: {}, lg: {}, done: {} }), now = startYearNow(sport);
  await pool(ROUTES[sport].leagues, 6, async league => {
    const years = backfill ? Array.from({ length: now - 1969 }, (_, i) => now - i) : [now, now - 1];
    let empty = 0;
    for (const y of years) {
      const key = `${league}:${y}`;
      if (H.done[key] && y < now - 1 && !FORCE_BACKFILL) { empty = 0; continue; }   // a backfill re-pulls every season
      const teams = parseStandings(await get(standingsUrl(sport, league, espnSeason(sport, y))));
      const ids = Object.keys(teams);
      if (!ids.length) { if (++empty >= 3) break; continue; }
      empty = 0;
      const lg = leagueAvg(teams);
      H.lg[key] = lg;
      for (const id of ids) {
        const t = teams[id], rows = (H.teams[id] || []).filter(r => !(r[0] === y && r[5] === league));
        rows.push([y, t.gp, +t.gpg.toFixed(3), +t.gaa.toFixed(3), lg ? +lg.toFixed(3) : null, league, t.abbr]);
        H.teams[id] = rows.sort((a, b) => a[0] - b[0]);
      }
      if (y < now) H.done[key] = true;
      await sleep(80);
    }
  });
  write(file, H);
}

// ---- 2. live boards, 3. line snapshots, 4. officials (team sports) ----
async function live(sport) {
  const days = [-1, 0, 1].map(k => ymd(new Date(Date.now() + k * 864e5)));
  const L = { days: {} }, lines = read(`data/lines/${sport}.json`, {}), offs = read(`data/officials/${sport}.json`, {});
  const finals = [];
  const jobs = [];
  for (const d of days) for (const league of await BOARDS.leaguesOn(sport, d)) jobs.push([league, d]);
  const boards = await pool(jobs, 6, ([league, d]) => BOARDS.board(sport, league, d).catch(() => null));
  for (let i = 0; i < jobs.length; i++) {
    const [league, d] = jobs[i], j = boards[i];
    if (!j) continue;
    const games = parseScoreboard(j, sport, { league });
    (L.days[d] = L.days[d] || []).push(...games.map(g => ({ id: g.id, league, date: g.date, state: g.state, status: g.statusText, neutral: g.neutral, venue: g.venue,
      away: { id: g.away.id, abbr: g.away.abbr, name: g.away.name, score: g.away.score, rec: g.away.rec }, home: { id: g.home.id, abbr: g.home.abbr, name: g.home.name, score: g.home.score, rec: g.home.rec }, mkt: g.mkt })));
    for (const g of games) if (g.mkt && g.state === "pre") {
      const snap = [Date.now(), g.mkt.awaySpread, g.mkt.total, g.mkt.homeML, g.mkt.awayML], arr = (lines[g.id] = lines[g.id] || []), last = arr[arr.length - 1];
      if (!last || last.slice(1).join() !== snap.slice(1).join()) arr.push(snap);
    }
    for (const f of finalsFrom(j)) finals.push({ ...f, league });
  }
  let budget = 40;
  for (const f of finals) {
    if (offs[f.id] || budget <= 0) continue;
    const s = parseSummary(await get(summaryUrl(sport, f.league, f.id))); budget--;
    offs[f.id] = { d: f.date.slice(0, 10), o: (s.officials || []).map(o => o.name + (o.role ? `|${o.role}` : "")), h: f.home, a: f.away, hs: f.hs, as: f.as };
  }
  const cutoff = Date.now() - 4 * 864e5;
  for (const [id, arr] of Object.entries(lines)) if (!arr.length || arr[arr.length - 1][0] < cutoff) delete lines[id];
  write(`data/live/${sport}.json`, L); write(`data/lines/${sport}.json`, lines); write(`data/officials/${sport}.json`, offs);
}

// ---- 5. public betting splits (% of bets and % of money: moneyline, spread, total) ----
// Action Network's public scoreboard (JSON) and DraftKings Network's splits page (HTML). Both lists are kept; the page
// matches each game to them, Action Network first. Football looks a week ahead, everything else today and tomorrow.
async function getText(url) {
  for (let i = 0; i < 3; i++) {
    try { const r = await fetch(url, { headers: { ...UA, Accept: "text/html,application/json" }, signal: AbortSignal.timeout(25000) }); if (r.ok) return await r.text(); if (r.status < 500 && r.status !== 429) return null; } catch (_) { /* retry */ }
    await new Promise(r => setTimeout(r, 1500 * (i + 1)));
  }
  return null;
}
async function splits(sport) {
  const c = SPLITS[sport];
  if (!c || !due(`splits:${sport}`, 9)) return;
  JOBS[`splits:${sport}`] = new Date().toISOString();
  const ahead = c.ahead ? [0, 7] : [0, 1], an = [], dk = [], seen = new Set();
  for (const k of ahead) {
    const txt = await getText(anSplitsUrl(sport, ymd(new Date(Date.now() + k * 864e5))));
    let j = null; try { j = txt && JSON.parse(txt); } catch (_) { j = null; }
    for (const s of parseANSplits(j)) { const id = `${s.a.name}@${s.h.name}|${s.t}`; if (!seen.has(id)) { seen.add(id); an.push(s); } }
  }
  for (const eg of c.dk) for (const when of c.ahead ? ["n7days"] : ["today", "tomorrow"]) for (let page = 1; page <= 6; page++) {
    const html = await getText(dkSplitsUrl(eg, when, page));
    if (!html) break;
    dk.push(...parseDKSplits(html));
    if (!new RegExp(`tb_page=${page + 1}\\b`).test(html.replace(/&#0?38;|&amp;/g, "&"))) break;
  }
  const lo = Date.now() - 864e5, hi = Date.now() + 9 * 864e5, keep = s => !s.t || (Date.parse(s.t) > lo && Date.parse(s.t) < hi);
  const prev = read(`data/splits/${sport}.json`, { games: [] });
  const games = [...an.filter(keep), ...dk.filter(keep)];
  // a source that fails this run keeps its last good list for games that haven't started
  for (const src of ["Action Network", "DraftKings"]) if (!games.some(g => g.src === src)) games.push(...(prev.games || []).filter(g => g.src === src && g.t && Date.parse(g.t) > Date.now()));
  write(`data/splits/${sport}.json`, { sources: { "Action Network": an.length, DraftKings: dk.length }, games });
}

// ---- 5b. college hoops power index (BPI) for every team, once a day (the list route only has the top 25) ----
async function power(sport) {
  if (sport !== "CBB" && sport !== "CBBW") return;
  const file = `data/power/${sport}.json`, P = read(file, { day: "", teams: {} }), today = ymd(new Date());
  if (P.day === today && !FORCE_BACKFILL) return;
  const H = read(`data/history/${sport}.json`, { teams: {} }), y = startYearNow(sport);
  const ids = Object.entries(H.teams).filter(([, rows]) => rows.some(r => r[0] >= y - 1)).map(([id]) => id);
  const teams = {};
  await pool(ids, 4, async id => { const p = parsePower(await get(powerTeamUrl(sport, espnSeason(sport, y), id)))[id]; if (p) teams[id] = p; });
  if (Object.keys(teams).length) write(file, { day: today, teams });
}

// ---- 6. tennis + MMA: every match / fight on record, then ratings ----
const shard = (sport, y) => `data/matches/${sport}/${y}.json`;
function loadMatches(sport) { const dir = `data/matches/${sport}`, all = {}; if (!existsSync(dir)) return all; for (const f of readdirSync(dir)) Object.assign(all, read(`${dir}/${f}`, { m: {} }).m); return all; }
function saveMatches(sport, all) {
  const by = {};
  for (const [id, m] of Object.entries(all)) (by[m.date.slice(0, 4)] = by[m.date.slice(0, 4)] || {})[id] = m;
  for (const [y, m] of Object.entries(by)) write(shard(sport, y), { m });
}
const compact = m => ({ ...m, a: { id: m.a.id, name: m.a.name, ...(m.a.rec ? { rec: m.a.rec } : {}) }, b: { id: m.b.id, name: m.b.name, ...(m.b.rec ? { rec: m.b.rec } : {}) } });
async function tennis() {
  const all = loadMatches("Tennis"), meta = read("data/matches/Tennis.meta.json", { days: {} }), now = new Date();
  const days = [];
  const first = FORCE_BACKFILL || !Object.keys(meta.days).length ? new Date(Date.UTC(2015, 0, 1)) : new Date(now - 2 * 864e5);
  for (let t = first.getTime(); t <= now.getTime() + 864e5; t += (FORCE_BACKFILL || !Object.keys(meta.days).length ? 3 : 1) * 864e5) days.push(ymd(new Date(t)));
  for (const tour of ROUTES.Tennis.leagues) {
    const todo = days.filter(d => !meta.days[`${tour}:${d}`] || d >= ymd(new Date(now - 2 * 864e5)));
    await pool(todo, 4, async d => {
      const j = await get(scoreboardUrl("Tennis", tour, d));
      if (!j) return;
      for (const m of parseTennis(j, tour)) if (m.completed || !all[m.id]) all[m.id] = compact(m);
      meta.days[`${tour}:${d}`] = 1;
    });
  }
  saveMatches("Tennis", all); write("data/matches/Tennis.meta.json", meta);
  return all;
}
async function mma() {
  const all = loadMatches("MMA"), meta = read("data/matches/MMA.meta.json", { years: {}, events: {} }), yNow = new Date().getUTCFullYear();
  const years = FORCE_BACKFILL || !Object.keys(meta.years).length ? Array.from({ length: yNow - 1992 }, (_, i) => 1993 + i) : HOURLY ? [yNow] : [];
  for (const y of years) {
    const j = await get(scoreboardUrl("MMA", "ufc", String(y)));
    if (!j) continue;
    const dates = new Set((j.events || []).map(e => e.date && ymd(new Date(e.date))).filter(Boolean));
    for (const c of j.leagues?.[0]?.calendar || []) if (c?.startDate && c.startDate.slice(0, 4) === String(y)) dates.add(ymd(new Date(c.startDate)));
    const todo = [...dates].filter(d => !meta.events[d] || Number(d) >= Number(ymd(new Date(Date.now() - 10 * 864e5))));
    await pool(todo, 4, async d => {
      const jj = await get(scoreboardUrl("MMA", "ufc", d));
      if (!jj) return;
      for (const m of parseUFC(jj)) if (m.completed || !all[m.id]) all[m.id] = compact(m);
      meta.events[d] = 1;
    });
    meta.years[y] = 1;
  }
  // every other promotion ESPN lists: its cards from the last 10 days through the coming week, every run, so their
  // fighters build Elo history from here on (the UFC year calendar above is UFC-only)
  for (let k = -10; k <= 8; k++) {
    const d = ymd(new Date(Date.now() + k * 864e5));
    for (const lg of await BOARDS.leaguesOn("MMA", d)) {
      if (lg === "ufc") continue;
      const jj = await BOARDS.board("MMA", lg, d).catch(() => null);
      if (jj) for (const m of parseUFC(jj)) if (m.completed || !all[m.id]) all[m.id] = compact(m);
    }
  }
  saveMatches("MMA", all); write("data/matches/MMA.meta.json", meta);
  return all;
}
function ratings(sport, all) {
  const ms = Object.values(all), f = fitElo(ms, sport);
  const players = Object.fromEntries(Object.entries(f.R).map(([id, x]) => [id, [x.name, Math.round(x.r * 10) / 10, x.n, x.last.slice(0, 10)]]));
  write(`data/ratings/${sport}.json`, { fit: { scale: f.scale, initW: f.initW, matches: f.matches, train: f.train, test: f.test, cut: f.cut || null }, players });
}

// tennis player profiles (last 12 months: form, sets, games, tiebreaks) and head-to-head records, from every match on file
function profiles(all) {
  const { fields, players, h2h } = tennisProfiles(Object.values(all));
  write("data/tennis/players.json", { fields, players });
  const shards = Array.from({ length: 16 }, () => ({}));
  for (const [k, v] of Object.entries(h2h)) { const [a, b] = k.split("-"); shards[h2hShard(a, b)][k] = v; }
  shards.forEach((h, i) => write(`data/tennis/h2h-${i}.json`, { fields: ["winsLowId", "winsHighId", "lastDate", "lastEvent", "lastScoreLowIdFirst"], h2h: h }));
}

// ---- EA SPORTS FC player ratings (the ratings on ea.com), once a day: soccer lineups blend them with the stats ----
async function fifa() {
  if (!due("fifa", 20 * 60)) return;
  const url = off => `https://drop-api.ea.com/rating/ea-sports-fc?locale=en&limit=100&offset=${off}`;
  const first = await get(url(0));
  if (!first?.items?.length) return;
  const total = Math.min(first.totalItems || first.items.length, 30000), offs = [];
  for (let o = 100; o < total; o += 100) offs.push(o);
  const pages = [first, ...(await pool(offs, 4, o => get(url(o))))].filter(Boolean);
  const players = [];
  for (const pg of pages) for (const x of pg.items || []) {
    const name = x.commonName || [x.firstName, x.lastName].filter(Boolean).join(" ");
    players.push([x.id, name, x.firstName || "", x.lastName || "", x.team?.label || "", x.leagueName || "", x.overallRating, x.position?.shortLabel || "", x.nationality?.label || ""]);
  }
  if (players.length > 1000) { write("data/fifa/players.json", { source: "EA SPORTS FC ratings (ea.com)", fields: ["id", "name", "first", "last", "team", "league", "ovr", "pos", "nation"], players }); JOBS.fifa = new Date().toISOString(); }
}

// ---- Kalshi: an index of every open Kalshi sports market (data/kalshi/sports.json) ----
// The slip matches picks the scoreboards don't carry (Challenger / ITF tennis, set winners, doubles, props, futures)
// against this, then prices and buys them live on Kalshi. Hourly: every open event, to find the sports series. Every run:
// the series that hold single games / matches (they list and close all day); the season-long ones hourly.
const KALSHI_API = "https://external-api.kalshi.com/trade-api/v2";
async function kalshiIndex() {
  const metaP = "data/kalshi/series.json", meta = read(metaP, { fast: [], slow: [], at: "" });
  if (due("kalshi:series", 55) || !meta.fast.length) {
    const sports = new Map();
    let cursor = "", pages = 0;
    do {
      const j = await get(`${KALSHI_API}/events?status=open&limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      if (!j) break;
      for (const e of j.events || []) if (e.category === "Sports" && !/^KXMVE/.test(e.series_ticker || "")) {
        const x = sports.get(e.series_ticker) || { fast: false };
        if (/\bvs\.?\b|\sat\s/i.test(e.title || "")) x.fast = true;
        sports.set(e.series_ticker, x);
      }
      cursor = j.cursor || ""; pages++;
    } while (cursor && pages < 400);
    if (sports.size) {
      meta.fast = [...sports].filter(([, x]) => x.fast).map(([k]) => k).sort();
      meta.slow = [...sports].filter(([, x]) => !x.fast).map(([k]) => k).sort();
      meta.at = new Date().toISOString();
      write(metaP, meta);
    }
    JOBS["kalshi:series"] = new Date().toISOString();
  }
  const pull = async series => {
    const evs = [];
    let cursor = "", pages = 0;
    do {
      const j = await get(`${KALSHI_API}/events?series_ticker=${encodeURIComponent(series)}&status=open&with_nested_markets=true&limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      if (!j) break;
      for (const e of j.events || []) {
        const ms = (e.markets || []).filter(m => !m.status || m.status === "active" || m.status === "open").map(m => [m.ticker, m.yes_sub_title || m.subtitle || "", m.close_time || m.expected_expiration_time || null]);
        if (ms.length) evs.push([e.event_ticker, series, e.title || "", e.sub_title || "", e.strike_date || null, ms]);
      }
      cursor = j.cursor || ""; pages++;
    } while (cursor && pages < 10);
    return evs;
  };
  const slowP = "data/kalshi/slow.json", slow = read(slowP, { ev: [] });
  if (due("kalshi:slow", 55) || !slow.ev.length) { slow.ev = (await pool(meta.slow, 6, pull)).flat(); write(slowP, slow); JOBS["kalshi:slow"] = new Date().toISOString(); }
  const fast = (await pool(meta.fast, 6, pull)).flat();
  const ev = [...fast, ...slow.ev];
  if (ev.length) write("data/kalshi/sports.json", { series: meta.fast.length + meta.slow.length, markets: ev.reduce((a, e) => a + e[5].length, 0), ev });
}

if (!ONLY.length || ONLY.includes("Soccer")) { try { await fifa(); } catch (e) { console.error("fifa", e); fails++; } }
if (!ONLY.length || ONLY.includes("Kalshi")) { try { await kalshiIndex(); console.log(`Kalshi index: done (${calls} requests so far)`); } catch (e) { console.error("kalshi", e); fails++; } }
for (const s of sports) {
  try {
    if (TEAM_SPORTS.includes(s)) { if (HOURLY || !existsSync(`data/history/${s}.json`)) await history(s); await live(s); await splits(s); await power(s); }
    else if (s === "Tennis") { const all = await tennis(); ratings("Tennis", all); profiles(all); }
    else if (s === "MMA") ratings("MMA", await mma());
  } catch (e) { console.error(s, e); fails++; }
  console.log(`${s}: done (${calls} requests so far)`);
}
if (HOURLY) JOBS.hourly = new Date().toISOString();
mkdirSync("data/meta", { recursive: true }); writeFileSync("data/meta/jobs.json", JSON.stringify(JOBS));
console.log(`requests ${calls}, failed ${fails}`);
