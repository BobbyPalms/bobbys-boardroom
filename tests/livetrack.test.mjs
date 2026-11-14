// The Arena live tracker (src/livetrack.js) on real ESPN summaries, and every Kalshi market on a game (src/kalshi.js).
import { readFileSync } from "fs";
import { liveFeed, courtSpot, rinkSpot, yardX, familyOf, shortPeriod } from "../src/livetrack.js";
import { gameEvents, marketKind, kalshiGameCode, sidePrices, quoteMarket } from "../src/kalshi.js";
let pass = 0, fail = 0;
const check = (n, c, d) => { if (c) pass++; else { fail++; console.log("  FAIL:", n, d === undefined ? "" : JSON.stringify(d).slice(0, 400)); } };
const fx = n => JSON.parse(readFileSync(new URL(`./fixtures/summary_${n}.json`, import.meta.url)));

const B = liveFeed(fx("WNBA"), "WNBA");
check("basketball: score by quarter, both teams", B.F.away.lines.length >= 4 && B.F.home.lines.length >= 4 && B.fam === "basket");
check("basketball: plays newest first, the last one on top", B.plays.length > 50 && B.plays[0].seq >= B.plays[1].seq && B.last === B.plays[0], B.plays.slice(0, 2));
check("basketball: shots placed on the full court (inside 94 x 50), each team at its own basket", B.shots.length > 20 && B.shots.every(s => s.x >= -2 && s.x <= 96 && s.y >= -2 && s.y <= 52) && B.shots.filter(s => s.side === "away").every(s => s.x < 52) && B.shots.filter(s => s.side === "home").every(s => s.x > 42), B.shots.slice(0, 3));
check("basketball: made shots marked, the latest marked once", B.shots.some(s => s.made) && B.shots.filter(s => s.last).length === 1);
const miss = JSON.parse(JSON.stringify(fx("WNBA"))); miss.plays.push({ ...miss.plays.find(p => p.shootingPlay && p.coordinate.x < 100), id: "m1", sequenceNumber: "9999", scoringPlay: false, text: "misses 26-foot three" });
check("basketball: a miss is drawn as a miss, and it's the latest", (f => f.shots.at(-1).made === false && f.shots.at(-1).last && f.last.text === "misses 26-foot three")(liveFeed(miss, "WNBA")));
check("basketball: garbage coordinates (-214748340) never drawn", courtSpot({ x: -214748340, y: -214748365 }, "home") === null && courtSpot({ x: 25, y: 5 }, "away").x === 5 && courtSpot({ x: 25, y: 5 }, "home").x === 89);
check("win probability series read", B.wp.length > 10 && B.wp.every(v => v >= 0 && v <= 1));
const H = liveFeed(fx("NHL"), "NHL");
check("hockey: rink spots, goals marked made", H.fam === "hockey" && H.shots.length >= 5 && H.shots.every(s => s.x >= 0 && s.x <= 200 && s.y >= 0 && s.y <= 85) && H.shots.filter(s => s.made).length >= 5, H.shots.slice(0, 2));
check("hockey: rink coordinates map center to center", JSON.stringify(rinkSpot({ x: 0, y: 0 })) === '{"x":100,"y":42.5}' && rinkSpot({ x: 500, y: 0 }) === null);
const M = liveFeed(fx("MLB"), "MLB");
check("baseball: count, outs and runners from the last play (runner on 2nd, 2 out, 1-1)", M.situation.kind === "base" && M.situation.outs === 2 && M.situation.on.join() === "false,true,false" && M.situation.balls === 1 && M.situation.strikes === 1, M.situation);
const live = { ...fx("MLB"), situation: { balls: 3, strikes: 2, outs: 1, onFirst: { athlete: {} }, onThird: { athlete: {} }, batter: { athlete: { displayName: "Aaron Judge" } }, pitcher: { athlete: { displayName: "Tarik Skubal" } } } };
check("baseball: the live situation wins when the feed has one (full count, corners, 1 out, batter and pitcher)", (s => s.balls === 3 && s.strikes === 2 && s.outs === 1 && s.on.join() === "true,false,true" && s.batter === "Aaron Judge" && s.pitcher === "Tarik Skubal")(liveFeed(live, "MLB").situation));
const S = liveFeed(fx("Soccer"), "Soccer");
check("soccer: key events as the play list, possession read", S.fam === "soccer" && S.plays.length > 0 && (S.possession == null || S.possession.a + S.possession.h > 95), S.possession);
// football: the ball on the field and the first-down line, from the live situation
const cfb = fx("CFB"), A = liveFeed(cfb, "CFB").F.away.abbr, Hm = liveFeed(cfb, "CFB").F.home.abbr, hid = cfb.header.competitions[0].competitors.find(c => c.homeAway === "home").team.id;
const foot = liveFeed({ ...cfb, situation: { downDistanceText: `3rd & 4 at ${A} 30`, possessionText: `${A} 30`, distance: 4, possession: hid, isRedZone: true } }, "CFB").situation;
check("football: ball on the away 30 = 30 yards from the left goal line; home attacks left, so the first down is at 26", foot.x === 30 && foot.firstDown === 26 && foot.poss === "home" && foot.redZone && /3rd & 4/.test(foot.text), foot);
check("football: yard markers", yardX(`${Hm} 20`, A, Hm) === 80 && yardX("50", A, Hm) === 50 && yardX("XYZ 20", A, Hm) === null);
check("short periods: Q4, 2H, P3, Bot 9, OT", shortPeriod({ displayValue: "4th Quarter", number: 4 }) === "Q4" && shortPeriod({ displayValue: "2nd Half" }) === "2H" && shortPeriod({ displayValue: "3rd", number: 3 }) === "P3" && shortPeriod({ type: "Bottom", number: 9, displayValue: "9th Inning" }) === "Bot 9" && shortPeriod({ displayValue: "OT" }) === "OT" && B.plays[0].period === "Q4");
check("families", familyOf("NBA") === "basket" && familyOf("NFL") === "foot" && familyOf("PUCK") === "hockey" && familyOf("Tennis") === "other");

