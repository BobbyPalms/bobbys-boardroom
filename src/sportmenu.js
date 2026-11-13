// The sport picker, grouped: a handful of sports, each split men / women, best-known leagues first, the rest behind
// "more", college and youth at the bottom. Every item opens one tab (src/routes.js ROUTES), narrowed to one league when
// the tab carries several (Soccer, Hoops+, MMA...). Built from the league catalog, so a league ESPN adds lands somewhere.
import { CATALOG } from "./leagues.js";
import { ROUTES } from "./routes.js";

// which tab carries an ESPN league
const TAB = {};
for (const [k, r] of Object.entries(ROUTES)) for (const slug of r.leagues) TAB[`${r.sport}|${slug}`] ??= k;
export const tabOf = (espn, slug) => TAB[`${espn}|${slug}`] || null;

// women's leagues: by slug (ESPN marks most with .w.) or by name
const WOMEN_SLUG = /(^|[.-])w([.-]|$)|wworld|wwc|wchampions|weuro|womens|nwsl|shebelieves|pinatar|arnold\.clark|copa_de_la_reina|femenina|wnba|^wta$|^lpga$|^wtgl$|softball|^lls$|^ifc$|^283$|^289237$/;
const WOMEN_NAME = /women|femenil|femenina|vrouwen|ladies|softball|liga f\b/i;
export const isWomen = (slug, name) => WOMEN_SLUG.test(slug) || WOMEN_NAME.test(name || "");
// college: its own section at the bottom of each sport (youth leagues aren't on any tab: routes.js isYouthLeague)
const COLLEGE = /college|ncaa/i;
export const isCollege = (slug, name) => COLLEGE.test(slug) || COLLEGE.test(name || "");
// the sports under "More", each with its own heading
const SUB = { "australian-football": "Aussie rules", lacrosse: "Lacrosse", volleyball: "Volleyball", "water-polo": "Water polo", "field-hockey": "Field hockey" };

// short names for the best-known leagues (the catalog's are long)
const SHORT = {
  nfl: "NFL", "college-football": "College Football", ufl: "UFL", cfl: "CFL", xfl: "XFL",
  nba: "NBA", wnba: "WNBA", "nba-development": "G League", "mens-college-basketball": "College (Men's)", "womens-college-basketball": "College (Women's)",
  fiba: "FIBA World Cup", nbl: "NBL (Australia)", "mens-olympics-basketball": "Olympics", "womens-olympics-basketball": "Olympics",
  mlb: "MLB", "world-baseball-classic": "World Baseball Classic", "college-baseball": "College Baseball", "college-softball": "College Softball", llb: "Little League", lls: "Little League Softball",
  nhl: "NHL", "hockey-world-cup": "World Cup of Hockey", "mens-college-hockey": "College (Men's)", "womens-college-hockey": "College (Women's)", "olympics-mens-ice-hockey": "Olympics", "olympics-womens-ice-hockey": "Olympics",
  "eng.1": "Premier League", "esp.1": "LALIGA", "ger.1": "Bundesliga", "ita.1": "Serie A", "fra.1": "Ligue 1", "usa.1": "MLS", "mex.1": "Liga MX",
  "uefa.champions": "Champions League", "uefa.europa": "Europa League", "uefa.europa.conf": "Conference League", "fifa.world": "World Cup", "uefa.euro": "Euros",
  "conmebol.america": "Copa América", "fifa.cwc": "Club World Cup", "eng.fa": "FA Cup", "eng.league_cup": "Carabao Cup", "usa.nwsl": "NWSL", "eng.w.1": "WSL",
  "uefa.wchampions": "Women's Champions League", "fifa.wwc": "Women's World Cup", "esp.w.1": "Liga F", "fra.w.1": "Première Ligue", "mex.w.1": "Liga MX Femenil",
  "usa.w.usl.1": "USL Super League", "uefa.weuro": "Women's Euros", "fifa.w.olympics": "Olympics", "fifa.olympics": "Olympics", "fifa.friendly": "Int'l Friendlies",
  "usa.ncaa.m.1": "College (Men's)", "usa.ncaa.w.1": "College (Women's)",
  atp: "ATP", wta: "WTA",
  ufc: "UFC", pfl: "PFL", bellator: "Bellator", ofc: "ONE Championship", rizin: "Rizin", "cage-warriors": "Cage Warriors", ksw: "KSW", lfa: "LFA", ifc: "Invicta FC",
  pga: "PGA Tour", liv: "LIV Golf", eur: "DP World Tour", tgl: "TGL", ntw: "Korn Ferry Tour", "champions-tour": "PGA Tour Champions", lpga: "LPGA", wtgl: "WTGL",
  "mens-olympics-golf": "Olympics", "womens-olympics-golf": "Olympics",
  f1: "Formula 1", "nascar-premier": "NASCAR Cup", irl: "IndyCar", "nascar-secondary": "NASCAR O'Reilly", "nascar-truck": "NASCAR Trucks",
  180659: "Six Nations", 164205: "Rugby World Cup", 244293: "Rugby Championship", 271937: "Champions Cup", 267979: "Premiership", 270557: "URC", 270559: "Top 14",
  242041: "Super Rugby Pacific", 289262: "Major League Rugby", 289237: "Women's Rugby World Cup", 283: "Olympic Sevens", 282: "Olympic Sevens", 3: "Rugby League",
  afl: "AFL", pll: "Premier Lacrosse League", nll: "National Lacrosse League",
};

