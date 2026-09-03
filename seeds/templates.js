const { canonicalKey } = require('../lib/canonical');

// Launch seed content (real production content, not staging fixture).
// Inserted idempotently on every boot with fixed ids: template N uses item
// ids N*1000+1 … — all well below the 900001+ staging range and below the
// 1000 floor the sequences are bumped to. Text/emoji tiles only: we never
// ship copyrighted imagery (SPEC.md §13).

const TEAM = { id: 0, username: 'tier-lists-team' };

const SEEDS = [
  { id: 1, title: 'Pizza toppings', category: 'Food', emoji: '🍕', items: [
    'Pepperoni', 'Mushrooms', 'Pineapple', 'Extra cheese', 'Sausage', 'Onions',
    'Black olives', 'Green peppers', 'Bacon', 'Fresh basil', 'Anchovies',
    'Jalapeños', 'Ham', 'Cherry tomatoes', 'Spinach', 'Garlic', 'Artichokes',
    'BBQ chicken', 'Prosciutto', 'Sweetcorn'] },
  { id: 2, title: 'Fast-food chains', category: 'Food', emoji: '🍔', items: [
    "McDonald's", 'Burger King', 'KFC', 'Subway', "Wendy's", 'Taco Bell',
    "Domino's", 'Pizza Hut', 'Five Guys', 'Chipotle', 'Shake Shack',
    'In-N-Out', 'Chick-fil-A', 'Popeyes', "Dunkin'", 'Starbucks',
    'Dairy Queen', 'Panda Express'] },
  { id: 3, title: 'Crypto tokens', category: 'Crypto', emoji: '🪙', items: [
    'Bitcoin', 'Ethereum', 'Solana', 'Dogecoin', 'Cardano', 'XRP', 'Polkadot',
    'Avalanche', 'Chainlink', 'Litecoin', 'Monero', 'Uniswap', 'Aave',
    'Arbitrum', 'Optimism', 'TON', 'Shiba Inu', 'Pepe', 'USDC', 'Tether'] },
  { id: 4, title: 'Animes of the 2010s', category: 'TV & Film', emoji: '📺', items: [
    'Attack on Titan', 'Fullmetal Alchemist: Brotherhood', 'Steins;Gate',
    'Hunter x Hunter', 'One Punch Man', 'Mob Psycho 100', 'Demon Slayer',
    'My Hero Academia', "JoJo's Bizarre Adventure", 'Made in Abyss',
    'A Silent Voice', 'Your Name', 'Haikyuu!!', 'Re:Zero',
    'Violet Evergarden', 'Kill la Kill', 'Sword Art Online', 'Tokyo Ghoul',
    'No Game No Life', 'The Promised Neverland'] },
  { id: 5, title: 'Countries by football teams', category: 'Sports', emoji: '⚽', items: [
    'Brazil', 'Argentina', 'France', 'Germany', 'Spain', 'England', 'Italy',
    'Portugal', 'Netherlands', 'Belgium', 'Uruguay', 'Croatia', 'Morocco',
    'Japan', 'Mexico', 'United States', 'Senegal', 'Colombia'] },
  { id: 6, title: 'Programming languages', category: 'Tech', emoji: '💻', items: [
    'Python', 'JavaScript', 'TypeScript', 'Rust', 'Go', 'C', 'C++', 'Java',
    'C#', 'Ruby', 'PHP', 'Swift', 'Kotlin', 'Haskell', 'Elixir', 'Zig',
    'Lua', 'SQL', 'Bash', 'COBOL'] },
  { id: 7, title: 'Game Corner games, ranked by players', category: 'Platform', emoji: '🎮', items: [
    'Last One Wins', 'Falling Sands', 'Echo', 'Opinion Market', 'Daily Grid',
    'Pixel Painter', 'Trivia Rush', 'Bridge Builder', 'Speed Sudoku',
    'Ghost Racer', 'Tower Stack', 'Snake Duel', 'Lights Out', 'Word Ladder',
    'Mine Royale'] },
  { id: 8, title: 'Best cities for food', category: 'Travel', emoji: '🍜', items: [
    'Tokyo', 'Bangkok', 'Mexico City', 'Paris', 'Istanbul', 'New York',
    'Singapore', 'Rome', 'Osaka', 'Barcelona', 'Lima', 'Seoul', 'Mumbai',
    'Hong Kong', 'New Orleans', 'Bologna', 'Taipei', 'Marrakesh'] },
  { id: 9, title: 'Crypto celebs', category: 'Crypto', emoji: '🎤', items: [
    'Satoshi Nakamoto', 'Vitalik Buterin', 'CZ', 'SBF', 'Michael Saylor',
    'Elon Musk', 'Do Kwon', 'Charles Hoskinson', 'Gavin Wood', 'Justin Sun',
    'Cobie', 'Hayden Adams', 'Anatoly Yakovenko', 'Brian Armstrong',
    'Arthur Hayes', 'Andre Cronje'] },
  { id: 10, title: '2000s internet memes', category: 'Internet', emoji: '😂', items: [
    'Rickroll', 'Nyan Cat', 'Trollface', 'Numa Numa', 'Keyboard Cat',
    'Badger Badger Badger', 'Chocolate Rain', 'Leeroy Jenkins',
    'All Your Base', 'Star Wars Kid', 'Dramatic Chipmunk', 'O RLY Owl',
    'Peanut Butter Jelly Time', 'LOLcats', 'Charlie the Unicorn',
    'Salad Fingers', 'Chuck Norris Facts', 'Hamster Dance',
    'Double Rainbow', 'David After Dentist'] },
  // Not part of the initial 10-edition calendar, but eligible for the
  // rotation once that runs out (see ensureTodaysEdition below).
  { id: 11, title: 'Breakfast cereals, definitively', category: 'Food', emoji: '🥣', items: [
    'Frosted Flakes', 'Cheerios', 'Froot Loops', 'Lucky Charms',
    'Cinnamon Toast Crunch', 'Cocoa Puffs', 'Corn Flakes', 'Rice Krispies',
    'Raisin Bran', "Cap'n Crunch", 'Honey Nut Cheerios', 'Trix', 'Special K',
    'Shredded Wheat', 'Fruity Pebbles'] },
  { id: 12, title: 'L1s by vibes', category: 'Crypto', emoji: '🧱', items: [
    'Ethereum', 'Solana', 'Bitcoin', 'Avalanche', 'Cardano', 'Near', 'Aptos',
    'Sui', 'TON', 'Polkadot', 'Cosmos', 'Tezos', 'Algorand', 'Monad',
    'Berachain'] },
];

