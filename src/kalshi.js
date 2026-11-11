// Kalshi: match a slip's picks to Kalshi's markets, price them, and sign each request on the person's own device.
// Each person's API key lives only in their browser (a non-extractable WebCrypto key in IndexedDB): the site's server
// never sees it. Requests are signed here and passed through the site's relay (/api/kalshi), because Kalshi doesn't
// accept calls straight from a browser.
import { teamQueryScore } from "./routes.js";

export const KALSHI_HOST = { live: "https://external-api.kalshi.com", demo: "https://external-api.demo.kalshi.co" };
export const API_ROOT = "/trade-api/v2";

// ---------- which Kalshi series carries each of our leagues ----------
const SOCCER = { "eng.1": "EPL", "esp.1": "LALIGA", "ger.1": "BUNDESLIGA", "ita.1": "SERIEA", "fra.1": "LIGUE1", "usa.1": "MLS", "mex.1": "LIGAMX", "uefa.champions": "UCL", "uefa.europa": "UEL", "fifa.friendly": "INTLFRIENDLY" };
const TEAM = { NBA: "NBA", NFL: "NFL", CFB: "NCAAF", CBB: "NCAAMB", CBBW: "NCAAWB", NHL: "NHL", MLB: "MLB", WNBA: "WNBA" };
export function seriesFor(sport, league, market) {
  if (sport === "Tennis") return market === "ml" ? (league === "wta" ? "KXWTAMATCH" : "KXATPMATCH") : null;
  if (sport === "MMA") return market === "ml" ? "KXUFCFIGHT" : null;
  const base = sport === "Soccer" ? SOCCER[league] : TEAM[sport];
  if (!base) return null;
  return `KX${base}${market === "spread" ? "SPREAD" : market === "total" ? "TOTAL" : "GAME"}`;
}

// ---------- prices ----------
export const dollars = v => { const x = parseFloat(v); return Number.isFinite(x) ? x : null; };
export const priceToAm = p => { if (!(p > 0 && p < 1)) return null; const d = 1 / p; return d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1)); };
export const cents = p => `${Math.round(p * 100)}¢`;
// Kalshi's trading fee: 7% x contracts x price x (1 - price), rounded up to the cent (an estimate shown before confirming)
export const feeEstimate = (count, p) => Math.ceil(0.07 * count * p * (1 - p) * 100 - 1e-9) / 100;
// contracts for a dollar amount at a price (fractions to 0.01 are allowed), and what it costs and pays.
// The amount is everything that leaves the account: cost plus Kalshi's fee never comes to more than `stake`
// (the same way Kalshi sizes a combo bought by dollar amount).
export function sizeOrder(stake, p) {
  if (!(stake > 0) || !(p > 0 && p < 1)) return null;
  let count = Math.floor((stake / (p + 0.07 * p * (1 - p))) * 100 + 1e-9) / 100;
  const over = n => Math.round(n * p * 100) / 100 + feeEstimate(n, p) > stake + 1e-9;
  while (count > 0 && over(count)) count = Math.round((count - 0.01) * 100) / 100;
  if (!(count > 0)) return null;
  const cost = Math.round(count * p * 100) / 100, fee = feeEstimate(count, p);
  return { count, cost, fee, payout: Math.round(count * 100) / 100, profit: Math.round((count - cost - fee) * 100) / 100 };
}

