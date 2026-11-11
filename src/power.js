// POWER RATINGS (engine v4): every team's attack and defense from game-by-game results, adjusted for who they
// played, where, and how long ago, and (where closing lines are on file) for what the market said about each game.
//
// Model (the standard attack / defense model: Maher 1982, Dixon & Coles 1997, and the base of most public ratings):
//   expected home score = L x O_home x A_away x e^(+eta)        O = attack (scoring vs league average)
//   expected away score = L x O_away x A_home x e^(-eta)        A = defense (allowed vs league average; lower is better)
// Fitted by iterating the gamma-Poisson update for each team: (prior + what it scored) / (prior + what an average team
// would have scored against the same opponents in the same places). Games fade with age (xi per day, Dixon-Coles time
// decay). A game's closing line (spread + total = the market's expected score for each side) is a second, much less
// noisy observation of the same thing; `mkt` is how many results one closing line is worth.
// Pure functions, no I/O: the data job, the page and the tracker all run the same code.

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// games: [{ t, h, a, hs, as, n?, ms?, ma? }]   t = day number (days since any fixed date), h / a = team keys,
//   hs / as = final scores (null to use only the market line), n = neutral site, ms / ma = the market's expected scores
// opts: L (league average per team-game; fitted when not given), eta0 (home edge prior, log scale = hfa / 2L),
//   kEta (games of belief in eta0), k (games of belief in a team's prior), prior { key: { o, d, so, sd } },
//   xi (decay per day), now (day number "today"), mkt (results one closing line is worth), adjust (false = raw rates),
//   cap (largest single-game score ratio counted, tames blowouts)
export function fitPower(games, opts = {}) {
  const { eta0 = 0, kEta = 40, k = 10, prior = null, xi = 0, mkt = 0, adjust = true, iters = 80, cap = null } = opts;
  const now = opts.now != null ? opts.now : games.reduce((m, g) => Math.max(m, g.t), -Infinity);
  // observations: [home, away, home score, away score, weight, neutral]
  const obs = [];
  for (const g of games) {
    if (!g.h || !g.a || g.h === g.a) continue;
    const w = xi > 0 ? Math.exp(-xi * Math.max(0, now - g.t)) : 1;
    if (!(w > 1e-6)) continue;
    if (Number.isFinite(g.hs) && Number.isFinite(g.as) && g.hs >= 0 && g.as >= 0) obs.push([g.h, g.a, g.hs, g.as, w, !!g.n]);
    if (mkt > 0 && g.ms > 0 && g.ma > 0) obs.push([g.h, g.a, g.ms, g.ma, w * mkt, !!g.n]);
  }
  let sw = 0, ss = 0;
  for (const o of obs) { sw += 2 * o[4]; ss += o[4] * (o[2] + o[3]); }
  const L = opts.L > 0 ? opts.L : sw > 0 && ss > 0 ? ss / sw : 1;
  const T = new Map();
  const team = key => { let x = T.get(key); if (!x) { const p = prior && prior[key]; x = { o: p?.o > 0 ? p.o : 1, d: p?.d > 0 ? p.d : 1, o0: p?.o > 0 ? p.o : 1, d0: p?.d > 0 ? p.d : 1, so: p?.so > 0 ? p.so : k, sd: p?.sd > 0 ? p.sd : k, n: 0, g: 0, no: 0, eo: 0, nd: 0, ed: 0 }; T.set(key, x); } return x; };
  for (const o of obs) { team(o[0]).n += o[4]; team(o[1]).n += o[4]; }
  for (const g of games) if (Number.isFinite(g.hs) && T.has(g.h) && T.has(g.a)) { T.get(g.h).g++; T.get(g.a).g++; }
  let eta = eta0;
  const lim = cap > 0 ? cap : Infinity;
  // Alternate the two halves (attacks given defenses, then defenses given the new attacks): each half is an exact
  // update, so the fit climbs steadily instead of oscillating. The scale between "everyone scores more" and "everyone
  // allows more" is pinned by keeping the average attack at 1 (weighted by evidence).
  const pass = side => {
    for (const x of T.values()) { x.num = 0; x.den = 0; }
    const eh = Math.exp(eta), ea = Math.exp(-eta);
    for (const [hk, ak, hs, as, w, neu] of obs) {
      const H = T.get(hk), A = T.get(ak), fh = neu ? 1 : eh, fa = neu ? 1 : ea, sh = Math.min(hs / L, lim), sa = Math.min(as / L, lim);
      if (side === "o") { H.num += w * sh; H.den += w * (adjust ? A.d : 1) * fh; A.num += w * sa; A.den += w * (adjust ? H.d : 1) * fa; }
      else { A.num += w * sh; A.den += w * (adjust ? H.o : 1) * fh; H.num += w * sa; H.den += w * (adjust ? A.o : 1) * fa; }
    }
    let move = 0;
    for (const x of T.values()) {
      if (side === "o") { const o = clamp((x.so * x.o0 + x.num) / (x.so + x.den), 0.2, 5); move = Math.max(move, Math.abs(o - x.o)); x.o = o; x.no = x.num; x.eo = x.den; }
      else { const d = clamp((x.sd * x.d0 + x.num) / (x.sd + x.den), 0.2, 5); move = Math.max(move, Math.abs(d - x.d)); x.d = d; x.nd = x.num; x.ed = x.den; }
    }
    return move;
  };
  for (let it = 0; it < (adjust ? iters : 1); it++) {
    let move = pass("o");
    if (adjust) {                                            // average attack = 1; the level goes to the defenses' side of the product
      let lw = 0, ls = 0;
      for (const x of T.values()) { const w = x.n + x.so; lw += w; ls += w * Math.log(x.o); }
      const gm = lw > 0 ? Math.exp(ls / lw) : 1;
      if (gm > 0 && Math.abs(gm - 1) > 1e-9) for (const x of T.values()) x.o /= gm;
    }
    move = Math.max(move, pass("d"));
    if (adjust) {
      let hN = 0, hE = 0, aN = 0, aE = 0, nw = 0;
      for (const [hk, ak, hs, as, w, neu] of obs) { if (neu) continue; const H = T.get(hk), A = T.get(ak); hN += w * Math.min(hs / L, lim); hE += w * H.o * A.d; aN += w * Math.min(as / L, lim); aE += w * A.o * H.d; nw += w; }
      if (nw > 0 && hE > 0 && aE > 0 && hN > 0 && aN > 0) eta = (kEta * eta0 + nw * 0.5 * Math.log((hN / hE) / (aN / aE))) / (kEta + nw);
    }
    if (move < 1e-7) break;
  }
  const teams = {};
  for (const [key, x] of T) teams[key] = {
    o: x.o, d: x.d, n: x.n, g: x.g,
    // the evidence alone, before any prior: scored (allowed) over what an average team would have against the same schedule
    ro: x.eo > 0 ? x.no / x.eo : null, no: x.eo, rd: x.ed > 0 ? x.nd / x.ed : null, nd: x.ed,
  };
  return { L, eta, teams, n: obs.length };
}