const DAILY_EDITIONS = 10; // seeds 1..10 become editions 1..10

async function seedProduction(pool) {
  for (const s of SEEDS) {
    await pool.query(
      `INSERT INTO templates (id, title, category, author_id, author_username,
         visibility, tier_labels, item_policy, is_seed)
       VALUES ($1, $2, $3, $4, $5, 'public', '{S,A,B,C,D}', 'open', true)
       ON CONFLICT (id) DO NOTHING`,
      [s.id, s.title, s.category, TEAM.id, TEAM.username]
    );
    for (let i = 0; i < s.items.length; i++) {
      const name = s.items[i];
      await pool.query(
        `INSERT INTO template_items (id, template_id, name, canonical_key, emoji)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO NOTHING`,
        [s.id * 1000 + i + 1, s.id, name, canonicalKey(name), i === 0 ? s.emoji : null]
      );
    }
  }

  // Today's List calendar sets itself at launch: editions 1..10 dated from
  // the first boot, only when the table is empty (editable by SQL later).
  const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM daily_lists');
  if (rows[0].c === 0) {
    for (let e = 1; e <= DAILY_EDITIONS; e++) {
      await pool.query(
        `INSERT INTO daily_lists (edition_no, template_id, run_date)
         VALUES ($1, $2, CURRENT_DATE + $3::int)
         ON CONFLICT DO NOTHING`,
        [e, e, e - 1]
      );
    }
  }

  await pool.query(
    `INSERT INTO changelog_entries (id, kind, title, body)
     VALUES (1, 'shipped', 'Community Tier Lists launched',
             'Rank shared templates, argue in the comments, and watch the community verdict move live.')
     ON CONFLICT (id) DO NOTHING`
  );
}

// The calendar above only covers the first DAILY_EDITIONS days. Without this
// it simply runs out: `run_date = CURRENT_DATE` stops matching, the hero
// vanishes from Home and /today dead-ends. So every boot (and once per day per
// process, from /api/home) we make sure today has an edition, rotating through
// the seed lists least-recently-featured first. Deliberately NOT staging-only:
// an expired calendar is a production bug, and staging inherits the fix.
async function ensureTodaysEdition(pool) {
  const { rows } = await pool.query(
    'SELECT 1 FROM daily_lists WHERE run_date = CURRENT_DATE');
  if (rows.length) return;

  // Missed days are not back-filled: nobody could have ranked them, and a
  // fabricated archive would read as a real edition. Today just takes the
  // next edition number.
  await pool.query(
    `INSERT INTO daily_lists (edition_no, template_id, run_date)
     SELECT (SELECT COALESCE(MAX(edition_no), 0) + 1 FROM daily_lists),
            t.id, CURRENT_DATE
       FROM templates t
       LEFT JOIN LATERAL (
         SELECT MAX(d.run_date) AS last_run FROM daily_lists d
          WHERE d.template_id = t.id
       ) prev ON true
      WHERE t.is_seed AND t.visibility = 'public' AND NOT t.hidden
        AND t.group_id IS NULL
        AND EXISTS (SELECT 1 FROM template_items i
                     WHERE i.template_id = t.id
                       AND i.status = 'active' AND NOT i.hidden)
      ORDER BY prev.last_run ASC NULLS FIRST, t.id ASC
      LIMIT 1
     ON CONFLICT DO NOTHING`);
}

module.exports = { seedProduction, ensureTodaysEdition };
