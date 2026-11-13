// The grouped sport picker (src/sportmenu.js) and the sports day (6 AM ET rollover, src/routes.js).
import { MENU, menuFor, placeOf, itemLabel, isWomen, isCollege } from "../src/sportmenu.js";
import { ROUTES, sportsDay, sportsDayISO, isYouthLeague } from "../src/routes.js";
import { CATALOG } from "../src/leagues.js";
let pass = 0, fail = 0;
const check = (n, c, d) => { if (c) pass++; else { fail++; console.log("  FAIL:", n, d === undefined ? "" : JSON.stringify(d).slice(0, 400)); } };
const all = k => { const m = menuFor(k); return [...(m.all ? [m.all] : []), ...["men", "women"].flatMap(g => ["top", "more", "college"].flatMap(p => m[g][p]))]; };
const labels = l => l.map(x => x.label);

// every league ESPN lists is somewhere in the picker, once, and every item opens a real tab (+ league on it)
const items = MENU.flatMap(m => all(m.key)), seen = new Map();
for (const x of items) seen.set(x.id, (seen.get(x.id) || 0) + 1);
const leaguesIn = new Set(items.filter(x => x.league).map(x => `${x.sport}|${x.league}`)), singles = new Set(items.filter(x => !x.league).map(x => x.sport));
const missing = Object.entries(ROUTES).flatMap(([k, r]) => r.leagues.length === 1 ? (singles.has(k) ? [] : [k]) : r.leagues.filter(l => !leaguesIn.has(`${k}|${l}`)).map(l => `${k}|${l}`));
check("every league on a tab is in the picker", missing.length === 0, missing.slice(0, 10));
check("no league listed twice", [...seen.values()].every(n => n === 1), [...seen].filter(([, n]) => n > 1));
check("every item opens a real tab, and its league is on that tab", items.every(x => ROUTES[x.sport] && (!x.league || ROUTES[x.sport].leagues.includes(x.league))));

// men first, women second; famous leagues on top; college and youth at the bottom
const soc = menuFor("soccer");
check("soccer: the big leagues first, in order", labels(soc.men.top).slice(0, 8).join() === "Champions League,Premier League,LALIGA,Bundesliga,Serie A,Ligue 1,MLS,Liga MX", labels(soc.men.top));
check("soccer: top list is short; the rest behind MORE", soc.men.top.length === 12 && soc.men.more.length > 100);
check("soccer: women's leagues only under women (NWSL first)", soc.women.top[0].label === "NWSL" && !soc.men.top.concat(soc.men.more).some(x => /women|nwsl|femenil|liga f/i.test(`${x.label} ${x.name}`)) && soc.women.top.concat(soc.women.more).every(x => isWomen(x.league, x.name)), labels(soc.men.more).filter(x => /women/i.test(x)));
check("soccer: college in its own section (men's and women's), never with the pros", soc.men.college.map(x => x.league).join() === "usa.ncaa.m.1" && soc.women.college.map(x => x.league).join() === "usa.ncaa.w.1" && !soc.men.top.concat(soc.men.more).some(x => isCollege(x.league, x.name)));
check("no youth anywhere (U17-U23, Little League, U23 Olympic qualifying)", !items.some(x => isYouthLeague(x.league || "", x.name || "")) && !items.some(x => /under-\d\d|\bu\d\d\b|little league|pre-olympic/i.test(`${x.label} ${x.name}`)), items.filter(x => /under-\d\d|little league/i.test(`${x.label} ${x.name}`)).map(x => x.label));
check("soccer: 'All soccer' opens the whole tab", soc.all.sport === "Soccer" && soc.all.league === null);
const bb = menuFor("basketball");
check("basketball: NBA first (its own tab), WNBA under women, college at the bottom of each", bb.men.top[0].sport === "NBA" && bb.men.top[0].league === null && bb.women.top[0].sport === "WNBA" && bb.men.college[0].sport === "CBB" && bb.women.college[0].sport === "CBBW");
check("basketball: G League is a league on Hoops+", (x => x.sport === "HOOPS" && x.league === "nba-development")(bb.men.top.find(x => x.label === "G League")));
check("football: NFL then the spring / Canadian leagues; college football at the bottom", labels(menuFor("football").men.top).join() === "NFL,UFL,CFL,XFL" && menuFor("football").men.college[0].sport === "CFB");
check("tennis: ATP men, WTA women (one tab, one tour each)", menuFor("tennis").men.top[0].league === "atp" && menuFor("tennis").women.top[0].league === "wta");
check("baseball: college baseball (men), college softball (women); no Little League", menuFor("baseball").women.college.map(x => x.league).join() === "college-softball" && menuFor("baseball").men.college.map(x => x.league).join() === "college-baseball");
check("More: each sport under its own heading, college ones too", (m => m.bySport && m.men.top.every(x => x.sub) && m.women.college.map(x => x.sub).sort().join() === "Field hockey,Lacrosse,Volleyball,Water polo")(menuFor("more")));
check("racing: no men / women split", menuFor("racing").mixed && menuFor("racing").women.top.length === 0 && menuFor("racing").men.top[0].label === "Formula 1");
check("golf: LPGA under women", menuFor("golf").women.top[0].label === "LPGA");
check("MMA: UFC first; Invicta (women's) under women", menuFor("fighting").men.top[0].label === "UFC" && menuFor("fighting").women.top[0].label === "Invicta FC");
check("placeOf: where a pick sits (to open the picker there)", JSON.stringify(placeOf("Soccer", "eng.w.1")) === '{"key":"soccer","women":true}' && placeOf("NBA", null).key === "basketball" && placeOf("CBBW", null).women === true && placeOf("Soccer", null).key === "soccer" && placeOf("Golf", "lpga").women === true);
check("itemLabel: short names", itemLabel("Soccer", "eng.1") === "Premier League" && itemLabel("NBA", null) === "NBA" && itemLabel("HOOPS", "nba-development") === "G League");
check("the catalog still has the leagues this relies on", CATALOG.soccer.some(r => r[0] === "eng.1") && CATALOG.basketball.some(r => r[0] === "nba"));

// the sports day rolls over at 6 AM ET: an 11 PM tip is still "today" at 1 AM
const at = iso => Date.parse(iso);
check("11 PM ET: that day", sportsDay(0, at("2026-11-11T04:00:00Z")) === "20261110");
check("1 AM ET: still the night before (the 11 PM game is on the board until morning)", sportsDay(0, at("2026-11-11T06:00:00Z")) === "20261110" && sportsDayISO(0, at("2026-11-11T06:00:00Z")) === "2026-11-10");
check("6 AM ET: the new day", sportsDay(0, at("2026-11-11T11:00:00Z")) === "20261111" && sportsDay(1, at("2026-11-11T11:00:00Z")) === "20261112");
check("summer (EDT): 1 AM is still the night before", sportsDay(0, at("2026-07-11T05:00:00Z")) === "20260710" && sportsDay(0, at("2026-07-11T10:30:00Z")) === "20260711");
console.log(`sport menu: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
