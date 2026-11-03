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
  Tennis: { grid: [0.7, 0.85, 1, 1.15, 1.3], k: (nm, s) => s * 250 / Math.pow(nm + 5, 0.4), init: () => 1500, minN: 5 },
  MMA:    { grid: [60, 90, 120, 160], k: (nm, s) => s / Math.pow(nm + 1, 0.25), init: (rec, w) => { const r = recordWL(rec); return 1500 + (r ? Math.max(-150, Math.min(150, w * (r.w - r.l))) : 0); }, minN: 2, initGrid: [0, 6, 12] },
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
