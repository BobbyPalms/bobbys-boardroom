// Final reports on real ESPN post-game summaries (trimmed copies in tests/fixtures), and the team-by-team learning
// those finished games feed (no network).
import { readFileSync, mkdtempSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { build } from "esbuild";
import { parseFinal, finalRundown, teamStatRows, colOrder } from "../src/postgame.js";
let pass = 0, fail = 0;
const check = (n, c, d) => { if (c) pass++; else { fail++; console.log("  FAIL:", n, d === undefined ? "" : JSON.stringify(d).slice(0, 500)); } };
const here = dirname(fileURLToPath(import.meta.url)), fx = sp => JSON.parse(readFileSync(join(here, "fixtures", `summary_${sp}.json`), "utf8"));

// ---- WNBA: Valkyries 68, Dream 63 ----
let F = parseFinal(fx("WNBA"), "WNBA"), R = finalRundown(F, "WNBA", null, {});
check("WNBA: score and winner", F.away.abbr === "ATL" && F.home.abbr === "GS" && F.home.score === 68 && F.away.score === 63 && F.home.win && !F.away.win, [F.away, F.home]);
check("WNBA: quarters", F.home.lines.join() === "14,10,21,23" && F.away.lines.join() === "12,18,14,19");
check("WNBA: every player's line", F.players.home[0].labels[1] === "PTS" && F.players.home[0].rows.length >= 7 && F.players.home[0].rows.some(r => r.name === "Gabby Williams" && r.stats[1] === "30"), F.players.home[0].rows.map(r => r.name + " " + r.stats[1]));
check("WNBA: comeback and the deciding quarter", /Valkyries beat Dream 68-63/.test(R.paras[0]) && /came back: they were down 30-24 at the half/.test(R.paras[0]) && /3rd quarter decided it: Valkyries won it 21-14/.test(R.paras[0]), R.paras[0]);
check("WNBA: leaders grouped by player", /Gabby Williams 30 pts/.test(R.paras.join(" ")) && /Jordin Canada 18 pts, 5 ast/.test(R.paras.join(" ")));
check("WNBA: where it was won", /shot 38% to 33%/.test(R.paras.join(" ")) && /won the boards 37-35/.test(R.paras.join(" ")));
check("WNBA: against the closing line", /1\.5-point favorites and covered by 3\.5/.test(R.paras.join(" ")) && /combined for 131, under by 11\.5/.test(R.paras.join(" ")), R.paras.at(-1));
check("WNBA: team stats panel picks the readable ones", teamStatRows(F, "WNBA")[0].label === "Field Goal %" && teamStatRows(F, "WNBA").length <= 16);
check("WNBA: points first in the player table", F.players.home[0].labels[colOrder("WNBA", "", F.players.home[0].labels)[0]] === "PTS");

// ---- CFB: Ohio 28 at Akron 20 ----
F = parseFinal(fx("CFB"), "CFB"); R = finalRundown(F, "CFB", null, {});
check("CFB: scoring plays counted", /Bobcats 4 touchdowns and 0 field goals; Zips 1 touchdown and 4 field goals/.test(R.paras.join(" ")), R.paras);
check("CFB: favorite won but didn't cover", /12\.5-point favorites and won but didn't cover \(Zips \+12\.5 cashed\)/.test(R.paras.join(" ")));
check("CFB: stat groups", ["passing", "rushing", "receiving"].every(n => F.players.away.some(g => g.name === n)));

// ---- NHL: Utah 3 at Toronto 2 ----
F = parseFinal(fx("NHL"), "NHL"); R = finalRundown(F, "NHL", null, {});
check("NHL: goals from the plays", F.scoring.length === 5 && /5 goals in all/.test(R.paras.join(" ")));
check("NHL: goalies table", F.players.away.some(g => g.name === "goalies") && colOrder("NHL", "goalies", F.players.away.find(g => g.name === "goalies").labels).length > 0);
check("NHL: singular goal", /Nick Schmaltz 1 goal;/.test(R.paras.join(" ")), R.paras.join(" "));

// ---- Soccer: Galatasaray 2, Stuttgart 0 ----
F = parseFinal(fx("Soccer"), "Soccer"); R = finalRundown(F, "Soccer", null, {});
check("Soccer: goals with minutes", /Galatasaray Alexey Batrakov 12', Alexey Batrakov 15'/.test(R.paras.join(" ")), R.paras);
check("Soccer: box score from the rosters", F.players.home[0].labels.join() === "G,A,SH,SOT,SV,FC,YC,RC" && F.players.home[0].rows.some(r => r.name === "Alexey Batrakov" && r.stats[0] === "2"), F.players.home[0].rows.slice(0, 3));
check("Soccer: percent stats read as percent", teamStatRows(F, "Soccer").find(r => r.label === "Pass Completion %")?.a === "80");
check("Soccer: no fake upset at +100", !/underdog/.test(R.paras.join(" ")));

// ---- MLB: Brewers 4 at Rays 1 ----
F = parseFinal(fx("MLB"), "MLB"); R = finalRundown(F, "MLB", null, {});
check("MLB: runs, hits, errors", F.away.score === 4 && F.away.hits === 8 && F.away.errors === 2 && F.home.hits === 4 && F.away.lines.length === 9);
check("MLB: the 6th decided it", /6th inning decided it: Brewers won it 2-0/.test(R.paras[0]), R.paras[0]);
check("MLB: batting and pitching", F.players.away.some(g => g.name === "batting") && F.players.away.some(g => g.name === "pitching"));

// ---- the algo's call ----
const rec = { p: { a: 0.4, h: 0.6, d: 0 }, proj: { total: 140, margin: 3 }, pick: "x", grade: "A", plays: [{ key: "x", label: "Valkyries -1.5", odds: -110, res: "W", u: 0.909 }], result: { as: 63, hs: 68 } };
F = parseFinal(fx("WNBA"), "WNBA");
R = finalRundown(F, "WNBA", rec, { WNBA: { s: 0.98, h: 1.2, n: 44, teams: { GS: [1.012, 0.991, 9], ATL: [0.988, 1.004, 8] } } });
check("algo: pre-game call and projection", /had Dream 40% and Valkyries 60%, projecting Dream 68.5 – Valkyries 71.5/.test(R.algo[0]) && /right winner/.test(R.algo[0]) && /Total: 131 against 140 projected \(-9\)/.test(R.algo[0]), R.algo[0]);
check("algo: its pick graded", /Its pick: Valkyries -1\.5 at -110 \(grade A\) — WON \(\+0\.9u\)/.test(R.algo[1]), R.algo[1]);
check("algo: what it learned, team by team", /across 44 graded WNBA games/.test(R.algo.at(-1)) && /Valkyries attack ×1\.012, defense ×0\.991 \(9 games\)/.test(R.algo.at(-1)), R.algo.at(-1));
check("algo: a game the tracker never logged says so", /wasn't in the tracker's pre-game log/.test(finalRundown(F, "WNBA", null, {}).algo[0]));

// ---- team-by-team learning in the engine ----
const out = join(mkdtempSync(join(tmpdir(), "bbpg-")), "engine.mjs");
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 };
await build({ entryPoints: [join(here, "../src/boardroom.jsx")], bundle: true, platform: "node", format: "esm", outfile: out, jsx: "automatic", loader: { ".jsx": "jsx" }, define: { "process.env.NODE_ENV": '"production"', __BUILD__: '"test"' }, logLevel: "error" });
const { engine: E } = await import(out);
// 40 NBA games: BOS score 8 more than projected every time; MIL allow 8 more; everyone else on projection
const games = {};
const teams = ["BOS", "MIL", "NYK", "PHI", "DET", "ATL", "CHI", "MIA"];
for (let i = 0; i < 40; i++) {
  const a = teams[i % 8], h = teams[(i + 3) % 8], pa = 110, ph = 112;
  let as = pa, hs = ph;
  if (a === "BOS") as += 8; if (h === "BOS") hs += 8; if (a === "MIL") hs += 8; if (h === "MIL") as += 8;
  games[i] = { sport: "NBA", day: "2026-11-01", neutral: false, home: { abbr: h }, away: { abbr: a }, p: { h: 0.55, a: 0.45 }, proj: { total: pa + ph, margin: ph - pa, rawTotal: pa + ph, rawMargin: ph - pa, tf: { h: 1, a: 1 } }, result: { as, hs } };
}
const L = E.learnFrom(games, "NBA");
check("learning: teams learned from finals", L.teams && L.teams.BOS && L.teams.MIL && L.teams.NYK, L.teams);
check("learning: a team scoring above projection gets a better attack", L.teams.BOS[0] > 1.01 && L.teams.BOS[0] <= 1.04, L.teams.BOS);
check("learning: a team allowing above projection gets a worse defense", L.teams.MIL[1] > 1.01 && L.teams.MIL[1] <= 1.04, L.teams.MIL);
check("learning: teams on projection stay near 1", Math.abs(L.teams.NYK[0] - 1) < 0.012 && Math.abs(L.teams.CHI[1] - 1) < 0.012, [L.teams.NYK, L.teams.CHI]);
check("learning: shrunk by games played and capped at ±4%", Object.values(L.teams).every(([o, d]) => o >= 0.96 && o <= 1.04 && d >= 0.96 && d <= 1.04));
// applied in the plan: same matchup, with and without BOS's learned attack
const team = (abbr, id) => ({ name: abbr, abbr, espnId: id, record: "5-5", gpg: 115, gaa: 113, gp: 10, has: { gpg: true, gaa: true, gk: false, qb: false, rating: false, lineup: false }, prev: {}, hist: [], xg: {}, goalie: { name: "TBD" }, skaters: [] });
const md = { L: 114, home: team("BOS", "2"), away: team("NYK", "18") };
const base = E.buildPlan(md.home, md.away, "NBA", md, { learn: null }), withL = E.buildPlan(md.home, md.away, "NBA", md, { learn: { s: 1, h: 0, n: 40, teams: L.teams } });
check("learning: BOS's learned attack raises their expected score", withL.muH / base.muH > 1.005 && Math.abs(withL.muH / base.muH - L.teams.BOS[0] * L.teams.NYK[1]) < 0.003, [withL.muH, base.muH]);
// no feedback loop: games logged with BOS's adjustment already in the projection teach the same thing, not double
const again = {};
for (const [k, g] of Object.entries(games)) { const tfH = g.home.abbr === "BOS" ? L.teams.BOS[0] : 1, tfA = g.away.abbr === "BOS" ? L.teams.BOS[0] : 1, ph = 112 * tfH, pa = 110 * tfA; again[k] = { ...g, proj: { ...g.proj, total: ph + pa, margin: ph - pa, rawTotal: ph + pa, rawMargin: ph - pa, tf: { h: tfH, a: tfA } } }; }
check("learning: no feedback loop", Math.abs(E.learnFrom(again, "NBA").teams.BOS[0] - L.teams.BOS[0]) < 0.002, [E.learnFrom(again, "NBA").teams.BOS, L.teams.BOS]);
console.log(`postgame: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
