// Power ratings (engine v4): the attack / defense fit, the draw correction, key numbers, pooling, and the engine using them.
import { build } from "esbuild";
import { mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { fitPower, powerMu, marketScores, dcTau, applyKeyNumbers, logitPool } from "../src/power.js";
import { resultRows } from "../src/routes.js";
let pass = 0, fail = 0;
const check = (n, c, d) => { if (c) pass++; else { fail++; console.log("  FAIL:", n, d === undefined ? "" : JSON.stringify(d).slice(0, 400)); } };
let seed = 12345;
const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const pois = mu => { const L = Math.exp(-mu); let k = 0, p = 1; do { k++; p *= rnd(); } while (p > L); return k - 1; };

// ---- a league with known strengths: the fit finds them ----
const TRUE = {}; for (let i = 0; i < 12; i++) TRUE["T" + i] = { o: 0.7 + 0.06 * i, d: 1.3 - 0.05 * i };
const ids = Object.keys(TRUE), L0 = 2.8, ETA = 0.12, games = [];
for (let r = 0; r < 14; r++) for (const h of ids) for (const a of ids) if (h !== a && rnd() < 0.5) games.push({ t: r * 7, h, a, hs: pois(L0 * TRUE[h].o * TRUE[a].d * Math.exp(ETA)), as: pois(L0 * TRUE[a].o * TRUE[h].d * Math.exp(-ETA)) });
const fit = fitPower(games, { k: 2 });
const err = ids.reduce((s, id) => s + Math.abs(fit.teams[id].o - TRUE[id].o) + Math.abs(fit.teams[id].d - TRUE[id].d), 0) / (2 * ids.length);
check("recovers each team's attack and defense", err < 0.07, { err, n: games.length });
check("recovers the home edge", Math.abs(fit.eta - ETA) < 0.04 && fit.L > 2 && fit.L < 4, { eta: fit.eta, L: fit.L });
check("the best team is rated the best", ids.slice().sort((a, b) => fit.teams[b].o / fit.teams[b].d - fit.teams[a].o / fit.teams[a].d)[0] === "T11");

// ---- opponent adjustment: same scores, different schedules ----
const sched = [];
for (let k = 0; k < 8; k++) { sched.push({ t: k, h: "STRONG", a: "X" + k, hs: 5, as: 0, n: true }, { t: k, h: "WEAK", a: "Y" + k, hs: 0, as: 5, n: true }); }
// A scores 2 a game against the strong defense; B scores 2 a game against the weak one
for (let k = 0; k < 6; k++) sched.push({ t: 10 + k, h: "A", a: "STRONG", hs: 2, as: 2, n: true }, { t: 10 + k, h: "B", a: "WEAK", hs: 2, as: 2, n: true });
const f2 = fitPower(sched, { k: 3 }), raw = fitPower(sched, { k: 3, adjust: false });
check("2 a game against a strong defense rates above 2 a game against a weak one", f2.teams.A.o > f2.teams.B.o * 1.15, { A: f2.teams.A.o, B: f2.teams.B.o });
check("without the adjustment they look the same (the old engine)", Math.abs(raw.teams.A.o - raw.teams.B.o) < 1e-9);
check("the evidence alone is reported for the engine (rate and games behind it)", f2.teams.A.ro > f2.teams.B.ro && f2.teams.A.no > 0 && f2.teams.A.g === 6, f2.teams.A);

// ---- recency: an old run of form fades ----
const form = [];
for (let k = 0; k < 10; k++) form.push({ t: k, h: "HOT", a: "O" + (k % 3), hs: 1, as: 1, n: true });
for (let k = 0; k < 5; k++) form.push({ t: 200 + k, h: "HOT", a: "O" + (k % 3), hs: 4, as: 1, n: true });
check("recent games count more with time decay", fitPower(form, { k: 3, xi: 0.02, L: 1.5 }).teams.HOT.o > fitPower(form, { k: 3, L: 1.5 }).teams.HOT.o * 1.2, [fitPower(form, { k: 3, xi: 0.02, L: 1.5 }).teams.HOT.o, fitPower(form, { k: 3, L: 1.5 }).teams.HOT.o]);

// ---- closing lines as evidence ----
const mk = marketScores(-6.5, 47.5);
check("a closing line as expected scores (home -6.5, total 47.5 -> 27 - 20.5)", mk.ms === 27 && mk.ma === 20.5 && marketScores(3, 44).ma === 23.5 && marketScores(null, 44) === null);
const lineOnly = [{ t: 1, h: "FAV", a: "DOG", hs: 10, as: 30, ms: 27, ma: 20.5 }, { t: 2, h: "FAV", a: "DOG2", hs: 13, as: 27, ms: 28, ma: 20 }, { t: 3, h: "DOG", a: "DOG2", hs: 20, as: 20, ms: 22, ma: 22 }];
const noM = fitPower(lineOnly, { k: 3, L: 23 }), withM = fitPower(lineOnly, { k: 3, L: 23, mkt: 10 });
check("results alone say the favourite is bad; its closing lines say otherwise", noM.teams.FAV.o < noM.teams.DOG.o && withM.teams.FAV.o > withM.teams.DOG.o, { no: noM.teams.FAV.o, with: withM.teams.FAV.o });
check("stable with heavy market weight (no blow-up)", (x => Object.values(x.teams).every(t => t.o > 0.3 && t.o < 3 && t.d > 0.3 && t.d < 3))(fitPower(lineOnly, { k: 1, L: 23, mkt: 200 })));
const pm = powerMu(withM, "FAV", "DOG", false);
check("expected scores from a fit", pm.muH > pm.muA && powerMu(withM, "NEW", "DOG").muH > 0);

// ---- Dixon-Coles ----
const P = (mu, k) => { let p = Math.exp(-mu); for (let i = 1; i <= k; i++) p *= mu / i; return p; };
let z = 0, d0 = 0, d1 = 0; for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) { const w = P(1.5, i) * P(1.1, j), t = dcTau(i, j, 1.5, 1.1, -0.07); z += w * t; if (i === j) { d0 += w; d1 += w * t; } }
check("draw correction: still sums to 1, and draws go up", Math.abs(z - 1) < 1e-6 && d1 > d0 * 1.03, { z, d0, d1 });

