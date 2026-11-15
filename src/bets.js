// Bet slips: reading a typed pick, odds math, grading from the final score, and each bettor's record.
// Shared by the page (src/boardroom.jsx), the server (functions/api) and the tests, so all three agree.
import { teamQueryScore, amOdds } from "./routes.js";

// ---------- odds ----------
export const amToDec = a => (a > 0 ? 1 + a / 100 : 1 + 100 / -a);
export const decToAm = d => (d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1)));
export const fmtAm = a => (a == null ? "" : a > 0 ? `+${a}` : String(a));
export const money = v => `${v < 0 ? "-" : ""}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const readOdds = s => amOdds(String(s ?? "").trim().replace(/^\+/, ""));
// percentages (Kalshi-style: "54", "54%", "54¢", "0.54") <-> American odds
export const amToPct = a => (a == null ? null : 100 / amToDec(a));
export function readPct(s) {
  let t = String(s ?? "").trim().replace(/[%¢\s]/g, "");
  if (!/^\d*\.?\d+$/.test(t)) return null;
  let x = parseFloat(t);
  if (x > 0 && x < 1 && /^0?\./.test(t)) x *= 100;                    // 0.54 means 54%
  if (!(x >= 1 && x <= 99)) return null;
  return decToAm(100 / x);
}
export const readOddsAs = (s, fmt) => (fmt === "pct" ? readPct(s) : readOdds(s));
export const fmtPct = a => (a == null ? "" : `${(Math.round(amToPct(a) * 10) / 10).toString()}%`);
export const fmtOdds = (a, fmt) => (fmt === "pct" ? fmtPct(a) : fmtAm(a));
// a slip's price: one leg is a straight bet; two or more multiply (a parlay)
export function slipPrice(oddsList, stake) {
  const ds = oddsList.map(o => (o == null ? null : amToDec(o)));
  if (!ds.length || ds.some(d => d == null)) return null;
  const dec = ds.reduce((a, d) => a * d, 1);
  return { dec, am: decToAm(dec), payout: stake > 0 ? stake * dec : null, profit: stake > 0 ? stake * (dec - 1) : null };
}

// ---------- reading a pick ("Real Madrid ML", "Lakers -3.5", "Chiefs/Bills over 47.5", "Arsenal draw") ----------
const num = "(\\d+(?:\\.\\d+)?|\\.\\d+)";
export function parsePick(text) {
  let t = ` ${String(text || "").toLowerCase().replace(/[’']/g, "").replace(/\s+/g, " ").trim()} `;
  const out = { market: "ml", side: null, line: null, q: "" };
  let m;
  if ((m = t.match(new RegExp(`\\s(o|over|u|under)\\s?${num}(?=\\s)`)))) {
    out.market = "total"; out.side = m[1][0] === "o" ? "over" : "under"; out.line = parseFloat(m[2]); t = t.replace(m[0], " ");
    t = t.replace(/\s(total|points|pts|goals|runs|game total)(?=\s)/g, " ");
  } else if (/\s(draw|tie|x)(?=\s)/.test(t)) {
    out.market = "draw"; out.side = "draw"; t = t.replace(/\s(draw|tie|x)(?=\s)/g, " ");
  } else if ((m = t.match(new RegExp(`\\s([+-])\\s?${num}(?=\\s)`))) && parseFloat(m[2]) < 100) {
    out.market = "spread"; out.line = parseFloat(m[1] + m[2]); t = t.replace(m[0], " ");
  } else if (/\s(pk|pick|pickem|pick em)(?=\s)/.test(t)) {
    out.market = "spread"; out.line = 0; t = t.replace(/\s(pk|pickem|pick em|pick)(?=\s)/g, " ");
  }
  t = t.replace(/\s(ml|moneyline|money line|to win|wins|win|straight|spread|ats|line|full game|fg)(?=\s)/g, " ");
  t = t.replace(/\s[+-]\d{3,}(?=\s)/g, " ");                 // odds typed into the pick by habit ("Real Madrid ML -150")
  out.q = t.replace(/\s+/g, " ").trim();
  return out;
}
const MARKET_WORD = { ml: "ML", spread: "spread", total: "total", draw: "draw" };
export const legLabel = leg => {
  if (leg.market === "kalshi") return `${leg.name || leg.ticker}${leg.side === "no" ? " (NO)" : ""}`;          // a Kalshi market: YES on its name
  const who = leg.side === "away" ? leg.away?.name : leg.side === "home" ? leg.home?.name : null;
  if (leg.market === "total") return `${leg.away?.name} / ${leg.home?.name} ${leg.side === "over" ? "over" : "under"} ${leg.line}`;
  if (leg.market === "draw") return `${leg.away?.name} vs ${leg.home?.name}: draw`;
  if (leg.market === "spread") return `${who} ${leg.line === 0 ? "PK" : (leg.line > 0 ? "+" : "") + leg.line}`;
  return `${who} ${MARKET_WORD.ml}`;
};

// ---------- matching a pick to a game on the board ----------
// rows: { sport, league, id, date, state, away: {name, full, abbr, nick, loc}, home: {...} } (the live-board rows)
const asTeam = x => ({ name: x.full || x.name, short: x.name, abbr: x.abbr, nick: x.nick || "", loc: x.loc || "" });
// a side as a leg keeps it: the short name, abbreviation, and the full name and city (used to find it on Kalshi)
const side = x => ({ name: x.name, abbr: x.abbr || "", ...(x.full ? { full: x.full } : {}), ...(x.loc ? { loc: x.loc } : {}), ...(x.nick ? { nick: x.nick } : {}) });
export function resolvePick(p, rows, { sport = null } = {}) {
  if (!p || !p.q || p.q.length < 2) return { status: "empty" };
  const segs = p.q.split(/\s+(?:vs\.?|v\.?|@|at|and|&|-)\s+|\s*\/\s*/).map(s => s.trim()).filter(Boolean);
  const scored = [];
  for (const r of rows) {
    if (sport && r.sport !== sport) continue;
    if ((p.market === "draw") && r.sport !== "Soccer") continue;
    if ((p.market === "spread" || p.market === "total" || p.market === "draw") && (r.sport === "Tennis" || r.sport === "MMA")) continue;
    const A = asTeam(r.away), H = asTeam(r.home);
    let a = 0, h = 0;
    for (const s of segs) { a = Math.max(a, teamQueryScore(A, s)); h = Math.max(h, teamQueryScore(H, s)); }
    const both = segs.length > 1 ? Math.min(a, h) : 0;
    const best = Math.max(a, h);
    if (best < 2) continue;
    let side = p.side;
    if (p.market === "ml" || p.market === "spread") { if (a === h) continue; side = a > h ? "away" : "home"; }
    scored.push({ r, side, score: best * 10 + both * 5 + (r.state === "pre" ? 3 : 0) });
  }
  if (!scored.length) return { status: "none" };
  scored.sort((x, y) => y.score - x.score || String(x.r.date).localeCompare(String(y.r.date)));
  const top = scored[0], open = scored.filter(s => s.r.state === "pre");
  const pick = top.r.state === "pre" ? top : open.find(s => s.score >= top.score - 3) || top;
  const leg = {
    sport: pick.r.sport, league: pick.r.league, eventId: pick.r.id, date: pick.r.date, state: pick.r.state,
    market: p.market, side: pick.side, line: p.line,
    away: side(pick.r.away), home: side(pick.r.home), title: pick.r.title || "",
  };
  const others = scored.filter(s => s !== pick && s.score >= pick.score - 2 && s.r.id !== pick.r.id).slice(0, 3).map(s => ({ ...leg, eventId: s.r.id, sport: s.r.sport, league: s.r.league, date: s.r.date, state: s.r.state, side: s.side, away: side(s.r.away), home: side(s.r.home) }));
  return { status: pick.r.state === "pre" ? "ok" : "started", leg, others };
}

// a pick taken straight off someone else's ticket (tailing): the same bet, on the game as it stands on today's board
export const legFromRow = (r, { market, side: sd, line = null }) => ({
  sport: r.sport, league: r.league, eventId: r.id, date: r.date, state: r.state, market, side: sd, line: market === "spread" || market === "total" ? line : null,
  away: side(r.away), home: side(r.home), title: r.title || "",
});

// ---------- grading ----------
// row: the game's live-board row once it's over (state "post"): away/home with score and winner flags
export function gradeLeg(leg, row) {
  if (!row || row.state !== "post") return null;
  if (/postpon|cancel|abandon|suspend|forfeit|walkover|w\/o|retired|ret\.|no contest/i.test(row.detail || "") && !(leg.market === "ml" && (row.away?.win || row.home?.win) && !/postpon|cancel|abandon|suspend/i.test(row.detail || ""))) return "P";
  if (leg.sport === "Tennis" || leg.sport === "MMA") {
    const w = row.away?.win ? "away" : row.home?.win ? "home" : null;
    return w ? (w === leg.side ? "W" : "L") : "P";
  }
  const a = Number(row.away?.score), h = Number(row.home?.score);
  if (!Number.isFinite(a) || !Number.isFinite(h) || row.away?.score === "" || row.home?.score === "") return null;
  if (leg.market === "total") { const d = a + h - leg.line; return d === 0 ? "P" : (d > 0) === (leg.side === "over") ? "W" : "L"; }
  if (leg.market === "draw") return a === h ? "W" : "L";
  const diff = leg.side === "away" ? a - h : h - a;
  if (leg.market === "spread") { const d = diff + leg.line; return d > 0 ? "W" : d < 0 ? "L" : "P"; }
  if (diff > 0) return "W";
  if (diff < 0) return "L";
  return leg.sport === "Soccer" ? "L" : "P";                 // soccer moneyline is three-way: a draw loses it
}
// a slip: any losing leg loses it; pushed legs drop out (the parlay pays on what's left); all pushed refunds the stake
export function settleSlip(slip) {
  const legs = slip.legs || [];
  if (legs.some(l => l.res === "L")) return { status: "lost", profit: -slip.stake, dec: null };
  if (legs.some(l => l.res !== "W" && l.res !== "P")) return { status: "pending", profit: null, dec: null };
  const live = legs.filter(l => l.res === "W");
  if (!live.length) return { status: "push", profit: 0, dec: 1 };
  // a Kalshi combo pays at its own price when every leg wins
  const dec = slip.kalshi?.dec > 1 && live.length === legs.length ? slip.kalshi.dec : live.reduce((a, l) => a * amToDec(l.odds), 1);
  return { status: "won", profit: Math.round(slip.stake * (dec - 1) * 100) / 100, dec };
}

// ---------- a bettor's numbers ----------
export function bettorStats(slips) {
  const s = { W: 0, L: 0, P: 0, pending: 0, staked: 0, won: 0, lost: 0, net: 0, best: null, streak: "", bySport: {}, parlays: { W: 0, L: 0 }, straights: { W: 0, L: 0 } };
  // a cash-out (sold back on Kalshi before it was decided) counts by what it made: up = W, down = L, even = push
  const outcome = x => (x.status === "cashed" ? (x.profit > 0 ? "won" : x.profit < 0 ? "lost" : "push") : x.status);
  const done = slips.filter(x => ["won", "lost", "push", "cashed"].includes(x.status)).sort((a, b) => String(a.settled || a.created).localeCompare(String(b.settled || b.created)));
  s.pending = slips.filter(x => x.status === "pending").length;
  s.cashed = slips.filter(x => x.status === "cashed").length;
  for (const x of done) {
    const kind = (x.legs || []).length > 1 ? s.parlays : s.straights, o = outcome(x);
    if (o === "push") { s.P++; continue; }
    s.staked += x.stake;
    const loss = x.status === "cashed" ? -x.profit : x.stake;
    if (o === "won") { s.W++; kind.W++; s.won += x.profit; if (!s.best || x.profit > s.best.profit) s.best = { profit: x.profit, odds: x.odds, id: x.id }; }
    else { s.L++; kind.L++; s.lost += loss; }
    for (const sp of new Set((x.legs || []).map(l => l.sport))) { const b = (s.bySport[sp] = s.bySport[sp] || { W: 0, L: 0, net: 0 }); b[o === "won" ? "W" : "L"]++; b.net += o === "won" ? x.profit : -loss; }
  }
  s.net = Math.round((s.won - s.lost) * 100) / 100; s.won = Math.round(s.won * 100) / 100; s.lost = Math.round(s.lost * 100) / 100;
  s.pct = s.W + s.L ? s.W / (s.W + s.L) : null;
  s.roi = s.staked ? s.net / s.staked : null;
  const res = done.map(outcome).filter(o => o !== "push").map(o => (o === "won" ? "W" : "L"));
  if (res.length) { const last = res[res.length - 1]; let k = 0; for (let i = res.length - 1; i >= 0 && res[i] === last; i--) k++; s.streak = `${last}${k}`; }
  return s;
}
// two boards: by record (win %, then wins) and by money (net profit, then most won)
export function leaderboards(people) {
  const rated = people.filter(p => p.stats.W + p.stats.L > 0);
  const record = [...rated].sort((a, b) => b.stats.pct - a.stats.pct || b.stats.W - a.stats.W || a.stats.L - b.stats.L || b.stats.net - a.stats.net);
  const cash = [...rated].sort((a, b) => b.stats.net - a.stats.net || b.stats.won - a.stats.won || b.stats.pct - a.stats.pct);
  return { record, money: cash };
}
// ---------- the fun part of the leaderboard: this week's race, bankroll lines, awards, all-time records ----------
// people: [{ username, you, slips }]. Every ticket is one bet (a parlay is one bet, whatever its legs).
const etDate = t => new Date(t).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
export function weekStartET(now = Date.now()) {
  const wd = new Date(now).toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short" });
  const back = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[wd] ?? 0;
  return etDate(now - back * 864e5);                                   // Monday, ET
}
export function boardFun(people, now = Date.now()) {
  const wk = weekStartET(now), r2 = v => Math.round(v * 100) / 100;
  const tailsOf = new Map();                                           // how many times each ticket was tailed
  for (const p of people) for (const x of p.slips) if (x.tail) tailsOf.set(x.tail, (tailsOf.get(x.tail) || 0) + 1);
  const out = people.map(p => {
    const done = p.slips.filter(x => ["won", "lost", "push", "cashed"].includes(x.status)).sort((a, b) => String(a.settled || a.created).localeCompare(String(b.settled || b.created)));
    const res = x => (x.status === "cashed" ? (x.profit > 0 ? "W" : x.profit < 0 ? "L" : "P") : x.status === "won" ? "W" : x.status === "lost" ? "L" : "P");
    const pl = x => (x.status === "push" ? 0 : x.status === "lost" ? -x.stake : x.profit || 0);
    let run = 0, best = null, longOdds = null, streak = 0, maxStreak = 0, parlayW = 0, bigParlay = null, staked = 0, weekNet = 0, weekBets = 0;
    const series = [0];
    for (const x of done) {
      const r = res(x), v = pl(x);
      run += v; series.push(r2(run)); if (r !== "P") staked += x.stake;
      if (etDate(x.settled || x.created) >= wk) { weekNet += v; weekBets++; }
      if (r === "W") { streak++; maxStreak = Math.max(maxStreak, streak);
        if (!best || v > best.profit) best = { profit: r2(v), odds: x.odds, legs: (x.legs || []).length };
        if (x.status === "won" && (!longOdds || x.odds > longOdds.odds)) longOdds = { odds: x.odds, profit: r2(v), legs: (x.legs || []).length };
        if ((x.legs || []).length > 1 && x.status === "won") { parlayW++; if (!bigParlay || x.legs.length > bigParlay.legs) bigParlay = { legs: x.legs.length, profit: r2(v), odds: x.odds }; } }
      else if (r === "L") streak = 0;
    }
    const tails = p.slips.reduce((a, x) => a + (tailsOf.get(x.id) || 0), 0);
    const graded = done.filter(x => res(x) !== "P").length, W = done.filter(x => res(x) === "W").length;
    return { username: p.username, you: !!p.you, bets: p.slips.filter(x => x.status !== "dup").length, graded, W, net: r2(run), staked: r2(staked), roi: staked ? run / staked : null, pct: graded ? W / graded : null,
      weekNet: r2(weekNet), weekBets, best, longOdds, bigParlay, maxStreak, parlayW, tails, series: series.slice(-40),
      cur: (() => { const rs = done.map(res).filter(z => z !== "P"); if (!rs.length) return null; const l = rs[rs.length - 1]; let k = 0; for (let i = rs.length - 1; i >= 0 && rs[i] === l; i--) k++; return { r: l, n: k }; })() };
  });
  // awards: one winner each (ties go to who got there with more bets); minimums keep a 1-for-1 from taking the crown
  const top = (list, val, min = () => true) => { const c = list.filter(min).filter(x => val(x) != null && val(x) > 0).sort((a, b) => val(b) - val(a) || b.graded - a.graded); return c[0] || null; };
  const award = (k, title, who, stat, why) => (who ? { k, title, who: who.username, stat, why } : null);
  const hot = top(out, x => (x.cur?.r === "W" ? x.cur.n : null), x => x.cur?.n >= 2);
  const cold = top(out, x => (x.cur?.r === "L" ? x.cur.n : null), x => x.cur?.n >= 3);
  const sharp = top(out, x => x.pct, x => x.graded >= 5);
  const shark = top(out, x => x.roi, x => x.graded >= 5);
  const hit = top(out, x => x.best?.profit);
  const lng = top(out, x => x.longOdds?.odds);
  const pk = top(out, x => x.parlayW);
  const mag = top(out, x => x.tails);
  const roller = top(out, x => x.staked);
  const grinder = top(out, x => x.bets);
  const wkKing = top(out, x => x.weekNet);
  const sgn = v => `${v >= 0 ? "+" : "-"}$${Math.abs(v).toFixed(2)}`, odds = o => `${o > 0 ? "+" : ""}${o}`;
  const awards = [
    award("week", "King of the Week", wkKing, wkKing && sgn(wkKing.weekNet), "most money won since Monday"),
    award("hot", "On Fire", hot, hot && `W${hot.cur.n}`, "longest winning streak going right now"),
    award("sharp", "Sharpshooter", sharp, sharp && `${Math.round(sharp.pct * 100)}%`, "best win rate (5+ bets)"),
    award("shark", "The Shark", shark, shark && `${shark.roi > 0 ? "+" : ""}${(shark.roi * 100).toFixed(1)}% ROI`, "best return on money bet (5+ bets)"),
    award("hit", "Biggest Hit", hit, hit && sgn(hit.best.profit), hit ? `one ticket at ${odds(hit.best.odds)}${hit.best.legs > 1 ? `, ${hit.best.legs} legs` : ""}` : ""),
    award("long", "Longshot Legend", lng, lng && odds(lng.longOdds.odds), "longest odds ever cashed"),
    award("parlay", "Parlay King", pk, pk && `${pk.parlayW} hit`, pk?.bigParlay ? `biggest: ${pk.bigParlay.legs} legs` : ""),
    award("tail", "Tail Magnet", mag, mag && `${mag.tails} tail${mag.tails > 1 ? "s" : ""}`, "most times others copied their ticket"),
    award("roller", "High Roller", roller, roller && `$${roller.staked.toFixed(0)}`, "most money put on the line"),
    award("grind", "The Grinder", grinder, grinder && `${grinder.bets} bets`, "most tickets"),
    award("cold", "Ice Cold", cold, cold && `L${cold.cur.n}`, "it's gotta turn around"),
  ].filter(Boolean);
  const records = {
    biggest: hit ? { who: hit.username, profit: hit.best.profit, odds: hit.best.odds, legs: hit.best.legs } : null,
    longest: lng ? { who: lng.username, odds: lng.longOdds.odds, profit: lng.longOdds.profit } : null,
    streak: (x => (x ? { who: x.username, n: x.maxStreak } : null))(top(out, x => x.maxStreak)),
    parlay: (x => (x?.bigParlay ? { who: x.username, legs: x.bigParlay.legs, profit: x.bigParlay.profit } : null))(top(out, x => x.bigParlay?.legs)),
  };
  const week = out.filter(x => x.weekBets > 0).sort((a, b) => b.weekNet - a.weekNet).map(x => ({ username: x.username, you: x.you, net: x.weekNet, bets: x.weekBets }));
  return { week, weekOf: wk, awards, records, players: Object.fromEntries(out.map(x => [x.username, { series: x.series, bets: x.bets, maxStreak: x.maxStreak, tails: x.tails, badges: awards.filter(a => a.who === x.username).map(a => a.k) }])) };
}
export const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;
