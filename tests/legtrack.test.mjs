// Live leg progress: props from the box score, totals / spreads / moneylines from the score.
import { readFileSync } from "fs";
import { propOf, gameFor, statFrom, legProgress, kalshiGameLeg } from "../src/legtrack.js";
import { parseFinal } from "../src/postgame.js";
let pass = 0, fail = 0;
const check = (n, c, d) => { if (c) pass++; else { fail++; console.log("  FAIL:", n, d === undefined ? "" : JSON.stringify(d).slice(0, 400)); } };

const kin = { market: "kalshi", ticker: "KXNFLRECYDS-26NOV09BUFMIN-BUFDKINCAID86-20", name: "Dalton Kincaid: 20+" };
const p = propOf(kin);
check("prop read from the ticker and name", p && p.sport === "NFL" && p.player === "Dalton Kincaid" && p.target === 20 && p.unit === "rec yds" && p.teams === "BUFMIN", p);
check("PROT series and basketball", (x => x.sport === "NBA" && x.target === 6 && x.unit === "reb")(propOf({ market: "kalshi", ticker: "KXNBAREBPROT-26NOV09CLECHA-CLEJALLEN31-6", name: "Jarrett Allen: 6+" })));
check("not a prop: game markets, unknown series, our own legs", propOf({ market: "kalshi", ticker: "KXNFLGAME-26NOV09BUFMIN-BUF", name: "Buffalo" }) === null && propOf({ market: "ml" }) === null && propOf({ market: "kalshi", ticker: "KXNFLFFPTS-26NOV09BUFMIN-MINJADDISON3-8P9", name: "Jordan Addison: Over 8.9" }) === null);

const rows = [{ sport: "NFL", id: "1", state: "in", away: { abbr: "BUF", name: "Bills", score: "17" }, home: { abbr: "MIN", name: "Vikings", score: "10" } },
  { sport: "NFL", id: "2", state: "pre", away: { abbr: "WSH", name: "Commanders" }, home: { abbr: "NYG", name: "Giants" } }];
check("game from Kalshi's code", gameFor(rows, "NFL", "BUFMIN")?.id === "1" && gameFor(rows, "NFL", "WASNYG")?.id === "2" && gameFor(rows, "NBA", "BUFMIN") === null);

// a real football box score (the CFB fixture: same groups as the NFL's)
const F = parseFinal(JSON.parse(readFileSync(new URL("./fixtures/summary_CFB.json", import.meta.url))), "CFB");
const rec = F.players.away.find(g => g.name === "receiving").rows[0], rush = F.players.away.find(g => g.name === "rushing").rows[0];
check("player's yards from the box score", statFrom(F, [["receiving", "YDS"]], rec.name).value === Number(rec.stats[1]) && statFrom(F, [["receiving", "YDS"]], rec.name).seen);
check("not in the box score yet = 0", statFrom(F, [["receiving", "YDS"]], "Nobody Here").value === 0);
const qb = F.players.away.find(g => g.name === "passing").rows[0];
check("made / attempted columns", statFrom(F, [["passing", "C/ATT", 0]], qb.name).value === Number(qb.stats[0].split("/")[0]) && statFrom(F, [["passing", "C/ATT", 1]], qb.name).value === Number(qb.stats[0].split("/")[1]));
const recLeg = { market: "kalshi", ticker: `KXNCAAFRECYDS-26NOV09AAABBB-X-${Number(rec.stats[1]) + 5}`, name: `${rec.name}: ${Number(rec.stats[1]) + 5}+` };
const pr = legProgress(recLeg, { state: "in" }, F);
check("prop short of the line: counting, not done", pr.kind === "count" && pr.value === Number(rec.stats[1]) && pr.target === Number(rec.stats[1]) + 5 && !pr.done, pr);
const pr2 = legProgress({ ...recLeg, ticker: recLeg.ticker.replace(/-\d+$/, "-20"), name: `${rec.name}: 20+` }, { state: "in" }, F);
check("prop past the line: done (green)", pr2.done === true);
check("rushing + receiving yards add up", legProgress({ market: "kalshi", ticker: "KXNCAAFRRYDS-26NOV09AAABBB-X-1", name: `${rush.name}: 1+` }, { state: "in" }, F).value === statFrom(F, [["rushing", "YDS"], ["receiving", "YDS"]], rush.name).value);
check("nothing before the game starts", legProgress(kin, { state: "pre" }, F) === null);

