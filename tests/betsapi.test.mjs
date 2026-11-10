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
// Kalshi markets the scoreboards don't carry (an ITF match)
const kalshiMarkets = { "KXITFMATCH-26NOV09DUMHEI-HEI": { ticker: "KXITFMATCH-26NOV09DUMHEI-HEI", event_ticker: "KXITFMATCH-26NOV09DUMHEI", title: "Dummer Macedo vs Heineberg", yes_sub_title: "Eduardo Heineberg", status: "active", result: "", close_time: new Date(Date.now() + 864e5).toISOString() } };
const kalshiSeen = []; let kalshi204 = false;
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(String(url));
  const mk = u.pathname.match(/\/markets\/([\w.-]+)$/);
  if (/kalshi/.test(u.host) && mk && kalshiMarkets[mk[1]]) return new Response(JSON.stringify({ market: kalshiMarkets[mk[1]] }), { status: 200 });
  if (/kalshi/.test(u.host) && mk) return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
  if (/kalshi/.test(u.host) && globalThis.__kx && await globalThis.__kx(u, opts)) return globalThis.__kxRes;
  if (/kalshi/.test(u.host)) { kalshiSeen.push({ url: String(url), method: opts.method, headers: opts.headers, body: opts.body }); if (kalshi204) return new Response(null, { status: 204 }); return new Response(JSON.stringify({ balance: 12345, order_id: "ord-1", fill_count: "17.85" }), { status: 200, headers: { "content-type": "application/json" } }); }
  espnCalls++;
  const m = u.pathname.match(/sports\/(.+)\/scoreboard/);
  if (!m) return new Response("", { status: 404 });
  return new Response(JSON.stringify({ leagues: [{ abbreviation: "X" }], events: Object.entries(games).filter(([, g]) => g.sport === m[1]).map(([id, g]) => ev(id, g)) }), { status: 200 });
};
const env = { DB, DEV_LOGIN: "1" };
const call = async (who, method, path, body) => {
  const req = new Request(`https://bobbys-boardroom.pages.dev/api/${path}`, { method, headers: { "x-dev-email": who || "", "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const res = await onRequest({ request: req, env, params: { path: path.split("?")[0].split("/") } });
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
// a Kalshi market with no scoreboard game behind it: only as a Kalshi purchase, graded from Kalshi's settlement
const itf = { pick: "Heineberg", sport: "Tennis", league: "KXITFMATCH", eventId: "KXITFMATCH-26NOV09DUMHEI-HEI", date: kalshiMarkets["KXITFMATCH-26NOV09DUMHEI-HEI"].close_time, market: "kalshi", side: "yes", line: null, odds: "+150", ticker: "KXITFMATCH-26NOV09DUMHEI-HEI", name: "Eduardo Heineberg" };
const kItf = { env: "live", orders: [{ ticker: itf.ticker, side: "yes", count: 5, price: 0.4, order_id: "o2", filled: 5 }] };
check("a Kalshi market is refused when it wasn't bought on Kalshi", (await call("live@x.com", "POST", "slips", { stake: 2, legs: [itf] })).status === 400);
r = await call("live@x.com", "POST", "slips", { stake: 2, legs: [itf], kalshi: kItf });
check("a Kalshi market (ITF match) is placed when bought there, named from Kalshi", r.status === 200 && r.j.slip.legs[0].market === "kalshi" && r.j.slip.legs[0].name === "Eduardo Heineberg" && r.j.slip.legs[0].away.name === "Dummer Macedo", r.j);
const itfSlip = r.j.slip?.id;
check("a slip bought on Kalshi can't be taken back", (await call("live@x.com", "DELETE", `slips/${itfSlip}`)).status === 409);
check("an unknown Kalshi market is refused", (await call("live@x.com", "POST", "slips", { stake: 2, legs: [{ ...itf, ticker: "KXNOPE-1", eventId: "KXNOPE-1" }], kalshi: { ...kItf, orders: [{ ...kItf.orders[0], ticker: "KXNOPE-1" }] } })).status === 400);
kalshiMarkets["KXITFMATCH-26NOV09DUMHEI-HEI"] = { ...kalshiMarkets["KXITFMATCH-26NOV09DUMHEI-HEI"], status: "settled", result: "yes" };
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
const liveSlips = (await call("live@x.com", "GET", "slips")).j.slips, itfDone = liveSlips.find(x => x.legs[0].market === "kalshi");
check("a Kalshi market leg is graded from Kalshi's settlement ($2 at +150 wins $3)", itfDone && itfDone.status === "won" && itfDone.profit === 3 && itfDone.legs[0].res === "W", itfDone);

// ---- leaderboards ----
const b = (await call("zed@x.com", "GET", "board")).j;
check("record board", b.record.map(p => `${p.username} ${p.W}-${p.L}`).join(", ") === "AmyBets 2-0, zed 1-0, LiveOne 1-0, BobbyPalmTrees 1-1", b.record.map(p => `${p.username} ${p.W}-${p.L}`));
check("money board", b.money.map(p => `${p.username} ${p.net}`).join(", ") === "AmyBets 165.91, zed 9.09, LiveOne 3, BobbyPalmTrees -5", b.money.map(p => `${p.username} ${p.net}`));
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
kr = await onRequest({ request: new Request("https://x/api/kalshi/live/portfolio/intra_exchange_instance_transfer", { method: "POST", headers: { "x-dev-email": "bob@x.com", "KALSHI-ACCESS-KEY": "kid", "KALSHI-ACCESS-SIGNATURE": "sig", "KALSHI-ACCESS-TIMESTAMP": "1" }, body: JSON.stringify({ source: "event_contract", destination: "event_contract", amount: 53600, source_exchange_shard: 0, destination_exchange_shard: 3 }) }), env, params: { path: ["kalshi", "live", "portfolio", "intra_exchange_instance_transfer"] } });
check("relay: moving cash between your own Kalshi shards goes through (funding a tennis buy)", kr.status === 200 && kalshiSeen.at(-1).url === "https://external-api.kalshi.com/trade-api/v2/portfolio/intra_exchange_instance_transfer" && JSON.parse(kalshiSeen.at(-1).body).destination_exchange_shard === 3);
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
// ---- everyone's tickets: live (riding) and past (settled), tailing ----
Object.assign(games["402"], { state: "pre", date: new Date(Date.now() + 5 * 3600e3).toISOString(), as: "", hs: "" });
Object.assign(games["403"], { state: "in" });
const amyRide = (await call("amy@x.com", "POST", "slips", { stake: 25, legs: [legNBA("Pistons ML", "402", "ml", "home", null, "+120")] })).j.slip;
let tr = await call("bob@x.com", "POST", "slips", { stake: 5, legs: [legNBA("Pistons ML", "402", "ml", "home", null, "+115")], tail: amyRide.id });
check("tail recorded against the original ticket", tr.status === 200 && tr.j.slip.tail === amyRide.id, tr.j);
const zedTail = (await call("zed@x.com", "POST", "slips", { stake: 5, legs: [legNBA("Pistons ML", "402", "ml", "home", null, "+120")], tail: tr.j.slip.id })).j.slip;
check("a tail of a tail credits the original", zedTail.tail === amyRide.id, zedTail);
check("tailing yourself isn't counted", (await call("amy@x.com", "POST", "slips", { stake: 1, legs: [legNBA("76ers ML", "402", "ml", "away", null, "-140")], tail: amyRide.id })).j.slip.tail === null);
check("made-up tail ignored", (await call("bob@x.com", "POST", "slips", { stake: 1, legs: [legNBA("76ers ML", "402", "ml", "away", null, "-140")], tail: "nope" })).j.slip.tail === null);
// a live one: Amy's Bucks ticket is on a game in progress
db.prepare("INSERT INTO slips (id, email, created, stake, odds, status, profit, settled, legs, kalshi, tail) VALUES ('liv1', 'amy@x.com', ?, 10, -150, 'pending', NULL, NULL, ?, ?, NULL)").run(new Date().toISOString(),
  JSON.stringify([{ pick: "Bucks ML", sport: "NBA", league: "nba", eventId: "403", date: games["403"].date, market: "ml", side: "away", line: null, odds: -150, away: { name: "Bucks", abbr: "MIL" }, home: { name: "Knicks", abbr: "NYK" }, title: "", res: null }]),
  JSON.stringify({ env: "live", dec: 1.6667, orders: [{ ticker: "KXNBAGAME-X", side: "yes", count: 15, price: 0.6, order_id: "secret-order", filled: 15 }], combo: null }));
const lv = (await call("bob@x.com", "GET", "tickets/live")).j;
const byId = Object.fromEntries(lv.tickets.map(t => [t.id, t]));
check("live tickets: everyone's riding slips, nothing settled", lv.tickets.every(t => t.status === "pending") && byId[amyRide.id] && byId[zedTail.id] && byId.liv1, lv.tickets.map(t => `${t.username} ${t.status}`));
check("live tickets: in-progress first", lv.tickets[0].id === "liv1" && lv.tickets[0].live === true && byId[amyRide.id].live === false, lv.tickets.map(t => t.id));
check("live tickets: usernames, who's you, tail counts, who they tailed", byId[amyRide.id].username === "AmyBets" && byId[amyRide.id].you === false && byId[amyRide.id].tails === 2 && byId[tr.j.slip.id].you === true && byId[zedTail.id].tailOf === "AmyBets", byId[amyRide.id]);
check("live tickets: someone's Kalshi ticket shows its market and size (for the cash-out value), never their order ids", byId.liv1.kalshi.env === "live" && byId.liv1.kalshi.mkt === "KXNBAGAME-X" && byId.liv1.kalshi.side === "yes" && byId.liv1.kalshi.count === 15 && !JSON.stringify(lv).includes("secret-order"), byId.liv1.kalshi);
check("live tickets: no emails", !JSON.stringify(lv).includes("@x.com"));
check("someone's page hides their Kalshi ids too", !JSON.stringify((await call("bob@x.com", "GET", "user/amybets")).j).includes("secret-order"));
check("your own page keeps yours", JSON.stringify((await call("amy@x.com", "GET", "slips")).j).includes("secret-order"));
const pa = (await call("bob@x.com", "GET", "tickets/past")).j;
check("past tickets: only settled, newest first, site totals", pa.tickets.length >= 5 && pa.tickets.every(t => ["won", "lost", "push"].includes(t.status)) && pa.tickets.every((t, i, a) => !i || a[i - 1].settled >= t.settled) && pa.totals.W + pa.totals.L === pa.tickets.filter(t => t.status !== "push").length, pa);
const pw = (await call("bob@x.com", "GET", "tickets/past?status=lost")).j;
check("past tickets: filter to losses", pw.tickets.length >= 1 && pw.tickets.every(t => t.status === "lost"));
for (let i = 0; i < 45; i++) db.prepare("INSERT INTO slips (id, email, created, stake, odds, status, profit, settled, legs) VALUES (?, 'zed@x.com', ?, 1, 100, 'won', 1, ?, '[]')").run(`old${i}`, "2026-01-01T00:00:00.000Z", new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString());
const p1 = (await call("bob@x.com", "GET", "tickets/past")).j, p2 = (await call("bob@x.com", "GET", `tickets/past?before=${encodeURIComponent(p1.tickets.at(-1).settled)}`)).j;
check("past tickets: pages of 40, then the rest", p1.tickets.length === 40 && p1.more === true && p2.more === false && p1.tickets.length + p2.tickets.length === pa.tickets.length + 45 && !p2.tickets.some(t => p1.tickets.some(u => u.id === t.id)), [p1.tickets.length, p2.tickets.length, pa.tickets.length]);
// ---- cashing out a Kalshi slip ----
Object.assign(games["402"], { state: "pre", date: new Date(Date.now() + 5 * 3600e3).toISOString(), as: "", hs: "" });
const ks1 = (await call("zed@x.com", "POST", "slips", { stake: 10, legs: [legNBA("76ers ML", "402", "ml", "away", null, "-150")], kalshi: { env: "live", orders: [{ ticker: "KXNBAGAME-X-PHI", side: "yes", count: 16.66, price: 0.6, order_id: "o-9", filled: 16.66 }] } })).j.slip;
check("a Kalshi slip can't be taken back (it's bought): cash it out", (await call("zed@x.com", "DELETE", `slips/${ks1.id}`)).status === 409);
check("someone else can't cash out your slip", (await call("bob@x.com", "POST", `slips/${ks1.id}/cashout`, { proceeds: 12 })).status === 404);
check("cash-out can't be more than the contracts pay", (await call("zed@x.com", "POST", `slips/${ks1.id}/cashout`, { proceeds: 17 })).status === 400);
const trackOnly = (await call("zed@x.com", "POST", "slips", { stake: 5, legs: [legNBA("76ers ML", "402", "ml", "away", null, "-150")] })).j.slip;
check("a slip not on Kalshi can't be cashed out", (await call("zed@x.com", "POST", `slips/${trackOnly.id}/cashout`, { proceeds: 3 })).status === 409);
const co1 = await call("zed@x.com", "POST", `slips/${ks1.id}/cashout`, { proceeds: 12.4, sale: { how: "order", order_id: "o-10", price: 0.75, count: 16.66, junk: "x" } });
check("cashed out: settled at what the sale brought (+$2.40), sale kept", co1.status === 200 && co1.j.slip.status === "cashed" && co1.j.slip.profit === 2.4 && co1.j.slip.kalshi.cashout.order_id === "o-10" && !("junk" in co1.j.slip.kalshi.cashout), co1.j);
check("can't cash out twice", (await call("zed@x.com", "POST", `slips/${ks1.id}/cashout`, { proceeds: 12.4 })).status === 409);
const zst = (await call("zed@x.com", "GET", "slips")).j;
check("a profitable cash-out counts as a win in your numbers", zst.stats.cashed === 1 && zst.stats.W >= 1, zst.stats);
const pc = (await call("bob@x.com", "GET", "tickets/past?status=cashed")).j;
check("past tickets: cashed-out filter", pc.tickets.length === 1 && pc.tickets[0].status === "cashed" && pc.tickets[0].profit === 2.4 && !JSON.stringify(pc).includes("o-10"), pc.tickets.map(t => t.status));
// ---- syncing positions bought in the Kalshi app ----
await call("zed@x.com", "POST", "slips", { stake: 10, legs: [legNBA("76ers ML", "402", "ml", "away", null, "-150")], kalshi: { env: "live", orders: [{ ticker: "KXNBAGAME-Y-PHI", side: "yes", count: 16.66, price: 0.6, order_id: "o-11", filled: 16.66 }] } });
const pos = [
  { ticker: "KXNFLGAME-26NOV09BUFMIN-BUF", side: "yes", count: 20, cost: 12.4, name: "Buffalo", title: "Buffalo at Minnesota", close: "2026-11-10T04:00:00Z" },
  { ticker: "KXMVECROSSCATEGORY-S2026-ABC", side: "yes", count: 50, cost: 9.5, combo: true, legs: [{ ticker: "KXNFLRECYDS-26NOV09BUFMIN-BUFDKINCAID86-20", side: "yes", name: "Dalton Kincaid: 20+", price: 0.7, close: "2026-11-11T01:15:00Z" }, { ticker: "KXNFLSPREAD-26NOV09BUFMIN-BUF7", side: "no", name: "Buffalo wins by over 6.5 points", price: 0.55, close: "2026-11-11T01:15:00Z" }] },
  { ticker: "KXNBAGAME-Y-PHI", side: "yes", count: 16.66, cost: 10 },          // already on a slip placed here: left alone
  { ticker: "bad ticker!", side: "yes", count: 1, cost: 0.5 },
];
let sy = await call("zed@x.com", "POST", "slips/sync", { env: "live", positions: pos });
check("sync: two new tickets from the Kalshi app, the one placed here left alone, junk ignored", sy.status === 200 && sy.j.added === 2 && sy.j.updated === 0 && sy.j.gone.length === 0, sy.j);
let zs2 = (await call("zed@x.com", "GET", "slips")).j.slips.filter(x => x.kalshi?.imported);
const sStraight = zs2.find(x => x.legs.length === 1), sCombo = zs2.find(x => x.legs.length === 2);
check("synced straight: Kalshi market leg at what it cost (62¢ = -163)", sStraight && sStraight.stake === 12.4 && sStraight.odds === -163 && sStraight.legs[0].market === "kalshi" && sStraight.legs[0].ticker === "KXNFLGAME-26NOV09BUFMIN-BUF" && sStraight.legs[0].sport === "NFL" && sStraight.kalshi.orders[0].filled === 20, sStraight);
check("synced combo: its legs (sides kept), priced as one contract (19¢)", sCombo && sCombo.odds === 426 && sCombo.legs[1].side === "no" && sCombo.legs[0].name === "Dalton Kincaid: 20+" && sCombo.kalshi.combo.contracts === 50, sCombo);
sy = await call("zed@x.com", "POST", "slips/sync", { env: "live", positions: pos });
check("sync again: nothing new", sy.j.added === 0 && sy.j.updated === 0);
sy = await call("zed@x.com", "POST", "slips/sync", { env: "live", positions: [{ ...pos[0], count: 30, cost: 18.9 }] });
check("bought more in the app: the ticket follows; the combo that's gone is reported back", sy.j.updated === 1 && sy.j.gone.length === 1 && sy.j.gone[0].ticker === "KXMVECROSSCATEGORY-S2026-ABC", sy.j);
check("synced ticket updated", (await call("zed@x.com", "GET", "slips")).j.slips.find(x => x.id === sStraight.id).stake === 18.9);
const lvs = (await call("bob@x.com", "GET", "tickets/live")).j.tickets.find(x => x.id === sStraight.id);
check("synced tickets show on Live Tickets for everyone, marked synced", lvs && lvs.username === "zed" && lvs.kalshi.imported === true && lvs.kalshi.mkt === "KXNFLGAME-26NOV09BUFMIN-BUF", lvs);
check("someone else can't sync into your account (it's per login)", (await call("bob@x.com", "POST", "slips/sync", { env: "live", positions: [] })).j.gone.length === 0);
// ---- opt-in server sync with a read-only key: bets bought in the Kalshi app show up with nobody on the site ----
{
  const kp = await crypto.subtle.generateKey({ name: "RSA-PSS", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const pk8 = Buffer.from(await crypto.subtle.exportKey("pkcs8", kp.privateKey)).toString("base64").match(/.{1,64}/g).join("\n");
  const PEM = `-----BEGIN PRIVATE KEY-----\n${pk8}\n-----END PRIVATE KEY-----`;
  let signedOk = 0, positionsNow = [{ ticker: "KXNBAGAME-26NOV09LALATL-LAL", position_fp: "40.00", market_exposure_dollars: "22.000000", last_updated_ts: new Date().toISOString() }];
  globalThis.__kx = async (u, opts) => {
    const p = u.pathname.replace("/trade-api/v2/", "");
    if (p === "portfolio/positions") {
      const h = opts.headers || {}, ok = h["KALSHI-ACCESS-KEY"] === "ro-key-123456" && await crypto.subtle.verify({ name: "RSA-PSS", saltLength: 32 }, kp.publicKey, Buffer.from(h["KALSHI-ACCESS-SIGNATURE"], "base64"), new TextEncoder().encode(`${h["KALSHI-ACCESS-TIMESTAMP"]}GET/trade-api/v2/portfolio/positions`));
      if (ok) signedOk++;
      globalThis.__kxRes = new Response(JSON.stringify(ok ? { market_positions: u.searchParams.get("ticker") ? [] : positionsNow } : { error: { message: "bad sig" } }), { status: ok ? 200 : 401 });
      return true;
    }
    if (p.startsWith("markets/KXNBAGAME-26NOV09LALATL-LAL")) { globalThis.__kxRes = new Response(JSON.stringify({ market: { ticker: "KXNBAGAME-26NOV09LALATL-LAL", yes_sub_title: "Los Angeles L", title: "Los Angeles L at Atlanta", status: "active", close_time: new Date(Date.now() + 864e5).toISOString() } }), { status: 200 }); return true; }
    return false;
  };
  env.SYNC_SECRET = "test-secret"; env.SYNC_INLINE = "1";
  await call("kim@x.com", "POST", "me", { username: "KimBuddy" });
  check("sync off until you turn it on", (await call("kim@x.com", "GET", "kalshi-sync")).j.on === false);
  check("a key that isn't a key is refused", (await call("kim@x.com", "POST", "kalshi-sync", { env: "live", keyId: "ro-key-123456", pem: "nope" })).status === 400);
  const on = await call("kim@x.com", "POST", "kalshi-sync", { env: "live", keyId: "ro-key-123456", pem: PEM });
  check("turned on: synced right away, signed with the read-only key", on.status === 200 && on.j.on === true && on.j.tail === "3456" && on.j.first?.added === 1 && signedOk >= 1, on.j);
  const stored = db.prepare("SELECT secret FROM sync_keys WHERE email='kim@x.com'").get().secret;
  check("the read-only key is encrypted at rest", stored.startsWith("aes:") && !stored.includes("PRIVATE KEY"));
  check("status: on, key tail only, never the key", (x => x.on && x.tail === "3456" && !JSON.stringify(x).includes("PRIVATE"))((await call("kim@x.com", "GET", "kalshi-sync")).j));
  // a new bet in the Kalshi app; Kim isn't on the site; Bob opens Live Tickets
  positionsNow = [...positionsNow, { ticker: "KXNBAGAME-26NOV09LALATL-LAL", position_fp: "40.00", market_exposure_dollars: "22.000000" }].slice(0, 1).concat([{ ticker: "KXNBAGAME-26NOV09LALATL-LAL2", position_fp: "10.00", market_exposure_dollars: "4.000000" }]);
  db.prepare("DELETE FROM settings WHERE k='sync_all_at'").run();
  const lvk = (await call("bob@x.com", "GET", "tickets/live")).j.tickets.filter(t => t.username === "KimBuddy");
  check("her new app bet shows on Live Tickets though she's not on the site", lvk.length === 2 && lvk.every(t => t.kalshi.imported), lvk.map(t => t.kalshi?.mkt));
  { const before = signedOk; await call("bob@x.com", "GET", "tickets/live"); check("synced at most once a minute", signedOk === before, [before, signedOk]); }
  const off = await call("kim@x.com", "DELETE", "kalshi-sync");
  check("turned off: gone from the server, its key id handed back to delete on Kalshi", off.j.on === false && off.j.keyId === "ro-key-123456" && !db.prepare("SELECT * FROM sync_keys WHERE email='kim@x.com'").get());
  delete env.SYNC_SECRET; delete env.SYNC_INLINE; globalThis.__kx = null;
}
check("no storage, clear message", (await onRequest({ request: new Request("https://x/api/me"), env: {}, params: { path: ["me"] } })).status === 503);

function decToAmLocal(list) { const d = list.reduce((a, o) => a * (o > 0 ? 1 + o / 100 : 1 + 100 / -o), 1); return d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1)); }
console.log(`bets api: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
