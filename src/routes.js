// Every data route the app and the data job use, from github.com/pseudo-r/Public-ESPN-API (docs/sports/*.md).
// One module shared by the browser app and the GitHub data job, so both read the data the same way.
import { CATALOG } from "./leagues.js";
export const SITE = "https://site.api.espn.com/apis/site/v2/sports";
export const SITE2 = "https://site.api.espn.com/apis/v2/sports";        // standings live here (the site/v2 path is a stub)
export const CORE = "https://sports.core.api.espn.com/v2/sports";
// app sport key -> ESPN sport slug + leagues (+ query extras). Every league ESPN lists (src/leagues.js) is on exactly
// one tab: the big US leagues keep their own tabs, and each ESPN sport's other leagues share one tab ("Hoops+" etc.).
// `core` = the leagues a tab searched before it carried every league (the team-name search falls back to their
// standings when a team has no game this week; doing that across 220 soccer leagues would be hundreds of calls).
const slugs = sp => CATALOG[sp].map(r => r[0]);
const rest = (sp, taken) => slugs(sp).filter(s => !taken.includes(s));
const SOCCER_CORE = ["eng.1", "esp.1", "ger.1", "ita.1", "fra.1", "usa.1", "mex.1", "uefa.champions", "uefa.europa", "fifa.world", "fifa.worldq.uefa", "fifa.friendly"];
export const ROUTES = {
  MLB:    { sport: "baseball",   leagues: ["mlb"] },
  NFL:    { sport: "football",   leagues: ["nfl"] },
  CFB:    { sport: "football",   leagues: ["college-football"], q: "groups=80&limit=300" },          // all FBS games, not just the top 25
  NBA:    { sport: "basketball", leagues: ["nba"] },
  WNBA:   { sport: "basketball", leagues: ["wnba"] },
  CBB:    { sport: "basketball", leagues: ["mens-college-basketball"], q: "groups=50&limit=500" },   // all Division I
  CBBW:   { sport: "basketball", leagues: ["womens-college-basketball"], q: "groups=50&limit=500" },
  NHL:    { sport: "hockey",     leagues: ["nhl"] },
  Soccer: { sport: "soccer",     leagues: [...SOCCER_CORE, ...rest("soccer", SOCCER_CORE)], core: SOCCER_CORE },
  Tennis: { sport: "tennis",     leagues: ["atp", "wta"] },
  MMA:    { sport: "mma",        leagues: ["ufc", ...rest("mma", ["ufc"])], core: ["ufc"] },
  // every other league ESPN lists, one tab per sport
  BASE:   { sport: "baseball",   leagues: rest("baseball", ["mlb"]) },
  HOOPS:  { sport: "basketball", leagues: rest("basketball", ["nba", "wnba", "mens-college-basketball", "womens-college-basketball"]) },
  GRID:   { sport: "football",   leagues: rest("football", ["nfl", "college-football"]) },
  PUCK:   { sport: "hockey",     leagues: rest("hockey", ["nhl"]) },
  AFL:    { sport: "australian-football", leagues: slugs("australian-football") },
  RUGBY:  { sport: "rugby",      leagues: slugs("rugby") },
  RUGBYL: { sport: "rugby-league", leagues: slugs("rugby-league") },
  LAX:    { sport: "lacrosse",   leagues: slugs("lacrosse") },
  FHOCKEY:{ sport: "field-hockey", leagues: slugs("field-hockey") },
  VOLLEY: { sport: "volleyball", leagues: slugs("volleyball") },
  WPOLO:  { sport: "water-polo", leagues: slugs("water-polo") },
  Golf:   { sport: "golf",       leagues: slugs("golf") },
  Racing: { sport: "racing",     leagues: slugs("racing") },
};
export const TEAM_SPORTS = ["MLB", "NFL", "CFB", "NBA", "WNBA", "CBB", "CBBW", "NHL", "Soccer", "BASE", "HOOPS", "GRID", "PUCK", "AFL", "RUGBY", "RUGBYL", "LAX", "FHOCKEY", "VOLLEY", "WPOLO"];
// fields of many players (no two-sided game to simulate): leaderboards only
export const FIELD_SPORTS = ["Golf", "Racing"];
// month (0-11) a season starts: the label of the season being played now [J for the added tabs]
export const SEASON_START = { MLB: 2, NFL: 7, CFB: 7, Soccer: 7, NBA: 9, NHL: 9, CBB: 10, CBBW: 10, WNBA: 4,
  BASE: 1, HOOPS: 9, GRID: 2, PUCK: 9, AFL: 2, RUGBY: 7, RUGBYL: 2, LAX: 1, FHOCKEY: 7, VOLLEY: 7, WPOLO: 7 };
export const seasonStartYear = (sport, d = new Date()) => (d.getMonth() >= (SEASON_START[sport] ?? 7) ? d.getFullYear() : d.getFullYear() - 1);
// ESPN labels NBA/NHL/college-hoops seasons by the year they END (2026-27 = 2027); the app labels by the year they start.
const ENDS_LABEL = new Set(["NBA", "NHL", "CBB", "CBBW", "HOOPS", "PUCK"]);
export const espnSeason = (sport, startYear) => ENDS_LABEL.has(sport) ? startYear + 1 : startYear;
export const startYearOf = (sport, espnYear) => ENDS_LABEL.has(sport) ? espnYear - 1 : espnYear;

