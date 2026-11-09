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
const kalshiSeen = []; let kalshi204 = false;
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(String(url));
  if (/kalshi/.test(u.host)) { kalshiSeen.push({ url: String(url), method: opts.method, headers: opts.headers, body: opts.body }); if (kalshi204) return new Response(null, { status: 204 }); return new Response(JSON.stringify({ balance: 12345, order_id: "ord-1", fill_count: "17.85" }), { status: 200, headers: { "content-type": "application/json" } }); }
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
// a live game: only when it was actually bought live on Kalshi (filled order), and it's marked live
await call("live@x.com", "POST", "me", { username: "LiveOne" });
const kFilled = { env: "live", orders: [{ ticker: "KXNBAGAME-X-MIL", side: "yes", count: 10, price: 0.6, order_id: "o1", filled: 10 }] };
r = await call("live@x.com", "POST", "slips", { stake: 6, legs: [legNBA("Bucks ML", "403", "ml", "away", null, "-150")], kalshi: kFilled });
check("live game accepted when bought on Kalshi, and marked live", r.status === 200 && r.j.slip.legs[0].live === true && r.j.slip.kalshi.orders[0].filled === 10, r.j);
check("live game refused when the Kalshi order didn't fill", (await call("live@x.com", "POST", "slips", { stake: 6, legs: [legNBA("Bucks ML", "403", "ml", "away", null, "-150")], kalshi: { ...kFilled, orders: [{ ...kFilled.orders[0], filled: 0 }] } })).status === 400);
games["404"] = { sport: "basketball/nba", date: new Date(Date.now() - 4 * 3600e3).toISOString(), state: "post", away: ["CHI", "Chicago Bulls", "Bulls"], home: ["MIA", "Miami Heat", "Heat"], as: "100", hs: "99" };
check("a finished game is always refused, Kalshi or not", (await call("live@x.com", "POST", "slips", { stake: 6, legs: [legNBA("Bulls ML", "404", "ml", "away", null, "-150")], kalshi: kFilled })).status === 400);
delete games["404"];
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
// ---- Kalshi relay: passes a signed request through unchanged, only to the slip flow's paths ----
let kr = await onRequest({ request: new Request("https://bobbys-boardroom.pages.dev/api/kalshi/live/portfolio/events/orders", { method: "POST", headers: { "x-dev-email": "bob@x.com", "KALSHI-ACCESS-KEY": "kid", "KALSHI-ACCESS-SIGNATURE": "sig", "KALSHI-ACCESS-TIMESTAMP": "123", "content-type": "application/json" }, body: JSON.stringify({ ticker: "T", side: "bid", count: "1", price: "0.5" }) }), env, params: { path: ["kalshi", "live", "portfolio", "events", "orders"] } });
const ks = kalshiSeen.at(-1);
check("relay: forwards to Kalshi with the signature headers and body, untouched", kr.status === 200 && ks.url === "https://external-api.kalshi.com/trade-api/v2/portfolio/events/orders" && ks.method === "POST" && ks.headers["KALSHI-ACCESS-KEY"] === "kid" && ks.headers["KALSHI-ACCESS-SIGNATURE"] === "sig" && JSON.parse(ks.body).ticker === "T", ks);
kr = await onRequest({ request: new Request("https://x/api/kalshi/demo/events?series_ticker=KXNBAGAME", { headers: { "x-dev-email": "bob@x.com" } }), env, params: { path: ["kalshi", "demo", "events"] } });
check("relay: demo host and query string", kr.status === 200 && kalshiSeen.at(-1).url === "https://external-api.demo.kalshi.co/trade-api/v2/events?series_ticker=KXNBAGAME");
const before = kalshiSeen.length;
kr = await onRequest({ request: new Request("https://x/api/kalshi/live/portfolio/withdrawals", { method: "POST", headers: { "x-dev-email": "bob@x.com" } }), env, params: { path: ["kalshi", "live", "portfolio", "withdrawals"] } });
check("relay: anything outside the slip flow is refused (never reaches Kalshi)", kr.status === 403 && kalshiSeen.length === before);
kr = await onRequest({ request: new Request("https://x/api/kalshi/live/portfolio/balance"), env, params: { path: ["kalshi", "live", "portfolio", "balance"] } });
check("relay: needs the site login", kr.status === 401);
kalshi204 = true;
kr = await onRequest({ request: new Request("https://x/api/kalshi/live/communications/rfqs/r1/quotes/q1/accept", { method: "PUT", headers: { "x-dev-email": "bob@x.com" }, body: JSON.stringify({ accepted_side: "no" }) }), env, params: { path: ["kalshi", "live", "communications", "rfqs", "r1", "quotes", "q1", "accept"] } });
check("relay: Kalshi's empty 204 reply (accepted quote) passes through", kr.status === 204);
kalshi204 = false;
// ---- a Kalshi combo slip pays at the combo's price ----
Object.assign(games["402"], { state: "pre", date: new Date(Date.now() + 3 * 3600e3).toISOString(), as: "", hs: "" });
Object.assign(games["501"], { state: "pre", date: new Date(Date.now() + 3 * 3600e3).toISOString(), as: "", hs: "" });
r = await call("zed@x.com", "POST", "slips", { stake: 9.5, legs: [legNBA("76ers ML", "402", "ml", "away", null, "-110"), { pick: "Real Madrid ML", sport: "Soccer", league: "uefa.champions", eventId: "501", date: games["501"].date, market: "ml", side: "away", line: null, odds: "-200" }], kalshi: { env: "live", dec: 1 / 0.19, combo: { market_ticker: "KXMVE-1", rfq_id: "r1", quote_id: "q1", price: 0.19, contracts: 50 }, orders: [], secret: "never kept" } });
check("Kalshi combo slip: priced at the combo (+426), Kalshi ids kept, nothing else", r.status === 200 && r.j.slip.odds === 426 && r.j.slip.kalshi.combo.rfq_id === "r1" && !("secret" in r.j.slip.kalshi), r.j);
const kid = r.j.slip.id;
Object.assign(games["402"], { state: "post", date: past, as: "115", hs: "110" }); Object.assign(games["501"], { state: "post", date: past, as: "2", hs: "0" });
db.prepare("UPDATE slips SET legs = replace(legs, ?, ?) WHERE id = ?").run(JSON.stringify(games["402"].date).slice(1, -1), past, kid);
const legsNow = JSON.parse(db.prepare("SELECT legs FROM slips WHERE id=?").get(kid).legs).map(l => ({ ...l, date: past }));
db.prepare("UPDATE slips SET legs=? WHERE id=?").run(JSON.stringify(legsNow), kid);
db.prepare("DELETE FROM settings WHERE k='graded_at'").run();
const zs = (await call("zed@x.com", "GET", "slips")).j.slips.find(x => x.id === kid);
check("Kalshi combo slip graded: won at the combo price ($9.50 at 19¢ wins $40.50)", zs.status === "won" && Math.abs(zs.profit - 40.5) < 0.01, zs);
check("no storage, clear message", (await onRequest({ request: new Request("https://x/api/me"), env: {}, params: { path: ["me"] } })).status === 503);

function decToAmLocal(list) { const d = list.reduce((a, o) => a * (o > 0 ? 1 + o / 100 : 1 + 100 / -o), 1); return d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1)); }
console.log(`bets api: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
