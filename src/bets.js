// Bet slips: reading a typed pick, odds math, grading from the final score, and each bettor's record.
// Shared by the page (src/boardroom.jsx), the server (functions/api) and the tests, so all three agree.
import { teamQueryScore, amOdds } from "./routes.js";

// ---------- odds ----------
export const amToDec = a => (a > 0 ? 1 + a / 100 : 1 + 100 / -a);
export const decToAm = d => (d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1)));
export const fmtAm = a => (a == null ? "" : a > 0 ? `+${a}` : String(a));
export const money = v => `${v < 0 ? "-" : ""}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const readOdds = s => amOdds(String(s ?? "").trim().replace(/^\+/, ""));
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
  const who = leg.side === "away" ? leg.away?.name : leg.side === "home" ? leg.home?.name : null;
  if (leg.market === "total") return `${leg.away?.name} / ${leg.home?.name} ${leg.side === "over" ? "over" : "under"} ${leg.line}`;
  if (leg.market === "draw") return `${leg.away?.name} vs ${leg.home?.name}: draw`;
  if (leg.market === "spread") return `${who} ${leg.line === 0 ? "PK" : (leg.line > 0 ? "+" : "") + leg.line}`;
  return `${who} ${MARKET_WORD.ml}`;
};

// ---------- matching a pick to a game on the board ----------
// rows: { sport, league, id, date, state, away: {name, full, abbr, nick, loc}, home: {...} } (the live-board rows)
const asTeam = x => ({ name: x.full || x.name, short: x.name, abbr: x.abbr, nick: x.nick || "", loc: x.loc || "" });
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
    away: { name: pick.r.away.name, abbr: pick.r.away.abbr || "" }, home: { name: pick.r.home.name, abbr: pick.r.home.abbr || "" }, title: pick.r.title || "",
  };
  const others = scored.filter(s => s !== pick && s.score >= pick.score - 2 && s.r.id !== pick.r.id).slice(0, 3).map(s => ({ ...leg, eventId: s.r.id, sport: s.r.sport, league: s.r.league, date: s.r.date, state: s.r.state, side: s.side, away: { name: s.r.away.name, abbr: s.r.away.abbr || "" }, home: { name: s.r.home.name, abbr: s.r.home.abbr || "" } }));
  return { status: pick.r.state === "pre" ? "ok" : "started", leg, others };
}

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
  const dec = live.reduce((a, l) => a * amToDec(l.odds), 1);
  return { status: "won", profit: Math.round(slip.stake * (dec - 1) * 100) / 100, dec };
}

// ---------- a bettor's numbers ----------
export function bettorStats(slips) {
  const s = { W: 0, L: 0, P: 0, pending: 0, staked: 0, won: 0, lost: 0, net: 0, best: null, streak: "", bySport: {}, parlays: { W: 0, L: 0 }, straights: { W: 0, L: 0 } };
  const done = slips.filter(x => x.status === "won" || x.status === "lost" || x.status === "push").sort((a, b) => String(a.settled || a.created).localeCompare(String(b.settled || b.created)));
  s.pending = slips.filter(x => x.status === "pending").length;
  for (const x of done) {
    const kind = (x.legs || []).length > 1 ? s.parlays : s.straights;
    if (x.status === "push") { s.P++; continue; }
    s.staked += x.stake;
    if (x.status === "won") { s.W++; kind.W++; s.won += x.profit; if (!s.best || x.profit > s.best.profit) s.best = { profit: x.profit, odds: x.odds, id: x.id }; }
    else { s.L++; kind.L++; s.lost += x.stake; }
    for (const sp of new Set((x.legs || []).map(l => l.sport))) { const b = (s.bySport[sp] = s.bySport[sp] || { W: 0, L: 0, net: 0 }); b[x.status === "won" ? "W" : "L"]++; b.net += x.status === "won" ? x.profit : -x.stake; }
  }
  s.net = Math.round((s.won - s.lost) * 100) / 100; s.won = Math.round(s.won * 100) / 100; s.lost = Math.round(s.lost * 100) / 100;
  s.pct = s.W + s.L ? s.W / (s.W + s.L) : null;
  s.roi = s.staked ? s.net / s.staked : null;
  const res = done.filter(x => x.status !== "push").map(x => (x.status === "won" ? "W" : "L"));
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
export const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;