export const scoreboardUrl = (sport, league, ymd) => { const r = ROUTES[sport]; return `${SITE}/${r.sport}/${league}/scoreboard?dates=${ymd}${r.q ? "&" + r.q : ""}`; };
// ---------- one call per day for the sports with hundreds of leagues ----------
// ESPN's sport-wide "all" board returns every league's games for a day in one response, each game tagged with its
// league id (uid "s:600~l:3918~e:..."). It is split back into one board per league, in the same shape a league's own
// scoreboard has, so everything downstream reads it the same way. Sports with a handful of leagues keep one call each.
export const ALL_BOARD = new Set(["soccer", "mma", "rugby", "golf"]);
const LEAGUE_BY_ID = Object.fromEntries(Object.entries(CATALOG).map(([sp, rows]) => [sp, Object.fromEntries(rows.map(([slug, id, name]) => [String(id), { slug, id, name }]))]));
export const leagueName = (sport, slug) => { const r = CATALOG[ROUTES[sport]?.sport]?.find(x => x[0] === slug); return r ? r[2] : slug; };
const usesAll = (sport, day) => ALL_BOARD.has(ROUTES[sport]?.sport) && /^\d{8}$/.test(String(day)) && ROUTES[sport].leagues.length > 1;
export const allBoardUrl = (sport, day) => `${SITE}/${ROUTES[sport].sport}/all/scoreboard?dates=${day}&limit=1000`;
export function splitAllBoard(sport, j) {
  const sp = ROUTES[sport].sport, mine = new Set(ROUTES[sport].leagues), by = {};
  for (const e of j?.events || []) {
    const id = String(e.uid || "").match(/~l:(\d+)/)?.[1], L = id && LEAGUE_BY_ID[sp]?.[id];
    if (!L || !mine.has(L.slug)) continue;                   // a league ESPN added after the catalog was pulled: npm run leagues
    (by[L.slug] = by[L.slug] || { leagues: [{ id: String(L.id), slug: L.slug, name: L.name, abbreviation: L.name }], events: [], day: j.day }).events.push(e);
  }
  return by;
}
// boards(fetchJSON): board(sport, league, day) and leaguesOn(sport, day). fetchJSON(url) resolves to JSON or throws.
// The "all" board is cached for a minute per sport and day, so a screen that walks every league costs one request.
export function makeBoards(fetchJSON, ttl = 60e3) {
  const memo = new Map();
  const all = (sport, day) => {
    const key = `${sport}|${day}`, hit = memo.get(key);
    if (hit && Date.now() - hit.t < ttl) return hit.p;
    const p = Promise.resolve().then(() => fetchJSON(allBoardUrl(sport, day))).then(j => { if (!j || !Array.isArray(j.events)) throw new Error("no all board"); return splitAllBoard(sport, j); });
    p.catch(() => memo.delete(key));
    memo.set(key, { t: Date.now(), p });
    return p;
  };
  const one = (sport, league, day) => fetchJSON(scoreboardUrl(sport, league, day));
  const board = async (sport, league, day) => {
    if (!usesAll(sport, day)) return one(sport, league, day);
    try { const by = await all(sport, day); return by[league] || { leagues: [{ slug: league, name: leagueName(sport, league), abbreviation: leagueName(sport, league) }], events: [] }; }
    catch (_) { return one(sport, league, day); }
  };
  // the leagues worth reading on a day: every league, or for an "all" sport only the ones with games that day
  // (if the all board can't be read, the tab's core leagues, as before it carried every league)
  const leaguesOn = async (sport, day) => {
    const R = ROUTES[sport];
    if (!R) return [];
    if (!usesAll(sport, day)) return R.leagues;
    try { const by = await all(sport, day); return R.leagues.filter(l => by[l]); }
    catch (_) { return R.core || R.leagues; }
  };
  return { board, leaguesOn };
}
// run fn over items, n at a time
export async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}
// ---------- golf and racing: a field of players, shown as a leaderboard ----------
// Racing events hold several sessions (practice, qualifying, the race): the race once it starts, else the latest
// session that has started, else the first one.
export function fieldBoard(j) {
  const lg = j?.leagues?.[0], out = [];
  for (const e of j?.events || []) {
    const comps = e.competitions || [], st = c => c?.status?.type?.state || "pre";
    const c = comps.find(x => /^race$/i.test(x.type?.abbreviation || x.type?.text || "") && st(x) !== "pre")
      || [...comps].reverse().find(x => st(x) !== "pre") || comps[0];
    if (!c) continue;
    const t = c.status?.type || e.status?.type || {}, et = e.status?.type || {};
    const rows = [...(c.competitors || [])].sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9)).map(x => {
      const sc = x.score && typeof x.score === "object" ? x.score.displayValue ?? x.score.value : x.score;
      return { pos: x.order ?? null, name: x.athlete?.displayName || x.athlete?.fullName || x.team?.displayName || "", score: sc == null ? "" : String(sc),
        rounds: (x.linescores || []).map(s => s.value).filter(v => v != null), win: x.winner === true };
    });
    out.push({ id: String(e.id), name: e.name || e.shortName || "", league: lg?.name || lg?.abbreviation || "", date: e.date, end: e.endDate || null,
      session: comps.length > 1 ? (c.type?.text || c.type?.abbreviation || "") : "", state: et.state || t.state || "pre", detail: t.shortDetail || t.detail || et.shortDetail || et.detail || "", rows });
  }
  return out;
}
export const standingsUrl = (sport, league, espnYear) => `${SITE2}/${ROUTES[sport].sport}/${league}/standings${espnYear ? `?season=${espnYear}` : ""}`;
export const summaryUrl = (sport, league, eventId) => `${SITE}/${ROUTES[sport].sport}/${league}/summary?event=${eventId}`;
export const injuriesUrl = (sport, league) => `${SITE}/${ROUTES[sport].sport}/${league}/injuries`;
export const coreOddsUrl = (sport, league, eventId, compId) => `${CORE}/${ROUTES[sport].sport}/leagues/${league}/events/${eventId}/competitions/${compId || eventId}/odds`;
// ESPN QBR, season totals (NFL group 9, FBS group 80)
export const qbrUrl = (sport, startYear) => `${CORE}/football/leagues/${sport === "CFB" ? "college-football" : "nfl"}/seasons/${startYear}/types/2/groups/${sport === "CFB" ? 80 : 9}/qbr/0?limit=300`;
export function parseQBR(j) {
  const out = {};
  for (const x of j?.items || []) {
    const ath = (x.athlete?.$ref || "").match(/athletes\/(\d+)/)?.[1], team = (x.team?.$ref || "").match(/teams\/(\d+)/)?.[1];
    const st = x.splits?.categories?.flatMap(c => c.stats || []) || [];
    const q = statOf(st, "schedAdjQBR") ?? statOf(st, "qbr"), plays = statOf(st, "actionPlays", "qbPlays") || 0;
    if (ath && team && q != null) (out[team] = out[team] || []).push({ ath, qbr: q, plays });
  }
  return out;
}
// QBR (0-100, ~55 = average starter) onto the app's rating scale (72 = average starter, 88 = all-star) [J]
export const qbrToRating = q => Math.max(60, Math.min(97, Math.round(72 + (q - 55) * 0.8)));
// a player's season stats (used for NHL probable goalies: save %, GAA, starts)
export const athleteStatsUrl = (sport, espnYear, id) => `${CORE}/${ROUTES[sport].sport}/leagues/${ROUTES[sport].leagues[0]}/seasons/${espnYear}/types/2/athletes/${id}/statistics`;
export function parseGoalie(j) {
  const st = j?.splits?.categories?.flatMap(c => c.stats || []) || [];
  const sv = statOf(st, "savePct"), gaa = statOf(st, "avgGoalsAgainst", "goalsAgainstAverage"), gs = statOf(st, "gameStarted", "gamesStarted", "games");
  return sv != null && sv > 0.5 && sv < 1 ? { sv, gaa, gs } : null;
}
// ESPN power index: opponent-adjusted team strength. NBA / college hoops = BPI (offense + defense, points vs an
// average opponent), NFL / CFB = FPI (net points vs an average opponent on a neutral field).
const POWER_LG = { NBA: "basketball/leagues/nba", CBB: "basketball/leagues/mens-college-basketball", CBBW: "basketball/leagues/womens-college-basketball", NFL: "football/leagues/nfl", CFB: "football/leagues/college-football" };
export const powerUrl = (sport, espnYear) => POWER_LG[sport] ? `${CORE}/${POWER_LG[sport]}/seasons/${espnYear}/powerindex?limit=400` : null;
export const powerTeamUrl = (sport, espnYear, teamId) => POWER_LG[sport] ? `${CORE}/${POWER_LG[sport]}/seasons/${espnYear}/powerindex/${teamId}` : null;
export function powerOf(item) {
  const st = [...(item?.stats || []), ...(item?.predictives || [])];
  const off = statOf(st, "bpioffense"), def = statOf(st, "bpidefense"), net = statOf(st, "bpi", "fpi");
  if (off != null && def != null) return { off, def, net: net ?? off + def };
  return net != null ? { off: net / 2, def: net / 2, net } : null;
}
export function parsePower(j) {
  const out = {};
  for (const it of j?.items || (j && (j.stats || j.predictives) ? [j] : [])) {
    const id = (it.team?.$ref || "").match(/teams\/(\d+)/)?.[1], p = powerOf(it);
    if (id && p) out[id] = p;
  }
  return out;
}
// power points -> the engine's offense / defense ratios vs the league average L (defense: lower = better)
export const powerRatios = (p, L) => p && L > 0 ? { offRating: (L + p.off) / L, defRating: (L - p.def) / L } : null;
export const rankingsUrl = (sport, league) => `${SITE}/${ROUTES[sport].sport}/${league}/rankings`;

// ---------- small helpers ----------
const n = v => { if (v === null || v === undefined || v === "") return null; const x = Number(String(v).replace(/[^\d.+-]/g, "")); return Number.isFinite(x) ? x : null; };
export function amOdds(v) {                                   // "-130", "+110", "EVEN", 105 -> American odds number
  if (v == null) return null;
  if (typeof v === "object") v = v.american ?? v.odds ?? v.value ?? null;
  if (/^even$/i.test(String(v).trim())) return 100;
  const x = n(v);
  return x != null && Math.abs(x) >= 100 && Math.abs(x) < 100000 ? x : null;
}
const line = v => { if (v == null) return null; const x = n(String(v).replace(/^[ou]/i, "")); return x != null && Math.abs(x) < 500 ? x : null; };
const statOf = (arr, ...names) => { for (const nm of names) { const s = (arr || []).find(x => x && (x.name === nm || x.abbreviation === nm)); if (s) { const v = n(s.value ?? s.displayValue); if (v != null) return v; } } return null; };
export const ymd = d => { const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d); return p.replace(/-/g, ""); };
export const etTime = iso => new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }) + " ET";
export const etDayLabel = iso => new Date(iso).toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric" }).replace(",", "");

