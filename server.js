const express = require('express');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const { pool, migrate, bumpSequences } = require('./lib/db');
const { canonicalKey } = require('./lib/canonical');
const { getAggregate, invalidate, revealStats, myPlacements } = require('./lib/aggregate');
const { seedProduction } = require('./seeds/templates');
const { seedStaging } = require('./seeds/staging');

const app = express();
const port = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
const IS_STAGING = process.env.USERNODE_ENV === 'staging';
const LLM_ENABLED = !!process.env.USERNODE_LLM_PROXY_TOKEN;
const MODERATORS = (process.env.MODERATOR_USERNAMES || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

// Paths that stay open without authentication. Everything else requires a
// valid platform-issued JWT (deny-by-default for /api/* and non-GET).
const PUBLIC_API_PATHS = new Set(['/health']);

app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  const token = req.query.token || req.headers['x-usernode-token'];
  if (token && JWT_SECRET) {
    try { req.user = jwt.verify(token, JWT_SECRET); } catch {}
  }
  if (req.method !== 'GET' || req.path.startsWith('/api/')) {
    if (PUBLIC_API_PATHS.has(req.path)) return next();
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
});

app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/favicon.ico', (_req, res) => res.status(204).end());

// ---------- helpers ----------

function httpErr(status, message, code) {
  const e = new Error(message);
  e.status = status;
  if (code) e.code = code;
  return e;
}
const wrap = (fn) => (req, res) => fn(req, res).catch((err) => {
  if (!err.status) console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Server error', code: err.code });
});
const isMod = (user) => !!user && MODERATORS.includes(user.username);