// ---------- matching a pick to a Kalshi market ----------
const MON = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
const dayOfCode = code => { const m = String(code).match(/^(\d\d)([A-Z]{3})(\d\d)/); return m ? Date.UTC(2000 + Number(m[1]), MON[m[2]], Number(m[3])) : null; };
const etDayUTC = iso => { const s = new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" }); const [y, mo, d] = s.split("-").map(Number); return Date.UTC(y, mo - 1, d); };
const suffix = t => String(t || "").split("-").pop().replace(/\d+$/, "").toUpperCase();
const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
function teamScore(t, m) {
  if (!t) return 0;
  const sub = m.yes_sub_title || "";
  if (t.abbr && suffix(m.ticker) === String(t.abbr).toUpperCase()) return 3;
  const T = { name: t.full || t.name, short: t.name, abbr: t.abbr, nick: t.nick || "", loc: t.loc || "" };
  let s = teamQueryScore(T, sub);
  // a person's name: the surname is enough ("Shelton" / "Ben Shelton")
  const a = norm(t.full || t.name).split(" ").pop(), b = norm(sub).split(" ").pop();
  if (a && b && a === b && a.length >= 3) s = Math.max(s, 2);
  return s;
}
// the GAME (or MATCH / FIGHT) event for this leg's game: both sides found among its markets, within a day of the start
export function findGameEvent(events, leg) {
  const day = etDayUTC(leg.date);
  let best = null;
  for (const e of events || []) {
    const code = String(e.event_ticker || "").split("-")[1] || "", d = dayOfCode(code);
    if (d != null && Math.abs(d - day) > 864e5 * 1.01) continue;
    const ms = (e.markets || []).filter(m => !/^tie$/i.test(m.yes_sub_title || ""));
    const pick = side => ms.map(m => ({ m, s: teamScore(leg[side], m) })).sort((x, y) => y.s - x.s)[0];
    const A = pick("away"), H = pick("home");
    if (!A || !H || A.s < 2 || H.s < 2 || A.m.ticker === H.m.ticker) continue;
    const score = A.s + H.s - (d == null ? 0 : Math.abs(d - day) / 864e5);
    if (!best || score > best.score) best = { e, code, away: A.m, home: H.m, tie: (e.markets || []).find(m => /^tie$/i.test(m.yes_sub_title || "")) || null, score };
  }
  return best;
}
const ask = (m, side) => dollars(side === "yes" ? m.yes_ask_dollars : m.no_ask_dollars);
const open = m => !m.status || m.status === "active" || m.status === "open";
// One leg -> the Kalshi market and side to buy, at the current ask. When Kalshi doesn't list the exact line, the
// nearest lines it does list come back as options (picking one changes the pick to that line).
export function mapLeg(leg, bySeries) {
  const gameS = seriesFor(leg.sport, leg.league, "ml");
  if (!gameS) return { ok: false, why: "Kalshi doesn't list this league." };
  const g = findGameEvent(bySeries[gameS], leg);
  if (!g) return { ok: false, why: "Couldn't find this game on Kalshi (it may not be listed yet)." };
  const teamMk = side => (side === "away" ? g.away : g.home), other = side => (side === "away" ? "home" : "away");
  const done = (m, side, line, label) => {
    const p = m ? ask(m, side) : null;
    if (!m || !open(m)) return { ok: false, why: "That market isn't open on Kalshi right now." };
    if (!(p > 0 && p < 1)) return { ok: false, why: "No one is selling that side on Kalshi right now." };
    return { ok: true, ticker: m.ticker, event_ticker: m.event_ticker, side, price: p, am: priceToAm(p), line, label, title: m.yes_sub_title };
  };
  if (leg.market === "ml") return done(teamMk(leg.side), "yes", null, `${teamMk(leg.side).yes_sub_title} to win`);
  if (leg.market === "draw") return g.tie ? done(g.tie, "yes", null, "Tie") : { ok: false, why: "Kalshi has no draw market for this game." };
  const ser = seriesFor(leg.sport, leg.league, leg.market), ev = (bySeries[ser] || []).find(e => String(e.event_ticker).split("-")[1] === g.code);
  if (!ev) return { ok: false, why: `Kalshi has no ${leg.market} market for this game yet.` };
  const ms = (ev.markets || []).filter(open), strike = m => dollars(m.floor_strike);
  if (leg.market === "total") {
    const lines = [...new Set(ms.map(strike).filter(x => x != null))].sort((a, b) => a - b);
    const m = ms.find(x => strike(x) === leg.line);
    if (m) return done(m, leg.side === "over" ? "yes" : "no", leg.line, `${leg.side === "over" ? "Over" : "Under"} ${leg.line}`);
    return { ok: false, why: `Kalshi doesn't list a total of ${leg.line}.`, options: nearest(lines, leg.line).map(x => ({ line: x, text: `${leg.side} ${x}` })) };
  }
  // spread: Kalshi lists "TEAM wins by over N.5" for each team. A minus line buys YES on that team's market; a plus
  // line buys NO on the other team's market at the same number.
  const fav = leg.line < 0 ? leg.side : other(leg.side), favCode = suffix(teamMk(fav).ticker), k = Math.abs(leg.line);
  const forTeam = code => ms.filter(m => suffix(m.ticker) === code);
  const m = forTeam(favCode).find(x => strike(x) === k);
  if (m) return done(m, leg.line < 0 ? "yes" : "no", leg.line, `${teamMk(leg.side).yes_sub_title} ${leg.line > 0 ? "+" : ""}${leg.line}`);
  const lines = forTeam(favCode).map(strike).filter(x => x != null).sort((a, b) => a - b);
  return { ok: false, why: `Kalshi doesn't list ${leg.line > 0 ? "+" : ""}${leg.line} for this game.`, options: nearest(lines, k).map(x => ({ line: leg.line < 0 ? -x : x, text: `${leg.line < 0 ? "-" : "+"}${x}` })) };
}
// the closest line Kalshi lists on each side of the one asked for
const nearest = (lines, x) => { const lo = lines.filter(v => v < x), hi = lines.filter(v => v > x); return [lo.length ? Math.max(...lo) : null, hi.length ? Math.min(...hi) : null].filter(v => v != null); };

// a combo (parlay) on Kalshi: the open combo collection that holds every leg's game
export function comboCollection(collections, mapped) {
  const evs = mapped.map(m => m.event_ticker);
  const ok = (collections || []).filter(c => evs.every(e => (c.associated_event_tickers || []).includes(e)));
  return ok.find(c => /SPORTS/.test(c.collection_ticker)) || ok[0] || null;
}
// a quote on a combo: buying YES means accepting the maker's NO side, at 1 - no_bid
// Kalshi only lists quotes for a requester's own RFQ with rfq_user_filter=self (rfq_id alone is refused with a 403)
export const quotesPath = rfqId => `communications/quotes?rfq_user_filter=self&rfq_id=${encodeURIComponent(rfqId)}`;
// the first value that reads as a number above zero (Kalshi sends "0.00" for the fields a quote doesn't use)
export const firstPos = (...vs) => { for (const v of vs) { const x = dollars(v); if (x > 0) return x; } return null; };
// contracts a quote fills when you BUY YES: the maker's NO side (no_contracts_fp). A quote on an ask made by dollar
// amount carries two sizes, one per side: yes_contracts_fp is the size if you took the maker's YES bid instead, and is
// never the size of a YES purchase. (Reading it sized a $50 combo as 55 contracts when Kalshi filled 395.)
export const buyYesContracts = q => firstPos(q?.no_contracts_fp, q?.contracts_fp);
// contracts a quote fills when you SELL YES into the maker's YES bid
export const sellYesContracts = q => firstPos(q?.contracts_fp, q?.yes_contracts_fp);
// maxPrice: only quotes at that price or better; skip: quote ids already tried
export function bestComboQuote(quotes, { maxPrice = 1, skip = null } = {}) {
  const open = (quotes || []).filter(q => q.status === "open" && dollars(q.no_bid_dollars) > 0 && 1 - dollars(q.no_bid_dollars) <= maxPrice + 1e-9 && !(skip && skip.has(q.id)));
  if (!open.length) return null;
  const q = open.sort((a, b) => dollars(b.no_bid_dollars) - dollars(a.no_bid_dollars))[0];
  const price = Math.round((1 - dollars(q.no_bid_dollars)) * 10000) / 10000;
  return { quote: q, price, am: priceToAm(price), contracts: buyYesContracts(q) };
}
// what a combo quote costs against the dollars asked for: contracts, cost, fee, total, payout.
// est: Kalshi's quote didn't carry a size, so it's worked out from the dollars asked (the fill is read back after).
// over: it would cost more than the slip says, so it is never bought. short: it covers well under the amount asked.
export function comboCost(best, stake) {
  if (!best || !(best.price > 0 && best.price < 1) || !(stake > 0)) return null;
  const est = !(best.contracts > 0), p = best.price;
  const contracts = est ? sizeOrder(stake, p)?.count : best.contracts;
  if (!(contracts > 0)) return null;
  const cost = Math.round(contracts * p * 100) / 100, fee = feeEstimate(contracts, p), total = Math.round((cost + fee) * 100) / 100;
  return { contracts, est, cost, fee, total, payout: Math.round(contracts * 100) / 100, over: total > stake + 0.02, short: total < stake * 0.9 - 0.02 };
}
// what Kalshi actually filled, from GET portfolio/fills for one order: contracts, dollars at the fill prices, fees.
// side: the side bought or sold ("yes" / "no"); each fill carries both prices.
export function fillTotals(fills, side = "yes") {
  let count = 0, gross = 0, fee = 0;
  for (const f of fills || []) {
    const n = dollars(f.count_fp ?? f.count), p = dollars(side === "no" ? f.no_price_dollars : f.yes_price_dollars);
    if (!(n > 0) || !(p > 0 && p < 1)) continue;
    count += n; gross += n * p; fee += dollars(f.fee_cost) || 0;
  }
  if (!(count > 0)) return null;
  const r2 = v => Math.round(v * 100) / 100;
  // total: what a buy took from the account; net: what a sale put back
  return { count: r2(count), gross: r2(gross), fee: r2(fee), total: r2(gross + fee), net: r2(gross - fee), price: gross / count };
}

// ---------- cashing out: selling a position back at Kalshi's current bids ----------
// your position on a market from GET portfolio/positions: positive = YES contracts, negative = NO
export function positionOf(j, ticker) {
  const p = (j?.market_positions || []).find(x => x.ticker === ticker);
  const n = p ? dollars(p.position_fp ?? p.position) : 0;
  return !n ? { side: null, count: 0 } : { side: n > 0 ? "yes" : "no", count: Math.abs(n) };
}
// what selling `count` contracts of `side` would bring right now: walk the bids for that side, best first.
// Kalshi lists only bids: holders of YES sell into YES bids, holders of NO into NO bids.
export function sellValue(book, side, count) {
  const lv = ((side === "no" ? book?.no_dollars : book?.yes_dollars) || []).map(([p, q]) => [dollars(p), dollars(q)]).filter(([p, q]) => p > 0 && q > 0).sort((a, b) => b[0] - a[0]);
  let left = count, gross = 0, worst = null;
  for (const [p, q] of lv) { if (left <= 1e-9) break; const take = Math.min(left, q); gross += take * p; left -= take; worst = p; }
  const filled = Math.round((count - Math.max(0, left)) * 100) / 100;
  if (!(filled > 0)) return { ok: false, filled: 0, why: "No one is bidding on this position on Kalshi right now." };
  const avg = gross / filled, fee = feeEstimate(filled, avg), net = Math.round((gross - fee) * 100) / 100;
  return { ok: filled >= count - 1e-9, filled, avg, worst, gross: Math.round(gross * 100) / 100, fee, net, why: filled < count - 1e-9 ? `Kalshi's buyers only take ${filled} of your ${count} contracts right now.` : null };
}
// the sell order: all of it at the worst price shown or better, or nothing (fill-or-kill). Prices are always YES prices:
// selling YES = an ask at the YES bid; selling NO = a bid for YES at 1 - the NO bid.
export function sellOrder(ticker, side, count, worst) {
  const yes = side === "yes" ? worst : 1 - worst;
  return { ticker, side: side === "yes" ? "ask" : "bid", count: count.toFixed(2), price: yes.toFixed(4), time_in_force: "fill_or_kill", self_trade_prevention_type: "taker_at_cross" };
}
// a combo sold through market makers: you sell YES into the best maker's YES bid (never below `minPrice`)
export function bestSellQuote(quotes, { minPrice = 0, skip = null } = {}) {
  const open = (quotes || []).filter(q => q.status === "open" && dollars(q.yes_bid_dollars) > 0 && dollars(q.yes_bid_dollars) >= minPrice - 1e-9 && !(skip && skip.has(q.id)));
  if (!open.length) return null;
  const q = open.sort((a, b) => dollars(b.yes_bid_dollars) - dollars(a.yes_bid_dollars))[0];
  return { quote: q, price: dollars(q.yes_bid_dollars), contracts: sellYesContracts(q) };
}

// someone else's combo: no maker can be asked for them, so an estimate from each leg's current bid (Kalshi's combo
// legs from GET markets/{combo}: mve_selected_legs). legs: [{ side, market }] -> per-contract value, or null
export function comboEstimate(legs) {
  if (!legs?.length) return null;
  let p = 1;
  for (const { side, market } of legs) { const b = dollars(side === "no" ? market?.no_bid_dollars : market?.yes_bid_dollars); if (!(b > 0)) return null; p *= b; }
  return Math.round(p * 10000) / 10000;
}

// ---------- syncing: open positions (wherever they were bought) -> tickets on the site ----------
// positions: GET portfolio/positions market_positions; mkts: ticker -> market (GET markets/{ticker}), including each
// combo's legs. Returns what POST /api/slips/sync takes.
export function syncPayload(positions, mkts) {
  const out = [];
  for (const p of positions || []) {
    const n = dollars(p.position_fp ?? p.position);
    if (!n) continue;
    const m = mkts[p.ticker] || {}, count = Math.abs(n), side = n > 0 ? "yes" : "no";
    const cost = positionCost(p, count);
    if (!(cost > 0)) continue;
    const legs = (m.mve_selected_legs || []).map(l => { const lm = mkts[l.market_ticker] || {}; const b = dollars(l.side === "no" ? lm.no_bid_dollars : lm.yes_bid_dollars) || dollars(lm.last_price_dollars);
      return { ticker: l.market_ticker, side: l.side === "no" ? "no" : "yes", name: lm.yes_sub_title || l.market_ticker, title: lm.title || "", close: lm.close_time || lm.expected_expiration_time || null, price: b > 0 && b < 1 ? b : null }; });
    out.push({ ticker: p.ticker, side, count: Math.round(count * 100) / 100, cost, combo: legs.length > 0, legs, name: m.yes_sub_title || p.ticker, title: m.title || "", close: m.close_time || m.expected_expiration_time || null, since: p.last_updated_ts || null });
  }
  return out;
}
// what an open position cost, fees included: the dollars at the fill prices (Kalshi's market_exposure) plus the fees
// paid to buy it. With nothing sold yet, fees_paid is exactly the buying fees; once some has been sold it also holds
// selling fees, so the buying fees on what's left are estimated and never more than what was paid.
export function positionCost(p, count) {
  const base = dollars(p.market_exposure_dollars) || dollars(p.total_traded_dollars) || 0;
  if (!(base > 0) || !(count > 0)) return 0;
  const paid = dollars(p.fees_paid_dollars) || 0, sold = Math.abs(dollars(p.realized_pnl_dollars) || 0) > 1e-9;
  const fee = sold ? Math.min(paid, feeEstimate(count, Math.min(0.99, base / count))) : paid;
  return Math.round(Math.min(base + fee, count) * 100) / 100;
}

// ---------- the key: imported once into this browser, never readable again ----------
const b64 = buf => { let s = ""; const a = new Uint8Array(buf); for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const derLen = n => (n < 128 ? [n] : n < 256 ? [0x81, n] : [0x82, n >> 8, n & 255]);
const der = (tag, body) => new Uint8Array([tag, ...derLen(body.length), ...body]);
// "BEGIN RSA PRIVATE KEY" (PKCS#1) -> PKCS#8, which WebCrypto imports
function pkcs1to8(pk1) {
  const alg = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  return der(0x30, [0x02, 0x01, 0x00, ...alg, ...der(0x04, [...pk1])]);
}
export function readPem(text) {
  const t = String(text || "").trim(), m = t.match(/-----BEGIN ([A-Z ]+)-----([\s\S]+?)-----END \1-----/);
  if (!m) throw new Error("That doesn't look like a private key file. Paste everything from -----BEGIN to -----END.");
  const bytes = unb64(m[2].replace(/\s+/g, ""));
  if (m[1] === "RSA PRIVATE KEY") return { kind: "rsa", pkcs8: pkcs1to8(bytes) };
  if (m[1] === "PRIVATE KEY") {
    const ed = bytes.length < 100 && Array.from(bytes).join(",").includes("6,3,43,101,112");     // OID 1.3.101.112 (Ed25519)
    return { kind: ed ? "ed25519" : "rsa", pkcs8: bytes };
  }
  throw new Error("Use the private key Kalshi gave you when you made the API key (a .key / .pem file).");
}
export async function importKey(pemText, subtle = globalThis.crypto.subtle) {
  const { kind, pkcs8 } = readPem(pemText);
  const alg = kind === "rsa" ? { name: "RSA-PSS", hash: "SHA-256" } : { name: "Ed25519" };
  const key = await subtle.importKey("pkcs8", pkcs8, alg, false, ["sign"]);     // false: never extractable
  return { key, kind };
}
// Kalshi's signature: timestamp + METHOD + path (from the API root, no query), RSA-PSS SHA-256 (salt 32) or Ed25519
export async function signHeaders({ key, kind, keyId }, method, path, ts = Date.now(), subtle = globalThis.crypto.subtle) {
  const msg = new TextEncoder().encode(`${ts}${method.toUpperCase()}${path.split("?")[0]}`);
  const sig = await subtle.sign(kind === "ed25519" ? { name: "Ed25519" } : { name: "RSA-PSS", saltLength: 32 }, key, msg);
  return { "KALSHI-ACCESS-KEY": keyId, "KALSHI-ACCESS-TIMESTAMP": String(ts), "KALSHI-ACCESS-SIGNATURE": b64(sig) };
}

// ---------- this device's saved key (IndexedDB) ----------
const DB = "bb-kalshi", STORE = "keys";
const idb = () => new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const tx = async (mode, fn) => { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction(STORE, mode), s = t.objectStore(STORE), r = fn(s); t.oncomplete = () => res(r?.result); t.onerror = () => rej(t.error); }); };
export const savedKey = who => tx("readonly", s => s.get(String(who).toLowerCase())).catch(() => null);
export const saveKey = (who, rec) => tx("readwrite", s => s.put(rec, String(who).toLowerCase()));
export const forgetKey = who => tx("readwrite", s => s.delete(String(who).toLowerCase()));

