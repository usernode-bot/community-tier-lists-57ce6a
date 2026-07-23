# Community Tier Lists — notes for Claude Code

This app runs on **Usernode Social Vibecoding**. If you're Claude Code
editing this repo, read the platform conventions before making
changes:

**Platform conventions (authoritative, always current):**
https://social-vibecoding.usernodelabs.org/claude.md

Fetch that URL at the start of each session — it's the single source
of truth for platform-wide behavior (auth model, `USERNODE_ENV`,
public/private tables, "don't `git push`", etc.). The hosted copy is
updated in place when platform rules change, so fetching it gives you
today's rules, not a stale snapshot.

When running inside Usernode's dev-chat, those same conventions are
already injected into your system prompt, so the fetch is a no-op in
that path — but it's the right reflex when someone runs Claude Code
against this repo locally or from another harness.

If a rule below this line conflicts with the hosted conventions, the
hosted conventions win. This file is **app-specific** — write down
things about *this* app that belong in the repo: product intent,
data-model quirks, style preferences, opt-in policies (e.g. which
tables you've marked private), etc.

---

## About Community Tier Lists

A social app where everyone fills in their own ranking of a shared
tier-list template (S/A/B/C/D by default) and the **community tier
list is the live aggregate of all individual rankings** — median tier
per item, with the distribution and controversy always visible. Your
list is your take; the aggregate is the crowd's verdict; the gap
between them (alignment %, "your hottest take") is the fun. Groups run
private lists; Today's List is the daily ritual; template creation is
AI-assisted via the platform LLM proxy.

**Read `SPEC.md` before building features** — it is the implementation
spec for the launch scope (data model, aggregation math, API surface,
UX rules, build order) and records the decisions taken on the product
spec's open questions.

## App-specific conventions

- **Tier placements are integers, 1 = top tier** (S=1 … D=5). Labels
  are display-only (`templates.tier_labels`); all math keys off the
  numbers. `NULL` tier in `ranking_items` = explicit skip.
- **One ranking per account per template** — the `UNIQUE (template_id,
  user_id)` constraint on `rankings` is the integrity model. Edits
  update in place; never add a resubmit path. No per-placement edit
  history is stored, deliberately (no gotcha screenshots).
- **Aggregates are median-based** (`percentile_disc(0.5)`), skips
  excluded, and every aggregate view must show n + the full
  distribution. Don't add mean-based anything.
- **staging:private tables:** `groups`, `group_members`, `reports`,
  `mod_flags`. `templates.group_id` is intentionally a plain column
  (no FK — public tables can't FK private ones).
- **No engagement machinery:** no points for ranking/commenting, no
  view counters, no follower counts, no algorithmic feed (recency +
  raw activity counts only), no DMs, no star ratings.
- **Seed templates use text/emoji tiles only** — never commit
  copyrighted imagery. User-uploaded images are user responsibility
  (report path covers them).
- Tier ramp colors are fixed by position (S `#E4573D`, A `#E5A83B`,
  B `#7FB542`, C `#3F97E8`, D `#8A6FDF`); tier letters always
  accompany color (colorblind-safe).
- Moderators = `MODERATOR_USERNAMES` (comma-separated `dapp.json`
  secret); auto-hide at 3 distinct reporters.
