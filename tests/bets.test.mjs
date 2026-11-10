// Bet slips: reading typed picks, matching them to games, odds math, grading and the leaderboards (no network).
import { parsePick, resolvePick, slipPrice, amToDec, decToAm, gradeLeg, settleSlip, bettorStats, leaderboards, readOdds, legLabel, readPct, amToPct, fmtPct, fmtOdds, readOddsAs, legFromRow } from "../src/bets.js";
let pass = 0, fail = 0;
const check = (n, c, d) => { if (c) pass++; else { fail++; console.log("  FAIL:", n, d === undefined ? "" : JSON.stringify(d).slice(0, 400)); } };

// ---- reading picks ----
const P = t => parsePick(t);
check("ML", P("Real Madrid ML").market === "ml" && P("Real Madrid ML").q === "real madrid", P("Real Madrid ML"));
check("bare team is ML", P("Lakers").market === "ml" && P("Lakers").q === "lakers");
check("spread minus", P("Lakers -3.5").market === "spread" && P("Lakers -3.5").line === -3.5 && P("Lakers -3.5").q === "lakers", P("Lakers -3.5"));
check("spread plus", P("Chiefs +3").line === 3 && P("Chiefs +3").market === "spread");
check("pick'em", P("Arsenal pk").market === "spread" && P("Arsenal pk").line === 0);
check("over", (x => x.market === "total" && x.side === "over" && x.line === 220.5 && x.q === "lakers celtics")(P("Lakers Celtics over 220.5")), P("Lakers Celtics over 220.5"));
check("o shorthand", (x => x.side === "over" && x.line === 47.5)(P("Chiefs/Bills o47.5")), P("Chiefs/Bills o47.5"));
check("under shorthand", (x => x.side === "under" && x.line === 8.5)(P("Yankees u8.5")));
check("draw", P("Real Madrid vs Barcelona draw").market === "draw");
check("odds typed in the pick are ignored", P("Real Madrid ML -150").q === "real madrid" && P("Real Madrid ML -150").market === "ml", P("Real Madrid ML -150"));

// ---- matching to the board ----
const row = (sport, id, away, home, state = "pre", date = "2026-11-05T00:00Z", extra = {}) => ({ sport, league: sport === "Soccer" ? "uefa.champions" : sport.toLowerCase(), id, date, state, ...extra,
  away: { name: away[0], full: away[1], abbr: away[2], nick: away[3] || "", loc: away[4] || "" }, home: { name: home[0], full: home[1], abbr: home[2], nick: home[3] || "", loc: home[4] || "" } });
const rows = [
  row("NBA", "1", ["Lakers", "Los Angeles Lakers", "LAL", "Lakers", "Los Angeles"], ["Celtics", "Boston Celtics", "BOS", "Celtics", "Boston"]),
  row("NBA", "2", ["76ers", "Philadelphia 76ers", "PHI", "76ers", "Philadelphia"], ["Pistons", "Detroit Pistons", "DET", "Pistons", "Detroit"], "in"),
  row("Soccer", "3", ["Real Madrid", "Real Madrid", "RMA", "Real Madrid", "Real Madrid"], ["AEK Athens", "AEK Athens", "AEK"]),
  row("NFL", "4", ["Chiefs", "Kansas City Chiefs", "KC", "Chiefs", "Kansas City"], ["Bills", "Buffalo Bills", "BUF", "Bills", "Buffalo"]),
  row("Tennis", "5", ["Jannik Sinner", "", ""], ["Taylor Fritz", "", ""]),
  row("CFB", "6", ["Ball State", "Ball State Cardinals", "BALL", "Cardinals", "Ball State"], ["UMass", "Massachusetts Minutemen", "MASS", "Minutemen", "Massachusetts"]),
];
const R = t => resolvePick(parsePick(t), rows);
check("ML resolves to the game and side", (x => x.status === "ok" && x.leg.eventId === "3" && x.leg.side === "away" && x.leg.sport === "Soccer")(R("Real Madrid ML")), R("Real Madrid ML"));
check("home side", R("Celtics -4").leg.side === "home" && R("Celtics -4").leg.line === -4);
check("abbreviation", R("KC +2.5").leg.eventId === "4" && R("KC +2.5").leg.side === "away", R("KC +2.5"));
check("city name", R("Buffalo ML").leg.side === "home");
check("total by both teams", (x => x.leg.eventId === "4" && x.leg.side === "over" && x.leg.line === 47.5)(R("Chiefs/Bills o47.5")));
check("total by one team", R("Lakers u221").leg.eventId === "1" && R("Lakers u221").leg.side === "under");
check("tennis surname", R("Sinner ML").leg.eventId === "5" && R("Sinner ML").leg.side === "away", R("Sinner ML"));
check("UMass", R("UMass -7").leg.eventId === "6" && R("UMass -7").leg.side === "home", R("UMass -7"));
check("a started game is flagged", R("76ers ML").status === "started");
check("unknown team", R("Green Bay ML").status === "none");
check("draw only for soccer", R("Lakers draw").status === "none" && R("Real Madrid draw").leg.side === "draw");
check("label", legLabel(R("Celtics -4").leg) === "Celtics -4" && legLabel(R("Real Madrid ML").leg) === "Real Madrid ML" && legLabel(R("Lakers u221").leg) === "Lakers / Celtics under 221", [legLabel(R("Lakers u221").leg)]);

