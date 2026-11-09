// After the final: the game's summary route read into one report (score by period, team stats, every player's line,
// how it was scored, the closing lines), and a rundown written from those numbers plus what the algo said before the
// game and what it learned from it. No outside writer: every sentence comes from the data.
const num = v => { const x = parseFloat(String(v ?? "").replace(/[^\d.+-]/g, "")); return Number.isFinite(x) ? x : null; };
const ord = k => `${k}${k % 100 >= 11 && k % 100 <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[k % 10] || "th"}`;
const pct = p => `${Math.round(p * 100)}%`;
const f1 = v => (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, "");
const sgn = v => `${v > 0 ? "+" : ""}${f1(v)}`;
// the tabs added for every other ESPN league read like the closest original sport (periods, team stats, units)
const FAMILY = { HOOPS: "NBA", GRID: "NFL", PUCK: "NHL", BASE: "MLB" };
const fam = sport => FAMILY[sport] || sport;
// the name each tab shows (sport keys that aren't already their label)
export const labelOf = sport => ({ CBBW: "NCAAW", BASE: "Baseball+", HOOPS: "Hoops+", GRID: "Football+", PUCK: "Hockey+", RUGBY: "Rugby", RUGBYL: "Rugby League", LAX: "Lacrosse", FHOCKEY: "Field Hockey", VOLLEY: "Volleyball", WPOLO: "Water Polo" }[sport] || sport);
const poss = n => (/s$/i.test(n) ? `${n}'` : `${n}'s`);
export const unitOf = sport => ({ Soccer: "goals", NHL: "goals", PUCK: "goals", LAX: "goals", FHOCKEY: "goals", WPOLO: "goals", MLB: "runs", BASE: "runs", VOLLEY: "sets", Tennis: "sets", MMA: "rounds" }[sport] || "points");

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
const PERIOD = { NBA: "quarter", WNBA: "quarter", NFL: "quarter", CFB: "quarter", NHL: "period", CBB: "half", CBBW: "quarter", Soccer: "half", MLB: "inning",
  AFL: "quarter", RUGBY: "half", RUGBYL: "half", LAX: "quarter", FHOCKEY: "quarter", WPOLO: "quarter" };
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
const grpOf = sport0 => { const sport = fam(sport0); return sport === "NFL" || sport === "CFB" ? "foot" : ["NBA", "WNBA", "CBB", "CBBW"].includes(sport) ? "basket" : sport; };
export function teamStatRows(F, sport) {
  const want = PANEL_STATS[grpOf(sport)];
  if (!want) return F.teamStats.slice(0, 14);
  const seen = new Set(), out = [];
  for (const lab of want) { const r = F.teamStats.find(x => x.label.toLowerCase() === lab.toLowerCase() && !seen.has(x.label.toLowerCase())); if (r) { seen.add(r.label.toLowerCase()); out.push(r); } }
  return out.length ? out : F.teamStats.slice(0, 14);
}
export function finalRundown(F, sport0, rec, learned) {
  if (!F) return { paras: [], algo: [] };
  const sport = fam(sport0);
  const A = F.away, H = F.home, Wn = A.win ? A : H.win ? H : (A.score > H.score ? A : H.score > A.score ? H : null);
  const Ls = Wn === A ? H : Wn === H ? A : null, draw = !Wn;
  const nm = t => t.short || t.name, u = unitOf(sport0);
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
  } else algo.push("The algo's call on this game couldn't be rebuilt (the teams weren't found on the scores routes). The game is still archived with its full box score.");
  const Lr = learned && learned[sport0];
  if (rec && (sport === "Tennis" || sport === "MMA")) algo.push(`What it learns: the result goes into both ${sport === "Tennis" ? "players'" : "fighters'"} Elo ratings at the next data run (every few minutes), so their next match is priced on it.`);
  else if (Lr && rec) {
    const tm = t => Lr.teams && Lr.teams[t.abbr];
    if (Lr.inactive) algo.push(`What it learns: ${labelOf(sport0)} learning switches on at 20 graded games (${Lr.n || 0} so far); this game counts toward it, along with every team's attack and defense against their projections.`);
    else {
      let s = `What it learns: across ${Lr.n} graded ${labelOf(sport0)} games the algo now scales scoring ×${Number(Lr.s).toFixed(3)} and gives home teams ${sgn(Lr.h)} ${u}.`;
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

// ---------- the post-game review: every part of the pre-game rundown, checked against what happened ----------
// Mirrors the pre-game rundown section by section: the call, how each side's rating held up, where the result sat in
// the simulations, each situational factor, personnel, each priced line and how the line moved to the close, where the
// public and the money were, what could have made it wrong, what this game teaches the algo, and the bottom line.
// rec is the tracker's record (rec.pre holds the pre-game reasoning; older records without it get the parts they can).
const Phi = z => { const t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989423 * Math.exp(-z * z / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; };
const decOf = o => (o > 0 ? 1 + o / 100 : 1 + 100 / Math.abs(o));
const fairPair = (a, b) => { if (a == null || b == null) return null; const x = 1 / decOf(a), y = 1 / decOf(b); return [x / (x + y), y / (x + y)]; };
export function algoReview(F, sport0, rec, learned) {
  if (!F || !rec || !rec.p) return [];
  const as = F.away.score, hs = F.home.score;
  if (!Number.isFinite(as) || !Number.isFinite(hs)) return [];
  const A = F.away, H = F.home, nm = t => t.short || t.name, u = unitOf(sport0), pre = rec.pre || null, proj = rec.proj && rec.proj.total > 0 ? rec.proj : null;
  const out = [], add = (title, ...ps) => { const body = ps.filter(Boolean).join("\n\n"); if (body) out.push({ title, body }); };
  const tot = rec.p.a + rec.p.h + (rec.p.d || 0) || 1, pa = rec.p.a / tot, ph = rec.p.h / tot, pd = (rec.p.d || 0) / tot;
  const win = hs > as ? "home" : as > hs ? "away" : "draw", likes = ph >= pa ? "home" : "away", W = win === "home" ? H : win === "away" ? A : null;
  const pjH = proj ? (proj.total + proj.margin) / 2 : null, pjA = proj ? (proj.total - proj.margin) / 2 : null;
  const dev = (x, p) => `${x >= p ? "+" : "−"}${f1(Math.abs(x - p))} ${u}${p > 0 ? `, ${Math.round(Math.abs(x / p - 1) * 100)}% ${x >= p ? "over" : "under"}` : ""}`;
  const rel = r => { const d = (r - 1) * 100; return Math.abs(d) < 1.5 ? "league-average" : `${Math.abs(d).toFixed(0)}% ${d > 0 ? "above" : "below"} average`; };
  const relD = r => { const d = (1 - r) * 100; return Math.abs(d) < 1.5 ? "league-average" : d > 0 ? `${d.toFixed(0)}% stingier than average` : `${(-d).toFixed(0)}% leakier than average`; };
  const when = rec.at ? new Date(rec.at).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET" : "";

  // 1 · the call
  add("The algo's call",
    `${rec.late ? `Rebuilt ${rec.fresh ? "just now" : "after the final"} from pre-game data only: the tracker hadn't logged this game before it started, so the call was made from the final's scoreboard row (its closing odds, when posted) and both teams' season numbers with this game taken back out of them${rec.fresh ? " (the tracker logs the same rebuild into the record at its next run)" : ""}.` : `Logged before the start${when ? `, last snapshot ${when}` : ""}.`} It had ${nm(A)} ${pct(pa)}${pd ? `, the draw ${pct(pd)}` : ""} and ${nm(H)} ${pct(ph)}${proj ? `, projecting ${nm(A)} ${f1(pjA)} – ${nm(H)} ${f1(pjH)} (${f1(proj.total)} total, ${nm(proj.margin >= 0 ? H : A)} by ${f1(Math.abs(proj.margin))})` : ""}.`,
    `Final: ${nm(A)} ${as} – ${nm(H)} ${hs}. ${win === "draw" ? `A draw, which it gave ${pct(pd)}.` : likes === win ? `Right winner: it had ${nm(W)} at ${pct(Math.max(pa, ph))}.` : `Wrong winner: it had ${nm(likes === "home" ? H : A)} at ${pct(Math.max(pa, ph))}, and ${nm(W)} (${pct(win === "home" ? ph : pa)}) won.`}`,
    rec.thin ? `Thin data: ${pre?.dq ?? 0} of 6 key inputs were sourced${pre?.miss?.length ? ` (missing: ${pre.miss.join(", ")})` : ""}, so league averages filled the gaps. It was logged as a no-data call: graded and learned from, never offered as a bet.` : "");

  // 2 · the ratings
  if (proj && pre?.parts?.a && pre?.parts?.h) {
    const side = (t, k, myP, oppP, my, opp) => {
      const [o, d, no, nd] = pre.parts[k], tm = pre.tm?.[k];
      const came = tm && tm[2] ? ` (${tm[3] ? `${tm[3]}, ` : ""}${tm[0] != null ? `${f1(tm[0])} scored and ${f1(tm[1])} allowed a game over ${tm[2]} games` : `${tm[2]} games`})` : tm && tm[4] ? ` (no current-season scoring; ${tm[4]} past seasons on file)` : " (no scoring on file: rated at the league average)";
      return `${nm(t)} came in with a ${rel(o)} attack and a ${relD(d)} defense${came}, worth about ${no} and ${nd} games of evidence. Projected to score ${f1(myP)}, they scored ${my} (${dev(my, myP)}); projected to allow ${f1(oppP)}, they allowed ${opp} (${dev(opp, oppP)}).`;
    };
    const eA = as - pjA, eH = hs - pjH, big = Math.abs(eA) >= Math.abs(eH) ? [A, eA] : [H, eH];
    add("How the ratings held up", side(A, "a", pjA, pjH, as, hs), side(H, "h", pjH, pjA, hs, as),
      `The bigger miss was ${poss(nm(big[0]))} scoring (${sgn(big[1])} ${u} against projection)${Math.sign(eA) === Math.sign(eH) && Math.abs(eA) > 0.5 && Math.abs(eH) > 0.5 ? `; both sides ${eA > 0 ? "out" : "under"}scored their projections, so the game ran ${eA > 0 ? "hotter" : "colder"} than either team's numbers said` : ""}.`);
  } else if (proj) add("How the ratings held up", `Projected ${nm(A)} ${f1(pjA)}, scored ${as} (${dev(as, pjA)}). Projected ${nm(H)} ${f1(pjH)}, scored ${hs} (${dev(hs, pjH)}).`);

  // 3 · the simulations
  if (proj) {
    const sdM = pre?.sd?.[0], sdT = pre?.sd?.[1], m = hs - as, t = as + hs;
    const zT = sdT ? (t - proj.total) / sdT : null, zM = sdM ? (m - proj.margin) / sdM : null;
    const pc = z => { const q = Math.round(Phi(z) * 100); return `${ord(Math.max(1, Math.min(99, q)))} percentile`; };
    const worst = Math.max(Math.abs(zT ?? 0), Math.abs(zM ?? 0));
    add("Where the result sat in the simulations",
      `Total: ${t} against ${f1(proj.total)} projected (${sgn(t - proj.total)})${zT != null ? `, about the ${pc(zT)} of the simulated totals (a typical game swings ±${f1(sdT)})` : ""}.`,
      `Margin: ${nm(m >= 0 ? H : A)} by ${Math.abs(m)} against ${nm(proj.margin >= 0 ? H : A)} by ${f1(Math.abs(proj.margin))} projected${zM != null ? `, about the ${pc(zM)} of the simulated margins (typical swing ±${f1(sdM)})` : ""}.`,
      zT != null || zM != null ? (worst < 1 ? "An ordinary result: inside the range the simulations expected most of the time." : worst < 2 ? "An unusual result, but one the simulations saw regularly (roughly one game in six to one in twenty)." : "An outlier: the simulations had a result this far off less than about 5% of the time, which usually means an input was wrong or missing, not just bad luck.") : "");
  }

  // 4 · situational factors
  if (pre?.fx?.length && proj) {
    const perfH = pjH > 0 ? hs / pjH : 1, perfA = pjA > 0 ? as / pjA : 1;
    add("Situational factors, checked", pre.fx.map(([label, hm, am, desc]) => {
      const fav = hm > am ? "home" : am > hm ? "away" : null, t = fav === "home" ? H : A;
      const held = fav ? (fav === "home" ? perfH >= perfA : perfA >= perfH) : null;
      return `${label}${desc ? ` (${desc})` : ""}: ${nm(H)} ×${Number(hm).toFixed(2)}, ${nm(A)} ×${Number(am).toFixed(2)}.${fav ? ` It favored ${nm(t)}, who ${held ? "did beat" : "did not beat"} their projection by more than the other side did.` : ""}`;
    }).join(" "), pre.rest && (pre.rest[0] != null || pre.rest[1] != null) ? `Rest coming in: ${nm(A)} ${pre.rest[0] ?? "?"} days, ${nm(H)} ${pre.rest[1] ?? "?"} days.` : "");
  } else if (pre) add("Situational factors, checked", "Nothing situational moved this projection (rest, travel, form and conditions were all normal), so it came down to team strength.");

  // 5 · personnel
  if (pre?.inj) {
    const played = [...F.players.away, ...F.players.home].flatMap(g => g.rows.map(r => r.name)).filter(n => n && pre.inj.includes(n));
    add("Personnel, checked", `Injury report before the game: ${pre.inj}.${played.length ? ` Listed but played: ${[...new Set(played)].join(", ")}.` : ""}`);
  }

  // 6 · the market
  const plays = (rec.plays || []).filter(x => x && x.market);
  if (plays.length || rec.mkt || F.lines) {
    const L = F.lines || {}, m0 = rec.mkt || {}, bits = [];
    const clv = pl => {
      if (pl.market === "SPR" && L.spreadHome != null && pl.line != null) { const close = pl.side === "home" ? L.spreadHome : -L.spreadHome, d = pl.line - close; return Math.abs(d) < 0.05 ? "same number as the close" : `${d > 0 ? "beat" : "lost to"} the closing ${sgn(close)} by ${f1(Math.abs(d))}`; }
      if (pl.market === "TOT" && L.total != null && pl.line != null) { const d = pl.side === "over" ? L.total - pl.line : pl.line - L.total; return Math.abs(d) < 0.05 ? "same number as the close" : `${d > 0 ? "beat" : "lost to"} the closing ${f1(L.total)} by ${f1(Math.abs(d))}`; }
      if (pl.market === "ML" && pl.odds != null) { const fp = fairPair(L.homeML, L.awayML); if (!fp) return ""; const closeP = pl.side === "home" ? fp[0] : pl.side === "away" ? fp[1] : null; if (closeP == null) return ""; const d = closeP - 1 / decOf(pl.odds); return `${d > 0 ? "beat" : "lost to"} the close (closing fair chance ${pct(closeP)})`; }
      return "";
    };
    for (const pl of plays) bits.push(`${pl.label}${pl.odds != null ? ` at ${pl.odds > 0 ? "+" : ""}${pl.odds}` : ""}: the algo gave it ${pl.wc != null ? pct(pl.wc) : "?"}${pl.fair != null ? ` vs ${pct(pl.fair)} fair` : ""}${pl.edge != null ? ` (${sgn(pl.edge)} pts)` : ""}${pl.key === rec.pick ? ", THE PICK" : ""} — ${pl.res ? (pl.res === "W" ? "won" : pl.res === "L" ? "lost" : "push") : "ungraded"}${pl.u ? ` (${sgn(pl.u)}u)` : ""}${clv(pl) ? `; ${clv(pl)}` : ""}.`);
    const mv = [];
    if (m0.awaySpread != null && L.spreadHome != null && Math.abs(-m0.awaySpread - L.spreadHome) >= 0.5) mv.push(`spread ${nm(H)} ${sgn(-m0.awaySpread)} → ${sgn(L.spreadHome)}`);
    if (m0.total != null && L.total != null && Math.abs(m0.total - L.total) >= 0.5) mv.push(`total ${f1(m0.total)} → ${f1(L.total)}`);
    let toward = "";
    if (proj && L.total != null && m0.total != null && L.total !== m0.total) toward = ` The total moved ${(L.total - m0.total) * (proj.total - m0.total) > 0 ? "toward" : "away from"} the algo's number.`;
    add("Against the market",
      plays.length ? bits.join(" ") : "No line was priced for this game (no posted odds, or not enough data to price one).",
      mv.length ? `From the algo's snapshot to the close: ${mv.join("; ")}.${toward}` : (L.total != null || L.spreadHome != null) ? "The line barely moved between the algo's snapshot and the close." : "",
      rec.pick ? "" : plays.length ? "No bet: nothing cleared the algo's bar before the game." : "");
  }

  // 7 · public and money
  const sp = pre?.spl;
  if (sp && (sp.s?.[0] != null || sp.t?.[0] != null || sp.m?.[0] != null || pre.sharp)) {
    const sprA = rec.mkt?.awaySpread ?? (F.lines?.spreadHome != null ? -F.lines.spreadHome : null), atsA = sprA != null ? as + sprA - hs : null;
    const bits = [];
    if (sp.s?.[0] != null) bits.push(`spread: ${sp.s[0]}% of bets on ${nm(A)}${sp.s[1] != null ? `, ${sp.s[1]}% of the money` : ""}${atsA != null ? ` — ${atsA > 0 ? `${nm(A)} covered` : atsA < 0 ? `${nm(H)} covered` : "a push"}` : ""}`);
    if (sp.t?.[0] != null) bits.push(`total: ${sp.t[0]}% of bets on the over${sp.t[1] != null ? `, ${sp.t[1]}% of the money` : ""}${rec.mkt?.total != null ? ` — it went ${as + hs > rec.mkt.total ? "over" : as + hs < rec.mkt.total ? "under" : "push"}` : ""}`);
    if (sp.m?.[0] != null) bits.push(`moneyline: ${sp.m[0]}% of bets on ${nm(A)}${sp.m[1] != null ? `, ${sp.m[1]}% of the money` : ""}`);
    add("Where the public and the money were",
      bits.length ? `${sp.src ? `Splits (${sp.src}): ` : ""}${bits.join("; ")}.` : "",
      pre.sharp ? `The sharp side by the algo's read was ${nm(pre.sharp === "home" ? H : A)}, who ${win === "draw" ? "drew" : win === pre.sharp ? "won" : "lost"}${atsA != null ? ` and ${(pre.sharp === "away" ? atsA : -atsA) > 0 ? "covered" : "didn't cover"}` : ""}.` : "");
  }

  // 8 · what could have made it wrong
  const risks = [];
  if (pre?.tm?.a?.[2] != null && pre.tm.a[2] < 8 || pre?.tm?.h?.[2] != null && pre.tm.h[2] < 8) risks.push("early-season numbers were thin");
  if (pre?.miss?.length) risks.push(`inputs were missing (${pre.miss.join(", ")})`);
  if (!rec.mkt || (rec.mkt.homeML == null && rec.mkt.awaySpread == null)) risks.push("there were no odds to check the projection against");
  if (pre?.inj) risks.push("injuries were listed");
  if (rec.late) risks.push("the call was rebuilt after the fact rather than logged live");
  if (risks.length) {
    const missed = proj ? Math.max(Math.abs((as + hs) - proj.total) / Math.max(1e-9, pre?.sd?.[1] || proj.total * 0.15), Math.abs((hs - as) - proj.margin) / Math.max(1e-9, pre?.sd?.[0] || proj.total * 0.15)) : 0;
    add("What could have made it wrong", `Flagged going in: ${risks.join("; ")}.`, proj ? (missed >= 1.5 ? "The projection missed by a lot, so those flags likely mattered here." : missed >= 1 ? "The result was off its normal range without being an outlier, so the flags may have played a part." : "The projection landed within its normal range anyway, so the flags didn't cost it much this time.") : "");
  }

  // 9 · learning
  const Lr = learned && learned[sport0];
  if (sport0 === "Tennis" || sport0 === "MMA") add("What the algo learns", `The result goes into both ${sport0 === "Tennis" ? "players'" : "fighters'"} Elo ratings at the next data run, so their next match is priced on it.`);
  else if (proj) {
    const rawT = proj.rawTotal || proj.total, rawM = proj.rawMargin ?? proj.margin;
    const s1 = (as + hs + 0.5) / (rawT + 0.5), hres = (hs - as) - rawM;
    const parts = [`This game's own lesson: scoring came in at ×${s1.toFixed(3)} of the raw projection${rec.neutral ? "" : `, and the home side beat its projected margin by ${sgn(hres)} ${u}`}. It counts toward ${labelOf(sport0)} scoring level, home edge and both teams' attack and defense corrections${rec.thin ? " (it's how teams with no standings on the routes build a record of their own)" : ""}.`];
    if (Lr && !Lr.inactive) {
      const tm = t => Lr.teams && Lr.teams[t.abbr];
      const tt = [[A, tm(A)], [H, tm(H)]].filter(([, x]) => x).map(([t, x]) => `${nm(t)} attack ×${x[0].toFixed(3)}, defense ×${x[1].toFixed(3)} (${x[2]} games)`);
      parts.push(`Across ${Lr.n} graded ${labelOf(sport0)} games the algo now scales scoring ×${Number(Lr.s).toFixed(3)} and gives home teams ${sgn(Lr.h)} ${u}.${tt.length ? ` Team corrections so far: ${tt.join("; ")}.` : " Team corrections start after 3 graded games for a team."}`);
    } else if (Lr) parts.push(`${labelOf(sport0)} learning switches on at 20 graded games (${Lr.n || 0} so far).`);
    if (!rec.result && !rec.fresh) parts.push("The tracker grades it from the final within a few minutes; then it joins the learning.");
    add("What the algo learns", ...parts);
  }

  // 10 · bottom line
  const pick = rec.pick ? (rec.plays || []).find(x => x.key === rec.pick) : null;
  const bl = [win === "draw" ? "Draw" : likes === win ? "Right side" : "Wrong side"];
  if (proj) {
    const e = Math.abs(as + hs - proj.total), em = Math.abs((hs - as) - proj.margin), sdT = pre?.sd?.[1], sdM = pre?.sd?.[0];
    bl.push(sdT ? (e <= sdT ? "total within its normal range" : "total outside its normal range") : `total off by ${f1(e)}`);
    bl.push(sdM ? (em <= sdM ? "margin within its normal range" : `margin outside its normal range (off by ${f1(em)} ${u})`) : `margin off by ${f1(em)}`);
  }
  if (pick) bl.push(`the pick ${pick.res === "W" ? "won" : pick.res === "L" ? "lost" : pick.res === "P" ? "pushed" : "is still to be graded"}${pick.u ? ` (${sgn(pick.u)}u)` : ""}`);
  else bl.push("no bet");
  add("Bottom line", `${bl.join(", ")}.`);
  return out;
}

// ---------- the archive: every finished game, kept whether or not the algo made a call ----------
// data/games/<SPORT>/<YYYY-MM-DD>.json, written by the background tracker and committed to the repo, so future analysis
// can read our own records next to the routes. Box scores are stored compactly: player rows as [name, pos, starter, ...stats].
const playPick = pl => ({ key: pl.key, market: pl.market, side: pl.side, line: pl.line, odds: pl.odds, label: pl.label, wc: pl.wc, fair: pl.fair, edge: pl.edge, res: pl.res || null, u: pl.u ?? null });
export function archiveGame(F, sport, { league = "", leagueName = "", day = "", date = "", rec = null, rundown = [], review = [], partial = false } = {}) {
  const t = x => ({ id: x.id, abbr: x.abbr, name: x.name, score: x.score, win: x.win, rec: x.rec, lines: x.lines, ...(x.hits != null ? { hits: x.hits, errors: x.errors } : {}) });
  const box = gs => (gs || []).map(g => ({ g: g.name, cols: g.labels, rows: g.rows.map(r => [r.name, r.pos, r.starter ? 1 : 0, ...r.stats]), tot: g.totals || null }));
  return {
    id: String(F.id || ""), sport, league, leagueName, day, date, detail: F.detail || "", venue: F.venue || "", city: F.city || "", att: F.attendance ?? null,
    away: t(F.away), home: t(F.home), stats: (F.teamStats || []).map(s => [s.label, s.a, s.h]), players: { away: box(F.players?.away), home: box(F.players?.home) },
    leaders: F.leaders || { away: [], home: [] }, scoring: F.scoring || [], close: F.lines || null, wp: F.wp || null, ...(F.setText ? { setText: F.setText } : {}),
    call: rec ? { key: rec.key, late: !!rec.late, thin: !!rec.thin, p: rec.p, proj: rec.proj || null, mkt: rec.mkt || null, pick: rec.pick || null, grade: rec.grade || null, plays: (rec.plays || []).map(playPick), pre: rec.pre || null } : null,
    rundown, review, ...(partial ? { partial: true } : {}), archived: new Date().toISOString(),
  };
}
// a final with no summary route (or the route failed): the scoreboard row is all there is; retried on later runs
export function boardFinal(ev, sport) {
  const c = ev?.competitions?.[0]; if (!c) return null;
  const side = ha => { const x = (c.competitors || []).find(k => k.homeAway === ha) || {}, t = x.team || {};
    return { id: String(t.id || x.id || ""), abbr: t.abbreviation || "", name: t.displayName || t.name || "", short: t.shortDisplayName || t.name || "", score: num(x.score), win: x.winner === true,
      rec: (x.records || []).find(r => r.type === "total" || r.name === "overall")?.summary || "", lines: (x.linescores || []).map(l => num(l.displayValue ?? l.value)) }; };
  const st = c.status?.type || ev.status?.type || {};
  return { sport, id: String(ev.id), detail: st.detail || st.shortDetail || "Final", done: st.completed === true, away: side("away"), home: side("home"),
    venue: c.venue?.fullName || "", city: [c.venue?.address?.city, c.venue?.address?.state].filter(Boolean).join(", "), attendance: num(c.attendance),
    teamStats: [], players: { away: [], home: [] }, leaders: { away: [], home: [] }, scoring: [], lines: null, wp: null };
}
