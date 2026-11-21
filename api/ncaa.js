// Aggregates ESPN data for the national page (ncaa.html): top 15, ranked 16-25, projected bracket, rooting guide.
// GET /api/ncaa -> { updated, season, source, poll, polls, teams, games }
const BASE = "https://site.api.espn.com/apis/site/v2/sports/football/college-football";
const TOP = 15;                       // teams with full schedules (per poll; the union of both polls is fetched)
const RECENT_MS = 3 * 24 * 3600 * 1000; // keep finals from the last 3 days
const CONTENDER_MIN = 0.5;            // ESPN playoff % that puts a team in the rooting guide's model
const HFA = 2.5, FPI_SD = 13.5;       // fallback win chance from FPI when ESPN posts no matchup predictor

// ESPN conference (group) ids. Power 4 champions get automatic bids; the highest-ranked team from the
// Group of 6 gets one bid; Notre Dame is in with a top-12 finish (2026 format).
const P4 = new Set(["1", "4", "5", "8"]);
const G6 = new Set(["9", "12", "15", "17", "37", "151"]);
const ND = "87";
const CONF_NAMES = { 1: "ACC", 4: "Big 12", 5: "Big Ten", 8: "SEC", 9: "Pac-12", 12: "Conference USA", 15: "MAC",
  17: "Mountain West", 18: "FBS Independents", 37: "Sun Belt", 151: "American" };

async function getJSON(url) {
  const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 cfb-top15-tracker" } });
  if (!r.ok) throw new Error(`ESPN ${r.status} for ${url}`);
  return r.json();
}

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

// ESPN uses placeholder ids ("-1", "-2") for opponents not set yet (title games, playoff rounds)
const isTbd = (id) => !/^\d+$/.test(String(id || ""));

function kindOf(id, confId) {
  if (id === ND) return "ND";
  if (P4.has(confId)) return "P4";
  if (G6.has(confId)) return "G6";
  if (confId === "18") return "IND";   // other FBS independents: at-large only
  return null;
}

// standard normal CDF (Abramowitz-Stegun 7.1.26)
function phi(z) {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const e = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-z * z / 2);
  return z >= 0 ? 1 - e / 2 : e / 2;
}

// CFP committee rankings and the AP poll, this season's if available
function readPolls(rk, season) {
  const list = ((rk && rk.rankings) || []).filter((p) => Array.isArray(p.ranks) && p.ranks.length >= TOP);
  const pick = (type, any) => list.find((p) => p.type === type && (any || !p.season || p.season.year === season));
  const polls = {};
  for (const any of [false, true]) {
    for (const type of ["cfp", "ap"]) {
      const p = pick(type, any);
      if (!p || polls[type]) continue;
      polls[type] = {
        name: p.name, short: p.shortName, week: p.occurrence && p.occurrence.displayValue, date: p.date,
        ranks: p.ranks.filter((r) => r.current > 0 && r.team).sort((a, b) => a.current - b.current)
          .map((r) => ({ id: String(r.team.id), rank: r.current, prev: r.previous || 0, src: r })),
      };
    }
    if (Object.keys(polls).length) break;
  }
  return polls;
}

