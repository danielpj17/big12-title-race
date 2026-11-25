// Aggregates ESPN men's college basketball data for mbb.html (Big 12 view and national top-15 view).
// GET /api/mbb?view=big12|ncaa -> { updated, season, view, source, poll, polls, teams[], games[] }
// For each tracked team: every final from the last 7 days, plus every game in the next 7 days or its next 3,
// whichever is more. Conference and NCAA tournaments are left out for now.
const BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball";
// Big 12 (same ESPN school ids as football)
const IDS = [254, 2641, 12, 252, 248, 239, 197, 9, 2116, 2132, 277, 66, 2628, 2306, 38, 2305];
const BIG12 = new Set(IDS.map(String));
const TOP = 15;                                    // national view: union of both polls' top 15
const DAY = 24 * 3600 * 1000;
const PAST_MS = 7 * DAY, NEXT_MS = 7 * DAY, NEXT_MIN = 3;
const HCA = 3.5, BPI_SD = 11;                      // fallback win chance from BPI when ESPN posts no predictor
const COLOR_TTL = 12 * 3600 * 1000;

async function getJSON(url) {
  const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 cbb-tracker" } });
  if (!r.ok) throw new Error(`ESPN ${r.status} for ${url}`);
  return r.json();
}

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

// standard normal CDF (Abramowitz-Stegun 7.1.26)
function phi(z) {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const e = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-z * z / 2);
  return z >= 0 ? 1 - e / 2 : e / 2;
}

// ESPN uses placeholder ids ("-1", "-2") for opponents not set yet (later rounds of events)
const isTbd = (id) => !/^\d+$/.test(String(id || ""));
const scoreOf = (x) => num(x.score != null && typeof x.score === "object" ? x.score.value ?? x.score.displayValue : x.score);

// one team's side of a completed game, for the page's "last game" line
function resultOf(e, c, me, op) {
  const t = op.team || {};
  return { date: e.date, id: op.id, abbr: t.abbreviation, name: t.location || t.shortDisplayName || t.displayName,
    at: me.homeAway === "home" || c.neutralSite ? "vs" : "@", pf: scoreOf(me), pa: scoreOf(op), w: me.winner === true };
}

// AP and Coaches polls, this season's if available
function readPolls(rk, season) {
  const list = ((rk && rk.rankings) || []).filter((p) => Array.isArray(p.ranks) && p.ranks.length >= TOP);
  const polls = {};
  for (const any of [false, true]) {
    for (const type of ["ap", "usa"]) {
      const p = list.find((x) => x.type === type && (any || !x.season || x.season.year === season));
      if (!p || polls[type]) continue;
      polls[type] = {
        name: p.name, short: p.shortName, week: p.occurrence && p.occurrence.displayValue, date: p.date,
        ranks: p.ranks.filter((r) => r.current > 0 && r.team).sort((a, b) => a.current - b.current)
          .map((r) => ({ id: String(r.team.id), rank: r.current, prev: r.previous || 0, rec: r.recordSummary || null,
            short: r.team.location, abbr: r.team.abbreviation, color: r.team.color ? "#" + r.team.color : null })),
      };
    }
    if (Object.keys(polls).length) break;
  }
  return polls;
}

// every D-I team's colors, cached per warm function instance (finals from past days carry no colors)
let colorCache = { at: 0, map: null };
async function teamColors() {
  if (colorCache.map && Date.now() - colorCache.at < COLOR_TTL) return colorCache.map;
  try {
    const d = await getJSON(`${BASE}/teams?limit=500`);
    const map = {};
    for (const x of d.sports[0].leagues[0].teams) {
      const t = x.team; map[String(t.id)] = { color: t.color ? "#" + t.color : null, alt: t.alternateColor ? "#" + t.alternateColor : null };
    }
    colorCache = { at: Date.now(), map };
  } catch (_) { /* keep whatever we had */ }
  return colorCache.map || {};
}