// ---------- standings: every team's season scoring ----------
export function parseStandings(j) {
  const out = {};
  const walk = node => {
    if (!node || typeof node !== "object") return;
    for (const e of node.standings?.entries || []) {
      // only the season-total stats: college standings also carry home / away / conference splits under the same
      // names (type "homerecord_wins" ...), and reading one of those mixed a home-only game count with season points
      const t = e.team || {}, id = String(t.id || ""), all = e.stats || [];
      const st = all.filter(x => x && !(typeof x.type === "string" && x.type.includes("_")));
      if (!id || out[id]) continue;
      const rec = String((st.find(x => x.name === "overall" || x.type === "total") || {}).displayValue || "").match(/^(\d+)-(\d+)(?:-(\d+))?$/);
      const w = statOf(st, "wins") ?? (rec ? +rec[1] : 0), l = statOf(st, "losses") ?? (rec ? +rec[2] : 0), ti = statOf(st, "ties") || (rec && rec[3] ? +rec[3] : 0), ot = statOf(st, "otLosses", "overtimeLosses") || 0;
      const gp = statOf(st, "gamesPlayed") || (rec ? +rec[1] + +rec[2] + (+rec[3] || 0) + ot : w + l + ti + ot);
      const pf = statOf(st, "pointsFor"), pa = statOf(st, "pointsAgainst");
      let gpg = statOf(st, "avgPointsFor"), gaa = statOf(st, "avgPointsAgainst");
      if (!(gpg > 0) && pf > 0 && gp > 0) gpg = pf / gp;
      if (!(gaa > 0) && pa > 0 && gp > 0) gaa = pa / gp;
      if (gp > 0 && gpg > 0 && gaa > 0) out[id] = { id, abbr: t.abbreviation || "", name: t.displayName || "", short: t.shortDisplayName || "", nick: t.name || "", loc: t.location || "", gp, gpg, gaa, w, l, t: ti + ot };
    }
    for (const c of node.children || []) walk(c);
  };
  walk(j);
  return out;
}
export const leagueAvg = teams => { const v = Object.values(teams).filter(t => t.gp >= 3); return v.length >= 4 ? v.reduce((a, t) => a + t.gpg, 0) / v.length : null; };

// ---------- odds: DraftKings line via the scoreboard (open + current) ----------
export function parseOdds(o) {
  if (!o) return null;
  const ml = o.moneyline || {}, ps = o.pointSpread || {}, tot = o.total || {};
  const cur = side => side?.close || side?.current || side?.open || null;
  const homeML = amOdds(cur(ml.home)?.odds) ?? amOdds(o.homeTeamOdds?.moneyLine), awayML = amOdds(cur(ml.away)?.odds) ?? amOdds(o.awayTeamOdds?.moneyLine);
  let awaySpread = line(cur(ps.away)?.line);
  if (awaySpread == null && n(o.spread) != null) awaySpread = -n(o.spread);           // "spread" is the home line
  const total = line(cur(tot.over)?.line) ?? (n(o.overUnder) > 0 ? n(o.overUnder) : null);
  return {
    homeML, awayML, drawML: amOdds(o.drawOdds?.moneyLine ?? o.drawOdds),
    awaySpread, awaySpreadOdds: amOdds(cur(ps.away)?.odds), homeSpreadOdds: amOdds(cur(ps.home)?.odds),
    total, overOdds: amOdds(cur(tot.over)?.odds), underOdds: amOdds(cur(tot.under)?.odds),
    awaySpreadOpen: line(ps.away?.open?.line), totalOpen: line(tot.over?.open?.line),
    homeMLOpen: amOdds(ml.home?.open?.odds), awayMLOpen: amOdds(ml.away?.open?.odds),
    book: o.provider?.name || "",
  };
}
// Sharp-money signals from the line alone (no public splits in these routes): a move of the spread/total from open
// to now, and whether the favorite flipped. Thresholds scale with each sport's margin spread.
export function lineMove(m, sdM) {
  if (!m) return { steam: false, sharp: null, spreadMove: null, totalMove: null };
  const sm = m.awaySpread != null && m.awaySpreadOpen != null ? m.awaySpread - m.awaySpreadOpen : null;
  const tm = m.total != null && m.totalOpen != null ? m.total - m.totalOpen : null;
  const big = sdM ? 0.12 * sdM : 1.5;
  return { spreadMove: sm, totalMove: tm, steam: sm != null && Math.abs(sm) >= big, sharp: sm != null && Math.abs(sm) >= big / 2 ? (sm < 0 ? "away" : "home") : null };
}

// ---------- scoreboard -> games in the slate shape the algo reads ----------
// standings = {cur:{teamId:row}, prev:{teamId:row}}; hist = {teamId:[{y,gp,gpg,gaa,lg}]}; lg = league average
const recGames = r => { const m = String(r || "").match(/^\s*(\d+)\s*-\s*(\d+)(?:\s*-\s*(\d+))?/); return m ? m.slice(1).reduce((a, x) => a + (x ? Number(x) : 0), 0) : 0; };
export function parseScoreboard(j, sport, { standings = {}, hist = {}, lg = null, sdM = null, league = "" } = {}) {
  const games = [];
  for (const ev of j?.events || []) {
    const c = ev.competitions?.[0];
    if (!c || !Array.isArray(c.competitors) || c.competitors.length !== 2) continue;
    const H = c.competitors.find(x => x.homeAway === "home") || c.competitors[0], A = c.competitors.find(x => x.homeAway === "away") || c.competitors[1];
    const st = c.status?.type || ev.status?.type || {};
    const team = comp => {
      const t = comp.team || {}, id = String(t.id || comp.id || ""), cur = standings.cur?.[id], prev = standings.prev?.[id];
      const rec = (comp.records || []).find(r => r.type === "total" || r.name === "overall")?.summary || "";
      const pr = (comp.probables || [])[0], ps = pr?.statistics || [];
      const form = typeof comp.form === "string" ? comp.form.slice(-5) : "";
      const avgPts = statOf(comp.statistics, "avgPoints", "avgGoals", "avgRuns");
      const out = {
        id, name: t.displayName || t.name || "", abbr: t.abbreviation || "", short: t.shortDisplayName || "", nick: t.name || "", loc: t.location || "", color: t.color ? "#" + t.color : "", rec,
        // ESPN's own "per game" average only before tip-off and only once the team has played: in a team's first game, or
        // once a game is underway, it can be the score of the game in progress
        gp: cur?.gp ?? null, gpg: cur?.gpg ?? (st.state === "pre" && (!rec || recGames(rec) > 0) ? avgPts : null) ?? null, ga: cur?.gaa ?? null,
        pgpg: prev?.gpg ?? null, pga: prev?.gaa ?? null, pgp: prev?.gp ?? null,
        gk: pr?.athlete?.displayName || null, gkId: pr?.athlete?.id ? String(pr.athlete.id) : null, lineup: null, rest: null, miles: null,
        l5w: form ? (form.match(/W/g) || []).length : null, l5l: form ? (form.match(/L/g) || []).length : null,
        hist: hist[id] || [], score: n(comp.score),
      };
      if (sport === "MLB") out.gks = statOf(ps, "ERA");
      if (sport === "NHL") { const sv = statOf(ps, "savePct", "SV%"); out.gks = sv; out.gkGaa = statOf(ps, "goalsAgainstAverage", "GAA"); }
      return out;
    };
    const away = team(A), home = team(H);
    // the day's passing leaders name each team's QB (football); the app attaches his QBR
    for (const l of (c.leaders || []).filter(l => l.name === "passingYards" || l.name === "passingLeader")) for (const x of l.leaders || []) {
      const tid = String(x.team?.id || ""), t = tid === away.id ? away : tid === home.id ? home : null;
      if (t && x.athlete?.id && !t.qbId) { t.qbId = String(x.athlete.id); t.gk = t.gk || x.athlete.displayName || null; }
    }
    const mkt = parseOdds((c.odds || [])[0]);
    const mv = lineMove(mkt, sdM);
    const wx = ev.weather || c.weather;
    const precip = wx && /rain|snow|shower|storm|sleet/i.test(String(wx.displayValue || wx.conditionId || "")) ? "rain" : "none";
    games.push({
      id: String(ev.id), compId: String(c.id || ev.id), league, date: ev.date, time: etTime(ev.date), dayLabel: etDayLabel(ev.date),
      venue: c.venue?.fullName || "", neutral: c.neutralSite === true, lg,
      state: st.state || "pre", completed: st.completed === true, statusText: st.shortDetail || st.detail || "",
      live: st.state === "in" ? { period: n(c.status?.period), clock: n(c.status?.clock), display: c.status?.displayClock || "", detail: st.shortDetail || st.detail || "" } : null,
      away, home,
      wx: c.venue?.indoor ? { dome: true, tempF: null, windMph: null, precip: null } : wx ? { dome: false, tempF: n(wx.temperature), windMph: null, precip } : null,
      mkt: mkt ? { ...mkt, pubAwayPct: null, pubOverPct: null, sharp: mv.sharp, rlm: false, steam: mv.steam, spreadMove: mv.spreadMove, totalMove: mv.totalMove } : null,
      note: "",
    });
  }
  return games;
}