// ---------- every Kalshi sports market, not just the ones tied to a game on our scoreboards ----------
// The data job keeps an index of every open Kalshi sports market (data/kalshi/sports.json: matches in every tennis
// tour down to ITF, set winners, doubles, props, futures...). A pick the scoreboards don't know is matched here, and
// bought and graded on Kalshi's own market.
const SERIES_SPORT = [[/^KX(ATP|WTA|ITF|TENNIS|GRANDSLAM|DAVIS|BJK|UNITEDCUP|NEXTGEN)/, "Tennis"], [/^KXUFC|^KXMMA|^KXPFL/, "MMA"], [/^KXNBA/, "NBA"], [/^KXWNBA/, "WNBA"],
  [/^KXNFL|^KXSB/, "NFL"], [/^KXNCAAF/, "CFB"], [/^KXNCAAMB|^KXMARCH/, "CBB"], [/^KXNCAAWB/, "CBBW"], [/^KXNHL|^KXSTANLEY/, "NHL"], [/^KXMLB|^KXWS/, "MLB"],
  [/^KX(EPL|LALIGA|BUNDESLIGA|SERIEA|LIGUE1|MLS|LIGAMX|UCL|UEL|UECL|WC|INTLFRIENDLY|FACUP|EFL|SOCCER|CONCACAF|COPA|EURO)/, "Soccer"], [/^KX(PGA|LIV|GOLF|MASTERS|USOPENGOLF|RYDER)/, "Golf"],
  [/^KX(F1|NASCAR|INDY)/, "Racing"]];