async function isMember(groupId, userId) {
  const { rows } = await pool.query(
    'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, userId]);
  return rows.length > 0;
}

async function loadTemplate(id) {
  if (!/^\d+$/.test(String(id))) throw httpErr(404, 'Template not found');
  const { rows } = await pool.query('SELECT * FROM templates WHERE id = $1', [id]);
  if (!rows.length) throw httpErr(404, 'Template not found');
  return rows[0];
}

// Visibility: public templates to everyone; group templates to members only.
async function assertCanSee(t, user) {
  if (t.visibility === 'group') {
    if (!t.group_id || !(await isMember(t.group_id, user.id))) {
      throw httpErr(403, 'This list belongs to a private group');
    }
  }
}

async function groupMemberIds(groupId) {
  const { rows } = await pool.query(
    'SELECT user_id FROM group_members WHERE group_id = $1', [groupId]);
  return rows.map((r) => r.user_id);
}

async function activeItems(templateId, userId) {
  const { rows } = await pool.query(
    `SELECT id::text AS id, name, canonical_key, emoji, image_url, status,
            added_by_id, added_by_username, created_at
     FROM template_items
     WHERE template_id = $1 AND NOT hidden
       AND (status = 'active' OR (status = 'proposed' AND added_by_id = $2))
     ORDER BY id`,
    [templateId, userId]
  );
  return rows;
}

function validTier(tier, k) {
  return tier === null || (Number.isInteger(tier) && tier >= 1 && tier <= k);
}

// ---------- LLM proxy (platform-billed, degrades gracefully) ----------

async function llmCall(req, { model, system, prompt, maxTokens = 1500 }) {
  if (!LLM_ENABLED) throw httpErr(503, 'AI is unavailable in this environment', 'llm_unavailable');
  const resp = await fetch(`${process.env.USERNODE_LLM_PROXY_URL}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-usernode-app-token': process.env.USERNODE_LLM_PROXY_TOKEN,
      'x-usernode-user-token': req.headers['x-usernode-token'] || req.query.token || '',
    },
    body: JSON.stringify({
      model, max_tokens: maxTokens, system,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const spent = parseFloat(resp.headers.get('x-usernode-llm-spent-cents'));
  const cap = parseFloat(resp.headers.get('x-usernode-llm-cap-cents'));
  const meter = {
    spent_cents: Number.isFinite(spent) ? spent : null,
    cap_cents: Number.isFinite(cap) ? cap : null,
  };
  if (!resp.ok) {
    let body = {};
    try { body = await resp.json(); } catch {}
    throw httpErr(resp.status, (body.error && body.error.message) || 'AI request failed', body.code);
  }
  const data = await resp.json();
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  return { text, ...meter };
}

function parseJsonBlock(text, open, close) {
  const start = text.indexOf(open);
  const end = text.lastIndexOf(close);
  if (start === -1 || end === -1 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

// ---------- Home ----------

app.get('/api/home', wrap(async (req, res) => {
  const me = req.user;

  const todayQ = await pool.query(
    `SELECT d.edition_no, t.id::text AS template_id, t.title, t.tier_labels,
            (SELECT COUNT(*)::int FROM rankings r WHERE r.template_id = t.id AND r.status = 'submitted') AS n
     FROM daily_lists d JOIN templates t ON t.id = d.template_id
     WHERE d.run_date = CURRENT_DATE AND NOT t.hidden`);
  let today = todayQ.rows[0] || null;
  if (today) {
    const mine = await pool.query(
      'SELECT status FROM rankings WHERE template_id = $1 AND user_id = $2',
      [today.template_id, me.id]);
    today = { ...today, my_status: mine.rows[0] ? mine.rows[0].status : null };
  }

  const changing = (await pool.query(
    `SELECT id::text, kind, title, body FROM changelog_entries
     WHERE kind IN ('merging','proposed') ORDER BY created_at DESC LIMIT 3`)).rows;

  const inProgress = (await pool.query(
    `SELECT r.template_id::text AS template_id, t.title,
            (SELECT COUNT(*)::int FROM ranking_items ri WHERE ri.ranking_id = r.id) AS placed,
            (SELECT COUNT(*)::int FROM template_items i WHERE i.template_id = t.id AND i.status = 'active' AND NOT i.hidden) AS total
     FROM rankings r JOIN templates t ON t.id = r.template_id
     WHERE r.user_id = $1 AND r.status = 'draft' AND NOT t.hidden
     ORDER BY r.updated_at DESC LIMIT 10`, [me.id])).rows;

  const groups = (await pool.query(
    `SELECT g.id::text, g.name,
            (SELECT COUNT(*)::int FROM group_members m2 WHERE m2.group_id = g.id) AS member_count,
            (SELECT COUNT(*)::int FROM rankings r JOIN templates t ON t.id = r.template_id
              WHERE t.group_id = g.id AND t.visibility = 'group' AND r.status = 'submitted'
                AND r.submitted_at > now() - interval '7 days') AS recent
     FROM groups g JOIN group_members m ON m.group_id = g.id AND m.user_id = $1
     ORDER BY g.name`, [me.id])).rows;

  const feed = (await pool.query(
    `SELECT t.id::text, t.title, t.category, t.author_username, t.created_at, t.is_seed,
            (SELECT COUNT(*)::int FROM rankings r WHERE r.template_id = t.id AND r.status = 'submitted') AS n,
            (SELECT COUNT(*)::int FROM rankings r WHERE r.template_id = t.id AND r.status = 'submitted'
              AND r.submitted_at > now() - interval '48 hours') AS recent_n,
            (SELECT rm.status FROM rankings rm WHERE rm.template_id = t.id AND rm.user_id = $1) AS my_status
     FROM templates t
     WHERE t.visibility = 'public' AND NOT t.hidden
     ORDER BY recent_n DESC,
              GREATEST(COALESCE((SELECT MAX(r2.submitted_at) FROM rankings r2 WHERE r2.template_id = t.id), t.created_at), t.created_at) DESC
     LIMIT 30`, [me.id])).rows;

  const recentRankings = (await pool.query(
    `SELECT r.username, r.template_id::text AS template_id, t.title, r.submitted_at,
            (SELECT rm.status FROM rankings rm WHERE rm.template_id = r.template_id AND rm.user_id = $1) AS my_status
     FROM rankings r JOIN templates t ON t.id = r.template_id
     WHERE r.status = 'submitted' AND t.visibility = 'public' AND NOT t.hidden AND r.user_id <> $1
     ORDER BY r.submitted_at DESC LIMIT 8`, [me.id])).rows;

  res.json({
    me: { username: me.username, is_moderator: isMod(me) },
    env: process.env.USERNODE_ENV || 'production',
    llm_enabled: LLM_ENABLED,
    today, changing, in_progress: inProgress, groups, feed, recent_rankings: recentRankings,
  });
}));

// ---------- Templates ----------

app.get('/api/templates/:id', wrap(async (req, res) => {
  const t = await loadTemplate(req.params.id);
  await assertCanSee(t, req.user);
  if (t.hidden && !isMod(req.user)) {
    return res.json({ template: { id: String(t.id), hidden: true, title: t.title, tier_labels: t.tier_labels } });
  }
  const items = await activeItems(t.id, req.user.id);
  const agg = await getAggregate(t.id, t.tier_labels.length);
  for (const it of items) {
    const a = agg.items[it.id];
    it.placed_n = a ? a.placed : 0;
    it.is_new = !!it.added_by_id && it.placed_n < 5;
  }
  const mineQ = await pool.query(
    'SELECT id, status FROM rankings WHERE template_id = $1 AND user_id = $2', [t.id, req.user.id]);
  const mine = mineQ.rows[0] || null;
  const placements = {};
  if (mine) {
    const p = await pool.query(
      'SELECT item_id::text AS item_id, tier FROM ranking_items WHERE ranking_id = $1', [mine.id]);
    for (const r of p.rows) placements[r.item_id] = r.tier;
  }
  let proposals = [];
  if (t.author_id === req.user.id && t.item_policy === 'approved') {
    proposals = (await pool.query(
      `SELECT id::text, name, added_by_username FROM template_items
       WHERE template_id = $1 AND status = 'proposed' AND NOT hidden ORDER BY created_at`, [t.id])).rows;
  }
  const daily = (await pool.query(
    'SELECT edition_no, run_date, run_date < CURRENT_DATE AS is_final FROM daily_lists WHERE template_id = $1',
    [t.id])).rows[0] || null;
  res.json({
    template: {
      id: String(t.id), title: t.title, category: t.category,
      author_username: t.author_username, is_author: t.author_id === req.user.id,
      visibility: t.visibility, group_id: t.group_id ? String(t.group_id) : null,
      tier_labels: t.tier_labels, item_policy: t.item_policy, hidden: t.hidden,
    },
    items,
    my: { status: mine ? mine.status : null, placements },
    n: agg.n,
    unlocked: !!mine && mine.status === 'submitted',
    proposals, daily,
  });
}));

app.post('/api/templates', wrap(async (req, res) => {
  const b = req.body || {};
  const title = String(b.title || '').trim();
  if (title.length < 3 || title.length > 80) throw httpErr(400, 'Title must be 3–80 characters');
  let labels = Array.isArray(b.tier_labels) ? b.tier_labels.map((l) => String(l).trim()).filter(Boolean) : [];
  if (!labels.length) labels = ['S', 'A', 'B', 'C', 'D'];
  if (labels.length < 3 || labels.length > 6 || labels.some((l) => l.length > 12)) {
    throw httpErr(400, 'Tier scale must be 3–6 tiers, labels up to 12 characters');
  }
  const policy = ['open', 'approved', 'closed'].includes(b.item_policy) ? b.item_policy : 'open';
  const visibility = b.visibility === 'group' ? 'group' : 'public';
  let groupId = null;
  if (visibility === 'group') {
    groupId = parseInt(b.group_id, 10);
    if (!groupId || !(await isMember(groupId, req.user.id))) throw httpErr(403, 'Not a member of that group');
  }
  const rawItems = Array.isArray(b.items) ? b.items : [];
  const seen = new Set();
  const items = [];
  for (const it of rawItems) {
    const name = String((it && it.name) || '').trim();
    if (!name || name.length > 60) continue;
    const key = canonicalKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ name, key, emoji: it.emoji ? String(it.emoji).slice(0, 8) : null });
    if (items.length >= 60) break;
  }
  if (items.length < 2) throw httpErr(400, 'A template needs at least 2 items');

  const ins = await pool.query(
    `INSERT INTO templates (title, category, author_id, author_username, visibility, group_id, tier_labels, item_policy)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [title, b.category ? String(b.category).slice(0, 40) : null, req.user.id, req.user.username,
     visibility, groupId, labels, policy]);
  const tid = ins.rows[0].id;
  for (const it of items) {
    await pool.query(
      `INSERT INTO template_items (template_id, name, canonical_key, emoji)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [tid, it.name, it.key, it.emoji]);
  }
  res.json({ id: String(tid) });
}));

// Add an item. It always enters the adder's own ranking immediately (the
// client places it); whether it joins the shared set follows item_policy.
app.post('/api/templates/:id/items', wrap(async (req, res) => {
  const t = await loadTemplate(req.params.id);
  await assertCanSee(t, req.user);
  if (t.hidden) throw httpErr(403, 'This list is hidden pending review');
  const name = String((req.body || {}).name || '').trim();
  if (!name || name.length > 60) throw httpErr(400, 'Item name must be 1–60 characters');
  let imageUrl = String((req.body || {}).image_url || '').trim() || null;
  if (imageUrl && !/^https?:\/\//i.test(imageUrl)) imageUrl = null;
  const emoji = (req.body || {}).emoji ? String(req.body.emoji).slice(0, 8) : null;

  const key = await canonicalizeWithAi(req, t.id, name);
  const dup = await pool.query(
    `SELECT id::text, name, status FROM template_items
     WHERE template_id = $1 AND canonical_key = $2 AND NOT hidden`, [t.id, key]);
  if (dup.rows.length) {
    return res.json({ duplicate: true, item: dup.rows[0] });
  }
  const isAuthor = t.author_id === req.user.id;
  const status = (t.item_policy === 'open' || isAuthor) ? 'active' : 'proposed';
  const ins = await pool.query(
    `INSERT INTO template_items (template_id, name, canonical_key, emoji, image_url, status, added_by_id, added_by_username)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (template_id, canonical_key) DO NOTHING
     RETURNING id::text, name, emoji, image_url, status`,
    [t.id, name, key, emoji, imageUrl, status, req.user.id, req.user.username]);
  if (!ins.rows.length) throw httpErr(409, 'That item already exists');
  invalidate(t.id);
  res.json({ duplicate: false, item: { ...ins.rows[0], is_new: true, placed_n: 0 } });
}));

async function canonicalizeWithAi(req, templateId, name) {
  const key = canonicalKey(name);
  if (!LLM_ENABLED) return key;
  try {
    const existing = await pool.query(
      'SELECT name, canonical_key FROM template_items WHERE template_id = $1 AND NOT hidden LIMIT 100',
      [templateId]);
    if (!existing.rows.length) return key;
    if (existing.rows.some((r) => r.canonical_key === key)) return key; // heuristic already matches
    const { text } = await llmCall(req, {
      model: 'claude-haiku-4-5-20251001',
      maxTokens: 150,
      system: 'You deduplicate tier-list items. Reply ONLY with JSON.',
      prompt: `New item: ${JSON.stringify(name)}\nExisting items: ${JSON.stringify(existing.rows.map((r) => r.name))}\nIf the new item refers to the same thing as an existing item (spelling/branding variants count), reply {"duplicate_of": "<exact existing name>"}. Otherwise reply {"duplicate_of": null}.`,
    });
    const parsed = parseJsonBlock(text, '{', '}');
    if (parsed && parsed.duplicate_of) {
      const match = existing.rows.find((r) => r.name === parsed.duplicate_of);
      if (match) return match.canonical_key;
    }
  } catch {
    // AI canonicalization degrades to the heuristic, never blocks the add.
  }
  return key;
}

app.post('/api/templates/:id/items/:itemId/decide', wrap(async (req, res) => {
  const t = await loadTemplate(req.params.id);
  if (t.author_id !== req.user.id) throw httpErr(403, 'Only the author reviews proposals');
  const approve = !!(req.body || {}).approve;
  const upd = await pool.query(
    `UPDATE template_items SET status = $1
     WHERE id = $2 AND template_id = $3 AND status = 'proposed'
     RETURNING id::text, name, status`,
    [approve ? 'active' : 'rejected', req.params.itemId, t.id]);
  if (!upd.rows.length) throw httpErr(404, 'Proposal not found');
  invalidate(t.id);
  res.json({ item: upd.rows[0] });
}));

// ---------- Rankings ----------

app.put('/api/templates/:id/ranking', wrap(async (req, res) => {
  const t = await loadTemplate(req.params.id);
  await assertCanSee(t, req.user);
  if (t.hidden) throw httpErr(403, 'This list is hidden pending review');
  const k = t.tier_labels.length;
  const submit = req.query.submit === '1' || !!(req.body || {}).submit;

  const items = await activeItems(t.id, req.user.id);
  const itemIds = new Set(items.map((i) => i.id));
  const raw = Array.isArray((req.body || {}).placements) ? req.body.placements : [];
  const placements = new Map();
  for (const p of raw) {
    if (!p) continue;
    const id = String(p.item_id || '');
    const tier = p.tier === null ? null : Number(p.tier);
    if (!itemIds.has(id)) continue;
    if (!validTier(tier, k)) throw httpErr(400, 'Invalid tier value');
    placements.set(id, tier);
  }

  if (submit) {
    const rankedCount = [...placements.values()].filter((tier) => tier != null).length;
    if (rankedCount === 0) {
      throw httpErr(400, 'Rank at least one item first', 'no_placements');
    }
  }

  const up = await pool.query(
    `INSERT INTO rankings (template_id, user_id, username)
     VALUES ($1, $2, $3)
     ON CONFLICT (template_id, user_id)
     DO UPDATE SET updated_at = now(), username = EXCLUDED.username
     RETURNING id, status, submitted_at`,
    [t.id, req.user.id, req.user.username]);
  const ranking = up.rows[0];

  // Any save that ends submitted records unplaced active items as explicit
  // skips (tier NULL) — keeps one row per active item so skip-% denominators
  // stay honest. Draft saves stay sparse so the tray remains meaningful.
  if (submit || ranking.status === 'submitted') {
    for (const it of items) {
      if (it.status === 'active' && !placements.has(it.id)) placements.set(it.id, null);
    }
  }

  await pool.query('DELETE FROM ranking_items WHERE ranking_id = $1', [ranking.id]);
  if (placements.size) {
    const values = [];
    const params = [ranking.id];
    let i = 2;
    for (const [itemId, tier] of placements) {
      values.push(`($1, $${i}, $${i + 1})`);
      params.push(itemId, tier);
      i += 2;
    }
    await pool.query(
      `INSERT INTO ranking_items (ranking_id, item_id, tier) VALUES ${values.join(',')}`, params);
  }

  let status = ranking.status;
  const firstSubmit = submit && ranking.status !== 'submitted';
  if (submit) {
    await pool.query(
      `UPDATE rankings SET status = 'submitted', submitted_at = COALESCE(submitted_at, now()), updated_at = now()
       WHERE id = $1`, [ranking.id]);
    status = 'submitted';
  }
  invalidate(t.id);

  // Integrity v1: rate-anomaly flag, reviewed manually — median + the
  // always-visible distribution are the structural defense (SPEC.md §11).
  if (firstSubmit) {
    const hour = await pool.query(
      `SELECT COUNT(*)::int AS c FROM rankings
       WHERE template_id = $1 AND status = 'submitted' AND submitted_at > now() - interval '1 hour'`, [t.id]);
    const week = await pool.query(
      `SELECT COUNT(*)::int AS c FROM rankings
       WHERE template_id = $1 AND status = 'submitted' AND submitted_at > now() - interval '7 days'`, [t.id]);
    const hourly = hour.rows[0].c;
    const avg = week.rows[0].c / 168;
    if (hourly > Math.max(20, 5 * avg)) {
      await pool.query(
        `INSERT INTO mod_flags (kind, template_id, detail)
         SELECT 'rate_anomaly', $1, $2::jsonb
         WHERE NOT EXISTS (
           SELECT 1 FROM mod_flags WHERE kind = 'rate_anomaly' AND template_id = $1
             AND created_at::date = CURRENT_DATE)`,
        [t.id, JSON.stringify({ submissions_last_hour: hourly })]);
    }
  }

  res.json({ status, submitted: status === 'submitted' });
}));

// ---------- Aggregate / reveal ----------

app.get('/api/templates/:id/aggregate', wrap(async (req, res) => {
  const t = await loadTemplate(req.params.id);
  await assertCanSee(t, req.user);
  if (t.hidden && !isMod(req.user)) throw httpErr(403, 'This list is hidden pending review');
  const k = t.tier_labels.length;

  let memberIds = null;
  let scopeKey = 'global';
  const groupParam = req.query.group ? parseInt(req.query.group, 10) : null;
  if (groupParam) {
    if (!(await isMember(groupParam, req.user.id))) throw httpErr(403, 'Not a member of that group');
    memberIds = await groupMemberIds(groupParam);
    scopeKey = 'group:' + groupParam;
  }
  const agg = await getAggregate(t.id, k, { memberIds, scopeKey });

  const commentCounts = {};
  for (const row of (await pool.query(
    `SELECT item_id::text AS item_id, COUNT(*)::int AS c FROM comments
     WHERE template_id = $1 AND item_id IS NOT NULL AND NOT hidden GROUP BY item_id`, [t.id])).rows) {
    commentCounts[row.item_id] = row.c;
  }
  const totalComments = (await pool.query(
    'SELECT COUNT(*)::int AS c FROM comments WHERE template_id = $1 AND NOT hidden', [t.id])).rows[0].c;

  let my = null;
  if (!groupParam) {
    const mine = await myPlacements(t.id, req.user.id);
    if (mine) {
      my = { placements: mine, stats: revealStats(mine, agg) };
    }
  }

  const rankers = (await pool.query(
    `SELECT username FROM rankings
     WHERE template_id = $1 AND status = 'submitted' AND user_id <> $2
     ORDER BY submitted_at DESC LIMIT 25`, [t.id, req.user.id])).rows.map((r) => r.username);

  res.json({
    n: agg.n, k, items: agg.items, most_contested: agg.most_contested,
    comment_counts: commentCounts, total_comments: totalComments,
    my, rankers,
  });
}));

app.get('/api/templates/:id/compare/:username', wrap(async (req, res) => {
  const t = await loadTemplate(req.params.id);
  await assertCanSee(t, req.user);
  const k = t.tier_labels.length;
  const theirName = req.params.username;
  if (theirName === req.user.username) throw httpErr(400, 'That is you');

  const mine = await myPlacements(t.id, req.user.id);
  if (!mine) throw httpErr(404, 'Submit your own ranking first', 'not_ranked');
  const theirs = (await pool.query(
    `SELECT ri.item_id::text AS item_id, ri.tier
     FROM ranking_items ri JOIN rankings r ON r.id = ri.ranking_id
     WHERE r.template_id = $1 AND r.username = $2 AND r.status = 'submitted'`,
    [t.id, theirName])).rows;
  if (!theirs.length) throw httpErr(404, `${theirName} hasn't ranked this yet`, 'not_ranked');
  const theirMap = {};
  for (const r of theirs) theirMap[r.item_id] = r.tier;

  const names = {};
  for (const it of await activeItems(t.id, req.user.id)) names[it.id] = it.name;

  const rows = [];
  let sum = 0, count = 0;
  for (const [itemId, mineT] of Object.entries(mine)) {
    const theirT = theirMap[itemId];
    if (mineT == null || theirT == null || !names[itemId]) continue;
    const d = Math.abs(mineT - theirT);
    rows.push({ item_id: itemId, name: names[itemId], mine: mineT, theirs: theirT, distance: d });
    sum += d;
    count++;
  }
  rows.sort((a, b) => b.distance - a.distance);
  const alignment = count
    ? Math.max(0, Math.min(100, Math.round(100 - (sum / count) * (100 / k)))) : null;
  res.json({
    username: theirName, tier_labels: t.tier_labels, title: t.title,
    alignment, shared: count, items: rows,
  });
}));

// ---------- AI ----------

app.post('/api/ai/items', wrap(async (req, res) => {
  const title = String((req.body || {}).title || '').trim();
  if (!title) throw httpErr(400, 'Give the template a title first');
  const { text, spent_cents, cap_cents } = await llmCall(req, {
    model: 'claude-sonnet-5',
    maxTokens: 2000,
    system: 'You propose item sets for community tier-list templates. Reply ONLY with a JSON array.',
    prompt: `Template title: ${JSON.stringify(title)}${(req.body || {}).category ? `\nCategory: ${req.body.category}` : ''}\nPropose 15-25 well-known, rankable items for this tier list. Reply ONLY with a JSON array of objects like {"name": "Item name", "emoji": "🍕"} — emoji optional (null if none fits). No prose, no markdown.`,
  });
  const parsed = parseJsonBlock(text, '[', ']');
  if (!Array.isArray(parsed)) throw httpErr(502, 'AI returned an unexpected format — try again or add items manually');
  const seen = new Set();
  const items = [];
  for (const it of parsed) {
    const name = String((it && it.name) || '').trim();
    if (!name || name.length > 60) continue;
    const key = canonicalKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ name, emoji: it && it.emoji ? String(it.emoji).slice(0, 8) : null });
    if (items.length >= 25) break;
  }
  if (items.length < 2) throw httpErr(502, 'AI returned too few items — try again or add items manually');
  res.json({ items, spent_cents, cap_cents });
}));

