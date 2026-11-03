import { parseTennis, parseUFC, runElo, fitElo, score, eloP, setProb, tennisOutlook, rateFor, recordWL } from "../src/ratings.js";
let pass = 0, fail = 0;
const check = (n, c, d) => { if (c) pass++; else { fail++; console.log("  FAIL:", n, d === undefined ? "" : JSON.stringify(d).slice(0, 300)); } };
// real-shaped tennis board (Boss Open 2025: Li Tu bt Eliot Spizzirri 6-4 7-5)
export const tennisBoard = (matches, { major = false, name = "Boss Open" } = {}) => ({ events: [{ name, major, date: "2025-06-07T04:00Z", groupings: [
  { grouping: { slug: "mens-singles" }, competitions: matches.map(([id, a, b, aw, sets, extra = {}]) => ({ id, date: extra.date || "2025-06-07T09:00Z", round: { displayName: "Qualifying 1st Round" }, notes: extra.note ? [{ text: extra.note }] : [],
    status: { type: { state: aw == null ? "pre" : "post", completed: aw != null } },
    competitors: [{ id: b[0], order: 1, winner: aw === false, athlete: { displayName: b[1] }, linescores: sets.map(s => ({ value: s[1] })) }, { id: a[0], order: 0, winner: aw === true, athlete: { displayName: a[1] }, linescores: sets.map(s => ({ value: s[0] })) }] })) },
  { grouping: { slug: "mens-doubles" }, competitions: [{ id: "dbl", competitors: [{ id: "x" }, { id: "y" }] }] }] }] });
const tb = tennisBoard([["c1", ["8105", "Li Tu"], ["13158", "Eliot Spizzirri"], true, [[6, 4], [7, 5]]], ["c2", ["1", "A"], ["2", "B"], false, [[3, 6]], { note: "B bt A 6-3 ret." }], ["c3", ["3", "C"], ["4", "D"], null, []]]);
const T = parseTennis(tb, "atp");
check("tennis: singles only (doubles skipped)", T.length === 3, T.map(m => m.id));
check("tennis: winner, players by order, set scores", T[0].winner === "a" && T[0].a.name === "Li Tu" && T[0].sets === "6-4 7-5" && T[0].bo === 3);
check("tennis: retirements/walkovers not rated", T[1].unrated === true && T[0].unrated === false);
check("tennis: scheduled match has no winner", T[2].completed === false && T[2].winner === null);
check("tennis: men's slam singles is best of 5", parseTennis(tennisBoard([["s", ["1", "A"], ["2", "B"], true, [[6, 1], [6, 1], [6, 1]]]], { major: true }), "atp")[0].bo === 5);
// real-shaped UFC card (UFC 314: Nora Cornolle def. Hailey Cowan)
const ufc = { events: [{ name: "UFC 314: Volkanovski vs. Lopes", date: "2025-04-12T22:00Z", competitions: [{ id: "f1", type: { abbreviation: "W Bantamweight" }, format: { regulation: { periods: 3 } }, status: { type: { state: "post", completed: true } },
  competitors: [{ order: 1, winner: false, athlete: { id: "4374742", displayName: "Hailey Cowan" }, records: [{ type: "total", summary: "7-6-0" }] }, { order: 2, winner: true, athlete: { id: "4916974", displayName: "Nora Cornolle" }, records: [{ type: "total", summary: "10-4-0" }] }] }] }] };
const U = parseUFC(ufc);
check("UFC: fight, weight class, rounds, winner", U.length === 1 && U[0].weight === "W Bantamweight" && U[0].rounds === 3 && U[0].winner === "b" && U[0].b.name === "Nora Cornolle" && U[0].a.rec === "7-6-0");
check("record parse", recordWL("10-4-0").w === 10 && recordWL("x") === null);
// Elo behaviour
check("Elo: equal ratings = 50%", eloP(1500, 1500) === 0.5 && eloP(1700, 1500) > 0.75);
const synth = (k, pStrong, nOpp = 25) => Array.from({ length: k }, (_, i) => { const w = ((i * 7919) % 1000) / 1000 < pStrong; return { id: "m" + String(i).padStart(5, "0"), date: `2020-01-01T${String(i).padStart(6, "0")}`, completed: true, winner: w ? "a" : "b", a: { id: "S", name: "Strong" }, b: { id: "W" + (i % nOpp), name: "Weak" + (i % nOpp) } }; });
const r1 = runElo(synth(300, 0.8), "Tennis", 1);
check("Elo: a player winning 80% rises well above 1500", r1.R.S.r > 1650, r1.R.S.r);
check("Elo: predictions only once both sides have history", r1.preds.length < 300 && r1.preds.length > 100);
const f = fitElo(synth(1200, 0.75), "Tennis");
check("fit: K scale chosen from the grid and tested on the later 25%", [0.7, 0.85, 1, 1.15, 1.3].includes(f.scale) && f.test && f.test.n > 50 && f.test.acc > 0.6, f.test);
check("fit: calibration buckets reported", f.test.buckets.length === 4);
check("score() handles nothing", score([]) === null);
const fm = fitElo(synth(400, 0.7).map(m => ({ ...m, a: { ...m.a, rec: "20-2-0" }, b: { ...m.b, rec: "5-5-0" } })), "MMA");
check("MMA fit picks K and record prior", fm.scale && [0, 6, 12].includes(fm.initW));
// tennis outlook
check("set probability inverts best-of-3", Math.abs(setProb(0.5) - 0.5) < 1e-9 && setProb(0.7) > 0.5 && setProb(0.7) < 0.7);
const o3 = tennisOutlook(0.65, 3), o5 = tennisOutlook(0.65, 5);
check("set scores sum to 1 (bo3, bo5)", Math.abs(o3.scores.reduce((a, x) => a + x[1], 0) - 1) < 1e-9 && Math.abs(o5.scores.reduce((a, x) => a + x[1], 0) - 1) < 1e-9);
check("best of 5 favours the favourite more", o5.p > o3.p && o3.p === 0.65);
check("unknown player = 1500, not known", rateFor({}, { id: "zz" }, "Tennis").r === 1500 && rateFor({}, { id: "zz" }, "Tennis").known === false);
check("MMA unknown fighter starts from record only when weighted", rateFor({}, { id: "z", rec: "20-0-0" }, "MMA").r === 1500);
console.log(`ratings: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