// expected scores for one game from a fit (neutral: no home edge)
export function powerMu(fit, h, a, neutral = false, prior = null) {
  const H = fit.teams[h] || prior?.[h] || { o: 1, d: 1 }, A = fit.teams[a] || prior?.[a] || { o: 1, d: 1 }, e = neutral ? 0 : fit.eta;
  return { muH: fit.L * H.o * A.d * Math.exp(e), muA: fit.L * A.o * H.d * Math.exp(-e) };
}

// a closing line as the market's expected scores: home spread (negative = home favored) and the total
export const marketScores = (homeSpread, total) => (Number.isFinite(homeSpread) && total > 0 && Math.abs(homeSpread) < total ? { ms: (total - homeSpread) / 2, ma: (total + homeSpread) / 2 } : null);

// ---------- Dixon-Coles low-score correction (soccer) ----------
// Two independent Poisson scores under-count 0-0 and 1-1 and over-count 1-0 and 0-1. tau reweights those four cells;
// rho < 0 moves weight onto the draws. (Dixon & Coles 1997.)
export function dcTau(i, j, muH, muA, rho) {
  if (i === 0 && j === 0) return 1 - muH * muA * rho;
  if (i === 0 && j === 1) return 1 + muH * rho;
  if (i === 1 && j === 0) return 1 + muA * rho;
  if (i === 1 && j === 1) return 1 - rho;
  return 1;
}

// ---------- key numbers (football) ----------
// Football margins pile up on 3, 7, 10...: a smooth bell curve under-prices a push or a half-point there. `keys` is
// { margin: multiplier } applied to the absolute final margin's probability, then renormalised. pm[i] = P(margin = lo + i).
export function applyKeyNumbers(pm, lo, keys) {
  if (!keys) return pm;
  let z = 0;
  const out = pm.map((p, i) => { const v = p * (keys[Math.abs(lo + i)] ?? keys.rest ?? 1); z += v; return v; });
  return z > 0 ? out.map(v => v / z) : pm;
}

// ---------- scoring a forecast ----------
export const logLoss = (p, won) => -Math.log(clamp(won ? p : 1 - p, 1e-6, 1));
export const brier = (p, won) => (p - (won ? 1 : 0)) ** 2;
// pooling two probabilities on the log-odds scale (the standard way to combine forecasts): w on the first
export function logitPool(p1, p2, w) {
  const lg = p => Math.log(clamp(p, 1e-6, 1 - 1e-6) / (1 - clamp(p, 1e-6, 1 - 1e-6))), z = w * lg(p1) + (1 - w) * lg(p2);
  return 1 / (1 + Math.exp(-z));
}