app.post('/api/ai/canonicalize', wrap(async (req, res) => {
  const name = String((req.body || {}).name || '').trim();
  if (!name) throw httpErr(400, 'Missing name');
  const templateId = parseInt((req.body || {}).template_id, 10);
  const key = templateId ? await canonicalizeWithAi(req, templateId, name) : canonicalKey(name);
  let duplicate = null;
  if (templateId) {
    const dup = await pool.query(
      `SELECT id::text, name FROM template_items
       WHERE template_id = $1 AND canonical_key = $2 AND NOT hidden`, [templateId, key]);
    duplicate = dup.rows[0] || null;
  }
  res.json({ canonical_key: key, duplicate });
}));

// ---------- Comments ----------

// Live comment streams: template id -> Set of open SSE responses. In-memory
// is correct here — each app runs as a single container/process.
const commentStreams = new Map();
setInterval(() => {
  for (const [key, set] of commentStreams) {
    for (const res of set) {
      try { res.write(': ka\n\n'); } catch { set.delete(res); }
    }
    if (!set.size) commentStreams.delete(key);
  }
}, 25000).unref();

function broadcastComment(templateId, comment) {
  const set = commentStreams.get(String(templateId));
  if (!set) return;
  const payload = `event: comment\ndata: ${JSON.stringify(comment)}\n\n`;
  for (const res of set) {
    try { res.write(payload); } catch { set.delete(res); }
  }
}

