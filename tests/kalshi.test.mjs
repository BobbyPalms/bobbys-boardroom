// Kalshi: picks matched to real Kalshi markets (trimmed copies in tests/fixtures), prices and sizing, combos, and the
// request signing done on each person's device (checked against real RSA and Ed25519 keys). No network.
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { generateKeyPairSync, verify, constants, webcrypto } from "crypto";
import { seriesFor, mapLeg, findGameEvent, sizeOrder, priceToAm, feeEstimate, comboCollection, bestComboQuote, readPem, importKey, signHeaders } from "../src/kalshi.js";
let pass = 0, fail = 0;
const check = (n, c, d) => { if (c) pass++; else { fail++; console.log("  FAIL:", n, d === undefined ? "" : JSON.stringify(d).slice(0, 500)); } };
const K = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "kalshi_events.json"), "utf8"));
const NBA = { KXNBAGAME: K.KXNBAGAME, KXNBASPREAD: K.KXNBASPREAD, KXNBATOTAL: K.KXNBATOTAL };
const T = (name, abbr, full, loc) => ({ name, abbr, full, loc });
const mia = T("Heat", "MIA", "Miami Heat", "Miami"), lac = T("Clippers", "LAC", "LA Clippers", "LA");
const leg = (o) => ({ sport: "NBA", league: "nba", date: "2026-11-05T03:30:00Z", away: mia, home: lac, ...o });

