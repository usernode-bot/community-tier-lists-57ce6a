// Item illustrations — original in-repo art, drawn as LAYER SPECS and
// composed by one renderer so every drawing shares the same gouache style:
//   1 base fill (saturated mid tone, wobbly silhouette)
//   2 tonal layers (light top plane, deeper shadow side — clipped to the shape)
//   3 brush texture (shared gouache filter: edge roughening, dry-brush
//     streaks, paper flecks) + explicit light streak strokes
//   4 pencil/crayon hatching (generated, seeded, clipped to the shape)
//   5 selective line (partial, broken, usually in the item's own dark hue)
//   6 paper highlights (cream, never pure white, never knocked out)
//   7 pattern + hand lettering (path alphabet — never <text>, no brands)
// Specs are rasterized ONCE per key+size and cached as bitmap URLs, so the
// turbulence filters never run in the live DOM and share images reuse the
// exact same pixels as the screen. Filters only add grain: every shape is
// geometry, so a browser that skips filters still draws the item correctly.
(function (root) {
  'use strict';

  // ---------- palette (drawings only — never themed) ----------
  // light · mid · dark · line per hue
  const PAL = {
    r: ['#F2B49A', '#D8352A', '#9E1F1A', '#7A1A14'], // tomato red
    o: ['#F6C27A', '#EE8A2A', '#C2621A', '#8A4A12'], // orange
    y: ['#F8DE7A', '#F2C230', '#D98E1E', '#8A5212'], // yellow
    g: ['#9CC77A', '#4E8A3A', '#2E5E2A', '#1F4A1E'], // leaf green
    b: ['#8FCB8A', '#3F9A4E', '#23683A', '#164A28'], // bottle green
    c: ['#DCE6F5', '#2747B8', '#1B3384', '#14286A'], // cobalt
    s: ['#C9DBF0', '#8DB4E2', '#5E8CC4', '#2E5A94'], // sky blue
    p: ['#F6D2DA', '#F0B8C8', '#D98BA0', '#C02E3C'], // pink
    v: ['#C99AD0', '#7A2E7E', '#4E1A54', '#3A1240'], // onion purple
    e: ['#EAB08F', '#B2562E', '#7E3418', '#5A2410'], // earth
    m: ['#F5EEE2', '#EFE4D2', '#C9B79E', '#8C7A68'], // mushroom / stone
    k: ['#7A7868', '#3D3832', '#2F2B27', '#1E1B18'], // olive / ink dark
  };
  const PAPER = '#FAF6EE';
  const GRAPHITE = '#3A332D';
  const col = (c) => c === 'P' ? PAPER : c === 'G' ? GRAPHITE : PAL[c[0]][+c[1]];

  // List-card palette: pastel tile backings + stack card colours.
  const TINTS = ['#AFC3B8', '#D3BEA2', '#EFE6A0', '#EBAC97', '#D2CEC7', '#EDBB8C', '#BCC8A7', '#BCCBD8', '#DCCCA3', '#EAC8C6'];

  // ---------- deterministic randomness ----------
  function hashStr(s) {
    let h = 2166136261;
    s = String(s);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- path helpers (hand-wobbled) ----------
  const n1 = (v) => (Math.round(v * 10) / 10).toString();
  const pt = (p) => n1(p[0]) + ' ' + n1(p[1]);
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

  function smoothClosed(pts) {
    const n = pts.length;
    let d = 'M' + pt(mid(pts[n - 1], pts[0]));
    for (let i = 0; i < n; i++) d += ' Q' + pt(pts[i]) + ' ' + pt(mid(pts[i], pts[(i + 1) % n]));
    return d + 'Z';
  }
  function smoothOpen(pts) {
    if (pts.length < 3) return 'M' + pt(pts[0]) + ' L' + pt(pts[pts.length - 1]);
    let d = 'M' + pt(pts[0]);
    for (let i = 1; i < pts.length - 1; i++) {
      d += ' Q' + pt(pts[i]) + ' ' + pt(i === pts.length - 2 ? pts[pts.length - 1] : mid(pts[i], pts[i + 1]));
    }
    return d;
  }
  // Wobbly closed shape through points (corners rounded by the quad smoothing).
  function shape(pts, wob = 0.35) {
    const R = rng(hashStr(JSON.stringify(pts)));
    return smoothClosed(pts.map((p) => [p[0] + (R() - 0.5) * wob, p[1] + (R() - 0.5) * wob]));
  }
  function path(pts, wob = 0.3) {
    const R = rng(hashStr('o' + JSON.stringify(pts)));
    return smoothOpen(pts.map((p) => [p[0] + (R() - 0.5) * wob, p[1] + (R() - 0.5) * wob]));
  }
  // Wobbly polygon with straight-ish edges (boxes, screens, wedges).
  function poly(pts, wob = 0.3) {
    const R = rng(hashStr('p' + JSON.stringify(pts)));
    const q = pts.map((p) => [p[0] + (R() - 0.5) * wob, p[1] + (R() - 0.5) * wob]);
    let d = 'M' + pt(mid(q[q.length - 1], q[0]));
    for (let i = 0; i < q.length; i++) {
      const a = q[i], b = q[(i + 1) % q.length], m = mid(a, b);
      const bow = (R() - 0.5) * wob * 1.5;
      d += ' Q' + pt(a) + ' ' + pt([a[0] + (b[0] - a[0]) * 0.12, a[1] + (b[1] - a[1]) * 0.12]) + ' Q' + pt([m[0] + bow, m[1] - bow]) + ' ' + pt(m);
    }
    return d + 'Z';
  }
  // Irregular ellipse — "loose, slightly imperfect" round shapes.
  function blob(cx, cy, rx, ry, wob = 0.07, n = 9, rot = 0) {
    const R = rng(hashStr([cx, cy, rx, ry, n, rot].join(',')));
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (rot + i / n * 360) * Math.PI / 180;
      const k = 1 + (R() * 2 - 1) * wob;
      pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
    }
    return smoothClosed(pts);
  }
  // Open arc along an ellipse, degrees (0 = right, 90 = down).
  function arc(cx, cy, rx, ry, a0, a1, wob = 0.04) {
    const R = rng(hashStr(['a', cx, cy, rx, ry, a0, a1].join(',')));
    const steps = Math.max(3, Math.ceil(Math.abs(a1 - a0) / 18));
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const a = (a0 + (a1 - a0) * i / steps) * Math.PI / 180;
      const k = 1 + (R() * 2 - 1) * wob;
      pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
    }
    return smoothOpen(pts);
  }
  // Pointed leaf from base (x1,y1) to tip (x2,y2).
  function leaf(x1, y1, x2, y2, w, bend = 0) {
    const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1;
    const nx = -dy / L, ny = dx / L;
    const mx = (x1 + x2) / 2 + nx * bend, my = (y1 + y2) / 2 + ny * bend;
    return `M${n1(x1)} ${n1(y1)} Q${n1(mx + nx * w)} ${n1(my + ny * w)} ${n1(x2)} ${n1(y2)} Q${n1(mx - nx * w)} ${n1(my - ny * w)} ${n1(x1)} ${n1(y1)}Z`;
  }
  function rib(x1, y1, x2, y2, bend = 0, t = 0.85) {
    const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1;
    const nx = -dy / L, ny = dx / L;
    const mx = (x1 + x2) / 2 + nx * bend, my = (y1 + y2) / 2 + ny * bend;
    return `M${n1(x1)} ${n1(y1)} Q${n1(mx)} ${n1(my)} ${n1(x1 + dx * t + nx * bend * 0.3)} ${n1(y1 + dy * t + ny * bend * 0.3)}`;
  }
  const ring = (cx, cy, rx, ry, ix, iy, ox = 0, oy = 0) => blob(cx, cy, rx, ry) + ' ' + blob(cx + ox, cy + oy, ix, iy, 0.08, 7, 20);

  // ---------- spec entry constructors ----------
  // F: fill (o opacity, clip = d to clip within, eo = even-odd for holes)
  const F = (c, d, o = 1, clip = null, eo = false) => ({ c, d, o, clip, eo });
  // S: brush stroke inside the paint layer (streaks, thick strokes)
  const S = (c, d, w = 1, o = 1, clip = null) => ({ c, d, w, o, clip });
  // H: crayon hatching clipped to `clip`, filling box [x,y,w,h]
  const H = (c, clip, box, a = 45, n = 7, o = 0.75, cross = false) => ({ c, clip, box, a, n, o, cross });
  // L: selective line
  const L = (c, d, w = 1.1, o = 1) => ({ c, d, w, o });
  // P: paper highlight (stroke when w given, else fill)
  const P = (d, o = 0.85, w = 0) => ({ d, o, w });
  // D: pattern / detail stroke-or-fill; T: hand lettering
  const D = (c, d, w = 0.8, o = 1, fill = false) => ({ c, d, w, o, fill });
  const T = (text, x, y, s, c, r = 0) => ({ text, x, y, s, c, r });

  function merge(...parts) {
    const out = { f: [], h: [], l: [], p: [], d: [] };
    for (const part of parts) for (const k of Object.keys(out)) if (part[k]) out[k].push(...part[k]);
    return out;
  }

  // A painted round thing: base, light plane, clipped shadow crescent,
  // streaks, hatching on the shadow side, a broken line, a paper shine.
  function ball(cx, cy, rx, ry, hue, o = {}) {
    const base = blob(cx, cy, rx, ry, o.wob == null ? 0.07 : o.wob);
    const out = {
      f: [
        F(hue + '1', base),
        F(hue + '0', blob(cx - rx * 0.4, cy - ry * 0.45, rx * 0.6, ry * 0.45), 0.5, base),
        F(hue + '2', blob(cx + rx * 0.5, cy + ry * 0.55, rx * 0.95, ry * 0.85), o.shade == null ? 0.75 : o.shade, base),
        S(hue + '0', arc(cx, cy, rx * 0.72, ry * 0.72, 195, 250), Math.max(0.6, rx * 0.09), 0.45),
      ],
      h: o.hatch === 0 ? [] : [H(hue + '2', base, [cx, cy - ry * 0.1, rx * 1.05, ry * 1.1], o.ha || 50, o.hatch || Math.round(rx * 0.6) + 2, 0.7)],
      l: o.line === false ? [] : [
        L(o.lc || hue + '3', arc(cx, cy, rx * 1.01, ry * 1.01, o.la || 115, o.lb || 215)),
        L(o.lc || hue + '3', arc(cx, cy, rx * 1.01, ry * 1.01, (o.lb || 215) + 95, (o.lb || 215) + 125), 0.9, 0.8),
      ],
      p: o.shine === false ? [] : [P(arc(cx, cy, rx * 0.6, ry * 0.6, 200, 238), 0.85, Math.max(0.7, rx * 0.13))],
    };
    return out;
  }

  // Bowl seen from the side (cobalt, pale wave pattern — after the gouache
  // sheet's blue plate). `fill` draws what's inside at the rim.
  function bowl(fill) {
    const bodyD = shape([[4, 20], [36, 20], [34, 28], [27, 34], [13, 34], [6, 28]], 0.4);
    const rim = blob(20, 20, 16, 4.2, 0.03, 10);
    return merge(
      {
        f: [
          F('c1', bodyD),
          F('c2', blob(30, 30, 12, 10), 0.7, bodyD),
          S('c0', path([[8, 23], [12, 27], [17, 29]]), 1, 0.35, bodyD),
          F('k1', blob(20, 34.3, 5.5, 1.3), 0.9),
          F(fill[0], rim),
          F(fill[1], blob(24, 21.5, 11, 3), 0.55, rim),
        ],
        h: [H('c2', bodyD, [26, 27, 18, 10], 40, 6, 0.7)],
        l: [L('c3', path([[4.2, 20.5], [5.5, 26], [9, 30.5]]), 1.1), L('c3', path([[25, 33.8], [30, 31.5]]), 1, 0.85)],
        d: [D('c0', 'M7.5 24.5 q2 2 4 0 q2 2 4 0 q2 2 4 0 q2 2 4 0 q2 2 4 0 q2 2 4 0', 0.9, 0.95)],
        p: [P(path([[9, 22.6], [14, 23.4]]), 0.75, 1.1)],
      },
    );
  }

  function plate(cx, cy, rx, ry, hue = 'c') {
    const d = blob(cx, cy, rx, ry, 0.04, 11);
    const inner = blob(cx, cy - 0.3, rx * 0.74, ry * 0.7, 0.04, 9);
    return {
      f: [F(hue + '1', d), F(hue + '2', blob(cx + rx * 0.5, cy + ry * 0.6, rx, ry), 0.6, d), F(hue + '0', inner, 0.35)],
      l: [L(hue + '3', arc(cx, cy, rx, ry, 140, 200), 1)],
      d: [D(hue + '0', arc(cx, cy, rx * 0.87, ry * 0.85, 200, 340), 0.7, 0.8)],
    };
  }

  // ---------- the drawings (40-unit viewBox) ----------
  const ILLOS = {};
  const SPECS = {};
  const def = (key, fn) => { ILLOS[key] = fn; };
  const specOf = (key) => SPECS[key] || (SPECS[key] = ILLOS[key]());

  // Pizza toppings (production day-one Today's List)
  def('pepperoni', () => merge(
    ball(14.5, 16, 10, 9.5, 'r', { la: 120, lb: 210 }),
    { f: [F('r0', blob(11, 13, 1.6, 1.3)), F('r0', blob(17, 12, 1.2, 1)), F('r0', blob(13, 19.5, 1.3, 1.1)), F('r0', blob(19, 18, 1, 0.9))] },
    ball(25.5, 25, 10.5, 10, 'r', { la: 60, lb: 150, hatch: 6 }),
    { f: [F('r0', blob(22, 21, 1.7, 1.4), 0.9), F('r0', blob(28.5, 22, 1.3, 1.1), 0.9), F('r0', blob(25, 28.5, 1.5, 1.2), 0.9), F('r0', blob(30, 27, 1.1, 1), 0.9)] },
  ));

  def('mushrooms', () => {
    const cap = shape([[5, 21], [6.5, 12], [13, 7], [20, 6], [28, 7.5], [33.5, 12], [35, 21], [20, 23]], 0.5);
    const stem = shape([[15, 21.5], [14, 33], [20, 35.5], [26, 33], [25, 21.5]], 0.4);
    return {
      f: [
        F('m0', stem),
        F('m2', blob(27, 30, 5, 8), 0.7, stem),
        F('m1', cap),
        F('m2', blob(31, 19, 13, 9), 0.8, cap),
        F('e0', blob(14, 11, 7, 3.5), 0.35, cap),
        F('m3', shape([[7, 20.5], [13, 18.5], [27, 18.5], [33, 20.5], [20, 22.8]], 0.3), 0.8),
      ],
      h: [H('m3', stem, [24, 28, 6, 12], 60, 5, 0.65), H('m3', cap, [29, 14, 10, 10], 45, 6, 0.6)],
      l: [
        L('G', path([[5.2, 20.5], [6.4, 13], [12, 7.8], [20, 6.3], [26, 6.9]]), 1.15),
        L('G', path([[14.2, 23], [13.9, 31.5]]), 1),
        L('G', path([[33.6, 13], [34.6, 18]]), 0.9, 0.7),
      ],
      d: [D('m3', 'M10 20.2 l1 1.6 M13 19.8 l.7 2 M16 19.6 l.4 2.3 M24 19.6 l-.4 2.3 M27 19.8 l-.7 2 M30 20.2 l-1 1.6', 0.7, 0.9),
        D('m2', blob(18, 11, 1.2, 0.8), 0, 0.8, true), D('m2', blob(24, 13, 0.9, 0.7), 0, 0.8, true)],
      p: [P(path([[9, 14], [13, 10], [18, 8.4]]), 0.85, 1.4)],
    };
  });

  def('pineapple', () => {
    const body = blob(20, 25.5, 10, 12, 0.05, 11);
    return merge(
      {
        f: [
          F('g2', leaf(20, 15, 11, 3.5, 2.2, -1)), F('g1', leaf(20, 15, 28.5, 3, 2.2, 1)),
          F('b1', leaf(20, 15, 20, 1.5, 2.4)), F('g1', leaf(20, 15.5, 13.5, 7.5, 2, -0.5)), F('b2', leaf(20, 15.5, 26.5, 8, 2, 0.5)),
        ],
        l: [L('g3', rib(20, 15, 11, 3.5, -1), 0.8), L('g3', rib(20, 15, 20, 1.5), 0.8)],
      },
      ball(20, 25.5, 10, 12, 'y', { hatch: 0, la: 140, lb: 230, lc: 'y3' }),
      {
        h: [H('o2', body, [20, 25.5, 20, 24], 45, 7, 0.75), H('o2', body, [20, 25.5, 20, 24], 135, 7, 0.75)],
        d: [D('e2', 'M15 19 l1 1.4 1-1.4 M21 19 l1 1.4 1-1.4 M18 24 l1 1.4 1-1.4 M24 24 l1 1.4 1-1.4 M13 24.5 l.8 1.2 .8-1.2 M15 29 l1 1.4 1-1.4 M21 29 l1 1.4 1-1.4 M18 33.5 l1 1.2 1-1.2', 0.8, 0.9)],
      },
    );
  });

  def('extra-cheese', () => {
    const top = poly([[7, 23], [10, 15.5], [31, 12], [33.5, 16]], 0.3);
    const side = poly([[7, 23], [33.5, 16], [33.5, 25], [8, 30.5]], 0.3);
    return merge(
      plate(20, 30.5, 17, 5.2, 'c'),
      {
        f: [
          F('y1', side), F('y2', blob(30, 28, 12, 8), 0.65, side),
          F('y0', top),
          F('y2', blob(15, 25, 2.2, 1.6), 0.9, side), F('y2', blob(24, 22.5, 1.8, 1.3), 0.9, side), F('y2', blob(29.5, 25, 1.4, 1.8), 0.8, side),
          F('y1', blob(19, 15.5, 1.8, 0.8), 0.9),
        ],
        h: [H('y2', side, [27, 24, 14, 12], 55, 6, 0.6)],
        l: [L('G', path([[7, 23.3], [10, 15.5], [24, 13.2]]), 1.1), L('G', path([[8.3, 30.4], [20, 27.8]]), 0.9, 0.7)],
        p: [P(path([[11.5, 16.5], [20, 15]]), 0.8, 1.2)],
      },
    );
  });

  def('sausage', () => {
    const body = shape([[5, 26], [6, 18], [12, 12], [22, 9], [32, 10.5], [35.5, 14.5], [32, 17.5], [23, 17], [15, 21], [11, 28], [7, 29]], 0.4);
    const cut = blob(30.5, 27, 6, 6);
    return merge(
      {
        f: [F('e1', body), F('e2', blob(20, 22, 14, 7), 0.75, body), S('e0', path([[9, 19], [14, 13.6], [22, 11], [30, 11.3]]), 1.6, 0.6, body)],
        h: [H('e2', body, [16, 18, 18, 10], 120, 7, 0.7)],
        l: [L('e3', path([[5.2, 25.5], [6.3, 18.3], [11.6, 12.5]]), 1.15), L('e3', path([[11.5, 27.5], [15.5, 21.5]]), 1, 0.8)],
        p: [P(path([[9.5, 17], [13, 13.4]]), 0.85, 1.2)],
      },
      ball(30.5, 27, 6, 6, 'e', { shine: false, hatch: 0, la: 100, lb: 190 }),
      {
        f: [F('p1', blob(30.3, 26.8, 4.4, 4.4))],
        d: [D('p0', blob(29, 25.5, 0.7, 0.6), 0, 1, true), D('e2', blob(31.5, 28, 0.7, 0.6), 0, 1, true), D('p0', blob(32, 25.5, 0.6, 0.5), 0, 1, true), D('e2', blob(28.8, 28.4, 0.5, 0.5), 0, 1, true)],
      },
    );
  });

  def('onions', () => {
    const bulb = shape([[20, 7], [22, 11.5], [29, 15], [33, 22], [30.5, 30], [20, 34.5], [9.5, 30], [7, 22], [11, 15], [18, 11.5]], 0.4);
    return merge(
      {
        f: [F('v1', bulb), F('v0', blob(14, 18, 6, 7), 0.45, bulb), F('v2', blob(28, 28, 11, 10), 0.75, bulb)],
        h: [H('v2', bulb, [26, 25, 12, 14], 40, 6, 0.65)],
        l: [L('v3', path([[9.8, 30], [7.2, 22.5], [10.8, 15.3], [17.5, 11.8]]), 1.15), L('v3', path([[30, 30.5], [26, 33]]), 1, 0.8)],
        d: [
          D('v0', 'M20 10 Q13 18 16 34 M20 10 Q27 18 24 34 M20 10 Q8 17 11 30.5 M20 10 Q32 17 29 30.5 M20 10 L20 34.5', 0.75, 0.75),
          D('m2', path([[20, 7.5], [19, 4.5], [20.5, 2.5]]), 1.1, 1), D('m3', path([[20.5, 7.5], [22, 4]]), 0.8, 0.9),
          D('G', 'M18 34.6 l-1 1.6 M20 34.8 l0 1.8 M22 34.6 l1 1.6', 0.7, 0.9),
        ],
        p: [P(path([[12.5, 19], [11.6, 23.5], [12.4, 27]]), 0.75, 1.3)],
      },
    );
  });

  def('black-olives', () => {
    const o1 = ring(14, 18, 8, 9, 2.6, 3, 0.4, 0);
    const o2 = ring(26.5, 24, 8, 9, 2.6, 3, 0.3, 0.2);
    return {
      f: [
        F('k1', o1, 1, null, true), F('k2', blob(18, 23, 8, 8), 0.8, blob(14, 18, 8, 9)),
        F('k1', o2, 1, null, true), F('k2', blob(30.5, 29, 8, 8), 0.8, blob(26.5, 24, 8, 9)),
        F('g1', blob(9, 31, 3.5, 2), 0.9),
        F('g2', leaf(6, 33, 13, 29.5, 1.6), 0.9),
      ],
      h: [H('k0', blob(26.5, 24, 8, 9), [29, 27, 8, 10], 45, 5, 0.55)],
      l: [L('k0', arc(14, 18, 8.2, 9.2, 150, 230), 1), L('k0', arc(26.5, 24, 8.2, 9.2, 60, 120), 0.9)],
      p: [P(arc(14, 18, 5.6, 6.4, 205, 245), 0.85, 1.3), P(arc(26.5, 24, 5.6, 6.4, 205, 240), 0.8, 1.2)],
      darkLine: true,
    };
  });

  def('green-peppers', () => {
    const body = shape([[10, 13], [16, 10.5], [20, 12], [24, 10.5], [30, 13], [32.5, 22], [29, 32], [24, 35], [20, 33], [16, 35], [11, 32], [7.5, 22]], 0.4);
    return {
      f: [
        F('g1', body), F('g0', blob(13, 18, 4, 9), 0.45, body), F('g2', blob(28, 27, 9, 12), 0.75, body),
        F('g2', shape([[19, 13], [21, 13], [20.6, 34], [19.4, 34]], 0.2), 0.45, body),
        S('b2', path([[20, 12.5], [20.5, 8], [23.5, 5]]), 2.4, 1),
      ],
      h: [H('g2', body, [26, 24, 12, 22], 60, 7, 0.7)],
      l: [L('g3', path([[10.2, 13.5], [7.8, 22], [10.8, 31.5]]), 1.15), L('g3', path([[29, 32.5], [25, 34.8]]), 1, 0.8)],
      p: [P(path([[12.5, 16], [11.8, 21], [12.4, 27]]), 0.85, 1.6), P(path([[22.5, 15], [23, 19]]), 0.6, 0.9)],
    };
  });

  def('bacon', () => {
    const strip = (y) => shape([[4, y + 4], [9, y], [15, y + 3], [21, y + 6], [27, y + 3], [32, y], [36, y + 3.5], [36, y + 9], [31, y + 6], [26, y + 9], [20, y + 12], [14, y + 9], [9, y + 6.5], [4, y + 9.5]], 0.3);
    const wave = (y, off = 0) => path([[4.5, y + 6.5 + off], [9, y + 3.2 + off], [15, y + 6 + off], [21, y + 9 + off], [27, y + 6 + off], [32, y + 3 + off], [35.5, y + 6.3 + off]], 0.2);
    const s1 = strip(6), s2 = strip(19);
    return {
      f: [
        F('e0', s1), S('r1', wave(6), 2.6, 1, s1), S('r2', wave(6, 2.2), 1, 0.7, s1), S('m0', wave(6, -1.6), 1, 0.9, s1),
        F('e0', s2), S('r1', wave(19), 2.6, 1, s2), S('r2', wave(19, 2.2), 1, 0.7, s2), S('m0', wave(19, -1.6), 1, 0.9, s2),
        F('r2', blob(28, 30, 10, 4), 0.35, s2),
      ],
      h: [H('r2', s2, [27, 27, 16, 8], 70, 5, 0.6)],
      l: [L('r3', path([[4.3, 13.8], [4.2, 10], [9, 6.3], [14.5, 9]]), 1.1), L('r3', path([[26, 28], [31, 25.2], [35.7, 28]]), 1, 0.85)],
      p: [P(path([[8, 8.3], [12, 7.8]]), 0.8, 0.9)],
    };
  });

  def('fresh-basil', () => ({
    f: [
      F('g2', leaf(19, 34, 8, 13, 8, -2)),
      F('g1', leaf(20, 34, 31, 10, 8.5, 2)),
      F('b1', leaf(20, 34, 19.5, 14, 6, 0.5), 0.95),
      F('g2', blob(26, 22, 6, 8), 0.5, leaf(20, 34, 31, 10, 8.5, 2)),
      S('g0', path([[22, 26], [26, 19], [28, 13]]), 1, 0.5, leaf(20, 34, 31, 10, 8.5, 2)),
    ],
    h: [H('g3', leaf(19, 34, 8, 13, 8, -2), [12, 23, 10, 14], 30, 6, 0.6), H('g2', leaf(20, 34, 31, 10, 8.5, 2), [27, 21, 8, 14], 60, 5, 0.6)],
    l: [L('g3', rib(19, 34, 8, 13, -2), 0.9), L('g3', rib(20, 34, 31, 10, 2), 0.9), L('g3', path([[20, 34], [20, 37.5]]), 1.3)],
    p: [P(path([[23, 24], [26.5, 17.5]]), 0.7, 1.1), P(path([[11, 18], [13.5, 22]]), 0.6, 0.9)],
  }));

  def('anchovies', () => {
    const fish = (y, s = 1) => shape([[4, y], [10, y - 4 * s], [21, y - 5 * s], [30, y - 3.5 * s], [36, y], [30, y + 3 * s], [21, y + 4.2 * s], [10, y + 3.6 * s]], 0.3);
    const f1 = fish(15), f2 = fish(27, 0.9);
    const tail = (y) => `M4.5 ${y} L1 ${y - 4} Q2.6 ${y} 1 ${y + 4} Z`;
    const scales = (y) => `M11 ${y - 2} q1.4 1.4 0 2.8 M14 ${y - 3} q1.6 2 0 4.4 M17 ${y - 3.4} q1.7 2.4 0 5.2 M20 ${y - 3.4} q1.7 2.4 0 5.2 M23 ${y - 3.2} q1.6 2.2 0 4.8 M26 ${y - 2.6} q1.4 2 0 4 M12.5 ${y + 1} q1.2 1.2 0 2.2 M15.5 ${y + 1.4} q1.3 1.3 0 2.4 M18.5 ${y + 1.8} q1.3 1.2 0 2.2 M21.5 ${y + 1.8} q1.3 1.2 0 2.2`;
    return {
      f: [F('c0', f1), F('s0', blob(24, 18, 12, 3), 0.6, f1), F('c0', tail(15)), F('c0', f2), F('s0', blob(24, 30, 12, 3), 0.6, f2), F('c0', tail(27))],
      h: [H('c1', f1, [20, 18, 22, 4], 20, 6, 0.45), H('c1', f2, [20, 30, 22, 4], 20, 6, 0.45)],
      l: [
        L('c1', 'M4.3 15 Q10 10.6 21 10 Q30 11 35.8 15 Q30 18.2 21 19.3 Q10 18.8 4.3 15', 1.05),
        L('c1', tail(15), 0.95),
        L('c1', 'M4.3 27 Q10 23.4 21 22.6 Q30 23.6 35.8 27 Q30 29.8 21 30.9 Q10 30.4 4.3 27', 1.05),
        L('c1', tail(27), 0.95),
        L('c1', 'M17 10.2 l2.5 -3.6 2.4 3.6 M18 19.2 l2 2.6 1.6 -2.4 M17 22.8 l2.4 -3.4 2.2 3.4', 0.9),
      ],
      d: [
        D('c1', scales(15), 0.75, 0.95), D('c1', scales(27), 0.7, 0.95),
        D('c1', blob(31.5, 14.2, 0.9, 0.9), 0, 1, true), D('c1', blob(31.5, 26.2, 0.8, 0.8), 0, 1, true),
        D('c1', 'M28.6 12.6 q-1.2 2.4 0 4.6 M28.6 24.6 q-1.1 2.2 0 4.2', 0.8, 0.95),
      ],
    };
  });

  def('jalapenos', () => {
    const chili = shape([[8, 10], [13, 8.5], [20, 13], [27, 22], [33, 30], [35, 35], [29, 33], [21, 26], [12, 18], [7.5, 13]], 0.35);
    return merge(
      {
        f: [F('b1', chili), F('b2', blob(26, 30, 10, 6, 0.07, 9, 35), 0.75, chili), S('b0', path([[11, 11.5], [18, 15], [25, 22.5]]), 1.1, 0.55, chili), S('g2', path([[9, 10.5], [6, 7], [6.5, 3.5]]), 2.2)],
        h: [H('b2', chili, [25, 26, 12, 12], 80, 6, 0.65)],
        l: [L('b3', path([[7.7, 13.5], [12, 18.5], [21, 26.3]]), 1.1)],
        p: [P(path([[12.5, 11.2], [18, 14.3]]), 0.85, 1.1)],
      },
      ball(13, 29.5, 6.5, 6.3, 'b', { hatch: 0, shine: false, la: 130, lb: 210 }),
      { f: [F('y0', blob(13, 29.5, 4.2, 4), 0.95)], d: [D('m1', blob(12, 28.5, 0.8, 0.6), 0, 1, true), D('m1', blob(14.4, 30.4, 0.8, 0.6), 0, 1, true), D('m1', blob(12.4, 31.2, 0.6, 0.5), 0, 1, true), D('b2', arc(13, 29.5, 4.2, 4, 0, 360), 0.6, 0.6)] },
    );
  });

  def('ham', () => {
    const s1 = shape([[5, 16], [10, 9], [20, 7], [30, 9.5], [34, 16], [30, 22], [20, 24], [9, 22]], 0.4);
    const s2 = shape([[8, 25], [14, 19.5], [24, 18.5], [33, 21], [36, 27], [31, 33], [21, 35], [11, 32]], 0.4);
    return {
      f: [
        F('p1', s1), F('p2', blob(27, 20, 12, 6), 0.6, s1), S('P', arc(19.5, 15.5, 14, 8, 190, 340), 1.5, 0.9, s1),
        F('p1', s2), F('p2', blob(30, 31, 12, 6), 0.65, s2), S('P', arc(22, 27, 13.5, 7.8, 170, 350), 1.5, 0.95, s2),
      ],
      h: [H('p2', s2, [28, 30, 14, 8], 30, 6, 0.6)],
      l: [L('p3', path([[5.2, 16.3], [10, 9.3], [17, 7.4]]), 0.9, 0.8), L('p3', path([[8.2, 25.3], [11, 31.8], [18, 34.6]]), 1, 0.85)],
      d: [D('p0', path([[13, 14], [17, 12.5], [21, 14.5]]), 0.8, 0.9), D('p0', path([[18, 27], [22, 25], [27, 26.8]]), 0.8, 0.9), D('p2', path([[23, 30], [26, 29]]), 0.7, 0.8)],
    };
  });

  def('cherry-tomatoes', () => merge(
    { f: [S('g1', path([[4, 6], [12, 9], [20, 8], [28, 11], [36, 9]]), 1.6), S('g2', path([[12, 9], [12.5, 15]]), 1.2), S('g2', path([[22, 8.5], [24, 13]]), 1.2), S('g2', path([[30, 10.5], [29, 21]]), 1.2)] },
    ball(12, 21, 7.5, 7.2, 'r', { la: 120, lb: 210 }),
    ball(25, 18, 7.2, 7, 'r', { la: 100, lb: 190, hatch: 5 }),
    ball(19, 31.5, 7, 6.8, 'r', { la: 130, lb: 220, hatch: 5 }),
    {
      d: [
        D('g1', 'M12 14.5 l-3 -1.4 M12 14.5 l3 -1.5 M12 14.5 l-1 -3 M12 14.5 l2 -2.6', 1.1), D('g1', 'M24.5 11.5 l-3 -.6 M24.5 11.5 l2.8 -1 M24.5 11.5 l.3 -2.6', 1.1),
        D('g2', path([[18, 24.5], [16, 22.5]]), 1), D('g1', 'M19 24.8 l-2.6 -1.2 M19 24.8 l2.6 -1.4', 1),
      ],
    },
  ));

  def('spinach', () => {
    const lv = [leaf(20, 27, 9.5, 8, 7.5, -1), leaf(20, 27, 30.5, 7, 7.5, 1.5), leaf(20, 26, 20, 4, 6.5), leaf(20, 28, 6, 20, 5.5, -1), leaf(20, 28, 34, 19, 5.5, 1)];
    return {
      f: [
        F('g2', lv[3]), F('b2', lv[4]), F('g1', lv[0]), F('b1', lv[1]), F('g1', lv[2]),
        F('g2', blob(24, 15, 8, 8), 0.5, lv[1]), F('g2', blob(17, 18, 6, 8), 0.45, lv[0]),
        S('g0', path([[20, 26], [26, 14]]), 0.9, 0.5, lv[1]),
        S('g0', path([[18.5, 26.5], [17.5, 37]]), 1.2), S('g0', path([[20, 26.5], [20.5, 38]]), 1.2), S('g0', path([[21.5, 26.5], [23.5, 37]]), 1.2),
        F('r1', shape([[16.5, 28], [24, 28], [24, 31], [16.5, 31]], 0.3)),
      ],
      h: [H('g3', lv[0], [14, 16, 10, 14], 35, 6, 0.55), H('g3', lv[1], [27, 14, 10, 14], 60, 6, 0.55), H('r2', shape([[16.5, 28], [24, 28], [24, 31], [16.5, 31]], 0.3), [20, 29.5, 8, 3], 80, 4, 0.6)],
      l: [L('g3', rib(20, 27, 9.5, 8, -1), 0.8), L('g3', rib(20, 27, 30.5, 7, 1.5), 0.8), L('g3', rib(20, 26, 20, 4), 0.8)],
      p: [P(path([[12, 11], [14.5, 15]]), 0.6, 1), P(path([[19.4, 8], [19.6, 13]]), 0.6, 0.9)],
    };
  });

  def('garlic', () => {
    const bulb = shape([[20, 6], [22, 11], [28, 15], [33, 22], [30.5, 30], [20, 34], [9.5, 30], [7, 22], [12, 15], [18, 11]], 0.4);
    return {
      f: [F('m0', bulb), F('v0', blob(28, 25, 6, 9), 0.55, bulb), F('m2', blob(28, 30, 10, 7), 0.6, bulb), F('m1', blob(14, 22, 5, 8), 0.5, bulb)],
      h: [H('m3', bulb, [26, 27, 12, 12], 45, 6, 0.55)],
      l: [L('G', path([[20, 6.3], [17.5, 11.5], [11.4, 15.8], [7.3, 22.5], [9.6, 29.5]]), 1.1), L('G', path([[30, 30.5], [25, 33.2]]), 0.9, 0.75)],
      d: [
        D('v0', 'M20 11 Q15 20 17 33.6 M20 11 Q25 20 23 33.6 M20 11 Q10 19 12 31.5 M20 11 Q30 19 28 31.5', 0.8, 0.9),
        D('m3', 'M17 34 l-1 2 M19 34.3 l-.4 2.2 M21 34.3 l.4 2.2 M23 34 l1 2', 0.7, 0.9),
      ],
      p: [P(path([[12.5, 20], [12, 25]]), 0.7, 1.3)],
    };
  });

  def('artichokes', () => {
    const globe = shape([[20, 5], [29, 10], [33, 20], [29, 30], [20, 33], [11, 30], [7, 20], [11, 10]], 0.4);
    const petals = [];
    const rows = [[20, 30, 3], [20, 23, 4], [20, 16, 3], [20, 10, 2]];
    for (const [cx, y, n] of rows) {
      for (let i = 0; i < n; i++) {
        const x = cx + (i - (n - 1) / 2) * (24 / (n + 0.5));
        petals.push(shape([[x - 4.2, y + 3], [x, y - 4], [x + 4.2, y + 3], [x, y + 4.4]], 0.3));
      }
    }
    return {
      f: [
        S('g2', path([[20, 32], [21, 36], [23.5, 38]]), 2.6),
        F('g2', globe),
        ...petals.map((d, i) => F(i % 3 === 0 ? 'b1' : 'g1', d, 0.95)),
        F('g2', blob(28, 26, 9, 11), 0.55, globe),
      ],
      h: [H('g3', globe, [27, 24, 10, 16], 50, 6, 0.6)],
      l: [L('g3', path([[11, 10.4], [7.2, 20], [10.8, 29.6]]), 1.1)],
      d: [D('v1', 'M16 7.5 l1 -1.6 M24 7.5 l-1 -1.6 M12 14 l-.6 -1.6 M28 14 l.6 -1.6 M20 6 l0 -1.6', 1.2, 0.85)],
      p: [P(path([[13, 16], [12.6, 21]]), 0.7, 1.1), P(path([[18, 9], [21.5, 8.6]]), 0.6, 0.9)],
    };
  });

  def('bbq-chicken', () => {
    const meat = shape([[6, 18], [10, 9], [19, 6], [27, 9.5], [29, 17], [24, 23.5], [16, 26], [9, 24.5]], 0.4);
    const bone = shape([[22, 22], [27.5, 26.5], [31, 26], [34.5, 28.5], [33.5, 32], [35, 35], [31.5, 36], [29.5, 33], [25.5, 29.5], [20.5, 25]], 0.3);
    return {
      f: [
        F('m0', bone), F('m2', blob(32, 33, 4, 3), 0.7, bone),
        F('e1', meat), F('o1', blob(13, 12, 7, 5), 0.55, meat), F('e2', blob(22, 21, 11, 8), 0.8, meat),
        S('e2', path([[10, 16], [15, 12], [20, 11.5]]), 1.6, 0.65, meat),
      ],
      h: [H('e3', meat, [22, 18, 12, 12], 40, 6, 0.6), H('m3', bone, [30, 31, 8, 8], 60, 3, 0.55)],
      l: [L('e3', path([[6.2, 18.5], [9.6, 9.6], [17, 6.4]]), 1.15), L('G', path([[29.6, 33.2], [31.5, 36]]), 0.9)],
      d: [D('k2', 'M11 19 l5 -5 M14 21 l6 -6 M18 22 l5 -5', 1.1, 0.8)],
      p: [P(path([[10.5, 13], [14, 9.6], [18, 8.6]]), 0.85, 1.3), P(path([[21.5, 12], [23, 13.5]]), 0.6, 1)],
    };
  });

  def('prosciutto', () => {
    const r1 = shape([[4, 12], [12, 7], [22, 9], [30, 6], [36, 10], [33, 15], [24, 14.5], [14, 16.5], [6, 17.5]], 0.4);
    const r2 = shape([[5, 25], [12, 19], [21, 22], [29, 18.5], [36, 22.5], [33, 29], [24, 28], [15, 31], [6, 31]], 0.4);
    return {
      f: [
        F('p2', r1), F('p1', blob(15, 11, 9, 3.5), 0.6, r1), S('P', path([[4.5, 12.4], [12, 7.6], [22, 9.6], [30, 6.6], [35.5, 10.2]]), 1.6, 0.95, r1),
        F('p2', r2), F('p1', blob(15, 24, 9, 4), 0.6, r2), F('r2', blob(30, 27, 9, 5), 0.35, r2), S('P', path([[5.5, 25.3], [12, 19.6], [21, 22.6], [29, 19.1], [35.5, 22.8]]), 1.6, 0.95, r2),
      ],
      h: [H('r2', r2, [26, 26, 14, 8], 75, 6, 0.5)],
      l: [L('p3', path([[6, 17.4], [14, 16.3], [24, 14.3]]), 0.9, 0.85), L('p3', path([[6, 30.8], [15, 30.8], [24, 27.8]]), 1, 0.9)],
      d: [D('P', path([[12, 13], [18, 12.4]]), 0.6, 0.8), D('P', path([[14, 27], [21, 26]]), 0.6, 0.8)],
    };
  });

  def('sweetcorn', () => {
    const cob = blob(20, 19, 5.6, 13, 0.05, 11);
    const husk1 = shape([[13, 35], [8, 22], [15, 8], [18, 20], [18, 35]], 0.3);
    const husk2 = shape([[27, 35], [32, 22], [25, 8], [22, 20], [22, 35]], 0.3);
    let kern = '';
    for (let y = 9; y <= 29; y += 2.6) for (const x of [16.8, 19.2, 21.6]) kern += `M${x} ${y.toFixed(1)} q1 -.9 1.9 0 q-.9 1.1 -1.9 0 `;
    return {
      f: [F('y1', cob), F('y2', blob(24, 22, 5, 14), 0.6, cob), F('g1', husk1), F('g0', blob(11, 22, 3, 8), 0.5, husk1), F('b1', husk2), F('b2', blob(30, 28, 4, 8), 0.65, husk2)],
      h: [H('g3', husk1, [13, 24, 8, 16], 70, 5, 0.6), H('b3', husk2, [28, 26, 6, 14], 110, 5, 0.6)],
      l: [L('g3', path([[13.2, 34.7], [8.3, 22], [14.8, 8.6]]), 1.1), L('y3', arc(20, 19, 5.6, 13, 200, 260), 0.9)],
      d: [D('y2', kern, 0.6, 0.95)],
      p: [P(path([[17.6, 9], [17.2, 15]]), 0.8, 0.9), P(path([[11, 17], [10.4, 22]]), 0.6, 0.9)],
    };
  });

  // Breakfast (staging demo set)
  def('pancakes', () => {
    const disc = (y) => shape([[5, y], [10, y - 3.2], [20, y - 4], [30, y - 3.2], [35, y], [35, y + 3], [30, y + 5.5], [20, y + 6.2], [10, y + 5.5], [5, y + 3]], 0.3);
    const top = (y) => blob(20, y, 15, 3.6, 0.04, 10);
    const d1 = disc(28), d2 = disc(22.5), d3 = disc(17);
    const syrup = shape([[9, 16.5], [14, 14], [24, 13.6], [31, 16], [30, 19], [28, 22.5], [26.5, 19.5], [22, 19.5], [19, 24], [17.5, 19.3], [12, 19]], 0.3);
    return merge(
      plate(20, 33, 18, 4.4, 'c'),
      {
        f: [
          F('o1', d1), F('o2', blob(30, 32, 10, 4), 0.6, d1), F('o1', d2), F('o2', blob(30, 26.5, 10, 4), 0.6, d2),
          F('o1', d3), F('o0', top(17), 0.95), F('o2', blob(30, 21, 10, 4), 0.6, d3),
          F('e1', syrup, 0.92), F('e2', blob(25, 18, 7, 3), 0.5, syrup),
          F('y0', shape([[16.5, 14], [22, 13], [23, 15.6], [17.5, 16.6]], 0.3)), F('y1', shape([[17.5, 16.6], [23, 15.6], [23, 16.6], [17.6, 17.5]], 0.2), 0.9),
        ],
        h: [H('o2', d2, [28, 25, 14, 8], 60, 5, 0.6), H('o2', d1, [28, 31, 14, 8], 60, 5, 0.6)],
        l: [L('o3', path([[5.2, 17.3], [5.2, 19.8], [8, 21.6]]), 1), L('o3', path([[5.2, 23], [5.4, 25.4], [8.5, 27]]), 1), L('e3', path([[28.4, 22.4], [27, 20]]), 0.9)],
        p: [P(path([[17.2, 14.4], [20.5, 13.8]]), 0.85, 0.9), P(path([[12, 15.6], [15, 15]]), 0.6, 0.9)],
      },
    );
  });

  def('waffles', () => {
    const w = poly([[7, 9], [33, 7.5], [34.5, 30], [8.5, 32.5]], 0.6);
    let grid = '';
    for (let i = 1; i < 5; i++) {
      grid += `M${(7 + i * 5.3).toFixed(1)} ${(9 - i * 0.3).toFixed(1)} L${(8.5 + i * 5.2).toFixed(1)} ${(32.5 - i * 0.5).toFixed(1)} `;
      grid += `M${(7.3 + i * 0.3).toFixed(1)} ${(9 + i * 4.7).toFixed(1)} L${(33.3 + i * 0.25).toFixed(1)} ${(7.5 + i * 4.5).toFixed(1)} `;
    }
    return merge(
      { f: [F('o0', w), F('o1', blob(28, 26, 12, 10), 0.6, w), F('o2', blob(33, 31, 7, 6), 0.55, w)], h: [H('o2', w, [28, 24, 12, 16], 45, 7, 0.55)] },
      { d: [D('o2', grid, 1.2, 0.9)], l: [L('o3', path([[7.2, 9.4], [7.6, 20], [8.6, 32]]), 1.1), L('o3', path([[8.8, 32.3], [18, 31.8]]), 0.9, 0.75)] },
      { f: [F('y0', shape([[16, 15], [22, 14.4], [22.6, 19.6], [16.4, 20.2]], 0.3)), F('y1', blob(21, 19, 3, 1.5), 0.6, shape([[16, 15], [22, 14.4], [22.6, 19.6], [16.4, 20.2]], 0.3))] },
      ball(29, 11, 2.6, 2.4, 'r', { hatch: 0, line: false }), ball(31.5, 15, 2.3, 2.2, 'v', { hatch: 0, line: false }),
      { p: [P(path([[17, 15.6], [20, 15.3]]), 0.85, 0.9), P(path([[10, 11], [15, 10.6]]), 0.55, 1)] },
    );
  });

  def('croissant', () => {
    const segs = [
      shape([[4, 26], [6, 19], [11, 17], [13, 23], [10, 29]], 0.3),
      shape([[11, 17], [16, 11.5], [21, 13], [21, 22], [13, 23.5]], 0.3),
      shape([[20, 12], [26, 10], [31, 12], [28, 21], [21, 22]], 0.3),
      shape([[29, 12], [34, 15], [36, 22], [33, 26], [28, 21]], 0.3),
    ];
    return {
      f: [
        ...segs.map((d, i) => F(i % 2 ? 'o1' : 'o0', d)),
        ...segs.map((d) => F('o2', blob(24, 26, 16, 7), 0.65, d)),
        F('e1', shape([[19.5, 12.8], [21.5, 12.5], [22, 22], [20, 22.2]], 0.2), 0.7),
        F('e1', shape([[10.5, 17.6], [12, 17], [13.8, 23.3], [12.2, 23.6]], 0.2), 0.6),
      ],
      h: [H('o2', segs[2], [26, 18, 10, 8], 60, 5, 0.6), H('o2', segs[1], [17, 19, 10, 8], 60, 4, 0.55)],
      l: [L('e3', path([[4.2, 25.6], [6.2, 19.2], [11, 17], [16, 11.8]]), 1.1), L('e3', path([[33, 26], [36, 22]]), 0.9, 0.85)],
      p: [P(path([[13, 15.6], [17, 13]]), 0.85, 1.1), P(path([[23, 12], [27, 11.2]]), 0.75, 1), P(path([[6.5, 21], [8, 19.4]]), 0.6, 0.9)],
    };
  });

  def('bacon-and-eggs', () => {
    const white = shape([[6, 18], [9, 10], [17, 7], [24, 10], [26, 17], [22, 24], [13, 25], [7, 23]], 0.6);
    const strip = shape([[23, 24], [27, 21], [31, 23.5], [35, 21.5], [36.5, 26], [32, 28.5], [28, 26.5], [24, 29]], 0.3);
    return merge(
      plate(20, 22, 18, 15, 'c'),
      {
        f: [F('m0', white), F('m2', blob(22, 21, 8, 6), 0.5, white)],
        h: [H('m2', white, [20, 20, 10, 8], 45, 4, 0.5)],
        l: [L('m3', path([[6.2, 18.4], [9.2, 10.4], [16, 7.4]]), 0.9, 0.85)],
      },
      ball(16, 16.5, 4.6, 4.4, 'y', { hatch: 3, la: 120, lb: 200, lc: 'o2' }),
      {
        f: [F('e0', strip), S('r1', path([[24, 26], [28, 23.6], [32, 25.5], [36, 23.8]]), 2, 1, strip), S('m0', path([[23.6, 24.6], [27.6, 22.3], [31.5, 24.2], [35.6, 22.4]]), 0.8, 0.9, strip)],
        l: [L('r3', path([[24.3, 28.8], [28, 26.6], [32, 28.4]]), 0.9)],
      },
    );
  });

  def('oatmeal', () => merge(
    bowl(['m1', 'm2']),
    {
      d: [
        D('e0', 'M9 20 l1.4 .3 M13 19 l1.5 -.2 M17 20.5 l1.3 .2 M22 19.2 l1.4 .3 M27 20.3 l1.3 -.2 M31 19.5 l1.2 .3 M11 21.6 l1.2 0 M25 21.7 l1.3 .1', 1, 0.95),
        D('v1', blob(15, 18.3, 1.5, 1.2), 0, 1, true), D('v2', blob(17.6, 18.8, 1.4, 1.1), 0, 1, true), D('r1', blob(25, 18.5, 1.6, 1.3), 0, 1, true),
        D('y0', blob(21, 17.8, 2, 1), 0, 1, true),
      ],
    },
  ));

  def('smoothie-bowl', () => merge(
    bowl(['p1', 'p2']),
    {
      f: [F('y0', blob(13, 19.2, 2.3, 1.3)), F('y0', blob(17, 18.6, 2.2, 1.2)), F('g1', blob(26, 19, 2.6, 1.4)), F('g0', blob(26, 19, 1.4, 0.7))],
      d: [
        D('y2', blob(13, 19.2, 0.6, 0.35), 0, 1, true), D('y2', blob(17, 18.6, 0.6, 0.35), 0, 1, true),
        D('v1', blob(21.5, 19.5, 1.3, 1), 0, 1, true), D('v2', blob(23, 18.2, 1.2, 0.9), 0, 1, true), D('r1', blob(30, 19.8, 1.7, 1.2), 0, 1, true),
        D('k2', 'M25 19 l.3 0 M26.8 19.1 l.3 0', 0.7, 1),
      ],
    },
  ));

  def('bagel', () => {
    const d = ring(20, 21, 15, 12, 4.2, 3.2, 0, -0.5);
    const outer = blob(20, 21, 15, 12);
    let seeds = '';
    const R = rng(77);
    for (let i = 0; i < 26; i++) {
      const a = R() * Math.PI * 2, r = 0.45 + R() * 0.45;
      const x = 20 + Math.cos(a) * 15 * r, y = 21 + Math.sin(a) * 12 * r;
      seeds += `M${x.toFixed(1)} ${y.toFixed(1)} l${(R() - 0.5).toFixed(1)} ${(0.6 + R() * 0.4).toFixed(1)} `;
    }
    return {
      f: [F('o1', d, 1, null, true), F('o0', blob(14, 15, 9, 5), 0.5, outer), F('e1', blob(28, 29, 13, 8), 0.75, outer), S('o0', arc(20, 21, 9.5, 7.5, 195, 260), 1.6, 0.5)],
      h: [H('e2', outer, [27, 27, 14, 12], 45, 7, 0.6)],
      l: [L('e3', arc(20, 21, 15.1, 12.1, 120, 215), 1.15), L('e3', arc(20, 20.5, 4.4, 3.4, 300, 400), 0.9, 0.85)],
      d: [D('m0', seeds, 0.9, 0.95)],
      p: [P(arc(20, 21, 9.6, 7.6, 200, 240), 0.85, 1.4)],
    };
  });

  def('full-english', () => merge(
    plate(20, 21, 18, 16, 'c'),
    { f: [F('m0', blob(13, 15, 7, 5.5, 0.12))] },
    ball(13, 15, 3, 2.8, 'y', { hatch: 0, line: false }),
    {
      f: [
        F('e1', shape([[21, 9], [31, 7.5], [33, 10], [23, 12.5]], 0.3)), F('e2', blob(29, 11, 5, 2), 0.6, shape([[21, 9], [31, 7.5], [33, 10], [23, 12.5]], 0.3)),
        F('e1', shape([[22, 13.5], [32, 12], [34, 14.5], [24, 17]], 0.3)), F('e2', blob(30, 16, 5, 2), 0.6, shape([[22, 13.5], [32, 12], [34, 14.5], [24, 17]], 0.3)),
      ],
      l: [L('e3', path([[21.2, 9.4], [22.8, 12.3]]), 0.8), L('e3', path([[22.2, 13.9], [23.8, 16.8]]), 0.8)],
    },
    { f: [F('o1', blob(14, 27, 6.5, 4.4)), F('o2', blob(17, 29, 5, 3), 0.6, blob(14, 27, 6.5, 4.4))], d: [D('o0', 'M10.5 26 q.8 -.6 1.6 0 M13.5 25 q.8 -.6 1.6 0 M16 27.5 q.8 -.6 1.6 0 M12 28.4 q.8 -.6 1.6 0', 0.7, 0.9)] },
    ball(26.5, 26, 5.4, 5, 'r', { hatch: 3, la: 110, lb: 190 }),
    { f: [F('r0', blob(26.5, 26, 3.4, 3), 0.85)], d: [D('y0', 'M25.6 25.3 l.4 .3 M27.4 25.6 l.4 .3 M26.4 27 l.4 .3', 0.9, 1)] },
  ));

  def('cold-pizza', () => {
    const slice = shape([[5, 9], [35, 8], [21, 37]], 0.4);
    const crust = shape([[4, 9.5], [6, 5.5], [20, 4.2], [34, 4.8], [36, 8.6], [34, 10], [20, 9.6], [6, 10.5]], 0.3);
    return merge(
      {
        f: [F('y1', slice), F('r1', blob(20, 11, 15, 3), 0.7, slice), F('y2', blob(27, 26, 10, 12), 0.5, slice), F('y0', blob(15, 18, 5, 6), 0.55, slice), F('e0', crust), F('e1', blob(28, 9, 10, 3), 0.7, crust)],
        h: [H('e2', crust, [26, 7, 18, 6], 70, 6, 0.6), H('y2', slice, [26, 22, 10, 16], 50, 5, 0.55)],
        l: [L('e3', path([[4.2, 9.6], [6, 5.6], [15, 4.4]]), 1.1), L('y3', path([[5.5, 10.5], [12, 23], [20.6, 36.5]]), 1.05)],
      },
      ball(16, 16, 3.4, 3.2, 'r', { hatch: 0, line: false }), ball(24, 15, 3.2, 3, 'r', { hatch: 0, line: false }), ball(20.5, 25, 3, 2.9, 'r', { hatch: 0, line: false }),
      { f: [F('g1', leaf(12, 21, 15.5, 19, 1.1)), F('g1', leaf(25, 21, 28, 19.5, 1))], p: [P(path([[9, 7], [16, 6]]), 0.8, 1)] },
    );
  });

  def('grapefruit', () => {
    const half = blob(23, 23, 13, 12.5, 0.05, 11);
    let segs = '';
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * Math.PI * 2;
      segs += `M23 23 L${(23 + Math.cos(a) * 9.6).toFixed(1)} ${(23 + Math.sin(a) * 9.2).toFixed(1)} `;
    }
    return merge(
      ball(11, 12, 7.5, 7.2, 'y', { hatch: 4, la: 130, lb: 210 }),
      { d: [D('o2', 'M8 9 l.4 .3 M12 8 l.4 .3 M10 13 l.4 .3 M14 12 l.4 .3', 0.9, 0.9)], f: [F('g1', leaf(14, 6, 19, 2.5, 1.6, 0.5))] },
      {
        f: [F('y1', half), F('o1', blob(30, 30, 12, 10), 0.55, half), F('m0', blob(23, 23, 11, 10.6, 0.04)), F('r1', blob(23, 23, 9.8, 9.4, 0.04)), F('r2', blob(27, 27, 8, 7), 0.45, blob(23, 23, 9.8, 9.4, 0.04)), F('p1', blob(19.5, 19.5, 5, 4), 0.55, blob(23, 23, 9.8, 9.4, 0.04))],
        l: [L('y3', arc(23, 23, 13.1, 12.6, 110, 200), 1.1)],
        d: [D('m0', segs, 1, 0.95), D('m0', blob(23, 23, 1.3, 1.2), 0, 1, true), D('r0', 'M20 18 l1 1.6 M26 19 l-.8 1.4 M19 26 l1.4 -.6', 0.7, 0.8)],
        p: [P(path([[15, 18], [17, 15]]), 0.6, 1)],
      },
    );
  });

  // ---------- flags (Countries) ----------
  // Flag art is authored in a unit square (u,v ∈ 0..1) and warped onto a
  // waving cloth, so stripes and emblems follow the folds.
  const CLOTH = { x: 7, w: 29, y: 10, h: 19 };
  const waveTop = (u) => CLOTH.y - 2.4 * Math.sin(u * Math.PI * 2);
  const warp = (u, v) => [CLOTH.x + CLOTH.w * u, waveTop(u) + CLOTH.h * v];
  function wpoly(uv) {
    const pts = [];
    for (let i = 0; i < uv.length; i++) {
      const a = uv[i], b = uv[(i + 1) % uv.length];
      for (let k = 0; k < 6; k++) pts.push(warp(a[0] + (b[0] - a[0]) * k / 6, a[1] + (b[1] - a[1]) * k / 6));
    }
    return 'M' + pts.map(pt).join(' L') + 'Z';
  }
  const urect = (u0, v0, u1, v1) => wpoly([[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
  // circle that stays round on the 29×19 cloth (rv in v-units)
  function ucirc(cu, cv, ru, n = 14) {
    const rv = ru * CLOTH.w / CLOTH.h, pts = [];
    for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; pts.push(warp(cu + Math.cos(a) * ru, cv + Math.sin(a) * rv)); }
    return smoothClosed(pts);
  }
  function ustar(cu, cv, ru, inner = 0.42) {
    const rv = ru * CLOTH.w / CLOTH.h, uv = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? inner : 1;
      uv.push(warp(cu + Math.cos(a) * ru * r, cv + Math.sin(a) * rv * r));
    }
    return 'M' + uv.map(pt).join(' L') + 'Z';
  }
  const hbands = (cols, weights) => {
    const total = (weights || cols.map(() => 1)).reduce((a, b) => a + b, 0);
    let v = 0;
    return cols.map((c, i) => { const w = (weights ? weights[i] : 1) / total; const d = urect(0, v, 1, v + w); v += w; return [c, d]; });
  };
  const vbands = (cols) => cols.map((c, i) => [c, urect(i / cols.length, 0, (i + 1) / cols.length, 1)]);

  // parts: [[colour, d], ...] painted in order inside the cloth.
  function flag(parts, extra = {}) {
    const cloth = wpoly([[0, 0], [1, 0], [1, 1], [0, 1]]);
    return merge(
      {
        f: [
          S('e1', 'M6 7 L6 37', 1.8), F('y1', blob(6, 6.4, 1.3, 1.3)),
          ...parts.map(([c, d]) => F(c, d, 1, cloth)),
          // folds: shadow in the troughs, paper light on the crests
          F('k2', wpoly([[0.38, 0], [0.62, 0], [0.62, 1], [0.38, 1]]), 0.16, cloth),
          F('k2', wpoly([[0.88, 0], [1, 0], [1, 1], [0.88, 1]]), 0.12, cloth),
          S('P', path([warp(0.16, 0.08), warp(0.2, 0.5), warp(0.17, 0.92)]), 1.4, 0.35, cloth),
          S('P', path([warp(0.72, 0.1), warp(0.76, 0.55)]), 1.1, 0.3, cloth),
        ],
        h: [H('k2', cloth, [24, 20, 8, 22], 70, 5, 0.22)],
        l: [L('G', path([warp(0, 0), warp(0.18, -0.01), warp(0.36, 0.02)]), 1, 0.85), L('G', path([warp(1, 0.55), warp(1, 1)]), 0.9, 0.6)],
      },
      extra,
    );
  }

  def('brazil', () => flag([
    ['b1', urect(0, 0, 1, 1)],
    ['y1', wpoly([[0.08, 0.5], [0.5, 0.09], [0.92, 0.5], [0.5, 0.91]])],
    ['c1', ucirc(0.5, 0.5, 0.17)],
  ], { d: [D('P', path([warp(0.34, 0.44), warp(0.5, 0.4), warp(0.66, 0.52)]), 1, 0.95), D('P', 'M0 0', 0)] }));
  def('argentina', () => flag([...hbands(['s1', 'm0', 's1']), ['y1', ucirc(0.5, 0.5, 0.07)]],
    { d: [D('o2', ucirc(0.5, 0.5, 0.1), 0.6, 0.8)] }));
  def('france', () => flag(vbands(['c1', 'm0', 'r1'])));
  def('germany', () => flag(hbands(['k2', 'r1', 'y1'])));
  def('spain', () => flag([...hbands(['r1', 'y1', 'r1'], [1, 2, 1]), ['r2', wpoly([[0.24, 0.38], [0.36, 0.38], [0.36, 0.6], [0.3, 0.66], [0.24, 0.6]])]],
    { d: [D('y2', wpoly([[0.22, 0.34], [0.38, 0.34], [0.38, 0.38], [0.22, 0.38]]), 0, 1, true)] }));
  def('england', () => flag([['m0', urect(0, 0, 1, 1)], ['r1', urect(0.43, 0, 0.57, 1)], ['r1', urect(0, 0.39, 1, 0.61)]]));
  def('italy', () => flag(vbands(['b1', 'm0', 'r1'])));
  def('portugal', () => flag([['b2', urect(0, 0, 0.4, 1)], ['r1', urect(0.4, 0, 1, 1)], ['y1', ucirc(0.4, 0.5, 0.13)], ['m0', ucirc(0.4, 0.5, 0.075)], ['r2', ucirc(0.4, 0.5, 0.05)]]));
  def('netherlands', () => flag(hbands(['r1', 'm0', 'c1'])));
  def('belgium', () => flag(vbands(['k2', 'y1', 'r1'])));
  def('uruguay', () => flag([
    ...hbands(['m0', 's1', 'm0', 's1', 'm0', 's1', 'm0', 's1', 'm0']),
    ['m0', urect(0, 0, 0.38, 5 / 9)], ['y1', ucirc(0.19, 0.27, 0.075)],
  ], { d: [D('o2', ucirc(0.19, 0.27, 0.105), 0.6, 0.8)] }));
  def('croatia', () => {
    const checks = [];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
      checks.push([(r + c) % 2 ? 'm0' : 'r1', urect(0.42 + c * 0.04, 0.3 + r * 0.09, 0.46 + c * 0.04, 0.39 + r * 0.09)]);
    }
    return flag([...hbands(['r1', 'm0', 'c1']), ...checks]);
  });
  def('morocco', () => flag([['r1', urect(0, 0, 1, 1)]], { d: [D('b2', ustar(0.5, 0.5, 0.17, 0.4), 1.3, 1)] }));
  def('japan', () => flag([['m0', urect(0, 0, 1, 1)], ['r1', ucirc(0.5, 0.5, 0.18)]]));
  def('mexico', () => flag([...vbands(['b2', 'm0', 'r1']), ['e1', ucirc(0.5, 0.5, 0.06)], ['b1', wpoly([[0.44, 0.62], [0.56, 0.62], [0.5, 0.68]])]]));
  def('united-states', () => {
    const stripes = [];
    for (let i = 0; i < 13; i++) stripes.push([i % 2 ? 'm0' : 'r1', urect(0, i / 13, 1, (i + 1) / 13)]);
    let dots = '';
    for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) {
      const p = warp(0.04 + c * 0.075 + (r % 2) * 0.035, 0.07 + r * 0.12);
      dots += `M${n1(p[0])} ${n1(p[1])} l.15 .15 `;
    }
    return flag([...stripes, ['c2', urect(0, 0, 0.4, 7 / 13)]], { d: [D('m0', dots, 0.8, 1)] });
  });
  def('senegal', () => flag(vbands(['b1', 'y1', 'r1']), { f: [F('b2', ustar(0.5, 0.5, 0.09))] }));
  def('colombia', () => flag(hbands(['y1', 'c1', 'r1'], [2, 1, 1])));

  // ---------- city landmarks (Travel) ----------
  const sky = (hue = 's') => ({ f: [F(hue + '0', blob(20, 36.5, 15, 2.2), 0.8)] });

  def('paris', () => {
    const t = poly([[19.2, 3], [20.8, 3], [23, 16], [27.5, 34], [23.5, 34], [20, 26], [16.5, 34], [12.5, 34], [17, 16]], 0.2);
    return merge(sky('m'), {
      f: [F('e1', t), F('e2', poly([[20, 3], [20.8, 3], [23, 16], [27.5, 34], [23.5, 34], [20, 26]], 0.1), 0.55, t), S('e0', path([[18.6, 8], [17.6, 16], [14, 32]]), 0.8, 0.6, t)],
      h: [H('e3', t, [20, 22, 16, 26], 45, 9, 0.6), H('e3', t, [20, 22, 16, 26], 135, 9, 0.5)],
      l: [L('e3', path([[19.2, 3.2], [17, 16], [12.6, 33.6]]), 1)],
      d: [D('e3', 'M15.5 21 h9 M17.2 15.5 h5.6 M18.6 10 h2.8', 1.2, 1)],
    });
  });
  def('tokyo', () => {
    const t = poly([[19.3, 3], [20.7, 3], [23, 17], [27, 34], [13, 34], [17, 17]], 0.2);
    return merge(sky('s'), {
      f: [F('r1', t), F('m0', urectL(14.8, 20, 25.2, 23), 1, t), F('m0', urectL(18.2, 9, 21.8, 11), 1, t), F('r2', poly([[20, 3], [20.7, 3], [23, 17], [27, 34], [20, 34]], 0.1), 0.5, t)],
      h: [H('r3', t, [20, 24, 14, 22], 45, 8, 0.55), H('r3', t, [20, 24, 14, 22], 135, 8, 0.45)],
      l: [L('r3', path([[19.3, 3.2], [17, 17], [13.2, 33.6]]), 1)],
      p: [P(path([[18.3, 12], [17.5, 16]]), 0.6, 0.8)],
    });
  });
  function urectL(x0, y0, x1, y1) { return `M${x0} ${y0} L${x1} ${y0} L${x1} ${y1} L${x0} ${y1}Z`; }
  def('rome', () => {
    const c = poly([[4, 16], [10, 11], [22, 9], [34, 11], [36, 16], [36, 31], [4, 31]], 0.3);
    let arches = '';
    for (const y of [19, 26]) for (let x = 7; x < 34; x += 4.2) arches += `M${x} ${y + 4} L${x} ${y} Q${x + 1.4} ${y - 2} ${x + 2.8} ${y} L${x + 2.8} ${y + 4} `;
    return merge(sky('m'), {
      f: [F('e0', c), F('o0', blob(12, 18, 9, 7), 0.4, c), F('e1', blob(32, 26, 10, 10), 0.6, c), F('m0', poly([[28, 9.5], [36, 11.5], [36, 16], [29, 14]], 0.2), 0.9)],
      d: [D('e2', arches, 0.9, 0.9), D('e2', 'M4 17.5 h32 M4 24.5 h32', 0.8, 0.8)],
      h: [H('e2', c, [28, 24, 16, 16], 60, 7, 0.5)],
      l: [L('e3', path([[4.2, 30.6], [4.1, 16.2], [10, 11.2], [18, 9.4]]), 1)],
      p: [P(path([[8, 14], [14, 11.5]]), 0.7, 1)],
    });
  });
  def('new-york', () => {
    const fig = shape([[15.5, 34], [16, 24], [17.5, 15], [19, 11.5], [21, 11.5], [22.5, 15], [24, 24], [24.5, 34]], 0.3);
    return merge({
      f: [
        F('m2', poly([[12.5, 34], [27.5, 34], [26.5, 38], [13.5, 38]], 0.2)),
        S('b1', path([[22, 16], [25, 10], [26.5, 5]]), 2.4),
        F('b1', fig), F('b0', blob(18, 22, 3, 9), 0.5, fig), F('b2', blob(23.5, 28, 4, 9), 0.6, fig),
        F('b1', blob(20, 9.8, 2.2, 2.4)),
        F('y1', blob(26.8, 3.2, 1.6, 2.2)), F('o1', blob(26.9, 3.8, 0.9, 1.2)),
        F('b0', poly([[15.4, 21], [20, 20], [19.5, 24], [15.8, 25]], 0.2), 0.9),
      ],
      h: [H('b2', fig, [22, 26, 8, 16], 70, 5, 0.6)],
      l: [L('b3', path([[15.6, 33.6], [16.1, 24], [17.6, 15.2]]), 1), L('b3', 'M17.6 8.4 l-1.6 -1.6 M19.2 7.6 l-.6 -2 M21 7.6 l.5 -2 M22.5 8.4 l1.6 -1.4', 0.9)],
      d: [D('m3', 'M13.5 35.5 h13', 0.6, 0.8)],
    });
  });
  def('barcelona', () => {
    const spire = (x, top, w) => shape([[x - w, 35], [x - w * 0.9, top + 8], [x, top], [x + w * 0.9, top + 8], [x + w, 35]], 0.3);
    const sp = [spire(10, 9, 3), spire(16.5, 4, 3.2), spire(23.5, 4, 3.2), spire(30, 9, 3)];
    return merge(sky('m'), {
      f: [F('m2', poly([[6, 22], [34, 22], [34, 35], [6, 35]], 0.3)), ...sp.map((d, i) => F(i % 2 ? 'e0' : 'm2', d)), ...sp.map((d) => F('e1', blob(26, 30, 14, 12), 0.35, d)),
        F('g1', blob(16.5, 4.2, 1.1, 1.1)), F('r1', blob(23.5, 4.2, 1.1, 1.1)), F('y1', blob(10, 9, 0.9, 0.9)), F('o1', blob(30, 9, 0.9, 0.9))],
      d: [D('e2', 'M10 15 v2 M10 20 v2 M16.5 12 v2 M16.5 17 v2 M23.5 12 v2 M23.5 17 v2 M30 15 v2 M30 20 v2', 1, 0.9), D('e2', 'M17 30 q3 -5 6 0 v5 h-6Z', 0.9, 0.9)],
      h: [H('e2', poly([[6, 22], [34, 22], [34, 35], [6, 35]], 0.3), [26, 29, 14, 12], 50, 6, 0.5)],
      l: [L('e3', path([[6.8, 34.6], [7.2, 17], [10, 9.2]]), 1)],
    });
  });
  def('istanbul', () => {
    const body = poly([[6, 24], [34, 24], [34, 34], [6, 34]], 0.3);
    return merge(sky('s'), {
      f: [
        S('m2', 'M5 33 L5 9', 1.6), S('m2', 'M35 33 L35 9', 1.6), F('m2', blob(5, 8.5, 0.8, 1.8)), F('m2', blob(35, 8.5, 0.8, 1.8)),
        F('m1', body), F('s1', blob(20, 19, 8, 6.5)), F('m1', poly([[11.5, 19], [28.5, 19], [28.5, 24.5], [11.5, 24.5]], 0.2)),
        F('s1', blob(11, 23.5, 4, 3)), F('s1', blob(29, 23.5, 4, 3)), F('s2', blob(24, 21, 6, 5), 0.55, blob(20, 19, 8, 6.5)),
      ],
      h: [H('m3', body, [27, 29, 14, 10], 50, 6, 0.5)],
      l: [L('G', path([[6.2, 33.6], [6.1, 25], [11, 23.4]]), 1), L('s3', arc(20, 19, 8, 6.5, 190, 260), 0.9)],
      d: [D('m3', 'M9 28 q1 -2 2 0 v3 M14 28 q1 -2 2 0 v3 M24 28 q1 -2 2 0 v3 M29 28 q1 -2 2 0 v3', 0.8, 0.9), D('y2', 'M20 12.5 L20 10', 0.8)],
      p: [P(arc(20, 19, 5.5, 4.5, 200, 245), 0.75, 1.1)],
    });
  });
  def('taipei', () => {
    const segs = [];
    for (let i = 0; i < 6; i++) { const y = 30 - i * 4.2; segs.push(poly([[14.6, y], [25.4, y], [24, y - 4.2], [16, y - 4.2]], 0.15)); }
    return merge(sky('s'), {
      f: [F('b0', poly([[13, 30], [27, 30], [27, 35], [13, 35]], 0.2)), ...segs.map((d, i) => F(i % 2 ? 'b0' : 's1', d)), ...segs.map((d) => F('b2', blob(25, 18, 4, 20), 0.4, d)),
        F('b0', poly([[18, 4.8], [22, 4.8], [21, 2.5], [19, 2.5]], 0.1)), S('G', 'M20 2.6 L20 0.5', 0.8)],
      d: [D('b2', 'M15 28 h10 M15.4 23.8 h9.2 M15.8 19.6 h8.4 M16.2 15.4 h7.6 M16.6 11.2 h6.8 M17 7 h6', 0.6, 0.8)],
      l: [L('b3', path([[13.2, 34.6], [13.4, 30.2], [16, 25.8]]), 1)],
      p: [P(path([[16.5, 27], [16.2, 24]]), 0.7, 0.9), P(path([[17.2, 18.5], [17, 15.6]]), 0.6, 0.8)],
    });
  });
  def('seoul', () => {
    const hill = blob(20, 36, 18, 8, 0.05);
    return merge({
      f: [F('g1', hill), F('g2', blob(28, 38, 12, 6), 0.6, hill), S('m2', 'M20 30 L20 10', 2.4), F('m1', blob(20, 12, 3.2, 2.2)), F('r1', blob(20, 9.4, 2.2, 0.9)), S('r1', 'M20 8.8 L20 3', 0.9), F('m2', poly([[17.5, 30], [22.5, 30], [21.5, 33], [18.5, 33]], 0.1))],
      h: [H('g2', hill, [24, 34, 18, 6], 70, 7, 0.55)],
      l: [L('g3', arc(20, 36, 18, 8, 190, 240), 1), L('G', 'M18.9 29 L18.9 13.5', 0.8, 0.8)],
      p: [P(path([[18.2, 11.4], [19.4, 10.9]]), 0.7, 0.8)],
    });
  });
  def('singapore', () => {
    const tw = (x) => poly([[x - 2.5, 34], [x - 2.2, 12], [x + 2.2, 13.5], [x + 2.5, 34]], 0.2);
    const t = [tw(11), tw(20), tw(29)];
    return merge(sky('s'), {
      f: [...t.map((d) => F('m1', d)), ...t.map((d) => F('s1', blob(23, 26, 14, 14), 0.45, d)), F('m2', shape([[5, 11.5], [35, 9.5], [36, 11], [6, 13.5]], 0.2)), F('g1', blob(20, 10, 4, 0.8), 0.9), F('c1', poly([[4, 34], [36, 34], [36, 37], [4, 37]], 0.3), 0.8)],
      h: [H('m3', t[2], [30, 24, 6, 20], 70, 4, 0.5)],
      d: [D('s2', 'M9 16 v16 M11 16 v16 M18 16 v16 M20 16 v16 M27 16 v16 M29 16 v16', 0.5, 0.6)],
      l: [L('G', path([[8.6, 33.6], [8.8, 12.3]]), 1)],
    });
  });
  def('bologna', () => {
    const t1 = poly([[12, 35], [12.5, 4], [17, 4], [17.5, 35]], 0.2);
    const t2 = poly([[21, 35], [23, 13], [27, 13.4], [26, 35]], 0.2);
    return merge(sky('m'), {
      f: [F('e1', t1), F('e2', poly([[15, 4], [17, 4], [17.5, 35], [15, 35]], 0.1), 0.5, t1), F('o1', t2), F('e1', poly([[24.5, 13], [27, 13.4], [26, 35], [24, 35]], 0.1), 0.5, t2)],
      h: [H('e2', t1, [15, 20, 6, 30], 20, 6, 0.5), H('e2', t2, [24, 24, 6, 22], 20, 5, 0.5)],
      d: [D('e3', 'M13.5 10 v1.6 M15.5 18 v1.6 M14 26 v1.6 M23.6 20 v1.6 M24 27 v1.6', 1, 0.9), D('e3', 'M12.4 6 h4.8 M22.9 15 h4', 0.7, 0.8)],
      l: [L('e3', path([[12.1, 34.6], [12.5, 4.3]]), 1)],
    });
  });
  def('mumbai', () => {
    const g = poly([[5, 34], [5, 14], [10, 12], [30, 12], [35, 14], [35, 34]], 0.3);
    return merge(sky('s'), {
      f: [F('e0', g), F('o0', blob(12, 18, 8, 6), 0.45, g), F('e1', blob(32, 28, 9, 10), 0.55, g), F('m0', shape([[15, 34], [15, 22], [20, 17], [25, 22], [25, 34]], 0.2), 0.95), F('e0', blob(20, 10.5, 4, 2.6)), F('e0', blob(8, 11.5, 1.6, 1.4)), F('e0', blob(32, 11.5, 1.6, 1.4))],
      d: [D('e2', 'M7 22 q1.2 -2 2.4 0 v4 h-2.4Z M30.6 22 q1.2 -2 2.4 0 v4 h-2.4Z M5 16 h30', 0.8, 0.9)],
      h: [H('e2', g, [30, 26, 10, 14], 60, 5, 0.5)],
      l: [L('e3', path([[5.2, 33.6], [5.2, 14.4], [10, 12.3]]), 1), L('e3', path([[15.2, 33.6], [15.2, 22.2], [19.8, 17.3]]), 0.8, 0.8)],
    });
  });
  def('marrakesh', () => {
    const t = poly([[14, 35], [14, 9], [26, 9], [26, 35]], 0.25);
    return merge(sky('s'), {
      f: [F('o0', poly([[4, 32], [36, 32], [36, 36], [4, 36]], 0.3), 0.7), F('e0', t), F('e1', poly([[21, 9], [26, 9], [26, 35], [21, 35]], 0.1), 0.5, t), F('e0', poly([[16.5, 9], [23.5, 9], [23.5, 4.5], [16.5, 4.5]], 0.2)), F('b1', poly([[14, 9], [26, 9], [26, 10.6], [14, 10.6]], 0.1)), F('y1', blob(20, 3, 0.9, 0.9)), S('y2', 'M20 4.5 L20 1.5', 0.6)],
      d: [D('e2', 'M17 15 q1 -2 2 0 v3 M21 15 q1 -2 2 0 v3 M17.5 23 q1 -2 2 0 v3 M21.5 23 q1 -2 2 0 v3', 0.8, 0.9), D('b2', 'M14.5 12 h11', 0.6, 0.8)],
      h: [H('e2', t, [23, 22, 6, 26], 70, 5, 0.5)],
      l: [L('e3', path([[14.2, 34.6], [14.1, 11]]), 1)],
    });
  });
  def('osaka', () => {
    const roof = (y, w) => shape([[20 - w, y + 2.5], [20 - w * 0.7, y], [20 + w * 0.7, y], [20 + w, y + 2.5]], 0.15);
    const base = poly([[6, 35], [8.5, 27], [31.5, 27], [34, 35]], 0.3);
    return merge(sky('s'), {
      f: [F('m2', base), F('m3', blob(28, 33, 8, 5), 0.4, base),
        F('m0', poly([[11, 27], [29, 27], [29, 22], [11, 22]], 0.2)), F('b0', roof(20, 11)),
        F('m0', poly([[13, 20.5], [27, 20.5], [27, 16], [13, 16]], 0.2)), F('b0', roof(14, 9)),
        F('m0', poly([[15, 14.5], [25, 14.5], [25, 10.5], [15, 10.5]], 0.2)), F('b0', roof(8, 7)), F('y1', blob(15.5, 7.4, 0.7, 0.6)), F('y1', blob(24.5, 7.4, 0.7, 0.6))],
      h: [H('m3', base, [26, 31, 12, 8], 30, 6, 0.55)],
      d: [D('k1', 'M14 24 h1.4 M18 24 h1.4 M22 24 h1.4 M26 24 h1.4 M16 18 h1.4 M20 18 h1.4 M24 18 h1.4 M18 12.5 h1.4 M21.6 12.5 h1.4', 1, 0.8), D('m3', 'M8 31 h24 M7 33 h26', 0.5, 0.7)],
      l: [L('b3', path([[9, 22.3], [12.3, 20], [27.7, 20]]), 0.9), L('G', path([[6.2, 34.6], [8.6, 27.2]]), 0.9)],
    });
  });
  def('bangkok', () => {
    const p = shape([[12, 35], [14, 26], [16.5, 18], [18.5, 9], [20, 2.5], [21.5, 9], [23.5, 18], [26, 26], [28, 35]], 0.3);
    return merge(sky('o'), {
      f: [F('o0', p), F('e0', blob(25, 26, 6, 12), 0.6, p), F('o0', shape([[5, 35], [6, 29], [9, 26], [11, 29], [12, 35]], 0.2)), F('o0', shape([[28, 35], [29, 29], [31, 26], [34, 29], [35, 35]], 0.2))],
      d: [D('c1', 'M15 31 h10 M16 25 h8 M17.3 19 h5.4 M18.6 13 h2.8', 1.2, 0.9), D('r1', 'M14.6 28 l.4 .4 M18 28 l.4 .4 M21.6 28 l.4 .4 M25 28 l.4 .4 M17 22 l.4 .4 M22.4 22 l.4 .4', 1.2, 1), D('y1', 'M16.2 16 h7.6', 0.8, 1)],
      h: [H('m3', p, [24, 26, 8, 16], 60, 5, 0.5)],
      l: [L('G', path([[12.2, 34.6], [14.2, 26], [16.7, 18], [18.6, 9.3]]), 1)],
    });
  });
  def('mexico-city', () => merge(sky('s'), {
    f: [F('m2', poly([[13, 35], [27, 35], [26, 30], [14, 30]], 0.2)), S('m1', 'M20 30 L20 10', 3.6), S('m2', 'M21 29 L21 11', 1.2, 0.7), F('m1', poly([[17.5, 10.5], [22.5, 10.5], [22, 8.5], [18, 8.5]], 0.1)),
      F('y1', shape([[19.2, 8.5], [20.8, 8.5], [21, 4.5], [20, 3.5], [19, 4.5]], 0.15)), F('y1', leaf(20, 6, 15.5, 3.5, 1.4)), F('y1', leaf(20, 6, 24.5, 3.5, 1.4)), F('y2', blob(21, 6, 1, 2), 0.6)],
    d: [D('m3', 'M18.4 14 h3.2 M18.4 22 h3.2', 0.7, 0.8), D('y2', 'M15.8 3.8 l1 .6 M24.2 3.8 l-1 .6', 0.6, 0.8)],
    l: [L('G', 'M18.3 29.6 L18.3 11', 0.9, 0.9)],
    p: [P('M19 12 L19 27', 0.6, 0.7)],
  }));
  def('hong-kong', () => {
    const hull = shape([[5, 27], [35, 27], [32, 32], [9, 32]], 0.3);
    const s1 = shape([[11, 25], [11, 9], [18, 7], [19, 25]], 0.3), s2 = shape([[21, 25], [21, 5], [29, 8], [30, 25]], 0.3);
    let ribs = '';
    for (let y = 11; y < 25; y += 3) ribs += `M11 ${y} L19 ${y - 0.5} M21 ${y - 1} L30 ${y - 0.3} `;
    return merge({
      f: [F('c1', blob(20, 35, 17, 3), 0.85), S('c0', 'M7 34 q2 -1 4 0 q2 1 4 0 M23 35 q2 -1 4 0 q2 1 4 0', 0.8, 0.9), F('e1', hull), F('e2', blob(28, 31, 9, 3), 0.6, hull), S('e3', 'M15 25 L15 6 M25 25 L25 4', 0.8), F('r1', s1), F('r1', s2), F('r2', blob(28, 18, 4, 9), 0.5, s2), F('r2', blob(18, 18, 3, 9), 0.45, s1)],
      d: [D('r3', ribs, 0.6, 0.7)],
      h: [H('e2', hull, [24, 30, 18, 4], 60, 6, 0.5)],
      l: [L('e3', path([[5.2, 27.3], [9, 31.8]]), 1), L('r3', path([[11.1, 24.6], [11.1, 9.4], [17.6, 7.3]]), 0.9)],
    });
  });
  def('new-orleans', () => {
    const car = poly([[5, 30], [5, 14], [35, 14], [35, 30]], 0.3);
    let win = '';
    for (let x = 7.5; x < 33; x += 4.5) win += `M${x} 17 h3 v5 h-3Z `;
    return merge({
      f: [F('b1', car), F('b2', blob(30, 26, 12, 8), 0.5, car), F('r1', poly([[5, 24.5], [35, 24.5], [35, 26.5], [5, 26.5]], 0.15)), F('b1', shape([[6, 14], [8, 10.5], [32, 10.5], [34, 14]], 0.2)), S('k2', 'M20 10.5 L20 4 M17 4 L23 4', 0.8),
        F('k2', blob(11, 31.5, 2.2, 2.2)), F('k2', blob(29, 31.5, 2.2, 2.2)), S('k1', 'M3 34 L37 34', 1)],
      d: [D('y0', win, 0, 0.95, true), D('b3', win, 0.6, 0.7), D('y1', 'M5.5 28 h29', 0.6, 0.8)],
      h: [H('b2', car, [28, 22, 14, 14], 60, 6, 0.5)],
      l: [L('b3', path([[5.2, 29.6], [5.1, 14.3], [8, 10.7]]), 1)],
    });
  });
  def('lima', () => {
    const f = poly([[8, 35], [8, 18], [32, 18], [32, 35]], 0.3);
    const tower = (x) => poly([[x - 3, 18], [x - 3, 8], [x + 3, 8], [x + 3, 18]], 0.2);
    return merge(sky('s'), {
      f: [F('y0', f), F('y0', tower(10)), F('y0', tower(30)), F('o0', blob(28, 28, 10, 9), 0.5, f), F('e0', blob(10, 7, 3.2, 2.6)), F('e0', blob(30, 7, 3.2, 2.6)), F('y0', shape([[15, 18], [20, 12], [25, 18]], 0.2)), F('e1', shape([[17.5, 35], [17.5, 27], [20, 24], [22.5, 27], [22.5, 35]], 0.2))],
      d: [D('o2', 'M9 12 h2 v3 h-2Z M29 12 h2 v3 h-2Z M12 23 v4 M28 23 v4 M8 20 h24', 0.8, 0.9)],
      h: [H('o2', f, [28, 28, 10, 12], 60, 5, 0.5)],
      l: [L('e3', path([[8.2, 34.6], [8.1, 18.4], [7.2, 8.4]]), 1)],
    });
  });

  // ---------- hand lettering (monoline path alphabet, 1 unit grid) ----------
  // baseline y=5, x-height y=2, ascender y=0, descender y=7. [path, width]
  const GLYPHS = {
    a: ['M3 2.6 Q1.5 1.6 .6 3 Q0 4.8 1.6 5 Q2.6 5 3 3.6 M3 2 L3 5', 3], b: ['M0 0 L0 5 M0 3.4 Q1 1.8 2.4 2.4 Q3.2 3.4 2.4 4.6 Q1 5.4 0 4.4', 3],
    c: ['M2.8 2.6 Q1.6 1.6 .6 2.8 Q0 4.4 1.2 5 Q2.2 5.2 2.9 4.4', 2.9], d: ['M3 0 L3 5 M3 3.4 Q2 1.8 .6 2.4 Q-.2 3.4 .6 4.6 Q2 5.4 3 4.4', 3],
    e: ['M.2 3.4 L2.9 3.4 Q2.8 1.8 1.5 2 Q0 2.3 .2 3.8 Q.6 5.2 2.8 4.6', 3], f: ['M2.4 .3 Q1.2 -.2 1.1 1.2 L1.1 5 M0 2.2 L2.2 2.2', 2.4],
    g: ['M3 2.6 Q1.5 1.6 .6 3 Q0 4.6 1.6 4.6 Q2.6 4.6 3 3.4 M3 2 L3 6 Q2.6 7.4 .6 6.6', 3], h: ['M0 0 L0 5 M0 3 Q1 1.8 2.2 2.2 Q2.8 2.6 2.8 3.6 L2.8 5', 2.8],
    i: ['M.4 2 L.4 5 M.4 .6 L.45 .9', 0.9], j: ['M1 2 L1 6 Q.8 7.2 -.4 6.8 M1 .6 L1.05 .9', 1.4], k: ['M0 0 L0 5 M2.6 2 L.2 3.6 M1 3 L2.8 5', 2.8],
    l: ['M.4 0 L.4 4.4 Q.5 5.1 1.2 4.9', 1.3], m: ['M0 2 L0 5 M0 3 Q.6 1.8 1.4 2.2 Q2 2.6 2 3.4 L2 5 M2 3.2 Q2.6 1.8 3.4 2.2 Q4 2.6 4 3.4 L4 5', 4],
    n: ['M0 2 L0 5 M0 3 Q1 1.8 2.2 2.2 Q2.8 2.6 2.8 3.6 L2.8 5', 2.8], o: ['M1.5 2 Q0 2 0 3.5 Q0 5 1.5 5 Q3 5 3 3.5 Q3 2 1.5 2', 3],
    p: ['M0 2 L0 7.2 M0 3.2 Q1 1.8 2.4 2.4 Q3.2 3.4 2.4 4.6 Q1 5.4 0 4.4', 3], q: ['M3 2 L3 7.2 M3 3.2 Q2 1.8 .6 2.4 Q-.2 3.4 .6 4.6 Q2 5.4 3 4.4', 3],
    r: ['M0 2 L0 5 M0 3.2 Q.8 1.8 2.2 2.2', 2.2], s: ['M2.5 2.4 Q1.4 1.7 .5 2.3 Q0 3 1.2 3.4 Q2.6 3.8 2.4 4.6 Q1.6 5.4 .2 4.7', 2.6],
    t: ['M1 .6 L1 4.4 Q1.1 5.1 2 4.9 M0 2 L2.2 2', 2.2], u: ['M0 2 L0 4 Q.2 5 1.4 5 Q2.6 4.8 2.8 3.6 M2.8 2 L2.8 5', 2.8],
    v: ['M0 2 L1.4 5 L2.8 2', 2.8], w: ['M0 2 L1 5 L2 2.6 L3 5 L4 2', 4], x: ['M0 2 L2.6 5 M2.6 2 L0 5', 2.6], y: ['M0 2 L1.4 4.8 M2.8 2 L1 7', 2.8],
    z: ['M0 2 L2.6 2 L0 5 L2.7 5', 2.7], '!': ['M.4 .4 L.4 3.6 M.4 4.8 L.45 5', 1], '.': ['M.3 4.8 L.35 5', 0.8], '1': ['M.2 1 L1.2 .2 L1.2 5', 1.6], ' ': ['', 1.6],
  };
  // Lay out `text` at (x, y-top) with unit scale s; each glyph point jittered
  // so lettering looks written, not typeset.
  function letter(text, x, y, s, seed) {
    const R = rng(seed);
    let cx = 0, d = '';
    for (const ch of String(text).toLowerCase()) {
      const g = GLYPHS[ch] || GLYPHS[' '];
      const dy = (R() - 0.5) * 0.4;
      d += g[0].replace(/(-?\d*\.?\d+) (-?\d*\.?\d+)/g, (_, a, b) =>
        `${n1(x + (cx + parseFloat(a) + (R() - 0.5) * 0.25) * s)} ${n1(y + (parseFloat(b) + dy + (R() - 0.5) * 0.25) * s)}`) + ' ';
      cx += g[1] + 0.7;
    }
    return d;
  }

  // ---------- hatching (seeded, scribbly parallel strokes) ----------
  function hatchStrokes(box, angle, count, seed) {
    const R = rng(seed);
    const [cx, cy, w, h] = box;
    const a = angle * Math.PI / 180;
    const rad = 0.5 * Math.hypot(w, h);
    let out = [];
    for (let i = 0; i < count; i++) {
      const aj = a + (R() - 0.5) * 0.2; // ±6°
      const dx = Math.cos(aj), dy = Math.sin(aj), nx = -dy, ny = dx;
      const t = -rad + (i + 0.5) * (2 * rad / count) + (R() - 0.5) * (rad / count);
      const len = rad * (1.1 + R() * 0.8);
      const sh = (R() - 0.5) * rad * 0.4;
      const mx = cx + nx * t + dx * sh, my = cy + ny * t + dy * sh;
      const bow = (R() - 0.5) * 1.4;
      out.push({
        d: `M${n1(mx - dx * len / 2)} ${n1(my - dy * len / 2)} Q${n1(mx + nx * bow)} ${n1(my + ny * bow)} ${n1(mx + dx * len / 2)} ${n1(my + dy * len / 2)}`,
        w: 0.7 + R() * 0.5,
        o: 0.75 + R() * 0.25,
      });
    }
    return out;
  }

  // ---------- composition ----------
  function compose(key, opts = {}) {
    if (!ILLOS[key]) throw new Error('No illustration for ' + key);
    const spec = specOf(key);
    const size = opts.size || 96;
    const dark = opts.theme === 'dark';
    const seed = hashStr(key);
    const id = 'i' + seed.toString(36);
    const minW = 20 / size; // keep lines ≥ 1 device px at 2× rasterization
    const hk = size < 32 ? 0.5 : size < 64 ? 0.8 : size >= 96 ? 1.25 : 1;
    const defs = [];
    const clipIds = new Map(); // identical clip shapes share one def
    const clipRef = (d) => {
      let cid = clipIds.get(d);
      if (!cid) {
        cid = `${id}k${clipIds.size}`;
        clipIds.set(d, cid);
        defs.push(`<clipPath id="${cid}"><path d="${d}"/></clipPath>`);
      }
      return `clip-path="url(#${cid})"`;
    };
    const fills = (spec.f || []).map((e) => {
      const clip = e.clip ? ' ' + clipRef(e.clip) : '';
      if (e.w) return `<path d="${e.d}" fill="none" stroke="${col(e.c)}" stroke-width="${n1(Math.max(e.w, minW))}" stroke-linecap="round" stroke-linejoin="round" opacity="${e.o}"${clip}/>`;
      return `<path d="${e.d}" fill="${col(e.c)}" opacity="${e.o}"${e.eo ? ' fill-rule="evenodd"' : ''}${clip}/>`;
    }).join('');
    let hs = 0;
    const hatch = (spec.h || []).map((e) => {
      const n = Math.max(2, Math.round(e.n * hk));
      const strokes = hatchStrokes(e.box, e.a, n, seed + 31 * ++hs);
      return `<g ${clipRef(e.clip)} stroke="${col(e.c)}" fill="none" stroke-linecap="round" opacity="${e.o}">${strokes.map((s) =>
        `<path d="${s.d}" stroke-width="${n1(Math.max(s.w, minW))}" opacity="${n1(s.o)}"/>`).join('')}</g>`;
    }).join('');
    const lines = (spec.l || []).map((e) => {
      const c = dark && spec.darkLine ? PAL.m[2] : col(e.c);
      return `<path d="${e.d}" stroke="${c}" stroke-width="${n1(Math.max(e.w, minW))}" opacity="${e.o}"/>`;
    }).join('');
    const his = (spec.p || []).map((e) => e.w
      ? `<path d="${e.d}" fill="none" stroke="${PAPER}" stroke-width="${n1(e.w)}" stroke-linecap="round" opacity="${e.o}"/>`
      : `<path d="${e.d}" fill="${PAPER}" opacity="${e.o}"/>`).join('');
    const detail = (spec.d || []).map((e) => e.fill
      ? `<path d="${e.d}" fill="${col(e.c)}" opacity="${e.o}"/>`
      : `<path d="${e.d}" fill="none" stroke="${col(e.c)}" stroke-width="${n1(Math.max(e.w, minW))}" stroke-linecap="round" stroke-linejoin="round" opacity="${e.o}"/>`).join('');
    const lettering = (spec.t || []).map((e, i) =>
      `<path d="${letter(e.text, 0, 0, e.s, seed + i)}" transform="translate(${e.x} ${e.y}) rotate(${e.r})" fill="none" stroke="${col(e.c)}" stroke-width="${n1(Math.max(0.75, minW))}" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
    const gouache = `<filter id="${id}g" x="-8%" y="-8%" width="116%" height="116%" color-interpolation-filters="sRGB">
<feTurbulence type="fractalNoise" baseFrequency="0.5" numOctaves="2" seed="${seed % 997}" result="n"/>
<feDisplacementMap in="SourceGraphic" in2="n" scale="1.3" xChannelSelector="R" yChannelSelector="G" result="d"/>
<feTurbulence type="fractalNoise" baseFrequency="0.07 0.55" numOctaves="2" seed="${(seed >> 3) % 997}" result="st"/>
<feColorMatrix in="st" type="matrix" values="0 0 0 0 .98 0 0 0 0 .96 0 0 0 0 .92 0 0 0 1.5 -.82" result="stc"/>
<feComposite in="stc" in2="d" operator="in" result="sti"/>
<feTurbulence type="fractalNoise" baseFrequency="1.7" numOctaves="1" seed="${(seed >> 5) % 997}" result="gr"/>
<feColorMatrix in="gr" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -16 12" result="grm"/>
<feMerge result="m"><feMergeNode in="d"/><feMergeNode in="sti"/></feMerge>
<feComposite in="m" in2="grm" operator="in"/>
</filter>`;
    const crayon = `<filter id="${id}c" x="-8%" y="-8%" width="116%" height="116%" color-interpolation-filters="sRGB">
<feTurbulence type="fractalNoise" baseFrequency="1.4" numOctaves="1" seed="${(seed >> 7) % 997}" result="n"/>
<feDisplacementMap in="SourceGraphic" in2="n" scale="0.6" xChannelSelector="R" yChannelSelector="G" result="d"/>
<feTurbulence type="fractalNoise" baseFrequency="2.8" numOctaves="1" seed="${(seed >> 9) % 997}" result="g"/>
<feColorMatrix in="g" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -6 4.6" result="gm"/>
<feComposite in="d" in2="gm" operator="in"/>
</filter>`;
    const filt = opts.plain ? () => '' : (k) => ` filter="url(#${id}${k})"`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="${size}" height="${size}"><defs>${opts.plain ? '' : gouache + crayon}${defs.join('')}</defs>`
      + `<g${filt('g')}>${fills}</g><g${filt('c')}>${hatch}</g>`
      + `<g fill="none" stroke-linecap="round" stroke-linejoin="round"${filt('c')}>${lines}</g>`
      + `<g>${his}</g><g${filt('c')}>${detail}${lettering}</g></svg>`;
  }

  // ---------- resolution ----------
  // canonicalKey-compatible normalization (lib/canonical.js) so item names
  // that never got a stored key still resolve.
  function normKey(name) {
    return String(name || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/)
      .filter((w) => !['the', 'a', 'an'].includes(w)).join('-');
  }
  const ALIASES = {
    tomato: 'cherry-tomatoes', tomatoes: 'cherry-tomatoes', 'cherry-tomato': 'cherry-tomatoes',
    mushroom: 'mushrooms', onion: 'onions', olives: 'black-olives', 'black-olive': 'black-olives',
    cheese: 'extra-cheese', basil: 'fresh-basil', peppers: 'green-peppers', 'green-pepper': 'green-peppers',
    jalapeno: 'jalapenos', anchovy: 'anchovies', artichoke: 'artichokes', pancake: 'pancakes', waffle: 'waffles',
    'pineapple-on-pizza': 'pineapple', usa: 'united-states', 'united-states-of-america': 'united-states', holland: 'netherlands',
    nyc: 'new-york', 'new-york-city': 'new-york', 'marrakech': 'marrakesh',
  };
  // An item gets a drawing only when one exists for it specifically. There
  // are no category stand-ins (no generic coin/football/film icon): an item
  // with neither an official image nor its own drawing renders as a
  // name-only tile, decided by the caller (keyFor returns null).
  function keyFor(item) {
    if (!item) return null;
    for (const k of [item.canonical_key, normKey(item.name)]) {
      if (!k) continue;
      if (ILLOS[k]) return k;
      if (ALIASES[k]) return ALIASES[k];
    }
    return null;
  }

  // ---------- rasterize once, reuse everywhere ----------
  const cache = new Map();   // cacheKey -> url (sync lookups for re-renders)
  const pending = new Map(); // cacheKey -> Promise<url>
  const failed = new Set();
  const dpr = () => Math.max(2, Math.min(3, Math.ceil((root.devicePixelRatio || 1))));
  const themeOf = () => (root.document && root.document.documentElement.classList.contains('dark')) ? 'dark' : 'light';
  const cacheKey = (key, size, theme) => {
    const themed = ILLOS[key] && specOf(key).darkLine;
    return `${key}@${size}x${dpr()}${themed && theme === 'dark' ? ':d' : ''}`;
  };

  function svgUrl(key, size, theme) {
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(compose(key, { size, theme }));
  }

  function load(key, size, theme) {
    theme = theme || themeOf();
    if (!ILLOS[key] || failed.has(key)) return Promise.resolve(null);
    const ck = cacheKey(key, size, theme);
    if (cache.has(ck)) return Promise.resolve(cache.get(ck));
    if (pending.has(ck)) return pending.get(ck);
    const p = new Promise((resolve) => {
      let src;
      try { src = svgUrl(key, size, theme); } catch (err) {
        console.warn('illustration failed', key, err);
        failed.add(key);
        resolve(null);
        return;
      }
      const img = new Image();
      img.onload = () => {
        try {
          const px = size * dpr();
          const c = document.createElement('canvas');
          c.width = px; c.height = px;
          c.getContext('2d').drawImage(img, 0, 0, px, px);
          c.toBlob((blob) => {
            const url = blob ? URL.createObjectURL(blob) : src;
            cache.set(ck, url);
            resolve(url);
          }, 'image/png');
        } catch (_) {
          // Canvas refused (tainted SVG on some engines) — the SVG itself
          // is still a perfectly good image.
          cache.set(ck, src);
          resolve(src);
        }
      };
      img.onerror = () => {
        console.warn('illustration failed to rasterize', key);
        failed.add(key);
        resolve(null);
      };
      img.src = src;
    });
    pending.set(ck, p);
    p.then(() => pending.delete(ck));
    return p;
  }
  function cached(key, size, theme) {
    if (!ILLOS[key] || failed.has(key)) return null;
    return cache.get(cacheKey(key, size, theme || themeOf())) || null;
  }

  const tintFor = (id) => TINTS[hashStr('t' + id) % TINTS.length];
  const rotFor = (id) => (hashStr('r' + id) % 13) - 6;

  const api = {
    PAL, TINTS,
    keys: () => Object.keys(ILLOS),
    compose, keyFor, normKey, load, cached, tintFor, rotFor, hashStr,
  };
  root.Illos = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
