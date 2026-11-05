// Tennis and MMA: ratings from every match / fight on record (Elo), shared by the app, the data job and the tests.
// Neither route publishes odds, so these tabs are model picks: win probability, set-score odds (tennis), confidence.
const n = v => { const x = Number(v); return Number.isFinite(x) ? x : null; };
const SINGLES = new Set(["mens-singles", "womens-singles"]);

// ---------- parse boards into matches ----------
export function parseTennis(j, tour) {
  const out = [];
  for (const e of j?.events || []) for (const g of e.groupings || []) {
    const slug = g.grouping?.slug || "";
    if (!SINGLES.has(slug)) continue;
    for (const c of g.competitions || []) {
      const cs = c.competitors || [];
      if (cs.length !== 2) continue;
      const st = c.status?.type || {}, note = (c.notes || []).map(x => x.text || "").join(" ");
      const [A, B] = [...cs].sort((x, y) => (x.order ?? 0) - (y.order ?? 0));
      const p = x => ({ id: String(x.id || x.athlete?.id || ""), name: x.athlete?.displayName || x.athlete?.fullName || "", country: x.athlete?.flag?.alt || "" });
      const sets = (A.linescores || []).map((s, i) => `${s.value}-${B.linescores?.[i]?.value ?? "?"}`).join(" ");
      out.push({ id: String(c.id), date: c.date || e.date, tour, event: e.name || "", round: c.round?.displayName || "", major: e.major === true, draw: slug,
        bo: e.major === true && slug === "mens-singles" ? 5 : 3, a: p(A), b: p(B), state: st.state || "pre", completed: st.completed === true,
        winner: st.completed ? (A.winner === true ? "a" : B.winner === true ? "b" : null) : null, sets,
        unrated: /\bw\/o\b|walkover|\bret\b|retired|default/i.test(note) });
    }
  }
  return out.filter(m => m.a.id && m.b.id);
}
export function parseUFC(j) {
  const out = [];
  for (const e of j?.events || []) for (const c of e.competitions || []) {
    const cs = c.competitors || [];
    if (cs.length !== 2) continue;
    const st = c.status?.type || {};
    const [A, B] = [...cs].sort((x, y) => (x.order ?? 0) - (y.order ?? 0));
    const rec = x => (x.records || []).find(r => r.type === "total" || r.name === "overall")?.summary || "";
    const p = x => ({ id: String(x.athlete?.id || x.id || ""), name: x.athlete?.displayName || "", rec: rec(x) });
    out.push({ id: String(c.id), date: c.date || e.date, event: e.name || "", weight: c.type?.abbreviation || "", rounds: n(c.format?.regulation?.periods) || 3,
      a: p(A), b: p(B), state: st.state || "pre", completed: st.completed === true,
      winner: st.completed ? (A.winner === true ? "a" : B.winner === true ? "b" : null) : null });
  }
  return out.filter(m => m.a.id && m.b.id);
}
export const recordWL = s => { const m = String(s || "").match(/^(\d+)-(\d+)/); return m ? { w: +m[1], l: +m[2] } : null; };

