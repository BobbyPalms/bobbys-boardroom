// Live progress for each leg on a ticket: player props from the game's box score (Dalton Kincaid 14 of 20 receiving
// yards), totals from the score, spreads and moneylines as covering / not. Pure functions: the page feeds in the
// scoreboard rows and box scores it already pulls.

const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\b(jr|sr|ii|iii|iv)\b/g, "").replace(/\s+/g, " ").trim();
const num = v => { const x = parseFloat(String(v ?? "").replace(/[^\d.-]/g, "")); return Number.isFinite(x) ? x : 0; };

// Kalshi prop series (without KX and the PROT suffix) -> which box-score column(s) to add up: [group, label, part]
// group null = any group (basketball has one); part picks one side of "12/20" or "3-7" (made / attempted)
const FB = p => ({
  [`${p}RECYDS`]: { cols: [["receiving", "YDS"]], unit: "rec yds" },
  [`${p}RSHYDS`]: { cols: [["rushing", "YDS"]], unit: "rush yds" },
  [`${p}PASSYDS`]: { cols: [["passing", "YDS"]], unit: "pass yds" },
  [`${p}RRYDS`]: { cols: [["rushing", "YDS"], ["receiving", "YDS"]], unit: "rush + rec yds" },
  [`${p}REC`]: { cols: [["receiving", "REC"]], unit: "catches" },
  [`${p}PASSTDS`]: { cols: [["passing", "TD"]], unit: "pass TD" },
  [`${p}TD`]: { cols: [["rushing", "TD"], ["receiving", "TD"]], unit: "TD" },
  [`${p}PASSATT`]: { cols: [["passing", "C/ATT", 1]], unit: "attempts" },
  [`${p}PASSCOMP`]: { cols: [["passing", "C/ATT", 0]], unit: "completions" },
  [`${p}RSHATT`]: { cols: [["rushing", "CAR"]], unit: "carries" },
  [`${p}PASSINT`]: { cols: [["passing", "INT"]], unit: "INT" },
});
const BB = p => ({
  [`${p}PTS`]: { cols: [[null, "PTS"]], unit: "pts" },
  [`${p}REB`]: { cols: [[null, "REB"]], unit: "reb" },
  [`${p}AST`]: { cols: [[null, "AST"]], unit: "ast" },
  [`${p}3PT`]: { cols: [[null, "3PT", 0]], unit: "threes" },
  [`${p}STL`]: { cols: [[null, "STL"]], unit: "stl" },
  [`${p}BLK`]: { cols: [[null, "BLK"]], unit: "blk" },
  [`${p}PRA`]: { cols: [[null, "PTS"], [null, "REB"], [null, "AST"]], unit: "pts + reb + ast" },
  [`${p}STOCK`]: { cols: [[null, "STL"], [null, "BLK"]], unit: "stl + blk" },
});
export const PROPS = {
  ...FB("NFL"), ...FB("NCAAF"), ...BB("NBA"), ...BB("WNBA"), ...BB("NCAAMB"), ...BB("NCAAWB"),
  NHLGOAL: { cols: [[null, "G"]], unit: "goals" }, NHLG: { cols: [[null, "G"]], unit: "goals" }, NHLAST: { cols: [[null, "A"]], unit: "assists" },
  NHLPTS: { cols: [[null, "G"], [null, "A"]], unit: "points" }, NHLSOG: { cols: [[null, "SOG"]], unit: "shots" },
  MLBHR: { cols: [["batting", "HR"]], unit: "HR" }, MLBHIT: { cols: [["batting", "H"]], unit: "hits" }, MLBHITS: { cols: [["batting", "H"]], unit: "hits" },
  MLBRBI: { cols: [["batting", "RBI"]], unit: "RBI" }, MLBKS: { cols: [["pitching", "K"]], unit: "K" }, MLBK: { cols: [["pitching", "K"]], unit: "K" },
};
const SPORT_OF = [[/^NFL/, "NFL"], [/^NCAAF/, "CFB"], [/^NBA/, "NBA"], [/^WNBA/, "WNBA"], [/^NCAAMB/, "CBB"], [/^NCAAWB/, "CBBW"], [/^NHL/, "NHL"], [/^MLB/, "MLB"]];

