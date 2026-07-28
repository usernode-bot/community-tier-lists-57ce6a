// Alignment scoring — dependency-free on purpose (no ./db), so it can be
// unit-tested with `node --test` and no database.
//
// The old formula (100 - avg|mine - community| * 100/k, measured against a
// median computed over ALL rankings including the viewer's own) let real
// disagreements score as agreement: a solo ranker matched themselves at 100%,
// and on a two-person list `percentile_disc(0.5)` resolves every 1-1 split to
// the top tier, so "you S / them C" came out as distance 0. See issue #14.
//
// The replacement:
//   * per-item PARTIAL CREDIT, linear over the real scale width (k - 1), so
//     identical = 1.0 and opposite ends of the scale = 0.0;
//   * the community comparison is LEAVE-ONE-OUT and measured against the full
//     distribution of the other rankers, never a single median tier;
//   * 100% is reserved for identical rankings, 0% for maximal opposition.

// Credit for a placement `distance` tiers away on a k-tier scale.
// k=5: 0->1, 1->0.75, 2->0.5, 3->0.25, 4->0.
function tierCredit(distance, k) {
  if (!(k > 1)) return 1; // degenerate scale — nothing to be apart on
  const d = Math.abs(distance);
  return Math.max(0, 1 - d / (k - 1));
}

// Turn a credit sum into the displayed integer percentage.
// 100 only for an all-exact comparison, 0 only for an all-maximally-opposed
// one; everything in between floors into [1, 99] so a headline can never claim
// perfect agreement while a single item differs.
function finalizePct(creditSum, count, { allExact = false, allOpposite = false } = {}) {
  if (!count) return null;
  if (allExact) return 100;
  if (allOpposite) return 0;
  const pct = (creditSum / count) * 100;
  return Math.min(99, Math.max(1, Math.floor(pct)));
}

// A "clash" is a disagreement of at least half the scale width.
// k=5 -> 2 tiers, k=3 -> 1 tier.
function clashThreshold(k) {
  return Math.max(1, Math.ceil(((k > 1 ? k : 2) - 1) / 2));
}

// Bucket a distance for the "N exact · N one tier off · N clashes" breakdown.
function bucketOf(distance, k) {
  if (distance === 0) return 'exact';
  return distance >= clashThreshold(k) ? 'clash' : 'near';
}

// Same buckets, but for a whole crowd: `credit` is the average credit against
// every other ranker, so "exact" means EVERY one of them matched me and
// "clash" means they sit at least half a scale away on average. Bucketing the
// crowd off a single median tier would re-open the very hole in issue #14 (a
// split crowd whose median happens to land on my tier is not agreement).
function crowdBucketOf(credit, k) {
  if (credit === 1) return 'exact';
  return credit <= tierCredit(clashThreshold(k), k) ? 'clash' : 'near';
}

// Head-to-head: two {itemId: tier|null} maps. Only items BOTH placed count;
// skips (null) and items one side never saw are the caller's business.
function pairScore(mineMap, theirsMap, k) {
  const rows = [];
  let creditSum = 0, exact = 0, near = 0, clashes = 0, opposite = 0;
  for (const itemId of Object.keys(mineMap)) {
    const mine = mineMap[itemId];
    const theirs = theirsMap[itemId];
    if (mine == null || theirs == null) continue;
    const distance = Math.abs(mine - theirs);
    const credit = tierCredit(distance, k);
    creditSum += credit;
    if (credit === 0) opposite++;
    const bucket = bucketOf(distance, k);
    if (bucket === 'exact') exact++;
    else if (bucket === 'near') near++;
    else clashes++;
    rows.push({ item_id: itemId, mine, theirs, distance, credit });
  }
  rows.sort((a, b) => b.distance - a.distance || (a.item_id < b.item_id ? -1 : 1));
  const compared = rows.length;
  return {
    alignment: finalizePct(creditSum, compared, {
      allExact: compared > 0 && exact === compared,
      allOpposite: compared > 0 && opposite === compared,
    }),
    compared, exact, near, clashes,
    clash_threshold: clashThreshold(k),
    rows,
  };
}

// Discrete median of a distribution (same rule as lib/aggregate.js /
// percentile_disc(0.5)) — used here only to label the leave-one-out
// comparison point for display, never as the scoring basis.
function distMedian(dist, placed) {
  if (!placed) return null;
  const threshold = Math.ceil(placed / 2);
  let cum = 0;
  for (let t = 0; t < dist.length; t++) {
    cum += dist[t];
    if (cum >= threshold) return t + 1;
  }
  return dist.length;
}

// You vs the community, leave-one-out. `agg` is what lib/aggregate.js
// getAggregate() returns: { k, n, items: { id: { dist[], placed, ... } } }.
// Returns null when no item has at least one OTHER ranker.
function communityScore(myPlacements, agg) {
  const k = agg.k;
  let creditSum = 0, compared = 0, exact = 0, near = 0, clashes = 0, opposite = 0;
  let hottest = null;

  for (const [itemId, tier] of Object.entries(myPlacements)) {
    if (tier == null) continue; // explicit skip
    const it = agg.items[itemId];
    if (!it) continue;
    const othersDist = it.dist.slice();
    // Subtract my own vote — the aggregate counts it, the comparison must not.
    if (tier >= 1 && tier <= othersDist.length && othersDist[tier - 1] > 0) {
      othersDist[tier - 1] -= 1;
    }
    let othersPlaced = 0;
    for (const c of othersDist) othersPlaced += c;
    if (othersPlaced < 1) continue;

    let itemCredit = 0;
    for (let t = 0; t < othersDist.length; t++) {
      if (othersDist[t] > 0) itemCredit += othersDist[t] * tierCredit(tier - (t + 1), k);
    }
    itemCredit /= othersPlaced;

    const median = distMedian(othersDist, othersPlaced);
    const distance = Math.abs(tier - median);
    creditSum += itemCredit;
    compared++;
    if (itemCredit === 0) opposite++;
    const bucket = crowdBucketOf(itemCredit, k);
    if (bucket === 'exact') exact++;
    else if (bucket === 'near') near++;
    else clashes++;

    // Hottest take = the item where the crowd agrees with me least; ties go to
    // the item more people placed (a hot take on a popular item counts more).
    if (!hottest || itemCredit < hottest._credit ||
        (itemCredit === hottest._credit && othersPlaced > hottest._othersPlaced)) {
      let atLeast = 0;
      for (let t = 0; t < othersDist.length; t++) {
        if (Math.abs(t + 1 - median) >= distance) atLeast += othersDist[t];
      }
      hottest = {
        item_id: itemId, mine: tier, community: median, distance,
        credit: Math.round(itemCredit * 1000) / 1000,
        percentile: Math.max(1, Math.round((atLeast / othersPlaced) * 100)),
        _credit: itemCredit, _othersPlaced: othersPlaced,
      };
    }
  }

  if (!compared) return null;
  // Nothing to be contrarian about if even the worst item matched everyone.
  if (hottest && hottest._credit === 1) hottest = null;
  if (hottest) { delete hottest._credit; delete hottest._othersPlaced; }
  // Everyone else's rankings minus mine, when mine is in the aggregate.
  const others_n = Math.max(0, agg.n - 1);
  return {
    alignment: finalizePct(creditSum, compared, {
      allExact: exact === compared,
      allOpposite: opposite === compared,
    }),
    compared, others_n, exact, near, clashes,
    clash_threshold: clashThreshold(k),
    hottest,
  };
}

module.exports = {
  tierCredit, finalizePct, clashThreshold, bucketOf, crowdBucketOf,
  pairScore, communityScore, distMedian,
};