app.get('/api/templates/:id/comments/stream', wrap(async (req, res) => {
  const t = await loadTemplate(req.params.id);
  await assertCanSee(t, req.user);
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write(': connected\n\n');
  const key = String(t.id);
  let set = commentStreams.get(key);
  if (!set) commentStreams.set(key, (set = new Set()));
  set.add(res);
  req.on('close', () => {
    set.delete(res);
    if (!set.size) commentStreams.delete(key);
  });
}));

app.get('/api/templates/:id/comments', wrap(async (req, res) => {
  const t = await loadTemplate(req.params.id);
  await assertCanSee(t, req.user);
  const comments = (await pool.query(
    `SELECT c.id::text, c.item_id::text AS item_id, c.username, c.body, c.created_at, i.name AS item_name
     FROM comments c LEFT JOIN template_items i ON i.id = c.item_id
     WHERE c.template_id = $1 AND NOT c.hidden
     ORDER BY c.created_at DESC, c.id DESC LIMIT 200`, [t.id])).rows;
  const ids = comments.map((c) => c.id);
  const reactions = {};
  if (ids.length) {
    for (const row of (await pool.query(
      `SELECT comment_id::text AS comment_id, emoji, COUNT(*)::int AS c, BOOL_OR(user_id = $2) AS mine
       FROM comment_reactions WHERE comment_id = ANY($1::bigint[]) GROUP BY comment_id, emoji`,
      [ids, req.user.id])).rows) {
      (reactions[row.comment_id] = reactions[row.comment_id] || []).push(
        { emoji: row.emoji, count: row.c, mine: row.mine });
    }
  }
  for (const c of comments) c.reactions = reactions[c.id] || [];
  res.json({ comments });
}));

