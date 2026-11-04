import { parseANSplits, parseDKSplits, matchSplit, anSplitsUrl, dkSplitsUrl, liveBoard, parsePower, powerRatios, powerUrl, powerTeamUrl, parseGoalie, athleteStatsUrl, parseQBR, qbrToRating, qbrUrl, parseScoreboard, parseStandings, parseOdds, parseSummary, finalsFrom, leagueAvg, lineMove, amOdds, espnSeason, startYearOf, scoreboardUrl, standingsUrl, ROUTES } from "../src/routes.js";
import { realNBA, standings, event, competitor, odds } from "./espn_fixtures.mjs";
let pass = 0, fail = 0;
const check = (n, c, d) => { if (c) pass++; else { fail++; console.log("  FAIL:", n, d === undefined ? "" : JSON.stringify(d).slice(0, 300)); } };
// odds
check("american odds", amOdds("-130") === -130 && amOdds("+110") === 110 && amOdds("EVEN") === 100 && amOdds("50") === null && amOdds(undefined) === null);
const o = parseOdds(realNBA().events[0].competitions[0].odds[0]);
check("odds: real DET -2.5 board", o.homeML === -130 && o.awayML === 110 && o.awaySpread === 2.5 && o.total === 217.5 && o.awaySpreadOpen === 1.5 && o.totalOpen === 219.5 && o.homeSpreadOdds === -111 && o.overOdds === -107, o);
check("odds: spread from the home line when no pointSpread", parseOdds({ spread: 9.5, overUnder: 37.5 }).awaySpread === -9.5);
check("odds: soccer draw price", parseOdds(odds({ homeML: 150, awayML: 180, homeLine: -0.5, total: 2.5, draw: 300 })).drawML === 300);
const mv = lineMove(parseOdds(realNBA().events[1].competitions[0].odds[0]), 12);
check("line move: BOS -14.5 -> -11.5 is a 3-pt move toward MIL (steam)", mv.spreadMove === -3 && mv.steam === true && mv.sharp === "away", mv);
// standings
const S = parseStandings(standings([["2", "BOS", "Boston Celtics", 61, 21, 9600, 8900, true], ["15", "MIL", "Milwaukee Bucks", 48, 34, 9500, 9400], ["8", "DET", "Detroit Pistons", 44, 38, 9300, 9250], ["20", "PHI", "Philadelphia 76ers", 24, 58, 8800, 9300], ["1", "ATL", "Atlanta Hawks", 40, 42, 9700, 9800]]));
check("standings: nested groups walked, all teams", Object.keys(S).length === 5);
check("standings: per-game from totals", Math.abs(S["15"].gpg - 9500 / 82) < 1e-9 && S["15"].gp === 82);
check("standings: avg fields used when present", Math.abs(S["2"].gpg - 9600 / 82) < 1e-9);
check("standings: zero rows (old seasons) dropped", Object.keys(parseStandings(standings([["9", "X", "X", 0, 0, 0, 0]]))).length === 0);
check("league average", Math.abs(leagueAvg(S) - Object.values(S).reduce((a, t) => a + t.gpg, 0) / 5) < 1e-9);
// scoreboard -> slate games
const hist = { "8": [{ y: 2024, gp: 82, gpg: 112, gaa: 109, lg: 114 }] };
const G = parseScoreboard(realNBA(), "NBA", { standings: { cur: S, prev: S }, hist, lg: 114.2, sdM: 12, league: "nba" });
check("scoreboard: both games", G.length === 2);
const g = G[0];
check("scoreboard: teams, ids, records", g.away.abbr === "PHI" && g.home.abbr === "DET" && g.home.id === "8" && g.away.rec === "7-1");
check("scoreboard: standings scoring attached", Math.abs(g.away.gpg - 8800 / 82) < 1e-9 && g.away.gp === 82 && Math.abs(g.away.pgpg - 8800 / 82) < 1e-9);
check("scoreboard: history attached by team id", g.home.hist.length === 1 && g.away.hist.length === 0);
check("scoreboard: market + no splits", g.mkt.awayML === 110 && g.mkt.total === 217.5 && g.mkt.pubAwayPct === null);
check("scoreboard: ET time and dome", /PM ET$/.test(g.time) && g.wx.dome === true);
check("scoreboard: falls back to the board's own avgPoints with no standings", parseScoreboard(realNBA(), "NBA").find(x => x.home.abbr === "DET").home.gpg === 111.9);
// MLB probable with ERA, outdoor weather
const mlb = { events: [event({ id: "1", indoor: false, weather: { temperature: 61, displayValue: "Light Rain" },
  away: competitor({ id: "30", abbr: "TB", name: "Tampa Bay Rays", ha: "away", probables: [{ athlete: { displayName: "Drew Rasmussen" }, statistics: [{ name: "ERA", displayValue: "3.53" }] }] }),
  home: competitor({ id: "11", abbr: "ATH", name: "Athletics", ha: "home", probables: [{ athlete: { displayName: "J. Doe" }, statistics: [{ name: "ERA", displayValue: "6.10" }] }] }) })] };
