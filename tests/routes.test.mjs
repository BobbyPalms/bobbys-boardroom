import { parseQBR, qbrToRating, qbrUrl, parseScoreboard, parseStandings, parseOdds, parseSummary, finalsFrom, leagueAvg, lineMove, amOdds, espnSeason, startYearOf, scoreboardUrl, standingsUrl, ROUTES } from "../src/routes.js";
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
console.log(`routes: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
