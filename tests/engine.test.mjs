// The engine on a game in progress: the sims play only what's left on top of the current score, and the exact
// pricing agrees with them. Bundles the app the way the background tracker does (no network).
import { build } from "esbuild";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
let pass = 0, fail = 0;
const check = (n, c, d) => { if (c) pass++; else { fail++; console.log("  FAIL:", n, d === undefined ? "" : JSON.stringify(d).slice(0, 300)); } };
const root = join(dirname(fileURLToPath(import.meta.url)), ".."), out = join(mkdtempSync(join(tmpdir(), "bbeng-")), "engine.mjs");
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 };
await build({ entryPoints: [join(root, "src/boardroom.jsx")], bundle: true, platform: "node", format: "esm", outfile: out, jsx: "automatic", loader: { ".jsx": "jsx" }, define: { "process.env.NODE_ENV": '"production"', __BUILD__: '"test"' }, logLevel: "error" });
const { engine: E } = await import(out);
const team = (name, abbr, gpg, gaa) => ({ name, abbr, record: "5-3", gpg, gaa, gp: 10, has: { gpg: true, gaa: true, gk: false, qb: false, rating: false, lineup: false }, prev: {}, hist: [], xg: {}, goalie: { name: "TBD" }, skaters: [] });
const md = (sport, a, h, live) => ({ away: a, home: h, league: { gpg: E.LEAGUE[sport].L }, matchInfo: {}, live });

// soccer, home up 2-0 in the 80th minute
const s1 = E.liveState("Soccer", { live: { display: "80'", detail: "80'" }, home: { score: 2 }, away: { score: 0 } });
check("live state: soccer minute -> share left", Math.abs(s1.rem - 10 / 90) < 1e-9 && s1.hs === 2 && s1.as === 0, s1);
const A = team("Away FC", "AWY", 1.6, 1.2), H = team("Home FC", "HOM", 1.4, 1.3);
const pre = E.runSimulations(H, A, "Soccer", md("Soccer", A, H, null), 6000, { live: null });
const liv = E.runSimulations(H, A, "Soccer", md("Soccer", A, H, s1), 6000);
check("live soccer: 2-0 up with 10 minutes left wins most of the time", liv.homeWin > 85 && liv.homeWin > pre.homeWin + 30, { pre: pre.homeWin, live: liv.homeWin });
check("live soccer: final scores include the current score", liv.avgHome >= 2 && liv.avgAway < 0.6, { h: liv.avgHome, a: liv.avgAway });
const px = E.priceGame(liv.plan, "Soccer", 1);
check("live pricing agrees with the sims (home win)", Math.abs(px.ml.pH * 100 - liv.homeWin) < 2.5, { exact: px.ml.pH, sim: liv.homeWin });
check("live pricing: total can't finish below the goals already scored", px.total(1.5).lt < 1e-9 && px.meanT >= 2, { lt: px.total(1.5).lt, meanT: px.meanT });

// NBA, tied going into the last minute
const s2 = E.liveState("NBA", { live: { period: 4, clock: 60, display: "1:00", detail: "1:00 - 4th" }, home: { score: 101 }, away: { score: 101 } });
check("live state: NBA period + clock", Math.abs(s2.rem - 60 / 2880) < 1e-9, s2);
const B = team("Away Hoops", "AWB", 114, 114), C = team("Home Hoops", "HMB", 114, 114);
const tie = E.runSimulations(C, B, "NBA", md("NBA", B, C, s2), 8000);
check("live NBA: tied with a minute left is close to a coin flip", tie.homeWin > 40 && tie.homeWin < 65 && tie.avgHome > 101 && tie.avgHome < 106, { h: tie.homeWin, avg: tie.avgHome });
const p2 = E.priceGame(tie.plan, "NBA", 1);
check("live NBA pricing: no home or away win without a final margin", Math.abs(p2.ml.pH + p2.ml.pA - 1) < 1e-6 && Math.abs(p2.meanT - (tie.avgHome + tie.avgAway)) < 1.5, { pH: p2.ml.pH, meanT: p2.meanT, sim: tie.avgHome + tie.avgAway });

// MLB inning text, half time, overtime
check("live state: MLB 'Top 7th' and 'Bot 9th'", Math.abs(E.liveState("MLB", { live: { detail: "Top 7th" }, home: { score: 3 }, away: { score: 1 } }).el - 12 / 18) < 1e-9 && E.liveState("MLB", { live: { detail: "Bot 9th" }, home: {}, away: {} }).el > 0.9);
check("live state: half time is half the game", E.liveState("Soccer", { live: { detail: "HT" }, home: {}, away: {} }).el === 0.5 && E.liveState("NBA", { live: { period: 2, clock: 0, detail: "Halftime" }, home: {}, away: {} }).el === 0.5);
check("pre-game is unchanged by the live code", pre.plan.live === null && Math.abs(E.priceGame(pre.plan, "Soccer", 1).ml.pH * 100 - pre.homeWin) < 2.5);
console.log(`engine: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