// ---------- Elo ----------
export const eloP = (ra, rb) => 1 / (1 + Math.pow(10, (rb - ra) / 400));
// tennis K (FiveThirtyEight's form): K = 250 / (matches + 5)^0.4, scaled by a fitted factor
export const SETTINGS = {
  Tennis: { grid: [0.35, 0.45, 0.55, 0.7, 0.85, 1, 1.15], k: (nm, s) => s * 250 / Math.pow(nm + 5, 0.4), init: () => 1500, minN: 5 },
  MMA:    { grid: [25, 35, 45, 60, 90, 120], k: (nm, s) => s / Math.pow(nm + 1, 0.25), init: (rec, w) => { const r = recordWL(rec); return 1500 + (r ? Math.max(-150, Math.min(150, w * (r.w - r.l))) : 0); }, minN: 2, initGrid: [0, 6, 12, 18, 25] },
};
// Run every rated match in date order. Returns ratings and the out-of-sample predictions made before each result.
export function runElo(matches, sport, scale, initW = 0) {
  const S = SETTINGS[sport], R = {}, preds = [];
  const ms = matches.filter(m => m.completed && m.winner && !m.unrated).sort((x, y) => x.date.localeCompare(y.date) || x.id.localeCompare(y.id));
  for (const m of ms) {
    for (const p of [m.a, m.b]) if (!R[p.id]) R[p.id] = { r: S.init(p.rec, initW), n: 0, name: p.name, last: m.date };
    const A = R[m.a.id], B = R[m.b.id], pa = eloP(A.r, B.r), y = m.winner === "a" ? 1 : 0;
    if (A.n >= S.minN && B.n >= S.minN) preds.push({ d: m.date, p: pa, y });
    const ka = S.k(A.n, scale), kb = S.k(B.n, scale);
    A.r += ka * (y - pa); B.r -= kb * (y - pa); A.n++; B.n++;
    A.last = B.last = m.date; A.name = m.a.name || A.name; B.name = m.b.name || B.name;
  }
  return { R, preds };
}
export function score(preds) {
  if (!preds.length) return null;
  let br = 0, ll = 0, hit = 0;
  for (const { p, y } of preds) { br += (p - y) ** 2; ll -= Math.log(Math.max(1e-9, y ? p : 1 - p)); hit += (p >= 0.5) === (y === 1) ? 1 : 0; }
  const B = [[0.5, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 1.01]].map(([lo, hi]) => {
    const ps = preds.map(q => q.p >= 0.5 ? q : { p: 1 - q.p, y: 1 - q.y }).filter(q => q.p >= lo && q.p < hi);
    return { lo, hi, n: ps.length, pred: ps.length ? ps.reduce((a, q) => a + q.p, 0) / ps.length : null, act: ps.length ? ps.reduce((a, q) => a + q.y, 0) / ps.length : null };
  });
  return { n: preds.length, brier: br / preds.length, logloss: ll / preds.length, acc: hit / preds.length, buckets: B };
}
// Fit the K scale (and MMA record prior) on the earlier 75% of predictions, report the later 25% the fit never saw.
export function fitElo(matches, sport) {
  const S = SETTINGS[sport], inits = S.initGrid || [0];
  const done = matches.filter(m => m.completed && m.winner && !m.unrated).map(m => m.date).sort();
  if (done.length < 200) { const { R } = runElo(matches, sport, S.grid[Math.floor(S.grid.length / 2)], inits[0]); return { R, scale: S.grid[Math.floor(S.grid.length / 2)], initW: inits[0], test: null, train: null, matches: done.length }; }
  const cut = done[Math.floor(done.length * 0.75)];
  let best = null;
  for (const s of S.grid) for (const w of inits) {
    const { preds } = runElo(matches, sport, s, w);
    const tr = score(preds.filter(p => p.d < cut));
    if (tr && (!best || tr.logloss < best.tr.logloss)) best = { s, w, tr, te: score(preds.filter(p => p.d >= cut)) };
  }
  const { R } = runElo(matches, sport, best.s, best.w);
  return { R, scale: best.s, initW: best.w, train: best.tr, test: best.te, matches: done.length, cut };
}

