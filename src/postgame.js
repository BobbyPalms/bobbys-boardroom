// After the final: the game's summary route read into one report (score by period, team stats, every player's line,
// how it was scored, the closing lines), and a rundown written from those numbers plus what the algo said before the
// game and what it learned from it. No outside writer: every sentence comes from the data.
const num = v => { const x = parseFloat(String(v ?? "").replace(/[^\d.+-]/g, "")); return Number.isFinite(x) ? x : null; };
const ord = k => `${k}${k % 100 >= 11 && k % 100 <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[k % 10] || "th"}`;
const pct = p => `${Math.round(p * 100)}%`;
const f1 = v => (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, "");
const sgn = v => `${v > 0 ? "+" : ""}${f1(v)}`;

export function parseFinal(j, sport) {
  const c = j?.header?.competitions?.[0];
  if (!c || !Array.isArray(c.competitors)) return null;
  const st = c.status?.type || {};
  const side = ha => {
    const x = c.competitors.find(k => k.homeAway === ha) || {}, t = x.team || {};
    return { id: String(t.id || x.id || ""), abbr: t.abbreviation || "", name: t.displayName || t.name || "", short: t.shortDisplayName || t.name || t.displayName || "",
      score: num(x.score), win: x.winner === true, rec: (x.record || []).find(r => r.type === "total")?.summary || "",
      lines: (x.linescores || []).map(l => num(l.displayValue ?? l.value)), hits: num(x.hits), errors: num(x.errors) };
  };
  const away = side("away"), home = side("home");
  const who = id => (String(id) === away.id ? "away" : String(id) === home.id ? "home" : null);
  // team stats, lined up by name (baseball nests them by batting / pitching)
  const flat = t => (t.statistics || []).flatMap(s => (Array.isArray(s.stats) ? s.stats.map(x => ({ ...x, group: s.name })) : [s]))
    .filter(s => s.displayValue != null && s.displayValue !== "" && (s.label || s.abbreviation || s.name))
    .map(s => { const label = s.label || s.displayName || s.abbreviation || s.name; let v = String(s.displayValue);
      if (/%/.test(label) && /^0?\.\d+$/.test(v)) v = String(Math.round(parseFloat(v) * 100));   // 0.8 -> 80 on "... %" stats
      return { key: `${s.group || ""}.${s.name || s.label}`, label, v }; });
  const ts = { away: [], home: [] };
  for (const t of j.boxscore?.teams || []) { const k = who(t.team?.id); if (k) ts[k] = flat(t); }
  const teamStats = ts.away.map(a => ({ key: a.key, label: a.label, a: a.v, h: ts.home.find(b => b.key === a.key)?.v ?? "" })).filter(r => r.h !== "");
  // every player's line, by stat group
  const players = { away: [], home: [] };
  for (const t of j.boxscore?.players || []) {
    const k = who(t.team?.id); if (!k) continue;
    for (const g of t.statistics || []) {
      const rows = (g.athletes || []).filter(a => !a.didNotPlay && Array.isArray(a.stats) && a.stats.length).map(a => ({
        name: a.athlete?.displayName || "", pos: a.athlete?.position?.abbreviation || a.position?.abbreviation || "", starter: a.starter === true, stats: a.stats.map(String) }));
      if (rows.length) players[k].push({ name: g.name || g.type || g.text || "", labels: g.labels || [], rows, totals: Array.isArray(g.totals) ? g.totals.map(String) : null });
    }
  }
  if (sport === "Soccer") for (const r of j.rosters || []) {                     // soccer box scores live on the rosters
    const k = r.homeAway === "away" || r.homeAway === "home" ? r.homeAway : who(r.team?.id); if (!k) continue;
    const cols = [["G", "totalGoals"], ["A", "goalAssists"], ["SH", "totalShots"], ["SOT", "shotsOnTarget"], ["SV", "saves"], ["FC", "foulsCommitted"], ["YC", "yellowCards"], ["RC", "redCards"]];
    const rows = (r.roster || []).filter(p => p.starter || p.subbedIn).map(p => {
      const by = Object.fromEntries((p.stats || []).map(s => [s.name, s.displayValue]));
      return { name: p.athlete?.displayName || "", pos: p.position?.abbreviation || "", starter: p.starter === true, sub: p.subbedIn === true, stats: cols.map(([, n]) => String(by[n] ?? "0")) };
    });
    if (rows.length) players[k] = [{ name: "players", labels: cols.map(x => x[0]), rows, totals: null }];
  }
  // leaders: the top name in each category
  const leaders = { away: [], home: [] };
  for (const t of j.leaders || []) {
    const k = who(t.team?.id); if (!k) continue;
    for (const cat of t.leaders || []) { const x = (cat.leaders || [])[0]; if (x?.athlete) leaders[k].push({ cat: cat.displayName || cat.name, name: x.athlete.displayName, v: x.displayValue || x.mainStat?.value || "", detail: x.summary || "" }); }
  }
  // how it was scored
  const clip = s => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > 96 ? s.slice(0, 93).replace(/\s\S*$/, "") + "…" : s; };
  let scoring = [];
  if (sport === "Soccer") scoring = (j.keyEvents || []).filter(e => e.scoringPlay || /red card|penalty/i.test(e.type?.text || "")).map(e => ({
    side: who(e.team?.id), when: e.clock?.displayValue || "", kind: e.scoringPlay ? (/own goal/i.test(e.type?.text || "") ? "own goal" : /penalty/i.test(e.type?.text || "") ? "penalty" : "goal") : /red/i.test(e.type?.text || "") ? "red card" : "penalty missed",
    who: e.participants?.[0]?.athlete?.displayName || "", text: "" })).filter(e => e.side);
  else {
    const src = Array.isArray(j.scoringPlays) && j.scoringPlays.length ? j.scoringPlays : (sport === "NHL" || sport === "MLB") ? (j.plays || []).filter(p => p.scoringPlay) : [];
    scoring = src.map(p => ({ side: who(p.team?.id), period: p.period?.number ?? null, when: p.clock?.displayValue || "", kind: p.type?.abbreviation || p.type?.text || "", text: clip(p.text), as: num(p.awayScore), hs: num(p.homeScore) })).filter(p => p.side);
  }
  const pc = (j.pickcenter || [])[0];
  const lines = pc ? { provider: pc.provider?.name || "", spreadHome: num(pc.spread), total: num(pc.overUnder), homeML: num(pc.homeTeamOdds?.moneyLine), awayML: num(pc.awayTeamOdds?.moneyLine), drawML: num(pc.drawOdds?.moneyLine), details: pc.details || "" } : null;
  const wp = (j.winprobability || []).map(x => num(x.homeWinPercentage)).filter(v => v != null);
  return {
    sport, id: String(j.header?.id || ""), detail: st.detail || st.shortDetail || "Final", done: st.completed === true, away, home,
    venue: j.gameInfo?.venue?.fullName || "", city: [j.gameInfo?.venue?.address?.city, j.gameInfo?.venue?.address?.state].filter(Boolean).join(", "), attendance: num(j.gameInfo?.attendance),
    teamStats, players, leaders, scoring, lines, wp: wp.length > 5 ? { min: Math.min(...wp), max: Math.max(...wp) } : null,
  };
}