// game legs from the score (BUF 17, MIN 10)
const g = rows[0], L = (market, side, line) => ({ sport: "NFL", market, side, line, away: { name: "Bills" }, home: { name: "Vikings" } });
check("over: counts toward the line", (x => x.kind === "count" && x.value === 27 && x.target === 47.5 && !x.done)(legProgress(L("total", "over", 47.5), g)));
check("over cleared", legProgress(L("total", "over", 20.5), g).done === true);
check("under: a bar toward the line, winning while below", (x => x.kind === "count" && x.under && x.value === 27 && x.target === 47.5 && x.ok && x.win === true && x.text === "under by 20.5")(legProgress(L("total", "under", 47.5), g)));
check("under: losing once over", (x => !x.ok && x.win === false && x.text === "over by 6.5")(legProgress(L("total", "under", 20.5), g)));
check("over / props still building: neither winning nor losing yet", legProgress(L("total", "over", 47.5), g).win === null);
check("spread: its line and where the team stands now, in spread terms (BUF up 7 = -7, MIN down 7 = +7)", (x => x.line === -2.5 && x.at === -7)(legProgress(L("spread", "away", -2.5), g)) && legProgress(L("spread", "home", 3), g).at === 7);
check("spread: a bar around the cover number (NFL scale 14)", (x => x.kind === "margin" && x.m === 4.5 && x.scale === 14 && x.win === true)(legProgress(L("spread", "away", -2.5), g)) && legProgress(L("spread", "home", 3), g).win === false);
check("spread: covering / not", (x => x.ok && x.text === "covering by 4.5")(legProgress(L("spread", "away", -2.5), g)) && (x => !x.ok && x.text === "needs 4 more to cover")(legProgress(L("spread", "home", 3), g)));
check("moneyline: winning / losing / tied", legProgress(L("ml", "away"), g).win === true && legProgress(L("ml", "home"), g).win === false && legProgress(L("ml", "away"), { state: "in", away: { score: "3" }, home: { score: "3" } }).win === null);
check("moneyline: up / down", legProgress(L("ml", "away"), g).text === "Bills up 7" && legProgress(L("ml", "home"), g).text === "Vikings down 7" && !legProgress(L("ml", "home"), g).ok);
// Kalshi game lines (bought in the Kalshi app): read as the same bet on the scoreboard game (BUF 17, MIN 10)
const KL = (ticker, name, side = "yes") => ({ market: "kalshi", ticker, name, side });
check("Kalshi ML: Buffalo YES = Bills ML (up 7)", (x => x.kind === "status" && x.win === true && x.text === "Bills up 7")(legProgress(KL("KXNFLGAME-26NOV09BUFMIN-BUF", "Buffalo"), g)));
check("Kalshi ML NO on Buffalo = the other side", legProgress(KL("KXNFLGAME-26NOV09BUFMIN-BUF", "Buffalo", "no"), g).win === false);
check("Kalshi spread: 'wins by over 6.5' YES = BUF -6.5 (covering by 0.5); NO = MIN +6.5", (x => x.kind === "margin" && x.line === -6.5 && x.m === 0.5)(legProgress(KL("KXNFLSPREAD-26NOV09BUFMIN-BUF7", "Buffalo wins by over 6.5 points"), g)) && (x => x.line === 6.5 && x.m === -0.5)(legProgress(KL("KXNFLSPREAD-26NOV09BUFMIN-BUF7", "Buffalo wins by over 6.5 points", "no"), g)));
check("Kalshi total: YES = over 46.5 (27 so far), NO = under", (x => x.kind === "count" && x.target === 46.5 && x.value === 27 && !x.under)(legProgress(KL("KXNFLTOTAL-26NOV09BUFMIN-47", "Over 46.5 points"), g)) && legProgress(KL("KXNFLTOTAL-26NOV09BUFMIN-47", "Over 46.5 points", "no"), g).under === true);
check("not a game line: props / other markets", kalshiGameLeg(KL("KXNFLRECYDS-26NOV09BUFMIN-BUFDKINCAID86-20", "Dalton Kincaid: 20+")) === null && kalshiGameLeg(KL("KXNFLGAME-26NOV09BUFMIN-TIE", "Tie")) === null);
console.log(`legtrack: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
