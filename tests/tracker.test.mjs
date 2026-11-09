// The background tracker against mocked routes (no network): run 1 logs today's NBA board, then the games are
// moved to yesterday as if they'd been played, and run 2 grades them from the final scores and learns.
import { mkdtempSync, readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync, cpSync, symlinkSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
let pass = 0, fail = 0;
const check = (n, c, d) => { if (c) pass++; else { fail++; console.log("  FAIL:", n, d === undefined ? "" : JSON.stringify(d).slice(0, 400)); } };
const here = dirname(fileURLToPath(import.meta.url)), root = join(here, "..");
const dir = mkdtempSync(join(tmpdir(), "bbtrack-"));
cpSync(join(root, "src"), join(dir, "src"), { recursive: true });
cpSync(join(root, "scripts"), join(dir, "scripts"), { recursive: true });
symlinkSync(join(root, "node_modules"), join(dir, "node_modules"));
writeFileSync(join(dir, "package.json"), readFileSync(join(root, "package.json")));
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const yday = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(Date.now() - 864e5));
const mock = join(dir, "mock.mjs");
writeFileSync(mock, `
import { realNBA, standings, event, competitor } from ${JSON.stringify(join(here, "espn_fixtures.mjs"))};
const ok = j => ({ ok: true, status: 200, json: async () => j });
const no = s => ({ ok: false, status: s, json: async () => null });
const T = "${today.replace(/-/g, "")}";
globalThis.fetch = async url => {
  const u = new URL(url), p = u.pathname, d = u.searchParams.get("dates");
  if (/basketball\\/nba\\/standings/.test(p)) return ok(standings([["2","BOS","Boston Celtics",5,2,820,760,true],["15","MIL","Milwaukee Bucks",1,6,760,820],["8","DET","Detroit Pistons",6,1,783,750],["20","PHI","Philadelphia 76ers",7,1,887,840]]));
  if (/basketball\\/nba\\/scoreboard/.test(p)) {
    if (!d || d > T) return ok({ events: [] });
    const b = realNBA();
    b.events.forEach((e, i) => {
      e.date = e.competitions[0].date = new Date(Date.now() + (i + 1) * 3600e3).toISOString();
      if (d < T) { e.competitions[0].status.type = { state: "post", completed: true }; e.competitions[0].competitors[0].score = "112"; e.competitions[0].competitors[1].score = "104"; }
    });
    return ok(b);
  }
  // a Division II women's game that finished without ever being logged (no standings for either side)
  if (/womens-college-basketball\\/scoreboard/.test(p)) {
    if (d !== T) return ok({ events: [] });
    const ev = event({ id: "9001", date: new Date(Date.now() - 3 * 3600e3).toISOString(), state: "post", completed: true,
      away: competitor({ id: "501", abbr: "PCC", name: "Pensacola Christian Eagles", ha: "away", rec: "1-3", score: "58" }),
      home: competitor({ id: "502", abbr: "UWF", name: "West Florida Argonauts", ha: "home", rec: "2-1", score: "85" }) });
    ev.competitions[0].competitors[0].winner = true;
    return ok({ events: [ev], leagues: [{ name: "NCAA Women's Basketball" }] });
  }
  if (/womens-college-basketball\\/summary/.test(p)) return ok({ header: { id: "9001", competitions: [{ status: { type: { completed: true, detail: "Final" } }, competitors: [
      { homeAway: "home", score: "85", winner: true, team: { id: "502", abbreviation: "UWF", displayName: "West Florida Argonauts" }, linescores: [{ value: 15 }, { value: 19 }, { value: 36 }, { value: 15 }], record: [{ type: "total", summary: "2-1" }] },
      { homeAway: "away", score: "58", winner: false, team: { id: "501", abbreviation: "PCC", displayName: "Pensacola Christian Eagles" }, linescores: [{ value: 18 }, { value: 8 }, { value: 14 }, { value: 18 }], record: [{ type: "total", summary: "1-3" }] }] }] },
    boxscore: { teams: [{ team: { id: "501" }, statistics: [{ name: "fieldGoalPct", label: "Field Goal %", displayValue: "37" }, { name: "totalRebounds", label: "Rebounds", displayValue: "29" }] },
                        { team: { id: "502" }, statistics: [{ name: "fieldGoalPct", label: "Field Goal %", displayValue: "48" }, { name: "totalRebounds", label: "Rebounds", displayValue: "46" }] }],
      players: [{ team: { id: "502" }, statistics: [{ name: "", labels: ["MIN", "PTS"], athletes: [{ athlete: { displayName: "Janai Jordan" }, starter: true, stats: ["30", "20"] }] }] }] },
    leaders: [], gameInfo: { venue: { fullName: "UWF Field House", address: { city: "Pensacola", state: "FL" } }, attendance: 734 } });
  return no(404);
};`);
const run = () => spawnSync(process.execPath, ["--import", mock, join(dir, "scripts/track.mjs")], { cwd: dir, encoding: "utf8", timeout: 240000 });
const load = () => { const g = {}; const D = join(dir, "data/track"); if (existsSync(D)) for (const sp of readdirSync(D)) for (const f of readdirSync(join(D, sp))) Object.assign(g, JSON.parse(readFileSync(join(D, sp, f), "utf8")).games); return g; };

