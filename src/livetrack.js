// The live game tracker (Arena): what's happening in a game right now, from its ESPN summary.
// One reader for every sport: the score by period, the plays (newest first), where the shots came from (basketball,
// hockey), the ball on the field (football), the bases and the count (baseball), win probability, leaders and the
// team stats. Pure functions; the page polls the summary and draws what these return.
import { parseFinal } from "./postgame.js";

export const familyOf = sport => ({ NBA: "basket", WNBA: "basket", CBB: "basket", CBBW: "basket", HOOPS: "basket", NFL: "foot", CFB: "foot", GRID: "foot",
  NHL: "hockey", PUCK: "hockey", MLB: "base", BASE: "base", Soccer: "soccer" }[sport] || "other");
const num = v => { const x = Number(v); return Number.isFinite(x) ? x : null; };
const valid = c => c && Number.isFinite(c.x) && Number.isFinite(c.y) && Math.abs(c.x) < 1000 && Math.abs(c.y) < 1000;

// basketball: ESPN puts every shot on a half court (x 0-50 across, y 0-47 out from the baseline). On the full court
// (94 x 50) the away team shoots at the left basket, the home team at the right one.
export function courtSpot(c, side) {
  if (!valid(c) || c.x < -2 || c.x > 52 || c.y < -2 || c.y > 50) return null;
  return side === "home" ? { x: 94 - c.y, y: 50 - c.x } : { x: c.y, y: c.x };
}
// hockey: rink coordinates already (x -100..100, y -42.5..42.5) -> a 200 x 85 picture
export function rinkSpot(c) {
  if (!valid(c) || Math.abs(c.x) > 100 || Math.abs(c.y) > 43) return null;
  return { x: c.x + 100, y: 42.5 - c.y };
}
// football: "KC 35" (the team's own 35) -> yards from the left goal line, with the away team defending the left end
export function yardX(text, away, home) {
  const m = String(text || "").trim().match(/^([A-Za-z.&' ]+?)\s+(\d{1,2})$/), mid = /^50$|^midfield$/i.test(String(text || "").trim());
  if (mid) return 50;
  if (!m) return null;
  const t = m[1].trim().toUpperCase(), y = Number(m[2]);
  if (t === String(away || "").toUpperCase()) return y;
  if (t === String(home || "").toUpperCase()) return 100 - y;
  return null;
}

// "4th Quarter" -> Q4, "2nd Half" -> 2H, "3rd" (hockey) -> P3, baseball's Bottom 9 -> Bot 9
export function shortPeriod(pd) {
  if (!pd) return "";
  const d = String(pd.displayValue || ""), n = pd.number;
  if (/^(top|bottom)$/i.test(pd.type || "") && n != null) return `${/^top/i.test(pd.type) ? "Top" : "Bot"} ${n}`;
  let m = d.match(/^(\d)(?:st|nd|rd|th) Quarter$/i); if (m) return `Q${m[1]}`;
  m = d.match(/^(\d)(?:st|nd|rd|th) Half$/i); if (m) return `${m[1]}H`;
  m = d.match(/^(\d)(?:st|nd|rd|th)$/i); if (m) return `P${m[1]}`;
  return d || (n != null ? String(n) : "");
}
export function liveFeed(j, sport) {
  const F = parseFinal(j, sport);
  if (!F) return null;
  const fam = familyOf(sport), comp = j?.header?.competitions?.[0] || {};
  const sideOf = id => (id == null ? null : String(id) === F.away.id ? "away" : String(id) === F.home.id ? "home" : null);
  const st = comp.status?.type || {};
  const state = st.state || (F.done ? "post" : "in");
  // the plays, newest first
  let raw = [];
  if (fam === "foot") raw = [...(j.drives?.previous || []).flatMap(d => d.plays || []), ...(j.drives?.current?.plays || [])];
  else if (fam === "soccer") raw = (j.keyEvents || []).length ? j.keyEvents : (j.commentary || []).map(c => ({ ...c.play, text: c.text || c.play?.text, clock: c.time || c.play?.clock }));
  else raw = j.plays || [];
  const plays = raw.filter(p => p && (p.text || p.type?.text)).map((p, i) => ({
    id: String(p.id ?? `${i}`), text: String(p.text || p.type?.text || "").replace(/\s+/g, " ").trim(), kind: p.type?.text || "",
    period: shortPeriod(p.period), clock: p.clock?.displayValue || "",
    as: num(p.awayScore), hs: num(p.homeScore), scoring: p.scoringPlay === true, side: sideOf(p.team?.id), seq: num(p.sequenceNumber) ?? i,
  })).sort((a, b) => b.seq - a.seq);
  // where the shots came from (the newest 60), the last one marked
  let shots = [];
  if (fam === "basket" || fam === "hockey") {
    const src = (j.plays || []).filter(p => p.shootingPlay && valid(p.coordinate)).slice(-60);
    shots = src.map((p, i) => { const side = sideOf(p.team?.id), at = fam === "basket" ? courtSpot(p.coordinate, side) : rinkSpot(p.coordinate);
      return at ? { ...at, side, made: p.scoringPlay === true, last: i === src.length - 1, text: p.text || "" } : null; }).filter(Boolean);
  }
  // the situation: football (down, distance, ball on), baseball (count, outs, runners)
  const s = j.situation || comp.situation || null;
  let situation = null;
  if (fam === "foot" && s) {
    const ballOn = s.possessionText || (s.downDistanceText || "").split(" at ")[1] || "";
    const x = yardX(ballOn, F.away.abbr, F.home.abbr), poss = sideOf(s.possession);
    const dir = poss === "away" ? 1 : poss === "home" ? -1 : 0;
    situation = { kind: "foot", text: s.downDistanceText || s.shortDownDistanceText || "", poss, x, toGo: num(s.distance), firstDown: x != null && dir && num(s.distance) != null ? Math.max(0, Math.min(100, x + dir * num(s.distance))) : null, redZone: s.isRedZone === true, last: s.lastPlay?.text || "" };
  }
  if (fam === "base") {
    const last = [...(j.plays || [])].reverse().find(p => p.outs != null || p.pitchCount) || {};
    const pick = k => (s ? s[k] : last[k]);                    // the live situation, when the feed has one, is the whole truth
    const cnt = s ? { balls: num(s.balls), strikes: num(s.strikes) } : { balls: num(last.pitchCount?.balls), strikes: num(last.pitchCount?.strikes) };
    situation = { kind: "base", balls: cnt.balls ?? 0, strikes: cnt.strikes ?? 0, outs: num(pick("outs")) ?? 0, on: [!!pick("onFirst"), !!pick("onSecond"), !!pick("onThird")],
      batter: s?.batter?.athlete?.displayName || "", pitcher: s?.pitcher?.athlete?.displayName || "", inning: plays[0]?.period || "" };
  }
  const wp = (j.winprobability || []).map(x => num(x.homeWinPercentage)).filter(v => v != null);
  const poss = (F.teamStats || []).find(r => /possession/i.test(r.label));
  return { F, fam, state, detail: st.shortDetail || st.detail || F.detail || "", plays, shots, situation, wp, last: plays[0] || null,
    possession: poss ? { a: parseFloat(poss.a), h: parseFloat(poss.h) } : null };
}