// ---------- the rundown ----------
const PERIOD = { NBA: "quarter", WNBA: "quarter", NFL: "quarter", CFB: "quarter", NHL: "period", CBB: "half", CBBW: "quarter", Soccer: "half", MLB: "inning" };
// the team stats that say where a game was won, and how to say each one (w = winner's value, l = loser's)
const STAT_PICK = {
  basket: [["Field Goal %", (w, l) => `shot ${w}% to ${l}%`], ["Three Point %", (w, l) => `shot ${w}% from three to ${l}%`], ["Total Rebounds", (w, l) => `won the boards ${w}-${l}`], ["Rebounds", (w, l) => `won the boards ${w}-${l}`], ["Assists", (w, l) => `had ${w} assists to ${l}`], ["Turnovers", (w, l) => `turned it over ${w} times to ${l}`, true]],
  foot: [["Total Yards", (w, l) => `outgained them ${w} yards to ${l}`], ["Turnovers", (w, l) => `won the turnover battle (${w} to ${l})`, true], ["3rd down efficiency", (w, l) => `went ${w} on third down (${l} for them)`, null], ["Possession", (w, l) => `held the ball ${w} to ${l}`]],
  NHL: [["Shots", (w, l) => `outshot them ${w}-${l}`], ["Power Play Goals", (w, l) => `scored ${w} on the power play to ${l}`], ["Hits", (w, l) => `out-hit them ${w}-${l}`]],
  Soccer: [["Possession", (w, l) => `had ${w}% of the ball`], ["SHOTS", (w, l) => `outshot them ${w}-${l}`], ["ON GOAL", (w, l) => `put ${w} on target to ${l}`], ["Corner Kicks", (w, l) => `won ${w} corners to ${l}`]],
};
// the team stats panel: the ones worth reading, in order (everything else stays off the screen)
const PANEL_STATS = {
  basket: ["Field Goal %", "FG", "Three Point %", "3PT", "Free Throw %", "FT", "Total Rebounds", "Rebounds", "Offensive Rebounds", "Assists", "Steals", "Blocks", "Turnovers", "Points in Paint", "Fast Break Points", "Largest Lead"],
  foot: ["Total Yards", "Passing", "Rushing", "1st Downs", "3rd down efficiency", "4th down efficiency", "Turnovers", "Penalties", "Possession", "Comp/Att", "Yards per pass", "Yards per rush"],
  NHL: ["Shots", "Power Play Goals", "Power Play Opportunities", "Faceoffs Won", "Faceoff Win Percentage", "Hits", "Blocked Shots", "Takeaways", "Giveaways", "Penalty Minutes"],
  Soccer: ["Possession", "SHOTS", "ON GOAL", "Corner Kicks", "Fouls", "Yellow Cards", "Red Cards", "Offsides", "Saves", "Passes", "Pass Completion %", "Tackles"],
  MLB: ["Hits", "Runs", "Home Runs", "RBIs", "Walks", "Strikeouts", "Left On Base", "Batting Average", "Stolen Bases"],
};
const grpOf = sport => (sport === "NFL" || sport === "CFB" ? "foot" : ["NBA", "WNBA", "CBB", "CBBW"].includes(sport) ? "basket" : sport);
export function teamStatRows(F, sport) {
  const want = PANEL_STATS[grpOf(sport)];
  if (!want) return F.teamStats.slice(0, 14);
  const seen = new Set(), out = [];
  for (const lab of want) { const r = F.teamStats.find(x => x.label.toLowerCase() === lab.toLowerCase() && !seen.has(x.label.toLowerCase())); if (r) { seen.add(r.label.toLowerCase()); out.push(r); } }
  return out.length ? out : F.teamStats.slice(0, 14);
}
export function finalRundown(F, sport, rec, learned) {
  if (!F) return { paras: [], algo: [] };
  const A = F.away, H = F.home, Wn = A.win ? A : H.win ? H : (A.score > H.score ? A : H.score > A.score ? H : null);
  const Ls = Wn === A ? H : Wn === H ? A : null, draw = !Wn;
  const nm = t => t.short || t.name, u = sport === "Soccer" || sport === "NHL" ? "goals" : sport === "MLB" ? "runs" : "points";
  const paras = [];
  // 1. the result and how it unfolded
  let p = draw ? `${nm(A)} and ${nm(H)} drew ${A.score}-${H.score}` : F.setText ? `${nm(Wn)} beat ${nm(Ls)} ${F.setText}` : `${nm(Wn)} beat ${nm(Ls)} ${Wn.score}-${Ls.score}`;
  if (/OT|SO|extra|AET|pen/i.test(F.detail) && !/^final$/i.test(F.detail)) p += ` (${F.detail.replace(/^final\s*\/?\s*/i, "")})`;
  p += F.venue ? ` at ${F.venue}${F.city ? ` in ${F.city}` : ""}` : "";
  p += F.attendance ? ` in front of ${F.attendance.toLocaleString("en-US")}.` : ".";
  const per = PERIOD[sport], la = A.lines, lh = H.lines;
  if (per && la.length >= 2 && la.length === lh.length && !draw) {
    const cum = (arr, k) => arr.slice(0, k).reduce((s, v) => s + (v || 0), 0);
    const half = sport === "MLB" ? 5 : sport === "NHL" ? 2 : Math.floor(la.length / 2);
    const wa = Wn === A ? la : lh, lo = Wn === A ? lh : la;
    const hw = cum(wa, half), hl = cum(lo, half);
    const brk = sport === "MLB" ? "after five innings" : sport === "NHL" ? "after two periods" : la.length <= 2 ? "at half-time" : "at the half";
    if (hl > hw) p += ` ${nm(Wn)} came back: they were down ${hl}-${hw} ${brk}.`;
    else if (hw > hl) p += ` ${nm(Wn)} led ${hw}-${hl} ${brk}${Wn.score - Ls.score <= (sport === "Soccer" || sport === "NHL" || sport === "MLB" ? 1 : 5) ? " and held on" : " and never looked back"}.`;
    else p += ` It was level at ${hw}-${hl} ${brk}.`;
    let best = -1, bi = -1;
    for (let i = 0; i < wa.length; i++) { const d = (wa[i] || 0) - (lo[i] || 0); if (d > best) { best = d; bi = i; } }
    if (best >= (sport === "Soccer" || sport === "NHL" || sport === "MLB" ? 2 : 6) && per !== "half") p += ` The ${ord(bi + 1)} ${bi + 1 > (sport === "MLB" ? 9 : sport === "NHL" ? 3 : 4) ? "(overtime) " : ""}${per} decided it: ${nm(Wn)} won it ${wa[bi]}-${lo[bi]}.`;
  }
  if (F.wp && !draw) { const lowW = Wn === H ? F.wp.min : 1 - F.wp.max; if (lowW < 0.3) p += ` Their win chance dropped as low as ${pct(lowW)} along the way.`; else if (lowW > 0.7) p += ` By ESPN's win probability it was never really in doubt (never below ${pct(lowW)}).`; }
  paras.push(p);
  // 2. how it was scored
  if (sport === "Soccer" && F.scoring.length) {
    const goals = F.scoring.filter(e => e.kind === "goal" || e.kind === "own goal" || e.kind === "penalty");
    const reds = F.scoring.filter(e => e.kind === "red card");
    const g = s => goals.filter(e => e.side === s).map(e => `${e.who}${e.kind === "own goal" ? " (o.g.)" : e.kind === "penalty" ? " (pen)" : ""} ${e.when}`).join(", ");
    p = goals.length ? `Goals: ${nm(A)} ${g("away") || "none"}; ${nm(H)} ${g("home") || "none"}.` : "No goals.";
    if (reds.length) p += ` Sent off: ${reds.map(e => `${e.who} (${e.side === "away" ? nm(A) : nm(H)}, ${e.when})`).join(", ")}.`;
    paras.push(p);
  } else if ((sport === "NFL" || sport === "CFB") && F.scoring.length) {
    const kind = (s, re) => F.scoring.filter(e => e.side === s && re.test(e.kind)).length;
    const line = (s, t) => `${nm(t)} ${kind(s, /TD|touchdown/i)} touchdown${kind(s, /TD|touchdown/i) === 1 ? "" : "s"} and ${kind(s, /FG|field goal/i)} field goal${kind(s, /FG|field goal/i) === 1 ? "" : "s"}`;
    const last = F.scoring[F.scoring.length - 1];
    paras.push(`Scoring: ${line("away", A)}; ${line("home", H)}. The last score: ${last.text}${last.period ? ` (${ord(last.period)} quarter${last.when ? `, ${last.when}` : ""})` : ""}.`);
  } else if (sport === "MLB" && F.scoring.length) {
    paras.push(`How the runs came in: ${F.scoring.slice(0, 5).map(e => `${e.text.replace(/\.$/, "")}${e.period ? ` (${ord(e.period)})` : ""}`).join("; ")}${F.scoring.length > 5 ? `; and ${F.scoring.length - 5} more` : ""}.`);
  } else if (sport === "NHL" && F.scoring.length) {
    const lastW = [...F.scoring].reverse().find(e => e.side === (Wn === A ? "away" : "home"));
    paras.push(`${F.scoring.length} goals in all.${lastW ? ` ${nm(Wn)}'s last: ${lastW.text.replace(/\s*\(\d+\)/, "")}${lastW.period ? `, ${ord(lastW.period)} period ${lastW.when}` : ""}.` : ""}`);
  }
  // 3. who carried it
  const lead = t => {
    const by = new Map();
    for (const l of (F.leaders[t] || []).slice(0, 3)) {
      const one = /^[\d.]+$/.test(String(l.v)) ? `${l.v} ${shortCat(l.cat, Number(l.v))}` : String(l.v).replace(/\s+YDS/g, " yds").replace(/\bCAR\b/, "car").replace(/\bREC\b/, "rec");
      by.set(l.name, [...(by.get(l.name) || []), one]);
    }
    return [...by].map(([n, v]) => `${n} ${v.join(", ")}`);
  };
  if (F.leaders.away.length || F.leaders.home.length) paras.push(`Leading the way — ${[["away", A], ["home", H]].filter(([s]) => F.leaders[s].length).map(([s, t]) => `${nm(t)}: ${lead(s).join("; ")}`).join(". ")}.`);
  // 4. where it was won: the team stats with the clearest edge to the winner
  const grp = grpOf(sport);
  if (STAT_PICK[grp] && F.teamStats.length && !draw) {
    const out = [];
    for (const [lab, say, lowerBetter] of STAT_PICK[grp]) {
      const r = F.teamStats.find(x => x.label.toLowerCase() === lab.toLowerCase()); if (!r) continue;
      const a = num(r.a), h = num(r.h); if (a == null || h == null || a === h) continue;
      const wv = Wn === A ? a : h, lv = Wn === A ? h : a;
      if (lowerBetter === null ? false : lowerBetter ? wv < lv : wv > lv) out.push(say(r[Wn === A ? "a" : "h"], r[Wn === A ? "h" : "a"]));
      if (out.length >= 3) break;
    }
    if (out.length) paras.push(`Where ${nm(Wn)} won it: they ${out.length > 1 ? out.slice(0, -1).join(", ") + " and " + out[out.length - 1] : out[0]}.`);
  }
  // 5. against the closing line
  const Lx = F.lines;
  if (Lx && (Lx.spreadHome != null || Lx.total != null)) {
    const bits = [], margin = H.score - A.score, total = A.score + H.score;
    if (Lx.spreadHome != null && Lx.spreadHome !== 0 && sport !== "Soccer") {
      const favHome = Lx.spreadHome < 0, fav = favHome ? H : A, dog = favHome ? A : H, k = Math.abs(Lx.spreadHome), cover = (favHome ? margin : -margin) - k;
      bits.push(`${nm(fav)} closed as ${f1(k)}-${sport === "MLB" ? "run" : sport === "NHL" ? "goal" : "point"} favorites and ${cover > 0 ? `covered by ${f1(cover)}` : cover < 0 ? (fav.win ? `won but didn't cover (${nm(dog)} +${f1(k)} cashed)` : `lost outright to ${nm(dog)}`) : "pushed"}`);
    }
    if (Lx.homeML != null && Lx.awayML != null && !draw) { const wML = Wn === H ? Lx.homeML : Lx.awayML, oML = Wn === H ? Lx.awayML : Lx.homeML; if (wML > 100 && wML > oML) bits.push(`${nm(Wn)} won as the underdog at +${wML}`); }
    if (Lx.total != null) { const d = total - Lx.total; bits.push(`the total closed at ${f1(Lx.total)} and they combined for ${total}, ${d > 0 ? `over by ${f1(d)}` : d < 0 ? `under by ${f1(-d)}` : "a push"}`); }
    if (bits.length) paras.push(`Against the closing line${Lx.provider ? ` (${Lx.provider})` : ""}: ${bits.join("; ")}.`);
  }
  // ---------- the algo: its call before the game, and what this game taught it ----------
  const algo = [];
  if (rec) {
    const pa = rec.p.a / Math.max(1e-9, rec.p.a + rec.p.h + (rec.p.d || 0)), ph = rec.p.h / Math.max(1e-9, rec.p.a + rec.p.h + (rec.p.d || 0)), pd = rec.p.d ? rec.p.d / (rec.p.a + rec.p.h + rec.p.d) : 0;
    const likes = ph >= pa ? H : A, likeP = Math.max(pa, ph);
    let s = `Before the game the algo had ${nm(A)} ${pct(pa)}${pd ? `, the draw ${pct(pd)}` : ""} and ${nm(H)} ${pct(ph)}`;
    if (rec.proj && rec.proj.total > 0) { const hp = (rec.proj.total + rec.proj.margin) / 2, ap = (rec.proj.total - rec.proj.margin) / 2; s += `, projecting ${nm(A)} ${f1(ap)} – ${nm(H)} ${f1(hp)}`; }
    s += ".";
    if (!draw) s += likes === Wn ? ` It had the right winner (${pct(likeP)}).` : ` It had ${nm(likes)} (${pct(likeP)}), so this one went against it.`;
    else if (pd) s += ` It gave the draw ${pct(pd)}.`;
    if (rec.proj && rec.proj.total > 0) { const dT = A.score + H.score - rec.proj.total, dM = (H.score - A.score) - rec.proj.margin; s += ` Total: ${A.score + H.score} against ${f1(rec.proj.total)} projected (${sgn(dT)}); margin off by ${f1(Math.abs(dM))} ${u}.`; }
    algo.push(s);
    const pick = rec.pick ? rec.plays.find(x => x.key === rec.pick) : null;
    if (pick) algo.push(`Its pick: ${pick.label}${pick.odds != null ? ` at ${pick.odds > 0 ? "+" : ""}${pick.odds}` : ""}${rec.grade ? ` (grade ${rec.grade})` : ""}${pick.res ? ` — ${pick.res === "W" ? "WON" : pick.res === "L" ? "LOST" : "PUSH"}${pick.u ? ` (${sgn(pick.u)}u)` : ""}.` : " — grading within a few minutes of the final."}`);
    else if (rec.plays?.length) { const done = rec.plays.filter(x => x.res); algo.push(`No bet: nothing on this game cleared the algo's bar.${done.length ? ` Its priced lines went ${done.filter(x => x.res === "W").length}-${done.filter(x => x.res === "L").length}.` : ""}`); }
    if (!rec.result) algo.push("The background tracker grades this game from the final within a few minutes, then it joins the learning below.");
  } else algo.push("This game wasn't in the tracker's pre-game log, so there's no pre-game call to grade; it doesn't feed the learning.");
  const Lr = learned && learned[sport];
  if (rec && (sport === "Tennis" || sport === "MMA")) algo.push(`What it learns: the result goes into both ${sport === "Tennis" ? "players'" : "fighters'"} Elo ratings at the next data run (every few minutes), so their next match is priced on it.`);
  else if (Lr && rec) {
    const tm = t => Lr.teams && Lr.teams[t.abbr];
    if (Lr.inactive) algo.push(`What it learns: ${sport} learning switches on at 20 graded games (${Lr.n || 0} so far); this game counts toward it, along with every team's attack and defense against their projections.`);
    else {
      let s = `What it learns: across ${Lr.n} graded ${sport} games the algo now scales scoring ×${Number(Lr.s).toFixed(3)} and gives home teams ${sgn(Lr.h)} ${u}.`;
      const tt = [[A, tm(A)], [H, tm(H)]].filter(([, x]) => x).map(([t, x]) => `${nm(t)} attack ×${x[0].toFixed(3)}, defense ×${x[1].toFixed(3)} (${x[2]} games)`);
      s += tt.length ? ` Team by team, from how they've scored and allowed against projection: ${tt.join("; ")}.` : " Team-by-team adjustments start after 3 graded games for a team.";
      algo.push(s);
    }
  }
  return { paras, algo };
}
const shortCat = (c, v) => ({ Points: "pts", Rebounds: "reb", Assists: "ast", "Passing Yards": "pass yds", "Rushing Yards": "rush yds", "Receiving Yards": "rec yds", Goals: v === 1 ? "goal" : "goals", Saves: v === 1 ? "save" : "saves" }[c] || (c || "").toLowerCase());

// which columns show first in a player table (the rest open with a tap)
export const COL_ORDER = {
  basket: ["PTS", "REB", "AST", "MIN", "FG", "3PT", "FT", "STL", "BLK", "TO", "+/-", "OREB", "DREB", "PF"],
  skater: ["G", "A", "+/-", "SOG", "TOI", "HT", "BS", "PIM", "FO%", "GV", "TK", "SHFT"],
  goalie: ["SV", "SA", "GA", "SV%", "TOI"],
  batting: ["H-AB", "R", "H", "RBI", "HR", "BB", "K", "AVG", "OBP", "SLG"],
  pitching: ["IP", "H", "R", "ER", "BB", "K", "HR", "PC-ST", "ERA"],
};
export function colOrder(sport, group, labels) {
  const g = String(group || "").toLowerCase();
  const pref = ["NBA", "WNBA", "CBB", "CBBW"].includes(sport) ? COL_ORDER.basket : sport === "NHL" ? (g === "goalies" ? COL_ORDER.goalie : COL_ORDER.skater) : sport === "MLB" ? COL_ORDER[g] || [] : [];
  const idx = labels.map((l, i) => i);
  if (!pref.length) return idx.filter(i => !/^YTD/.test(labels[i]));
  return [...pref.map(l => labels.indexOf(l)).filter(i => i >= 0), ...idx.filter(i => !pref.includes(labels[i]) && !/^YTD/.test(labels[i]))];
}
export const groupTitle = g => ({ forwards: "Forwards", defenses: "Defense", goalies: "Goalies", batting: "Batting", pitching: "Pitching", passing: "Passing", rushing: "Rushing", receiving: "Receiving", fumbles: "Fumbles", defensive: "Defense", interceptions: "Interceptions", kickReturns: "Kick returns", puntReturns: "Punt returns", kicking: "Kicking", punting: "Punting", players: "Players" }[g] || (g ? g[0].toUpperCase() + g.slice(1) : "Players"));