// ---------- tennis: match probability -> set probability -> set scores ----------
const p3 = s => s * s * (3 - 2 * s);
const p5 = s => s * s * s * (10 - 15 * s + 6 * s * s);
export function setProb(pMatchBo3) {                   // invert P(best of 3) for the per-set win chance
  let lo = 0, hi = 1;
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (p3(m) < pMatchBo3) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
export function tennisOutlook(pBo3, bo) {
  const s = setProb(pBo3), q = 1 - s;
  if (bo === 5) return { p: p5(s), s, scores: [["3-0", s ** 3], ["3-1", 3 * s ** 3 * q], ["3-2", 6 * s ** 3 * q * q], ["2-3", 6 * q ** 3 * s * s], ["1-3", 3 * q ** 3 * s], ["0-3", q ** 3]] };
  return { p: pBo3, s, scores: [["2-0", s * s], ["2-1", 2 * s * s * q], ["1-2", 2 * q * q * s], ["0-2", q * q]] };
}
// confidence shown to the user: how many rated matches stand behind each side
export function rateFor(R, p, sport) {
  const S = SETTINGS[sport], x = R?.[p.id];
  return x ? { r: x.r, n: x.n, last: x.last, known: x.n >= S.minN } : { r: S.init(p.rec, 0), n: 0, last: null, known: false };
}

// ---------- tennis, point by point: a live match from its current score ----------
// Each player wins a share of the points they serve. Before the match those two shares are set so the model agrees
// with the Elo ratings (a best-of-3 match on the tour's average serve level); after that it plays out exactly what's
// left: the current set's games, tiebreaks at 6-6 (a 10-point one in a Slam's final set), then any sets still needed.
export const TOUR_SERVE = { atp: 0.64, wta: 0.56 };
// P(server holds) when they win each service point with probability p
export function holdProb(p) {
  const q = 1 - p, deuce = (p * p) / (p * p + q * q);
  return p ** 4 * (1 + 4 * q + 10 * q * q) + 20 * p ** 3 * q ** 3 * deuce;
}
// P(A wins a tiebreak to `to` (win by 2)); A serves the first point, then serve alternates every two points
export function tiebreakProb(pA, pB, to = 7, aServesFirst = true) {
  const memo = new Map();
  const srvA = n => (n === 0 ? aServesFirst : (Math.floor((n - 1) / 2) % 2 === 0) !== aServesFirst);   // point n's server is A?
  const f = (a, b) => {
    if (a >= to && a - b >= 2) return 1;
    if (b >= to && b - a >= 2) return 0;
    if (a >= to - 1 && b >= to - 1 && a === b && a > to + 10) { const pa = (pA + (1 - pB)) / 2; return (pa * pa) / (pa * pa + (1 - pa) * (1 - pa)); }   // long deuce: closed form
    const k = `${a},${b}`; if (memo.has(k)) return memo.get(k);
    const w = srvA(a + b) ? pA : 1 - pB, v = w * f(a + 1, b) + (1 - w) * f(a, b + 1);
    memo.set(k, v); return v;
  };
  return f(0, 0);
}
// P(A wins the set from games (ga, gb) with `aServes` serving the next game)
export function setFrom(ga, gb, aServes, pA, pB, tb = 7) {
  const hA = holdProb(pA), hB = holdProb(pB), memo = new Map();
  const f = (a, b, srv) => {
    if (a >= 6 && a - b >= 2) return 1;
    if (b >= 6 && b - a >= 2) return 0;
    if (a === 7 || b === 7) return a > b ? 1 : 0;
    if (a === 6 && b === 6) return tiebreakProb(pA, pB, tb, srv);
    const k = `${a},${b},${srv}`; if (memo.has(k)) return memo.get(k);
    const w = srv ? hA : 1 - hB, v = w * f(a + 1, b, !srv) + (1 - w) * f(a, b + 1, !srv);
    memo.set(k, v); return v;
  };
  return f(ga, gb, aServes);
}
const avgSrv = (fn) => (fn(true) + fn(false)) / 2;      // who serves isn't on the scoreboard: both ways, averaged
// From sets (sa, sb) and the current set's games (ga, gb): P(A wins), and the chance of each final set score
export function tennisLive({ sa = 0, sb = 0, ga = 0, gb = 0 }, pA, pB, bo = 3, slam = false) {
  const need = bo === 5 ? 3 : 2;
  const cur = avgSrv(s => setFrom(ga, gb, s, pA, pB, slam && sa + sb === bo - 1 ? 10 : 7));
  const fresh = (lastSet) => avgSrv(s => setFrom(0, 0, s, pA, pB, slam && lastSet ? 10 : 7));
  const dist = new Map();
  const walk = (a, b, pr, first) => {
    if (a === need || b === need) { const k = `${a}-${b}`; dist.set(k, (dist.get(k) || 0) + pr); return; }
    const s = first ? cur : fresh(a + b === bo - 1);
    walk(a + 1, b, pr * s, false); walk(a, b + 1, pr * (1 - s), false);
  };
  walk(sa, sb, 1, true);
  const win = [...dist].filter(([k]) => +k.split("-")[0] === need).reduce((x, [, v]) => x + v, 0);
  return { p: win, set: cur, scores: [...dist].sort((x, y) => y[1] - x[1]) };
}
// serve shares that make the model match the ratings before the first point (best of 3)
export function servePoints(pMatchBo3, tour = "atp") {
  const base = TOUR_SERVE[tour] || TOUR_SERVE.atp;
  let lo = -0.24, hi = 0.24;
  for (let i = 0; i < 50; i++) { const d = (lo + hi) / 2; if (tennisLive({}, base + d, base - d, 3).p < pMatchBo3) lo = d; else hi = d; }
  const d = (lo + hi) / 2;
  return { pA: base + d, pB: base - d, base };
}
// The board's set scores ("6 3 4" / "4 6 2") -> sets won and the set in progress
export function readSets(away, home, live = true) {
  const a = String(away || "").split(" ").filter(Boolean).map(Number), b = String(home || "").split(" ").filter(Boolean).map(Number);
  const done = (x, y) => (x >= 6 && x - y >= 2) || (x === 7 && (y === 6 || y === 5));
  let sa = 0, sb = 0;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0, y = b[i] ?? 0;
    if (done(x, y)) { sa++; continue; }
    if (done(y, x)) { sb++; continue; }
    if (i === n - 1 && live) return { sa, sb, ga: x, gb: y, sets: n };
  }
  return { sa, sb, ga: 0, gb: 0, sets: n };
}
