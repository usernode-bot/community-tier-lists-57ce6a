const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Idempotent boot migration. Tier placements are smallint, 1 = top tier
// (S=1 … D=5 on the default scale); labels are display-only.
async function migrate() {
  await pool.query(`
    DROP TABLE IF EXISTS presses;

    CREATE TABLE IF NOT EXISTS templates (
      id BIGSERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      category TEXT,
      author_id INTEGER NOT NULL,
      author_username TEXT NOT NULL,
      visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','group')),
      -- plain column, deliberately NO FK: groups is staging:private and the
      -- migration linter forbids public->private foreign keys.
      group_id BIGINT,
      tier_labels TEXT[] NOT NULL DEFAULT '{S,A,B,C,D}',
      item_policy TEXT NOT NULL DEFAULT 'open' CHECK (item_policy IN ('open','approved','closed')),
      is_seed BOOLEAN NOT NULL DEFAULT false,
      hidden BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS template_items (
      id BIGSERIAL PRIMARY KEY,
      template_id BIGINT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      canonical_key TEXT NOT NULL,
      emoji TEXT,
      image_url TEXT,
      link_url TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','proposed','rejected','removed')),
      added_by_id INTEGER,
      added_by_username TEXT,
      hidden BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (template_id, canonical_key)
    );
    CREATE INDEX IF NOT EXISTS idx_items_template ON template_items(template_id);

    CREATE TABLE IF NOT EXISTS rankings (
      id BIGSERIAL PRIMARY KEY,
      template_id BIGINT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      submitted_at TIMESTAMPTZ,
      UNIQUE (template_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_rankings_template ON rankings(template_id, status);

    CREATE TABLE IF NOT EXISTS ranking_items (
      ranking_id BIGINT NOT NULL REFERENCES rankings(id) ON DELETE CASCADE,
      item_id BIGINT NOT NULL REFERENCES template_items(id) ON DELETE CASCADE,
      tier SMALLINT,
      PRIMARY KEY (ranking_id, item_id)
    );

    CREATE TABLE IF NOT EXISTS groups (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      created_by_id INTEGER NOT NULL,
      created_by_username TEXT NOT NULL,
      invite_code TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS group_members (
      group_id BIGINT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (group_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS comments (
      id BIGSERIAL PRIMARY KEY,
      template_id BIGINT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
      item_id BIGINT REFERENCES template_items(id) ON DELETE SET NULL,
      user_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      body TEXT NOT NULL,
      hidden BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_comments_template ON comments(template_id);

    CREATE TABLE IF NOT EXISTS comment_reactions (
      comment_id BIGINT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL,
      emoji TEXT NOT NULL,
      PRIMARY KEY (comment_id, user_id, emoji)
    );

    CREATE TABLE IF NOT EXISTS reports (
      id BIGSERIAL PRIMARY KEY,
      content_type TEXT NOT NULL CHECK (content_type IN ('template','item','comment')),
      content_id BIGINT NOT NULL,
      reporter_id INTEGER NOT NULL,
      reporter_username TEXT NOT NULL,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (content_type, content_id, reporter_id)
    );

    CREATE TABLE IF NOT EXISTS mod_flags (
      id BIGSERIAL PRIMARY KEY,
      kind TEXT NOT NULL,
      template_id BIGINT,
      detail JSONB,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS daily_lists (
      edition_no INTEGER PRIMARY KEY,
      template_id BIGINT NOT NULL REFERENCES templates(id),
      run_date DATE NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS changelog_entries (
      id BIGSERIAL PRIMARY KEY,
      kind TEXT NOT NULL DEFAULT 'shipped' CHECK (kind IN ('shipped','merging','proposed')),
      title TEXT NOT NULL,
      body TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    COMMENT ON TABLE groups IS 'staging:private';
    COMMENT ON TABLE group_members IS 'staging:private';
    COMMENT ON TABLE reports IS 'staging:private';
    COMMENT ON TABLE mod_flags IS 'staging:private';
  `);
}

// Seeds insert with fixed ids; bump each serial past its current max so
// user-created rows never collide with seeded ranges.
async function bumpSequences() {
  const tables = ['templates', 'template_items', 'rankings', 'groups',
    'comments', 'reports', 'mod_flags', 'changelog_entries'];
  for (const t of tables) {
    await pool.query(
      `SELECT setval(pg_get_serial_sequence('${t}','id'),
              GREATEST(COALESCE((SELECT MAX(id) FROM ${t}), 0) + 1, 1000), false)`
    );
  }
}

module.exports = { pool, migrate, bumpSequences };