// ---- odds ----
check("odds read", readOdds("-110") === -110 && readOdds("+150") === 150 && readOdds("150") === 150 && readOdds("EVEN") === 100 && readOdds("-50") === null && readOdds("abc") === null);
check("decimal", Math.abs(amToDec(-110) - 1.90909) < 1e-4 && amToDec(150) === 2.5 && decToAm(2.5) === 150 && decToAm(amToDec(-110)) === -110);
const two = slipPrice([-110, -110], 10);
check("two-leg parlay -110/-110 is +264", two.am === 264 && Math.abs(two.payout - 36.45) < 0.01, two);
const three = slipPrice([150, -200, 120], 20);
check("three-leg parlay", three.am === 725 && Math.abs(three.payout - 165) < 0.01, three);
check("straight", Math.abs(slipPrice([-150], 30).payout - 50) < 1e-9 && slipPrice([-150], 30).am === -150);
check("missing odds", slipPrice([-110, null], 10) === null);

// ---- grading ----
const fin = (a, h, extra = {}) => ({ state: "post", done: true, detail: "Final", away: { score: String(a), win: a > h }, home: { score: String(h), win: h > a }, ...extra });
check("ML win/loss", gradeLeg({ sport: "NBA", market: "ml", side: "away" }, fin(110, 100)) === "W" && gradeLeg({ sport: "NBA", market: "ml", side: "home" }, fin(110, 100)) === "L");
check("soccer draw loses the ML, wins the draw", gradeLeg({ sport: "Soccer", market: "ml", side: "away" }, fin(1, 1)) === "L" && gradeLeg({ sport: "Soccer", market: "draw", side: "draw" }, fin(1, 1)) === "W" && gradeLeg({ sport: "Soccer", market: "draw", side: "draw" }, fin(2, 1)) === "L");
check("NFL tie pushes the ML", gradeLeg({ sport: "NFL", market: "ml", side: "away" }, fin(20, 20)) === "P");
check("spread cover / push / miss", gradeLeg({ sport: "NFL", market: "spread", side: "home", line: -3 }, fin(20, 24)) === "W" && gradeLeg({ sport: "NFL", market: "spread", side: "home", line: -3 }, fin(20, 23)) === "P" && gradeLeg({ sport: "NFL", market: "spread", side: "away", line: 2.5 }, fin(20, 23)) === "L");
check("totals", gradeLeg({ sport: "NBA", market: "total", side: "over", line: 220.5 }, fin(110, 111)) === "W" && gradeLeg({ sport: "NBA", market: "total", side: "under", line: 221 }, fin(110, 111)) === "P" && gradeLeg({ sport: "NBA", market: "total", side: "under", line: 220.5 }, fin(110, 111)) === "L");
check("tennis by the winner flag", gradeLeg({ sport: "Tennis", market: "ml", side: "home" }, { state: "post", detail: "Final", away: { score: "6 3 4", win: false }, home: { score: "4 6 6", win: true } }) === "W");
check("not over yet", gradeLeg({ sport: "NBA", market: "ml", side: "away" }, { state: "in", away: { score: "50" }, home: { score: "40" } }) === null);
check("postponed is void", gradeLeg({ sport: "MLB", market: "ml", side: "away" }, { state: "post", detail: "Postponed", away: { score: "0" }, home: { score: "0" } }) === "P");

