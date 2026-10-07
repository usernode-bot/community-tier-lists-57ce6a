// Official images for seed items that are brands, crypto projects or
// shows: the brand's logo, the project's token logo, the show's cover art.
// These are the real artwork (never redrawn), hotlinked from stable URLs and
// stored in template_items.image_url with the source in image_source.
// Sources: Wikipedia/Wikimedia Commons page images and file pages (logos,
// covers) and CoinGecko's token images. Hand-reviewed: an item whose only
// image was a storefront or unrelated photo is left out, so it renders as
// a name tile instead of a misleading picture. Keyed by template id, then
// by the item's exact name.

const ITEM_IMAGES = {
  // Fast-food chains
  2: {
    "McDonald's": ["https://thumb.wikimedia.org/wikipedia/commons/thumb/3/36/McDonald%27s_Golden_Arches.svg/330px-McDonald%27s_Golden_Arches.svg.png", "Wikipedia: File:McDonald's_Golden_Arches.svg (McDonald's)"],
    "Burger King": ["https://thumb.wikimedia.org/wikipedia/commons/thumb/c/cc/Burger_King_2020.svg/330px-Burger_King_2020.svg.png", "Wikipedia: File:Burger_King_2020.svg (Burger King)"],
    "KFC": ["https://thumb.wikimedia.org/wikipedia/commons/thumb/f/ff/Kentucky_Fried_Chicken_201x_logo.svg/330px-Kentucky_Fried_Chicken_201x_logo.svg.png", "Wikimedia Commons: File:Kentucky Fried Chicken 201x logo.svg"],
    "Subway": ["https://upload.wikimedia.org/wikipedia/commons/d/da/Subway-logo-green_2016.png", "Wikimedia Commons: File:Subway-logo-green 2016.png"],
    "Wendy's": ["https://thumb.wikimedia.org/wikipedia/en/thumb/3/32/Wendy%27s_full_logo_2012.svg/330px-Wendy%27s_full_logo_2012.svg.png", "Wikipedia: File:Wendy's_full_logo_2012.svg (Wendy's)"],
    "Taco Bell": ["https://thumb.wikimedia.org/wikipedia/en/thumb/b/b7/Taco_Bell_2023.svg/330px-Taco_Bell_2023.svg.png", "Wikipedia: File:Taco_Bell_2023.svg (Taco Bell)"],
    "Domino's": ["https://thumb.wikimedia.org/wikipedia/commons/thumb/3/3e/Domino%27s_pizza_logo.svg/330px-Domino%27s_pizza_logo.svg.png", "Wikimedia Commons: File:Domino's pizza logo.svg"],
    "Pizza Hut": ["https://thumb.wikimedia.org/wikipedia/commons/thumb/c/c5/Pizza_Hut_2025.svg/330px-Pizza_Hut_2025.svg.png", "Wikipedia: File:Pizza_Hut_2025.svg (Pizza Hut)"],
    "Five Guys": ["https://thumb.wikimedia.org/wikipedia/commons/thumb/8/80/Five_Guys_logo.svg/330px-Five_Guys_logo.svg.png", "Wikimedia Commons: File:Five Guys logo.svg"],
    "Chipotle": ["https://thumb.wikimedia.org/wikipedia/en/thumb/3/3b/Chipotle_Mexican_Grill_logo.svg/330px-Chipotle_Mexican_Grill_logo.svg.png", "Wikipedia: File:Chipotle_Mexican_Grill_logo.svg (Chipotle Mexican Grill)"],
    "Shake Shack": ["https://thumb.wikimedia.org/wikipedia/commons/thumb/9/96/Shake_Shack_logo.svg/330px-Shake_Shack_logo.svg.png", "Wikimedia Commons: File:Shake Shack logo.svg"],
    "In-N-Out": ["https://thumb.wikimedia.org/wikipedia/commons/thumb/8/8c/InNOut_2021_logo.svg/330px-InNOut_2021_logo.svg.png", "Wikipedia: File:InNOut_2021_logo.svg (In-N-Out Burger)"],
    "Chick-fil-A": ["https://thumb.wikimedia.org/wikipedia/commons/thumb/0/02/Chick-fil-A_Logo.svg/330px-Chick-fil-A_Logo.svg.png", "Wikimedia Commons: File:Chick-fil-A Logo.svg"],
    "Popeyes": ["https://thumb.wikimedia.org/wikipedia/commons/thumb/2/24/Logo_of_Popeyes_Louisiana_Kitchen.svg/330px-Logo_of_Popeyes_Louisiana_Kitchen.svg.png", "Wikimedia Commons: File:Logo of Popeyes Louisiana Kitchen.svg"],
    "Dunkin'": ["https://thumb.wikimedia.org/wikipedia/commons/thumb/2/22/Dunkin%27_logo.svg/330px-Dunkin%27_logo.svg.png", "Wikimedia Commons: File:Dunkin' logo.svg"],
    "Starbucks": ["https://thumb.wikimedia.org/wikipedia/en/thumb/d/d3/Starbucks_Corporation_Logo_2011.svg/330px-Starbucks_Corporation_Logo_2011.svg.png", "Wikipedia: File:Starbucks_Corporation_Logo_2011.svg (Starbucks)"],
    "Dairy Queen": ["https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ae/Dairy_Queen_logo.svg/330px-Dairy_Queen_logo.svg.png", "Wikipedia: File:Dairy_Queen_logo.svg (Dairy Queen)"],
    "Panda Express": ["https://thumb.wikimedia.org/wikipedia/en/thumb/8/85/Panda_Express_logo.svg/330px-Panda_Express_logo.svg.png", "Wikipedia: File:Panda Express logo.svg"],
  },
  // Crypto tokens
  3: {
    "Bitcoin": ["https://coin-images.coingecko.com/coins/images/1/large/bitcoin.png?1696501400", "CoinGecko: Bitcoin (bitcoin)"],
    "Ethereum": ["https://coin-images.coingecko.com/coins/images/279/large/ethereum.png?1696501628", "CoinGecko: Ethereum (ethereum)"],
    "Solana": ["https://coin-images.coingecko.com/coins/images/4128/large/solana.png?1718769756", "CoinGecko: Solana (solana)"],
    "Dogecoin": ["https://coin-images.coingecko.com/coins/images/5/large/dogecoin.png?1696501409", "CoinGecko: Dogecoin (dogecoin)"],
    "Cardano": ["https://coin-images.coingecko.com/coins/images/975/large/cardano.png?1696502090", "CoinGecko: Cardano (cardano)"],
    "XRP": ["https://coin-images.coingecko.com/coins/images/44/large/xrp-symbol-white-128.png?1696501442", "CoinGecko: XRP (ripple)"],
    "Polkadot": ["https://coin-images.coingecko.com/coins/images/12171/large/polkadot.jpg?1766533446", "CoinGecko: Polkadot (polkadot)"],
    "Avalanche": ["https://coin-images.coingecko.com/coins/images/12559/large/Avalanche_Circle_RedWhite_Trans.png?1696512369", "CoinGecko: Avalanche (avalanche-2)"],
    "Chainlink": ["https://coin-images.coingecko.com/coins/images/877/large/Chainlink_Logo_500.png?1760023405", "CoinGecko: Chainlink (chainlink)"],
    "Litecoin": ["https://coin-images.coingecko.com/coins/images/2/large/litecoin.png?1696501400", "CoinGecko: Litecoin (litecoin)"],
    "Monero": ["https://coin-images.coingecko.com/coins/images/69/large/monero_logo.png?1696501460", "CoinGecko: Monero (monero)"],
    "Uniswap": ["https://coin-images.coingecko.com/coins/images/12504/large/uniswap-logo.png?1720676669", "CoinGecko: Uniswap (uniswap)"],
    "Aave": ["https://coin-images.coingecko.com/coins/images/12645/large/aave-token-round.png?1720472354", "CoinGecko: Aave (aave)"],
    "Arbitrum": ["https://coin-images.coingecko.com/coins/images/16547/large/arb.jpg?1721358242", "CoinGecko: Arbitrum (arbitrum)"],
    "Optimism": ["https://coin-images.coingecko.com/coins/images/25244/large/Token.png?1774456081", "CoinGecko: Optimism (optimism)"],
    "TON": ["https://coin-images.coingecko.com/coins/images/17980/large/Gram_Circular_Badge.png?1781524778", "CoinGecko: Gram (prev. Toncoin) (the-open-network)"],
    "Shiba Inu": ["https://coin-images.coingecko.com/coins/images/11939/large/shiba.png?1696511800", "CoinGecko: Shiba Inu (shiba-inu)"],
    "Pepe": ["https://coin-images.coingecko.com/coins/images/29850/large/pepe-token.jpeg?1696528776", "CoinGecko: Pepe (pepe)"],
    "USDC": ["https://coin-images.coingecko.com/coins/images/6319/large/USDC.png?1769615602", "CoinGecko: USDC (usd-coin)"],
    "Tether": ["https://coin-images.coingecko.com/coins/images/325/large/Tether.png?1696501661", "CoinGecko: Tether (tether)"],
  },
  // Animes of the 2010s
  4: {
    "Attack on Titan": ["https://upload.wikimedia.org/wikipedia/en/d/d6/Shingeki_no_Kyojin_manga_volume_1.jpg", "Wikipedia: File:Shingeki_no_Kyojin_manga_volume_1.jpg (Attack on Titan)"],
    "Steins;Gate": ["https://upload.wikimedia.org/wikipedia/en/c/ca/Steins%3BGate_anime_cover.png", "Wikipedia: File:Steins;Gate_anime_cover.png (Steins;Gate (TV series))"],
    "Hunter x Hunter": ["https://upload.wikimedia.org/wikipedia/en/8/82/Hunter_%C3%97_Hunter_%282011%29.png", "Wikipedia: File:Hunter_×_Hunter_(2011).png (Hunter × Hunter (2011 TV series))"],
    "One Punch Man": ["https://upload.wikimedia.org/wikipedia/en/c/c3/OnePunchMan_manga_cover.png", "Wikipedia: File:OnePunchMan_manga_cover.png (One-Punch Man)"],
    "Mob Psycho 100": ["https://upload.wikimedia.org/wikipedia/en/4/4b/Mob_Psycho_100_manga_vol_1.jpg", "Wikipedia: File:Mob_Psycho_100_manga_vol_1.jpg (Mob Psycho 100)"],
    "Demon Slayer": ["https://thumb.wikimedia.org/wikipedia/commons/thumb/e/ec/Kimetsu_no_Yaiba_logo.svg/330px-Kimetsu_no_Yaiba_logo.svg.png", "Wikipedia: File:Kimetsu_no_Yaiba_logo.svg (Demon Slayer: Kimetsu no Yaiba (TV series))"],
    "My Hero Academia": ["https://thumb.wikimedia.org/wikipedia/commons/thumb/1/18/My_Hero_Academia_logo_in_Japan_20150106.png/330px-My_Hero_Academia_logo_in_Japan_20150106.png", "Wikipedia: File:My_Hero_Academia_logo_in_Japan_20150106.png (My Hero Academia (TV series))"],
    "JoJo's Bizarre Adventure": ["https://thumb.wikimedia.org/wikipedia/commons/thumb/6/6e/JoJo%27s_Bizarre_Adventure_logo.png/330px-JoJo%27s_Bizarre_Adventure_logo.png", "Wikipedia: File:JoJo's_Bizarre_Adventure_logo.png (JoJo's Bizarre Adventure (TV series))"],
    "Made in Abyss": ["https://upload.wikimedia.org/wikipedia/en/9/9a/Made_in_Abyss_volume_1_cover.jpg", "Wikipedia: File:Made_in_Abyss_volume_1_cover.jpg (Made in Abyss)"],
    "A Silent Voice": ["https://upload.wikimedia.org/wikipedia/en/3/32/A_Silent_Voice_Film_Poster.jpg", "Wikipedia: File:A_Silent_Voice_Film_Poster.jpg (A Silent Voice (film))"],
    "Your Name": ["https://upload.wikimedia.org/wikipedia/en/0/0b/Your_Name_poster.png", "Wikipedia: File:Your_Name_poster.png (Your Name)"],
    "Haikyuu!!": ["https://upload.wikimedia.org/wikipedia/en/6/6b/Haiky%C5%AB_Volume_1.jpg", "Wikipedia: File:Haikyū_Volume_1.jpg (Haikyu!!)"],
    "Re:Zero": ["https://thumb.wikimedia.org/wikipedia/commons/thumb/c/cb/Re_Zero_kara_Hajimeru_Isekai_Seikatsu_logo.svg/330px-Re_Zero_kara_Hajimeru_Isekai_Seikatsu_logo.svg.png", "Wikipedia: File:Re_Zero_kara_Hajimeru_Isekai_Seikatsu_logo.svg (Re:Zero (TV series))"],
    "Violet Evergarden": ["https://upload.wikimedia.org/wikipedia/en/b/be/Violet_Evergarden_light_novel_volume_1_cover.jpg", "Wikipedia: File:Violet_Evergarden_light_novel_volume_1_cover.jpg (Violet Evergarden)"],
    "Kill la Kill": ["https://upload.wikimedia.org/wikipedia/en/a/a9/Killlakillpromo.jpg", "Wikipedia: File:Killlakillpromo.jpg (Kill la Kill)"],
    "Sword Art Online": ["https://upload.wikimedia.org/wikipedia/en/3/3e/Sword_Art_Online_light_novel_volume_1_cover.jpg", "Wikipedia: File:Sword_Art_Online_light_novel_volume_1_cover.jpg (Sword Art Online)"],
    "Tokyo Ghoul": ["https://upload.wikimedia.org/wikipedia/en/e/e5/Tokyo_Ghoul_volume_1_cover.jpg", "Wikipedia: File:Tokyo_Ghoul_volume_1_cover.jpg (Tokyo Ghoul)"],
    "No Game No Life": ["https://upload.wikimedia.org/wikipedia/en/c/cd/No_Game_No_Life_light_novel_vol_1.jpg", "Wikipedia: File:No_Game_No_Life_light_novel_vol_1.jpg (No Game No Life)"],
    "The Promised Neverland": ["https://upload.wikimedia.org/wikipedia/en/4/44/The_Promised_Neverland%2C_Volume_1.jpg", "Wikipedia: File:The_Promised_Neverland,_Volume_1.jpg (The Promised Neverland)"],
  },
  // Programming languages
  6: {
    "Python": ["https://thumb.wikimedia.org/wikipedia/commons/thumb/c/c3/Python-logo-notext.svg/330px-Python-logo-notext.svg.png", "Wikipedia: File:Python-logo-notext.svg (Python (programming language))"],
    "JavaScript": ["https://thumb.wikimedia.org/wikipedia/commons/thumb/9/99/Unofficial_JavaScript_logo_2.svg/330px-Unofficial_JavaScript_logo_2.svg.png", "Wikimedia Commons: File:Unofficial JavaScript logo 2.svg"],
    "TypeScript": ["https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f5/Typescript.svg/330px-Typescript.svg.png", "Wikipedia: File:Typescript.svg (TypeScript)"],
    "Rust": ["https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d5/Rust_programming_language_black_logo.svg/330px-Rust_programming_language_black_logo.svg.png", "Wikipedia: File:Rust_programming_language_black_logo.svg (Rust (programming language))"],
    "Go": ["https://thumb.wikimedia.org/wikipedia/commons/thumb/0/05/Go_Logo_Blue.svg/330px-Go_Logo_Blue.svg.png", "Wikipedia: File:Go_Logo_Blue.svg (Go (programming language))"],
    "C": ["https://thumb.wikimedia.org/wikipedia/commons/thumb/7/72/C1stEdition.svg/330px-C1stEdition.svg.png", "Wikipedia: File:C1stEdition.svg (C (programming language))"],
    "C++": ["https://thumb.wikimedia.org/wikipedia/commons/thumb/1/18/ISO_C%2B%2B_Logo.svg/330px-ISO_C%2B%2B_Logo.svg.png", "Wikipedia: File:ISO_C++_Logo.svg (C++)"],
    "Java": ["https://thumb.wikimedia.org/wikipedia/en/thumb/3/30/Java_programming_language_logo.svg/330px-Java_programming_language_logo.svg.png", "Wikipedia: File:Java_programming_language_logo.svg (Java (programming language))"],
    "C#": ["https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d2/C_Sharp_Logo_2023.svg/330px-C_Sharp_Logo_2023.svg.png", "Wikipedia: File:C_Sharp_Logo_2023.svg (C Sharp (programming language))"],
    "Ruby": ["https://thumb.wikimedia.org/wikipedia/commons/thumb/7/73/Ruby_logo.svg/330px-Ruby_logo.svg.png", "Wikipedia: File:Ruby_logo.svg (Ruby (programming language))"],
    "PHP": ["https://thumb.wikimedia.org/wikipedia/commons/thumb/2/27/PHP-logo.svg/330px-PHP-logo.svg.png", "Wikipedia: File:PHP-logo.svg (PHP)"],
    "Swift": ["https://thumb.wikimedia.org/wikipedia/commons/thumb/9/9d/Swift_logo.svg/330px-Swift_logo.svg.png", "Wikimedia Commons: File:Swift logo.svg"],
    "Kotlin": ["https://thumb.wikimedia.org/wikipedia/commons/thumb/3/3a/Kotlin_icon_%282021-present%29.svg/330px-Kotlin_icon_%282021-present%29.svg.png", "Wikimedia Commons: File:Kotlin icon (2021-present).svg"],
    "Haskell": ["https://thumb.wikimedia.org/wikipedia/commons/thumb/1/1c/Haskell-Logo.svg/330px-Haskell-Logo.svg.png", "Wikimedia Commons: File:Haskell-Logo.svg"],
    "Elixir": ["https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a9/Elixir_logo_%28light_background%29.svg/330px-Elixir_logo_%28light_background%29.svg.png", "Wikipedia: File:Elixir_logo_(light_background).svg (Elixir (programming language))"],
    "Zig": ["https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b3/Zig_logo_2020.svg/330px-Zig_logo_2020.svg.png", "Wikipedia: File:Zig_logo_2020.svg (Zig (programming language))"],
    "Lua": ["https://thumb.wikimedia.org/wikipedia/commons/thumb/c/cf/Lua-Logo.svg/330px-Lua-Logo.svg.png", "Wikipedia: File:Lua-Logo.svg (Lua)"],
    "Bash": ["https://thumb.wikimedia.org/wikipedia/commons/thumb/8/82/Gnu-bash-logo.svg/330px-Gnu-bash-logo.svg.png", "Wikipedia: File:Gnu-bash-logo.svg (Bash (Unix shell))"],
  },
  // Breakfast cereals, definitively
  11: {
    "Frosted Flakes": ["https://thumb.wikimedia.org/wikipedia/commons/thumb/7/7e/Frostedflakes_brand_logo.png/330px-Frostedflakes_brand_logo.png", "Wikipedia: File:Frostedflakes_brand_logo.png (Frosted Flakes)"],
    "Cheerios": ["https://thumb.wikimedia.org/wikipedia/commons/thumb/0/07/Cheerios_brand_logo.svg/330px-Cheerios_brand_logo.svg.png", "Wikimedia Commons: File:Cheerios brand logo.svg"],
    "Froot Loops": ["https://upload.wikimedia.org/wikipedia/en/9/9d/Frootloops_brand_logo.png", "Wikipedia: File:Frootloops_brand_logo.png (Froot Loops)"],
    "Lucky Charms": ["https://upload.wikimedia.org/wikipedia/commons/6/69/Lucky_charms_brand_logo.png", "Wikipedia: File:Lucky_charms_brand_logo.png (Lucky Charms)"],
    "Cinnamon Toast Crunch": ["https://thumb.wikimedia.org/wikipedia/commons/thumb/1/1d/Cinnamon_toastcrunch_logo.png/330px-Cinnamon_toastcrunch_logo.png", "Wikipedia: File:Cinnamon_toastcrunch_logo.png (Cinnamon Toast Crunch)"],
    "Cocoa Puffs": ["https://upload.wikimedia.org/wikipedia/en/f/ff/Cocoa_Puffs_logo.png", "Wikipedia: File:Cocoa_Puffs_logo.png (Cocoa Puffs)"],
    "Corn Flakes": ["https://thumb.wikimedia.org/wikipedia/commons/thumb/1/17/Kellogs-cornflakes-logo.svg/330px-Kellogs-cornflakes-logo.svg.png", "Wikimedia Commons: File:Kellogs-cornflakes-logo.svg"],
    "Rice Krispies": ["https://thumb.wikimedia.org/wikipedia/commons/thumb/5/59/Rice_Krispies_logo.svg/330px-Rice_Krispies_logo.svg.png", "Wikipedia: File:Rice_Krispies_logo.svg (Rice Krispies)"],
    "Raisin Bran": ["https://upload.wikimedia.org/wikipedia/en/e/ef/Kellogg%27s_Raisin_Bran.png", "Wikipedia: File:Kellogg's Raisin Bran.png"],
    "Cap'n Crunch": ["https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d4/Capcrunch_textlogo.png/330px-Capcrunch_textlogo.png", "Wikipedia: File:Capcrunch_textlogo.png (Cap'n Crunch)"],
    "Honey Nut Cheerios": ["https://upload.wikimedia.org/wikipedia/en/c/c4/Honey_nut_cheerios_%28revised%29.jpg", "Wikipedia: File:Honey_nut_cheerios_(revised).jpg (Honey Nut Cheerios)"],
    "Trix": ["https://upload.wikimedia.org/wikipedia/commons/6/6b/Trix_brand_logo.png", "Wikipedia: File:Trix_brand_logo.png (Trix (cereal))"],
    "Special K": ["https://thumb.wikimedia.org/wikipedia/commons/thumb/0/03/Specialk_brand_logo.png/330px-Specialk_brand_logo.png", "Wikipedia: File:Specialk_brand_logo.png (Special K)"],
    "Shredded Wheat": ["https://upload.wikimedia.org/wikipedia/commons/8/8b/Shredded_wheat_brand_logo.png", "Wikimedia Commons: File:Shredded wheat brand logo.png"],
    "Fruity Pebbles": ["https://upload.wikimedia.org/wikipedia/en/6/62/Pebbles_cereal_brand_logo.png", "Wikipedia: File:Pebbles_cereal_brand_logo.png (Pebbles (cereal))"],
  },
  // L1s by vibes
  12: {
    "Ethereum": ["https://coin-images.coingecko.com/coins/images/279/large/ethereum.png?1696501628", "CoinGecko: Ethereum (ethereum)"],
    "Solana": ["https://coin-images.coingecko.com/coins/images/4128/large/solana.png?1718769756", "CoinGecko: Solana (solana)"],
    "Bitcoin": ["https://coin-images.coingecko.com/coins/images/1/large/bitcoin.png?1696501400", "CoinGecko: Bitcoin (bitcoin)"],
    "Avalanche": ["https://coin-images.coingecko.com/coins/images/12559/large/Avalanche_Circle_RedWhite_Trans.png?1696512369", "CoinGecko: Avalanche (avalanche-2)"],
    "Cardano": ["https://coin-images.coingecko.com/coins/images/975/large/cardano.png?1696502090", "CoinGecko: Cardano (cardano)"],
    "Near": ["https://coin-images.coingecko.com/coins/images/10365/large/near.jpg?1696510367", "CoinGecko: NEAR Protocol (near)"],
    "Aptos": ["https://coin-images.coingecko.com/coins/images/26455/large/Aptos-Network-Profile-Picture_%281%29.png?1788259511", "CoinGecko: Aptos (aptos)"],
    "Sui": ["https://coin-images.coingecko.com/coins/images/26375/large/sui-ocean-square.png?1727791290", "CoinGecko: Sui (sui)"],
    "TON": ["https://coin-images.coingecko.com/coins/images/17980/large/Gram_Circular_Badge.png?1781524778", "CoinGecko: Gram (prev. Toncoin) (the-open-network)"],
    "Polkadot": ["https://coin-images.coingecko.com/coins/images/12171/large/polkadot.jpg?1766533446", "CoinGecko: Polkadot (polkadot)"],
    "Cosmos": ["https://coin-images.coingecko.com/coins/images/1481/large/cosmos_hub.png?1696502525", "CoinGecko: Cosmos Hub (cosmos)"],
    "Tezos": ["https://coin-images.coingecko.com/coins/images/976/large/Tezos-logo.png?1696502091", "CoinGecko: Tezos (tezos)"],
    "Algorand": ["https://coin-images.coingecko.com/coins/images/4380/large/download.png?1696504978", "CoinGecko: Algorand (algorand)"],
    "Monad": ["https://coin-images.coingecko.com/coins/images/38927/large/mon.png?1766029057", "CoinGecko: Monad (monad)"],
    "Berachain": ["https://coin-images.coingecko.com/coins/images/25235/large/BERA.png?1738822008", "CoinGecko: Berachain (berachain-bera)"],
  },
  // Staging demo: divided opinions
  900004: {
    "Marmite": ["https://upload.wikimedia.org/wikipedia/en/c/c2/Marmite_brand_logo.png", "Wikipedia: File:Marmite_brand_logo.png (Marmite)"],
  },
};

// Write each official image onto its item. Never overwrites an image a
// person uploaded (those have no image_source); refreshes ours.
async function applyItemImages(pool, templateIds) {
  for (const [tid, byName] of Object.entries(ITEM_IMAGES)) {
    if (templateIds && !templateIds.includes(Number(tid))) continue;
    for (const [name, [url, source]] of Object.entries(byName)) {
      await pool.query(
        `UPDATE template_items SET image_url = $3, image_source = $4
         WHERE template_id = $1 AND name = $2 AND (image_url IS NULL OR image_source IS NOT NULL)`,
        [tid, name, url, source]
      );
    }
  }
}

module.exports = { ITEM_IMAGES, applyItemImages };
