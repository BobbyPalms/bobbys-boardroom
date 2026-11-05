// Two things the user caught on a live college game (Queens at LMU, LMU's first game of the season):
//  1. a team with no completed games got "points per game" = the live score of the game in progress (51), weighted
//     like a season; it must never be read as an average, and the team's history stands in for it;
//  2. the "why" line named the underdog's weak attack as "the biggest driver" and then added the underdog's home edge
//     as a plus. It now says who is favored, which pieces push toward them in points a game, and what works against them.
import { join, dirname } from "path";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { build } from "esbuild";
import { parseScoreboard } from "../src/routes.js";
import { event, competitor } from "./espn_fixtures.mjs";
let pass = 0, fail = 0;
const check = (n, c, d) => { if (c) pass++; else { fail++; console.log("  FAIL:", n, d === undefined ? "" : JSON.stringify(d).slice(0, 500)); } };
const here = dirname(fileURLToPath(import.meta.url)), out = join(mkdtempSync(join(tmpdir(), "bbdrv-")), "engine.mjs");

// ---- 1. the scoreboard never hands over a live score as an average ----
const live = event({ id: "1", state: "in", away: competitor({ id: "2511", abbr: "QUC", name: "Queens University Royals", ha: "away", rec: "1-0", score: "48", avgPoints: 103 }), home: competitor({ id: "2351", abbr: "LMU", name: "Loyola Marymount Lions", ha: "home", rec: "0-0", score: "51", avgPoints: 51 }) });
let g = parseScoreboard({ events: [live] }, "CBB")[0];
check("live game: no per-game average from the scoreboard", g.home.gpg === null && g.away.gpg === null, [g.home.gpg, g.away.gpg]);
const pre0 = event({ id: "2", away: competitor({ id: "1", abbr: "AAA", name: "A", ha: "away", rec: "0-0", avgPoints: 0 }), home: competitor({ id: "3", abbr: "BBB", name: "B", ha: "home", rec: "3-1", avgPoints: 77.5 }) });
g = parseScoreboard({ events: [pre0] }, "CBB")[0];
check("before tip-off: 0-0 team has none, a team that has played keeps ESPN's", g.away.gpg === null && g.home.gpg === 77.5, [g.away.gpg, g.home.gpg]);

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 };
await build({ entryPoints: [join(here, "../src/boardroom.jsx")], bundle: true, platform: "node", format: "esm", outfile: out, jsx: "automatic", loader: { ".jsx": "jsx" }, define: { "process.env.NODE_ENV": '"production"', __BUILD__: '"test"' }, logLevel: "error" });
const { engine: E } = await import(out);
const team = (abbr, record, gpg, gaa, hist, extra = {}) => ({ name: abbr, abbr, record, gpg, gaa, gp: null, has: { gpg: gpg != null, gaa: gaa != null, gk: false, qb: false, rating: false, lineup: false }, prev: {}, hist, xg: {}, goalie: { name: "TBD" }, skaters: [], ...extra });
const lmuHist = [{ y: 2023, gp: 31, gpg: 72.4, gaa: 71.4, lg: 73.5 }, { y: 2024, gp: 32, gpg: 71.2, gaa: 71.6, lg: 73.8 }, { y: 2025, gp: 32, gpg: 74.3, gaa: 72.1, lg: 75.7 }];
const off0 = E.poolSide(team("LMU", "0-0", 51, null, lmuHist), "CBB", 73.5, "off", null);
check("0-0 team: a live score isn't read as their scoring; history stands in (~2% below avg, not 15%+)", off0.r > 0.95 && off0.r < 1.02, off0.r);
const off1 = E.poolSide(team("LMU", "1-0", 51, null, lmuHist), "CBB", 73.5, "off", null);
check("after one real game, it counts as one game", off1.r < off0.r && off1.r > 0.9, [off1.r, off0.r]);

// ---- 2. the "why" line ----
const L = 73.5, part = (off, def) => ({ off: { r: off }, def: { r: def } });
const md = (a, h) => ({ away: { abbr: a, name: a }, home: { abbr: h, name: h } });
const sim = (hw, parts, neutral = false) => ({ homeWin: hw, awayWin: 100 - hw, plan: { L, neutral, parts } });
// away favorite, home dog with a weak offense (the case the user flagged)
let s = E.driverLine(md("QUC", "LMU"), sim(20, { away: part(1.07, 1.06), home: part(0.85, 0.99) }), "CBB");
check("away favorite: says who's favored and why, in points", /^QUC are favored on team strength because of LMU's offense \(15% below average\), worth about 11\.0 pts a game/.test(s), s);
check("away favorite: the underdog's home court works against them", /That outweighs LMU's home court \(about 2\.8 pts a game\)/.test(s) && !/plus the home edge for LMU/.test(s), s);
check("names what works against the favorite", /Working against QUC: QUC's defense \(allows 6% more than average\), about 4\.4 pts a game/.test(s), s);
// home favorite: home court is a plus
s = E.driverLine(md("BOS", "NYK"), sim(70, { away: part(0.98, 1.03), home: part(1.05, 0.97) }), "NBA");
check("home favorite: home court added as a plus", /^NYK are favored on team strength because of NYK's offense \(5% above average\)/.test(s) && /plus home court \(about/.test(s), s);
// soccer and hockey say attack; baseball lineup / pitching
check("soccer says attack", /attack/.test(E.driverLine(md("CHE", "ARS"), sim(60, { away: part(1, 1), home: part(1.2, 0.9) }), "Soccer")));
check("baseball says lineup or pitching", /lineup|pitching/.test(E.driverLine(md("TB", "NYY"), sim(60, { away: part(1, 1), home: part(1.1, 0.9) }), "MLB")));
// evenly matched: no invented driver
s = E.driverLine(md("A", "B"), sim(56, { away: part(1, 1), home: part(1, 1) }), "NBA");
check("even teams: home court is the reason, said plainly", /^B are favored on home court \(about 2\.\d pts a game\); on team strength the two sides grade out about even/.test(s), s);
// live: it's team strength before the game, said so
check("live: framed as team strength before the game", /^On team strength \(before this game\)/.test(E.driverLine({ ...md("QUC", "LMU"), live: { rem: 0.5 } }, sim(20, { away: part(1.07, 1.06), home: part(0.85, 0.99) }), "CBB")));
console.log(`drivers: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
