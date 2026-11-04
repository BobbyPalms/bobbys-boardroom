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
import { realNBA, standings } from ${JSON.stringify(join(here, "espn_fixtures.mjs"))};
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
console.log(`tracker: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
