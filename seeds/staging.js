// Staging-only demo data (never runs in production — caller gates on
// USERNODE_ENV). All ids sit at 900001+ so they can't collide with
// production seeds (<13000) or the sequence floor (1000); sequences are
// bumped past the max after seeding. Rows are obviously fake
// ("Staging demo …", staging-demo-user-N) per the platform convention.

const DEMO_USERS = [1, 2, 3, 4, 5].map((n) => ({ id: 900000 + n, username: `staging-demo-user-${n}` }));

// item id -> per-user tiers (index = demo user 1..5; null = explicit skip;
// undefined = user never saw the item). Spread chosen so median, entropy,
// skip-% and "most contested" all render non-trivially.
const BREAKFAST_ITEMS = [
  { id: 900101, name: 'Pancakes', emoji: '🥞', tiers: [1, 1, 1, 2, 1] },
  { id: 900102, name: 'Waffles', emoji: '🧇', tiers: [1, 2, 2, 2, 3] },
  { id: 900103, name: 'Croissant', emoji: '🥐', tiers: [2, 1, 3, 2, 2] },
  { id: 900104, name: 'Bacon and eggs', emoji: '🍳', tiers: [1, 2, 1, 3, 2] },
  { id: 900105, name: 'Oatmeal', emoji: '🥣', tiers: [4, 5, 3, 4, null] },
  { id: 900106, name: 'Smoothie bowl', emoji: '🍓', tiers: [5, 1, 2, 5, 3] },
  { id: 900107, name: 'Bagel', emoji: '🥯', tiers: [3, 3, 2, 4, 3] },
  { id: 900108, name: 'Full English', emoji: '🍽️', tiers: [1, null, null, 2, null] },
];

