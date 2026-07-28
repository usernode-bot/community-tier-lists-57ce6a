// Unit tests for the alignment scoring (issue #14). Pure functions only —
// lib/score.js must never require ./db, so `node --test` runs with no database.
const test = require('node:test');
const assert = require('node:assert');
const {
  tierCredit, finalizePct, clashThreshold, pairScore, communityScore,
} = require('./score');

const K = 5;

// Build an aggregate the way lib/aggregate.js does: items[id].dist is the count
// of placements per tier, INCLUDING the viewer's own.
function aggOf(spec, { k = K } = {}) {
  const items = {};
  let n = 0;
  for (const [id, tiers] of Object.entries(spec)) {
    const dist = Array(k).fill(0);
    let placed = 0;
    for (const t of tiers) {
      if (t == null) continue;
      dist[t - 1] += 1;
      placed++;
    }
    items[id] = { dist, placed, skipped: 0 };
    n = Math.max(n, tiers.length);
  }
  return { k, n, items };
}

function mapOf(tiers) {
  const m = {};
  tiers.forEach((t, i) => { m['i' + i] = t; });
  return m;
}

test('tierCredit: linear over the real scale width (k - 1)', () => {
  assert.deepStrictEqual([0, 1, 2, 3, 4].map((d) => tierCredit(d, 5)),
    [1, 0.75, 0.5, 0.25, 0]);
  assert.deepStrictEqual([0, 1, 2].map((d) => tierCredit(d, 3)), [1, 0.5, 0]);
  assert.deepStrictEqual([0, 1, 2, 3].map((d) => tierCredit(d, 4).toFixed(4)),
    ['1.0000', '0.6667', '0.3333', '0.0000']);
  assert.deepStrictEqual([0, 1, 2, 3, 4, 5].map((d) => tierCredit(d, 6).toFixed(2)),
    ['1.00', '0.80', '0.60', '0.40', '0.20', '0.00']);
  // Sign-agnostic, and never negative past the ends of the scale.
  assert.strictEqual(tierCredit(-3, 5), 0.25);
  assert.strictEqual(tierCredit(9, 5), 0);
});

test('clashThreshold: half the scale width', () => {
  assert.strictEqual(clashThreshold(3), 1);
  assert.strictEqual(clashThreshold(4), 2);
  assert.strictEqual(clashThreshold(5), 2);
  assert.strictEqual(clashThreshold(6), 3);
});

test('finalizePct: 100 and 0 are reserved, everything else floors into [1,99]', () => {
  assert.strictEqual(finalizePct(8, 8, { allExact: true }), 100);
  assert.strictEqual(finalizePct(0, 8, { allOpposite: true }), 0);
  // A near-perfect but not identical comparison must never read as 100.
  assert.strictEqual(finalizePct(7.999, 8), 99);
  // A near-total but not maximal disagreement must never read as 0.
  assert.strictEqual(finalizePct(0.0001, 8), 1);
  assert.strictEqual(finalizePct(0, 0), null);
});

test('pairScore: identical rankings score exactly 100', () => {
  const mine = mapOf([1, 2, 3, 4, 5, 1, 2, 3]);
  const s = pairScore(mine, mapOf([1, 2, 3, 4, 5, 1, 2, 3]), K);
  assert.strictEqual(s.alignment, 100);
  assert.strictEqual(s.compared, 8);
  assert.strictEqual(s.exact, 8);
  assert.strictEqual(s.clashes, 0);
});

test('pairScore: a fully inverted ranking scores exactly 0 (not 20)', () => {
  const s = pairScore(mapOf([1, 1, 1, 5, 5]), mapOf([5, 5, 5, 1, 1]), K);
  assert.strictEqual(s.alignment, 0);
  assert.strictEqual(s.clashes, 5);
});

