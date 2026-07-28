const { pool } = require('./db');
const { communityScore } = require('./score');

// Aggregates are computed on read with a per-template in-process cache
// (30s TTL, invalidated on any ranking write to the template). Median is
// the discrete percentile rule (smallest tier where the cumulative count
// crosses half the placements) — identical to percentile_disc(0.5).
// Controversy is normalized Shannon entropy of the distribution.

const TTL_MS = 30 * 1000;
const cache = new Map(); // key `${templateId}:${scope}` -> { t, data }

function invalidate(templateId) {
  for (const key of cache.keys()) {
    if (key.startsWith(templateId + ':')) cache.delete(key);
  }
}

function medianTier(dist, placed) {
  if (!placed) return null;
  const threshold = Math.ceil(placed / 2);
  let cum = 0;
  for (let t = 0; t < dist.length; t++) {
    cum += dist[t];
    if (cum >= threshold) return t + 1;
  }
  return dist.length;
}

function entropy(dist, placed, k) {
  if (!placed || placed < 2 || k < 2) return 0;
  let h = 0;
  for (const c of dist) {
    if (c > 0) {
      const p = c / placed;
      h -= p * Math.log(p);
    }
  }
  return h / Math.log(k);
}

async function computeAggregate(templateId, k, memberIds) {
  const scopeSql = memberIds ? ' AND r.user_id = ANY($2)' : '';
  const params = memberIds ? [templateId, memberIds] : [templateId];
  const { rows } = await pool.query(
    `SELECT ri.item_id::text AS item_id, ri.tier, COUNT(*)::int AS c
     FROM ranking_items ri
     JOIN rankings r ON r.id = ri.ranking_id
     WHERE r.template_id = $1 AND r.status = 'submitted'${scopeSql}
     GROUP BY ri.item_id, ri.tier`,
    params
  );
  const nRes = await pool.query(
    `SELECT COUNT(*)::int AS n FROM rankings r
     WHERE r.template_id = $1 AND r.status = 'submitted'${scopeSql}`,
    params
  );
  const items = {};
  for (const row of rows) {
    let it = items[row.item_id];
    if (!it) it = items[row.item_id] = { dist: Array(k).fill(0), placed: 0, skipped: 0 };
    if (row.tier == null) it.skipped += row.c;
    else if (row.tier >= 1 && row.tier <= k) { it.dist[row.tier - 1] += row.c; it.placed += row.c; }
  }
  let mostContested = null;
  for (const [id, it] of Object.entries(items)) {
    it.median = medianTier(it.dist, it.placed);
    it.entropy = Math.round(entropy(it.dist, it.placed, k) * 1000) / 1000;
    const seen = it.placed + it.skipped;
    it.skip_pct = seen ? Math.round((it.skipped / seen) * 100) : 0;
    if (it.placed >= 5 && (!mostContested || it.entropy > items[mostContested].entropy)) {
      mostContested = id;
    }
  }
  return { n: nRes.rows[0].n, k, items, most_contested: mostContested };
}

async function getAggregate(templateId, k, { memberIds = null, scopeKey = 'global' } = {}) {
  const key = `${templateId}:${scopeKey}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL_MS) return hit.data;
  const data = await computeAggregate(templateId, k, memberIds);
  cache.set(key, data);
  return data;
}

// Per-user reveal stats against an aggregate. myPlacements: {itemId: tier|null}.
// Scoring lives in lib/score.js: leave-one-out (my own ranking is subtracted
// from each item's distribution before comparing) with per-item partial credit,
// so a solo ranker gets null instead of a mirror-image 100%. See issue #14.
function revealStats(myPlacements, agg) {
  return communityScore(myPlacements, agg);
}

async function myPlacements(templateId, userId, { submittedOnly = true } = {}) {
  const { rows } = await pool.query(
    `SELECT ri.item_id::text AS item_id, ri.tier
     FROM ranking_items ri JOIN rankings r ON r.id = ri.ranking_id
     WHERE r.template_id = $1 AND r.user_id = $2${submittedOnly ? " AND r.status = 'submitted'" : ''}`,
    [templateId, userId]
  );
  if (!rows.length) return null;
  const map = {};
  for (const r of rows) map[r.item_id] = r.tier;
  return map;
}

module.exports = { getAggregate, invalidate, revealStats, myPlacements, medianTier };
