// ESPN-shaped responses built from real captured structure (NBA board 2026-11-04, MLB probables, soccer draw odds,
// NBA 2024-25 standings) so the parsers are tested on what the routes actually return.
export const side = (o, c) => o == null ? undefined : { close: { odds: String(o), ...(c || {}) }, open: { odds: String(o), ...(c || {}) } };
export function competitor({ id, abbr, name, ha, rec = "6-1", score = "0", probables, form, avgPoints }) {
  return { id, type: "team", homeAway: ha, team: { id, abbreviation: abbr, displayName: name, color: "1d428a" }, score,
    statistics: avgPoints != null ? [{ name: "avgPoints", displayValue: String(avgPoints) }] : [], records: [{ name: "overall", type: "total", summary: rec }], ...(probables ? { probables } : {}), ...(form ? { form } : {}) };
}
export function event({ id, date = "2026-11-05T00:00Z", away, home, state = "pre", completed = false, neutral = false, odds, indoor = true, weather, venue = "Arena" }) {
  return { id, date, name: `${away.team.displayName} at ${home.team.displayName}`, ...(weather ? { weather } : {}),
    competitions: [{ id, date, neutralSite: neutral, venue: { fullName: venue, indoor }, competitors: [home, away],
      status: { type: { state, completed, name: completed ? "STATUS_FINAL" : "STATUS_SCHEDULED", shortDetail: completed ? "Final" : "7:00 PM EST" } }, ...(odds ? { odds: [odds] } : {}) }],
    status: { type: { state, completed } } };
}
export function odds({ homeML, awayML, homeLine, total, openHomeLine, openTotal, draw }) {
  const fl = v => (v > 0 ? "+" : "") + v;
  return { provider: { name: "DraftKings" }, details: "x", overUnder: total, spread: homeLine,
    moneyline: { home: { close: { odds: fl(homeML) }, open: { odds: fl(homeML) } }, away: { close: { odds: fl(awayML) }, open: { odds: fl(awayML) } } },
    pointSpread: { home: { close: { line: fl(homeLine), odds: "-111" }, open: { line: fl(openHomeLine ?? homeLine), odds: "-110" } }, away: { close: { line: fl(-homeLine), odds: "-109" }, open: { line: fl(-(openHomeLine ?? homeLine)), odds: "-110" } } },
    total: { over: { close: { line: "o" + total, odds: "-107" }, open: { line: "o" + (openTotal ?? total), odds: "-110" } }, under: { close: { line: "u" + total, odds: "-113" }, open: { line: "u" + (openTotal ?? total), odds: "-110" } } },
    ...(draw ? { drawOdds: { moneyLine: draw } } : {}) };
}
export const realNBA = () => ({ events: [
  event({ id: "401909922", away: competitor({ id: "20", abbr: "PHI", name: "Philadelphia 76ers", ha: "away", rec: "7-1", avgPoints: 110.9 }), home: competitor({ id: "8", abbr: "DET", name: "Detroit Pistons", ha: "home", rec: "6-1", avgPoints: 111.9 }),
    odds: odds({ homeML: -130, awayML: 110, homeLine: -2.5, total: 217.5, openHomeLine: -1.5, openTotal: 219.5 }) }),
  event({ id: "401909924", date: "2026-11-05T00:30Z", away: competitor({ id: "15", abbr: "MIL", name: "Milwaukee Bucks", ha: "away", rec: "1-6" }), home: competitor({ id: "2", abbr: "BOS", name: "Boston Celtics", ha: "home", rec: "5-2" }),
    odds: odds({ homeML: -514, awayML: 391, homeLine: -11.5, total: 223.5, openHomeLine: -14.5, openTotal: 225.5 }) }),
] });
export function standings(rows) {   // rows: [id, abbr, name, w, l, pf, pa, {avg}] -> /apis/v2 standings shape
  const st = r => [["wins", r[3]], ["losses", r[4]], ["pointsFor", r[5]], ["pointsAgainst", r[6]], ...(r[7] ? [["avgPointsFor", r[5] / (r[3] + r[4])], ["avgPointsAgainst", r[6] / (r[3] + r[4])]] : [])].map(([name, value]) => ({ name, value }));
  return { children: [{ name: "Conf A", standings: { entries: rows.slice(0, Math.ceil(rows.length / 2)).map(r => ({ team: { id: r[0], abbreviation: r[1], displayName: r[2] }, stats: st(r) })) } },
    { name: "Conf B", children: [{ standings: { entries: rows.slice(Math.ceil(rows.length / 2)).map(r => ({ team: { id: r[0], abbreviation: r[1], displayName: r[2] }, stats: st(r) })) } }] }] };
}