// ---------- game summary: officials, injuries, season series, ATS ----------
export function parseSummary(j) {
  if (!j) return {};
  const officials = (j.gameInfo?.officials || []).map(o => ({ name: o.displayName || o.fullName || "", role: o.position?.displayName || "" })).filter(o => o.name);
  const injuries = [];
  for (const t of j.injuries || []) for (const i of t.injuries || []) {
    const s = String(i.status || i.type?.description || "");
    if (/out|doubtful|questionable|day-to-day|injured reserve/i.test(s)) injuries.push({ team: t.team?.abbreviation || "", name: i.athlete?.displayName || "", pos: i.athlete?.position?.abbreviation || "", status: s });
  }
  const ss = (j.seasonseries || [])[0];
  const ats = (j.againstTheSpread || []).map(x => ({ team: x.team?.abbreviation || "", records: (x.records || []).map(r => `${r.name || r.type || ""} ${r.summary || ""}`.trim()) }));
  return { officials, injuries, seasonSeries: ss ? ss.summary || ss.description || "" : "", ats };
}
export function injuryNote(inj, max = 4) {
  const key = inj.filter(i => /out|doubtful/i.test(i.status)).slice(0, max);
  return key.length ? key.map(i => `${i.team} ${i.name} (${i.pos}) ${i.status}`).join("; ") : "";
}
// ---------- final scores for grading ----------
// every finished game on a scoreboard as a row for the season game log (power ratings): team ids, final score, neutral
// site. Preseason and all-star games are left out (they say nothing about the season); so are games without two teams.
export function resultRows(j) {
  const out = [];
  for (const ev of j?.events || []) {
    const c = ev.competitions?.[0], st = c?.status?.type || ev.status?.type || {};
    if (!c || !st.completed || /postpon|cancel|abandon|forfeit/i.test(`${st.name || ""} ${st.description || ""}`)) continue;
    const stype = Number(ev.season?.type ?? c.season?.type);
    if (stype === 1 || /all[- ]star|exhibition|preseason/i.test(`${ev.name || ""} ${c.type?.abbreviation || ""} ${c.notes?.[0]?.headline || ""} ${ev.season?.slug || ""}`)) continue;
    const H = (c.competitors || []).find(x => x.homeAway === "home"), A = (c.competitors || []).find(x => x.homeAway === "away");
    const hid = String(H?.team?.id || ""), aid = String(A?.team?.id || ""), hs = n(H?.score), as = n(A?.score), t = Date.parse(ev.date || c.date);
    if (!hid || !aid || hid === aid || hs == null || as == null || !Number.isFinite(t)) continue;
    out.push({ id: String(ev.id), day: Math.floor(t / 864e5), h: hid, a: aid, ha: H.team.abbreviation || "", aa: A.team.abbreviation || "", hs, as, neutral: c.neutralSite === true });
  }
  return out;
}
export function finalsFrom(j) {
  const out = [];
  for (const ev of j?.events || []) {
    const c = ev.competitions?.[0], st = c?.status?.type || ev.status?.type || {};
    if (!c || !st.completed) continue;
    const H = c.competitors.find(x => x.homeAway === "home"), A = c.competitors.find(x => x.homeAway === "away");
    if (!H || !A) continue;
    const hs = n(H.score), as = n(A.score);
    if (hs == null || as == null) continue;
    out.push({ id: String(ev.id), date: ev.date, home: H.team?.abbreviation, away: A.team?.abbreviation, homeName: H.team?.displayName, awayName: A.team?.displayName, hs, as });
  }
  return out;
}

// ---------- live scores: every game on one scoreboard, as plain rows for the home screen ----------
// Team sports: away / home with scores. Tennis: each singles match with its set scores. MMA: each bout on the card.
export function liveBoard(j, sport) {
  const out = [], lg = j?.leagues?.[0], league = lg?.abbreviation || lg?.name || "";
  const stOf = (c, e) => { const t = c?.status?.type || e?.status?.type || {}; return { state: t.state || "pre", detail: t.shortDetail || t.detail || t.description || "", done: t.completed === true }; };
  for (const e of j?.events || []) {
    if (sport === "Tennis") {
      for (const g of e.groupings || []) {
        const slug = g.grouping?.slug || "";
        if (!/singles/.test(slug)) continue;
        for (const c of g.competitions || []) {
          const cs = [...(c.competitors || [])].sort((x, y) => (x.order ?? 0) - (y.order ?? 0));
          if (cs.length !== 2) continue;
          const side = x => ({ name: x.athlete?.displayName || x.athlete?.fullName || "TBD", abbr: "", score: (x.linescores || []).map(s => s.value).join(" "), win: x.winner === true });
          out.push({ id: String(c.id), date: c.date || e.date, league: e.name || "", note: c.round?.displayName || "", ...stOf(c, e), away: side(cs[0]), home: side(cs[1]) });
        }
      }
      continue;
    }
    if (sport === "MMA") {
      for (const c of e.competitions || []) {
        const cs = [...(c.competitors || [])].sort((x, y) => (x.order ?? 0) - (y.order ?? 0));
        if (cs.length !== 2) continue;
        const side = x => ({ name: x.athlete?.displayName || x.athlete?.fullName || "TBD", abbr: "", score: "", win: x.winner === true });
        out.push({ id: String(c.id), date: c.date || e.date, league: e.name || "", note: c.type?.abbreviation || c.type?.text || "", ...stOf(c, e), away: side(cs[0]), home: side(cs[1]) });
      }
      continue;
    }
    const c = e.competitions?.[0];
    if (!c) continue;
    const H = (c.competitors || []).find(x => x.homeAway === "home"), A = (c.competitors || []).find(x => x.homeAway === "away");
    if (!H || !A) continue;
    const s = stOf(c, e);
    const side = x => ({ name: x.team?.shortDisplayName || x.team?.displayName || "", full: x.team?.displayName || "", abbr: x.team?.abbreviation || "", nick: x.team?.name || "", loc: x.team?.location || "", score: s.state === "pre" ? "" : String(x.score ?? ""), win: x.winner === true });
    out.push({ id: String(e.id), date: e.date, league, note: "", ...s, away: side(A), home: side(H) });
  }
  return out;
}

