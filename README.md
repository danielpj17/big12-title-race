# Big 12 Title Race

A live, unofficial fan tracker for the Big 12 football race: every team still in the running for the title game or the playoff, their remaining games with ESPN win chances, live scores, projected records, a title-game simulator that applies the official Big 12 tiebreakers, and College Football Playoff paths. A second page tracks the national top 15.

Live site: https://big12-live-odds.vercel.app (Top 15: `/ncaa.html`, or the **NCAA** tab at the top of the page)

## How it works

```
browser (index.html)  ──fetch──▶  /api/big12  (Vercel function)  ──▶  ESPN public JSON feeds
browser (ncaa.html)   ──fetch──▶  /api/ncaa   (Vercel function)  ──▶  ESPN public JSON feeds
```

- **`api/big12.js`** is a Vercel serverless function. On each request it pulls, in parallel:
  - all 16 Big 12 team schedules (records, every completed result, remaining games)
  - a game summary for every unplayed game (ESPN matchup predictor, live win probability, score, clock, venue, TV, betting line)
  - ESPN FPI (power rating, playoff %, conference-title %, strength-of-record rank, AP/CFP rank)

  It returns one compact JSON payload. Responses are cached at Vercel's edge for 20 seconds (`s-maxage=20, stale-while-revalidate=40`), so traffic spikes don't multiply calls to ESPN.

- **`index.html`** is the whole front end: plain HTML, CSS and JavaScript, no build step and no dependencies. It polls `/api/big12` every 30 seconds while games are live or about to kick off, every 2 minutes on game days, and every 10 minutes otherwise.

- **`api/ncaa.js`** and **`ncaa.html`** are the Top 15 page, built the same way. The function pulls ESPN's rankings (CFP and AP), the schedules of every team in either poll's top 15 (regular season and postseason), this week's FBS scoreboard, a game summary for every unplayed game involving a ranked team or playoff contender, and ESPN FPI, with the same 20-second edge cache.

## What's on the page

