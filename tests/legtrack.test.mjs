// Live leg progress: props from the box score, totals / spreads / moneylines from the score.
import { readFileSync } from "fs";
import { propOf, gameFor, statFrom, legProgress } from "../src/legtrack.js";
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
check("under: winning while below", (x => x.ok && /under by 20\.5/.test(x.text))(legProgress(L("total", "under", 47.5), g)));
check("spread: covering / not", (x => x.ok && x.text === "covering by 4.5")(legProgress(L("spread", "away", -2.5), g)) && (x => !x.ok && x.text === "needs 4 more to cover")(legProgress(L("spread", "home", 3), g)));
check("moneyline: up / down", legProgress(L("ml", "away"), g).text === "Bills up 7" && legProgress(L("ml", "home"), g).text === "Vikings down 7" && !legProgress(L("ml", "home"), g).ok);
console.log(`legtrack: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
