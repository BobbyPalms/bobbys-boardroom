// Bet slips API (Cloudflare Pages Function, behind the same Cloudflare Access login as the site).
// Who's asking comes from the login (Cloudflare Access), never from the page. Slips are stored in D1 (binding DB).
//   GET  /api/me                 -> { username | null }
//   POST /api/me {username}      -> pick or change your username
//   GET  /api/slips              -> your slips and numbers
//   POST /api/slips {stake, legs}-> place a slip (every game must not have started yet)
//   DELETE /api/slips/:id        -> take back a slip before any of its games starts
//   GET  /api/board              -> both leaderboards
//   GET  /api/user/:username     -> anyone's numbers and slips (by username; emails are never shown)
// Grading: every call first settles any leg whose game is over, from ESPN's final score.
import { ROUTES, scoreboardUrl, liveBoard, ymd } from "../../src/routes.js";
import { gradeLeg, settleSlip, bettorStats, leaderboards, readOdds, amToDec, decToAm, USERNAME_RE } from "../../src/bets.js";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const bad = (msg, status = 400) => json({ error: msg }, status);

// ---------- who's logged in ----------
const b64u = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), c => c.charCodeAt(0));
const certCache = {};
async function verifiedEmail(token, env) {
  try {
    const [h, p, sig] = token.split(".");
    const head = JSON.parse(new TextDecoder().decode(b64u(h))), claims = JSON.parse(new TextDecoder().decode(b64u(p)));
    if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(claims.iss || "")) return null;
    if (!claims.exp || claims.exp * 1000 < Date.now()) return null;
    // the site's own Access team: the first one seen is kept and every later login must match it
    const pinned = await setting(env, "access_iss");
    if (pinned && pinned !== claims.iss) return null;
    const certs = certCache[claims.iss] || (certCache[claims.iss] = await fetch(`${claims.iss}/cdn-cgi/access/certs`).then(r => r.json()));
    const jwk = (certs.keys || []).find(k => k.kid === head.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64u(sig), new TextEncoder().encode(`${h}.${p}`));
    if (!ok || !claims.email) return null;
    if (!pinned) await setSetting(env, "access_iss", claims.iss);
    return String(claims.email).toLowerCase();
  } catch (_) { return null; }
}
async function whoIs(request, env) {
  if (env.DEV_LOGIN === "1") return (request.headers.get("x-dev-email") || "").toLowerCase() || null;   // local tests only
  const cookie = (request.headers.get("cookie") || "").match(/(?:^|;\s*)CF_Authorization=([^;]+)/)?.[1];
  const token = request.headers.get("cf-access-jwt-assertion") || cookie;
  return token ? verifiedEmail(token, env) : null;
}

