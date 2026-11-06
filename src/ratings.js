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

// men's or women's: the draw says it (a scoreboard can carry both tours)
export const tourOf = m => (/^womens/.test(m?.draw || "") ? "wta" : /^mens/.test(m?.draw || "") ? "atp" : m?.tour || "atp");
// ---------- tennis profiles from the match record: form, sets, games, tiebreaks, head to head ----------
// sets "6-7 3-6" are from A's side. Returns per-set game counts, or null for a match that wasn't played out.
export function parseSetScores(s) {
  const sets = String(s || "").trim().split(/\s+/).filter(Boolean).map(x => x.match(/^(\d+)-(\d+)/)).filter(Boolean).map(m => [Number(m[1]), Number(m[2])]);
  return sets.length ? sets : null;
}
export function tennisProfiles(matches, now = new Date()) {
  const cut = new Date(now.getTime() - 365 * 864e5).toISOString(), active = new Date(now.getTime() - 400 * 864e5).toISOString();
  const P = {}, H = {};
  const blank = (id, name, tour) => ({ id, name, tour, n: 0, w: 0, l: 0, sw: 0, sl: 0, gw: 0, gl: 0, tbw: 0, tbl: 0, ss: 0, games3: 0, n3: 0, form: [], last: "" });
  const done = matches.filter(m => m.completed && m.winner && !m.unrated && m.date).sort((x, y) => (x.date < y.date ? -1 : 1));
  for (const m of done) {
    const sets = parseSetScores(m.sets), aWon = m.winner === "a";
    for (const [me, op, won, flip] of [[m.a, m.b, aWon, false], [m.b, m.a, !aWon, true]]) {
      const p = (P[me.id] = P[me.id] || blank(me.id, me.name, m.tour));
      p.name = me.name; p.tour = tourOf(m) || p.tour; p.last = m.date.slice(0, 10);
      p.form.push(won ? "W" : "L"); if (p.form.length > 10) p.form.shift();
      if (m.date < cut) continue;
      p.n++; won ? p.w++ : p.l++;
      if (sets) {
        let s1 = 0, s2 = 0, g = 0;
        for (const [x, y] of sets) { const [a, b] = flip ? [y, x] : [x, y]; p.gw += a; p.gl += b; g += a + b; if (a > b) s1++; else if (b > a) s2++; if ((a === 7 && b === 6) || (a === 6 && b === 7)) a > b ? p.tbw++ : p.tbl++; }
        p.sw += s1; p.sl += s2; if (won && s2 === 0) p.ss++;
        if ((m.bo || 3) === 3) { p.games3 += g; p.n3++; }
      }
    }
    if (m.date >= active || true) {
      const [x, y] = m.a.id < m.b.id ? [m.a, m.b] : [m.b, m.a], k = `${x.id}-${y.id}`, h = (H[k] = H[k] || [0, 0, "", "", ""]);
      (m.winner === "a" ? m.a.id : m.b.id) === x.id ? h[0]++ : h[1]++;
      h[2] = m.date.slice(0, 10); h[3] = m.event || ""; h[4] = x.id === m.a.id ? m.sets || "" : (parseSetScores(m.sets) || []).map(([a, b]) => `${b}-${a}`).join(" ");
    }
  }
  const players = {};
  for (const [id, p] of Object.entries(P)) if (p.last >= active.slice(0, 10)) players[id] = [p.name, p.tour, p.n, p.w, p.l, p.sw, p.sl, p.gw, p.gl, p.tbw, p.tbl, p.ss, p.n3 ? Math.round(p.games3 / p.n3 * 10) / 10 : null, p.form.join(""), p.last];
  const h2h = {};
  for (const [k, h] of Object.entries(H)) { const [x, y] = k.split("-"); if (players[x] && players[y]) h2h[k] = h; }
  return { fields: ["name", "tour", "n", "w", "l", "setsW", "setsL", "gamesW", "gamesL", "tbW", "tbL", "straightSetWins", "avgGamesBo3", "last10", "last"], players, h2h };
}
// head-to-head files are split by the lower player id so a page loads only the one it needs
export const h2hShard = (idA, idB) => { const lo = String(idA) < String(idB) ? String(idA) : String(idB); let h = 0; for (const c of lo) h = (h * 31 + c.charCodeAt(0)) % 16; return h; };