check("series per league", seriesFor("NBA", "nba", "ml") === "KXNBAGAME" && seriesFor("CFB", "college-football", "spread") === "KXNCAAFSPREAD" && seriesFor("Soccer", "eng.1", "total") === "KXEPLTOTAL" && seriesFor("Soccer", "uefa.champions", "ml") === "KXUCLGAME" && seriesFor("Tennis", "wta", "ml") === "KXWTAMATCH" && seriesFor("MMA", "ufc", "ml") === "KXUFCFIGHT" && seriesFor("Tennis", "atp", "spread") === null);
const g = findGameEvent(K.KXNBAGAME, leg({}));
check("finds the game by teams and day", g && g.code === "26NOV04MIALAC" && g.away.ticker.endsWith("-MIA") && g.home.ticker.endsWith("-LAC"), g && g.code);
check("wrong day: not found", !findGameEvent(K.KXNBAGAME, leg({ date: "2026-11-12T03:30:00Z" })));
let m = mapLeg(leg({ market: "ml", side: "home" }), NBA);
check("ML: buys YES on the team's market at the ask", m.ok && m.ticker === "KXNBAGAME-26NOV04MIALAC-LAC" && m.side === "yes" && m.price === 0.56 && m.am === -127, m);
m = mapLeg(leg({ market: "ml", side: "away" }), NBA);
check("ML away", m.ok && m.ticker.endsWith("-MIA") && m.price === 0.45 && m.am === 122, m);
m = mapLeg(leg({ market: "spread", side: "home", line: -3.5 }), NBA);
check("spread favorite: YES on 'LAC wins by over 3.5'", m.ok && m.ticker === "KXNBASPREAD-26NOV04MIALAC-LAC4" && m.side === "yes" && m.line === -3.5, m);
m = mapLeg(leg({ market: "spread", side: "away", line: 3.5 }), NBA);
check("spread underdog: NO on the other side's same number", m.ok && m.ticker === "KXNBASPREAD-26NOV04MIALAC-LAC4" && m.side === "no", m);
m = mapLeg(leg({ market: "spread", side: "home", line: -4 }), NBA);
check("spread Kalshi doesn't list: nearest lines offered", !m.ok && /doesn't list -4/.test(m.why) && m.options.map(o => o.line).join() === "-3.5,-5.5", m);
m = mapLeg(leg({ market: "total", side: "over", line: 216.5 }), NBA);
check("total over: YES", m.ok && m.ticker === "KXNBATOTAL-26NOV04MIALAC-217" && m.side === "yes" && m.price === 0.26, m);
m = mapLeg(leg({ market: "total", side: "under", line: 216.5 }), NBA);
check("total under: NO", m.ok && m.side === "no" && m.price === 0.84, m);
check("total not listed: nearest", (x => !x.ok && x.options.length === 2)(mapLeg(leg({ market: "total", side: "over", line: 216 }), NBA)));
// soccer: draw is Kalshi's Tie market
const eve = T("Everton", "EVE", "Everton", "Everton"), cov = T("Coventry", "COV", "Coventry City", "Coventry");
m = mapLeg({ sport: "Soccer", league: "eng.1", date: "2026-11-06T20:00:00Z", away: cov, home: eve, market: "draw", side: "draw" }, { KXEPLGAME: K.KXEPLGAME });
check("soccer draw: YES on Tie", m.ok && m.ticker.endsWith("-TIE") && m.price === 0.25, m);
// college: names, not abbreviations (ESPN McNeese is MCN, Kalshi MCNS)
m = mapLeg({ sport: "CBB", league: "mens-college-basketball", date: "2026-11-06T00:00:00Z", away: T("McNeese", "MCN", "McNeese Cowboys", "McNeese"), home: T("North Texas", "UNT", "North Texas Mean Green", "North Texas"), market: "ml", side: "away" }, { KXNCAAMBGAME: K.KXNCAAMBGAME });
check("college: matched by name", m.ok && m.ticker.endsWith("-MCNS"), m);
// tennis: surnames
m = mapLeg({ sport: "Tennis", league: "atp", date: "2026-11-05T12:00:00Z", away: { name: "Ben Shelton", abbr: "" }, home: { name: "Arthur Rinderknech", abbr: "" }, market: "ml", side: "home" }, { KXATPMATCH: K.KXATPMATCH });
check("tennis: player by name", m.ok && m.ticker.endsWith("-RIN") && m.price === 0.28, m);
check("a league Kalshi doesn't carry", !mapLeg({ sport: "Soccer", league: "fifa.world", date: "2026-11-05T12:00:00Z", away: mia, home: lac, market: "ml", side: "home" }, {}).ok);

// ---- money ----
check("price to American", priceToAm(0.56) === -127 && priceToAm(0.45) === 122 && priceToAm(0.5) === 100 && priceToAm(1) === null);
const s = sizeOrder(10, 0.56);
check("sizing: $10 at 56¢ is 17.85 contracts, costs $10.00, pays $17.85", s.count === 17.85 && s.cost === 10 && s.payout === 17.85 && s.fee === feeEstimate(17.85, 0.56) && s.fee > 0.3 && s.fee < 0.32, s);
check("fee rounds up to the cent", feeEstimate(1, 0.5) === 0.02);

// ---- combos ----
const coll = comboCollection(K._mve, [{ event_ticker: "KXNFLGAME-26NOV05JACBAL" }, { event_ticker: "KXNFLTOTAL-26NOV05JACBAL" }]);
check("combo: the sports collection holding every leg", coll && /KXMVESPORTSMULTIGAMEEXTENDED/.test(coll.collection_ticker), coll && coll.collection_ticker);
const bq = bestComboQuote([{ id: "a", status: "open", yes_bid_dollars: "0.10", no_bid_dollars: "0.78", yes_contracts_fp: "45.00" }, { id: "b", status: "open", yes_bid_dollars: "0.12", no_bid_dollars: "0.81", yes_contracts_fp: "52.00" }, { id: "c", status: "cancelled", no_bid_dollars: "0.95" }]);
check("combo quote: best YES price is the highest NO bid (1 - 0.81 = 19¢)", bq.quote.id === "b" && bq.price === 0.19 && bq.am === 426, bq);
check("no quotes", bestComboQuote([]) === null);

// ---- signing on the device ----
const subtle = webcrypto.subtle;
for (const [label, type, enc] of [["RSA PKCS#1", "rsa", "pkcs1"], ["RSA PKCS#8", "rsa", "pkcs8"], ["Ed25519", "ed25519", "pkcs8"]]) {
  const kp = type === "rsa" ? generateKeyPairSync("rsa", { modulusLength: 2048 }) : generateKeyPairSync("ed25519");
  const pem = kp.privateKey.export({ type: enc, format: "pem" });
  const { key, kind } = await importKey(pem, subtle);
  check(`${label}: imported, never extractable`, key.extractable === false && kind === type, [key.extractable, kind]);
  const ts = 1767225600000, path = "/trade-api/v2/portfolio/events/orders?x=1";
  const h = await signHeaders({ key, kind, keyId: "key-123" }, "post", path, ts, subtle);
  const msg = Buffer.from(`${ts}POST/trade-api/v2/portfolio/events/orders`);
  const ok = type === "rsa" ? verify("sha256", msg, { key: kp.publicKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }, Buffer.from(h["KALSHI-ACCESS-SIGNATURE"], "base64"))
    : verify(null, msg, kp.publicKey, Buffer.from(h["KALSHI-ACCESS-SIGNATURE"], "base64"));
  check(`${label}: Kalshi's signature (timestamp + METHOD + path, no query) verifies`, ok && h["KALSHI-ACCESS-KEY"] === "key-123" && h["KALSHI-ACCESS-TIMESTAMP"] === String(ts));
}
let threw = ""; try { readPem("hello"); } catch (e) { threw = e.message; }
check("bad paste explained", /doesn't look like a private key/.test(threw));
console.log(`kalshi: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
