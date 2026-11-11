// Bet slips API (Cloudflare Pages Function, behind the same Cloudflare Access login as the site).
// Who's asking comes from the login (Cloudflare Access), never from the page. Slips are stored in D1 (binding DB).
//   GET  /api/me                 -> { username | null }
//   POST /api/me {username}      -> pick or change your username
//   GET  /api/slips              -> your slips and numbers
//   POST /api/slips {stake, legs}-> place a slip (every game must not have started yet, unless it was bought live on Kalshi)
//   DELETE /api/slips/:id        -> take back a slip before any of its games starts (not one bought on Kalshi: cash that out)
//   POST /api/slips/:id/cashout {proceeds, sale} -> a Kalshi slip sold back on Kalshi: settled at what the sale brought
//   GET/POST/DELETE /api/kalshi-sync -> opt-in "keep my Kalshi synced": a READ-ONLY Kalshi key (made on the person's
//                                device with their own key; it can see positions but can't trade or move money) kept here,
//                                so their Kalshi bets sync even when they don't have the site open
//   POST /api/slips/sync {env, positions} -> your open Kalshi positions (read on your device with your key, including ones
//                                bought in the Kalshi app), kept as tickets here; returns the synced tickets no longer open
//   GET  /api/board              -> both leaderboards
//   GET  /api/user/:username     -> anyone's numbers and slips (by username; emails are never shown)
//   GET  /api/tickets/live       -> everyone's tickets still riding (upcoming or live), with who placed them and who's tailing
//   GET  /api/tickets/past       -> everyone's settled tickets, newest first (?status=won|lost|push, ?before=<settled> for more)
// Grading: every call first settles any leg whose game is over, from ESPN's final score.
import { ROUTES, scoreboardUrl, liveBoard, ymd } from "../../src/routes.js";
import { gradeLeg, settleSlip, bettorStats, leaderboards, readOdds, amToDec, decToAm, USERNAME_RE } from "../../src/bets.js";
import { sportOfSeries, priceToAm, importKey, signHeaders, syncPayload, API_ROOT } from "../../src/kalshi.js";

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
  try { await env.DB.prepare("ALTER TABLE slips ADD COLUMN tail TEXT").run(); } catch (_) { /* already there */ }
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS sync_keys (email TEXT PRIMARY KEY, env TEXT NOT NULL, key_id TEXT NOT NULL, secret TEXT NOT NULL, created TEXT NOT NULL, synced TEXT, fails INTEGER NOT NULL DEFAULT 0, last_error TEXT)").run();
  ready = true;
}
const setting = async (env, k) => (await env.DB.prepare("SELECT v FROM settings WHERE k=?").bind(k).first())?.v ?? null;
const setSetting = (env, k, v) => env.DB.prepare("INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(k, v).run();
const rowToSlip = r => ({ id: r.id, created: r.created, stake: r.stake, odds: r.odds, status: r.status, profit: r.profit, settled: r.settled, legs: JSON.parse(r.legs), kalshi: r.kalshi ? JSON.parse(r.kalshi) : null, tail: r.tail || null });
// someone else's slip: that it went through Kalshi, never their order or quote ids
// (plus the market, side and size, so anyone can see what it would cash out for right now)
function publicKalshi(k) {
  const o = (k.orders || [])[0], mkt = k.combo ? k.combo.market_ticker : o?.ticker || null;
  const count = k.combo ? Number(k.combo.contracts) || 0 : (k.orders || []).filter(x => x.ticker === mkt).reduce((a, x) => a + (Number(x.filled) || 0), 0);
  return { env: k.env, combo: !!k.combo, imported: !!k.imported, mkt, side: k.combo ? "yes" : o?.side === "no" ? "no" : "yes", count: Math.round(count * 100) / 100, dec: k.dec > 1 ? k.dec : null };
}
const publicSlip = (s, mine) => (mine || !s.kalshi ? s : { ...s, kalshi: publicKalshi(s.kalshi) });

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
  for (const s of slips) for (const l of s.legs) if (!l.res && l.market !== "kalshi" && Date.parse(l.date) < now) want.set(`${l.sport}|${l.league}|${ymd(new Date(l.date))}`, null);
  const kx = new Map();
  for (const s of slips) for (const l of s.legs) if (!l.res && l.market === "kalshi" && kx.size < 40) kx.set(`${l.kenv || "live"}|${l.ticker}`, null);
  await Promise.all([...kx.keys()].map(async k => { const [e, t] = k.split("|"); kx.set(k, await kalshiMarket(env, e, t)); }));
  const keys = [...want.keys()].slice(0, 40);
  await Promise.all(keys.map(async k => { const [sp, lg, d] = k.split("|"); try { want.set(k, new Map((await board(env, sp, lg, d)).map(r => [r.id, r]))); } catch (_) { /* next time */ } }));
  const writes = [];
  for (const s of slips) {
    let changed = false;
    for (const l of s.legs) {
      if (!l.res && l.market === "kalshi") { const res = kalshiResult(kx.get(`${l.kenv || "live"}|${l.ticker}`), l.side); if (res) { l.res = res; changed = true; } continue; }
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
  // a game already underway is only accepted when the slip was actually bought on Kalshi (filled orders, live prices)
  const kalshi = cleanKalshi(body?.kalshi), boughtOnKalshi = !!kalshi && (kalshi.orders.some(o => o.filled > 0) || !!kalshi.combo?.contracts);
  for (const x of legsIn) {
    const odds = readOdds(x.odds);
    if (odds == null) return bad(`Odds for "${x.pick || "a pick"}" should look like -110 or +150.`);
    // a market picked straight from Kalshi (no scoreboard game behind it): only as a Kalshi purchase of that market
    if (x.market === "kalshi") {
      const ticker = String(x.ticker || "").slice(0, 120);
      if (!/^[A-Z0-9][\w.-]+$/.test(ticker)) return bad(`Couldn't read "${x.pick}".`);
      const bought = boughtOnKalshi && (kalshi.orders.some(o => o.ticker === ticker && o.filled > 0) || !!kalshi.combo?.contracts);
      if (!bought) return bad(`"${x.pick}" is a Kalshi market: it can only be added by buying it on Kalshi.`);
      const mkt = await kalshiMarket(env, kalshi.env, ticker);
      if (!mkt) return bad(`Couldn't find "${x.pick}" on Kalshi.`);
      if (seen.has(ticker)) return bad(`"${x.pick}" is on the slip twice.`);
      seen.add(ticker);
      const title = String(mkt.title || x.title || "").slice(0, 140), vs = title.split(/\s+vs\.?\s+|\s+at\s+/i);
      legs.push({ pick: String(x.pick || "").slice(0, 80), sport: String(x.sport || "Kalshi").slice(0, 20), league: "kalshi", eventId: ticker, ticker, kenv: kalshi.env, date: mkt.close_time || mkt.expected_expiration_time || new Date().toISOString(),
        market: "kalshi", side: "yes", line: null, odds, name: String(mkt.yes_sub_title || x.name || ticker).slice(0, 80), title,
        away: { name: vs.length === 2 ? vs[0] : title, abbr: "" }, home: { name: vs.length === 2 ? vs[1] : "", abbr: "" }, res: null, live: true });
      continue;
    }
    if (!ROUTES[x.sport] || !ROUTES[x.sport].leagues.includes(x.league)) return bad(`Couldn't place "${x.pick}".`);
    if (!["ml", "spread", "total", "draw"].includes(x.market)) return bad(`Couldn't read "${x.pick}".`);
    const side = x.market === "total" ? (x.side === "over" || x.side === "under" ? x.side : null) : x.market === "draw" ? "draw" : (x.side === "away" || x.side === "home" ? x.side : null);
    const line = x.market === "spread" || x.market === "total" ? Number(x.line) : null;
    if (!side || (line != null && !Number.isFinite(line))) return bad(`Couldn't read "${x.pick}".`);
    let rows;
    try { rows = await board(env, x.sport, x.league, ymd(new Date(x.date))); } catch (_) { return bad("Couldn't reach the scores routes to check the game. Try again.", 503); }
    const row = rows.find(r => r.id === String(x.eventId));
    if (!row) return bad(`Couldn't find the game for "${x.pick}".`);
    const pre = row.state === "pre" && Date.parse(row.date) > Date.now(), live = row.state === "in" || (row.state === "pre" && Date.parse(row.date) <= Date.now());
    if (row.state === "post") return bad(`"${x.pick}": that game is over.`);
    if (!pre && !(live && boughtOnKalshi)) return bad(`"${x.pick}": that game has already started. Live games can be bet by sending the slip to Kalshi.`);
    const k = `${row.id}|${x.market}|${side}`;
    if (seen.has(k)) return bad(`"${x.pick}" is on the slip twice.`);
    seen.add(k);
    legs.push({ pick: String(x.pick || "").slice(0, 80), sport: x.sport, league: x.league, eventId: row.id, date: row.date, market: x.market, side, line,
      odds, away: { name: row.away.name, abbr: row.away.abbr || "" }, home: { name: row.home.name, abbr: row.home.abbr || "" }, title: x.sport === "Tennis" || x.sport === "MMA" ? row.league : "", res: null, ...(pre ? {} : { live: true }) });
  }
  // a Kalshi combo is priced as one contract: its price is the slip's odds, not the legs multiplied
  const dec = kalshi?.dec > 1 ? kalshi.dec : legs.reduce((a, l) => a * amToDec(l.odds), 1), odds = decToAm(dec);
  // tailing someone: kept only if it's a real ticket that isn't yours (a tail of a tail credits the original)
  let tail = null;
  if (typeof body?.tail === "string" && body.tail.length <= 64) {
    const t = await env.DB.prepare("SELECT id, email, tail FROM slips WHERE id=?").bind(body.tail).first();
    if (t && t.email !== email) tail = t.tail || t.id;
  }
  const id = crypto.randomUUID(), created = new Date().toISOString();
  await env.DB.prepare("INSERT INTO slips (id, email, created, stake, odds, status, profit, settled, legs, kalshi, tail) VALUES (?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, ?, ?)").bind(id, email, created, stake, odds, JSON.stringify(legs), kalshi ? JSON.stringify(kalshi) : null, tail).run();
  return json({ slip: { id, created, stake, odds, status: "pending", profit: null, settled: null, legs, kalshi, tail } });
}

// ---------- everyone's tickets: riding now, and settled ----------
const PAST_PAGE = 40;
async function tickets(env, email, kind, q) {
  const names = Object.fromEntries((await env.DB.prepare("SELECT email, username FROM users").all()).results.map(u => [u.email, u.username]));
  let rows, more = false, totals = null;
  if (kind === "live") rows = (await env.DB.prepare("SELECT * FROM slips WHERE status='pending'").all()).results;
  else {
    const st = ["won", "lost", "push", "cashed"].includes(q.get("status")) ? [q.get("status")] : ["won", "lost", "push", "cashed"];
    const before = /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(q.get("before") || "") ? q.get("before") : "9999";
    rows = (await env.DB.prepare(`SELECT * FROM slips WHERE status IN (${st.map(() => "?").join(",")}) AND settled < ? ORDER BY settled DESC, id DESC LIMIT ?`).bind(...st, before, PAST_PAGE + 1).all()).results;
    more = rows.length > PAST_PAGE; rows = rows.slice(0, PAST_PAGE);
    // a cash-out counts as a win if it made money, a loss if it lost some, a push if it broke even
    const t = (await env.DB.prepare("SELECT CASE WHEN status='won' OR (status='cashed' AND profit>0) THEN 'W' WHEN status='lost' OR (status='cashed' AND profit<0) THEN 'L' ELSE 'P' END AS k, COUNT(*) AS n, SUM(profit) AS p FROM slips WHERE status IN ('won','lost','push','cashed') GROUP BY k").all()).results;
    const g = k => t.find(x => x.k === k) || { n: 0, p: 0 };
    totals = { W: g("W").n, L: g("L").n, P: g("P").n, net: Math.round(((g("W").p || 0) + (g("L").p || 0) + (g("P").p || 0)) * 100) / 100 };
  }
  // who's tailing whom
  const tc = {};
  for (const r of (await env.DB.prepare("SELECT tail, COUNT(*) AS n FROM slips WHERE tail IS NOT NULL GROUP BY tail").all()).results) tc[r.tail] = r.n;
  const tailIds = [...new Set(rows.map(r => r.tail).filter(Boolean))], owner = {};
  for (const tid of tailIds) { const o = await env.DB.prepare("SELECT email FROM slips WHERE id=?").bind(tid).first(); if (o) owner[tid] = names[o.email] || null; }
  const now = Date.now();
  const list = rows.map(r => {
    const s = rowToSlip(r);
    return { ...publicSlip(s, r.email === email), username: names[r.email] || "unknown", you: r.email === email, tails: tc[s.id] || 0, tailOf: s.tail ? owner[s.tail] || null : null,
      next: Math.min(...s.legs.filter(l => !l.res).map(l => Date.parse(l.date)).concat(Infinity)), live: s.status === "pending" && s.legs.some(l => l.res || Date.parse(l.date) <= now) };
  });
  if (kind === "live") list.sort((a, b) => (b.live - a.live) || a.next - b.next || String(b.created).localeCompare(String(a.created)));
  return json({ tickets: list.map(({ next, ...t }) => ({ ...t, next: Number.isFinite(next) ? new Date(next).toISOString() : null })), more, totals });
}

// one Kalshi market (public market data: no key needed), used to check a Kalshi-market leg and to grade it
async function kalshiMarket(env, which, ticker) {
  const host = (env.KALSHI_BASE && JSON.parse(env.KALSHI_BASE)[which === "demo" ? "demo" : "live"]) || KALSHI[which === "demo" ? "demo" : "live"];
  try { const r = await fetch(`${host}/trade-api/v2/markets/${encodeURIComponent(ticker)}`, { headers: { accept: "application/json", "user-agent": "bobbys-boardroom/1.0" } }); return r.ok ? (await r.json()).market || null : null; }
  catch (_) { return null; }
}
// a settled Kalshi market -> the leg's result: W / L on its side, P when Kalshi voids it
export function kalshiResult(m, side = "yes") {
  if (!m) return null;
  const r = String(m.result || "").toLowerCase();
  if (r === "yes" || r === "no") return r === side ? "W" : "L";
  if (/void|cancel/.test(r) || (/settled|finalized/.test(String(m.status || "")) && !r)) return "P";
  return null;
}

// ---------- syncing: every open Kalshi position becomes a ticket here, wherever it was bought ----------
// The page reads the positions with the person's own key (never sent here) and posts them. Kalshi's position is the
// truth for every pending Kalshi ticket: one bought elsewhere (the Kalshi app) becomes a "synced" ticket, and a ticket
// placed on this site is held to the position too, so its bet and contracts are always what Kalshi shows (bought more
// in the app, sold some, or a slip that recorded the wrong size). Tickets grade on Kalshi's own result as before.
const SYNC_FRESH = 60000;                // a slip placed in the last minute is left alone: its fill may still be landing
async function syncKalshi(env, email, body) { return json(await syncCore(env, email, body)); }
async function syncCore(env, email, body) {
  const kenv = body?.env === "demo" ? "demo" : "live", now = Date.now();
  const str = (v, n = 140) => String(v ?? "").slice(0, n), TICK = /^[A-Z0-9][\w.-]{2,119}$/, r2 = v => Math.round(v * 100) / 100;
  const rows = (await env.DB.prepare("SELECT * FROM slips WHERE email=? AND status='pending' AND kalshi IS NOT NULL").bind(email).all()).results.map(rowToSlip);
  const covered = new Set(), synced = new Map(), mine = new Map();
  const held = s => (s.kalshi.combo ? Number(s.kalshi.combo.contracts) || 0 : (s.kalshi.orders || []).reduce((a, o) => a + (Number(o.filled) || 0), 0));
  for (const s of rows) {
    if (s.kalshi.imported) { synced.set(`${s.kalshi.mkt}|${s.kalshi.side}`, s); continue; }
    if (s.kalshi.combo?.market_ticker) covered.add(s.kalshi.combo.market_ticker);
    for (const o of s.kalshi.orders || []) covered.add(o.ticker);
    // a slip placed here sits on one Kalshi market and side
    const one = publicKalshi(s.kalshi);
    if (one.mkt && s.kalshi.env === kenv && (s.kalshi.combo || (s.kalshi.orders || []).every(o => o.ticker === one.mkt))) { const k = `${one.mkt}|${one.side}`; mine.set(k, [...(mine.get(k) || []), s]); }
  }
  const seen = new Set(), writes = [];
  let added = 0, updated = 0;
  for (const p of (Array.isArray(body?.positions) ? body.positions : []).slice(0, 100)) {
    const ticker = str(p.ticker, 120), side = p.side === "no" ? "no" : "yes", count = r2(Number(p.count)), cost = r2(Number(p.cost));
    if (!TICK.test(ticker) || !(count > 0 && count <= 1e6) || !(cost > 0 && cost <= count)) continue;
    const key = `${ticker}|${side}`;
    seen.add(key);
    if (covered.has(ticker)) {
      // placed on this site: the ticket follows the position. Several tickets on one market share it by their size.
      const list = mine.get(key) || [];
      if (!list.length || list.some(s => now - Date.parse(s.created) < SYNC_FRESH)) continue;
      const S = list.reduce((a, s) => a + held(s), 0), St = list.reduce((a, s) => a + s.stake, 0);
      if (Math.abs(S - count) < 0.005 && Math.abs(St - cost) < 0.015) continue;
      let leftC = count, leftS = cost;
      list.forEach((s, i) => {
        const last = i === list.length - 1, share = S > 0 ? held(s) / S : 1 / list.length;
        const c = last ? r2(leftC) : r2(count * share), st = last ? r2(leftS) : r2(cost * share);
        leftC -= c; leftS -= st;
        if (!(c > 0 && st >= 0.01) || (Math.abs(c - held(s)) < 0.005 && Math.abs(st - s.stake) < 0.015)) return;
        const dec = c / st, k = { ...s.kalshi, dec, placed: s.kalshi.placed || { stake: s.stake, contracts: held(s), odds: s.odds }, matched: new Date(now).toISOString() };
        if (k.combo) k.combo = { ...k.combo, contracts: c };
        else { const o = k.orders[0]; k.orders = [{ ...o, count: c, filled: c }]; }
        writes.push(env.DB.prepare("UPDATE slips SET stake=?, odds=?, kalshi=? WHERE id=? AND status='pending'").bind(st, decToAm(dec), JSON.stringify(k), s.id)); updated++;
      });
      continue;
    }
    const price = Math.min(0.99, Math.max(0.01, cost / count)), dec = 1 / price;
    const legsIn = p.combo && Array.isArray(p.legs) && p.legs.length ? p.legs.slice(0, 20) : [{ ticker, side, name: p.name, title: p.title, close: p.close, price }];
    const legs = legsIn.filter(l => TICK.test(str(l.ticker, 120))).map(l => {
      const t = str(l.ticker, 120), title = str(l.title), vs = title.split(/\s+vs\.?\s+|\s+at\s+/i), lp = Number(l.price);
      return { pick: str(l.name || t, 80), sport: sportOfSeries(t.split("-")[0]), league: "kalshi", eventId: t, ticker: t, kenv, date: Date.parse(l.close) ? new Date(l.close).toISOString() : new Date(Date.now() + 864e5).toISOString(),
        market: "kalshi", side: l.side === "no" ? "no" : "yes", line: null, odds: priceToAm(lp > 0 && lp < 1 ? lp : price) || decToAm(dec), name: str(l.name || t, 80), title,
        away: { name: vs.length === 2 ? vs[0] : title, abbr: "" }, home: { name: vs.length === 2 ? vs[1] : "", abbr: "" }, res: null, live: true };
    });
    if (!legs.length) continue;
    // the ticket pays its contracts: bet x dec = contracts, with the fees in the bet
    const odds = decToAm(dec), kalshi = { env: kenv, imported: true, mkt: ticker, side, count, dec: count / cost,
      ...(legs.length > 1 ? { combo: { market_ticker: ticker, contracts: count, price } } : { orders: [{ ticker, side, count, price, order_id: null, filled: count }] }) };
    const old = synced.get(key);
    if (old) {
      if (Math.abs((old.kalshi.count || 0) - count) < 0.005 && Math.abs(old.stake - cost) < 0.005) continue;
      writes.push(env.DB.prepare("UPDATE slips SET stake=?, odds=?, kalshi=? WHERE id=? AND status='pending'").bind(cost, odds, JSON.stringify(kalshi), old.id)); updated++;
    } else {
      const created = Date.parse(p.since) ? new Date(p.since).toISOString() : new Date().toISOString();
      writes.push(env.DB.prepare("INSERT INTO slips (id, email, created, stake, odds, status, profit, settled, legs, kalshi, tail) VALUES (?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, ?, NULL)").bind(crypto.randomUUID(), email, created, cost, odds, JSON.stringify(legs), JSON.stringify(kalshi))); added++;
    }
  }
  if (writes.length) await env.DB.batch(writes);
  // tickets that aren't open on Kalshi any more: settled (graded here from Kalshi's result) or sold in the app.
  // The caller checks each one against Kalshi (market still open, position really at zero) before cashing it.
  const gone = [...synced.entries()].filter(([k, s]) => !seen.has(k) && s.kalshi.env === kenv).map(([, s]) => ({ id: s.id, ticker: s.kalshi.mkt, side: s.kalshi.side, stake: s.stake, created: s.created }));
  for (const [k, list] of mine) if (!seen.has(k)) for (const s of list) if (now - Date.parse(s.created) > 2 * SYNC_FRESH) gone.push({ id: s.id, ticker: k.split("|")[0], side: k.split("|")[1], stake: s.stake, created: s.created });
  return { added, updated, gone };
}

// ---------- opt-in server sync: read-only keys, encrypted at rest when SYNC_SECRET is set ----------
const b64e = buf => { let s = ""; const a = new Uint8Array(buf); for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s); };
const b64d = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function aesKey(env) { if (!env.SYNC_SECRET) return null; const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(env.SYNC_SECRET)); return crypto.subtle.importKey("raw", h, "AES-GCM", false, ["encrypt", "decrypt"]); }
async function seal(env, text) {
  const k = await aesKey(env); if (!k) return `plain:${text}`;
  const iv = crypto.getRandomValues(new Uint8Array(12)), ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, new TextEncoder().encode(text));
  return `aes:${b64e(iv)}:${b64e(ct)}`;
}
async function unseal(env, stored) {
  if (stored.startsWith("plain:")) return stored.slice(6);
  const [, iv, ct] = stored.split(":"), k = await aesKey(env);
  if (!k) throw new Error("sync secret missing");
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64d(iv) }, k, b64d(ct)));
}
const kHost = (env, which) => (env.KALSHI_BASE && JSON.parse(env.KALSHI_BASE)[which === "demo" ? "demo" : "live"]) || KALSHI[which === "demo" ? "demo" : "live"];
async function kalshiAsUser(env, rec, sub) {
  const h = await signHeaders(rec, "GET", `${API_ROOT}/${sub}`);
  const r = await fetch(`${kHost(env, rec.env)}${API_ROOT}/${sub}`, { headers: { ...h, accept: "application/json", "user-agent": "bobbys-boardroom/1.0" } });
  if (!r.ok) { const e = new Error(`Kalshi ${r.status}`); e.status = r.status; throw e; }
  return r.json();
}
// one person: positions with their read-only key -> tickets (same rules as the on-device sync), and sold-in-the-app
async function serverSyncOne(env, row) {
  const pem = await unseal(env, row.secret), { key, kind } = await importKey(pem), rec = { key, kind, keyId: row.key_id, env: row.env };
  const positions = [];
  let cursor = "";
  for (let i = 0; i < 5; i++) {
    const j = await kalshiAsUser(env, rec, `portfolio/positions?count_filter=position&limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    positions.push(...(j.market_positions || [])); cursor = j.cursor || ""; if (!cursor) break;
  }
  const open = positions.filter(p => parseFloat(p.position_fp ?? p.position) !== 0).slice(0, 60), mkts = {};
  const getM = async t => { if (t in mkts) return; mkts[t] = (await kalshiMarket(env, row.env, t)) || {}; };
  for (let i = 0; i < open.length; i += 6) await Promise.all(open.slice(i, i + 6).map(p => getM(p.ticker)));
  const legT = [...new Set(open.flatMap(p => (mkts[p.ticker]?.mve_selected_legs || []).map(l => l.market_ticker)))].slice(0, 60);
  for (let i = 0; i < legT.length; i += 6) await Promise.all(legT.slice(i, i + 6).map(getM));
  const r = await syncCore(env, row.email, { env: row.env, positions: syncPayload(open, mkts) });
  for (const g of r.gone || []) {
    const m = await kalshiMarket(env, row.env, g.ticker);
    if (!m || m.result || /settled|finalized|determined|closed/.test(String(m.status || ""))) continue;
    const p = (await kalshiAsUser(env, rec, `portfolio/positions?ticker=${encodeURIComponent(g.ticker)}`).catch(() => ({}))).market_positions?.find(x => x.ticker === g.ticker);
    if (!p || parseFloat(p.position_fp ?? p.position) !== 0) continue;
    const made = (parseFloat(p.realized_pnl_dollars) || 0) - (parseFloat(p.fees_paid_dollars) || 0);
    await cashOut(env, row.email, g.id, { proceeds: Math.max(0, Math.round((g.stake + made) * 100) / 100), sale: { how: "order" } });
  }
  return r;
}
// everyone who opted in, at most once a minute each (run when someone looks at the tickets)
async function serverSyncAll(env, force = false) {
  const last = Number(await setting(env, "sync_all_at")) || 0;
  if (!force && Date.now() - last < 45000) return;
  await setSetting(env, "sync_all_at", String(Date.now()));
  const rows = (await env.DB.prepare("SELECT * FROM sync_keys").all()).results.slice(0, 25);
  for (const row of rows) {
    try {
      await serverSyncOne(env, row);
      await env.DB.prepare("UPDATE sync_keys SET synced=?, fails=0, last_error=NULL WHERE email=?").bind(new Date().toISOString(), row.email).run();
    } catch (e) {
      // a key that Kalshi keeps refusing (deleted on kalshi.com) is dropped after a few tries
      if (e.status === 401 && row.fails >= 4) await env.DB.prepare("DELETE FROM sync_keys WHERE email=?").bind(row.email).run();
      else await env.DB.prepare("UPDATE sync_keys SET fails=fails+1, last_error=? WHERE email=?").bind(String(e.message || e).slice(0, 200), row.email).run();
    }
  }
}

// ---------- cashing out a Kalshi slip: sold back on Kalshi, settled here at what the sale brought ----------
async function cashOut(env, email, id, body) {
  const r = await env.DB.prepare("SELECT * FROM slips WHERE id=? AND email=?").bind(id, email).first();
  if (!r) return bad("Slip not found.", 404);
  const s = rowToSlip(r);
  if (s.status !== "pending") return bad("That slip is already settled.", 409);
  if (!s.kalshi) return bad("Only slips bought on Kalshi can be cashed out.", 409);
  const most = s.kalshi.combo ? Number(s.kalshi.combo.contracts) || 0 : (s.kalshi.orders || []).reduce((a, o) => a + (Number(o.filled) || 0), 0);
  if (!(most > 0)) return bad("That slip has no Kalshi contracts on it.");
  const proceeds = Math.round(Number(body?.proceeds) * 100) / 100;
  if (!(proceeds >= 0) || proceeds > most + 0.01) return bad("That cash-out amount doesn't fit the slip.");
  const str = (v, n = 80) => (v == null ? null : String(v).slice(0, n)), num = v => (Number.isFinite(Number(v)) ? Number(v) : null);
  const sale = body?.sale || {};
  const kalshi = { ...s.kalshi, cashout: { at: new Date().toISOString(), proceeds, how: sale.how === "rfq" ? "rfq" : "order", order_id: str(sale.order_id), quote_id: str(sale.quote_id), price: num(sale.price), count: num(sale.count) } };
  const profit = Math.round((proceeds - s.stake) * 100) / 100, settled = new Date().toISOString();
  await env.DB.prepare("UPDATE slips SET status='cashed', profit=?, settled=?, kalshi=? WHERE id=? AND status='pending'").bind(profit, settled, JSON.stringify(kalshi), s.id).run();
  return json({ slip: { ...s, status: "cashed", profit, settled, kalshi } });
}

// ---------- Kalshi relay ----------
// Kalshi doesn't take calls straight from a browser, so the page sends each request here, already signed on the person's
// device with their own key. This passes it on unchanged: it never sees a key (only a signature that's good for this one
// request and expires), keeps nothing, and only reaches the Kalshi paths the slip flow uses.
const KALSHI = { live: "https://external-api.kalshi.com", demo: "https://external-api.demo.kalshi.co" };
const KPATH = /^(api_keys\/generate|api_keys\/[\w-]+|portfolio\/balance|portfolio\/intra_exchange_instance_transfer|portfolio\/events\/orders|portfolio\/orders\/[\w-]+|portfolio\/fills|portfolio\/positions|events|markets\/[\w.-]+(\/orderbook)?|multivariate_event_collections(\/[\w.-]+)?|communications\/rfqs(\/[\w-]+(\/quotes\/[\w-]+\/accept)?)?|communications\/quotes)$/;
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
export async function onRequest({ request, env, params, waitUntil }) {
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

  if (what === "kalshi-sync") {
    if (m === "GET") { const r = await env.DB.prepare("SELECT env, key_id, created, synced, fails, last_error FROM sync_keys WHERE email=?").bind(email).first(); return json(r ? { on: true, env: r.env, tail: r.key_id.slice(-4), created: r.created, synced: r.synced, error: r.fails ? r.last_error : null } : { on: false }); }
    if (m === "POST") {
      const keyId = String(body?.keyId || "").trim(), pem = String(body?.pem || "");
      if (!/^[\w-]{8,80}$/.test(keyId) || !/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+-----END [A-Z ]*PRIVATE KEY-----/.test(pem) || pem.length > 8000) return bad("That read-only key doesn't look right.");
      try { await importKey(pem); } catch (e) { return bad(e.message); }
      await env.DB.prepare("INSERT INTO sync_keys (email, env, key_id, secret, created) VALUES (?, ?, ?, ?, ?) ON CONFLICT(email) DO UPDATE SET env=excluded.env, key_id=excluded.key_id, secret=excluded.secret, created=excluded.created, synced=NULL, fails=0, last_error=NULL")
        .bind(email, body?.env === "demo" ? "demo" : "live", keyId, await seal(env, pem), new Date().toISOString()).run();
      const row = await env.DB.prepare("SELECT * FROM sync_keys WHERE email=?").bind(email).first();
      let first = null;
      try { first = await serverSyncOne(env, row); await env.DB.prepare("UPDATE sync_keys SET synced=? WHERE email=?").bind(new Date().toISOString(), email).run(); } catch (e) { first = { error: e.message }; }
      return json({ on: true, tail: keyId.slice(-4), first });
    }
    if (m === "DELETE") { const r = await env.DB.prepare("SELECT key_id, env FROM sync_keys WHERE email=?").bind(email).first(); await env.DB.prepare("DELETE FROM sync_keys WHERE email=?").bind(email).run(); return json({ on: false, keyId: r?.key_id || null, env: r?.env || null }); }
  }
  if (what === "slips" && m === "POST" && !path[1]) return placeSlip(env, email, body);
  if (what === "slips" && m === "POST" && path[1] === "sync") return syncKalshi(env, email, body);
  if (what === "slips" && m === "DELETE" && path[1]) {
    const r = await env.DB.prepare("SELECT * FROM slips WHERE id=? AND email=?").bind(path[1], email).first();
    if (!r) return bad("Slip not found.", 404);
    const s = rowToSlip(r);
    if (s.kalshi) return bad("That slip was bought on Kalshi: cash it out instead.", 409);
    if (s.status !== "pending" || s.legs.some(l => Date.parse(l.date) <= Date.now() || l.res || l.live || l.market === "kalshi")) return bad("A game on that slip has started (or it was bought live on Kalshi), so it stays.", 409);
    await env.DB.prepare("DELETE FROM slips WHERE id=?").bind(s.id).run();
    return json({ ok: true });
  }
  if (what === "slips" && m === "POST" && path[1] && path[2] === "cashout") return cashOut(env, email, path[1], body);

  if (m === "GET" && (what === "tickets" || what === "slips")) {
    const run = serverSyncAll(env).catch(() => {});
    if (env.SYNC_INLINE === "1") await run;
    else { await Promise.race([run, new Promise(r => setTimeout(r, 4000))]); if (waitUntil) waitUntil(run); }
  }
  await gradePending(env).catch(() => {});
  const slipsOf = async em => (await env.DB.prepare("SELECT * FROM slips WHERE email=? ORDER BY created DESC").bind(em).all()).results.map(rowToSlip);
  if (what === "slips" && m === "GET") { const slips = await slipsOf(email); return json({ username: me.username, slips, stats: bettorStats(slips) }); }
  if (what === "user" && m === "GET" && path[1]) {
    const u = await env.DB.prepare("SELECT email, username FROM users WHERE uname=?").bind(String(path[1]).toLowerCase()).first();
    if (!u) return bad("No one goes by that username.", 404);
    const slips = await slipsOf(u.email);
    return json({ username: u.username, you: u.email === email, slips: slips.map(s => publicSlip(s, u.email === email)), stats: bettorStats(slips) });
  }
  if (what === "tickets" && m === "GET") return tickets(env, email, path[1] === "past" ? "past" : "live", new URL(request.url).searchParams);
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
