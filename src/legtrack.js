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
//   status: { kind: "status", ok, text }                           green while it's winning, purple while it isn't
export function legProgress(leg, row, F) {
  if (!row || (row.state !== "in" && row.state !== "post")) return null;
  const p = propOf(leg);
  if (p) {
    if (!F) return null;
    const { value } = statFrom(F, p.cols, p.player);
    return { kind: "count", value, target: p.target, unit: p.unit, done: value >= p.target };
  }
  if (leg.sport === "Tennis" || leg.sport === "MMA" || leg.market === "kalshi") return null;
  const a = num(row.away?.score), h = num(row.home?.score);
  if (leg.market === "total") {
    const t = a + h, line = Number(leg.line);
    if (leg.side === "over") return { kind: "count", value: t, target: line, unit: "pts", done: t > line, over: true };
    return { kind: "status", ok: t < line, text: t < line ? `${t} of ${line}: under by ${Math.round((line - t) * 10) / 10}` : `${t}: over ${line}` };
  }
  const me = leg.side === "away" ? a : h, them = leg.side === "away" ? h : a, who = (leg.side === "away" ? leg.away : leg.home)?.name || "";
  if (leg.market === "spread") {
    const m = me - them + Number(leg.line), d = Math.round(Math.abs(m) * 10) / 10;
    return { kind: "status", ok: m > 0, text: m > 0 ? `covering by ${d}` : m === 0 ? "right on the number" : `needs ${d} more to cover` };
  }
  if (leg.market === "draw") return { kind: "status", ok: a === h, text: a === h ? `level ${a}-${h}` : `${Math.max(a, h)}-${Math.min(a, h)}, not level` };
  const lead = me - them;
  return { kind: "status", ok: lead > 0, text: lead > 0 ? `${who} up ${lead}` : lead === 0 ? "tied" : `${who} down ${-lead}` };
}
