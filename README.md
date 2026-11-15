# Big 12 Title Race

A live, unofficial fan tracker for the Big 12 football race: every team still in the running for the title game or the playoff, their remaining games with ESPN win chances, live scores, projected records, a title-game simulator that applies the official Big 12 tiebreakers, and College Football Playoff paths.

Live site: https://big12-live-odds.vercel.app

## How it works

```
browser (index.html)  ──fetch──▶  /api/big12  (Vercel function)  ──▶  ESPN public JSON feeds
```

- **`api/big12.js`** is a Vercel serverless function. On each request it pulls, in parallel:
  - all 16 Big 12 team schedules (records, every completed result, remaining games)
  - a game summary for every unplayed game (ESPN matchup predictor, live win probability, score, clock, venue, TV, betting line)
  - ESPN FPI (power rating, playoff %, conference-title %, strength-of-record rank, AP/CFP rank)

  It returns one compact JSON payload. Responses are cached at Vercel's edge for 20 seconds (`s-maxage=20, stale-while-revalidate=40`), so traffic spikes don't multiply calls to ESPN.

- **`index.html`** is the whole front end: plain HTML, CSS and JavaScript, no build step and no dependencies. It polls `/api/big12` every 30 seconds while games are live or about to kick off, every 2 minutes on game days, and every 10 minutes otherwise.

## What's on the page

- **The race**: every team with at least a 1% chance to make the title game (from the simulation at current odds) or the playoff (ESPN's playoff %), with remaining games and win chances, most likely finish, and the probability of every possible final record.
- **Rest of the Big 12**: a collapsed list of every other team with its records, its title-game chance ("no realistic path" when it never reached the title game in 10,000 simulated finishes, which is not a proof of elimination), and any remaining games against teams in the race (spoilers).
- **The slate**: remaining games by date with kickoff time (viewer's time zone), venue, TV, line, and a win-chance bar in team colors (away team on the left). Live scores and live win probability during games.
- **Title game picture**
  - Three cards: most likely matchup (10,000 simulated finishes), the finish where every favorite wins, and the matchup from your own picks.
  - Title-game odds per team, with a switch between current odds and your picks.
  - What-if picker for all remaining conference games, with a step-by-step tiebreaker explanation and full 16-team standings for the result (top 8 shown, the rest behind a button). Picks are saved in the viewer's browser (`localStorage`).
  - Playoff odds by path: win the Big 12 (automatic bid), lose the title game, or miss it.
  - Per-team view of which remaining games swing its title-game chances the most.

## Model notes and assumptions

**Tiebreakers** follow the Big 12's 2024+ 16-team policy ([PDF](https://big12sports.com/documents/2025/11/4//Big_12_Football_2024_Tiebreaker_Policy.pdf)). Where the policy is silent:

- A step settles a 3+ team tie only when exactly one team is best. Otherwise every tied team moves on to the next step.
- Step c (next-highest common opponent) only counts opponents every tied team played, and treats a tied group in the standings as one opponent.
- Step f (SportSource Analytics rating) isn't public, so f/g are treated as a coin flip and flagged.
- Total wins (step e) does not remove a second FCS win.

**Playoff odds** (12-team format: 5 highest-ranked conference champions + 7 at-large):

- Title game winner: normal distribution on the ESPN FPI rating gap, neutral field (SD 13.5 points).
- The Big 12 champion is treated as a guaranteed automatic bid.
- At-large chance = `logistic(strength − 2.2 × losses)`, where a title-game loss counts as an adjustable fraction of a loss (slider on the page, default 0.5). Each team's `strength` is calibrated so its overall at-large odds match ESPN's (playoff % minus conference-title %).
- Each team's at-large case is treated independently; the model can't capture the committee limiting how many Big 12 teams it takes.

## Deploying

The repo is connected to the `big12-live-odds` Vercel project. Every push to `main` deploys to production. No build settings are needed: Vercel serves `index.html` as a static file and runs `api/big12.js` as a Node function (Node 18+ for built-in `fetch`).

Local development:

```
npx vercel dev
```

then open http://localhost:3000.

## Data and disclaimer

Data comes from ESPN's public JSON feeds that power espn.com. They are undocumented and can change without notice. This is an unofficial, non-commercial fan project and is not affiliated with the Big 12 Conference or ESPN.
