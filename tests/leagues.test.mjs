// Every league ESPN lists is on the site: the catalog, the tabs, the one-call "all" boards, golf / racing leaderboards,
// and the engine on every added head-to-head sport (no network).
import { build } from "esbuild";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { CATALOG } from "../src/leagues.js";
import { ROUTES, TEAM_SPORTS, FIELD_SPORTS, SEASON_START, splitAllBoard, makeBoards, fieldBoard, allBoardUrl, scoreboardUrl, liveBoard, parseScoreboard, leagueName } from "../src/routes.js";
let pass = 0, fail = 0;
const check = (n, c, d) => { if (c) pass++; else { fail++; console.log("  FAIL:", n, d === undefined ? "" : JSON.stringify(d).slice(0, 300)); } };

// ---- every league in the catalog is on exactly one tab, under its own ESPN sport ----
const routed = Object.values(ROUTES).flatMap(r => r.leagues.map(l => `${r.sport}/${l}`));
const listed = Object.entries(CATALOG).flatMap(([sp, rows]) => rows.map(r => `${sp}/${r[0]}`));
check("catalog: 359 leagues across 16 sports with leagues", listed.length === 359 && Object.values(CATALOG).filter(r => r.length).length === 16, listed.length);
check("every catalog league is routed", listed.every(k => routed.includes(k)), listed.filter(k => !routed.includes(k)));
check("no league is routed twice", new Set(routed).size === routed.length);
check("nothing is routed that ESPN doesn't list", routed.every(k => listed.includes(k)), routed.filter(k => !listed.includes(k)));
check("the old tabs keep their leagues (soccer's first 12 are the original list, in order)", ROUTES.Soccer.leagues.slice(0, 12).join() === "eng.1,esp.1,ger.1,ita.1,fra.1,usa.1,mex.1,uefa.champions,uefa.europa,fifa.world,fifa.worldq.uefa,fifa.friendly" && ROUTES.NBA.leagues.join() === "nba" && ROUTES.MMA.leagues[0] === "ufc");
check("every team tab has a season start month", TEAM_SPORTS.every(s => SEASON_START[s] != null));
check("golf and racing are leaderboard tabs", FIELD_SPORTS.join() === "Golf,Racing" && !FIELD_SPORTS.some(s => TEAM_SPORTS.includes(s)));
check("league names come from the catalog", leagueName("Soccer", "eng.fa") === "English FA Cup" && leagueName("RUGBY", "270557") === "United Rugby Championship");

// ---- the "all" board splits back into one board per league ----
const ev = (id, lg, state = "pre") => ({ id, uid: `s:600~l:${lg}~e:${id}`, date: "2026-11-09T20:00Z", status: { type: { state } },
  competitions: [{ id, status: { type: { state } }, competitors: [{ homeAway: "home", team: { id: "1", abbreviation: "HOM", displayName: "Home FC", shortDisplayName: "Home" }, score: "0" }, { homeAway: "away", team: { id: "2", abbreviation: "AWY", displayName: "Away FC", shortDisplayName: "Away" }, score: "0" }] }] });
const ALL = { events: [ev("1", 3918), ev("2", 3918), ev("3", 650), ev("4", 999999)], day: { date: "2026-11-09" } };
const by = splitAllBoard("Soccer", ALL);
check("all board: games land in their league (FA Cup 3918, Colombia 650)", by["eng.fa"]?.events.length === 2 && by["col.1"]?.events.length === 1, Object.keys(by));
check("all board: an unknown league id is left out", Object.keys(by).length === 2);
check("all board: each piece reads like a league's own board", by["eng.fa"].leagues[0].name === "English FA Cup" && liveBoard(by["eng.fa"], "Soccer")[0].league === "English FA Cup");
check("all board: the parser reads it", parseScoreboard(by["col.1"], "Soccer", { league: "col.1" }).length === 1);
check("all board url", allBoardUrl("Soccer", "20261109") === "https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard?dates=20261109&limit=1000");

// boards: one call a day for soccer, one per league for small tabs, the year board stays per-league, fallback to core
let calls = [];
const fake = async url => { calls.push(url); if (url.includes("/all/")) return ALL; return { events: [], leagues: [{ name: "x" }] }; };
const B = makeBoards(fake);
check("soccer: only leagues with games today", (await B.leaguesOn("Soccer", "20261109")).join() === "eng.fa,col.1");
await Promise.all(ROUTES.Soccer.leagues.map(l => B.board("Soccer", l, "20261109")));
check("soccer: 220 boards cost one request", calls.length === 1, calls.length);
check("soccer: a league with no games gets an empty board", (await B.board("Soccer", "eng.1", "20261109")).events.length === 0);
calls = [];
check("small tabs: every league, one call each", (await B.leaguesOn("LAX", "20261109")).length === 4);
await B.board("LAX", "nll", "20261109");
check("small tabs: the league's own scoreboard", calls[0] === scoreboardUrl("LAX", "nll", "20261109"));
calls = [];
await B.board("MMA", "ufc", "2026");
check("MMA year board stays per-league", calls[0] === scoreboardUrl("MMA", "ufc", "2026"));
const down = makeBoards(async url => { if (url.includes("/all/")) throw new Error("down"); return { events: [] }; });
check("all board down: fall back to the tab's core leagues", (await down.leaguesOn("Soccer", "20261109")).length === 12);
check("all board down: a board still comes from the league route", Array.isArray((await down.board("Soccer", "eng.fa", "20261109")).events));

