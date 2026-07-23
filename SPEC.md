# Community Tier Lists — Implementation Spec (launch scope)

**Status:** draft for build · derived from the product team's internal build spec
v0.4 (July 20, 2026), §11 launch scope. This doc translates that product spec
into concrete engineering decisions for *this* repo — a Usernode Social
Vibecoding app (Express + Postgres + vanilla JS/Tailwind, iframe-token auth,
staging/production per `USERNODE_ENV`).

Where the product spec left a question open, this doc **decides** and records
the rationale; revisiting a decision is a normal PR.

---

## 0. Current repo state

Fresh Usernode starter template: `server.js` (JWT middleware, `/health`, a
demo `presses` table + press/leaderboard endpoints), `public/index.html`
(button demo), `dapp.json` (`{ "secrets": [] }`). Everything below is
greenfield; the demo endpoints and `presses` table get deleted in the first
implementation PR.

## 1. Architecture overview

- **One Express server** (`server.js` stays the entrypoint), one Postgres DB,
  idempotent boot migration (`CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT
  EXISTS`).
- **Frontend: single-page app, path-routed.** The scaffold's catch-all `*`
  already serves `index.html` for any authenticated path, so client-side
  routing uses real pathnames (`history.pushState`), which keeps testing
  `path:` lines and platform screenshots working with zero special-casing.
  Routes:

  | Route | Screen |
  |---|---|
  | `/` | Home (Today's List hero, what's-changing, in-progress, groups, feed) |
  | `/today` | Resolves to today's edition and forwards to its `/t/:id` |
  | `/t/:id` | Ranking screen (default entry — rank-first) |
  | `/t/:id/results` | Aggregate / reveal / peek view |
  | `/t/:id/compare/:username` | Head-to-head compare |
  | `/t/:id/comments` | Comment sheet deep link (opens as sheet over results) |
  | `/new` | Template creation (AI-assisted) |
  | `/g/:id` | Group space |
  | `/g/join/:code` | Invite-link landing (joins group, forwards to `/g/:id`) |
  | `/me` | Profile (streak, my rankings, my templates, settings) |
  | `/mod` | Moderation review queue (moderators only) |

- **UI kit:** adopt `usernode-native` (hosted, never vendored) per its adoption
  steps — pressed states, sheets (comments, item detail, tier distribution),
  toasts, nav bars, safe areas, `unNative.transition` for push/pop. The tier
  drag itself is custom (see §6) and registers with `unNative.gestures`.
- **Brand:** paper/ink family with **violet** accent (matches the scaffold's
  existing violet), Fraunces for display type + Inter for UI, fixed warm→cool
  tier ramp `S #E4573D · A #E5A83B · B #7FB542 · C #3F97E8 · D #8A6FDF`.
  Tier letters always accompany hue (colorblind-safe); ≥44pt touch targets.
- **Back rule:** Home is root; every non-Home screen has ← to Home (or its
  parent); sheets dismiss in place.

## 2. Data model

Tier placements are stored as **small integers, 1 = top tier** (S=1, A=2, B=3,
C=4, D=5 on the default scale). All math keys off these numbers; labels are
display-only.