// ---------- storage ----------
let ready = false;
async function init(env) {
  if (ready) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS users (email TEXT PRIMARY KEY, username TEXT NOT NULL, uname TEXT NOT NULL UNIQUE, created TEXT NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS slips (id TEXT PRIMARY KEY, email TEXT NOT NULL, created TEXT NOT NULL, stake REAL NOT NULL, odds INTEGER NOT NULL, status TEXT NOT NULL, profit REAL, settled TEXT, legs TEXT NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS slips_email ON slips(email)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS slips_status ON slips(status)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT)"),
  ]);
  try { await env.DB.prepare("ALTER TABLE slips ADD COLUMN kalshi TEXT").run(); } catch (_) { /* already there */ }
  ready = true;
}
const setting = async (env, k) => (await env.DB.prepare("SELECT v FROM settings WHERE k=?").bind(k).first())?.v ?? null;
const setSetting = (env, k, v) => env.DB.prepare("INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(k, v).run();
const rowToSlip = r => ({ id: r.id, created: r.created, stake: r.stake, odds: r.odds, status: r.status, profit: r.profit, settled: r.settled, legs: JSON.parse(r.legs), kalshi: r.kalshi ? JSON.parse(r.kalshi) : null });

// ---------- ESPN ----------
const espn = (env, url) => (env.ESPN_BASE ? url.replace("https://site.api.espn.com", env.ESPN_BASE) : url);
async function board(env, sport, league, day) {
  const r = await fetch(espn(env, scoreboardUrl(sport, league, day)), { headers: { "User-Agent": "bobbys-boardroom/1.0" } });
  if (!r.ok) throw new Error(`scores route ${r.status}`);
  return liveBoard(await r.json(), sport);
}

// ---------- grading: settle every leg whose game is over ----------
async function gradePending(env, force = false) {
  const last = Number(await setting(env, "graded_at")) || 0;
  if (!force && Date.now() - last < 60000) return;
  await setSetting(env, "graded_at", String(Date.now()));
  const { results } = await env.DB.prepare("SELECT * FROM slips WHERE status='pending'").all();
  const slips = results.map(rowToSlip), now = Date.now(), want = new Map();
  for (const s of slips) for (const l of s.legs) if (!l.res && Date.parse(l.date) < now) want.set(`${l.sport}|${l.league}|${ymd(new Date(l.date))}`, null);
  const keys = [...want.keys()].slice(0, 40);
  await Promise.all(keys.map(async k => { const [sp, lg, d] = k.split("|"); try { want.set(k, new Map((await board(env, sp, lg, d)).map(r => [r.id, r]))); } catch (_) { /* next time */ } }));
  const writes = [];
  for (const s of slips) {
    let changed = false;
    for (const l of s.legs) {
      if (l.res || Date.parse(l.date) >= now) continue;
      const rows = want.get(`${l.sport}|${l.league}|${ymd(new Date(l.date))}`);
      if (!rows) continue;
      const row = rows.get(l.eventId);
      let res = row ? gradeLeg(l, row) : null;
      if (!row && now - Date.parse(l.date) > 4 * 864e5) res = "P";                  // never played (moved or cancelled): void
      if (res) { l.res = res; if (row) l.final = { a: row.away.score, h: row.home.score, aw: !!row.away.win, hw: !!row.home.win }; changed = true; }
    }
    if (!changed) continue;
    const st = settleSlip(s);
    writes.push(env.DB.prepare("UPDATE slips SET legs=?, status=?, profit=?, settled=? WHERE id=?").bind(JSON.stringify(s.legs), st.status, st.profit, st.status === "pending" ? null : new Date().toISOString(), s.id));
  }
  if (writes.length) await env.DB.batch(writes);
}

// ---------- placing a slip ----------
// what a slip keeps about its Kalshi orders (ids and fills only; never anything about the key)
function cleanKalshi(k) {
  if (!k || typeof k !== "object") return null;
  const str = (v, n = 80) => (v == null ? null : String(v).slice(0, n)), numv = v => (Number.isFinite(Number(v)) ? Number(v) : null);
  return {
    env: k.env === "demo" ? "demo" : "live", dec: numv(k.dec),
    orders: (Array.isArray(k.orders) ? k.orders : []).slice(0, 20).map(o => ({ ticker: str(o.ticker), side: o.side === "no" ? "no" : "yes", count: numv(o.count), price: numv(o.price), order_id: str(o.order_id), filled: numv(o.filled) })),
    combo: k.combo ? { market_ticker: str(k.combo.market_ticker), collection: str(k.combo.collection), rfq_id: str(k.combo.rfq_id), quote_id: str(k.combo.quote_id), price: numv(k.combo.price), contracts: numv(k.combo.contracts) } : null,
  };
}
async function placeSlip(env, email, body) {
  const stake = Math.round(Number(body?.stake) * 100) / 100;
  if (!(stake >= 0.01 && stake <= 1e6)) return bad("Enter a bet amount.");
  const legsIn = Array.isArray(body?.legs) ? body.legs.slice(0, 20) : [];
  if (!legsIn.length) return bad("Add at least one pick.");
  const legs = [], seen = new Set();
  for (const x of legsIn) {
    const odds = readOdds(x.odds);
    if (odds == null) return bad(`Odds for "${x.pick || "a pick"}" should look like -110 or +150.`);
    if (!ROUTES[x.sport] || !ROUTES[x.sport].leagues.includes(x.league)) return bad(`Couldn't place "${x.pick}".`);
    if (!["ml", "spread", "total", "draw"].includes(x.market)) return bad(`Couldn't read "${x.pick}".`);
    const side = x.market === "total" ? (x.side === "over" || x.side === "under" ? x.side : null) : x.market === "draw" ? "draw" : (x.side === "away" || x.side === "home" ? x.side : null);
    const line = x.market === "spread" || x.market === "total" ? Number(x.line) : null;
    if (!side || (line != null && !Number.isFinite(line))) return bad(`Couldn't read "${x.pick}".`);
    let rows;
    try { rows = await board(env, x.sport, x.league, ymd(new Date(x.date))); } catch (_) { return bad("Couldn't reach the scores routes to check the game. Try again.", 503); }
    const row = rows.find(r => r.id === String(x.eventId));
    if (!row) return bad(`Couldn't find the game for "${x.pick}".`);
    if (row.state !== "pre" || Date.parse(row.date) <= Date.now()) return bad(`"${x.pick}": that game has already started.`);
    const k = `${row.id}|${x.market}|${side}`;
    if (seen.has(k)) return bad(`"${x.pick}" is on the slip twice.`);
    seen.add(k);
    legs.push({ pick: String(x.pick || "").slice(0, 80), sport: x.sport, league: x.league, eventId: row.id, date: row.date, market: x.market, side, line,
      odds, away: { name: row.away.name, abbr: row.away.abbr || "" }, home: { name: row.home.name, abbr: row.home.abbr || "" }, title: x.sport === "Tennis" || x.sport === "MMA" ? row.league : "", res: null });
  }
  const kalshi = cleanKalshi(body?.kalshi);
  // a Kalshi combo is priced as one contract: its price is the slip's odds, not the legs multiplied
  const dec = kalshi?.dec > 1 ? kalshi.dec : legs.reduce((a, l) => a * amToDec(l.odds), 1), odds = decToAm(dec);
  const id = crypto.randomUUID(), created = new Date().toISOString();
  await env.DB.prepare("INSERT INTO slips (id, email, created, stake, odds, status, profit, settled, legs, kalshi) VALUES (?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, ?)").bind(id, email, created, stake, odds, JSON.stringify(legs), kalshi ? JSON.stringify(kalshi) : null).run();
  return json({ slip: { id, created, stake, odds, status: "pending", profit: null, settled: null, legs, kalshi } });
}

// ---------- Kalshi relay ----------
// Kalshi doesn't take calls straight from a browser, so the page sends each request here, already signed on the person's
// device with their own key. This passes it on unchanged: it never sees a key (only a signature that's good for this one
// request and expires), keeps nothing, and only reaches the Kalshi paths the slip flow uses.
const KALSHI = { live: "https://external-api.kalshi.com", demo: "https://external-api.demo.kalshi.co" };
const KPATH = /^(portfolio\/balance|portfolio\/events\/orders|portfolio\/orders\/[\w-]+|portfolio\/fills|events|markets\/[\w.-]+|multivariate_event_collections(\/[\w.-]+)?|communications\/rfqs(\/[\w-]+(\/quotes\/[\w-]+\/accept)?)?|communications\/quotes)$/;
async function relayKalshi(request, env, path) {
  const host = (env.KALSHI_BASE && JSON.parse(env.KALSHI_BASE)[path[0]]) || KALSHI[path[0]], sub = path.slice(1).join("/");
  if (!host) return bad("Unknown Kalshi environment.", 404);
  if (!KPATH.test(sub)) return bad("That Kalshi request isn't part of the slip flow.", 403);
  const h = { accept: "application/json", "content-type": "application/json", "user-agent": "bobbys-boardroom/1.0" };
  for (const k of ["KALSHI-ACCESS-KEY", "KALSHI-ACCESS-SIGNATURE", "KALSHI-ACCESS-TIMESTAMP"]) { const v = request.headers.get(k); if (v) h[k] = v; }
  const m = request.method.toUpperCase(), body = m === "POST" || m === "PUT" ? await request.text() : undefined;
  let r;
  try { r = await fetch(`${host}/trade-api/v2/${sub}${new URL(request.url).search}`, { method: m, headers: h, body }); }
  catch (_) { return bad("Couldn't reach Kalshi. Try again.", 502); }
  const empty = r.status === 204 || r.status === 205 || r.status === 304;                       // e.g. an accepted quote: no body
  return new Response(empty ? null : await r.text(), { status: r.status, headers: { "content-type": r.headers.get("content-type") || "application/json", "cache-control": "no-store" } });
}

// ---------- routes ----------
export async function onRequest({ request, env, params }) {
  if (!env.DB) return bad("Bet slips storage isn't connected yet.", 503);
  await init(env);
  const email = await whoIs(request, env);
  if (!email) return bad("Log in to use bet slips.", 401);
  const path = [].concat(params.path || []), m = request.method, what = path[0] || "";
  if (what === "kalshi") return relayKalshi(request, env, path.slice(1));
  const me = await env.DB.prepare("SELECT username FROM users WHERE email=?").bind(email).first();
  const body = m === "POST" ? await request.json().catch(() => ({})) : null;

  if (what === "me" && m === "GET") return json({ username: me?.username || null });
  if (what === "me" && m === "POST") {
    const u = String(body?.username || "").trim();
    if (!USERNAME_RE.test(u)) return bad("Usernames are 3–16 letters, numbers or _.");
    const taken = await env.DB.prepare("SELECT email FROM users WHERE uname=?").bind(u.toLowerCase()).first();
    if (taken && taken.email !== email) return bad("That username is taken.", 409);
    await env.DB.prepare("INSERT INTO users (email, username, uname, created) VALUES (?, ?, ?, ?) ON CONFLICT(email) DO UPDATE SET username=excluded.username, uname=excluded.uname").bind(email, u, u.toLowerCase(), new Date().toISOString()).run();
    return json({ username: u });
  }
  if (!me) return bad("Pick a username first.", 403);

  if (what === "slips" && m === "POST") return placeSlip(env, email, body);
  if (what === "slips" && m === "DELETE" && path[1]) {
    const r = await env.DB.prepare("SELECT * FROM slips WHERE id=? AND email=?").bind(path[1], email).first();
    if (!r) return bad("Slip not found.", 404);
    const s = rowToSlip(r);
    if (s.status !== "pending" || s.legs.some(l => Date.parse(l.date) <= Date.now() || l.res)) return bad("A game on that slip has started, so it stays.", 409);
    await env.DB.prepare("DELETE FROM slips WHERE id=?").bind(s.id).run();
    return json({ ok: true });
  }

  await gradePending(env).catch(() => {});
  const slipsOf = async em => (await env.DB.prepare("SELECT * FROM slips WHERE email=? ORDER BY created DESC").bind(em).all()).results.map(rowToSlip);
  if (what === "slips" && m === "GET") { const slips = await slipsOf(email); return json({ username: me.username, slips, stats: bettorStats(slips) }); }
  if (what === "user" && m === "GET" && path[1]) {
    const u = await env.DB.prepare("SELECT email, username FROM users WHERE uname=?").bind(String(path[1]).toLowerCase()).first();
    if (!u) return bad("No one goes by that username.", 404);
    const slips = await slipsOf(u.email);
    return json({ username: u.username, you: u.email === email, slips, stats: bettorStats(slips) });
  }
  if (what === "board" && m === "GET") {
    const users = (await env.DB.prepare("SELECT email, username FROM users").all()).results;
    const all = (await env.DB.prepare("SELECT * FROM slips").all()).results;
    const by = {};
    for (const r of all) (by[r.email] = by[r.email] || []).push(rowToSlip(r));
    const people = users.map(u => ({ username: u.username, you: u.email === email, stats: bettorStats(by[u.email] || []) }));
    const strip = p => ({ username: p.username, you: p.you, W: p.stats.W, L: p.stats.L, P: p.stats.P, pending: p.stats.pending, pct: p.stats.pct, net: p.stats.net, won: p.stats.won, staked: p.stats.staked, roi: p.stats.roi, streak: p.stats.streak });
    const lb = leaderboards(people);
    return json({ record: lb.record.map(strip), money: lb.money.map(strip), players: people.length, waiting: people.filter(p => p.stats.W + p.stats.L === 0).map(p => p.username) });
  }
  return bad("Not found.", 404);
}