// each sport: its ESPN sports, and the best-known leagues in order (men's and women's). Anything not listed is "more".
export const MENU = [
  { key: "football", label: "Football", icon: "🏈", espn: ["football"], top: ["nfl", "ufl", "cfl", "xfl"] },
  { key: "basketball", label: "Basketball", icon: "🏀", espn: ["basketball"], top: ["nba", "wnba", "nba-development", "fiba", "mens-olympics-basketball", "womens-olympics-basketball", "nbl"] },
  { key: "baseball", label: "Baseball", icon: "⚾", espn: ["baseball"], top: ["mlb", "world-baseball-classic", "caribbean-series"] },
  { key: "hockey", label: "Hockey", icon: "🏒", espn: ["hockey"], top: ["nhl", "hockey-world-cup", "olympics-mens-ice-hockey", "olympics-womens-ice-hockey"] },
  { key: "soccer", label: "Soccer", icon: "⚽", espn: ["soccer"], all: "Soccer", topN: 12,
    top: ["uefa.champions", "eng.1", "esp.1", "ger.1", "ita.1", "fra.1", "usa.1", "mex.1", "uefa.europa", "fifa.world", "uefa.euro", "conmebol.america",
      "uefa.europa.conf", "fifa.cwc", "eng.fa", "eng.league_cup", "esp.copa_del_rey", "ger.dfb_pokal", "ita.coppa_italia", "eng.2", "ned.1", "por.1", "ksa.1",
      "conmebol.libertadores", "concacaf.champions", "bra.1", "arg.1", "sco.1", "tur.1", "fifa.friendly", "concacaf.gold", "concacaf.nations.league", "uefa.nations",
      "usa.nwsl", "eng.w.1", "uefa.wchampions", "fifa.wwc", "esp.w.1", "fra.w.1", "mex.w.1", "usa.w.usl.1", "uefa.weuro", "fifa.w.olympics", "usa.nwsl.cup", "fifa.shebelieves"] },
  { key: "tennis", label: "Tennis", icon: "🎾", espn: ["tennis"], top: ["atp", "wta"] },
  { key: "fighting", label: "MMA", icon: "🥊", espn: ["mma"], all: "MMA", top: ["ufc", "pfl", "bellator", "ofc", "rizin", "cage-warriors", "ksw", "lfa", "ifc"] },
  { key: "golf", label: "Golf", icon: "⛳", espn: ["golf"], all: "Golf", top: ["pga", "liv", "eur", "tgl", "lpga", "wtgl", "ntw", "champions-tour"] },
  { key: "racing", label: "Racing", icon: "🏁", espn: ["racing"], all: "Racing", mixed: true, top: ["f1", "nascar-premier", "irl", "nascar-secondary", "nascar-truck"] },
  { key: "rugby", label: "Rugby", icon: "🏉", espn: ["rugby", "rugby-league"], all: "RUGBY", allLabel: "All rugby union",
    top: ["180659", "164205", "244293", "271937", "267979", "270557", "270559", "242041", "289262", "3", "289237", "283"] },
  { key: "more", label: "More", icon: "🥍", espn: ["australian-football", "lacrosse", "volleyball", "water-polo", "field-hockey"], bySport: true, top: ["afl", "pll", "nll"] },
];

// one sport's picker: { men: { top, more, college }, women: {...}, all } with items { id, label, sport, league, sub }
const _menu = {};
export const menuFor = key => (_menu[key] ??= buildMenu(key));
function buildMenu(key) {
  const m = MENU.find(x => x.key === key);
  if (!m) return null;
  const rank = new Map(m.top.map((s, i) => [String(s), i]));
  const items = [];
  for (const espn of m.espn) for (const [slug0, , name] of CATALOG[espn] || []) {
    const slug = String(slug0), sport = tabOf(espn, slug);
    if (!sport) continue;
    const single = ROUTES[sport].leagues.length === 1;
    items.push({ id: `${sport}|${single ? "" : slug}`, label: SHORT[slug] || name, name, sport, league: single ? null : slug,
      women: !m.mixed && isWomen(slug, name), college: isCollege(slug, name), sub: m.bySport ? SUB[espn] : null, rank: rank.has(slug) ? rank.get(slug) : 1e9 });
  }
  const byFame = (a, b) => a.rank - b.rank || a.label.localeCompare(b.label);
  const part = list => {
    const pro = list.filter(x => !x.college).sort(byFame), n = m.topN || 99;
    const top = pro.filter(x => x.rank < 1e9).slice(0, n);
    return { top, more: pro.filter(x => !top.includes(x)), college: list.filter(x => x.college).sort(byFame) };
  };
  return { key: m.key, label: m.label, mixed: !!m.mixed, bySport: !!m.bySport, all: m.all ? { id: `${m.all}|`, label: m.allLabel || `All ${m.label.toLowerCase()}`, sport: m.all, league: null } : null,
    men: part(items.filter(x => !x.women)), women: part(items.filter(x => x.women)) };
}
// the sport (and gender) a tab + league sits under, for opening the picker where the person already is
export function placeOf(sport, league) {
  for (const m of MENU) {
    const mm = menuFor(m.key);
    if (mm.all && mm.all.sport === sport && !league) return { key: m.key, women: false };
    for (const g of ["men", "women"]) for (const part of ["top", "more", "college"]) if (mm[g][part].some(x => x.sport === sport && (x.league || null) === (league || null))) return { key: m.key, women: g === "women" };
  }
  // a tab with several leagues opened whole (Hoops+...): the sport its leagues are in
  const espn = ROUTES[sport]?.sport, m = MENU.find(x => x.espn.includes(espn));
  return m ? { key: m.key, women: false } : null;
}
export const itemLabel = (sport, league) => {
  for (const m of MENU) {
    const mm = menuFor(m.key);
    for (const g of ["men", "women"]) for (const part of ["top", "more", "college"]) { const x = mm[g][part].find(y => y.sport === sport && (y.league || null) === (league || null)); if (x) return x.label; }
  }
  return null;
};