```sql
CREATE TABLE templates (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT,                       -- free-text at v1 (movies, food, crypto, …)
  author_id INTEGER NOT NULL,
  author_username TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','group')),
  group_id BIGINT,                     -- plain column, NO SQL FK (groups is staging:private; linter forbids public→private FK). App-level integrity.
  tier_labels TEXT[] NOT NULL DEFAULT '{S,A,B,C,D}',   -- 3–6 entries, ≤12 chars each
  item_policy TEXT NOT NULL DEFAULT 'open' CHECK (item_policy IN ('open','approved','closed')),
  is_seed BOOLEAN NOT NULL DEFAULT false,
  hidden BOOLEAN NOT NULL DEFAULT false,               -- moderation auto-hide
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE template_items (
  id BIGSERIAL PRIMARY KEY,
  template_id BIGINT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  canonical_key TEXT NOT NULL,         -- normalized dedupe key (AI-assisted; heuristic fallback)
  emoji TEXT,                          -- typographic/emoji tiles are the default aesthetic
  image_url TEXT,                      -- user uploads only, never seeded (image-rights policy)
  link_url TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','proposed','rejected','removed')),
  added_by_id INTEGER,                 -- NULL = part of the authored set
  added_by_username TEXT,
  hidden BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (template_id, canonical_key)
);

CREATE TABLE rankings (
  id BIGSERIAL PRIMARY KEY,
  template_id BIGINT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at TIMESTAMPTZ,
  UNIQUE (template_id, user_id)        -- THE integrity rule: one ranking per account per template
);

CREATE TABLE ranking_items (
  ranking_id BIGINT NOT NULL REFERENCES rankings(id) ON DELETE CASCADE,
  item_id BIGINT NOT NULL REFERENCES template_items(id) ON DELETE CASCADE,
  tier SMALLINT,                       -- NULL = explicit skip ("haven't seen it")
  PRIMARY KEY (ranking_id, item_id)
);

CREATE TABLE groups (                  -- staging:private
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  created_by_id INTEGER NOT NULL,
  created_by_username TEXT NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,    -- random slug for /g/join/:code
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE groups IS 'staging:private';

CREATE TABLE group_members (           -- staging:private
  group_id BIGINT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);
COMMENT ON TABLE group_members IS 'staging:private';

CREATE TABLE comments (
  id BIGSERIAL PRIMARY KEY,
  template_id BIGINT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  item_id BIGINT REFERENCES template_items(id) ON DELETE SET NULL,  -- NULL = template-level; set = item-anchored ("re: Evangelion in B")
  user_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  body TEXT NOT NULL,
  hidden BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE comment_reactions (
  comment_id BIGINT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  emoji TEXT NOT NULL,
  PRIMARY KEY (comment_id, user_id, emoji)
);

CREATE TABLE reports (                 -- staging:private
  id BIGSERIAL PRIMARY KEY,
  content_type TEXT NOT NULL CHECK (content_type IN ('template','item','comment')),
  content_id BIGINT NOT NULL,
  reporter_id INTEGER NOT NULL,
  reporter_username TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (content_type, content_id, reporter_id)   -- one report per user per object
);
COMMENT ON TABLE reports IS 'staging:private';

CREATE TABLE mod_flags (               -- staging:private (integrity anomaly log)
  id BIGSERIAL PRIMARY KEY,
  kind TEXT NOT NULL,                  -- 'rate_anomaly' at v1
  template_id BIGINT,
  detail JSONB,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE mod_flags IS 'staging:private';

CREATE TABLE daily_lists (
  edition_no INTEGER PRIMARY KEY,      -- "Today's List No. 31"
  template_id BIGINT NOT NULL REFERENCES templates(id),
  run_date DATE NOT NULL UNIQUE        -- UTC
);

CREATE TABLE changelog_entries (
  id BIGSERIAL PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'shipped' CHECK (kind IN ('shipped','merging','proposed')),
  title TEXT NOT NULL,                 -- user-language: "Custom tier colors — merging in 9h"
  body TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### staging:private decisions (say them out loud)

- **`groups` + `group_members` — private.** Membership graphs are personal
  ("who is in whose friend group"); the app's own UI gates them to members.
  Staging seeds a fake "Staging demo crew" group instead.
- **`reports` + `mod_flags` — private.** Reporter identity and moderation
  state are confidential by design; leaking who reported whom is a harassment
  vector. Staging seeds fake open reports so `/mod` is testable.
- **Everything else — public (the default).** Templates, items, rankings,
  comments, dailies, changelog are all content the app already shows broadly.
- **Known limitation, recorded as a watch item:** group-visibility templates
  live in the public `templates` table (splitting them into a private mirror
  would force `rankings`/`comments`/`ranking_items` private too via the
  no-public-FK-to-private rule, gutting staging entirely). Consequence: a
  group template's *title and items* (not membership) are visible in a staging
  copy. At launch this is a near-zero surface (prod starts empty; groups are a
  minority of content). **Tripwire:** if group adoption becomes real and group
  templates start carrying sensitive titles (the "girls in our class" risk
  class from product §6.7), we split group content into `staging:private`
  mirror tables in a dedicated PR. Cheap to hold, ready if needed.
- The `presses` demo table is dropped in the first PR (`DROP TABLE IF EXISTS`).

## 3. Aggregation math (the core, product §6.2)

All computed **on read** with a per-template in-process cache (30 s TTL,
invalidated on any write to that template's rankings). No materialized
aggregate table at launch scale; the SQL below is one indexed group-by. If a
template crosses ~50k rankings we add a cached aggregate table then.

**Community tier per item** = median placement across submitted rankings,
skips excluded:

```sql
SELECT ri.item_id,
       percentile_disc(0.5) WITHIN GROUP (ORDER BY ri.tier) AS median_tier,
       COUNT(*) AS placed_n,
       COUNT(*) FILTER (WHERE ri.tier = 1) AS t1, …                -- per-tier counts