- **The race**: every team with at least a 1% chance to make the title game (from the simulation at current odds) or the playoff (ESPN's playoff %), with remaining games and win chances, most likely finish, and the probability of every possible final record.
- **Rest of the Big 12**: a collapsed list of every other team with its records, its title-game chance ("no realistic path" when it never reached the title game in 10,000 simulated finishes, which is not a proof of elimination), and any remaining games against teams in the race (spoilers).
- **The slate**: remaining games by date with kickoff time (viewer's time zone), venue, TV, line, and a win-chance bar in team colors (away team on the left). Live scores and live win probability during games.
- **Title game picture**
  - Three cards: most likely matchup (10,000 simulated finishes), the finish where every favorite wins, and the matchup from your own picks.
  - Title-game odds per team, with a switch between current odds and your picks.
  - What-if picker for all remaining conference games, with a step-by-step tiebreaker explanation and full 16-team standings for the result (top 8 shown, the rest behind a button). Picks are saved in the viewer's browser (`localStorage`).
  - Playoff odds by path: win the Big 12 (automatic bid), lose the title game, or miss it.
  - **What does a team need?** Always at current odds (your picks don't change it). Pick a team to see exactly what it needs to reach the title game: results that have to happen, which other results to root for (its chance after each one), and its most likely complete paths in, each of which can be loaded into the what-if picker to see the tiebreakers play out. Once 16 or fewer conference games are undecided, every possible finish (up to 65,536) is run through the tiebreakers, so these lists are exact rather than sampled. With more games left, the page falls back to the simulation's list of games that swing the team's chances most.

## The Top 15 page

- **CFP rankings / AP poll switch**: everything on the page follows the chosen poll (saved in the viewer's browser). The CFP option is disabled until the committee's rankings start in November.
- **The top 15**: in ranking order. Each row shows the rank and its change since last week, overall record and conference standing, ESPN's chance to make the playoff (with its conference-title and national-title chances), remaining games with ESPN win chances and the opponent's ranking, the most likely final record, and the probability of every possible final record.
- **Ranked 16–25**: a collapsed list with each team's record, rank change, this week's game (time and win chance, live score, or final) and playoff chance.
- **The slate**: every game involving a top-15 team, plus finals from the last three days, laid out like the Big 12 slate. Current rankings appear next to team names, and a game between two top-15 teams is tagged. Conference title games and, once they're set, bowl and playoff games appear automatically.
- **Projected bracket**: the 12-team field if the season ended with ESPN's favorites, in bracket order with first-round byes and pairings, how each team got in, and the first four out.
- **Rooting guide**: pick the ACC, Big 12, Big Ten, SEC, Notre Dame, the Group of 6, or any contender, and see this week's games that move its playoff picture most and which side to root for. For the Group of 6, which always gets exactly one spot, it shows the games that decide which team gets it.
- Playoff, conference-title and national-title chances are ESPN's own FPI projections. The bracket and rooting guide are this site's estimates built on them (see below).

**2026 playoff format** (12 teams): the ACC, Big 12, Big Ten and SEC champions get automatic bids wherever they're ranked; the highest-ranked team from the American, Conference USA, MAC, Mountain West, Pac-12 and Sun Belt gets one bid, champion or not; Notre Dame is in with a top-12 finish; the remaining spots (seven, counting Notre Dame's) are at-large. Straight seeding by the final ranking: the top four get byes, seeds 5–8 host 12–9.

**Projected bracket method**: each Power 4 conference's champion is the team with ESPN's highest conference-title chance; the Group of 6 bid goes to the G6 team with ESPN's highest playoff chance; Notre Dame is added if it's ranked in the top 12; the rest of the field is the teams with the highest at-large chance, `(playoff % − conference-title %) / (1 − conference-title %)`, i.e. ESPN's playoff chance for a team that doesn't win its conference. Seeds follow the current rankings (unranked teams last).

**Rooting guide model**: each contender's ESPN playoff chance `p` splits into `c` (wins its Power 4 conference, or gets the G6 bid) and `g` (at-large if it doesn't), with `p = c + (1 − c) × g`. For each of this week's games (ESPN's current scoreboard week; the next week once it's all final), both results are worked out:
- The two teams' `g` move by a log-odds loss cost of 2.2 (the same at-large loss cost as the Big 12 page), solved so the chance averaged over the game's odds stays where it is. In a conference game a Power 4 team's `c` moves by 2.0 log-odds (a conference title game is 1 or 0); a G6 team's bid chance moves by 2.5 log-odds in any game.
- Each conference title and the G6 bid go to exactly one team, so the rest of that pool is rescaled proportionally. The seven at-large spots are fixed too, so any at-large chance gained or lost is offset across all other contenders in proportion to `g(1 − g)` (bubble teams absorb most of it).
- A conference's number is 1 (its guaranteed spot) plus its members' at-large chances; a team's is its playoff chance. Both results are re-centered so their odds-weighted average equals today's number. Games are sorted by swing × √(q(1 − q)), so near-certain games sit lower.
- Contenders are teams with an ESPN playoff chance of at least 0.5%, plus every ranked team. Each game is judged on its own with every other game left to the odds.
- When ESPN posts no matchup predictor for a game, the win chance is estimated from FPI (2.5-point home edge, SD 13.5) and flagged on the page. Games against an opponent not set yet get no odds.

## Model notes and assumptions

**Tiebreakers** follow the Big 12's 2024+ 16-team policy ([PDF](https://big12sports.com/documents/2025/11/4//Big_12_Football_2024_Tiebreaker_Policy.pdf)). Where the policy is silent:

- A step settles a 3+ team tie only when exactly one team is best. Otherwise every tied team moves on to the next step.
- Step c (next-highest common opponent) only counts opponents every tied team played, and treats a tied group in the standings as one opponent.
- Step f (SportSource Analytics rating) isn't public, so f/g are treated as a coin flip and flagged.
- Total wins (step e) does not remove a second FCS win.
- In the exact "What does a team need?" lists, a finish that reaches step f counts at even odds for each team in the toss (every branch is followed, so a toss that only decides the #1 seed between two teams already in counts as in for both). Any non-conference games still left are set to the favorite there, since they only feed step e.

**Playoff odds** on the Big 12 page (2026 format above: the Big 12 champion is an automatic bid, everyone else needs an at-large spot):

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

then open http://localhost:3000 (Big 12) or http://localhost:3000/ncaa.html (Top 15).

## Data and disclaimer

Data comes from ESPN's public JSON feeds that power espn.com. They are undocumented and can change without notice. This is an unofficial, non-commercial fan project and is not affiliated with the Big 12 Conference, the College Football Playoff, the NCAA or ESPN.
