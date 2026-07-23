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
  // Feed-only seeds (not Today's List editions)
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

module.exports = { seedProduction };