FROM ranking_items ri
JOIN rankings r ON r.id = ri.ranking_id
WHERE r.template_id = $1 AND r.status = 'submitted' AND ri.tier IS NOT NULL
GROUP BY ri.item_id;
```

`percentile_disc(0.5)` is exactly the product spec's "cumulative crosses 50%"
rule and always lands on a real tier. Skip counts come from the same query
without the `tier IS NOT NULL` filter.

- **n** (rankings counted) and the full per-tier distribution ship with every
  aggregate response and are always rendered — a spiked distribution is
  self-exposing (integrity §6.8).
- **% skipped per item** = skips / (placements + skips). Denominator is only
  users who actually saw the item: submit requires every tray item to be
  either placed or explicitly skipped, so items added to the shared set
  *after* a user ranked are simply absent from that user's rows (neither
  placed nor skipped) until a re-rank. "NEW" badge + low-n indicator until
  `placed_n ≥ 5`.
- **Controversy** = normalized Shannon entropy of the item's tier distribution
  (0–1; even split across all tiers = 1 = "most contested"), computed in JS
  from the distribution already fetched. Chosen over variance because the
  product spec's own definition ("evenly split across five tiers = most
  contested") is entropy, not spread-of-extremes. Displayed as "spread across
  N tiers"; template's *most contested* = max entropy with `placed_n ≥ 5`.
- **Alignment %** = `round(100 − avgOverPlacedItems(|yourTier − communityTier|) × (100 / k))`,
  clamped to [0,100], where k = tier count. For the default k=5 this is
  exactly the product spec's ×20 constant, and it generalizes to custom
  scales. Skipped items excluded.
- **Your hottest take** = your placed item with max `|yourTier − communityTier|`;
  ties broken by higher `placed_n` (a contrarian take on a popular item beats
  one on an obscure item). Contrarian percentile ("top 4%") = share of rankers
  whose placement of that item is at least as far from the median as yours.
- **Group aggregate** = same math filtered to member rankings. **Group vs
  global** compare is available on *public* templates for groups the viewer
  belongs to.

## 4. API surface

All endpoints require auth (scaffold middleware unchanged; `PUBLIC_API_PATHS`
stays `{'/health'}` — see §13 on the deferred no-login ladder). `req.user`
provides `{ id, username }`; ownership is recorded from it, never from the
body.

| Method + path | Purpose |
|---|---|
| `GET /api/home` | One-shot Home payload: today's edition (+ my status), what's-changing entries, my drafts, my groups (+ activity counts), feed (trending by real 48h ranking counts + friends-of-groups recent submissions, recency-sorted — no algorithmic ranking) |
| `GET /api/templates/:id` | Template + items + my ranking (draft or submitted) + whether aggregate is unlocked for me (submitted → yes; else peek flag) |
| `GET /api/templates/:id/aggregate` | Aggregate: per-item median, distribution, skip %, n, most-contested; plus my reveal stats (alignment %, hottest take) if I've submitted |
| `PUT /api/templates/:id/ranking` | Upsert my ranking placements (array of `{item_id, tier|null}`); `?submit=1` flips draft→submitted. Edits after submit update in place (living document); resubmits are the same row — `UNIQUE` makes brigade-by-resubmit impossible |
| `GET /api/templates/:id/compare/:username` | Head-to-head (404 until both submitted): per-item diff, biggest disagreement |
| `POST /api/templates` | Create template (title, category, tier_labels, item_policy, visibility, group_id, items[]) |
| `POST /api/templates/:id/items` | Add item. Always lands in *my* ranking immediately; joins the shared set per `item_policy` (open → active, approved → proposed, closed → mine-only via status `proposed` that only the author can never see — stored but not shared) |
| `POST /api/templates/:id/items/:itemId/decide` | Author approves/rejects a proposed item |
| `POST /api/ai/items` | LLM proxy: propose item set for a title (editable client-side before publish) |
| `POST /api/ai/canonicalize` | LLM proxy: canonical_key + duplicate-of detection for a new item name (heuristic fallback: lowercase, strip punctuation/diacritics/stop-words) |
| `GET/POST /api/templates/:id/comments` | Threads; `item_id` optional for item-anchored; reactions via `POST /api/comments/:id/react` |
| `POST /api/report` | Report `{content_type, content_id, reason}`; auto-hide at threshold |
| `GET /api/mod/queue`, `POST /api/mod/resolve` | Moderator-only review queue (restore / keep hidden / dismiss) |
| `POST /api/groups`, `POST /api/groups/join/:code`, `GET /api/groups/:id` | Group CRUD-lite: create (returns invite code), join via code, group space payload (templates, member ranking status, group aggregates) |
| `GET /api/me` | Profile: streak, rankings count, avg alignment, hottest take overall, my templates + rankings received |

Design notes:

- **Trending** = raw ranking-submission counts over a 48 h window, period.
  Chronological/real-activity only (anti-dark-pattern rule, product §6.10).
- **Rate anomaly flag (integrity v1):** on each submit, if the template's
  submissions-per-hour exceed `max(20, 5 × trailing-7-day hourly average)`,
  insert one `mod_flags` row per template per day. Reviewed manually from
  `/mod`. No automated action at v1 — median + visible distribution are the
  actual defense.
- **Edit history is not public.** `updated_at` exists; per-placement history
  is not stored at all — the cheapest way to guarantee no gotcha screenshots.

## 5. Home shell (product §6.1)

Single scroll, in this order: **Today's List hero** (edition number, title,
n ranked, my status: Rank it / Ranked ✓ / resume) · **what's-changing strip**
(latest `changelog_entries` of kind `merging`/`proposed`, horizontally
scrollable) · **In progress** (my drafts + my groups' templates with new
activity since my last ranking update) · **My groups** · **Feed** (trending +
recent submissions on templates I can see, recency-sorted). Each section
renders only when non-empty; a brand-new user sees hero + feed.

The changelog itself lives at the bottom of `/me` ("this week Tier Lists
changed because you voted"). **Decision:** at v1 `changelog_entries` is
team-curated (rows inserted via a moderator-only endpoint) because the
platform exposes no proposal-feed API to apps. When building, draft a
`usernode-report-platform-issue` requesting read access to the app's own
proposal/vote feed so the strip can go live-data — that's a missing platform
capability, not something to fake app-side.

## 6. Ranking UX (product §6.4)

- **Layout:** tier rows (fixed ramp colors, letter labels) on top, item tray
  below. Items are typographic/emoji chips by default (the default aesthetic,
  not a fallback); uploaded images render as small tiles.
- **Drag:** custom pointer-tracking drag (1:1 finger tracking, spring release
  via `unNative.spring`, claim through `unNative.gestures` so it composes with
  the kit's scroll/pull recognizers). Long-press lift on touch; immediate drag
  on desktop.
- **Tap-to-place fallback (one-handed):** tap a tray chip → tier letter
  buttons appear → tap a tier. Also the accessibility path.
- **Skip is first-class:** every tray chip has a skip affordance ("haven't
  seen it"); submit is enabled only when the tray is empty (everything placed
  or skipped) — this is what makes skip-% denominators honest. Skipped items
  sit in a collapsed "skipped" shelf and can be pulled back.
- **Rank-first reveal:** the aggregate is hidden on `/t/:id` until the viewer
  has submitted. Submit navigates to `/t/:id/results` — the reveal: alignment
  %, hottest take, most contested, community grid (median per item; tapping an
  item opens its distribution + skip-% sheet), n.
- **Peek path:** a visibly-secondary "just show me the results" link on the
  ranking screen opens `/t/:id/results` in spectator mode (community grid, no
  personal stats, a persistent "rank it yourself" CTA). Peeking never blocks
  ranking; a post-peek ranking counts identically.
- **Living documents:** results screen has "edit my ranking" → back to
  `/t/:id` with placements loaded; saving updates the aggregate live.
  Drafts autosave (debounced `PUT`) and feed Home's In progress.
- **Target:** 20-item template rankable in under 3 minutes; instrument
  time-from-open-to-submit client-side (console-log at v1; real analytics is
  platform territory).
- Gentle re-rank prompts and tier trajectories: **backlog**, per product spec.

## 7. Compare views (product §6.5)

- **You vs community** — the default reveal (§6 above), always available solo.
- **You vs friend** — `/t/:id/compare/:username`, unlocked when both have
  submitted: side-by-side grids, per-item deltas, "you two disagree most
  about: X" headline. Reachable from the results screen (pick from other
  rankers) and from feed entries ("kip ranked … — 62% aligned with you").
  v1 "friend" = any co-ranker you can name/see; there is no separate friend
  graph in the app (mutual-invite graphs are platform territory; group
  membership is the app's own social unit).
- **Group vs global** — on a public template, for each group you're in:
  group-median grid vs global-median grid + biggest divergence headline.

## 8. Template creation & AI assist (product §6.6)

Flow on `/new`: title → **AI proposes the item set** (editable list: remove,
rename, add) → tier scale (default S–D; count 3–6, custom labels) → item
policy (open / author-approved / closed) → visibility (public / pick one of my
groups) → publish.

**LLM proxy integration** (per platform conventions — never an API key):

- Server calls `POST ${USERNODE_LLM_PROXY_URL}/v1/messages` forwarding
  `x-usernode-user-token` from the request. `LLM_ENABLED =
  !!process.env.USERNODE_LLM_PROXY_TOKEN`; when false (all staging, all
  standalone) the UI shows "AI suggestions unavailable here" and manual item
  entry is the path — creation must never hard-require AI.
- `POST /api/ai/items`: model `claude-sonnet-5`, structured JSON out
  (15–25 `{name, emoji}` items for the title), one call per generate tap.
- `POST /api/ai/canonicalize`: model `claude-haiku-4-5` (cheap, high-volume),
  returns `{canonical_key, duplicate_of_item_id | null}` given the new name +
  existing item names. Heuristic fallback (lowercase, strip punctuation /
  diacritics / whitespace) whenever the proxy is unavailable or errors —
  canonicalization degrades, never blocks.
- Error handling: `403 grant_required` → frontend `usernode.requestLlmAccess()`
  and retry once; `429 app_cap_exceeded` / `budget_exceeded` → clear toast,
  manual path remains. Read the `x-usernode-llm-spent-cents` /
  `-cap-cents` headers to show "used $X of $Y today" in the creation screen's
  footer.
- `dapp.json` gets:

  ```json
  "llm": {
    "purpose": "Suggests and dedupes tier-list items from your title",
    "suggested_daily_cap_cents": 50
  }
  ```

  (A few sonnet calls per template; 50¢ is generous. No new secrets — the
  proxy vars are platform-injected and reserved.)

**Image rights:** user uploads are user responsibility (report path covers
them); **seed templates are text/emoji tiles only** — we never ship
copyrighted imagery. v1 upload = paste an image URL (no file-upload pipeline);
binary upload is backlog.

## 9. Groups

App-level implementation (the platform exposes no group/team API to apps):
`groups` + `group_members` + invite codes. Create from Home or from `/new`'s
visibility picker; `/g/join/:code` adds the authed user and forwards to the
group space. Group space shows the group's templates, who has ranked what
("5 of 6 ranked"), group aggregates, biggest splits between named members, and
the invite link. Group templates are visible/rankable by members only
(enforced in every template/aggregate/comment endpoint via a membership
check). No roles at v1 — any member can create group templates; only the
group creator can rename the group.

**Group→public promotion (product open Q4): not at v1.** Instead, "duplicate
as public template" (fresh copy, fresh aggregate, same items) — avoids
consent questions about republishing member rankings and costs one endpoint.

## 10. Comments & moderation (product §6.7)

- Threads per template; `item_id` anchors a comment to an item — the results
  grid shows a comment count per item, and the item's distribution sheet shows
  its thread. Flat threads at v1 (no nesting), emoji reactions. No DMs.
- **Moderation v1 pipeline:** report (any authed user, one per object) →
  **auto-hide at 3 distinct reporters** (`hidden = true`; content shows a
  "hidden pending review" stub; aggregates keep counting hidden templates'
  existing rankings but the template leaves feed/search) → review at `/mod`:
  restore (clears reports), keep hidden (resolved), or dismiss.
- **Moderators:** usernames listed in a `MODERATOR_USERNAMES` value declared
  in `dapp.json` secrets (`required: false`, `private: false`, comma-separated,
  `default: ""`). Same mechanism in staging and prod (no env-gated auth);
  changing moderators is a Secrets-UI edit, no redeploy. Platform-level roles
  would be better — note it in the eventual platform-capability report.
- Report-rate is instrumented from day one: `/mod` shows reports-per-day and
  reports-per-1k-rankings.
- **People-templates: allowed, no special restrictions** (product decision,
  July 20). Recorded tripwire: any report on a people-template naming
  non-public persons gets same-day review; if the pattern recurs, ship the
  pre-designed mitigation (restrict people-templates to public figures) as a
  normal PR without further debate.

## 11. Integrity (product §6.8)

- **One ranking per account per template** — enforced by the DB `UNIQUE`
  constraint, surfaced as edit-in-place. Accounts themselves are platform
  policy; the app just keys on `req.user.id`.
- Median aggregation (tail-resistant) + **n and full distribution always
  visible** — the structural defenses.
- Rate-anomaly flags to `mod_flags` (see §4), manual review at current scale.
- **No engagement rewards** anywhere: no points for ranking/commenting/
  template popularity, no view counters, no follower counts. Nothing to farm.
- Note: product §11 says "integrity v1 + verified toggle", but §6.8 (v0.2)
  explicitly scrubbed account-trust vocabulary and deferred trust-filtered
  aggregates until the platform exposes account-trust signals. **Decision:
  follow §6.8 — no verified toggle at launch** (there is no platform trust
  signal to toggle on); the §11 phrase is stale against its own spec.

## 12. Share cards & deep links (product §7)

- **Client-side `<canvas>` PNG rendering** (no server image pipeline, no new
  dependencies), two formats, same 1200×630 dimensions as Game Corner so the
  eventual shared-plumbing merge is mechanical (build-twice decision, §11 of
  the product spec):
  - **Grid card:** full tier grid in ramp colors + edition/template name +
    "78% aligned · hottest take: Evangelion in B".
  - **Hot-take card:** one item, huge type — "I put Messi in B tier. Fight
    me." + template name + link.
  - **Group variant:** "Climbing crew's S-tier: El Chorro" (group aggregate
    top tier), member-triggered from the group space.
- Share via Web Share API (`navigator.share` with the PNG file) where
  available; fallback = download + copy-link toast.
- **Deep links:** the card link is the production app URL (`/t/:id`). The
  scaffold already 302s unauthenticated document visits to the platform's
  chromeless app view; **at build time, test whether that redirect can carry
  the inner route** — if the platform's `#app/<slug>/full` view can't deep-link
  to `/t/:id`, draft a `usernode-report-platform-issue` for deep-link
  pass-through (the product spec's own deferred-deep-link ⚠, shared with Game
  Corner). App-side fallback until then: land on Home with a "you followed a
  link to «title»" resume card driven by a `?t=<id>` query param that survives
  the redirect if the platform preserves query strings.
