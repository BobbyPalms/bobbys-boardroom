// Live tennis: the point-by-point model agrees with the ratings before the match and plays out the rest from the score.
import { holdProb, tiebreakProb, setFrom, tennisLive, servePoints, readSets } from "../src/ratings.js";
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
console.log(`tennis live: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