module.exports = async (req, res) => {
  try {
    const now = new Date();
    const season = Number(req.query && req.query.season) ||
      (now.getUTCMonth() < 2 ? now.getUTCFullYear() - 1 : now.getUTCFullYear());

    const FPI_URL = `https://site.api.espn.com/apis/fitt/v3/sports/football/college-football/powerindex?season=${season}&limit=200`;
    const [rk, power, board] = await Promise.all([
      getJSON(`${BASE}/rankings`),
      getJSON(FPI_URL).catch(() => null),
      getJSON(`${BASE}/scoreboard?groups=80&limit=300`).catch(() => null),
    ]);
    const polls = readPolls(rk, season);
    if (!Object.keys(polls).length) throw new Error("No poll available yet");

    // ---------- team info, merged from every feed that carries it ----------
    const info = {};
    const note = (id, t, extra) => {
      if (isTbd(id)) return;
      const k = String(id), cur = info[k] || (info[k] = { id: k });
      if (t) {
        cur.short = cur.short || t.location;            // "Ohio State"; FPI has no location, so keep its name as a fallback
        cur.alias = cur.alias || t.shortDisplayName;
        cur.abbr = cur.abbr || t.abbreviation;
        cur.name = cur.name || t.displayName;
        if (t.color && !cur.color) cur.color = "#" + t.color;
        if (t.alternateColor && !cur.alt) cur.alt = "#" + t.alternateColor;
        const g = t.conferenceId || (t.groups && t.groups.isConference !== false && t.groups.id);
        if (g && !cur.confId) cur.confId = String(g);
      }
      if (extra) for (const [key, v] of Object.entries(extra)) if (v != null && cur[key] == null) cur[key] = v;
    };
    for (const p of Object.values(polls)) for (const r of p.ranks) note(r.id, r.src.team, { rec: r.src.recordSummary, confLabel: r.src.conference });

    // ESPN FPI: rating, playoff %, conference-title %, national-title %
    const odds = {};
    try {
      const cat = power.categories.find((c) => c.name === "fpi");
      const ix = (n) => (cat.names || []).indexOf(n);
      const iF = ix("fpi"), iP = ix("probmakeplayoffs"), iC = ix("probwinconf"), iT = ix("probwintitle");
      for (const t of power.teams || []) {
        const f = (t.categories.find((c) => c.name === "fpi") || {}).values || [];
        const at = (i) => (i >= 0 ? num(f[i]) : null);
        const id = String(t.team.id);
        odds[id] = { fpi: at(iF), playoff: at(iP), winConf: at(iC), winTitle: at(iT) };
        note(id, t.team);
      }
    } catch (_) { /* odds stay empty; the page shows dashes and skips the bracket and guide */ }

    // full schedules for the union of every poll's top 15; everyone ranked or with a real playoff shot is "of interest"
    const detailed = [...new Set(Object.values(polls).flatMap((p) => p.ranks.slice(0, TOP).map((r) => r.id)))];
    const interest = new Set([...detailed, ...Object.values(polls).flatMap((p) => p.ranks.map((r) => r.id)),
      ...Object.keys(odds).filter((id) => (odds[id].playoff || 0) >= CONTENDER_MIN)]);

    // this week's scoreboard (every FBS game); once it's all final, also look at next week
    const boards = board ? [board] : [];
    const events = (b) => (b && b.events) || [];
    if (board && events(board).length && events(board).every((e) => e.competitions[0].status.type.completed) && board.week) {
      const type = (board.season && board.season.type) || 2;
      const nxt = await getJSON(`${BASE}/scoreboard?groups=80&limit=300&seasontype=${type}&week=${board.week.number + 1}`).catch(() => null);
      if (nxt) boards.push(nxt);
    }

    const scheds = await Promise.all(detailed.map((id) => Promise.all([
      getJSON(`${BASE}/teams/${id}/schedule?season=${season}`),
      getJSON(`${BASE}/teams/${id}/schedule?season=${season}&seasontype=3`).catch(() => ({ events: [] })),
    ])));

    const gameMap = new Map(); // event id -> { e, c, wk }
    const records = {};
    scheds.forEach(([reg, post], i) => {
      const id = detailed[i];
      let w = 0, l = 0;
      for (const e of [...(reg.events || []), ...(post.events || [])]) {
        const c = e.competitions && e.competitions[0]; if (!c) continue;
        const me = c.competitors.find((x) => x.id === id);
        const op = c.competitors.find((x) => x.id !== id);
        if (!me || !op) continue;
        const done = !!c.status.type.completed;
        if (done && c.competitors.some((x) => x.winner === true)) me.winner === true ? w++ : l++;
        const recent = done && now - new Date(e.date) < RECENT_MS;
        if ((!done || recent) && !gameMap.has(e.id)) gameMap.set(e.id, { e, c });
      }
      const t = reg.team || {};
      note(id, t, { standing: t.standingSummary || null });
      records[id] = { w, l };
    });

    const weekIds = new Set();
    for (const b of boards) for (const e of events(b)) {
      const c = e.competitions && e.competitions[0]; if (!c) continue;
      weekIds.add(e.id);
      for (const x of c.competitors) {
        const tot = (x.records || []).find((r) => r.type === "total");
        note(x.id, x.team);
        if (tot && info[x.id]) info[x.id].rec = tot.summary; // the scoreboard's record is the freshest
      }
      if (c.competitors.some((x) => interest.has(x.id)) && !gameMap.has(e.id)) gameMap.set(e.id, { e, c });
    }

    // contenders on a bye who aren't ranked: their schedule feed names their conference
    const missing = [...interest].filter((id) => !(info[id] && info[id].confId) && odds[id] && (odds[id].playoff || 0) >= CONTENDER_MIN);
    const confFetch = Promise.all(missing.map((id) => getJSON(`${BASE}/teams/${id}/schedule?season=${season}`)
      .then((s) => note(id, s.team)).catch(() => {})));

    const estimate = (hId, aId, neutral) => {
      const h = odds[hId] && odds[hId].fpi, a = odds[aId] && odds[aId].fpi;
      if (h == null && a == null) return null;
      if (h == null || a == null) return h == null ? 3 : 97;   // FBS vs FCS
      return Math.round(1000 * phi((h - a + (neutral ? 0 : HFA)) / FPI_SD)) / 10;
    };

    const games = await Promise.all([...gameMap.values()].map(async ({ e, c }) => {
      const ev = (c.notes || []).map((n) => n.headline).filter(Boolean)[0] || null;
      const base = {
        id: e.id, date: e.date, timeValid: c.timeValid !== false, neutral: !!c.neutralSite, note: ev,
        wk: weekIds.has(e.id) || null,
        state: c.status.type.state, completed: !!c.status.type.completed,
        detail: c.status.type.shortDetail, clock: c.status.displayClock, period: c.status.period,
        venue: c.venue ? c.venue.fullName : null,
        city: c.venue && c.venue.address ? [c.venue.address.city, c.venue.address.state].filter(Boolean).join(", ") : null,
        tv: null, spread: null, ou: null, possession: null, live: null, est: null,
        home: null, away: null,
      };
      const side = (x) => {
        const t = (x && x.team) || {};
        const tot = ((x && x.records) || []).find((r) => r.type === "total");
        return {
          id: x ? x.id : "-1", short: t.location || t.shortDisplayName || t.displayName, abbr: t.abbreviation,
          score: x && x.score != null ? num(typeof x.score === "object" ? x.score.value ?? x.score.displayValue : x.score) : null,
          winner: !!x && x.winner === true, prob: null, rec: tot ? tot.summary : null,
        };
      };
      const hx = c.competitors.find((x) => x.homeAway === "home") || c.competitors[0];
      base.home = side(hx);
      base.away = side(c.competitors.find((x) => x !== hx));
      if (base.completed || isTbd(base.home.id) || isTbd(base.away.id)) return base;   // no odds until the opponent is set

      try {
        const s = await getJSON(`${BASE}/summary?event=${e.id}`);
        const hc = s.header && s.header.competitions && s.header.competitions[0];
        if (hc) {
          base.state = hc.status.type.state;
          base.completed = !!hc.status.type.completed;
          base.detail = hc.status.type.shortDetail;
          base.clock = hc.status.displayClock;
          base.period = hc.status.period;
          // schedule hadn't marked it final yet, so team records above don't include it
          if (base.completed) base.recordPending = true;
          for (const x of hc.competitors || []) {
            const t = x.homeAway === "home" ? base.home : base.away;
            if (x.score != null && x.score !== "") t.score = num(x.score);
            t.winner = x.winner === true;
            if (x.possession) base.possession = x.id;
            note(x.id, x.team);
            const tot = (x.record || []).find((r) => r.type === "total");
            if (tot) t.rec = tot.summary || tot.displayValue || t.rec;
          }
          const b = (hc.broadcasts || [])[0];
          if (b && b.media) base.tv = b.media.shortName || null;
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
          const last = wp[wp.length - 1];
          const h = num(last.homeWinPercentage);
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
    await confFetch;

    // ---------- output ----------
    const teams = {};
    for (const id of interest) {
      const t = info[id] || { id }, o = odds[id] || {};
      const confId = t.confId || null;
      teams[id] = {
        id, short: t.short || t.alias, abbr: t.abbr, name: t.name, color: t.color, alt: t.alt,
        confId, conf: id === ND ? "Independent" : CONF_NAMES[confId] || t.confLabel || null, kind: kindOf(id, confId),
        standing: t.standing, rec: t.rec,
        detailed: records[id] ? true : null, w: records[id] ? records[id].w : null, l: records[id] ? records[id].l : null,
        fpi: o.fpi, playoff: o.playoff, winConf: o.winConf, winTitle: o.winTitle,
      };
    }
    for (const g of games) {
      for (const s of [g.home, g.away]) {
        const t = info[s.id]; if (!t) continue;
        if (t.color) s.color = t.color;
        if (t.alt) s.alt = t.alt;
        if (!s.short) s.short = t.short || t.alias;
        if (!s.abbr) s.abbr = t.abbr;
      }
      const hc = info[g.home.id] && info[g.home.id].confId, ac = info[g.away.id] && info[g.away.id].confId;
      g.conf = !!hc && hc === ac && (P4.has(hc) || G6.has(hc));
    }
    for (const p of Object.values(polls)) for (const r of p.ranks) delete r.src;

    games.sort((a, b) => new Date(a.date) - new Date(b.date));
    res.setHeader("Cache-Control", "s-maxage=20, stale-while-revalidate=40");
    res.setHeader("Access-Control-Allow-Origin", "*");
    const body = {
      updated: new Date().toISOString(), season,
      source: "ESPN (rankings, FPI matchup predictor and playoff odds, live win probability, scores)",
      poll: polls.cfp ? "cfp" : "ap", polls, teams, games,
    };
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.status(200).send(JSON.stringify(body, (k, v) => (v === null ? undefined : v)));
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
};
