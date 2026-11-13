// Aggregates ESPN data for the Big 12 live odds tracker.
// GET /api/big12 -> { updated, season, teams[], games[] }
const BASE = "https://site.api.espn.com/apis/site/v2/sports/football/college-football";
// Big 12 (2024+ alignment), ESPN team ids
const IDS = [254, 2641, 12, 252, 248, 239, 197, 9, 2116, 2132, 277, 66, 2628, 2306, 38, 2305];
const BIG12 = new Set(IDS.map(String));
const RECENT_MS = 3 * 24 * 3600 * 1000; // keep finals from the last 3 days

async function getJSON(url) {
  const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 big12-tracker" } });
  if (!r.ok) throw new Error(`ESPN ${r.status} for ${url}`);
  return r.json();
}

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

module.exports = async (req, res) => {
  try {
    const now = new Date();
    const season = Number(req.query && req.query.season) ||
      (now.getUTCMonth() < 2 ? now.getUTCFullYear() - 1 : now.getUTCFullYear());

    const FPI_URL = `https://site.api.espn.com/apis/fitt/v3/sports/football/college-football/powerindex?season=${season}&limit=200`;
    const [scheds, power] = await Promise.all([
      Promise.all(IDS.map((id) => getJSON(`${BASE}/teams/${id}/schedule?season=${season}`))),
      getJSON(FPI_URL).catch(() => null),
    ]);

    // ESPN FPI: rating, playoff %, conference-title %, strength-of-record rank, AP/CFP rank
    let ratings = null;
    try {
      const L = power.categories.find((c) => c.name === "fpi").labels;
      const R = power.categories.find((c) => c.name === "resume").labels;
      const iP = L.indexOf("PLAYOFFS%"), iC = L.indexOf("WIN CONF%"), iS = R.indexOf("SOR RNK"), iA = R.indexOf("AP/CFP");
      ratings = {};
      for (const t of power.teams || []) {
        const id = String(t.team.id); if (!BIG12.has(id)) continue;
        const f = (t.categories.find((c) => c.name === "fpi") || {}).values || [];
        const r = (t.categories.find((c) => c.name === "resume") || {}).values || [];
        ratings[id] = { fpi: num(f[0]), playoff: iP >= 0 ? num(f[iP]) : null, winConf: iC >= 0 ? num(f[iC]) : null,
          sor: iS >= 0 ? num(r[iS]) : null, rank: iA >= 0 && r.length > iA ? num(r[iA]) : null };
      }
      if (!Object.keys(ratings).length) ratings = null;
    } catch (_) { ratings = null; }

    const teams = [];
    const gameMap = new Map(); // event id -> base game from schedule
    const results = new Map(); // every completed game this season: [homeId, awayId, winnerId, conf]
    scheds.forEach((s, i) => {
      const id = String(IDS[i]);
      let w = 0, l = 0, cw = 0, cl = 0;
      for (const e of s.events || []) {
        const c = e.competitions[0];
        const me = c.competitors.find((x) => x.id === id);
        const op = c.competitors.find((x) => x.id !== id);
        if (!me || !op) continue;
        if (c.status.type.completed) {
          if (!results.has(e.id)) {
            const h = c.competitors.find((x) => x.homeAway === "home") || me;
            const a = c.competitors.find((x) => x !== h);
            const wn = c.competitors.find((x) => x.winner === true);
            results.set(e.id, [h.id, a.id, wn ? wn.id : null, BIG12.has(h.id) && BIG12.has(a.id) ? 1 : 0]);
          }
          const won = me.winner === true;
          won ? w++ : l++;
          if (BIG12.has(op.id)) won ? cw++ : cl++;
        }
        const recent = c.status.type.completed && now - new Date(e.date) < RECENT_MS;
        if ((!c.status.type.completed || recent) && !gameMap.has(e.id)) {
          gameMap.set(e.id, { e, c });
        }
      }
      const t = s.team || {};
      teams.push({
        id, name: t.displayName, short: t.location, abbr: t.abbreviation,
        color: t.color ? "#" + t.color : null,
        w, l, cw, cl,
      });
    });

    const qualifying = new Set(teams.filter((t) => t.cw + t.cl > 0 && t.cw / (t.cw + t.cl) > 0.5).map((t) => t.id));

    // every unplayed game (all teams: the tiebreakers need the whole league), plus recent finals for contenders
    const wanted = [...gameMap.values()].filter(({ c }) => !c.status.type.completed || c.competitors.some((x) => qualifying.has(x.id)));

    const games = await Promise.all(wanted.map(async ({ e, c }) => {
      const base = {
        id: e.id, date: e.date, timeValid: c.timeValid !== false,
        neutral: !!c.neutralSite, conf: c.competitors.every((x) => BIG12.has(x.id)),
        state: c.status.type.state, completed: !!c.status.type.completed,
        detail: c.status.type.shortDetail, clock: c.status.displayClock, period: c.status.period,
        venue: c.venue ? c.venue.fullName : null,
        city: c.venue && c.venue.address ? [c.venue.address.city, c.venue.address.state].filter(Boolean).join(", ") : null,
        tv: null, spread: null, ou: null, possession: null, live: null,
        home: null, away: null,
      };
      const side = (x) => ({
        id: x.id, short: x.team.location, abbr: x.team.abbreviation,
        score: x.score != null ? num(typeof x.score === "object" ? x.score.value ?? x.score.displayValue : x.score) : null,
        winner: x.winner === true, prob: null,
      });
      base.home = side(c.competitors.find((x) => x.homeAway === "home"));
      base.away = side(c.competitors.find((x) => x.homeAway === "away"));
      if (base.completed) return base;

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
      return base;
    }));

    games.sort((a, b) => new Date(a.date) - new Date(b.date));
    res.setHeader("Cache-Control", "s-maxage=20, stale-while-revalidate=40");
    res.setHeader("Access-Control-Allow-Origin", "*");
    const body = { updated: new Date().toISOString(), season, source: "ESPN (FPI matchup predictor, live win probability, scores)", teams, games, results: [...results.values()], ratings };
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.status(200).send(JSON.stringify(body, (k, v) => (v === null ? undefined : v)));
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
};
