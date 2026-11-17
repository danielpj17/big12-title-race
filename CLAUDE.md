# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Unofficial live tracker for the Big 12 football title race (live site: https://big12-live-odds.vercel.app). Two files do everything: `api/big12.js` (Vercel Node function) and `index.html` (the whole front end: inline CSS + one IIFE script). No package.json, no build step, no dependencies, no tests, no linter. README.md documents the model assumptions and tiebreaker interpretations in detail; keep it in sync when changing model behavior.

## Commands

- Local dev: `npx vercel dev`, then open http://localhost:3000 (the front end fetches `/api/big12`, so opening `index.html` directly from disk won't load data).
- Hit the API alone: `curl http://localhost:3000/api/big12` (optional `?season=YYYY`; default season is the current year, or the previous year in Jan–Feb).
- Deploy: every push to `main` auto-deploys to production on the `big12-live-odds` Vercel project. Commit/push only when asked.

Files must stay at the repo root (`index.html`, `api/big12.js`). Past history shows uploads landing in nested `big12-title-race/` folders, which breaks the Vercel deploy.

## Architecture

### API (`api/big12.js`)
Fetches ESPN's undocumented public JSON feeds in parallel: the 16 team schedules (team ids are hard-coded in `IDS`), the FPI power index, then one `summary?event=` call per unplayed game (predictor %, live win probability, score/clock, TV, line, venue). Returns `{ updated, season, source, teams[], games[], results[], ratings }`:
- `teams`: overall and conference W/L (`w,l,cw,cl`) computed from completed schedule events.
- `games`: every unplayed game for all 16 teams (the tiebreakers need the whole league), plus every team's finals from the last 3 days (finals need no summary fetch, so they cost no extra ESPN calls). `recordPending: true` marks a game the summary says is final but the schedule hadn't counted yet; the front end adds these to records itself.
- `results`: compact `[homeId, awayId, winnerId, isConf]` tuples for every completed game (head-to-head and common-opponent data for the tiebreakers).
- `ratings`: per-team FPI, playoff %, conference-title %, SOR rank, AP/CFP rank. It may be absent if the FPI feed fails, and the front end must cope with that (`haveRatings`).
- Nulls are stripped from the JSON output, so the client treats missing fields as null/undefined. Edge cache is `s-maxage=20, stale-while-revalidate=40`.

### Front end (`index.html`, script starts around line 429)
- `fetchLive` / `pickInterval` / `schedule`: adaptive polling (30s while live or near kickoff, 2 min on game day, 10 min otherwise).
- `buildLeague()` turns the payload into a dense model `L`: team index arrays, an `N×N` Int8 `res` head-to-head matrix (1 win / -1 loss / 0 not played), typed-array records, and `rem` (remaining games with home win probability `pH`, using live probability when in progress, else 0.5 flagged `est`).
- `applyOutcome(L, out)` produces a standings snapshot `S` for one full set of outcomes. The tiebreaker engine (`tiersOf`, `twoTeam`, `multiPick`, `seedTop2`) operates on `S` and optionally writes a human-readable `log`, which the what-if scenario explanation shows.
- `simulate(L, fixed)` runs `SIMS = 10000` Monte Carlo finishes with a fixed-seed RNG (`rngFrom`), so results are deterministic for the same data. `fixed[k]` (from user picks) pins outcomes. It returns title-game appearance counts, pair counts, per-game conditional counts (used for "which games swing it"), and loss distributions by path for the playoff model.
- Playoff model: `titleWinP` uses the FPI gap with `FPI_SD`, at-large odds are `logistic(strength − LOSS_COST × losses)`, and `calibrate` fits each team's `strength` to ESPN's implied at-large odds. `ccgPen` is the title-game loss weight (slider).
- Exact paths ("What does a team need?"): when ≤ `EXACT_MAX` (16) undecided conference games remain (picked games stay fixed in the picks view), `exactRun` enumerates every finish through `seedOdds` (which follows each coin-toss branch of `seedTop2`) and caches the seeds per finish; `needFor` derives one team's must-happen results, rooting guide (conditional on the must-haves) and up to 3 likeliest paths; `renderNeed` draws them and hides the simulation-based swing list. "Try it" buttons merge a path into `picks` via `loadPicks`.
- `render()` draws the race, "Rest of the Big 12" (`renderRest`) and the slate; `renderTitle()` drives all title-game, picks, scenario, playoff and focus sections.
- Who's "in the race" is decided by odds, not record: `splitRace()` runs the current-odds simulation first (`baseSim`, cached per data update and reused by `renderTitle`) and keeps teams with ≥ `RACE_MIN` (1%) title-game chance or ESPN playoff % ≥ 1. The slate and the `tracked` styling follow that set.
- Viewer state lives in `localStorage` keys `b12-picks`, `b12-focus`, `b12-ccgpen` (all reads/writes wrapped in try/catch).