// a Kalshi player prop leg ("Dalton Kincaid: 20+" on KXNFLRECYDS-26NOV09BUFMIN-BUFDKINCAID86-20) -> what to track
export function propOf(leg) {
  if (!leg || leg.market !== "kalshi" || !leg.ticker) return null;
  const [series, code] = String(leg.ticker).split("-");
  const key = String(series || "").replace(/^KX/, "").replace(/PROT$/, ""), spec = PROPS[key];
  const m = String(leg.name || "").match(/^(.+?):\s*(\d+(?:\.\d+)?)\+\s*$/);
  const g = String(code || "").match(/^(\d\d)([A-Z]{3})(\d\d)([A-Z]+)$/);
  if (!spec || !m || !g) return null;
  const sport = (SPORT_OF.find(([re]) => re.test(key)) || [])[1];
  return sport ? { sport, player: m[1].trim(), target: Number(m[2]), unit: spec.unit, cols: spec.cols, teams: g[4] } : null;
}

// a Kalshi game-line leg (bought in the Kalshi app, or synced): KXNFLGAME-26NOV09BUFMIN-BUF (Buffalo to win),
// KXNFLSPREAD-...-BUF7 ("Buffalo wins by over 6.5 points"), KXNFLTOTAL-...-47 ("Over 46.5 points"). NO takes the other side.
const GAMEKIND = /^(NFL|NCAAF|NBA|WNBA|NCAAMB|NCAAWB|NHL|MLB)(GAME|SPREAD|TOTAL)$/;
export function kalshiGameLeg(leg) {
  if (!leg || leg.market !== "kalshi" || !leg.ticker) return null;
  const [series, code, sfx] = String(leg.ticker).split("-"), key = String(series || "").replace(/^KX/, ""), k = key.match(GAMEKIND);
  const g = String(code || "").match(/^(\d\d)([A-Z]{3})(\d\d)([A-Z]+)$/);
  if (!k || !g || !sfx) return null;
  const sport = (SPORT_OF.find(([re]) => re.test(key)) || [])[1], no = leg.side === "no";
  const strike = (() => { const m = String(leg.name || "").match(/(\d+(?:\.\d+)?)/); return m ? Number(m[1]) : null; })();
  if (k[2] === "GAME") return /^[A-Z]+$/.test(sfx) && sfx !== "TIE" ? { sport, teams: g[4], kind: "ml", team: sfx, no } : null;
  if (k[2] === "SPREAD") { const m = sfx.match(/^([A-Z]+)(\d+)$/); if (!m) return null; return { sport, teams: g[4], kind: "spread", team: m[1], line: strike != null ? strike : Number(m[2]) - 0.5, no }; }
  const t = strike != null ? strike : Number(String(sfx).replace(/[^\d.]/g, "")) - 0.5;
  return Number.isFinite(t) ? { sport, teams: g[4], kind: "total", line: t, no } : null;
}

// Kalshi's team codes vs ESPN's
const ALIAS = { WAS: "WSH", JAC: "JAX", LA: "LAR", GB: "GB", NO: "NO", NE: "NE", KC: "KC", SF: "SF", TB: "TB", LV: "LV", NY: "NYK", GS: "GSW", SA: "SAS", PHO: "PHX", UTAH: "UTA", NJ: "NJD" };
const same = (a, b) => { a = String(a || "").toUpperCase(); b = String(b || "").toUpperCase(); return !!a && (a === b || ALIAS[a] === b || ALIAS[b] === a); };
// the scoreboard row for a Kalshi game code like "BUFMIN" (away then home)
export function gameFor(rows, sport, teams) {
  const T = String(teams || "").toUpperCase();
  return (rows || []).find(r => r.sport === sport && r.away?.abbr && r.home?.abbr && [[r.away.abbr, r.home.abbr], [r.home.abbr, r.away.abbr]].some(([x, y]) => {
    for (let i = 2; i <= Math.min(4, T.length - 2); i++) if (same(T.slice(0, i), x) && same(T.slice(i), y)) return true;
    return false;
  })) || null;
}

// one player's number from a parsed box score (postgame.js parseFinal): the columns added up
export function statFrom(F, cols, player) {
  const want = norm(player), last = want.split(" ").pop(), first = want[0];
  let total = 0, seen = false;
  for (const [group, label, part] of cols) {
    for (const g of [...(F?.players?.away || []), ...(F?.players?.home || [])]) {
      if (group && norm(g.name) !== group) continue;
      const ci = (g.labels || []).indexOf(label);
      if (ci < 0) continue;
      const row = g.rows.find(r => norm(r.name) === want) || g.rows.find(r => { const n = norm(r.name); return n.split(" ").pop() === last && n[0] === first; });
      if (!row) continue;
      const v = String(row.stats[ci] ?? "");
      total += part == null ? num(v) : num(v.split(/[\/-]/)[part]);
      seen = true;
    }
  }
  return { value: total, seen };
}

