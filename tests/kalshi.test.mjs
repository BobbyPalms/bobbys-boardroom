// Kalshi: picks matched to real Kalshi markets (trimmed copies in tests/fixtures), prices and sizing, combos, and the
// request signing done on each person's device (checked against real RSA and Ed25519 keys). No network.
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { generateKeyPairSync, verify, constants, webcrypto } from "crypto";
import { seriesFor, mapLeg, findGameEvent, sizeOrder, priceToAm, feeEstimate, comboCollection, bestComboQuote, quotesPath, positionOf, sellValue, sellOrder, bestSellQuote, comboEstimate, syncPayload, readPem, importKey, signHeaders } from "../src/kalshi.js";
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
const qs3 = [{ id: "a", status: "open", no_bid_dollars: "0.78", yes_contracts_fp: "45.00" }, { id: "b", status: "open", no_bid_dollars: "0.81", yes_contracts_fp: "52.00" }];
check("never pays more than the price you confirmed", bestComboQuote(qs3, { maxPrice: 0.20 }).quote.id === "b" && bestComboQuote(qs3, { maxPrice: 0.18 }) === null);
check("a quote already tried is skipped", bestComboQuote(qs3, { skip: new Set(["b"]) }).quote.id === "a");
check("quotes are asked for with rfq_user_filter=self (Kalshi refuses rfq_id alone)", quotesPath("ae03d6d6-ec0b") === "communications/quotes?rfq_user_filter=self&rfq_id=ae03d6d6-ec0b");
// ---- syncing positions from the Kalshi app ----
const spl = syncPayload([{ ticker: "A", position_fp: "-20.00", market_exposure_dollars: "8.400000", last_updated_ts: "2026-11-09T23:00:00Z" }, { ticker: "C", position_fp: "50.00", market_exposure_dollars: "9.5" }, { ticker: "Z", position_fp: "0.00", market_exposure_dollars: "1" }],
  { A: { yes_sub_title: "Buffalo", title: "Buffalo at Minnesota", close_time: "2026-11-10T04:00:00Z" }, C: { title: "combo", mve_selected_legs: [{ market_ticker: "L1", side: "yes" }, { market_ticker: "L2", side: "no" }] }, L1: { yes_sub_title: "Dalton Kincaid: 20+", yes_bid_dollars: "0.70" }, L2: { yes_sub_title: "Buffalo wins by over 6.5", no_bid_dollars: "0.55" } });