// ---- key numbers ----
const bell = []; for (let d = -30; d <= 30; d++) bell.push(Math.exp(-0.5 * ((d - 3) / 12.8) ** 2)); const zb = bell.reduce((a, b) => a + b, 0), pmf = bell.map(v => v / zb);
const kn = applyKeyNumbers(pmf, -30, { 3: 2.7, 7: 1.8, 1: 0.5, rest: 1 });
check("key numbers: 3 and 7 get heavier, 1 lighter, still sums to 1", kn[33] > pmf[33] * 2 && kn[37] > pmf[37] * 1.5 && kn[31] < pmf[31] && kn[27] > pmf[27] * 2 && Math.abs(kn.reduce((a, b) => a + b, 0) - 1) < 1e-9);
check("no table, no change", applyKeyNumbers(pmf, -30, null) === pmf);

// ---- pooling on the log-odds scale ----
check("pooling: between the two, at the ends when w is 0 or 1, never past 0 or 1", Math.abs(logitPool(0.7, 0.58, 0) - 0.58) < 1e-9 && Math.abs(logitPool(0.7, 0.58, 1) - 0.7) < 1e-9 && (x => x > 0.58 && x < 0.7)(logitPool(0.7, 0.58, 0.15)) && logitPool(0.999999, 0.5, 0.5) < 1);