- The full **no-login public template page** (product §6.11) is **not in the
  §11 launch scope** and is blocked on the platform's public-web-URL
  capability (product open Q6). All launch share links land in the
  authenticated shell. When the platform capability lands, the ladder
  (anonymous rank → "make it count" retroactive commit) becomes its own PR;
  the API is already shaped for it (aggregate endpoint is side-effect-free and
  could join `PUBLIC_API_PATHS` as-is).

## 13. Today's List & seed content (product §6.3, §8)

- `daily_lists` maps edition numbers to dates (UTC). `/api/home` resolves
  today's row; editions with `run_date < today` render as "final" archives.
- **Reveal timing (product open Q3) — decision: rolling live.** You see the
  current aggregate immediately after you rank (your-vs-current), and the
  edition freezes into "final" when its UTC day ends — computed on read, no
  cron. The end-of-day *notification* moment needs push infrastructure the
  platform doesn't expose to apps yet; it ships with notifications, not
  before.
- **Streaks:** consecutive `run_date`s with a submitted ranking on that day's
  template, computed on read for `/me` and the hero badge. Requires an
  account by nature (it's history).
- **Seed content ships in the repo** (`seeds/templates.js`), inserted
  idempotently on boot **in production too** (fixed IDs in a reserved range,
  `ON CONFLICT DO NOTHING`, `is_seed = true`) — the seed set is real launch
  content, not staging fixture. Author byline: a designated team account name.
  The first 10 editions are the product spec's table (pizza toppings →
  fast-food chains → crypto tokens → animes of the 2010s → countries by
  football → programming languages → Game Corner games → best cities for food
  → crypto celebs → 2000s memes), 15–25 text/emoji items each, item lists
  authored in the implementation PR. `daily_lists` rows 1–10 are dated from
  the first production boot date (row inserted only if the table is empty, so
  the calendar sets itself at launch and is editable by SQL/moderator endpoint
  later). Additional non-daily seeds (local lists like "coffee shops in NY")
  ship as ordinary feed templates.