// ---- golf and racing leaderboards ----
const golf = { leagues: [{ name: "PGA TOUR" }], events: [{ id: "9", name: "World Wide Technology Championship", date: "2026-11-05T05:00Z", endDate: "2026-11-08T05:00Z", status: { type: { state: "post", detail: "Final" } },
  competitions: [{ status: { type: { state: "post", detail: "Final" } }, competitors: [
    { order: 2, athlete: { displayName: "Second Guy" }, score: "-20", linescores: [{ value: 67 }, { value: 68 }] },
    { order: 1, athlete: { displayName: "Blades Brown" }, score: "-25", linescores: [{ value: 66 }, { value: 68 }, { value: 68 }, { value: 63 }] }] }] }] };
const g = fieldBoard(golf)[0];
check("golf: leaderboard in finishing order with score to par and rounds", g.rows[0].name === "Blades Brown" && g.rows[0].score === "-25" && g.rows[0].rounds.join() === "66,68,68,63" && g.state === "post" && g.league === "PGA TOUR", g);
const race = { leagues: [{ name: "Formula 1" }], events: [{ id: "5", name: "São Paulo Grand Prix", date: "2026-11-06T15:30Z", status: { type: { state: "post" } }, competitions: [
  { type: { abbreviation: "FP1" }, status: { type: { state: "post" } }, competitors: [{ order: 1, athlete: { displayName: "Practice Leader" } }] },
  { type: { abbreviation: "Qual" }, status: { type: { state: "post" } }, competitors: [{ order: 1, athlete: { displayName: "Pole Sitter" } }] },
  { type: { abbreviation: "Race", text: "Race" }, status: { type: { state: "post", detail: "Final" } }, competitors: [{ order: 2, athlete: { displayName: "Runner Up" } }, { order: 1, athlete: { displayName: "Race Winner" }, winner: true }] }] }] };
const r = fieldBoard(race)[0];
check("racing: the race session once it has run, in finishing order", r.session === "Race" && r.rows[0].name === "Race Winner" && r.rows[0].win === true, r);
const race2 = JSON.parse(JSON.stringify(race)); race2.events[0].competitions[2].status.type.state = "pre";
check("racing: before the race, the latest session that ran (qualifying)", fieldBoard(race2)[0].rows[0].name === "Pole Sitter");

// ---- the engine on every added head-to-head sport ----
const root = join(dirname(fileURLToPath(import.meta.url)), ".."), out = join(mkdtempSync(join(tmpdir(), "bblg-")), "engine.mjs");
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 };
await build({ entryPoints: [join(root, "src/boardroom.jsx")], bundle: true, platform: "node", format: "esm", outfile: out, jsx: "automatic", loader: { ".jsx": "jsx" }, define: { "process.env.NODE_ENV": '"production"', __BUILD__: '"test"' }, logLevel: "warning" });
const { engine: E } = await import(out);
let GP = 10;                                                  // games played: half a season for each sport below
const team = (name, abbr, gpg, gaa) => ({ name, abbr, record: "5-3", gpg, gaa, gp: GP, has: { gpg: true, gaa: true, gk: false, qb: false, rating: false, lineup: false }, prev: {}, hist: [], xg: {}, goalie: { name: "TBD" }, skaters: [] });
for (const sp of ["BASE", "HOOPS", "GRID", "PUCK", "AFL", "RUGBY", "RUGBYL", "LAX", "FHOCKEY", "VOLLEY", "WPOLO"]) {
  GP = Math.round(E.LEAGUE[sp].season / 2);
  const L = E.LEAGUE[sp].L, A = team("Away", "AWY", L, L), H = team("Home", "HOM", L, L);
  const md = { away: A, home: H, league: { gpg: L }, matchInfo: {}, live: null };
  let res = null, err = null;
  try { res = E.runSimulations(H, A, sp, md, 4000, { live: null }); } catch (e) { err = String(e.message || e); }
  const tot = res ? res.avgHome + res.avgAway : NaN;
  check(`${sp}: two even teams simulate, home side a modest favourite, total near the league level`, res && res.homeWin > 45 && res.homeWin < 75 && Math.abs(tot - 2 * L) < 0.35 * 2 * L, err || { h: res.homeWin, tot, L });
  const S = team("Strong", "STR", L * 1.25, L * 0.8), W = team("Weak", "WEA", L * 0.8, L * 1.25);
  const big = E.runSimulations(S, W, sp, { away: W, home: S, league: { gpg: L }, matchInfo: {}, live: null }, 4000, { live: null });
  check(`${sp}: a much stronger home side wins most of the time`, big.homeWin > 70, big.homeWin);
}

console.log(`leagues: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