// ---------- public betting splits: % of bets (tickets) and % of money on the moneyline, spread and total ----------
// Not on the ESPN routes, so the data job pulls them from two free public sources and the page matches them to its games:
//   Action Network's public scoreboard (consensus tickets / money, JSON) and DraftKings Network's betting-splits page
//   (DraftKings' own bets / handle, HTML). Action Network first; DraftKings fills any game it doesn't have.
export const SPLITS = {
  NFL: { an: ["nfl"], dk: ["88808"], ahead: 7 }, CFB: { an: ["ncaaf", "division=FBS"], dk: ["87637"], ahead: 7 },
  NBA: { an: ["nba"], dk: ["42648"] }, CBB: { an: ["ncaab", "division=D1"], dk: ["92483"] }, CBBW: { an: ["ncaaw", "division=D1"], dk: ["36647"] },
  NHL: { an: ["nhl"], dk: ["42133"] }, MLB: { an: ["mlb"], dk: ["84240"] }, WNBA: { an: ["wnba"], dk: ["94682"] },
  Soccer: { an: ["soccer"], dk: ["40253", "40685", "41410", "89345"] },
};
export const anSplitsUrl = (sport, yyyymmdd) => { const c = SPLITS[sport]; return c ? `https://api.actionnetwork.com/web/v2/scoreboard/${c.an[0]}?bookIds=15&periods=event&date=${yyyymmdd}${c.an[1] ? "&" + c.an[1] : ""}` : null; };
export const dkSplitsUrl = (eg, when, page = 1) => `https://dknetwork.draftkings.com/draftkings-sportsbook-betting-splits/?tb_eg=${eg}&tb_edate=${when}&tb_page=${page}`;
const pctOf = v => { const x = Number(v); return Number.isFinite(x) && x >= 0 && x <= 100 ? Math.round(x) : null; };
const pair = (b, m) => (b == null && m == null ? null : [b, m]);
const nonEmpty = s => !!s && [s.ml?.a, s.ml?.h, s.sp?.a, s.sp?.h, s.tot?.o, s.tot?.u].some(p => p && (p[0] || p[1]));
// a market where every side reads 0% bets and 0% money hasn't been posted yet: drop it rather than show 0 / 100
function clean(s) {
  for (const [k, sides] of [["ml", ["a", "h", "d"]], ["sp", ["a", "h"]], ["tot", ["o", "u"]]]) {
    const m = s[k]; if (!m) continue;
    if (!sides.some(x => m[x] && ((m[x][0] || 0) + (m[x][1] || 0)) > 0)) for (const x of sides) m[x] = null;
  }
  return s;
}

export function parseANSplits(j) {
  const out = [];
  for (const g of j?.games || []) {
    const W = s => String(s || "").replace(/\s*\(W\)\s*$/, "");
    const T = Object.fromEntries((g.teams || []).map(t => [t.id, { abbr: W(t.abbr), name: W(t.full_name || t.display_name), nick: W(t.short_name), loc: W(t.location || t.display_name) }]));
    const a = T[g.away_team_id], h = T[g.home_team_id];
    if (!a || !h) continue;
    const books = g.markets || {}, ev = (books["15"] || books[Object.keys(books)[0]] || {}).event || {};
    const side = (arr, s) => { const o = (arr || []).find(x => x.side === s), bi = o?.bet_info; return o ? { line: n(o.value), odds: n(o.odds), p: bi ? pair(pctOf(bi.tickets?.percent), pctOf(bi.money?.percent)) : null } : null; };
    const ma = side(ev.moneyline, "away"), mh = side(ev.moneyline, "home"), md = side(ev.moneyline, "draw");
    const sa = side(ev.spread, "away"), sh = side(ev.spread, "home"), to = side(ev.total, "over"), tu = side(ev.total, "under");
    const s = { src: "Action Network", t: g.start_time, a, h,
      ml: { a: ma?.p || null, h: mh?.p || null, d: md?.p || null },
      sp: { line: sa?.line ?? null, a: sa?.p || null, h: sh?.p || null },
      tot: { line: to?.line ?? tu?.line ?? null, o: to?.p || null, u: tu?.p || null } };
    if (nonEmpty(clean(s))) out.push(s);
  }
  return out;
}