export const sportOfSeries = s => (SERIES_SPORT.find(([re]) => re.test(String(s || ""))) || [null, "Kalshi"])[1];
// the index file -> one flat list of markets: { ticker, event, series, sub, title, esub, close, sport }
export function indexMarkets(file) {
  const out = [];
  for (const [event, series, title, esub, close, ms] of file?.ev || []) for (const [ticker, sub, mclose] of ms || []) out.push({ ticker, event, series, sub: sub || "", title: title || "", esub: esub || "", close: mclose || close || null, sport: sportOfSeries(series), _s: norm(sub), _t: norm(title) });
  return out;
}
// a typed pick against the index: every word has to be in the market's name or its event's title, the market's own
// name counts most, a single game / match beats a season-long market, and the soonest to close comes first
const STOP = new Set(["ml", "moneyline", "money", "line", "to", "win", "wins", "the", "vs", "v", "at", "bet", "yes", "straight", "match", "game"]);
export function kalshiSearch(text, markets, max = 6) {
  const words = norm(text).split(" ").filter(w => w && !STOP.has(w));
  if (!words.length || !markets?.length) return [];
  const hits = [];
  for (const m of markets) {
    let s = 0, ok = true;
    for (const w of words) {
      const inS = (` ${m._s} `).includes(` ${w} `) || (w.length >= 4 && m._s.includes(w)), inT = (` ${m._t} `).includes(` ${w} `) || (w.length >= 4 && m._t.includes(w));
      if (!inS && !inT) { ok = false; break; }
      s += inS ? 3 : 1;
    }
    if (!ok) continue;
    if (/\bvs\b| at /i.test(m.title)) s += 2;                          // one match / game
    if (m._s && words.join(" ") === m._s) s += 3;                       // typed the market's name exactly
    hits.push({ m, s });
  }
  hits.sort((a, b) => b.s - a.s || String(a.m.close || "9").localeCompare(String(b.m.close || "9")));
  return hits.slice(0, max).map(h => h.m);
}
// an indexed market as a slip leg (bought as YES on that market)
export function kalshiLeg(m) {
  const vs = String(m.title).split(/\s+vs\.?\s+|\s+at\s+/i);
  return { market: "kalshi", kalshi: true, side: "yes", line: null, ticker: m.ticker, eventTicker: m.event, series: m.series, sport: m.sport, league: m.series, eventId: m.ticker,
    date: m.close, state: "pre", name: m.sub, title: m.title, away: { name: vs.length === 2 ? vs[0] : m.title }, home: { name: vs.length === 2 ? vs[1] : "" } };
}
// one market straight from Kalshi -> the slip's price for YES on it
export function quoteMarket(m, leg) {
  if (!m) return { ok: false, why: "Couldn't read this market on Kalshi." };
  if (!open(m)) return { ok: false, why: "That market isn't open on Kalshi right now." };
  const p = ask(m, "yes");
  if (!(p > 0 && p < 1)) return { ok: false, why: "No one is selling YES on this market right now." };
  return { ok: true, ticker: m.ticker, event_ticker: m.event_ticker, side: "yes", price: p, am: priceToAm(p), line: null, label: `${m.yes_sub_title || leg?.name || m.ticker} · YES`, title: m.title };
}