app.post('/api/templates/:id/comments', wrap(async (req, res) => {
  const t = await loadTemplate(req.params.id);
  await assertCanSee(t, req.user);
  if (t.hidden) throw httpErr(403, 'This list is hidden pending review');
  const body = String((req.body || {}).body || '').trim();
  if (!body || body.length > 2000) throw httpErr(400, 'Comment must be 1–2000 characters');
  let itemId = (req.body || {}).item_id ? String(req.body.item_id) : null;
  if (itemId) {
    const chk = await pool.query(
      'SELECT 1 FROM template_items WHERE id = $1 AND template_id = $2', [itemId, t.id]);
    if (!chk.rows.length) itemId = null;
  }
  const ins = await pool.query(
    `INSERT INTO comments (template_id, item_id, user_id, username, body)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id::text, item_id::text AS item_id, username, body, created_at`,
    [t.id, itemId, req.user.id, req.user.username, body]);
  let itemName = null;
  if (itemId) {
    const named = await pool.query('SELECT name FROM template_items WHERE id = $1', [itemId]);
    itemName = named.rows.length ? named.rows[0].name : null;
  }
  const comment = { ...ins.rows[0], item_name: itemName, reactions: [] };
  broadcastComment(t.id, comment);
  res.json({ comment });
}));