// "Thu 11/5 · 8:15 PM ET" -> ISO (the year is the nearest one to now)
function etStamp(txt, now = new Date()) {
  const m = String(txt).match(/(\d{1,2})\/(\d{1,2})\D+(\d{1,2}):(\d{2})\s*([AP]M)/i);
  if (!m) return null;
  const mo = Number(m[1]) - 1, d = Number(m[2]), hh = (Number(m[3]) % 12) + (/p/i.test(m[5]) ? 12 : 0), mm = Number(m[4]);
  let best = null;
  for (const y of [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1]) {
    const guess = Date.UTC(y, mo, d, hh + 5, mm);                    // EST; corrected for daylight time below
    const off = new Date(guess).toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false });
    const t = guess - ((Number(off) % 24) - hh) * 3600e3;
    if (!best || Math.abs(t - now) < Math.abs(best - now)) best = t;
  }
  return new Date(best).toISOString();
}
const decode = s => String(s).replace(/&amp;/g, "&").replace(/&#0?38;/g, "&").replace(/&#0?39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ").replace(/&#8211;|&ndash;/g, "-").replace(/&#8722;|−/g, "-");
const dkTeam = s => { const t = decode(s).trim(), m = t.match(/^([A-Z0-9&.]{2,5})\s+(.+)$/); return m ? { abbr: m[1], name: t, nick: m[2], loc: "" } : { abbr: "", name: t, nick: "", loc: "" }; };
export function parseDKSplits(html, now = new Date()) {
  const out = [], blocks = String(html || "").split('<div class="tb-se ').slice(1);
  for (const b of blocks) {
    const title = decode((b.match(/<h5[^>]*>([\s\S]*?)<\/h5>/) || [])[1] || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const at = title.match(/^(.+?)\s+@\s+(.+)$/), vs = title.match(/^(.+?)\s+vs\.?\s+(.+)$/i);   // "Away @ Home"; soccer is "Home vs Away"
    if (!at && !vs) continue;
    const a = dkTeam(at ? at[1] : vs[2]), h = dkTeam(at ? at[2] : vs[1]);
    const when = decode((b.match(/<span[^>]*>([^<]*\d{1,2}\/\d{1,2}[^<]*)<\/span>/) || [])[1] || "");
    const toks = decode(b.replace(/<[^>]+>/g, "|")).split("|").map(x => x.replace(/\s+/g, " ").trim()).filter(Boolean);
    const s = { src: "DraftKings", t: etStamp(when, now), a, h, ml: { a: null, h: null, d: null }, sp: { line: null, a: null, h: null }, tot: { line: null, o: null, u: null } };
    let mk = null;
    const isT = (sel, t) => (t.abbr && sel.startsWith(t.abbr + " ")) || sel.startsWith(t.name) || sel === t.abbr;
    for (let i = 0; i < toks.length; i++) {
      const x = toks[i];
      if (/^(Moneyline|Spread|Total|Puck Line|Run Line|Point Spread|Match Result|Goal Line)$/i.test(x)) { mk = /money|match result/i.test(x) ? "ml" : /total/i.test(x) ? "tot" : "sp"; continue; }
      if (!mk || i + 3 >= toks.length) continue;
      const odds = toks[i + 1], hd = toks[i + 2], bt = toks[i + 3];
      if (!/^[+-]?\d+$|^EVEN$/i.test(odds) || !/%$/.test(hd) || !/%$/.test(bt)) continue;
      const p = pair(pctOf(bt.replace("%", "")), pctOf(hd.replace("%", "")));   // [bets, money(handle)]
      if (mk === "tot") { const o = /^over/i.test(x), v = n(x.replace(/^(over|under)\s*/i, "")); s.tot[o ? "o" : "u"] = p; if (v != null) s.tot.line = v; }
      else if (mk === "ml") { if (/^draw$|^tie$/i.test(x)) s.ml.d = p; else if (isT(x, a)) s.ml.a = p; else if (isT(x, h)) s.ml.h = p; }
      else { const v = n((x.match(/([+-]\d+(?:\.\d+)?)\s*$/) || [])[1]); if (isT(x, a)) { s.sp.a = p; if (v != null) s.sp.line = v; } else if (isT(x, h)) { s.sp.h = p; if (v != null && s.sp.line == null) s.sp.line = -v; } }
      i += 3;
    }
    if (nonEmpty(clean(s))) out.push(s);
  }
  return out;
}

// Match one ESPN game to a splits entry: start within 4 hours and both teams agree (abbreviation, nickname or name).
const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
function teamScore(t, s) {
  const nm = norm(t.name), ab = norm(t.abbr);
  let k = 0;
  if (ab && norm(s.abbr) === ab) k += 2;
  if (s.nick && nm.endsWith(norm(s.nick))) k += 2;
  if (s.loc && nm.startsWith(norm(s.loc))) k += 1;
  if (s.name && (nm === norm(s.name) || nm.includes(norm(s.name)) || norm(s.name).includes(nm))) k += 2;
  return k;
}
export function matchSplit(game, list) {
  const t0 = Date.parse(game.date), hits = [];
  (list || []).forEach((s, i) => {
    if (s.t && Number.isFinite(t0) && Math.abs(Date.parse(s.t) - t0) > 4 * 3600e3) return;
    const st = Math.min(teamScore(game.away, s.a), teamScore(game.home, s.h)), fl = Math.min(teamScore(game.away, s.h), teamScore(game.home, s.a));
    const k = Math.max(st, fl);
    if (k >= 2) hits.push({ k, i, s, flip: fl > st });
  });
  if (!hits.length) return null;
  // best match first (Action Network ahead of DraftKings on a tie); each market comes from the first source that posted it
  hits.sort((x, y) => y.k - x.k || x.i - y.i);
  const one = ({ s, flip }) => { const sw = (x, y) => (flip ? y : x);
    return { src: s.src, ml: { a: sw(s.ml.a, s.ml.h), h: sw(s.ml.h, s.ml.a), d: s.ml.d }, sp: { a: sw(s.sp.a, s.sp.h), h: sw(s.sp.h, s.sp.a), line: s.sp.line == null ? null : flip ? -s.sp.line : s.sp.line }, tot: { ...s.tot } }; };
  const all = hits.filter(h => h.s.src !== hits[0].s.src || h === hits[0]).map(one).slice(0, 2), out = { ...all[0] }, used = new Set();
  for (const [k, sides] of [["ml", ["a", "h"]], ["sp", ["a", "h"]], ["tot", ["o", "u"]]]) {
    const posted = x => sides.some(sd => x[k][sd] && ((x[k][sd][0] || 0) + (x[k][sd][1] || 0)) > 0);
    const pick = all.find(posted) || all[0];
    out[k] = posted(pick) ? pick[k] : { ...pick[k], ...Object.fromEntries(sides.map(sd => [sd, null])) }; if (posted(pick)) used.add(pick.src);
  }
  out.src = [...used].join(" + ") || all[0].src;
  return out;
}

// ---------- typed team names: "UMass", "Ball St", "Mass", "Minutemen", "Massachusetts Minutemen" all find the same team ----------
// Scores one team against what was typed: 3 = exact (any of its names or the abbreviation), 2 = clearly the same team
// (every typed word is in its full name, or a name starts with it), 1 = nickname / last word only, 0 = no.
const ALIAS = { "st": ["state", "saint"], "u": ["university"], "univ": ["university"], "mt": ["mount"], "ft": ["fort"], "n": ["north"], "s": ["south"], "e": ["east"], "w": ["west"] };
function variants(q) {
  const base = norm(q).replace(/\b(the|university of|univ of)\b/g, " ").replace(/\s+/g, " ").trim();
  const out = new Set([base]);
  for (const [k, vs] of Object.entries(ALIAS)) if (new RegExp(`\\b${k}\\b`).test(base)) for (const v of vs) out.add(base.replace(new RegExp(`\\b${k}\\b`, "g"), v));
  return [...out].filter(Boolean);
}
export function teamQueryScore(t, q) {
  if (!t || !q) return 0;
  const full = norm(t.name), names = [t.name, t.short, t.loc, t.nick, t.abbr, t.loc && t.nick ? `${t.loc} ${t.nick}` : ""].map(norm).filter(Boolean);
  const words = new Set(names.join(" ").split(" "));
  let best = 0;
  for (const v of variants(q)) {
    if (names.includes(v)) return 3;
    const vw = v.split(" ");
    if (v.length >= 3 && (vw.every(w => words.has(w)) || names.some(n => n.startsWith(v + " ") || (v.length >= 4 && n.startsWith(v))))) best = Math.max(best, 2);
    else if (v.length >= 4 && full.includes(v)) best = Math.max(best, 2);
    else if (vw.includes(full.split(" ").pop())) best = Math.max(best, 1);
  }
  return best;
}

// ---------- lineups: the posted one when it's out, otherwise the team's last one with injured starters replaced ----------
export const teamScheduleUrl = (sport, league, teamId) => `${SITE}/${ROUTES[sport].sport}/${league}/teams/${teamId}/schedule`;
// the team's most recent finished game before `before` (ISO), from its schedule
export function lastCompletedEvent(j, before = new Date().toISOString()) {
  const done = (j?.events || []).filter(e => (e.competitions?.[0]?.status?.type?.completed || e.status?.type?.completed) && String(e.date) < before);
  done.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const e = done[done.length - 1];
  return e ? { id: String(e.id), date: e.date, name: e.shortName || e.name || "" } : null;
}
const minutesOf = v => { const s = String(v ?? ""); const m = s.match(/^(\d+):(\d{2})$/); if (m) return +m[1] + +m[2] / 60; const x = Number(s); return Number.isFinite(x) ? x : null; };
// A player's line from a game in progress (or finished): the handful of numbers that matter in that sport.
const SOC = [["totalGoals", "G"], ["goalAssists", "A"], ["totalShots", "SH"], ["shotsOnTarget", "SOT"], ["saves", "SV"], ["goalsConceded", "GA"], ["yellowCards", "YC"], ["redCards", "RC"]];
function socLine(stats, pos) {
  const m = Object.fromEntries((stats || []).map(x => [x.name || x.abbreviation, Number(x.value ?? x.displayValue)]));
  const gk = String(pos || "").startsWith("G");
  const keeperOnly = l => l === "SV" || l === "GA";            // every player on the pitch is credited the goals conceded; only the keeper's matter
  return SOC.filter(([k, l]) => Number.isFinite(m[k]) && (keeperOnly(l) ? gk : m[k] > 0)).map(([k, l]) => `${m[k]} ${l}`).join(" · ");
}
const BOX = ["MIN", "PTS", "REB", "AST", "G", "A", "SOG", "TOI", "SA", "SV", "GA", "H-AB", "R", "RBI", "HR", "IP", "ER", "K"];
const boxLine = st => BOX.filter(l => st[l] != null && st[l] !== "" && st[l] !== "--").map(l => `${st[l]} ${l}`).join(" · ");
// One summary -> each team's players: who started, position, minutes and points from that game (when played).
// Soccer posts its XI under "rosters" about an hour before kick-off; other sports show starters in the box score.
export function parseLineups(j) {
  const teams = {};
  for (const r of j?.rosters || []) {
    const id = String(r.team?.id || ""); if (!id) continue;
    const players = (r.roster || []).map((x, i) => ({ id: String(x.athlete?.id || i), name: x.athlete?.displayName || "", pos: x.position?.abbreviation || "", starter: x.starter === true, min: null, pts: null, order: Number(x.formationPlace) || 99 + i,
      line: socLine(x.stats, x.position?.abbreviation), sub: x.subbedIn === true || x.subbedIn?.didSub === true }))
      .filter(p => p.name);
    teams[id] = { abbr: r.team?.abbreviation || "", formation: r.formation || "", players };
  }
  for (const p of j?.boxscore?.players || []) {
    const id = String(p.team?.id || ""); if (!id) continue;
    const seen = new Map();
    let k = 0;
    for (const g of p.statistics || []) {
      const lab = g.labels || g.names || [];
      for (const a of g.athletes || []) {
        const aid = String(a.athlete?.id || a.athlete?.displayName || k);
        if (seen.has(aid)) continue;
        const st = Object.fromEntries(lab.map((l, i) => [l, (a.stats || [])[i]]));
        seen.set(aid, { id: aid, name: a.athlete?.displayName || "", pos: a.athlete?.position?.abbreviation || "", starter: a.starter === true, dnp: a.didNotPlay === true,
          min: minutesOf(st.MIN ?? st.TOI), pts: Number.isFinite(Number(st.PTS)) ? Number(st.PTS) : null, order: k++, line: boxLine(st), stats: st });
      }
    }
    // football box scores don't mark starters: the key players are the passer, the top two rushers, the top three
    // receivers and the top three tacklers (each group is listed best first)
    if (![...seen.values()].some(x => x.starter)) {
      const grp = nm => (p.statistics || []).find(g => g.name === nm)?.athletes || [];
      const keys = [["passing", 1, "QB"], ["rushing", 2, "RB"], ["receiving", 3, "WR"], ["defensive", 3, "DEF"]];
      if (grp("passing").length) {
        let o = 0;
        for (const [nm, k, pos] of keys) for (const a of grp(nm).slice(0, k)) {
          const x = seen.get(String(a.athlete?.id || a.athlete?.displayName));
          if (x && !x.starter) { x.starter = true; x.pos = pos; x.order = o++; }
        }
        for (const x of seen.values()) if (!x.starter && !x.pos) x.pos = (p.statistics || []).find(g => (g.athletes || []).some(a => String(a.athlete?.id) === x.id))?.name === "passing" ? "QB" : "";
      }
    }
    if (seen.size && !(teams[id]?.players?.some(x => x.starter))) teams[id] = { abbr: p.team?.abbreviation || teams[id]?.abbr || "", formation: teams[id]?.formation || "", players: [...seen.values()].filter(x => x.name) };
  }
  for (const t of Object.values(teams)) t.official = t.players.some(x => x.starter);
  return teams;
}
const nameKey = s => norm(s).replace(/\b(jr|sr|ii|iii|iv)\b/g, "").trim();
const OUT = /out|doubtful|suspend|injured reserve/i;
// The last game's starters, with any starter now listed Out / Doubtful replaced by the bench player at the same
// position who played the most that game, the way a coach would slide the next man up.
export function probableLineup(last, injuries, sport) {
  const ps = (last?.players || []).filter(p => !p.dnp);
  const hurt = new Map((injuries || []).filter(i => OUT.test(i.status)).map(i => [nameKey(i.name), i.status]));
  const starters = ps.filter(p => p.starter).sort((a, b) => a.order - b.order);
  const bench = ps.filter(p => !p.starter && !hurt.has(nameKey(p.name))).sort((a, b) => (b.min ?? -1) - (a.min ?? -1) || a.order - b.order);
  const used = new Set(), moves = [], out = [];
  const lineup = starters.map(p => {
    if (!hurt.has(nameKey(p.name))) return { ...p };
    out.push({ ...p, status: hurt.get(nameKey(p.name)) });
    const g = String(p.pos || "")[0], pick = bench.find(b => !used.has(b.id) && String(b.pos || "")[0] === g) || bench.find(b => !used.has(b.id));
    if (!pick) return null;
    used.add(pick.id); moves.push({ out: p.name, in: pick.name, status: hurt.get(nameKey(p.name)) });
    return { ...pick, starter: true, note: `up from the bench for ${p.name} (${hurt.get(nameKey(p.name))})` };
  }).filter(Boolean);
  // basketball: the scoring the missing starters produced last game, as a share of the team's points
  const tot = ps.reduce((a, p) => a + (p.pts || 0), 0), lost = out.reduce((a, p) => a + (p.pts || 0), 0);
  const hoops = /NBA|WNBA|CBB/.test(sport);
  const adj = hoops && tot > 0 ? Math.max(0.96, 1 - 0.25 * lost / tot) : 1;   // others absorb most of it; at most 4%
  return { players: lineup, moves, out, adj, lostShare: tot > 0 ? lost / tot : 0 };
}

// ---------- player ratings from season stats (core athlete statistics route), 45-99 with ~72 a regular starter ----------
export const athleteSeasonUrl = (sport, league, espnYear, id) => `${CORE}/${ROUTES[sport].sport}/leagues/${league}/seasons/${espnYear}/types/${sport === "Soccer" ? 1 : 2}/athletes/${id}/statistics`;
const r1 = x => Math.round(x * 10) / 10;
export function playerRating(j, sport, pos = "") {
  const m = {};
  for (const c of j?.splits?.categories || []) for (const s of c.stats || []) if (s?.name && !(s.name in m) && Number.isFinite(Number(s.value))) m[s.name] = Number(s.value);
  if (!Object.keys(m).length) return null;
  const gk = /^G/.test(String(pos));
  let raw = null, n = 0, why = "", keeper = null;
  if (/NBA|WNBA|CBB/.test(sport)) {
    n = m.gamesPlayed || 0; if (!n) return null;
    raw = m.PER > 0 ? 60 + 1.2 * m.PER : 58 + 1.1 * ((m.avgPoints || 0) + (m.avgRebounds || 0) + (m.avgAssists || 0) + (m.avgSteals || 0) + (m.avgBlocks || 0) - (m.avgTurnovers || 0));
    why = `${r1(m.avgPoints || 0)} pts · ${r1(m.avgRebounds || 0)} reb · ${r1(m.avgAssists || 0)} ast${m.PER > 0 ? ` · PER ${r1(m.PER)}` : ""} (${n} gp)`;
  } else if (sport === "NHL") {
    n = m.games || m.gamesPlayed || 0; if (!n) return null;
    if (gk && m.savePct > 0.5) { raw = 75 + (m.savePct - 0.905) * 600; why = `${m.savePct.toFixed(3).replace(/^0/, "")} SV%${m.avgGoalsAgainst ? ` · ${m.avgGoalsAgainst.toFixed(2)} GAA` : ""} (${n} gp)`; }
    else { const p = (m.goals || 0) + (m.assists || 0); raw = 62 + 30 * p / n + 0.15 * (m.plusMinus || 0); why = `${m.goals || 0} G · ${m.assists || 0} A in ${n} gp${m.plusMinus ? ` · ${m.plusMinus > 0 ? "+" : ""}${m.plusMinus}` : ""}`; }
  } else if (sport === "Soccer") {
    const min = m.minutes || 0, apps = m.appearances || 0; n = min / 90; if (min < 45) return null;
    if (gk) {
      const sv = (m.saves || 0) + (m.goalsConceded || 0) > 0 ? (m.saves || 0) / ((m.saves || 0) + (m.goalsConceded || 0)) : null, ga90 = (m.goalsConceded || 0) * 90 / min;
      raw = 72 + (sv != null ? (sv - 0.68) * 80 : 0) - (ga90 - 1.3) * 5;
      keeper = { sv, ga90, apps }; why = `${Math.round(m.saves || 0)} saves, ${Math.round(m.goalsConceded || 0)} conceded in ${Math.round(apps)} apps${sv != null ? ` (${Math.round(sv * 100)}% saved)` : ""}`;
    } else {
      const p90 = k => (m[k] || 0) * 90 / min;
      raw = 66 + 16 * p90("totalGoals") + 11 * p90("goalAssists") + 2.5 * p90("shotsOnTarget") + 1.2 * (p90("totalTackles") + p90("interceptions")) + ((m.passPct || 0.8) - 0.8) * 25;
      why = `${Math.round(m.totalGoals || 0)} G · ${Math.round(m.goalAssists || 0)} A in ${Math.round(apps)} apps${m.passPct ? ` · ${Math.round(m.passPct * 100)}% passing` : ""}`;
    }
  } else if (sport === "NFL" || sport === "CFB") {
    n = m.gamesPlayed || 0; if (!n) return null;
    const pg = k => (m[k] || 0) / n;
    if (pos === "QB" && m.passingAttempts > 0) {
      const ypa = (m.netPassingYards || m.passingYards || 0) / m.passingAttempts, td = m.passingTouchdownPct ?? 100 * (m.passingTouchdowns || 0) / m.passingAttempts, int = m.interceptionPct ?? 100 * (m.interceptions || 0) / m.passingAttempts;
      raw = 64 + (ypa - 6.5) * 6 + (td - 4) * 2.5 - (int - 2.5) * 3 + ((m.completionPct || 63) - 63) * 0.3;
      why = `${r1(m.completionPct || 0)}% · ${r1(ypa)} yds/att · ${m.passingTouchdowns ?? Math.round(td * m.passingAttempts / 100)} TD, ${m.interceptions || 0} INT (${n} g)`;
    } else if (pos === "RB" && m.rushingAttempts > 0) {
      const ypc = (m.rushingYards || 0) / m.rushingAttempts;
      raw = 60 + 0.25 * pg("rushingYards") + (ypc - 4.2) * 5 + 6 * pg("rushingTouchdowns");
      why = `${r1(pg("rushingYards"))} rush yds/g · ${r1(ypc)} per carry · ${m.rushingTouchdowns || 0} TD (${n} g)`;
    } else if (pos === "WR" && (m.receptions > 0 || m.receivingYards > 0)) {
      raw = 60 + 0.25 * pg("receivingYards") + 1.2 * pg("receptions") + 8 * pg("receivingTouchdowns");
      why = `${r1(pg("receptions"))} rec · ${r1(pg("receivingYards"))} yds a game · ${m.receivingTouchdowns || 0} TD (${n} g)`;
    } else if (pos === "DEF" && (m.totalTackles > 0 || m.sacks > 0)) {
      raw = 60 + 1.2 * pg("totalTackles") + 6 * pg("sacks") + 3 * pg("tacklesForLoss") + 4 * pg("passesDefended") + 10 * pg("interceptions");
      why = `${r1(pg("totalTackles"))} tackles · ${m.sacks || 0} sacks · ${m.tacklesForLoss || 0} TFL (${n} g)`;
    } else return null;
  } else if (sport === "MLB") {
    n = m.gamesPlayed || m.games || 0; if (!n) return null;
    if (m.OPS > 0 && !/^(SP|RP|P)$/.test(pos)) { raw = 40 + 45 * m.OPS; why = `${m.OPS.toFixed(3).replace(/^0/, "")} OPS${m.homeRuns ? ` · ${m.homeRuns} HR` : ""} (${n} g)`; }
    else if (m.ERA > 0) { raw = 92 - 4 * m.ERA; why = `${m.ERA.toFixed(2)} ERA (${n} g)`; }
    else return null;
  } else return null;
  // a few games are a thin sample: pulled toward a regular starter's 72
  const rating = Math.round(Math.max(45, Math.min(99, 72 + (raw - 72) * n / (n + 3))));
  return { rating, why, keeper };
}

// ---------- soccer: one overall rating from every competition a player plays in (league, cups, Europe, his country) ----------
// The athlete's statistics log lists each competition per season; this season counts in full and last season at half,
// the way a FIFA-style rating reflects more than the last few matches.
export const athleteLogUrl = id => `${CORE}/soccer/athletes/${id}/statisticslog`;
export function logRefs(log, years, weights) {
  const out = [];
  for (const e of log?.entries || []) {
    const y = Number((String(e.season?.$ref || "").match(/seasons\/(\d{4})/) || [])[1]);
    const i = years.indexOf(y);
    if (i < 0) continue;
    const tot = (e.statistics || []).find(s => s.type === "total") || (e.statistics || [])[0];
    const ref = tot?.statistics?.$ref, lg = (String(tot?.league?.$ref || e.season?.$ref || "").match(/leagues\/([^/?]+)/) || [])[1] || "";
    if (ref) out.push({ url: ref.replace(/^http:/, "https:"), w: weights[i], league: lg, year: y });
  }
  return out;
}
// Sum the counting stats across competitions (weighted); pass completion is minutes-weighted.
const SUMMED = ["minutes", "appearances", "starts", "totalGoals", "goalAssists", "shotsOnTarget", "totalShots", "totalTackles", "interceptions", "saves", "goalsConceded"];
export function combineStats(parts) {
  const m = {}, wp = { v: 0, w: 0 };
  for (const { json, w } of parts) {
    const s = {};
    for (const c of json?.splits?.categories || []) for (const x of c.stats || []) if (x?.name && !(x.name in s) && Number.isFinite(Number(x.value))) s[x.name] = Number(x.value);
    for (const k of SUMMED) if (s[k] > 0) m[k] = (m[k] || 0) + w * s[k];
    if (s.passPct > 0 && s.minutes > 0) { wp.v += s.passPct * s.minutes * w; wp.w += s.minutes * w; }
  }
  if (wp.w > 0) m.passPct = wp.v / wp.w;
  return { splits: { categories: [{ name: "combined", stats: Object.entries(m).map(([name, value]) => ({ name, value })) }] } };
}

// ---------- EA SPORTS FC ratings: find the ESPN player in EA's list (accents, legal vs common names, same club) ----------
const toks = s => norm(s).split(" ").filter(w => w.length > 1);
const clubKey = s => norm(s).replace(/\b(fc|cf|sc|afc|club|de|calcio|ac|as|ss|sv|vfb|vfl|tsg|rc|cd|ud|sd|ca|fk|sk)\b/g, " ").replace(/\s+/g, " ").trim();
const sameClub = (a, b) => { const x = clubKey(a), y = clubKey(b); if (!x || !y) return false; if (x === y || x.includes(y) || y.includes(x)) return true; const xs = x.split(" "), ys = new Set(y.split(" ")); return xs.filter(w => w.length > 3 && ys.has(w)).length >= 1; };
export function fifaIndex(file) {
  const F = file?.fields || [], ix = k => F.indexOf(k), out = [];
  for (const r of file?.players || []) out.push({ id: r[ix("id")], name: r[ix("name")], first: r[ix("first")], last: r[ix("last")], team: r[ix("team")], ovr: r[ix("ovr")], pos: r[ix("pos")], all: new Set([...toks(r[ix("name")]), ...toks(r[ix("first")]), ...toks(r[ix("last")])]) });
  out.byTok = new Map();                                   // name word -> players, so a lookup only checks players sharing a word
  for (const p of out) for (const w of p.all) { if (!out.byTok.has(w)) out.byTok.set(w, []); out.byTok.get(w).push(p); }
  return out;
}
// 3 = same name, 2 = surname (or a distinctive name) shared and the same club, 0 = no match
export function matchFifa(name, team, idx) {
  const n = norm(name), nt = toks(name), last = nt[nt.length - 1];
  let best = null;
  const pool = idx?.byTok ? [...new Set(nt.flatMap(w => idx.byTok.get(w) || []))] : idx || [];
  for (const p of pool) {
    const club = team ? sameClub(team, p.team) : false;
    let k = 0;
    if (n === norm(p.name) || n === norm(`${p.first} ${p.last}`)) k = club || !team ? 3 : 2.5;
    else if (club) {
      const shared = nt.filter(w => p.all.has(w));
      if (last && p.all.has(last) && (shared.length >= 2 || nt.length === 1 || norm(p.first)[0] === nt[0][0])) k = 2;
      else if (shared.some(w => w.length >= 5 && !/^(junior|junior|silva|santos|souza|costa|pereira|oliveira|rodrigues|fernandes|gomez|garcia|martinez|lopez)$/.test(w))) k = 1.5;
    }
    if (k > (best?.k || 0)) best = { k, p };
  }
  return best && best.k >= 1.5 ? { ovr: best.p.ovr, pos: best.p.pos, name: best.p.name, team: best.p.team, sure: best.k >= 2 } : null;
}