// ---------- funding the right part of the exchange ----------
// Kalshi runs several matching engines ("shards"): tennis, baseball and basketball markets trade on shard 3, combos on
// shard 1, most others on shard 0, and cash is held per shard. The Kalshi app moves cash to the right shard on its own
// when you buy; orders sent through the API don't, so an account with plenty of cash on shard 0 gets "insufficient
// balance" on a tennis market. This plans the move: cash already on the market's shard first, then the rest from the
// other shards (largest first), plus a nickel of room for rounding. bal is GET /portfolio/balance; need in dollars.
export function planFunding(bal, shard, need) {
  const total = bal?.balance_dollars != null ? parseFloat(bal.balance_dollars) : (Number(bal?.balance) || 0) / 100;
  const bd = Array.isArray(bal?.balance_breakdown) ? bal.balance_breakdown.map(b => [Number(b.exchange_index), parseFloat(b.balance) || 0]) : null;
  if (shard == null || !bd) return { shard, total, here: total, moves: [], need, covered: total >= need - 1e-9 };
  const here = (bd.find(([i]) => i === shard) || [0, 0])[1], moves = [];
  let short = need - here;
  if (short > 1e-9) {
    short = Math.ceil(short * 100) / 100 + 0.05;
    for (const [i, b] of bd.filter(([i]) => i !== shard).sort((a, c) => c[1] - a[1])) {
      if (short <= 1e-9) break;
      const amt = Math.floor(Math.min(b, short) * 100) / 100;
      if (amt >= 0.01) { moves.push({ from: i, to: shard, amount: amt }); short -= amt; }
    }
  }
  const moved = moves.reduce((a, m) => a + m.amount, 0);
  return { shard, total, here, moves, need, covered: here + moved >= need - 1e-9 };
}
// one move as Kalshi's transfer request (amounts in centicents: $1 = 10,000)
export const transferBody = (m, id) => ({ source: "event_contract", destination: "event_contract", amount: Math.round(m.amount * 10000), source_exchange_shard: m.from, destination_exchange_shard: m.to, client_transfer_id: id });