- The seed-calendar *targeting rationale* stays internal (product §12) — code
  comments in `seeds/templates.js` stay editorial-neutral.

## 14. Staging seeds & tests

Staging (and the in-loop browser DB) starts empty for every table this app
creates, so boot seeds under `IS_STAGING` (idempotent, fixed IDs ≥ 900001,
"Staging demo …" naming, fake users only):

- 2 demo templates ("Staging demo: breakfast foods", one with images-off) with
  6–8 items each, ~5 submitted rankings from `staging-demo-user-1..5` (spread
  so median/controversy/skip-% all render non-trivially).
- A `daily_lists` row pointing today (staging only) at a demo template so the
  hero renders.
- "Staging demo crew" group + members + one group template.
- 3 open reports + 1 rate-anomaly flag so `/mod` renders.
- 1 what's-changing + 1 shipped changelog entry.

`dapp.json` tests (accumulate per screen as PRs land; every route seeded
above):

```json
"tests": [
  { "name": "Home renders",   "path": "/",                 "expectText": "Today's List" },
  { "name": "Rank screen",    "path": "/t/900001",         "expectSelector": "[data-tier-row]" },
  { "name": "Results (peek)", "path": "/t/900001/results", "expectText": "rankings" },
  { "name": "Create screen",  "path": "/new",              "expectText": "tier scale" }
]
```

