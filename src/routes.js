// Every data route the app and the data job use, from github.com/pseudo-r/Public-ESPN-API (docs/sports/*.md).
// One module shared by the browser app and the GitHub data job, so both read the data the same way.
export const SITE = "https://site.api.espn.com/apis/site/v2/sports";
export const SITE2 = "https://site.api.espn.com/apis/v2/sports";        // standings live here (the site/v2 path is a stub)
export const CORE = "https://sports.core.api.espn.com/v2/sports";
// app sport key -> ESPN sport slug + leagues (+ query extras). Soccer runs several leagues on one board.
export const ROUTES = {
  MLB:    { sport: "baseball",   leagues: ["mlb"] },
  NFL:    { sport: "football",   leagues: ["nfl"] },
  CFB:    { sport: "football",   leagues: ["college-football"], q: "groups=80&limit=300" },          // all FBS games, not just the top 25
  NBA:    { sport: "basketball", leagues: ["nba"] },
  WNBA:   { sport: "basketball", leagues: ["wnba"] },
  CBB:    { sport: "basketball", leagues: ["mens-college-basketball"], q: "groups=50&limit=500" },   // all Division I
  CBBW:   { sport: "basketball", leagues: ["womens-college-basketball"], q: "groups=50&limit=500" },
  NHL:    { sport: "hockey",     leagues: ["nhl"] },
  Soccer: { sport: "soccer",     leagues: ["eng.1", "esp.1", "ger.1", "ita.1", "fra.1", "usa.1", "mex.1", "uefa.champions", "uefa.europa", "fifa.world", "fifa.worldq.uefa", "fifa.friendly"] },
  Tennis: { sport: "tennis",     leagues: ["atp", "wta"] },
  MMA:    { sport: "mma",        leagues: ["ufc"] },
};
export const TEAM_SPORTS = ["MLB", "NFL", "CFB", "NBA", "WNBA", "CBB", "CBBW", "NHL", "Soccer"];
// ESPN labels NBA/NHL/college-hoops seasons by the year they END (2026-27 = 2027); the app labels by the year they start.
const ENDS_LABEL = new Set(["NBA", "NHL", "CBB", "CBBW"]);
export const espnSeason = (sport, startYear) => ENDS_LABEL.has(sport) ? startYear + 1 : startYear;
export const startYearOf = (sport, espnYear) => ENDS_LABEL.has(sport) ? espnYear - 1 : espnYear;

export const scoreboardUrl = (sport, league, ymd) => { const r = ROUTES[sport]; return `${SITE}/${r.sport}/${league}/scoreboard?dates=${ymd}${r.q ? "&" + r.q : ""}`; };
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
      const t = e.team || {}, st = e.stats || [], id = String(t.id || "");
      if (!id || out[id]) continue;
      const w = statOf(st, "wins") || 0, l = statOf(st, "losses") || 0, ti = statOf(st, "ties") || 0, ot = statOf(st, "otLosses", "overtimeLosses") || 0;
      const gp = statOf(st, "gamesPlayed") || (w + l + ti + ot);
      const pf = statOf(st, "pointsFor"), pa = statOf(st, "pointsAgainst");
      let gpg = statOf(st, "avgPointsFor"), gaa = statOf(st, "avgPointsAgainst");
      if (!(gpg > 0) && pf > 0 && gp > 0) gpg = pf / gp;
      if (!(gaa > 0) && pa > 0 && gp > 0) gaa = pa / gp;
      if (gp > 0 && gpg > 0 && gaa > 0) out[id] = { id, abbr: t.abbreviation || "", name: t.displayName || "", gp, gpg, gaa, w, l, t: ti + ot };
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
// to now, and whether the favourite flipped. Thresholds scale with each sport's margin spread.
export function lineMove(m, sdM) {
  if (!m) return { steam: false, sharp: null, spreadMove: null, totalMove: null };
  const sm = m.awaySpread != null && m.awaySpreadOpen != null ? m.awaySpread - m.awaySpreadOpen : null;
  const tm = m.total != null && m.totalOpen != null ? m.total - m.totalOpen : null;
  const big = sdM ? 0.12 * sdM : 1.5;
  return { spreadMove: sm, totalMove: tm, steam: sm != null && Math.abs(sm) >= big, sharp: sm != null && Math.abs(sm) >= big / 2 ? (sm < 0 ? "away" : "home") : null };
}

// ---------- scoreboard -> games in the slate shape the algo reads ----------
// standings = {cur:{teamId:row}, prev:{teamId:row}}; hist = {teamId:[{y,gp,gpg,gaa,lg}]}; lg = league average
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
        id, name: t.displayName || t.name || "", abbr: t.abbreviation || "", color: t.color ? "#" + t.color : "", rec,
        gp: cur?.gp ?? null, gpg: cur?.gpg ?? avgPts ?? null, ga: cur?.gaa ?? null,
        pgpg: prev?.gpg ?? null, pga: prev?.gaa ?? null, pgp: prev?.gp ?? null,
        gk: pr?.athlete?.displayName || null, lineup: null, rest: null, miles: null,
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