// ---------- tennis Monte Carlo: 10,000 matches point by point, from any score ----------
// Returns the win chance, set scores, total games, game margin, tiebreak and deciding-set chances.
export function tennisSim({ sa = 0, sb = 0, ga = 0, gb = 0, gamesSoFar = 0, marginSoFar = 0 } = {}, pA, pB, bo = 3, slam = false, n = 10000, rnd = Math.random) {
  const need = bo === 5 ? 3 : 2, out = { n, aWins: 0, sets: {}, games: {}, margin: {}, tb: 0, decider: 0, aGames: 0, bGames: 0 };
  for (let i = 0; i < n; i++) {
    let A = sa, B = sb, x = ga, y = gb, aSrv = rnd() < 0.5, gA = 0, gB = 0, anyTb = false;
    while (A < need && B < need) {
      const last = A + B === bo - 1, tbTo = slam && last ? 10 : 7;
      if (x === 6 && y === 6) {                                           // tiebreak
        let p = 0, q = 0, k = 0; const first = aSrv;
        while (!((p >= tbTo || q >= tbTo) && Math.abs(p - q) >= 2)) { const srvA = k === 0 ? first : (Math.floor((k - 1) / 2) % 2 === 0) !== first; if (rnd() < (srvA ? pA : 1 - pB)) p++; else q++; k++; }
        anyTb = true; p > q ? (x++, gA++) : (y++, gB++); aSrv = !first;
      } else {
        let p = 0, q = 0;                                                  // a game
        while (!((p >= 4 || q >= 4) && Math.abs(p - q) >= 2)) { if (rnd() < (aSrv ? pA : 1 - pB)) p++; else q++; }
        const aWonGame = aSrv ? p > q : q < p; p > q ? (x++, gA++) : (y++, gB++); aSrv = !aSrv; void aWonGame;
      }
      if ((x >= 6 && x - y >= 2) || x === 7) { A++; x = 0; y = 0; } else if ((y >= 6 && y - x >= 2) || y === 7) { B++; x = 0; y = 0; }
    }
    const total = gamesSoFar + gA + gB, mg = marginSoFar + gA - gB, key = `${A}-${B}`;
    if (A > B) out.aWins++;
    out.sets[key] = (out.sets[key] || 0) + 1; out.games[total] = (out.games[total] || 0) + 1; out.margin[mg] = (out.margin[mg] || 0) + 1;
    if (anyTb) out.tb++; if (A + B === bo) out.decider++;
    out.aGames += gA; out.bGames += gB;
  }
  out.pA = out.aWins / n; out.tbPct = out.tb / n; out.deciderPct = out.decider / n;
  out.avgA = out.aGames / n; out.avgB = out.bGames / n;
  out.avgGames = Object.entries(out.games).reduce((s, [k, v]) => s + Number(k) * v, 0) / n;
  out.avgMargin = Object.entries(out.margin).reduce((s, [k, v]) => s + Number(k) * v, 0) / n;
  return out;
}
// how far a game total / game spread clears: P(total > line) and P(A's game margin + line > 0)
export const overProb = (S, line) => Object.entries(S.games).reduce((s, [k, v]) => s + (Number(k) > line ? v : 0), 0) / S.n;
export const coverProb = (S, line) => Object.entries(S.margin).reduce((s, [k, v]) => s + (Number(k) + line > 0 ? v : 0), 0) / S.n;
// Serve level for this pair: set so the model's expected total games (best of 3, from the start) matches how their
// matches have gone (each player's games per match vs the tour, shrunk by sample), with the Elo win chance held fixed.
export const TOUR_GAMES = { atp: 23.6, wta: 21.7 };
export function fitServe(pMatchBo3, tour = "atp", prof = {}, rnd = Math.random) {
  const avg = TOUR_GAMES[tour] || TOUR_GAMES.atp, dev = p => (p && p.avg3 > 0 && p.n3 > 0 ? (p.avg3 - avg) * (p.n3 / (p.n3 + 15)) : 0);
  const target = Math.max(avg - 4, Math.min(avg + 4, avg + dev(prof.a) + dev(prof.b)));
  const at = b => { const d = solveD(pMatchBo3, b); return { b, d, g: tennisSim({}, b + d, b - d, 3, false, 2500, rnd).avgGames }; };
  const tb = TOUR_SERVE[tour] || TOUR_SERVE.atp;
  let lo = tb - 0.06, hi = tb + 0.06, best = null;                                    // stays within 6 points of the tour's serve level
  for (let i = 0; i < 7; i++) { const m = (lo + hi) / 2, r = at(m); best = r; if (r.g < target) lo = m; else hi = m; }
  return { pA: best.b + best.d, pB: best.b - best.d, base: best.b, target };
}
function solveD(p, base) {
  let lo = -0.24, hi = 0.24;
  for (let i = 0; i < 40; i++) { const d = (lo + hi) / 2; if (tennisLive({}, base + d, base - d, 3).p < p) lo = d; else hi = d; }
  return (lo + hi) / 2;
}