`dapp.json` also gains: `"name": "Community Tier Lists"`, `"icon":
{ "emoji": "🏆" }`, the `llm` block (§8), and the `MODERATOR_USERNAMES`
secret (§10).

## 15. Build order (PR-shaped)

1. **Foundation:** drop demo code; schema + migrations + prod seed templates +
   staging seeds; Home shell; template view read-only; tests for `/` and
   `/t/:id`.
2. **Rank & reveal:** drag/tap/skip UX, draft autosave, submit, aggregate
   endpoint + reveal screen + peek path + distribution sheets.
3. **Compare:** you-vs-friend, group-vs-global, profile (`/me`) with streaks.
4. **Create + AI:** `/new`, LLM proxy endpoints + fallbacks, item policies,
   add-item flow with canonicalization, `llm` block.
5. **Groups:** create/join/space, group aggregates, group seeds.
6. **Comments + moderation + integrity:** threads, item anchors, reactions,
   reports, auto-hide, `/mod`, rate-anomaly flags, `MODERATOR_USERNAMES`.
7. **Share & ritual polish:** canvas cards, share flow, deep-link testing (+
   platform report if pass-through fails), Today's List archive/final states,
   what's-changing strip + changelog.

Each PR carries its staging seeds + `dapp.json` tests in the same commit
(checks gate merges), and uses the in-loop browser on user-visible screens.

