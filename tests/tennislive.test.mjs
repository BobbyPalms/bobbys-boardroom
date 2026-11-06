// Live tennis: the point-by-point model agrees with the ratings before the match and plays out the rest from the score.
import { holdProb, tiebreakProb, setFrom, tennisLive, servePoints, readSets, tennisSim, fitServe, overProb, coverProb, tennisProfiles, parseSetScores, tourOf, h2hShard } from "../src/ratings.js";
let pass = 0, fail = 0;
const check = (n, c, d) => { if (c) pass++; else { fail++; console.log("  FAIL:", n, d === undefined ? "" : JSON.stringify(d).slice(0, 400)); } };
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
check("hold: 50% serve points is a coin flip", near(holdProb(0.5), 0.5));
check("hold: 64% serve points holds ~83%", holdProb(0.64) > 0.81 && holdProb(0.64) < 0.85, holdProb(0.64));
check("tiebreak: equal players 50/50", near(tiebreakProb(0.64, 0.64), 0.5, 1e-9));
check("tiebreak: symmetric", near(tiebreakProb(0.66, 0.62) + tiebreakProb(0.62, 0.66), 1, 1e-9));
check("set: equal players from 0-0 is 50/50", near((setFrom(0, 0, true, 0.64, 0.64) + setFrom(0, 0, false, 0.64, 0.64)) / 2, 0.5, 1e-9));
check("set: 5-3 up serving for it is very likely", setFrom(5, 3, true, 0.64, 0.64) > 0.9);
check("set: finished states", setFrom(6, 4, true, 0.6, 0.6) === 1 && setFrom(5, 7, true, 0.6, 0.6) === 0);
// calibration to the ratings
for (const [p, tour] of [[0.5, "atp"], [0.7, "atp"], [0.82, "wta"], [0.3, "atp"]]) { const s = servePoints(p, tour); check(`calibrated: model says ${p} before the match (${tour})`, near(tennisLive({}, s.pA, s.pB, 3).p, p, 1e-4), tennisLive({}, s.pA, s.pB, 3).p); }
const s = servePoints(0.7, "atp");
const pre = tennisLive({}, s.pA, s.pB, 3).p;
const upSet = tennisLive({ sa: 1, sb: 0, ga: 0, gb: 0 }, s.pA, s.pB, 3).p, downSet = tennisLive({ sa: 0, sb: 1, ga: 0, gb: 0 }, s.pA, s.pB, 3).p;
check("a set up raises it, a set down lowers it", upSet > pre && downSet < pre && upSet > 0.85 && downSet < 0.5, [pre, upSet, downSet]);
check("serving for the match", tennisLive({ sa: 1, sb: 0, ga: 5, gb: 2 }, s.pA, s.pB, 3).p > 0.97);
check("final-set comeback math: down a break in the decider", (x => x < 0.4 && x > 0.05)(tennisLive({ sa: 1, sb: 1, ga: 1, gb: 3 }, s.pA, s.pB, 3).p));
const L = tennisLive({ sa: 1, sb: 0, ga: 2, gb: 2 }, s.pA, s.pB, 3);
check("scorelines from here add up and only the possible ones", near(L.scores.reduce((a, [, v]) => a + v, 0), 1, 1e-9) && L.scores.every(([k]) => ["2-0", "2-1", "1-2"].includes(k)), L.scores);
const B5 = tennisLive({}, s.pA, s.pB, 5, true).p;
check("best of five favors the better player more", B5 > pre, [B5, pre]);
check("a slam decider with a 10-point tiebreak still works", (x => x > 0 && x < 1)(tennisLive({ sa: 2, sb: 2, ga: 6, gb: 6 }, s.pA, s.pB, 5, true).p));
// reading the board
check("sets read: 7 3 5 / 6 6 4 live → 1 set each... ", JSON.stringify(readSets("7 3 5", "6 6 4")) === JSON.stringify({ sa: 1, sb: 1, ga: 5, gb: 4, sets: 3 }), readSets("7 3 5", "6 6 4"));
check("sets read: 6 4 / 4 2 live → 1-0, 4-2 in the 2nd", JSON.stringify(readSets("6 4", "4 2")) === JSON.stringify({ sa: 1, sb: 0, ga: 4, gb: 2, sets: 2 }));
check("sets read: tiebreak set 7-6", readSets("7 1", "6 0").sa === 1 && readSets("7 1", "6 0").ga === 1);
check("sets read: no score yet", JSON.stringify(readSets("", "")) === JSON.stringify({ sa: 0, sb: 0, ga: 0, gb: 0, sets: 0 }));
// ---- Monte Carlo agrees with the exact math ----
let seed = 7; const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };   // mulberry32
const S = tennisSim({}, s.pA, s.pB, 3, false, 20000, rnd);
check("10,000-style sims match the exact win chance", Math.abs(S.pA - pre) < 0.012, [S.pA, pre]);
check("set scores add up; only real best-of-3 results", Math.abs(Object.values(S.sets).reduce((a, b) => a + b, 0) - S.n) === 0 && Object.keys(S.sets).every(k => ["2-0", "2-1", "0-2", "1-2"].includes(k)), S.sets);
check("total games in a sane range", S.avgGames > 19 && S.avgGames < 27, S.avgGames);
check("over / cover probabilities", Math.abs(overProb(S, 0.5) - 1) < 1e-9 && overProb(S, 100) === 0 && coverProb(S, 0) > 0.5);
const SL = tennisSim({ sa: 1, sb: 0, ga: 5, gb: 2, gamesSoFar: 13, marginSoFar: 5 }, s.pA, s.pB, 3, false, 8000, rnd);
check("from a live score: games so far count, win chance matches the exact math", SL.avgGames > 13 + 2 && Math.abs(SL.pA - tennisLive({ sa: 1, sb: 0, ga: 5, gb: 2 }, s.pA, s.pB, 3).p) < 0.015, [SL.avgGames, SL.pA]);
const F1 = fitServe(0.7, "atp", { a: { avg3: 26, n3: 40 }, b: { avg3: 25, n3: 40 } }, rnd), F2 = fitServe(0.7, "atp", { a: { avg3: 21, n3: 40 }, b: { avg3: 21, n3: 40 } }, rnd);
check("long-match players get a higher serve level (more holds, more games)", F1.base > F2.base && F1.target > F2.target, [F1, F2]);
check("serve level stays realistic (within 6 points of the tour)", [F1, F2].every(f => f.base >= 0.58 - 1e-9 && f.base <= 0.70 + 1e-9 && f.pA > 0.55 && f.pB > 0.5), [F1.base, F2.base]);
check("the Elo win chance is held fixed while fitting", Math.abs(tennisLive({}, F1.pA, F1.pB, 3).p - 0.7) < 0.002 && Math.abs(tennisLive({}, F2.pA, F2.pB, 3).p - 0.7) < 0.002);
// ---- profiles from the match record ----
const ms = [
  { id: "1", date: "2026-10-01T10:00Z", completed: true, winner: "a", draw: "mens-singles", tour: "wta", bo: 3, sets: "7-6 6-3", a: { id: "10", name: "A Player" }, b: { id: "20", name: "B Player" } },
  { id: "2", date: "2026-10-05T10:00Z", completed: true, winner: "b", draw: "mens-singles", tour: "atp", bo: 3, sets: "6-4 3-6 4-6", a: { id: "10", name: "A Player" }, b: { id: "20", name: "B Player" } },
  { id: "3", date: "2026-10-09T10:00Z", completed: true, winner: "a", draw: "mens-singles", tour: "atp", bo: 3, sets: "6-2 6-1", a: { id: "20", name: "B Player" }, b: { id: "30", name: "C Player" } },
];
const PR = tennisProfiles(ms, new Date("2026-11-01T00:00Z")), a = PR.players["10"], b = PR.players["20"];
check("profile: record, sets, games, tiebreaks, form, tour from the draw", a[1] === "atp" && a[2] === 2 && a[3] === 1 && a[4] === 1 && a[5] === 3 && a[6] === 2 && a[7] === 7 + 6 + 6 + 3 + 4 && a[8] === 6 + 3 + 4 + 6 + 6 && a[9] === 1 && a[10] === 0 && a[13] === "WL", a);
check("profile: straight-set wins and games per match", b[11] === 1 && b[12] === 22, b);
check("head to head kept by the lower id, with the last score from that side", JSON.stringify(PR.h2h["10-20"]) === JSON.stringify([1, 1, "2026-10-05", "", "6-4 3-6 4-6"]), PR.h2h["10-20"]);
check("set scores read", JSON.stringify(parseSetScores("6-7 3-6")) === "[[6,7],[3,6]]" && parseSetScores("") === null);
check("tour by draw", tourOf({ draw: "womens-singles", tour: "atp" }) === "wta" && tourOf({ draw: "mens-singles", tour: "wta" }) === "atp");
check("h2h shard is the same either way round", h2hShard("10", "20") === h2hShard("20", "10") && h2hShard("10", "20") >= 0 && h2hShard("10", "20") < 16);
console.log(`tennis live: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