module.exports = async (req, res) => {
  try {
    const now = new Date();
    const view = req.query && req.query.view === "ncaa" ? "ncaa" : "big12";
    // the 2026-27 season is "2027" at ESPN; July onward counts toward the next season
    const season = Number(req.query && req.query.season) || (now.getUTCMonth() >= 6 ? now.getUTCFullYear() + 1 : now.getUTCFullYear());

    const BPI_URL = `https://site.api.espn.com/apis/fitt/v3/sports/basketball/mens-college-basketball/powerindex?season=${season}&limit=400`;
    const [rk, power, colors] = await Promise.all([
      getJSON(`${BASE}/rankings`).catch(() => null),
      getJSON(BPI_URL).catch(() => null),
      teamColors(),
    ]);
    const polls = readPolls(rk, season);
    if (view === "ncaa" && !Object.keys(polls).length) throw new Error("No poll available yet");

    // ESPN BPI: rating and rank, projected records, conference-title chance, strength of record, top-50 record
    const bpi = {};
    try {
      const names = (cat) => ((power.categories || []).find((c) => c.name === cat) || {}).names || [];
      const nB = names("bpi"), nR = names("resume");
      for (const t of power.teams || []) {
        const vals = (cat) => ((t.categories || []).find((c) => c.name === cat) || {}).values || [];
        const vB = vals("bpi"), vR = vals("resume");
        const b = (k) => { const i = nB.indexOf(k); return i >= 0 ? num(vB[i]) : null; };
        const r = (k) => { const i = nR.indexOf(k); return i >= 0 ? num(vR[i]) : null; };
        bpi[String(t.team.id)] = {
          bpi: b("bpi"), bpiRank: b("bpirank"), confChance: b("chancewinconfortie"),
          projW: b("projtotalwins"), projL: b("projtotallosses"), projCW: b("projconfwins"), projCL: b("projconflosses"),
          cw: b("confwins"), cl: b("conflosses"),
          sor: r("sorrank"), top50W: r("top50bpiwins"), top50L: r("top50bpilosses"),
        };
      }
    } catch (_) { /* no BPI: the page shows dashes */ }

    // full windows for the Big 12 (all 16) or the union of both polls' top 15; national view also gets
    // ranks 16-25 "light": just the last result and next game
    const ids = view === "big12" ? IDS.map(String)
      : [...new Set(Object.values(polls).flatMap((p) => p.ranks.slice(0, TOP).map((r) => r.id)))];
    const extra = view === "big12" ? []
      : [...new Set(Object.values(polls).flatMap((p) => p.ranks.slice(TOP, 25).map((r) => r.id)))].filter((id) => !ids.includes(id));
    const all = [...ids, ...extra];
    const scheds = await Promise.all(all.map((id) => getJSON(`${BASE}/teams/${id}/schedule?season=${season}`)));

    const gameMap = new Map();   // event id -> { e, c }
    const teams = [];
    const nowMs = now.getTime();
    scheds.forEach((s, i) => {
      const id = all[i], light = i >= ids.length;
      let w = 0, l = 0, cw = 0, cl = 0, last = null;
      const past = [], upcoming = [];
      for (const e of s.events || []) {
        const c = e.competitions && e.competitions[0]; if (!c) continue;
        const me = c.competitors.find((x) => x.id === id);
        const op = c.competitors.find((x) => x.id !== id);
        if (!me || !op) continue;
        const t = new Date(e.date).getTime();
        const done = !!c.status.type.completed;
        const decided = done && c.competitors.some((x) => x.winner === true);
        // a Big 12 game counts in the standings when it's a regular (non-event) game on a campus
        const isConf = BIG12.has(id) && BIG12.has(op.id) && !c.neutralSite && !(c.type && c.type.type === "tournament");
        if (decided) {
          me.winner === true ? w++ : l++;
          if (isConf) me.winner === true ? cw++ : cl++;
          if (!last || t >= new Date(last.date).getTime()) last = resultOf(e, c, me, op);
          if (nowMs - t <= PAST_MS) past.push({ e, c, t });
        } else if (!done && c.status.type.state !== "post") {   // "post" without a final = postponed or canceled
          upcoming.push({ e, c, t });
        }
      }
      upcoming.sort((a, b) => a.t - b.t);
      const inWeek = upcoming.filter((x) => x.t - nowMs <= NEXT_MS);
      const next = light ? upcoming.slice(0, 1) : inWeek.length >= NEXT_MIN ? inWeek : upcoming.slice(0, NEXT_MIN);
      if (light) past.length = 0;
      for (const x of [...past, ...next]) if (!gameMap.has(x.e.id)) gameMap.set(x.e.id, x);

      const tm = s.team || {}, b = bpi[id] || {};
      const standing = tm.standingSummary || null;
      teams.push({
        id, light: light || null, short: tm.location, abbr: tm.abbreviation, name: tm.displayName,
        color: tm.color ? "#" + tm.color : null, alt: (colors[id] && colors[id].alt) || null,
        w, l,
        // Big 12 view counts conference games itself; elsewhere BPI's conference record (opponents' conferences aren't in the schedule)
        cw: view === "big12" ? cw : b.cw, cl: view === "big12" ? cl : b.cl,
        standing, conf: standing && /\bin (.+)$/.exec(standing) ? /\bin (.+)$/.exec(standing)[1] : null,
        last,
        past: past.sort((a, b2) => b2.t - a.t).map((x) => x.e.id),   // most recent first
        next: next.map((x) => x.e.id),
        bpi: b.bpi, bpiRank: b.bpiRank, confChance: b.confChance, projW: b.projW, projL: b.projL, projCW: b.projCW, projCL: b.projCL,
        sor: b.sor, top50W: b.top50W, top50L: b.top50L,
      });
    });

    const estimate = (hId, aId, neutral) => {
      const h = bpi[hId] && bpi[hId].bpi, a = bpi[aId] && bpi[aId].bpi;
      if (h == null || a == null) return h == null && a == null ? null : h == null ? 5 : 95;   // D-I vs non-D-I
      return Math.round(1000 * phi((h - a + (neutral ? 0 : HCA)) / BPI_SD)) / 10;
    };

    const games = await Promise.all([...gameMap.values()].map(async ({ e, c }) => {
      const note = (c.notes || []).map((n) => n.headline).filter(Boolean)[0] || null;
      const base = {
        id: e.id, date: e.date, timeValid: c.timeValid !== false, neutral: !!c.neutralSite, note,
        event: !!(c.type && c.type.type === "tournament"),
        state: c.status.type.state, completed: !!c.status.type.completed,
        detail: c.status.type.shortDetail, clock: c.status.displayClock, period: c.status.period,
        venue: c.venue ? c.venue.fullName : null,
        city: c.venue && c.venue.address ? [c.venue.address.city, c.venue.address.state].filter(Boolean).join(", ") : null,
        tv: null, spread: null, ou: null, possession: null, live: null, est: null,
        home: null, away: null,
      };
      const side = (x) => {
        const t = (x && x.team) || {};
        return { id: x ? x.id : "-1", short: t.location || t.shortDisplayName || t.displayName, abbr: t.abbreviation,
          score: x ? scoreOf(x) : null, winner: !!x && x.winner === true, prob: null, rec: null };
      };
      const hx = c.competitors.find((x) => x.homeAway === "home") || c.competitors[0];
      base.home = side(hx);
      base.away = side(c.competitors.find((x) => x !== hx));
      base.conf = BIG12.has(base.home.id) && BIG12.has(base.away.id) && !base.neutral && !base.event;
      const b0 = (c.broadcasts || [])[0];
      if (b0) base.tv = (b0.media && b0.media.shortName) || (b0.names && b0.names[0]) || null;
      if (base.completed || isTbd(base.home.id) || isTbd(base.away.id)) return base;   // finals need no summary; TBD has no odds

      try {
        const s = await getJSON(`${BASE}/summary?event=${e.id}`);
        const hc = s.header && s.header.competitions && s.header.competitions[0];
        if (hc) {
          base.state = hc.status.type.state;
          base.completed = !!hc.status.type.completed;
          base.detail = hc.status.type.shortDetail;
          base.clock = hc.status.displayClock;
          base.period = hc.status.period;
          // the schedule hadn't marked it final yet, so the records above don't include it
          if (base.completed) base.recordPending = true;
          for (const x of hc.competitors || []) {
            const t = x.homeAway === "home" ? base.home : base.away;
            if (x.score != null && x.score !== "") t.score = num(x.score);
            t.winner = x.winner === true;
            if (x.possession) base.possession = x.id;
            if (x.team) {
              if (x.team.color) t.color = "#" + x.team.color;
              if (x.team.alternateColor) t.alt = "#" + x.team.alternateColor;
            }
            const tot = (x.record || []).find((r) => r.type === "total");
            if (tot) t.rec = tot.summary || tot.displayValue || null;
          }
          const b = (hc.broadcasts || [])[0];
          if (b && b.media) base.tv = b.media.shortName || base.tv;
        }
        if (s.gameInfo && s.gameInfo.venue) {
          const v = s.gameInfo.venue;
          base.venue = v.fullName || base.venue;
          if (v.address) base.city = [v.address.city, v.address.state].filter(Boolean).join(", ") || base.city;
        }
        const pc = (s.pickcenter || [])[0];
        if (pc) { base.spread = pc.details || null; base.ou = pc.overUnder ?? null; }
        if (s.predictor) {
          base.home.prob = num(s.predictor.homeTeam && s.predictor.homeTeam.gameProjection);
          base.away.prob = num(s.predictor.awayTeam && s.predictor.awayTeam.gameProjection);
        }
        const wp = s.winprobability;
        if (base.state === "in" && Array.isArray(wp) && wp.length) {
          const h = num(wp[wp.length - 1].homeWinPercentage);
          if (h != null) base.live = { home: Math.round(h * 1000) / 10, away: Math.round((1 - h) * 1000) / 10 };
        }
      } catch (err) {
        base.error = String(err.message || err);
      }
      if (base.home.prob == null && !base.completed) {
        const p = estimate(base.home.id, base.away.id, base.neutral);
        if (p != null) { base.home.prob = p; base.away.prob = Math.round((100 - p) * 10) / 10; base.est = true; }
      }
      return base;
    }));

    // colors: summaries carry them for upcoming games; the cached team list fills in the rest
    for (const g of games) for (const s of [g.home, g.away]) {
      const c = colors[s.id]; if (!c) continue;
      if (!s.color && c.color) s.color = c.color;
      if (!s.alt && c.alt) s.alt = c.alt;
    }

    games.sort((a, b) => new Date(a.date) - new Date(b.date));
    res.setHeader("Cache-Control", "s-maxage=20, stale-while-revalidate=40");
    res.setHeader("Access-Control-Allow-Origin", "*");
    const body = {
      updated: now.toISOString(), season, view,
      source: "ESPN (rankings, schedules, BPI matchup predictor and projections, live win probability, scores)",
      poll: polls.ap ? "ap" : polls.usa ? "usa" : null, polls, teams, games,
    };
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.status(200).send(JSON.stringify(body, (k, v) => (v === null ? undefined : v)));
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
};