const slip = (stake, legs) => ({ stake, legs: legs.map(([odds, res]) => ({ odds, res })) });
check("straight win pays", settleSlip(slip(10, [[-110, "W"]])).profit === 9.09 && settleSlip(slip(10, [[-110, "W"]])).status === "won");
check("parlay loses on one leg", settleSlip(slip(10, [[-110, "W"], [150, "L"], [200, null]])).status === "lost");
check("parlay waits", settleSlip(slip(10, [[-110, "W"], [200, null]])).status === "pending");
check("pushed leg drops out", settleSlip(slip(10, [[-110, "W"], [150, "P"]])).profit === 9.09);
check("all pushed refunds", settleSlip(slip(10, [[-110, "P"]])).status === "push" && settleSlip(slip(10, [[-110, "P"]])).profit === 0);

// ---- records and boards: "5 for 7" and dollars ----
const S = (status, stake, profit, sport = "NBA", n = 1, t = "2026-11-0") => ({ status, stake, profit, legs: Array.from({ length: n }, () => ({ sport })), settled: t, created: t });
const bob = bettorStats([S("won", 10, 9.09, "NBA", 1, "a"), S("won", 10, 9.09, "NBA", 1, "b"), S("lost", 10, -10, "NFL", 1, "c"), S("won", 5, 30, "NBA", 3, "d"), S("won", 10, 10, "NBA", 1, "e"), S("lost", 10, -10, "NBA", 1, "f"), S("won", 10, 9.09, "NBA", 1, "g"), S("push", 10, 0), S("pending", 10, null)]);
check("5 for 7 with a push and a pending", bob.W === 5 && bob.L === 2 && bob.P === 1 && bob.pending === 1 && Math.abs(bob.pct - 5 / 7) < 1e-9, bob);
check("money: won, lost, net", bob.won === 67.27 && bob.lost === 20 && bob.net === 47.27 && bob.staked === 65, bob);
check("streak and best", bob.streak === "W1" && bob.best.profit === 30 && bob.parlays.W === 1 && bob.bySport.NFL.L === 1);
const amy = bettorStats([S("won", 100, 250), S("lost", 100, -100), S("lost", 100, -100)]);
const zed = bettorStats([S("won", 10, 10), S("won", 10, 10)]);
const lb = leaderboards([{ username: "bob", stats: bob }, { username: "amy", stats: amy }, { username: "zed", stats: zed }, { username: "new", stats: bettorStats([]) }]);
check("record board: win % first", lb.record.map(p => p.username).join() === "zed,bob,amy", lb.record.map(p => p.username));
check("money board: net first", lb.money.map(p => p.username).join() === "amy,bob,zed", lb.money.map(p => p.username));
check("no graded bets, not ranked yet", !lb.record.some(p => p.username === "new"));

// ---- percentages (Kalshi-style) ----
check("54% is -117, 40% is +150, 50% is +100", readPct("54") === -117 && readPct("40%") === 150 && readPct("50") === 100, [readPct("54"), readPct("40%"), readPct("50")]);
check("cents and decimals read too", readPct("56¢") === readPct("56") && readPct("0.56") === readPct("56") && readPct("33.3") === 200);
check("out of range or junk refused", readPct("0") === null && readPct("100") === null && readPct("abc") === null && readPct("") === null && readPct("-5") === null);
check("back the other way", Math.abs(amToPct(-110) - 52.38) < 0.01 && fmtPct(-110) === "52.4%" && fmtPct(150) === "40%" && fmtOdds(-110, "am") === "-110" && fmtOdds(-110, "pct") === "52.4%");
check("read by format", readOddsAs("-120", "am") === -120 && readOddsAs("54", "pct") === -117 && readOddsAs("54", "am") === null);
// ---- tailing: a leg rebuilt from the board matches what typing it would give ----
const tl = legFromRow(rows[0], { market: "spread", side: "home", line: -4 });
check("tail leg = typed leg", JSON.stringify(tl) === JSON.stringify({ ...R("Celtics -4").leg }), [tl, R("Celtics -4").leg]);
check("tail leg: ML carries no line", legFromRow(rows[2], { market: "ml", side: "away", line: 5 }).line === null && legLabel(legFromRow(rows[2], { market: "ml", side: "away" })) === "Real Madrid ML");
console.log(`bets: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