// ---- the season log's rows from a scoreboard ----
const sb = { events: [
  { id: "1", date: "2026-11-09T00:30Z", season: { type: 2 }, competitions: [{ neutralSite: false, status: { type: { completed: true, name: "STATUS_FINAL" } }, competitors: [{ homeAway: "home", score: "110", team: { id: "8", abbreviation: "DET" } }, { homeAway: "away", score: "100", team: { id: "20", abbreviation: "PHI" } }] }] },
  { id: "2", date: "2026-10-05T00:30Z", season: { type: 1 }, competitions: [{ status: { type: { completed: true } }, competitors: [{ homeAway: "home", score: "90", team: { id: "8", abbreviation: "DET" } }, { homeAway: "away", score: "95", team: { id: "2", abbreviation: "BOS" } }] }] },
  { id: "3", date: "2026-11-09T02:00Z", season: { type: 2 }, competitions: [{ status: { type: { completed: false } }, competitors: [{ homeAway: "home", score: "50", team: { id: "1", abbreviation: "ATL" } }, { homeAway: "away", score: "48", team: { id: "2", abbreviation: "BOS" } }] }] },
  { id: "4", date: "2026-11-09T02:00Z", season: { type: 2 }, competitions: [{ neutralSite: true, status: { type: { completed: true, name: "STATUS_POSTPONED" } }, competitors: [{ homeAway: "home", score: "0", team: { id: "1" } }, { homeAway: "away", score: "0", team: { id: "2" } }] }] }] };
const rr = resultRows(sb);
check("season log: finished regular-season games only (no preseason, live or postponed)", rr.length === 1 && rr[0].id === "1" && rr[0].h === "8" && rr[0].a === "20" && rr[0].hs === 110 && rr[0].as === 100 && rr[0].neutral === false && rr[0].ha === "DET" && Number.isInteger(rr[0].day), rr);

// ---- the engine uses it ----
const root = join(dirname(fileURLToPath(import.meta.url)), ".."), out = join(mkdtempSync(join(tmpdir(), "bbpow-")), "engine.mjs");
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 };
await build({ entryPoints: [join(root, "src/boardroom.jsx")], bundle: true, platform: "node", format: "esm", outfile: out, jsx: "automatic", loader: { ".jsx": "jsx" }, define: { "process.env.NODE_ENV": '"production"', __BUILD__: '"test"' }, logLevel: "error" });
const { engine: E } = await import(out);
const team = (name, abbr, id, gpg, gaa, gp = 8) => ({ name, abbr, espnId: id, record: "4-4", gpg, gaa, gp, has: { gpg: true, gaa: true, gk: false, qb: false, rating: false, lineup: false }, prev: {}, hist: [], xg: {}, goalie: { name: "TBD" }, skaters: [] });
// two NBA teams with the same points per game: one played the league's best defenses, one its worst
const day = Math.floor(Date.now() / 864e5), g = {}, t = {}; let eid = 1;
const add = (h, a, hs, as, sp = null, tot = null) => { g[eid++] = [day - 5 - (eid % 20), h, a, hs, as, 0, sp, tot]; t[h] = "T" + h; t[a] = "T" + a; };
for (let k = 0; k < 8; k++) { add("900", String(100 + k), 118, 92); add(String(200 + k), "901", 126, 104); }      // 900: elite defense; 901: terrible defense
for (let k = 0; k < 8; k++) { add("900", "1", 104, 110); add("2", "901", 104, 110); }                              // team 1 scores 110 on the elite defense; team 2 allows... (2 scores 104 at home vs 901)
for (let k = 0; k < 8; k++) add("901", "3", 124, 110);                                                              // team 3 scores 110 on the terrible defense
E.RESULTS.NBA = { R: { season: 2026, leagues: { nba: { t, g } } }, hist: {} };
for (const k of Object.keys(E._powerFits)) delete E._powerFits[k];
const pl = E.powerLeague("NBA", "nba");
check("engine: league fitted from the season log", pl && pl.teams["1"] && pl.teams["3"] && pl.teams["1"].o > pl.teams["3"].o * 1.015 && pl.teams["1"].ro > pl.teams["3"].ro * 1.04, pl && { one: pl.teams["1"], three: pl.teams["3"] });
const L = E.LEAGUE.NBA.L, T1 = team("One", "ONE", "1", 110, 104), T3 = team("Three", "THR", "3", 110, 124);
const o1 = E.poolSide(T1, "NBA", L, "off", null, pl.teams["1"]), o3 = E.poolSide(T3, "NBA", L, "off", null, pl.teams["3"]), o1raw = E.poolSide(T1, "NBA", L, "off", null), o3raw = E.poolSide(T3, "NBA", L, "off", null);
check("engine: same 110 a game, but the one who did it against the elite defense has the better attack", o1.r > o3.r * 1.015 && Math.abs(o1raw.r - o3raw.r) < 1e-9 && o1.power && !o1raw.power, { o1: o1.r, o3: o3.r, raw: o1raw.r });
const md = { away: T3, home: T1, league: { gpg: L }, matchInfo: {}, leagueSlug: "nba" };
const withP = E.buildPlan(T1, T3, "NBA", md, { learn: null }), noP = E.buildPlan(T1, T3, "NBA", md, { learn: null, power: false });
check("engine: the plan uses the power ratings (and can be run without them)", withP.parts.home.pw && !noP.parts.home.pw && withP.muH !== noP.muH, { withP: withP.muH, noP: noP.muH });
check("engine: no log for a league -> the old path, unchanged", E.powerLeague("NBA", "nope") === null && E.powerLeague("WNBA", "wnba") === null);
// closing lines in the log count for the point-spread sports
const g2 = { ...g }; let e2 = 5000; for (let k = 0; k < 6; k++) g2[e2++] = [day - 2, "3", String(300 + k), 100, 112, 0, -9.5, 228];   // team 3 keeps losing as a 9.5-point favourite
E.RESULTS.NBA = { R: { season: 2026, leagues: { nba: { t, g: g2 } } }, hist: {} }; for (const k of Object.keys(E._powerFits)) delete E._powerFits[k];
const pl2 = E.powerLeague("NBA", "nba");
check("engine: closing lines are read from the log", pl2.lines === 6 && pl2.teams["3"].o > 0.9, { lines: pl2.lines, o: pl2.teams["3"].o });
delete E.RESULTS.NBA; for (const k of Object.keys(E._powerFits)) delete E._powerFits[k];