test('pairScore: one tier off on every item scores 75', () => {
  const mine = mapOf(Array(20).fill(2));
  const theirs = mapOf(Array(20).fill(3));
  const s = pairScore(mine, theirs, K);
  assert.strictEqual(s.alignment, 75);
  assert.strictEqual(s.near, 20);
  assert.strictEqual(s.clashes, 0);
});

test('pairScore: a single adjacent difference on a long list caps at 99', () => {
  const mine = mapOf(Array(100).fill(2));
  const theirs = mapOf(Array(100).fill(2).map((t, i) => (i === 0 ? 3 : t)));
  assert.strictEqual(pairScore(mine, theirs, K).alignment, 99);
});

test('pairScore: 160 items with one S<->D clash must not report 100', () => {
  const mine = mapOf(Array(160).fill(3).map((t, i) => (i === 0 ? 5 : t)));
  const theirs = mapOf(Array(160).fill(3).map((t, i) => (i === 0 ? 1 : t)));
  const s = pairScore(mine, theirs, K);
  assert.strictEqual(s.alignment, 99);
  assert.strictEqual(s.clashes, 1);
  assert.notStrictEqual(s.alignment, 100);
});

// The issue as reported: "I put something in D that they put in S, and I put
// something in S that they put in C" — and the app said 100%.
test('regression #14: head-to-head over the reported case', () => {
  const mine = { x: 5, y: 1, a: 2, b: 2, c: 3, d: 3, e: 4, f: 1 };
  const theirs = { x: 1, y: 4, a: 2, b: 2, c: 3, d: 3, e: 4, f: 1 };
  const s = pairScore(mine, theirs, K);
  assert.strictEqual(s.alignment, 78);
  assert.strictEqual(s.exact, 6);
  assert.strictEqual(s.clashes, 2);
  const byId = Object.fromEntries(s.rows.map((r) => [r.item_id, r]));
  assert.strictEqual(byId.x.credit, 0);      // D vs S — opposite ends
  assert.strictEqual(byId.y.credit, 0.25);   // S vs C — NOT agreement (was 1)
  assert.strictEqual(s.rows[0].item_id, 'x'); // worst clash sorts first
});

test('regression #14: the community reveal over the same case', () => {
  // Two rankers: me and one other. The old median-of-two tie-break made "me S /
  // them C" score as a perfect match; leave-one-out can't.
  const mine = { x: 5, y: 1, a: 2, b: 2, c: 3, d: 3, e: 4, f: 1 };
  const agg = aggOf({
    x: [5, 1], y: [1, 4], a: [2, 2], b: [2, 2],
    c: [3, 3], d: [3, 3], e: [4, 4], f: [1, 1],
  });
  const s = communityScore(mine, agg);
  assert.strictEqual(s.alignment, 78);
  assert.strictEqual(s.compared, 8);
  assert.strictEqual(s.others_n, 1);
  assert.strictEqual(s.exact, 6);
  assert.strictEqual(s.clashes, 2);
  assert.strictEqual(s.hottest.item_id, 'x');
  assert.strictEqual(s.hottest.mine, 5);
  assert.strictEqual(s.hottest.community, 1);
  assert.strictEqual(s.hottest.distance, 4);
});

test('communityScore: a solo ranker has nothing to align with', () => {
  const mine = { a: 1, b: 2, c: 5 };
  const agg = aggOf({ a: [1], b: [2], c: [5] }); // only my own votes
  assert.strictEqual(communityScore(mine, agg), null);
});

test('communityScore: my own vote never counts as a peer', () => {
  // Five others all said S; I said D. Every peer is 4 tiers away -> 0 credit,
  // and the contrarian percentile is measured over the OTHERS only.
  const mine = { a: 5 };
  const agg = aggOf({ a: [5, 1, 1, 1, 1, 1] });
  const s = communityScore(mine, agg);
  assert.strictEqual(s.alignment, 0);
  assert.strictEqual(s.compared, 1);
  assert.strictEqual(s.others_n, 5);
  assert.strictEqual(s.hottest.community, 1);
  assert.strictEqual(s.hottest.distance, 4);
  // Nobody else is as far from the median as I am -> floored at 1%.
  assert.strictEqual(s.hottest.percentile, 1);
});