## 16. Explicitly out of scope at launch (with reasons)

- **No-login ladder (§6.11)** — not in §11 scope; blocked on platform
  public-web-URL. API shaped for it (see §12).
- **Verified/trust-filtered aggregate toggle** — no platform trust signal
  exists (see §11 note).
- **Notifications** (re-rank prompts, "someone disagreed", end-of-day reveal
  push) — no app-facing notification API; when it lands, the once-per-template
  cap from product §6.10 is a hard rule.
- **Elo / head-to-head ranking modes, item pages across templates,
  template-author follows, compare parties, tier trajectories, Today's List
  community submissions** — product backlog, demand-ordered.
- **No ads, no sponsored placements, no points for engagement, no follower
  counts, no DMs, no star ratings / reviews** — structural non-goals; don't
  build the hooks either.

## 17. Decisions taken on the product spec's open questions

| Product §13 item | Decision here |
|---|---|
| 1 · App name | Keep "Community Tier Lists"; renaming later is a one-line `dapp.json` PR |
| 2 · Tier-scale bounds | 3–6 tiers, editable labels ≤12 chars, fixed position-mapped color ramp; custom colors deferred (a nicely governance-able first community PR) |
| 3 · Today's reveal timing | Rolling live + "final" state at UTC day end; appointment notification waits for notification infra |
| 4 · Group→public promotion | Not at v1; "duplicate as public" instead |
| 5 · Seed calendar ownership | Seeds in-repo, auto-dated from launch boot, moderator-editable after; text/emoji tiles only |
| 6 · Public web URL | Deferred with the no-login ladder; escalate as platform capability when share-link pass-through is tested |