// ---- the blend with the market ----
check("the sim starts as a small voice next to the price (10-15%)", E.startBlend("NFL") === 0.10 && E.startBlend("NBA") === 0.15 && E.startBlend("CBB") === 0.10);
const bet = E.makeBet({ key: "k", market: "ML", side: "home", label: "x", odds: -150, w: 0.70, l: 0.30, fair: 0.58, bw: 0.15 });
check("a 12-point disagreement with the market becomes a small edge at 15% weight", bet.wc > 0.58 && bet.wc < 0.61 && bet.edge > 0 && bet.edge < 3, { wc: bet.wc, edge: bet.edge });
// soccer: the draw correction is in the pricing
const A = team("Away FC", "AWY", "51", 1.4, 1.4), H = team("Home FC", "HOM", "52", 1.4, 1.4);
const sim = E.runSimulations(H, A, "Soccer", { away: A, home: H, league: { gpg: 1.4 }, matchInfo: {} }, 20000, { learn: null });
const px = E.priceGame(sim.plan, "Soccer", 1);
const indep = (() => { let d = 0; for (let i = 0; i < 15; i++) d += P(sim.plan.muH, i) * P(sim.plan.muA, i); return d; })();
check("soccer: more draws than independent scores give, in the pricing and in the sims", px.ml.pD > indep * 1.03 && Math.abs(sim.drawPct / 100 - px.ml.pD) < 0.015, { priced: px.ml.pD, indep, sim: sim.drawPct });
// NFL: key numbers in the spread pricing
const N1 = team("Home", "HOM", "61", 24.5, 21), N2 = team("Away", "AWY", "62", 21, 24);
const ps = E.priceGame(E.buildPlan(N1, N2, "NFL", { away: N2, home: N1, league: { gpg: 22.6 }, matchInfo: {} }, { learn: null }), "NFL", 1);
const at3 = ps.margin(-3), at4 = ps.margin(-4), at2 = ps.margin(-2);
check("NFL: landing exactly on 3 is far likelier than on 2 or 4", at3.push > 0.06 && at3.push > 2 * at4.push && at3.push > 2 * at2.push, { p3: at3.push, p4: at4.push, p2: at2.push });
console.log(`power: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
