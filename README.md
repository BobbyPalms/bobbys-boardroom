# Bobby's Boardroom

Monte Carlo sports simulator, slate ranker and results tracker. Runs entirely on its own: every number comes from the public routes documented in [pseudo-r/Public-ESPN-API](https://github.com/pseudo-r/Public-ESPN-API). No AI calls, no API keys.

**Tabs:** MLB · NFL · CFB · NBA · WNBA · NCAA men's (CBB) · NCAA women's (NCAAW) · NHL · Soccer (EPL, La Liga, Bundesliga, Serie A, Ligue 1, MLS, Liga MX, Champions League, Europa League, World Cup + UEFA qualifiers, friendlies) · Tennis (ATP + WTA singles) · MMA (UFC)

## What feeds the algo
| Input | Route |
|---|---|
| Games, records, odds (open + current), weather, neutral site, final scores | `site/v2/.../scoreboard` |
| Every team's scoring for every season (history) | `apis/v2/.../standings?season=` |
| Officials, injuries, season series, ATS records | `site/v2/.../summary?event=` |
| NFL / CFB QB ratings | core `.../qbr/0` (schedule-adjusted QBR) |
| NHL probable goalies' save %, starts, last season | core `.../athletes/{id}/statistics` |
| Tennis matches, UFC fights | `tennis/{atp,wta}/scoreboard`, `mma/ufc/scoreboard` |

Team sports: pooled multi-season ratings (Kalman across every season, older seasons fade), starters, QB, weather, rest, line movement, officials' scoring tendencies → 10,000 sims → priced against the posted odds, graded A/B/C, ranked by Kelly score. Tennis / MMA: Elo from every match / fight on record, fitted and tested on later results the fit never saw (no odds on these routes, so they're model picks). Public bet / money % aren't on these routes; line movement stands in for sharp money.

## How it runs
One workflow, `.github/workflows/site.yml`, every 15 minutes:
1. restores the previous run's data from the live site,
2. refreshes `data/` from the routes (`scripts/update-data.mjs`; the first run backfills every season / match),
3. builds the app and deploys it with the data to GitHub Pages,
4. once a day commits the long-term records (history, matches, ratings, officials) to the repo.

The site reads the live routes straight from the browser and the data files from itself. The results tracker is saved in your browser (export it from the Results screen to keep a copy).

**One-time setup:** Settings → Pages → Source: **GitHub Actions**.

## Run locally
```
npm install
npm run build      # -> dist/
npm run data       # refresh data/ (--backfill re-pulls every season)
npm test           # parsers, ratings, data job (no network)
```

Data credits: MLB 1901–2025 baked history from the Lahman Baseball Database (CC BY-SA 3.0); NFL 1999–2025 from nflverse/nfldata (CC BY 4.0).
