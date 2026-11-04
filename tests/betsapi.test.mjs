// The bet slips server (functions/api) end to end, on a real SQLite database shaped like D1 and a mocked ESPN:
// usernames, placing straights and parlays, refusing started games, grading from finals, both leaderboards, privacy.
import { build } from "esbuild";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
let pass = 0, fail = 0;
const check = (n, c, d) => { if (c) pass++; else { fail++; console.log("  FAIL:", n, d === undefined ? "" : JSON.stringify(d).slice(0, 500)); } };
const root = join(dirname(fileURLToPath(import.meta.url)), ".."), out = join(mkdtempSync(join(tmpdir(), "bbapi-")), "api.mjs");
await build({ entryPoints: [join(root, "functions/api/[[path]].js")], bundle: true, platform: "neutral", format: "esm", outfile: out, logLevel: "error" });
const { onRequest } = await import(out);

// ---- D1 on SQLite ----
const db = new DatabaseSync(":memory:");
const stmt = (sql, args = []) => ({
  bind: (...a) => stmt(sql, a),
  first: async () => { const r = db.prepare(sql).get(...args); return r ? { ...r } : null; },
  all: async () => ({ results: db.prepare(sql).all(...args).map(r => ({ ...r })) }),
  run: async () => { db.prepare(sql).run(...args); return { success: true }; },
  _run() { db.prepare(sql).run(...args); },
});
const DB = { prepare: sql => stmt(sql), batch: async list => { for (const s of list) s._run(); return []; } };

// ---- ESPN: two NBA games tomorrow, one soccer game, one already live ----
const soon = new Date(Date.now() + 3 * 3600e3).toISOString();
const games = {
  "401": { sport: "basketball/nba", date: soon, state: "pre", away: ["LAL", "Los Angeles Lakers", "Lakers"], home: ["BOS", "Boston Celtics", "Celtics"], as: "", hs: "" },
  "402": { sport: "basketball/nba", date: soon, state: "pre", away: ["PHI", "Philadelphia 76ers", "76ers"], home: ["DET", "Detroit Pistons", "Pistons"], as: "", hs: "" },
  "403": { sport: "basketball/nba", date: new Date(Date.now() - 3600e3).toISOString(), state: "in", away: ["MIL", "Milwaukee Bucks", "Bucks"], home: ["NYK", "New York Knicks", "Knicks"], as: "50", hs: "48" },
  "501": { sport: "soccer/uefa.champions", date: soon, state: "pre", away: ["RMA", "Real Madrid", "Real Madrid"], home: ["AEK", "AEK Athens", "AEK"], as: "", hs: "" },
};
const ev = (id, g) => ({ id, date: g.date, competitions: [{ id, date: g.date, status: { type: { state: g.state, completed: g.state === "post", shortDetail: g.state === "post" ? "Final" : "" } }, competitors: [
  { homeAway: "away", score: g.as, winner: g.state === "post" && +g.as > +g.hs, team: { abbreviation: g.away[0], displayName: g.away[1], shortDisplayName: g.away[2], name: g.away[2] } },
  { homeAway: "home", score: g.hs, winner: g.state === "post" && +g.hs > +g.as, team: { abbreviation: g.home[0], displayName: g.home[1], shortDisplayName: g.home[2], name: g.home[2] } }] }] });