async function seedStaging(pool) {
  const u = DEMO_USERS;

  // --- Demo template 1: fully ranked (drives /t/900001 and its results) ---
  await pool.query(
    `INSERT INTO templates (id, title, category, author_id, author_username, visibility, item_policy)
     VALUES (900001, 'Staging demo: breakfast foods', 'Food', $1, $2, 'public', 'open')
     ON CONFLICT (id) DO NOTHING`,
    [u[0].id, u[0].username]
  );
  for (const it of BREAKFAST_ITEMS) {
    await pool.query(
      `INSERT INTO template_items (id, template_id, name, canonical_key, emoji)
       VALUES ($1, 900001, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
      [it.id, it.name, it.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), it.emoji]
    );
  }
  for (let i = 0; i < u.length; i++) {
    const rankingId = 900001 + i;
    await pool.query(
      `INSERT INTO rankings (id, template_id, user_id, username, status, submitted_at, updated_at)
       VALUES ($1, 900001, $2, $3, 'submitted', now() - ($4 || ' hours')::interval, now())
       ON CONFLICT (id) DO NOTHING`,
      [rankingId, u[i].id, u[i].username, String(2 + i * 5)]
    );
    for (const it of BREAKFAST_ITEMS) {
      if (it.tiers[i] === undefined) continue;
      await pool.query(
        `INSERT INTO ranking_items (ranking_id, item_id, tier) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [rankingId, it.id, it.tiers[i]]
      );
    }
  }

  // --- Demo template 2: barely ranked (low-n / NEW badges visible) ---
  await pool.query(
    `INSERT INTO templates (id, title, category, author_id, author_username, visibility, item_policy)
     VALUES (900002, 'Staging demo: sandwich fillings', 'Food', $1, $2, 'public', 'approved')
     ON CONFLICT (id) DO NOTHING`,
    [u[1].id, u[1].username]
  );
  const sandwiches = ['Grilled cheese', 'BLT', 'Tuna melt', 'Falafel', 'Pastrami', 'Egg salad'];
  for (let i = 0; i < sandwiches.length; i++) {
    await pool.query(
      `INSERT INTO template_items (id, template_id, name, canonical_key)
       VALUES ($1, 900002, $2, $3) ON CONFLICT (id) DO NOTHING`,
      [900201 + i, sandwiches[i], sandwiches[i].toLowerCase().replace(/[^a-z0-9]+/g, '-')]
    );
  }
  await pool.query(
    `INSERT INTO rankings (id, template_id, user_id, username, status, submitted_at)
     VALUES (900006, 900002, $1, $2, 'submitted', now() - interval '1 day')
     ON CONFLICT (id) DO NOTHING`,
    [u[0].id, u[0].username]
  );
  for (let i = 0; i < sandwiches.length; i++) {
    await pool.query(
      `INSERT INTO ranking_items (ranking_id, item_id, tier) VALUES (900006, $1, $2)
       ON CONFLICT DO NOTHING`,
      [900201 + i, (i % 5) + 1]
    );
  }

  // --- Demo group + group-scoped template ---
  await pool.query(
    `INSERT INTO groups (id, name, created_by_id, created_by_username, invite_code)
     VALUES (900001, 'Staging demo crew', $1, $2, 'staging-demo-code')
     ON CONFLICT (id) DO NOTHING`,
    [u[0].id, u[0].username]
  );
  for (const m of u.slice(0, 3)) {
    await pool.query(
      `INSERT INTO group_members (group_id, user_id, username) VALUES (900001, $1, $2)
       ON CONFLICT DO NOTHING`,
      [m.id, m.username]
    );
  }
  await pool.query(
    `INSERT INTO templates (id, title, category, author_id, author_username, visibility, group_id, item_policy)
     VALUES (900003, 'Staging demo: lunch spots', 'Local', $1, $2, 'group', 900001, 'open')
     ON CONFLICT (id) DO NOTHING`,
    [u[0].id, u[0].username]
  );
  const spots = ['Corner deli', 'Noodle bar', 'Falafel cart', 'Salad place', 'Taqueria'];
  for (let i = 0; i < spots.length; i++) {
    await pool.query(
      `INSERT INTO template_items (id, template_id, name, canonical_key)
       VALUES ($1, 900003, $2, $3) ON CONFLICT (id) DO NOTHING`,
      [900301 + i, spots[i], spots[i].toLowerCase().replace(/[^a-z0-9]+/g, '-')]
    );
  }
  const groupTiers = [[1, 2, 1, 3, 2], [3, 1, 1, 4, 2]];
  for (let r = 0; r < 2; r++) {
    await pool.query(
      `INSERT INTO rankings (id, template_id, user_id, username, status, submitted_at)
       VALUES ($1, 900003, $2, $3, 'submitted', now() - interval '5 hours')
       ON CONFLICT (id) DO NOTHING`,
      [900007 + r, u[r].id, u[r].username]
    );
    for (let i = 0; i < spots.length; i++) {
      await pool.query(
        `INSERT INTO ranking_items (ranking_id, item_id, tier) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [900007 + r, 900301 + i, groupTiers[r][i]]
      );
    }
  }

  // --- Comments (template-level and item-anchored, so the inline thread
  // on /t/900001/results has a few rows) ---
  await pool.query(
    `INSERT INTO comments (id, template_id, item_id, user_id, username, body)
     VALUES (900001, 900001, NULL, $1, $2, 'Staging demo comment — pancakes are clearly S tier.')
     ON CONFLICT (id) DO NOTHING`,
    [u[1].id, u[1].username]
  );
  await pool.query(
    `INSERT INTO comments (id, template_id, item_id, user_id, username, body)
     VALUES (900002, 900001, 900106, $1, $2, 'Staging demo comment — smoothie bowls are dessert, fight me.')
     ON CONFLICT (id) DO NOTHING`,
    [u[2].id, u[2].username]
  );
  await pool.query(
    `INSERT INTO comments (id, template_id, item_id, user_id, username, body)
     VALUES (900003, 900001, 900105, $1, $2, 'Staging demo comment — oatmeal deserves better than D tier.')
     ON CONFLICT (id) DO NOTHING`,
    [u[3].id, u[3].username]
  );

  // --- Open reports + a rate-anomaly flag so /mod renders ---
  const reports = [
    [900001, 'comment', 900002, u[3], 'Staging demo report — rude'],
    [900002, 'comment', 900002, u[4], 'Staging demo report — spam'],
    [900003, 'template', 900002, u[3], 'Staging demo report — duplicate list'],
  ];
  for (const [id, type, cid, reporter, reason] of reports) {
    await pool.query(
      `INSERT INTO reports (id, content_type, content_id, reporter_id, reporter_username, reason)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
      [id, type, cid, reporter.id, reporter.username, reason]
    );
  }
  await pool.query(
    `INSERT INTO mod_flags (id, kind, template_id, detail)
     VALUES (900001, 'rate_anomaly', 900001, '{"submissions_last_hour": 42, "note": "Staging demo flag"}')
     ON CONFLICT (id) DO NOTHING`
  );

  // --- What's-changing strip entry ---
  await pool.query(
    `INSERT INTO changelog_entries (id, kind, title, body)
     VALUES (900001, 'merging', 'Custom tier colors — merging soon', 'Staging demo changelog entry.')
     ON CONFLICT (id) DO NOTHING`
  );
}

module.exports = { seedStaging };