app.post('/api/comments/:id/react', wrap(async (req, res) => {
  const emoji = String((req.body || {}).emoji || '').slice(0, 8);
  if (!emoji) throw httpErr(400, 'Missing emoji');
  const c = await pool.query('SELECT template_id FROM comments WHERE id = $1 AND NOT hidden', [req.params.id]);
  if (!c.rows.length) throw httpErr(404, 'Comment not found');
  const t = await loadTemplate(c.rows[0].template_id);
  await assertCanSee(t, req.user);
  const ins = await pool.query(
    `INSERT INTO comment_reactions (comment_id, user_id, emoji) VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING RETURNING 1`, [req.params.id, req.user.id, emoji]);
  if (!ins.rows.length) {
    await pool.query(
      'DELETE FROM comment_reactions WHERE comment_id = $1 AND user_id = $2 AND emoji = $3',
      [req.params.id, req.user.id, emoji]);
  }
  res.json({ on: !!ins.rows.length });
}));

// ---------- Reports & moderation ----------

const HIDE_THRESHOLD = 3;
const REPORT_TABLES = { template: 'templates', item: 'template_items', comment: 'comments' };

app.post('/api/report', wrap(async (req, res) => {
  const type = (req.body || {}).content_type;
  const table = REPORT_TABLES[type];
  const contentId = parseInt((req.body || {}).content_id, 10);
  if (!table || !contentId) throw httpErr(400, 'Invalid report');
  const exists = await pool.query(`SELECT 1 FROM ${table} WHERE id = $1`, [contentId]);
  if (!exists.rows.length) throw httpErr(404, 'Content not found');
  const reason = (req.body || {}).reason ? String(req.body.reason).slice(0, 300) : null;
  await pool.query(
    `INSERT INTO reports (content_type, content_id, reporter_id, reporter_username, reason)
     VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
    [type, contentId, req.user.id, req.user.username, reason]);
  const cnt = await pool.query(
    `SELECT COUNT(DISTINCT reporter_id)::int AS c FROM reports
     WHERE content_type = $1 AND content_id = $2 AND status = 'open'`, [type, contentId]);
  let hidden = false;
  if (cnt.rows[0].c >= HIDE_THRESHOLD) {
    await pool.query(`UPDATE ${table} SET hidden = true WHERE id = $1`, [contentId]);
    hidden = true;
    if (type === 'template') invalidate(contentId);
  }
  res.json({ ok: true, hidden });
}));

function requireMod(req) {
  if (!isMod(req.user)) throw httpErr(403, 'Moderators only', 'not_moderator');
}

app.get('/api/mod/queue', wrap(async (req, res) => {
  requireMod(req);
  const grouped = (await pool.query(
    `SELECT content_type, content_id::text, COUNT(*)::int AS report_count,
            ARRAY_AGG(DISTINCT reporter_username) AS reporters,
            ARRAY_REMOVE(ARRAY_AGG(DISTINCT reason), NULL) AS reasons,
            MAX(created_at) AS last_at
     FROM reports WHERE status = 'open'
     GROUP BY content_type, content_id ORDER BY last_at DESC LIMIT 100`)).rows;
  for (const g of grouped) {
    let preview = null, hidden = false, templateId = null;
    if (g.content_type === 'template') {
      const r = await pool.query('SELECT title, hidden FROM templates WHERE id = $1', [g.content_id]);
      if (r.rows[0]) { preview = r.rows[0].title; hidden = r.rows[0].hidden; templateId = g.content_id; }
    } else if (g.content_type === 'item') {
      const r = await pool.query(
        'SELECT name, hidden, template_id::text AS tid FROM template_items WHERE id = $1', [g.content_id]);
      if (r.rows[0]) { preview = r.rows[0].name; hidden = r.rows[0].hidden; templateId = r.rows[0].tid; }
    } else {
      const r = await pool.query(
        'SELECT body, hidden, template_id::text AS tid FROM comments WHERE id = $1', [g.content_id]);
      if (r.rows[0]) { preview = r.rows[0].body.slice(0, 140); hidden = r.rows[0].hidden; templateId = r.rows[0].tid; }
    }
    g.preview = preview;
    g.hidden = hidden;
    g.template_id = templateId;
  }
  const flags = (await pool.query(
    `SELECT f.id::text, f.kind, f.template_id::text AS template_id, f.detail, f.created_at, t.title
     FROM mod_flags f LEFT JOIN templates t ON t.id = f.template_id
     WHERE f.status = 'open' ORDER BY f.created_at DESC LIMIT 50`)).rows;
  const stats = (await pool.query(
    `SELECT (SELECT COUNT(*)::int FROM reports WHERE created_at > now() - interval '24 hours') AS reports_24h,
            (SELECT COUNT(*)::int FROM rankings WHERE status = 'submitted') AS total_rankings`)).rows[0];
  res.json({ queue: grouped, flags, stats });
}));

app.post('/api/mod/resolve', wrap(async (req, res) => {
  requireMod(req);
  const type = (req.body || {}).content_type;
  const table = REPORT_TABLES[type];
  const contentId = parseInt((req.body || {}).content_id, 10);
  const action = (req.body || {}).action;
  if (!table || !contentId || !['restore', 'remove', 'dismiss'].includes(action)) {
    throw httpErr(400, 'Invalid resolve action');
  }
  if (action === 'restore') {
    await pool.query(`UPDATE ${table} SET hidden = false WHERE id = $1`, [contentId]);
    await pool.query(
      `UPDATE reports SET status = 'dismissed' WHERE content_type = $1 AND content_id = $2 AND status = 'open'`,
      [type, contentId]);
  } else if (action === 'remove') {
    await pool.query(`UPDATE ${table} SET hidden = true WHERE id = $1`, [contentId]);
    await pool.query(
      `UPDATE reports SET status = 'resolved' WHERE content_type = $1 AND content_id = $2 AND status = 'open'`,
      [type, contentId]);
  } else {
    await pool.query(
      `UPDATE reports SET status = 'dismissed' WHERE content_type = $1 AND content_id = $2 AND status = 'open'`,
      [type, contentId]);
  }
  if (type === 'template') invalidate(contentId);
  res.json({ ok: true });
}));

app.post('/api/mod/flags/:id/resolve', wrap(async (req, res) => {
  requireMod(req);
  await pool.query(`UPDATE mod_flags SET status = 'resolved' WHERE id = $1`, [req.params.id]);
  res.json({ ok: true });
}));

// What's-changing entries are team-curated at v1 (no platform proposal-feed
// API exists yet — escalated as a platform capability request).
app.post('/api/mod/changelog', wrap(async (req, res) => {
  requireMod(req);
  const kind = ['shipped', 'merging', 'proposed'].includes((req.body || {}).kind) ? req.body.kind : 'shipped';
  const title = String((req.body || {}).title || '').trim();
  if (!title || title.length > 120) throw httpErr(400, 'Title must be 1–120 characters');
  const ins = await pool.query(
    `INSERT INTO changelog_entries (kind, title, body) VALUES ($1, $2, $3) RETURNING id::text`,
    [kind, title, (req.body || {}).body ? String(req.body.body).slice(0, 500) : null]);
  res.json({ id: ins.rows[0].id });
}));

// ---------- Groups ----------

app.post('/api/groups', wrap(async (req, res) => {
  const name = String((req.body || {}).name || '').trim();
  if (name.length < 2 || name.length > 40) throw httpErr(400, 'Group name must be 2–40 characters');
  const code = crypto.randomBytes(6).toString('hex');
  const ins = await pool.query(
    `INSERT INTO groups (name, created_by_id, created_by_username, invite_code)
     VALUES ($1, $2, $3, $4) RETURNING id::text, invite_code`,
    [name, req.user.id, req.user.username, code]);
  await pool.query(
    'INSERT INTO group_members (group_id, user_id, username) VALUES ($1, $2, $3)',
    [ins.rows[0].id, req.user.id, req.user.username]);
  res.json({ id: ins.rows[0].id, invite_code: ins.rows[0].invite_code });
}));

app.post('/api/groups/join/:code', wrap(async (req, res) => {
  const g = await pool.query('SELECT id::text, name FROM groups WHERE invite_code = $1', [req.params.code]);
  if (!g.rows.length) throw httpErr(404, 'Invite link is invalid or expired');
  await pool.query(
    `INSERT INTO group_members (group_id, user_id, username) VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [g.rows[0].id, req.user.id, req.user.username]);
  res.json({ id: g.rows[0].id, name: g.rows[0].name });
}));