// progress for one leg. row: the game on the scoreboard (state "in" or "post"); F: its parsed box score (props only).
//   count:  { kind: "count", value, target, unit, done }          purple until it reaches the target, then green
//           { ..., under: true, ok }                               an under: green while below the line, red once over
//   margin: { kind: "margin", m, scale, ok, text }                 a spread: how far past (or short of) the cover number
//   status: { kind: "status", ok, text }                           a moneyline / draw: winning or not right now
// win: true = winning right now, false = losing, null = still building (a prop or an over on its way)
export function legProgress(leg, row, F) {
  if (!row || (row.state !== "in" && row.state !== "post")) return null;
  const p = propOf(leg);
  if (p) {
    if (!F) return null;
    const { value } = statFrom(F, p.cols, p.player);
    return { kind: "count", value, target: p.target, unit: p.unit, done: value >= p.target, win: value >= p.target ? true : null };
  }
  if (leg.market === "kalshi") {
    // a Kalshi game line: read as the same bet on our scoreboard's game
    const k = kalshiGameLeg(leg);
    if (!k) return null;
    const names = { away: { name: row.away?.name }, home: { name: row.home?.name } };
    if (k.kind === "total") return legProgress({ sport: k.sport, market: "total", side: k.no ? "under" : "over", line: k.line, ...names }, row);
    const at = same(k.team, row.away?.abbr) ? "away" : same(k.team, row.home?.abbr) ? "home" : null;
    if (!at) return null;
    const other = at === "away" ? "home" : "away";
    if (k.kind === "ml") return legProgress({ sport: k.sport, market: "ml", side: k.no ? other : at, ...names }, row);
    return legProgress({ sport: k.sport, market: "spread", side: k.no ? other : at, line: k.no ? k.line : -k.line, ...names }, row);
  }
  if (leg.sport === "Tennis" || leg.sport === "MMA") return null;
  const a = num(row.away?.score), h = num(row.home?.score);
  if (leg.market === "total") {
    const t = a + h, line = Number(leg.line);
    if (leg.side === "over") return { kind: "count", value: t, target: line, unit: "pts", done: t > line, over: true, win: t > line ? true : null };
    const d = Math.round(Math.abs(line - t) * 10) / 10;
    return { kind: "count", value: t, target: line, unit: "pts", under: true, ok: t < line, done: false, win: t < line, text: t < line ? `under by ${d}` : `over by ${d}` };
  }
  const me = leg.side === "away" ? a : h, them = leg.side === "away" ? h : a, who = (leg.side === "away" ? leg.away : leg.home)?.name || "";
  if (leg.market === "spread") {
    const line = Number(leg.line), m = me - them + line, d = Math.round(Math.abs(m) * 10) / 10, lead = me - them;
    const scale = ["NHL", "MLB", "Soccer"].includes(leg.sport) ? 3 : 14;
    // the number people read is the team's lead (up 7 on -6.5 shows 7), with the line it has to beat
    const ln = line === 0 ? "PK" : `${line > 0 ? "+" : ""}${line}`, where = lead > 0 ? `up ${lead}` : lead < 0 ? `down ${-lead}` : "tied";
    return { kind: "margin", m, scale, line, lead, at: them - me, ok: m > 0, win: m > 0 ? true : m < 0 ? false : null,
      text: m > 0 ? `${where} · covering ${ln}` : m === 0 ? `${where} · right on ${ln}` : `${where} · ${d} short of ${ln}` };
  }
  if (leg.market === "draw") return { kind: "status", ok: a === h, win: a === h, text: a === h ? `level ${a}-${h}` : `${Math.max(a, h)}-${Math.min(a, h)}, not level` };
  const lead = me - them;
  return { kind: "status", ok: lead > 0, win: lead > 0 ? true : lead < 0 ? false : null, text: lead > 0 ? `${who} up ${lead}` : lead === 0 ? "tied" : `${who} down ${-lead}` };
}