test('communityScore: partial credit is distribution-weighted, not median-based', () => {
  // Two others: one at S(1), one at B(3). I am at S(1). The leave-one-out
  // median is S — identical to mine — so a median comparison would score this a
  // perfect 100%. Against the distribution it is (1 * 1 + 1 * 0.5) / 2 = 0.75.
  const s = communityScore({ a: 1 }, aggOf({ a: [1, 1, 3] }));
  assert.strictEqual(s.alignment, 75);
  assert.strictEqual(s.hottest.community, 1); // median matches me...
  assert.strictEqual(s.hottest.credit, 0.75); // ...but the crowd does not
  assert.strictEqual(s.exact, 0);
  assert.strictEqual(s.near, 1);
});

test('communityScore: a split crowd whose median lands on my tier is a clash', () => {
  // Peers at S(1) and D(5), me at S(1): median tie-breaks to S, so the old
  // median comparison scored this as total agreement. Average credit is 0.5.
  const s = communityScore({ a: 1 }, aggOf({ a: [1, 1, 5] }));
  assert.strictEqual(s.alignment, 50);
  assert.strictEqual(s.exact, 0);
  assert.strictEqual(s.clashes, 1);
});

test('communityScore: items only I placed are excluded, skips too', () => {
  const mine = { a: 1, b: null, lonely: 4 };
  const agg = aggOf({ a: [1, 1], b: [null, 2], lonely: [4] });
  const s = communityScore(mine, agg);
  assert.strictEqual(s.compared, 1); // 'b' is my skip, 'lonely' has no peers
  assert.strictEqual(s.alignment, 100);
});

test('communityScore: an all-exact crowd still reports 100', () => {
  const s = communityScore({ a: 2, b: 3 }, aggOf({ a: [2, 2, 2], b: [3, 3, 3] }));
  assert.strictEqual(s.alignment, 100);
  assert.strictEqual(s.exact, 2);
  // Nothing to be contrarian about — the UI shows "no hot takes" for this.
  assert.strictEqual(s.hottest, null);
});

test('pairScore: skips and one-sided placements are excluded from the score', () => {
  const mine = { a: 1, b: null, c: 3, d: 2 };
  const theirs = { a: 1, b: 5, c: null, e: 4 };
  const s = pairScore(mine, theirs, K);
  assert.strictEqual(s.compared, 1);
  assert.strictEqual(s.alignment, 100);
  assert.deepStrictEqual(s.rows.map((r) => r.item_id), ['a']);
});

test('pairScore: bucket counts on a 3-tier scale (any gap is a clash)', () => {
  const s = pairScore({ a: 1, b: 1, c: 2 }, { a: 1, b: 2, c: 3 }, 3);
  assert.strictEqual(s.clash_threshold, 1);
  assert.strictEqual(s.exact, 1);
  assert.strictEqual(s.near, 0);
  assert.strictEqual(s.clashes, 2);
  assert.strictEqual(s.alignment, 66); // (1 + 0.5 + 0.5) / 3 -> floor
});

test('pairScore: nothing in common yields a null alignment', () => {
  const s = pairScore({ a: 1 }, { b: 2 }, K);
  assert.strictEqual(s.alignment, null);
  assert.strictEqual(s.compared, 0);
});

test('every alignment stays inside [0, 100]', () => {
  for (const k of [3, 4, 5, 6]) {
    for (let mine = 1; mine <= k; mine++) {
      for (let theirs = 1; theirs <= k; theirs++) {
        const a = pairScore({ a: mine }, { a: theirs }, k).alignment;
        assert.ok(a >= 0 && a <= 100, `k=${k} ${mine}v${theirs} -> ${a}`);
        assert.strictEqual(a === 100, mine === theirs);
      }
    }
  }
});