// ---- every Kalshi market on one game ----
const code = "26NOV13OKCLAC", ev = [
  [`KXNBAGAME-${code}`, "KXNBAGAME", "Oklahoma City vs Los Angeles C", "OKC vs LAC (Nov 13)", null, [[`KXNBAGAME-${code}-OKC`, "Oklahoma City"], [`KXNBAGAME-${code}-LAC`, "Los Angeles C"]]],
  [`KXNBASPREAD-${code}`, "KXNBASPREAD", "Oklahoma City vs Los Angeles C: Spread", "", null, [[`KXNBASPREAD-${code}-OKC5`, "Oklahoma City wins by over 4.5 points"]]],
  [`KXNBA1HTOTAL-${code}`, "KXNBA1HTOTAL", "Oklahoma City vs Los Angeles C: 1st Half Total", "", null, [[`KXNBA1HTOTAL-${code}-110`, "Over 109.5 points"]]],
  [`KXNBAPTS-${code}`, "KXNBAPTS", "Oklahoma City vs Los Angeles C: Points", "", null, [[`KXNBAPTS-${code}-SGA30`, "Shai Gilgeous-Alexander: 30+"]]],
  [`KXNBAPTSPROT-${code}`, "KXNBAPTSPROT", "Oklahoma City vs Los Angeles C: Points", "", null, [[`KXNBAPTSPROT-${code}-SGA30`, "Shai Gilgeous-Alexander: 30+"]]],
  [`KXNBA3PTPROT-${code}`, "KXNBA3PTPROT", "Oklahoma City vs Los Angeles C: Threes", "", null, [[`KXNBA3PTPROT-${code}-X3`, "Someone: 3+"]]],
  [`KXNBAGAME-26NOV13GSWSAS`, "KXNBAGAME", "Golden State vs San Antonio", "", null, [["KXNBAGAME-26NOV13GSWSAS-GSW", "Golden State"]]],
];
const G = gameEvents(ev, code);
check("every market on the game, grouped game / periods / props; another game's left out", G.length === 5 && G.map(g => g.kind).join() === "game,game,periods,props,props" && !G.some(g => /GSWSAS/.test(g.event)), G.map(g => [g.series, g.kind]));
check("the *PROT copy is dropped when the plain series is there, kept when it's the only one", !G.some(g => g.series === "KXNBAPTSPROT") && G.some(g => g.series === "KXNBA3PTPROT"));
check("each market keeps its ticker, event and name", G.find(g => g.series === "KXNBAPTS").markets[0].sub === "Shai Gilgeous-Alexander: 30+" && G.find(g => g.series === "KXNBAGAME").markets[0].event === `KXNBAGAME-${code}`);
check("market kinds from the title", marketKind("A vs B") === "game" && marketKind("A vs B: Spread") === "game" && marketKind("A vs B: 1st Quarter Spread") === "periods" && marketKind("A vs B: Rebounds") === "props" && marketKind("A vs B: Overtime") === "game");
check("no code, nothing", gameEvents(ev, null).length === 0);
const K = JSON.parse(readFileSync(new URL("./fixtures/kalshi_events.json", import.meta.url)));
const anyEv = Object.values(K).flat().find(e => /GAME/.test(e.event_ticker || "")) || null;
if (anyEv) {
  const [a, h] = anyEv.markets.filter(m => !/^tie$/i.test(m.yes_sub_title));
  const leg = { sport: "NFL", league: "nfl", date: anyEv.markets[0].close_time || new Date().toISOString(), away: { name: a.yes_sub_title }, home: { name: h.yes_sub_title } };
  const c2 = kalshiGameCode(leg, { [anyEv.event_ticker.split("-")[0]]: [anyEv] });
  check("the game's code from its moneyline event", c2 === null || c2 === anyEv.event_ticker.split("-")[1], [c2, anyEv.event_ticker]);
}
check("side prices: YES and NO asks", JSON.stringify(sidePrices({ yes_ask_dollars: "0.4200", no_ask_dollars: "0.6000", status: "active" })) === '{"yes":0.42,"no":0.6,"open":true}' && sidePrices({ yes_ask_dollars: "0", no_ask_dollars: "1" }).yes === null);
check("a Kalshi market bought NO prices the NO side", (q => q.ok && q.side === "no" && q.price === 0.6 && /· NO$/.test(q.label))(quoteMarket({ ticker: "T", yes_ask_dollars: "0.42", no_ask_dollars: "0.60", status: "active", yes_sub_title: "X" }, { side: "no" })) && quoteMarket({ ticker: "T", yes_ask_dollars: "0.42", no_ask_dollars: "0.60", status: "active" }, {}).side === "yes");
console.log(`live tracker + game markets: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
