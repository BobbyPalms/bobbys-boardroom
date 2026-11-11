// Runs the real data job twice against mocked routes (no network): first run backfills, second is incremental.
import { mkdtempSync, readFileSync, existsSync, readdirSync, statSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
let pass = 0, fail = 0;
const check = (n, c, d) => { if (c) pass++; else { fail++; console.log("  FAIL:", n, d === undefined ? "" : JSON.stringify(d).slice(0, 300)); } };
const here = dirname(fileURLToPath(import.meta.url)), root = join(here, "..");
const dir = mkdtempSync(join(tmpdir(), "bbjob-"));
const mock = join(dir, "mock.mjs");
writeFileSync(mock, `
import { realNBA, standings } from ${JSON.stringify(join(here, "espn_fixtures.mjs"))};
const ok = j => ({ ok: true, status: 200, json: async () => j });
const no = s => ({ ok: false, status: s, json: async () => null });
const tennisDay = d => ({ events: [{ name: "Test Open " + d.slice(0, 4), major: false, date: d, groupings: [{ grouping: { slug: "mens-singles" }, competitions: Array.from({ length: 4 }, (_, i) => ({ id: "t" + d + i, date: d.slice(0,4)+"-"+d.slice(4,6)+"-"+d.slice(6,8)+"T12:00Z", round: { displayName: "R1" },
  status: { type: { state: "post", completed: true } }, competitors: [{ id: "P" + i, order: 0, winner: i % 4 !== 3, athlete: { displayName: "Player " + i } }, { id: "Q" + ((i + Number(d)) % 9), order: 1, winner: i % 4 === 3, athlete: { displayName: "Opp " + i } }] })) }] }] });
globalThis.fetch = async url => {
  const u = new URL(url), p = u.pathname, d = u.searchParams.get("dates");
  if (/standings/.test(p)) { const y = Number(u.searchParams.get("season")); return ok(y >= 2003 ? standings([["2","BOS","Boston Celtics",50,32,9300+y,9000],["15","MIL","Milwaukee Bucks",40,42,9100,9200],["8","DET","Detroit Pistons",30,52,8900,9300],["20","PHI","Philadelphia 76ers",45,37,9200,9100]]) : { children: [] }); }
  if (/summary/.test(p)) return ok({ gameInfo: { officials: [{ displayName: "Sean Wright", position: { displayName: "Referee" } }] } });
  if (/basketball\\/nba\\/scoreboard/.test(p)) { const b = realNBA(); if (d && d < "${new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York"}).format(new Date()).replace(/-/g,"")}") b.events.forEach(e => { e.competitions[0].status.type = { state: "post", completed: true }; e.competitions[0].competitors[0].score = "110"; e.competitions[0].competitors[1].score = "100"; }); return ok(b); }
  if (/tennis/.test(p)) return ok(d && d.length === 8 && Number(d.slice(4,6)) % 2 === 0 ? tennisDay(d) : { events: [] });
  if (/mma\\/ufc\\/scoreboard/.test(p)) {
    if (d && d.length === 4) return ok({ events: Number(d) >= 2020 ? [{ date: d + "-03-01T22:00Z" }] : [], leagues: [{ calendar: [] }] });
    return ok({ events: [{ name: "UFC " + d, date: d.slice(0,4)+"-03-01T22:00Z", competitions: [{ id: "f" + d, type: { abbreviation: "Lightweight" }, format: { regulation: { periods: 3 } }, status: { type: { state: "post", completed: true } },
      competitors: [{ order: 1, winner: true, athlete: { id: "F1", displayName: "Fighter One" }, records: [{ type: "total", summary: "10-1-0" }] }, { order: 2, winner: false, athlete: { id: "F" + d, displayName: "Fighter " + d }, records: [{ type: "total", summary: "5-5-0" }] }] }] }] });
  }
  return no(404);
};`);
const run = () => spawnSync(process.execPath, ["--import", mock, join(root, "scripts/update-data.mjs"), "--sports=NBA,Tennis,MMA", "--all"], { cwd: dir, encoding: "utf8", timeout: 240000 });
const r1 = run();
check("first run succeeds", r1.status === 0, (r1.stderr || "").slice(-400));
const J = p => JSON.parse(readFileSync(join(dir, "data", p), "utf8"));
const H = J("history/NBA.json");
check("history backfilled every season back to the first empty years", H.teams["2"].length >= 20 && H.teams["2"][0][0] <= 2003, H.teams["2"]?.length);
check("history row = [year, gp, gpg, gaa, league avg, league, abbr]", H.teams["2"].every(r => r.length === 7 && r[1] === 82 && r[4] > 0 && r[5] === "nba"));
const off = J("officials/NBA.json");
check("officials logged with finals", Object.values(off).some(g => g.o[0].startsWith("Sean Wright") && g.hs + g.as === 210), off);
check("live board written", Object.keys(J("live/NBA.json").days).length === 3);
check("line snapshots for upcoming games", Object.values(J("lines/NBA.json")).some(a => a.length >= 1));
// the season game log the power ratings are fitted on
const RS = J("results/NBA.json"), rg = Object.values(RS.leagues?.nba?.g || {});
check("season game log: every finished game as [day, home id, away id, home score, away score, neutral, spread, total]", rg.length >= 1 && rg.every(r => r.length === 8 && Number.isInteger(r[0]) && r[3] + r[4] === 210 && RS.leagues.nba.t[r[1]] && RS.leagues.nba.t[r[2]]), [rg.length, rg[0], RS.back]);
check("season game log: backfill from the start of the season is under way", /^\d{8}$/.test(RS.back.day || "") || RS.back.done === true, RS.back);
const shards = readdirSync(join(dir, "data/matches/Tennis"));
check("tennis matches sharded by year, from 2015", shards.includes("2015.json") && shards.length >= 11, shards);
const RT = J("ratings/Tennis.json");
check("tennis ratings fitted and back-tested", RT.fit.matches > 500 && RT.fit.test && RT.fit.test.n > 50 && Object.keys(RT.players).length >= 10, RT.fit);
check("players stored as [name, elo, n, last]", Object.values(RT.players).every(p => p.length === 4 && typeof p[1] === "number"));
const RM = J("ratings/MMA.json");
check("UFC fights back to the first year with events", Object.keys(J("matches/MMA.meta.json").years).length >= 30 && RM.players.F1 && RM.players.F1[2] >= 5, RM.players.F1);
// second run: incremental, unchanged long-term files are not rewritten
const mt = p => statSync(join(dir, "data", p)).mtimeMs, before = { h: mt("history/NBA.json"), m: mt("matches/Tennis/2016.json"), r: mt("ratings/MMA.json") };
const r2 = run();
check("second run succeeds", r2.status === 0, (r2.stderr || "").slice(-400));
const reqs = n => Number((n.stdout.match(/requests (\d+)/) || [])[1]);
const RS2 = J("results/NBA.json");
check("season game log: the backfill moves on each run until it has caught up", RS2.back.done === true || (RS2.back.day || "") > (RS.back.day || ""), [RS.back, RS2.back]);
check("second run is incremental (far fewer requests)", reqs(r2) < reqs(r1) / 5, [reqs(r1), reqs(r2)]);
check("unchanged files are left alone (no churn)", mt("history/NBA.json") === before.h && mt("matches/Tennis/2016.json") === before.m, before);
console.log(`datajob: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