check("sync payload: NO = negative position, cost from exposure, flat positions skipped", spl.length === 2 && spl[0].side === "no" && spl[0].count === 20 && spl[0].cost === 8.4 && spl[0].name === "Buffalo" && spl[0].since === "2026-11-09T23:00:00Z" && !spl[0].combo, spl[0]);
check("sync payload: a combo carries its legs with their sides and prices", spl[1].combo && spl[1].legs.length === 2 && spl[1].legs[0].name === "Dalton Kincaid: 20+" && spl[1].legs[0].price === 0.7 && spl[1].legs[1].side === "no" && spl[1].legs[1].price === 0.55, spl[1]);
// ---- cashing out ----
check("someone's combo: estimate = each leg's bid multiplied", comboEstimate([{ side: "yes", market: { yes_bid_dollars: "0.50" } }, { side: "no", market: { no_bid_dollars: "0.40" } }]) === 0.2 && comboEstimate([{ side: "yes", market: { yes_bid_dollars: "0" } }]) === null && comboEstimate([]) === null);
check("position: + is YES, - is NO, none is 0", JSON.stringify(positionOf({ market_positions: [{ ticker: "A", position_fp: "16.66" }, { ticker: "B", position_fp: "-20.00" }] }, "A")) === '{"side":"yes","count":16.66}' && positionOf({ market_positions: [{ ticker: "B", position_fp: "-20.00" }] }, "B").side === "no" && positionOf({ market_positions: [] }, "A").count === 0);
const book = { yes_dollars: [["0.5500", "10.00"], ["0.6200", "5.00"], ["0.6000", "4.00"]], no_dollars: [["0.3500", "100.00"]] };
const sv = sellValue(book, "yes", 16.66);
check("sell value walks the YES bids best first (5@62 + 4@60 + 7.66@55)", sv.ok && Math.abs(sv.gross - 9.71) < 0.01 && sv.worst === 0.55 && sv.filled === 16.66 && sv.net === Math.round((sv.gross - sv.fee) * 100) / 100, sv);
check("not enough bids: says how many they'd take", (x => !x.ok && x.filled === 19 && /19 of your 30/.test(x.why))(sellValue(book, "yes", 30)));
check("NO holders sell into NO bids", sellValue(book, "no", 20).gross === 7 && sellValue(book, "no", 20).worst === 0.35);
check("no bids at all", sellValue({ yes_dollars: [], no_dollars: [] }, "yes", 5).ok === false);
check("sell order: YES = ask at the YES bid; NO = bid for YES at 1 - the NO bid; all or nothing", (a => a.side === "ask" && a.price === "0.5500" && a.count === "16.66" && a.time_in_force === "fill_or_kill")(sellOrder("T", "yes", 16.66, 0.55)) && (b => b.side === "bid" && b.price === "0.6500")(sellOrder("T", "no", 20, 0.35)));
const sq = [{ id: "x", status: "open", yes_bid_dollars: "0.31", contracts_fp: "73.00" }, { id: "y", status: "open", yes_bid_dollars: "0.33", contracts_fp: "73.00" }];
check("combo cash out: best maker YES bid, never below the price shown", bestSellQuote(sq).quote.id === "y" && bestSellQuote(sq, { minPrice: 0.34 }) === null && bestSellQuote(sq, { skip: new Set(["y"]) }).price === 0.31);

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
// ---- every Kalshi sports market: the index the slip searches when the scoreboards don't carry a pick ----
{
  const K = await import("../src/kalshi.js");
  const idx = K.indexMarkets({ ev: [
    ["KXITFMATCH-26NOV09DUMHEI", "KXITFMATCH", "Dummer Macedo vs Heineberg", "", null, [["KXITFMATCH-26NOV09DUMHEI-DUM", "Tomas Dummer Macedo", "2026-11-09T22:00Z"], ["KXITFMATCH-26NOV09DUMHEI-HEI", "Eduardo Heineberg", "2026-11-09T22:00Z"]]],
    ["KXATPCHALLENGERMATCH-26NOV09HARBRO", "KXATPCHALLENGERMATCH", "Billy Harris vs Liam Broady", "", null, [["KXATPCHALLENGERMATCH-26NOV09HARBRO-BRO", "Liam Broady", "2026-11-09T20:00Z"]]],
    ["KXATPSETWINNER-26NOV09RINKEC-1", "KXATPSETWINNER", "Arthur Rinderknech vs Miomir Kecmanovic: Set 1 Winner", "", null, [["KXATPSETWINNER-26NOV09RINKEC-1-RIN", "Arthur Rinderknech", "2026-11-09T19:00Z"]]],
    ["KXATP-27USO", "KXATP", "2027 US Open Men's Singles Winner", "", null, [["KXATP-27USO-SIN", "Jannik Sinner", "2027-09-13T00:00Z"]]]] });
  check("index: every market, tagged with its sport", idx.length === 5 && idx.every(m => m.sport === "Tennis"));
  check("search: an ITF player by surname", K.kalshiSearch("Heineberg ML", idx)[0]?.ticker === "KXITFMATCH-26NOV09DUMHEI-HEI");
  check("search: accents and full names", K.kalshiSearch("tomas dummer macedo to win", idx)[0]?.ticker === "KXITFMATCH-26NOV09DUMHEI-DUM");
  check("search: a set winner market", K.kalshiSearch("Rinderknech set 1", idx)[0]?.ticker === "KXATPSETWINNER-26NOV09RINKEC-1-RIN");
  check("search: a future", K.kalshiSearch("Sinner US Open", idx)[0]?.ticker === "KXATP-27USO-SIN");
  check("search: nothing for a name Kalshi doesn't list", K.kalshiSearch("Federer", idx).length === 0);
  const leg = K.kalshiLeg(idx[1]);
  check("a Kalshi leg: YES on the market, both players from the title", leg.market === "kalshi" && leg.side === "yes" && leg.away.name === "Dummer Macedo" && leg.home.name === "Heineberg" && leg.name === "Eduardo Heineberg");
  const q = K.quoteMarket({ ticker: "T", event_ticker: "E", status: "active", yes_ask_dollars: "0.42", yes_sub_title: "Eduardo Heineberg" }, leg);
  check("quote: the live YES ask", q.ok && q.price === 0.42 && q.side === "yes" && q.am === 138, q);
  check("quote: a closed market can't be bought", !K.quoteMarket({ status: "closed", yes_ask_dollars: "0.42" }, leg).ok);
}
// ---- funding the market's shard: cash is held per shard, and API orders don't move it (the Kalshi app does) ----
{
  const K = await import("../src/kalshi.js");
  const bal = { balance: 52000, balance_dollars: "520.00", balance_breakdown: [{ exchange_index: 0, balance: "520.00" }, { exchange_index: 3, balance: "0.00" }] };
  const p = K.planFunding(bal, 3, 5.31);
  check("funding: $520 on shard 0, a $5.31 tennis buy on shard 3 moves $5.36 there first", p.covered && p.moves.length === 1 && p.moves[0].from === 0 && p.moves[0].to === 3 && p.moves[0].amount === 5.36, p);
  check("funding: cash already on the shard moves nothing", K.planFunding({ ...bal, balance_breakdown: [{ exchange_index: 0, balance: "500" }, { exchange_index: 3, balance: "20" }] }, 3, 5.31).moves.length === 0);
  check("funding: tops up only the shortfall, from several shards if needed", (q => q.covered && q.moves.reduce((a, m) => a + m.amount, 0) >= 7.9 && q.moves.length === 2)(K.planFunding({ balance_dollars: "10", balance_breakdown: [{ exchange_index: 0, balance: "5" }, { exchange_index: 2, balance: "3" }, { exchange_index: 3, balance: "2" }] }, 3, 9.9)));
  check("funding: an account that's really short says so", !K.planFunding({ balance_dollars: "3.00", balance_breakdown: [{ exchange_index: 0, balance: "3.00" }] }, 3, 5.31).covered);
  check("funding: a key without per-shard balances falls back to the total", K.planFunding({ balance: 900 }, 3, 5.31).covered && K.planFunding({ balance: 900 }, 3, 5.31).moves.length === 0);
  check("transfer body: centicents between shards", JSON.stringify(K.transferBody({ from: 0, to: 3, amount: 5.36 }, "id")) === JSON.stringify({ source: "event_contract", destination: "event_contract", amount: 53600, source_exchange_shard: 0, destination_exchange_shard: 3, client_transfer_id: "id" }));
}
console.log(`kalshi: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