const m = parseScoreboard(mlb, "MLB")[0];
check("MLB: probable starter and ERA", m.away.gk === "Drew Rasmussen" && m.away.gks === 3.53 && m.home.gks === 6.1);
check("MLB: weather temp + rain", m.wx.tempF === 61 && m.wx.precip === "rain" && m.wx.dome === false);
// soccer form -> last 5
const soc = parseScoreboard({ events: [event({ id: "2", away: competitor({ id: "1", abbr: "EVE", name: "Everton", ha: "away", form: "WWLLD" }), home: competitor({ id: "2", abbr: "COV", name: "Coventry", ha: "home" }) })] }, "Soccer")[0];
check("soccer: form string -> W/L", soc.away.l5w === 2 && soc.away.l5l === 2);
// summary
const sum = parseSummary({ gameInfo: { officials: [{ displayName: "Lance Barrett", position: { displayName: "Home Plate Umpire" } }] },
  injuries: [{ team: { abbreviation: "ATL" }, injuries: [{ status: "Out", athlete: { displayName: "Jock Landale", position: { abbreviation: "C" } } }, { status: "Active", athlete: { displayName: "Fine Guy" } }] }],
  seasonseries: [{ summary: "Series tied 1-1" }], againstTheSpread: [{ team: { abbreviation: "LAL" }, records: [{ name: "ATS", summary: "5-3-0" }] }] });