app.get('/api/groups/:id', wrap(async (req, res) => {
  const gid = parseInt(req.params.id, 10);
  if (!gid || !(await isMember(gid, req.user.id))) throw httpErr(403, 'Not a member of this group');
  const g = (await pool.query(
    'SELECT id::text, name, invite_code, created_by_username FROM groups WHERE id = $1', [gid])).rows[0];
  if (!g) throw httpErr(404, 'Group not found');
  const members = (await pool.query(
    'SELECT username FROM group_members WHERE group_id = $1 ORDER BY joined_at', [gid])).rows.map((r) => r.username);
  const templates = (await pool.query(
    `SELECT t.id::text, t.title, t.tier_labels,
            (SELECT COUNT(*)::int FROM rankings r WHERE r.template_id = t.id AND r.status = 'submitted') AS n,
            EXISTS(SELECT 1 FROM rankings r WHERE r.template_id = t.id AND r.user_id = $2 AND r.status = 'submitted') AS mine_in
     FROM templates t WHERE t.group_id = $1 AND t.visibility = 'group' AND NOT t.hidden
     ORDER BY t.created_at DESC LIMIT 20`, [gid, req.user.id])).rows;

  // Biggest split per template: the item with the widest member tier range.
  for (const t of templates.slice(0, 10)) {
    const rows = (await pool.query(
      `SELECT r.username, ri.tier, i.name
       FROM rankings r
       JOIN ranking_items ri ON ri.ranking_id = r.id
       JOIN template_items i ON i.id = ri.item_id
       WHERE r.template_id = $1 AND r.status = 'submitted' AND ri.tier IS NOT NULL`, [t.id])).rows;
    const byItem = {};
    for (const r of rows) (byItem[r.name] = byItem[r.name] || []).push(r);
    let best = null;
    for (const [name, list] of Object.entries(byItem)) {
      if (list.length < 2) continue;
      let lo = list[0], hi = list[0];
      for (const e of list) {
        if (e.tier < lo.tier) lo = e;
        if (e.tier > hi.tier) hi = e;
      }
      const range = hi.tier - lo.tier;
      if (range > 0 && (!best || range > best.range)) best = { name, range, top: lo, bottom: hi };
    }
    if (best) {
      t.biggest_split = {
        item: best.name,
        top_user: best.top.username, top_tier: best.top.tier,
        bottom_user: best.bottom.username, bottom_tier: best.bottom.tier,
      };
    }
  }
  res.json({ group: g, members, templates });
}));