let espnCalls = 0;
globalThis.fetch = async url => {
  const u = new URL(String(url));
  espnCalls++;
  const m = u.pathname.match(/sports\/(.+)\/scoreboard/);
  if (!m) return new Response("", { status: 404 });
  return new Response(JSON.stringify({ leagues: [{ abbreviation: "X" }], events: Object.entries(games).filter(([, g]) => g.sport === m[1]).map(([id, g]) => ev(id, g)) }), { status: 200 });
};
const env = { DB, DEV_LOGIN: "1" };
const call = async (who, method, path, body) => {
  const req = new Request(`https://bobbys-boardroom.pages.dev/api/${path}`, { method, headers: { "x-dev-email": who || "", "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const res = await onRequest({ request: req, env, params: { path: path.split("/") } });
  return { status: res.status, j: await res.json() };
};
const legNBA = (pick, eventId, market, side, line, odds) => ({ pick, sport: "NBA", league: "nba", eventId, date: games[eventId].date, market, side, line, odds });

// ---- login and usernames ----
check("no login, no access", (await call(null, "GET", "me")).status === 401);
check("new person has no username", (await call("bob@x.com", "GET", "me")).j.username === null);
check("must pick a username first", (await call("bob@x.com", "GET", "slips")).status === 403);
check("bad username refused", (await call("bob@x.com", "POST", "me", { username: "b!" })).status === 400);
check("username saved", (await call("bob@x.com", "POST", "me", { username: "BobbyPalmTrees" })).j.username === "BobbyPalmTrees");
check("username taken (any case)", (await call("amy@x.com", "POST", "me", { username: "bobbypalmtrees" })).status === 409);
await call("amy@x.com", "POST", "me", { username: "AmyBets" });
await call("zed@x.com", "POST", "me", { username: "zed" });

// ---- placing slips ----
let r = await call("bob@x.com", "POST", "slips", { stake: 10, legs: [legNBA("Lakers ML", "401", "ml", "away", null, "+150")] });
check("straight placed", r.status === 200 && r.j.slip.odds === 150 && r.j.slip.legs[0].away.name === "Lakers", r.j);
r = await call("bob@x.com", "POST", "slips", { stake: 20, legs: [legNBA("Celtics -4.5", "401", "spread", "home", -4.5, "-110"), legNBA("76ers ML", "402", "ml", "away", null, "-110"), { pick: "Real Madrid ML", sport: "Soccer", league: "uefa.champions", eventId: "501", date: soon, market: "ml", side: "away", line: null, odds: "-200" }] });
check("three-leg parlay priced", r.status === 200 && r.j.slip.odds === decToAmLocal([-110, -110, -200]), r.j);
check("started game refused", (await call("bob@x.com", "POST", "slips", { stake: 5, legs: [legNBA("Bucks ML", "403", "ml", "away", null, "-150")] })).status === 400);
check("bad odds refused", (await call("bob@x.com", "POST", "slips", { stake: 5, legs: [legNBA("Lakers ML", "401", "ml", "away", null, "-50")] })).status === 400);
check("no amount refused", (await call("bob@x.com", "POST", "slips", { stake: 0, legs: [legNBA("Lakers ML", "401", "ml", "away", null, "+150")] })).status === 400);
check("same pick twice refused", (await call("bob@x.com", "POST", "slips", { stake: 5, legs: [legNBA("Lakers ML", "401", "ml", "away", null, "+150"), legNBA("Lakers ML", "401", "ml", "away", null, "+150")] })).status === 400);
check("made-up game refused", (await call("bob@x.com", "POST", "slips", { stake: 5, legs: [legNBA("Lakers ML", "401", "ml", "away", null, "+150")].map(l => ({ ...l, eventId: "999" })) })).status === 400);
r = await call("amy@x.com", "POST", "slips", { stake: 50, legs: [legNBA("Lakers ML", "401", "ml", "away", null, "+150")] });
const amyLakers = r.j.slip.id;
await call("amy@x.com", "POST", "slips", { stake: 100, legs: [legNBA("Over 220.5", "402", "total", "over", 220.5, "-110")] });
await call("zed@x.com", "POST", "slips", { stake: 10, legs: [legNBA("Pistons +6", "402", "spread", "home", 6, "-110")] });
const tmp = await call("zed@x.com", "POST", "slips", { stake: 10, legs: [legNBA("Celtics ML", "401", "ml", "home", null, "-180")] });
check("someone else can't take back your slip", (await call("bob@x.com", "DELETE", `slips/${tmp.j.slip.id}`)).status === 404);
check("take back a slip before tip-off", (await call("zed@x.com", "DELETE", `slips/${tmp.j.slip.id}`)).j.ok === true);
let mine = await call("bob@x.com", "GET", "slips");
check("my slips: both pending", mine.j.slips.length === 2 && mine.j.slips.every(s => s.status === "pending") && mine.j.stats.pending === 2);

// ---- the games are played: Lakers 112-108 (Celtics -4.5 loses), 76ers 115-110 (over 220.5 wins, Pistons +6 covers), Madrid 2-0 ----
const past = new Date(Date.now() - 4 * 3600e3).toISOString();
Object.assign(games["401"], { state: "post", date: past, as: "112", hs: "108" });
Object.assign(games["402"], { state: "post", date: past, as: "115", hs: "110" });
Object.assign(games["501"], { state: "post", date: past, as: "2", hs: "0" });
db.prepare("UPDATE slips SET legs = replace(legs, ?, ?)").run(soon, past);
check("take-back blocked once the game starts", (await call("amy@x.com", "DELETE", `slips/${amyLakers}`)).status === 409);
db.prepare("DELETE FROM settings WHERE k='graded_at'").run();
mine = await call("bob@x.com", "GET", "slips");
const st = Object.fromEntries(mine.j.slips.map(s => [s.legs.length, s]));
check("straight graded a win: $10 at +150 pays $15", st[1].status === "won" && st[1].profit === 15 && st[1].legs[0].res === "W" && st[1].legs[0].final.a === "112", st[1]);
check("parlay lost on the Celtics leg", st[3].status === "lost" && st[3].profit === -20 && st[3].legs.map(l => l.res).join("") === "LWW", st[3].legs.map(l => l.res));
check("bob: 1 for 2, net -$5", mine.j.stats.W === 1 && mine.j.stats.L === 1 && mine.j.stats.net === -5, mine.j.stats);

// ---- leaderboards ----
const b = (await call("zed@x.com", "GET", "board")).j;
check("record board", b.record.map(p => `${p.username} ${p.W}-${p.L}`).join(", ") === "AmyBets 2-0, zed 1-0, BobbyPalmTrees 1-1", b.record.map(p => `${p.username} ${p.W}-${p.L}`));
check("money board", b.money.map(p => `${p.username} ${p.net}`).join(", ") === "AmyBets 165.91, zed 9.09, BobbyPalmTrees -5", b.money.map(p => `${p.username} ${p.net}`));
check("marks you", b.record.find(p => p.username === "zed").you === true && b.record.find(p => p.username === "AmyBets").you === false);
check("no emails anywhere on the board", !JSON.stringify(b).includes("@"));
const prof = await call("zed@x.com", "GET", "user/bobbypalmtrees");
check("anyone's page by username: stats and slips, no email", prof.j.username === "BobbyPalmTrees" && prof.j.slips.length === 2 && prof.j.stats.W === 1 && !JSON.stringify(prof.j).includes("@"), prof.j);
check("unknown username", (await call("zed@x.com", "GET", "user/nobody")).status === 404);
check("no storage, clear message", (await onRequest({ request: new Request("https://x/api/me"), env: {}, params: { path: ["me"] } })).status === 503);

function decToAmLocal(list) { const d = list.reduce((a, o) => a * (o > 0 ? 1 + o / 100 : 1 + 100 / -o), 1); return d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1)); }
console.log(`bets api: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