check("summary: officials with role", sum.officials[0].name === "Lance Barrett" && /Home Plate/.test(sum.officials[0].role));
check("summary: only real injury statuses", sum.injuries.length === 1 && sum.injuries[0].name === "Jock Landale");
check("summary: season series + ATS", sum.seasonSeries === "Series tied 1-1" && sum.ats[0].records[0] === "ATS 5-3-0");
// finals
const fin = finalsFrom({ events: [event({ id: "9", completed: true, state: "post", away: competitor({ id: "1", abbr: "A", name: "A", ha: "away", score: "101" }), home: competitor({ id: "2", abbr: "H", name: "H", ha: "home", score: "99" }) }), realNBA().events[0]] });
check("finals: only completed games", fin.length === 1 && fin[0].as === 101 && fin[0].hs === 99);
// season labels + urls
check("season labels: NBA 2026-27 = ESPN 2027", espnSeason("NBA", 2026) === 2027 && startYearOf("NHL", 2027) === 2026 && espnSeason("MLB", 2026) === 2026);
check("urls", scoreboardUrl("CBB", "mens-college-basketball", "20261104").endsWith("scoreboard?dates=20261104&groups=50&limit=500") && standingsUrl("NBA", "nba", 2025) === "https://site.api.espn.com/apis/v2/sports/basketball/nba/standings?season=2025");
check("every app sport has routes incl. WNBA, NCAAW, tennis, MMA", ["MLB", "NFL", "CFB", "NBA", "WNBA", "CBB", "CBBW", "NHL", "Soccer", "Tennis", "MMA"].every(k => ROUTES[k]));
// QBR: real core-route shape (season totals with athlete/team refs) and the QB from the day's passing leader
const Q = parseQBR({ items: [{ athlete: { $ref: "http://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2026/athletes/8439?lang=en" }, team: { $ref: "http://x/teams/23?lang=en" }, splits: { categories: [{ stats: [{ name: "qbr", value: 44.77 }, { name: "schedAdjQBR", value: 49.23 }] }] } }] });
check("QBR parsed by team, schedule-adjusted preferred", Q["23"][0].ath === "8439" && Q["23"][0].qbr === 49.23);
check("QBR -> rating scale (55 = 72 average starter)", qbrToRating(55) === 72 && qbrToRating(75) === 88 && qbrToRating(10) === 60);
check("QBR url", qbrUrl("NFL", 2026).endsWith("/football/leagues/nfl/seasons/2026/types/2/groups/9/qbr/0?limit=300") && /college-football.*groups\/80/.test(qbrUrl("CFB", 2026)));
const nflB = { events: [event({ id: "n1", away: competitor({ id: "29", abbr: "CAR", name: "Carolina Panthers", ha: "away" }), home: competitor({ id: "9", abbr: "GB", name: "Green Bay Packers", ha: "home" }) })] };
nflB.events[0].competitions[0].leaders = [{ name: "passingYards", leaders: [{ displayValue: "30/41, 288 YDS", athlete: { id: "4036378", displayName: "Jordan Love" }, team: { id: "9" } }] }];
const ng = parseScoreboard(nflB, "NFL")[0];
check("QB named from the passing leader", ng.home.qbId === "4036378" && ng.home.gk === "Jordan Love" && !ng.away.qbId);
// NHL goalie: real player-stats shape (Bobrovsky 2026-27: savePct .885, 10 starts)
const gk = parseGoalie({ splits: { categories: [{ stats: [{ name: "avgGoalsAgainst", value: 3.285 }, { name: "savePct", value: 0.885 }, { name: "gameStarted", value: 10 }] }] } });
check("goalie stats parsed", gk.sv === 0.885 && gk.gaa === 3.285 && gk.gs === 10, gk);
check("goalie with no starts yet -> null", parseGoalie({ splits: { categories: [{ stats: [{ name: "savePct", value: 0 }] }] } }) === null);
check("player stats url", athleteStatsUrl("NHL", 2027, "5571") === "https://sports.core.api.espn.com/v2/sports/hockey/leagues/nhl/seasons/2027/types/2/athletes/5571/statistics");
const nhlB = { events: [event({ id: "h1", away: competitor({ id: "129764", abbr: "UTA", name: "Utah Mammoth", ha: "away", probables: [{ athlete: { id: "999", displayName: "Sebastian Cossa" }, statistics: [] }] }), home: competitor({ id: "21", abbr: "TOR", name: "Toronto Maple Leafs", ha: "home" }) })] };
check("probable goalie id kept for the stats lookup", parseScoreboard(nhlB, "NHL")[0].away.gkId === "999");
// power index: per-team BPI (real 2026-27 shape), NBA list, CFB FPI predictives
const one = parsePower({ team: { $ref: "http://x/seasons/2027/teams/2287?lang=en" }, stats: [{ name: "bpi", value: 3.9098 }, { name: "bpioffense", value: 1.7851 }, { name: "bpidefense", value: 2.1247 }] });
check("per-team BPI parsed", Math.abs(one["2287"].off - 1.7851) < 1e-9 && Math.abs(one["2287"].def - 2.1247) < 1e-9);
const list = parsePower({ items: [{ team: { $ref: "http://x/teams/24?lang=en" }, stats: [{ name: "bpi", value: 8.309 }, { name: "bpioffense", value: 3.703 }, { name: "bpidefense", value: 4.606 }] }, { team: { $ref: "http://x/teams/87?lang=en" }, predictives: [{ name: "fpi", value: 26.817 }] }] });
check("BPI list + FPI predictives", list["24"].net === 8.309 && list["87"].off === 26.817 / 2 && list["87"].def === 26.817 / 2);
const pr = powerRatios({ off: 3.7, def: 4.6 }, 115);
check("power -> ratios (better defence = lower ratio)", Math.abs(pr.offRating - 118.7 / 115) < 1e-12 && pr.defRating < 1);
check("power urls", powerUrl("CBB", 2027).includes("mens-college-basketball/seasons/2027/powerindex") && powerTeamUrl("CBBW", 2027, "2287").endsWith("womens-college-basketball/seasons/2027/powerindex/2287") && powerUrl("MLB", 2026) === null);
// live scores
{
  const b = realNBA(); const c = b.events[0].competitions[0];
  c.status.type = { state: "in", completed: false, shortDetail: "Q3 5:12" }; c.competitors.forEach((x, i) => { x.score = i ? "71" : "68"; });
  const L = liveBoard(b, "NBA"), r = L.find(x => x.id === b.events[0].id);
  check("live: team game row", L.length === b.events.length && r.state === "in" && r.detail === "Q3 5:12" && r.away.abbr === "PHI" && r.home.abbr === "DET" && r.away.score !== "" && r.home.score !== "", r);
  check("live: no score before the start", L.filter(x => x.state === "pre").every(x => x.away.score === "" && x.home.score === ""));
  const t = liveBoard({ events: [{ name: "Paris", groupings: [{ grouping: { slug: "mens-singles" }, competitions: [{ id: "m1", date: "2026-11-03T15:00Z", round: { displayName: "Round 2" }, status: { type: { state: "in", shortDetail: "3rd Set" } },
    competitors: [{ order: 0, athlete: { displayName: "A Player" }, linescores: [{ value: 6 }, { value: 3 }] }, { order: 1, athlete: { displayName: "B Player" }, linescores: [{ value: 4 }, { value: 6 }] }] }] },
    { grouping: { slug: "mens-doubles" }, competitions: [{ id: "d1", competitors: [{}, {}] }] }] }] }, "Tennis");
  check("live: tennis singles with set scores, doubles skipped", t.length === 1 && t[0].away.score === "6 3" && t[0].home.score === "4 6" && t[0].league === "Paris" && t[0].note === "Round 2", t);
  const m = liveBoard({ events: [{ name: "UFC 999", competitions: [{ id: "f1", date: "2026-11-07T22:00Z", type: { abbreviation: "LW" }, status: { type: { state: "post", completed: true, shortDetail: "Final" } },
    competitors: [{ order: 1, winner: true, athlete: { displayName: "Fighter One" } }, { order: 2, winner: false, athlete: { displayName: "Fighter Two" } }] }] }] }, "MMA");
  check("live: MMA bout with the winner", m.length === 1 && m[0].away.win && !m[0].home.win && m[0].state === "post" && m[0].note === "LW", m);
}
// public betting splits
{
  const bi = (t, m) => ({ tickets: { percent: t }, money: { percent: m } });
  const an = parseANSplits({ games: [{ start_time: "2026-11-05T00:00:00.000Z", away_team_id: 1, home_team_id: 2,
    teams: [{ id: 1, abbr: "PHI", full_name: "Philadelphia 76ers", short_name: "76ers", location: "Philadelphia" }, { id: 2, abbr: "DET", full_name: "Detroit Pistons", short_name: "Pistons", location: "Detroit" }],
    markets: { "15": { event: { moneyline: [{ side: "away", odds: 110, bet_info: bi(65, 64) }, { side: "home", odds: -130, bet_info: bi(35, 36) }],
      spread: [{ side: "away", value: 2.5, odds: -110, bet_info: bi(67, 61) }, { side: "home", value: -2.5, odds: -110, bet_info: bi(33, 39) }],
      total: [{ side: "over", value: 217.5, odds: -110, bet_info: bi(84, 81) }, { side: "under", value: 217.5, odds: -110, bet_info: bi(16, 19) }] } } } },
    { start_time: "2026-11-05T00:00:00.000Z", away_team_id: 3, home_team_id: 4, teams: [{ id: 3, abbr: "X" }, { id: 4, abbr: "Y" }], markets: { "15": { event: { moneyline: [{ side: "away", bet_info: bi(0, 0) }] } } } }] });
  check("splits (Action Network): bets + money for ML, spread, total; empty games dropped", an.length === 1 && an[0].ml.a.join() === "65,64" && an[0].sp.line === 2.5 && an[0].sp.h.join() === "33,39" && an[0].tot.o.join() === "84,81" && an[0].tot.line === 217.5, an);
  const html = `<div class="tb-se x"><h5 class="tb-se-title-new"><a><img/> JAX Jaguars @ <img/>BAL Ravens </a></h5><span class="t">Thu 11/5 · 8:15 PM ET</span>
    <div>Moneyline </div><div>BAL Ravens</div><div>+410 </div><div>27% </div><div>11% </div><div>JAX Jaguars</div><div>&#8722;550 </div><div>73% </div><div>89% </div>
    <div>Spread </div><div>JAX Jaguars -10</div><div>&#8722;108 </div><div>90% </div><div>81% </div><div>BAL Ravens +10</div><div>&#8722;112 </div><div>10% </div><div>19% </div>
    <div>Total </div><div>Over 40.5</div><div>&#8722;108 </div><div>22% </div><div>47% </div><div>Under 40.5</div><div>&#8722;112 </div><div>78% </div><div>53% </div></div>
    <div class="tb-se y"><h5 class="tb-se-title-new">Everton vs Coventry</h5><span>Fri 11/6 · 3:00 PM ET</span><div>Moneyline </div><div>Everton</div><div>&#8722;140 </div><div>97% </div><div>95% </div><div>Draw</div><div>+260 </div><div>2% </div><div>3% </div><div>Coventry</div><div>+360 </div><div>1% </div><div>2% </div></div>`;
  const dk = parseDKSplits(html, new Date("2026-11-03T12:00:00Z"));
  const j = dk[0], e = dk[1];
  check("splits (DraftKings): bets = Bets column, money = Handle column", j && j.ml.a.join() === "89,73" && j.ml.h.join() === "11,27" && j.sp.line === -10 && j.sp.a.join() === "81,90" && j.tot.o.join() === "47,22" && j.tot.line === 40.5, j);
  check("splits (DraftKings): ET start time to ISO (EST in November)", j && j.t === "2026-11-06T01:15:00.000Z", j?.t);
  check("splits (DraftKings): soccer 'Home vs Away' with a draw", e && e.h.name === "Everton" && e.a.name === "Coventry" && e.ml.h.join() === "95,97" && e.ml.d.join() === "3,2", e);
  const g = { date: "2026-11-06T01:15Z", away: { abbr: "JAX", name: "Jacksonville Jaguars" }, home: { abbr: "BAL", name: "Baltimore Ravens" } };
  const m1 = matchSplit(g, dk);
  check("match: ESPN game to splits by teams + start", m1 && m1.src === "DraftKings" && m1.sp.a.join() === "81,90", m1);
  const flip = matchSplit({ ...g, away: g.home, home: g.away }, dk);
  check("match: sides swapped when the source lists them the other way", flip && flip.sp.h.join() === "81,90" && flip.sp.line === 10, flip);
  check("match: a different day doesn't match", matchSplit({ ...g, date: "2026-11-09T01:15Z" }, dk) === null);
  check("match: different teams don't match", matchSplit({ ...g, away: { abbr: "NE", name: "New England Patriots" } }, dk) === null);
  const z = parseANSplits({ games: [{ start_time: "2026-11-05T00:00:00.000Z", away_team_id: 1, home_team_id: 2, teams: [{ id: 1, abbr: "CHI" }, { id: 2, abbr: "FLA" }],
    markets: { "15": { event: { moneyline: [{ side: "away", bet_info: bi(21, 26) }, { side: "home", bet_info: bi(79, 74) }], spread: [{ side: "away", value: 1.5, bet_info: bi(0, 0) }, { side: "home", value: -1.5, bet_info: bi(0, 0) }] } } } }] });
  check("splits: a market with no posted numbers (all 0%) is left empty, not shown as 0 / 100", z.length === 1 && z[0].sp.a === null && z[0].sp.h === null && z[0].ml.a.join() === "21,26", z);
  const mix = matchSplit({ date: "2026-11-05T00:30Z", away: { abbr: "CHI", name: "Chicago Blackhawks" }, home: { abbr: "FLA", name: "Florida Panthers" } },
    [...z.map(x => ({ ...x, a: { abbr: "CHI", name: "Chicago Blackhawks", nick: "Blackhawks", loc: "Chicago" }, h: { abbr: "FLA", name: "Florida Panthers", nick: "Panthers", loc: "Florida" }, src: "Action Network", t: "2026-11-05T00:30:00.000Z", tot: { line: null, o: null, u: null } })),
     { src: "DraftKings", t: "2026-11-05T00:40:00.000Z", a: { abbr: "CHI", name: "CHI Blackhawks", nick: "Blackhawks" }, h: { abbr: "FLA", name: "FLA Panthers", nick: "Panthers" }, ml: { a: [15, 6], h: [85, 94], d: null }, sp: { line: 1.5, a: [17, 0], h: [83, 100] }, tot: { line: 5.5, o: [60, 70], u: [40, 30] } }]);
  check("match: a market one source hasn't posted comes from the other", mix && mix.ml.a.join() === "21,26" && mix.sp.a.join() === "17,0" && mix.tot.o.join() === "60,70" && mix.src === "Action Network + DraftKings", mix);
  check("splits urls", anSplitsUrl("CBB", "20261103").includes("ncaab?bookIds=15&periods=event&date=20261103&division=D1") && dkSplitsUrl("42648", "today", 2).endsWith("tb_eg=42648&tb_edate=today&tb_page=2") && anSplitsUrl("Tennis", "x") === null);
}
console.log(`routes: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