const r1 = run();
check("run 1 succeeds", r1.status === 0, (r1.stderr || r1.stdout || "").slice(-600));
let g = load();
const nba = Object.values(g).filter(x => x.sport === "NBA");
check("today's NBA board logged before tip-off", nba.length >= 2 && nba.every(x => !x.result && x.p && x.proj && x.plays.length), nba.length);
check("each game logged under its own day", nba.every(x => /^\d{4}-\d\d-\d\d$/.test(x.day)));
check("learned.json written", existsSync(join(dir, "data/learned.json")));

// time passes: the games were played yesterday
for (const sp of readdirSync(join(dir, "data/track"))) for (const f of readdirSync(join(dir, "data/track", sp))) {
  const p = join(dir, "data/track", sp, f), j = JSON.parse(readFileSync(p, "utf8"));
  for (const x of Object.values(j.games)) { x.day = yday; x.time = "7:00 PM ET"; }
  writeFileSync(p, JSON.stringify(j));
}
const r2 = run();
check("run 2 succeeds", r2.status === 0, (r2.stderr || r2.stdout || "").slice(-600));
g = load();
const done = Object.values(g).filter(x => x.sport === "NBA" && x.result);
check("played games graded from the final score", done.length >= 2 && done.every(x => x.result.as + x.result.hs === 216 && Math.abs(x.result.hs - x.result.as) === 8), done.map(x => x.result));
check("graded plays carry W/L", done.every(x => x.plays.every(pl => pl.res === "W" || pl.res === "L" || pl.res === "P")));
const L = JSON.parse(readFileSync(join(dir, "data/learned.json"), "utf8"));
check("learned.json carries stats and per-sport learning", L.stats?.NBA?.graded >= 2 && L.sports?.NBA && typeof L.sports.NBA.n === "number", L.stats?.NBA);
check("records split by sport and month", readdirSync(join(dir, "data/track/NBA")).every(f => /^\d{4}-\d\d\.json$/.test(f)));
// every finished game gets a call, and every finished game is archived (call or not)
const cbbw = Object.values(g).find(x => x.sport === "CBBW" && x.away.abbr === "PCC" && x.home.abbr === "UWF");
check("a final the tracker never logged gets its call rebuilt, graded and marked late", cbbw && cbbw.late === true && cbbw.result && cbbw.result.as === 58 && cbbw.result.hs === 85 && cbbw.proj?.rawTotal > 0, cbbw);
check("a no-data game is logged thin with its pre-game reasoning, and never offered as a bet", cbbw && cbbw.thin === true && cbbw.pick == null && cbbw.pre && cbbw.pre.sd?.length === 2, cbbw && { thin: cbbw.thin, pick: cbbw.pick, pre: !!cbbw.pre });
const arch = sp => { const D = join(dir, "data/games", sp), out = {}; if (existsSync(D)) for (const f of readdirSync(D)) Object.assign(out, JSON.parse(readFileSync(join(D, f), "utf8")).games); return out; };
const A1 = arch("CBBW")["9001"];
check("every finished game is archived with its box score, rundown and the algo's review", A1 && A1.home.score === 85 && A1.stats.length === 2 && A1.players.home[0].rows[0][0] === "Janai Jordan" && A1.att === 734 && A1.rundown.length > 0 && A1.review.length >= 5 && A1.call?.late === true, A1 && { stats: A1.stats, review: A1.review.map(x => x.title) });
check("the review mirrors the pre-game rundown's sections", A1 && ["The algo's call", "How the ratings held up", "Where the result sat in the simulations", "What the algo learns", "Bottom line"].every(t => A1.review.some(x => x.title === t)), A1 && A1.review.map(x => x.title));
const NB = Object.values(arch("NBA"));
check("games with no summary route still archive from the scoreboard (marked partial), with the logged call", NB.length >= 2 && NB.every(x => x.partial && x.call && x.call.key && Number.isFinite(x.home.score)), NB.map(x => ({ p: x.partial, call: !!x.call })));
const r3 = run();
check("run 3 succeeds and doesn't duplicate", r3.status === 0 && Object.keys(arch("CBBW")).length === 1, (r3.stderr || "").slice(-400));
console.log(`tracker: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
