# Bobby's Boardroom

Monte Carlo sports simulator and slate ranker. Runs entirely on its own: live data comes from the public routes documented in [pseudo-r/Public-ESPN-API](https://github.com/pseudo-r/Public-ESPN-API), no AI calls.

**Sports:** MLB · NFL · CFB · NBA · WNBA · NCAA men's (CBB) · NCAA women's (NCAAW) · NHL · Soccer (EPL, La Liga, Bundesliga, Serie A, Ligue 1, MLS, Liga MX, Champions League, Europa League, World Cup + qualifiers, friendlies). Tennis (ATP/WTA) and UFC routes are wired into the data job; their tabs come once their history is built.

## How it works
- **The site** (`src/`, deployed to GitHub Pages by `.github/workflows/pages.yml`) reads the scoreboard, standings, odds and game-summary routes straight from the browser.
- **The data job** (`scripts/update-data.mjs`, every 15 min via `.github/workflows/data.yml`) commits to `data/`:
  - `history/` every team's scoring for every season the standings route has (first run backfills all seasons)
  - `live/` yesterday / today / tomorrow boards with scores and odds
  - `lines/` line snapshots per game (line movement, steam)
  - `officials/` each finished game's officials and final score (referee tendencies build up over time)
  - `splits/` public bet / money % when a source answers
- **Engine** (`src/boardroom.jsx`): pooled multi-season team ratings (Kalman across every season), starters, weather, rest, line movement, officials; 10,000 sims; slate pricing, grading, Kelly ranking; results tracker that learns from graded games.

## Run locally
```
npm install
npm run build      # -> dist/
npm run data       # refresh data/ (add --backfill for every past season)
npm test
```
History data credits: MLB 1901–2025 from the Lahman Baseball Database (CC BY-SA 3.0); NFL 1999–2025 from nflverse/nfldata (CC BY 4.0).