// ---------- Profile ----------

app.get('/api/me', wrap(async (req, res) => {
  const me = req.user;
  const rankedCount = (await pool.query(
    `SELECT COUNT(*)::int AS c FROM rankings WHERE user_id = $1 AND status = 'submitted'`, [me.id])).rows[0].c;

  // Streak: consecutive daily editions (ending today or yesterday) where a
  // submitted ranking landed on the edition's own day.
  const dailies = (await pool.query(
    `SELECT d.run_date, d.template_id,
            EXISTS(SELECT 1 FROM rankings r WHERE r.template_id = d.template_id
                   AND r.user_id = $1 AND r.status = 'submitted'
                   AND r.submitted_at::date = d.run_date) AS ranked_on_day
     FROM daily_lists d WHERE d.run_date <= CURRENT_DATE
     ORDER BY d.run_date DESC LIMIT 60`, [me.id])).rows;
  let streak = 0;
  for (let i = 0; i < dailies.length; i++) {
    if (dailies[i].ranked_on_day) streak++;
    else if (i === 0) continue; // today not (yet) ranked doesn't break the streak
    else break;
  }

  // Avg alignment + all-time hottest take over the 20 most recent rankings.
  const recent = (await pool.query(
    `SELECT r.template_id::text AS template_id, t.title, t.tier_labels
     FROM rankings r JOIN templates t ON t.id = r.template_id
     WHERE r.user_id = $1 AND r.status = 'submitted' AND NOT t.hidden
     ORDER BY r.submitted_at DESC LIMIT 20`, [me.id])).rows;
  let sum = 0, cnt = 0, hottest = null;
  for (const r of recent) {
    const agg = await getAggregate(r.template_id, r.tier_labels.length);
    if (agg.n < 2) continue; // a solo ranking aligns 100% with itself — skip
    const mine = await myPlacements(r.template_id, me.id);
    if (!mine) continue;
    const stats = revealStats(mine, agg);
    if (!stats) continue;
    sum += stats.alignment;
    cnt++;
    if (stats.hottest && stats.hottest.distance > 0 &&
        (!hottest || stats.hottest.distance > hottest.distance)) {
      const nameQ = await pool.query('SELECT name FROM template_items WHERE id = $1', [stats.hottest.item_id]);
      hottest = {
        ...stats.hottest,
        template_id: r.template_id, template_title: r.title, tier_labels: r.tier_labels,
        item_name: nameQ.rows[0] ? nameQ.rows[0].name : null,
      };
    }
  }

  const myTemplates = (await pool.query(
    `SELECT t.id::text, t.title, t.visibility, t.hidden,
            (SELECT COUNT(*)::int FROM rankings r WHERE r.template_id = t.id AND r.status = 'submitted') AS n
     FROM templates t WHERE t.author_id = $1 ORDER BY t.created_at DESC LIMIT 20`, [me.id])).rows;

  const shipped = (await pool.query(
    `SELECT kind, title, body, created_at FROM changelog_entries
     WHERE kind = 'shipped' ORDER BY created_at DESC LIMIT 5`)).rows;

  res.json({
    username: me.username, is_moderator: isMod(me),
    streak, ranked_count: rankedCount,
    avg_alignment: cnt ? Math.round(sum / cnt) : null,
    hottest, my_templates: myTemplates, shipped,
  });
}));

// ---------- static + shell ----------

app.use(express.static(path.join(__dirname, 'public')));

// HTML shell: serve the app if authenticated; send unauthenticated document
// visits (share links) to the platform's chromeless view of this app.
app.get('*', (req, res) => {
  if (!req.user) {
    if (req.get('sec-fetch-dest') === 'document') {
      return res.redirect(302, 'https://social-vibecoding.usernodelabs.org/#app/community-tier-lists-57ce6a/full');
    }
    return res.status(401).send(`<!doctype html><meta charset=utf-8><title>Open in Usernode</title>
<body style="font-family:system-ui;background:#FAF6EE;color:#1F2B47;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
  <div style="max-width:24rem;padding:2rem;text-align:center">
    <h1 style="font-size:1.25rem;margin:0 0 0.5rem">Open this app inside Usernode</h1>
    <p style="color:#5A6378;font-size:0.9rem;margin:0 0 1.25rem">This page is served via the platform; direct visits aren't authenticated.</p>
    <a href="https://social-vibecoding.usernodelabs.org/#app/community-tier-lists-57ce6a/full" style="display:inline-block;padding:0.5rem 1rem;background:#7c3aed;color:white;border-radius:0.5rem;text-decoration:none;font-size:0.9rem">Open in Usernode</a>
  </div>
</body>`);
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function start() {
  await migrate();
  await seedProduction(pool);
  if (IS_STAGING) await seedStaging(pool);
  await bumpSequences();
  app.listen(port, () => console.log(`Listening on :${port}`));
}

start().catch((err) => { console.error(err); process.exit(1); });
