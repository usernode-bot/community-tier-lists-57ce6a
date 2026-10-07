(() => {
  'use strict';

  // ---------- plumbing ----------

  const params = new URLSearchParams(location.search);
  if (params.get('token')) sessionStorage.setItem('ctl_token', params.get('token'));
  const TOKEN = params.get('token') || sessionStorage.getItem('ctl_token') || '';

  // Fixed pastel ramp by tier position; letters (ink, never white) always
  // accompany colour. Not themed — html.dark dims the blocks via CSS.
  const RAMP = ['#E9A28C', '#EDCB80', '#BACB96', '#AFC6DB', '#CDB9DA', '#C9C6BE'];
  const TIER_INK = '#1E1B18';
  const tierColor = (idx) => RAMP[Math.min(idx, RAMP.length - 1)];

  const $app = document.getElementById('app');
  let homeCache = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      method: opts.method || 'GET',
      headers: {
        'content-type': 'application/json',
        ...(TOKEN ? { 'x-usernode-token': TOKEN } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok) {
      const e = new Error(data.error || ('Request failed (' + res.status + ')'));
      e.status = res.status;
      e.code = data.code;
      e.data = data;
      throw e;
    }
    return data;
  }

  function toast(msg) {
    if (window.unNative && unNative.toast) { unNative.toast(msg); return; }
    let t = document.getElementById('ctl-toast');
    if (t) t.remove();
    t = document.createElement('div');
    t.id = 'ctl-toast';
    // Dark surface in BOTH themes (the iOS HUD idiom); --toast-bg lifts in dark
    // so the capsule still separates from the page.
    t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--toast-bg);color:var(--toast-fg);padding:9px 18px;border-radius:99px;font-size:13.5px;font-weight:600;z-index:99;max-width:88vw';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2400);
  }

  function showSheet(html, onClose) {
    const back = document.createElement('div');
    back.className = 'sheet-backdrop';
    const panel = document.createElement('div');
    panel.className = 'sheet-panel';
    panel.innerHTML = html;
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      back.remove(); panel.remove();
      if (onClose) onClose();
    };
    back.addEventListener('click', close);
    document.body.appendChild(back);
    document.body.appendChild(panel);
    return { panel, close };
  }

  // In-app replacement for window.prompt(), which the browser blocks in
  // the cross-origin platform iframe (returns null without showing).
  // Resolves the entered string ('' allowed) on confirm, null on cancel.
  async function askText({ title, placeholder = '', confirmLabel = 'OK', initial = '' } = {}) {
    if (window.unNative && unNative.alert) {
      let confirmed = false;
      const r = await unNative.alert({
        title,
        field: { placeholder, value: initial },
        buttons: [
          { label: 'Cancel', style: 'cancel' },
          { label: confirmLabel, style: 'default', handler: () => { confirmed = true; } },
        ],
      });
      if (!confirmed) return null;
      return r && r.value != null ? String(r.value) : '';
    }
    return new Promise((resolve) => {
      let result = null;
      const { panel, close } = showSheet(`
        <div class="font-display font-black text-lg mb-2">${esc(title || '')}</div>
        <input id="ask-input" type="text" placeholder="${esc(placeholder)}" value="${esc(initial)}">
        <div class="grid grid-cols-2 gap-2 mt-3">
          <button id="ask-cancel" class="btn-primary" style="background:transparent;color:var(--ink);border:1px solid var(--line)">Cancel</button>
          <button id="ask-ok" class="btn-primary">${esc(confirmLabel)}</button>
        </div>`, () => resolve(result));
      const input = panel.querySelector('#ask-input');
      const ok = () => { result = input.value; close(); };
      panel.querySelector('#ask-ok').addEventListener('click', ok);
      panel.querySelector('#ask-cancel').addEventListener('click', () => close());
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
      input.focus({ preventScroll: true });
    });
  }

  function urlWithToken(path) {
    return TOKEN ? path + (path.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(TOKEN) : path;
  }
  function nav(path, replace) {
    if (replace) history.replaceState({}, '', urlWithToken(path));
    else history.pushState({}, '', urlWithToken(path));
    route();
  }
  window.addEventListener('popstate', route);
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-nav]');
    if (t) { e.preventDefault(); nav(t.getAttribute('data-nav')); }
  });

  function transition(fn, type) {
    if (window.unNative && unNative.transition) unNative.transition(fn, { type: type || 'none' });
    else fn();
  }

  function header(title, opts = {}) {
    const back = opts.back === false ? '' :
      `<button data-nav="${esc(opts.back || '/')}" class="un-touch-target text-xl font-bold px-1" style="color:var(--link)" aria-label="Back">←</button>`;
    return `<header class="sticky top-0 z-20 un-safe-top" style="background:var(--header-bg);backdrop-filter:blur(8px)">
      <div class="max-w-xl mx-auto flex items-center gap-2 px-3 h-12">
        ${back}
        <div class="font-display text-[21px] truncate">${title}</div>
        <div class="ml-auto flex items-center gap-1">${opts.actions || ''}</div>
      </div>
    </header>`;
  }

  function screen(html) {
    $app.innerHTML = html;
    hydrateIllos($app);
  }

  // ---------- illustrations ----------
  // Every item renders through Illos (public/illustrations.js): uploaded
  // photo first, else its own drawing, else its list's category object.
  // Bitmaps are cached, so re-renders (every tap on the board) reuse them
  // synchronously; first sightings are hydrated right after the render.
  const I = window.Illos;
  const reducedMotion = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  function illoHtml(it, size, category, extraStyle = '') {
    if (it && it.image_url) {
      return `<span class="illo photo" style="width:${size}px;height:${size}px;${extraStyle}"><img src="${esc(it.image_url)}" alt=""></span>`;
    }
    const key = I.keyFor(it, category);
    const url = I.cached(key, size);
    return `<span class="illo" data-illo="${key}" data-isz="${size}" style="width:${size}px;height:${size}px;${extraStyle}">${url ? `<img src="${url}" alt="">` : ''}</span>`;
  }

  function figHtml(it, size, category, opts = {}) {
    const rot = opts.rotate === false ? 0 : I.rotFor(it.id);
    return `<span class="fig ${opts.cls || ''}" style="${opts.style || ''}">${illoHtml(it, size, category, `transform:rotate(${rot}deg)`)}<span class="cap">${esc(it.name)}</span></span>`;
  }

  function hydrateIllos(rootEl) {
    (rootEl || document).querySelectorAll('[data-illo]').forEach((el) => {
      if (el.querySelector('img')) return;
      I.load(el.dataset.illo, parseInt(el.dataset.isz, 10)).then((url) => {
        if (url && el.isConnected && !el.querySelector('img')) el.innerHTML = `<img src="${url}" alt="">`;
      });
    });
  }

  // Warm the cache for a list's items before its screen paints.
  function prewarm(items, category, size) {
    return Promise.all((items || []).filter((it) => !it.image_url).map((it) => I.load(I.keyFor(it, category), size)));
  }

  function topbar(left, right) {
    return `<div class="topbar">${left || '<span></span>'}${right || '<span></span>'}</div>`;
  }

  function renderError(err) {
    const msg = err && err.status === 401
      ? 'Your session expired — reopen the app from Usernode.'
      : (err && err.message) || 'Something went wrong.';
    screen(`${header('Tier Lists')}
      <main class="max-w-xl mx-auto p-4">
        <div class="card p-6 text-center">
          <div class="text-3xl mb-2">🫠</div>
          <div class="font-semibold mb-1">${esc(msg)}</div>
          <button data-nav="/" class="mt-3 text-sm font-bold" style="color:var(--accent)">← Back home</button>
        </div>
      </main>`);
  }

  function loading(title) {
    screen(`${header(title || 'Tier Lists')}<main class="max-w-xl mx-auto p-4"><div class="p-10 text-center" style="color:var(--ink-soft)">Loading…</div></main>`);
  }

  const ROUTES = [
    [/^\/$/, renderHome],
    [/^\/today$/, renderToday],
    [/^\/t\/(\d+)$/, renderRank],
    [/^\/t\/(\d+)\/results$/, (id) => renderResults(id, false)],
    [/^\/t\/(\d+)\/comments$/, (id) => renderResults(id, true)],
    [/^\/t\/(\d+)\/compare\/([^\/]+)$/, renderCompare],
    [/^\/new$/, renderNew],
    [/^\/g\/join\/([^\/]+)$/, renderJoin],
    [/^\/g\/(\d+)$/, renderGroup],
    [/^\/me$/, renderMe],
    [/^\/mod$/, renderMod],
    [/^\/illustrations$/, renderIllustrations],
  ];

  async function route() {
    closeCommentStream();
    const path = location.pathname;
    for (const [re, fn] of ROUTES) {
      const m = path.match(re);
      if (m) {
        try { await fn(...m.slice(1).map(decodeURIComponent)); } catch (err) { renderError(err); }
        window.scrollTo(0, 0);
        return;
      }
    }
    renderError({ message: 'Page not found', status: 404 });
  }

  async function getHome(force) {
    if (!homeCache || force) homeCache = await api('/api/home');
    return homeCache;
  }

  const tierLetterChip = (labels, tier) => tier == null ? '<span class="tchip" style="background:var(--tint-neutral-bg);color:var(--tint-neutral-fg)">skip</span>'
    : `<span class="tchip" style="background:${tierColor(tier - 1)}">${esc(labels[tier - 1] || tier)}</span>`;

  // "6 exact · 1 one tier off · 1 clash" — the disagreements behind the
  // headline %, always rendered so a high score can't hide them (issue #14).
  const breakdownLine = (s) => {
    const parts = [`${s.exact} exact`];
    if (s.near) parts.push(`${s.near} one tier off`);
    if (s.clashes) parts.push(`${s.clashes} clash${s.clashes === 1 ? '' : 'es'}`);
    return parts.join(' · ');
  };

  const CHEV = '<span class="chev" aria-hidden="true">›</span>';

  const statusPill = (myStatus) => myStatus === 'submitted'
    ? '<span class="badge" style="background:var(--ink);color:var(--paper)">Results</span>'
    : myStatus === 'draft'
      ? '<span class="badge" style="background:var(--tint-warn-bg);color:var(--tint-warn-fg)">Resume</span>'
      : '<span class="badge" style="background:var(--tint-accent-bg);color:var(--tint-accent-fg)">Rank now</span>';

  // Submitted → community results; draft / not started → the ranking board.
  const templateDest = (id, myStatus) => myStatus === 'submitted' ? `/t/${id}/results` : `/t/${id}`;

  // ---------- Home ----------

  const homeUi = { tab: 'trending' };

  // Today's List closes at the next UTC midnight after its run date.
  function closesIn(runDate) {
    if (!runDate) return '';
    const ms = Date.parse(runDate + 'T00:00:00Z') + 864e5 - Date.now();
    if (ms <= 0) return 'closing now';
    const hrs = Math.floor(ms / 36e5);
    return hrs >= 1 ? `closes in ${hrs}h` : `closes in ${Math.max(1, Math.ceil(ms / 6e4))}m`;
  }

  const ctaFor = (myStatus) => myStatus === 'submitted' ? 'See the results' : myStatus === 'draft' ? 'Resume' : 'Rank now';

  // Scatter slots for the hero composition: [left fraction, top px].
  const SCATTER = [[0, 6], [0.16, 44], [0.33, 0], [0.5, 40], [0.66, 6], [0.83, 44], [1, 2]];

  async function renderHome() {
    loading('Tier Lists');
    const h = await getHome(true);
    const today = h.today;
    if (today) await Promise.race([prewarm(today.preview, today.category, 52), new Promise((r) => setTimeout(r, 600))]);

    const stagingPill = h.env === 'staging'
      ? '<span class="badge" style="background:var(--tint-warn-bg);color:var(--tint-warn-fg);border:1px solid var(--tint-warn-line)">staging</span>' : '';

    const nav = `<nav class="hm-nav pt-3" aria-label="Home sections">
      <div class="links">
        <button class="on" data-scroll="top" aria-current="page">Lists</button>
        <button data-scroll="groups">Groups</button>
        <button data-scroll="activity">Activity</button>
        ${h.me.is_moderator ? '<button data-nav="/mod">Mod</button>' : ''}
      </div>
      <div class="flex items-center gap-2">${stagingPill}<button data-nav="/me" class="serif text-[19px] un-touch-target">Profile</button></div>
    </nav>`;

    let hero = '';
    if (today) {
      const cta = today.my_status === 'submitted' ? 'See the results' : today.my_status === 'draft' ? 'Resume' : 'Rank';
      const dest = templateDest(today.template_id, today.my_status);
      const animate = !reducedMotion();
      const figs = (today.preview || []).slice(0, 7).map((it, i) => {
        const [fx, top] = SCATTER[i];
        return figHtml(it, 52, today.category, {
          cls: animate ? 'reveal' : '',
          style: `left:calc((100% - 64px) * ${fx});top:${top}px;${animate ? `animation-delay:${i * 60}ms;` : ''}`,
        });
      }).join('');
      hero = `<section class="hero mt-4" aria-label="Today's list">
        <h2 class="cond ht">${esc(today.title)}</h2>
        <div class="ed kicker">Today's list / No. ${today.edition_no}</div>
        <div class="scatter">${figs}</div>
        <div class="meta kicker">${today.item_count} items · ${closesIn(today.run_date)} · ${today.n} ranked so far${today.my_status === 'submitted' ? ' · yours is in' : ''}</div>
        <button data-nav="${dest}" class="circle" style="${cta.length > 8 ? 'font-size:16px' : ''}">${cta}</button>
      </section>`;
    }

    const draft = h.in_progress[0];
    const contCard = draft ? `<button data-nav="/t/${draft.template_id}" class="cont-card un-pressable" aria-label="Continue ${esc(draft.title)}, ${draft.placed} of ${draft.total} placed">
        <div class="flex items-start gap-2">
          <span class="min-w-0 flex-1"><span class="kicker text-[12px] block">Continue</span><span class="cond text-[15px] leading-tight block">${esc(draft.title)}</span></span>
          ${illoHtml((draft.preview || [])[0], 36, draft.category)}
        </div>
        <div class="progline mt-3 mb-1" style="margin-right:56px"><i style="width:${draft.total ? Math.round(draft.placed / draft.total * 100) : 0}%"></i></div>
        <div class="text-[12px]" style="color:var(--ink-soft)">${draft.placed} of ${draft.total} placed</div>
        <span class="circle md" aria-hidden="true">Resume</span>
      </button>` : '';
    const g0 = h.groups[0];
    const grpCard = `<button ${g0 ? `data-nav="/g/${g0.id}"` : 'data-newgroup="1"'} class="grp-card un-pressable">
        <span class="kicker text-[12px] block">Groups</span>
        ${g0 ? `<span class="serif text-[17px] leading-tight block">${esc(g0.name)}</span>
          <span class="text-[12px] block mt-1" style="color:var(--ink-soft)">${g0.member_count} member${g0.member_count === 1 ? '' : 's'}${h.groups.length > 1 ? ` · +${h.groups.length - 1} more` : ''}</span>`
        : '<span class="serif text-[16px] leading-tight block">Start a private list with friends</span>'}
      </button>`;

    const tabs = [['trending', 'Trending', h.feed.length], ['progress', 'In progress', h.in_progress.length], ['yours', 'Yours', null]];
    const tabsHtml = `<div class="tabs mt-5" role="tablist" aria-label="Lists">${tabs.map(([k, label, n]) =>
      `<button role="tab" data-tab="${k}" aria-selected="${homeUi.tab === k}">${label}${n != null ? `<sup class="cnt">(${n})</sup>` : ''}</button>`).join('')}</div>`;

    const activity = `<section id="activity">
      <h2 class="sec-h">Activity</h2>
      ${h.changing.map((c) => `<div class="act-line"><span>${esc(c.title)}</span>${c.body ? `<span class="dim">: ${esc(c.body)}</span>` : ''}</div>`).join('')}
      ${h.recent_rankings.map((r) => `<button data-nav="${templateDest(r.template_id, r.my_status)}" class="act-line un-pressable"><span>${esc(r.username)}</span> <span class="dim">ranked “${esc(r.title)}”</span></button>`).join('')}
      ${!h.changing.length && !h.recent_rankings.length ? '<div class="act-line dim">Quiet so far.</div>' : ''}
    </section>`;

    const groups = `<section id="groups">
      <div class="flex items-baseline"><h2 class="sec-h">Groups</h2><button data-newgroup="1" class="linkish ml-auto text-[15px]">+ new group</button></div>
      ${h.groups.length ? h.groups.map((g) => `<button data-nav="/g/${g.id}" class="act-line un-pressable"><span>${esc(g.name)}</span> <span class="dim">· ${g.member_count} member${g.member_count === 1 ? '' : 's'}${g.recent ? ` · ${g.recent} new ranking${g.recent === 1 ? '' : 's'}` : ''}</span></button>`).join('')
      : '<div class="act-line dim">Run private lists with friends: restaurants, crags, whatever you argue about.</div>'}
    </section>`;

    screen(`<main class="max-w-xl mx-auto px-4 pb-28 un-safe-top un-safe-bottom" id="home-top">
      ${nav}
      ${tabsHtml}
      ${hero}
      <div class="row2 mt-3">${contCard}${grpCard}</div>
      <section id="lists-panel" class="mt-6" role="tabpanel"></section>
      ${groups}
      ${activity}
    </main>
    <button data-nav="/new" class="fab un-pressable" aria-label="New list">＋</button>`);

    drawHomePanel(h);

    document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
      homeUi.tab = b.dataset.tab;
      document.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      drawHomePanel(h);
    }));
    document.querySelectorAll('[data-scroll]').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.scroll;
      if (id === 'top') window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
      else document.getElementById(id).scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth' });
    }));
    document.querySelectorAll('[data-newgroup]').forEach((b) => b.addEventListener('click', async () => {
      const name = await askText({ title: 'New group', placeholder: 'Group name', confirmLabel: 'Create' });
      if (!name) return;
      try {
        const g = await api('/api/groups', { method: 'POST', body: { name } });
        toast('Group created');
        nav('/g/' + g.id);
      } catch (err) { toast(err.message); }
    }));
  }

  // The "All lists" stack for the active tab. Cards overlap; tapping a strip
  // opens that card with a spring (cards above collapse to slivers).
  function drawHomePanel(h) {
    const panel = document.getElementById('lists-panel');
    if (!panel) return;
    let rows, empty;
    if (homeUi.tab === 'progress') {
      rows = h.in_progress.map((r) => ({ ...r, id: r.template_id, my_status: 'draft', nr: `${r.placed} of ${r.total}` }));
      empty = 'Nothing in progress. Start a list and it waits for you here.';
    } else if (homeUi.tab === 'yours') {
      rows = h.mine || [];
      empty = "You haven't ranked or made a list yet.";
    } else {
      rows = h.feed;
      empty = 'Nothing here yet. Create the first list!';
    }
    if (!rows.length) { panel.innerHTML = `<div class="act-line dim kicker">${empty}</div>`; return; }

    panel.innerHTML = `<div class="stack">${rows.map((t, i) => {
      const pv = t.preview || [];
      const nr = t.nr || `${t.n} ranked`;
      return `<article class="stk" data-stk="${i}" data-tid="${t.id}" style="background:${I.tintFor(t.id)}">
        <button class="stk-strip" aria-expanded="false" aria-controls="stkb-${i}" aria-label="${esc(t.title)}, ${esc(nr)}">
          <span class="stk-ic">${illoHtml(null, 28, t.category)}</span>
          <span class="min-w-0 flex-1"><span class="cat">${esc(t.category || 'Lists')}</span><span class="tt cond truncate">${esc(t.title)}</span></span>
          <span class="nr">${esc(nr)}</span>
        </button>
        <div class="stk-body" id="stkb-${i}"><div><div class="stk-inner">
          <div class="figs">${pv.slice(0, 3).map((it) => figHtml(it, 46, t.category)).join('')}</div>
          <div class="bars5" data-bars="${t.id}" aria-hidden="true"></div>
          <div class="by">${t.author_username ? 'by ' + esc(t.author_username) : ''}</div>
          <button class="pill go" data-nav="${templateDest(t.id, t.my_status)}">${ctaFor(t.my_status)}</button>
        </div></div></div>
      </article>`;
    }).join('')}</div>`;
    hydrateIllos(panel);

    const cards = Array.from(panel.querySelectorAll('.stk'));
    const open = (idx) => {
      cards.forEach((c, j) => {
        c.classList.toggle('is-open', j === idx);
        c.classList.toggle('is-sliver', idx != null && j < idx);
        c.querySelector('.stk-strip').setAttribute('aria-expanded', String(j === idx));
      });
      if (idx != null) loadStackBars(cards[idx], rows[idx]);
    };
    cards.forEach((c, j) => c.querySelector('.stk-strip').addEventListener('click', () =>
      open(c.classList.contains('is-open') ? null : j)));
    // Default-open the first list you haven't ranked yet — the pull-in.
    const first = rows.findIndex((t) => t.my_status !== 'submitted');
    open(first === -1 ? 0 : first);
  }

  // 5-bar chart of where every vote on the list lands (lazy, once per card).
  async function loadStackBars(card, t) {
    const el = card.querySelector('[data-bars]');
    if (!el || el.dataset.loaded) return;
    el.dataset.loaded = '1';
    try {
      const agg = await api(`/api/templates/${t.id}/aggregate`);
      const labels = t.tier_labels || ['S', 'A', 'B', 'C', 'D'];
      const totals = labels.map(() => 0);
      for (const a of Object.values(agg.items)) (a.dist || []).forEach((c, i) => { if (i < totals.length) totals[i] += c; });
      const max = Math.max(...totals);
      if (!max) { el.outerHTML = '<div class="by" style="margin:4px 0 8px">No rankings yet. Be the first.</div>'; return; }
      const lead = totals.indexOf(max);
      el.setAttribute('aria-hidden', 'false');
      el.setAttribute('aria-label', 'Votes by tier: ' + labels.map((l, i) => `${l} ${totals[i]}`).join(', '));
      el.innerHTML = labels.map((l, i) => `<div style="display:flex;flex-direction:column;justify-content:flex-end;height:100%">
        <i class="${i === lead ? 'lead' : ''}" style="height:${Math.max(2, Math.round(totals[i] / max * 22))}px"></i><span>${esc(String(l).slice(0, 2))}</span></div>`).join('');
    } catch { el.remove(); }
  }

  async function renderToday() {
    const h = await getHome();
    if (h.today) nav('/t/' + h.today.template_id, true);
    else { toast("No Today's List today"); nav('/', true); }
  }

  // ---------- Rank screen ----------

  const rankState = { id: null, data: null, placements: null, sel: null, saveTimer: null, saveNote: '', trayCollapsed: false };

  async function renderRank(id) {
    loading('…');
    const data = await api('/api/templates/' + id);
    const t = data.template;
    if (t.hidden) {
      screen(`${header(esc(t.title))}<main class="max-w-xl mx-auto p-4">
        <div class="card p-6 text-center"><div class="text-3xl mb-2">🚧</div>
        <div class="font-semibold">This list is hidden pending review.</div></div></main>`);
      return;
    }
    rankState.id = id;
    rankState.data = data;
    rankState.placements = Object.assign({}, data.my.placements);
    rankState.sel = null;
    rankState.saveNote = '';
    await Promise.race([prewarm(data.items, t.category, 44), new Promise((r) => setTimeout(r, 800))]);
    drawRank();
  }

  function drawRank() {
    const { data, placements, sel } = rankState;
    const t = data.template;
    const labels = t.tier_labels;
    const items = data.items;
    const byId = {};
    for (const it of items) byId[it.id] = it;
    const selItem = sel && byId[sel];

    const tileHtml = (it) => `<button class="fig itile ${sel === it.id ? 'selected' : ''}" data-item="${it.id}" aria-pressed="${sel === it.id}"
        aria-label="${esc(it.name)}${it.status === 'proposed' ? ' (only you)' : ''}${it.is_new ? ' (new)' : ''}">
      ${illoHtml(it, 44, t.category, `transform:rotate(${I.rotFor(it.id)}deg)`)}<span class="cap">${esc(it.name)}</span>
      ${it.status === 'proposed' ? '<span class="flag">only you</span>' : it.is_new ? '<span class="flag">NEW</span>' : ''}
    </button>`;

    const rows = labels.map((label, i) => {
      const tier = i + 1;
      const inTier = items.filter((it) => placements[it.id] === tier);
      return `<div class="tier-row mb-2" data-tier-row="${tier}">
        <button class="tblock ${String(label).length > 2 ? 'small' : ''}" style="background:${tierColor(i)}" data-place-tier="${tier}"
          aria-label="${selItem ? `Place ${esc(selItem.name)} in ${esc(label)}` : `Tier ${esc(label)}`}">${esc(label)}</button>
        <div class="tier-items ${inTier.length ? '' : 'empty'} ${selItem ? 'placeable' : ''}" data-zone="1" data-tier="${tier}">${inTier.map(tileHtml).join('')
          || `<span class="kicker text-[13.5px]">${selItem ? `Place ${esc(selItem.name.toLowerCase())} here` : 'Drop here'}</span>`}</div>
      </div>`;
    }).join('');

    const trayItems = items.filter((it) => !(it.id in placements));
    const skipped = items.filter((it) => placements[it.id] === null);
    const placedCount = items.length - trayItems.length - skipped.length;
    const canSubmit = placedCount >= 1;
    const submitted = data.my.status === 'submitted';
    const pct = items.length ? Math.round((placedCount + skipped.length) / items.length * 100) : 0;

    const hint = selItem ? `<div class="hintbar mt-2" id="placer" role="status">
      <span>${esc(selItem.name)} picked. Tap a tier, or drag it there.</span>
      <button data-place="skip" class="linkish">skip (haven't seen it)</button>
      ${(sel in placements) ? '<button data-place="tray" class="linkish">back to the tray</button>' : ''}
    </div>` : '';

    const policy = t.item_policy === 'closed' ? 'Items you add stay in your ranking only.'
      : t.item_policy === 'approved' ? 'Items you add are shared once the author approves.' : '';

    screen(`<main class="max-w-xl mx-auto px-4 un-safe-top">
      ${topbar('<button data-nav="/">Close</button>', '<button id="report-t" class="dim">Report</button>')}
      <div class="text-center">
        <h1 class="cond text-[26px] leading-tight">${esc(t.title)}</h1>
        <div class="rk-pairs"><span><span class="k">List /</span> ${data.daily ? `Today's No. ${data.daily.edition_no}${data.daily.is_final ? ' · final' : ''}` : 'Feed'}</span>
          <span><span class="k">Placed /</span> ${placedCount} of ${items.length}</span></div>
        <div class="progline mx-auto mt-2" style="width:180px"><i style="width:${pct}%"></i></div>
        <div class="kicker text-[13px] mt-1">${submitted ? "Edits update the crowd's grid live" : "The crowd's grid stays hidden until you rank"}${skipped.length ? ` · ${skipped.length} skipped` : ''}
          <span id="save-note" class="not-italic">${esc(rankState.saveNote)}</span></div>
      </div>
      <div id="board" class="mt-4">${rows}</div>
      ${hint}
      ${skipped.length ? `<div class="mt-3">
        <div class="kicker text-[13px] mb-1">Skipped (${skipped.length}): not counted in the aggregate</div>
        <div class="tier-items" data-zone="1" data-skipshelf="1" style="background:transparent;border:1.5px dashed var(--drop-line)">${skipped.map(tileHtml).join('')}</div>
      </div>` : ''}
      ${data.proposals && data.proposals.length ? `<div class="card p-3 mt-3">
        <div class="serif text-[17px] mb-1">Proposed items <span class="kicker text-[13px]">(you're the author)</span></div>
        ${data.proposals.map((p) => `<div class="flex items-center gap-2 text-sm">
          <span class="flex-1">${esc(p.name)} <span style="color:var(--ink-soft)">by ${esc(p.added_by_username || '?')}</span></span>
          <button data-decide="${p.id}:1" class="linkish" style="color:var(--ok-fg)">approve</button>
          <button data-decide="${p.id}:0" class="linkish" style="color:var(--danger-fg)">reject</button>
        </div>`).join('')}
      </div>` : ''}
      <section class="tray ${rankState.trayCollapsed ? 'collapsed' : ''}" data-tray-sheet aria-label="Item tray">
        <button class="grab" id="tray-grab" aria-expanded="${!rankState.trayCollapsed}" aria-label="${rankState.trayCollapsed ? 'Show' : 'Hide'} the item tray"><i></i></button>
        <div class="flex items-baseline gap-2 flex-wrap">
          <span class="serif text-[19px]">Item tray<sup class="cnt">(${trayItems.length})</sup></span>
          <span class="kicker text-[12.5px]">unplaced items are skipped</span>
          <button id="add-item" class="linkish ml-auto text-[14px]">+ add an item</button>
        </div>
        ${policy ? `<div class="tray-sub kicker text-[12px]">${policy}</div>` : ''}
        <div class="tray-grid tier-items ${trayItems.length ? '' : 'empty'}" data-zone="1" data-tray="1" style="background:transparent">${trayItems.map(tileHtml).join('')
          || '<span class="kicker text-[13.5px] block py-2">Every item is placed or skipped.</span>'}</div>
        <div class="rk-foot">
          <div class="min-w-0">
            <div class="serif text-[20px] leading-tight">Done when you are.</div>
            <button data-nav="/t/${t.id}/results" class="linkish text-[14px]">Just peek at the results</button>
            ${canSubmit && trayItems.length ? `<div class="text-[12px]" style="color:var(--ink-soft)">${trayItems.length} still in the tray. They'll be skipped when you lock it in.</div>` : ''}
            ${!canSubmit ? '<div class="text-[12px]" style="color:var(--ink-soft)">Rank at least one item to submit.</div>' : ''}
          </div>
          <button id="submit-btn" class="circle" ${canSubmit ? '' : 'disabled'}>${submitted ? 'Save<br>changes' : 'Lock it<br>in'}</button>
        </div>
      </section>
    </main>`);

    bindRank();
  }

  function placeSelected(v) {
    const id = rankState.sel;
    if (!id) return;
    if (v === 'tray') delete rankState.placements[id];
    else if (v === 'skip') rankState.placements[id] = null;
    else rankState.placements[id] = parseInt(v, 10);
    rankState.sel = null;
    drawRank();
    scheduleSave();
  }

  function bindRank() {
    const { data } = rankState;
    const t = data.template;

    document.querySelectorAll('.itile[data-item]').forEach(attachChip);

    document.querySelectorAll('[data-place]').forEach((btn) => btn.addEventListener('click', () => placeSelected(btn.getAttribute('data-place'))));
    document.querySelectorAll('[data-place-tier]').forEach((btn) => btn.addEventListener('click', () => {
      if (rankState.sel) placeSelected(btn.getAttribute('data-place-tier'));
    }));
    // Tap-to-place: with an item picked, tapping anywhere on a tier row's
    // drop area (not on another item) places it there.
    document.querySelectorAll('[data-zone][data-tier]').forEach((zone) => zone.addEventListener('click', (e) => {
      if (!rankState.sel || e.target.closest('.itile')) return;
      placeSelected(zone.dataset.tier);
    }));

    const grab = document.getElementById('tray-grab');
    if (grab) grab.addEventListener('click', () => { rankState.trayCollapsed = !rankState.trayCollapsed; drawRank(); });

    const submit = document.getElementById('submit-btn');
    if (submit) submit.addEventListener('click', async () => {
      submit.disabled = true;
      try {
        // Mirror the server's auto-skip: unplaced active items become explicit skips.
        for (const it of data.items) {
          if (it.status === 'active' && !(it.id in rankState.placements)) rankState.placements[it.id] = null;
        }
        await saveRanking(true);
        // Replace the editor in history so back from results lands on home,
        // not on the ranking screen the user just finished.
        transition(() => nav('/t/' + t.id + '/results', true), 'push');
      } catch (err) {
        toast(err.message);
        submit.disabled = false;
      }
    });

    const add = document.getElementById('add-item');
    if (add) add.addEventListener('click', () => addItemFlow(t));

    const rep = document.getElementById('report-t');
    if (rep) rep.addEventListener('click', () => reportFlow('template', t.id));

    document.querySelectorAll('[data-decide]').forEach((btn) => btn.addEventListener('click', async () => {
      const [itemId, ok] = btn.getAttribute('data-decide').split(':');
      try {
        await api(`/api/templates/${t.id}/items/${itemId}/decide`, { method: 'POST', body: { approve: ok === '1' } });
        toast(ok === '1' ? 'Item approved' : 'Proposal rejected');
        renderRank(t.id);
      } catch (err) { toast(err.message); }
    }));
  }

  function attachChip(chip) {
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      if (chip.dataset.justDragged) { delete chip.dataset.justDragged; return; }
      rankState.sel = rankState.sel === chip.dataset.item ? null : chip.dataset.item;
      drawRank();
      const p = document.getElementById('placer');
      if (p) p.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
    });

    chip.addEventListener('pointerdown', (e) => {
      if (e.button && e.button !== 0) return;
      const id = chip.dataset.item;
      const sx = e.clientX, sy = e.clientY;
      let started = false, ghost = null, lastTarget = null;

      const onMove = (ev) => {
        if (!started) {
          if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 7) return;
          if (window.unNative && unNative.gestures) {
            const seq = ev.pointerType === 'touch' ? 'touch' : ev.pointerId;
            if (unNative.gestures.claim(seq, 'tier-drag') === false) { cleanup(); return; }
          }
          started = true;
          ghost = chip.cloneNode(true);
          ghost.classList.add('itile-ghost');
          ghost.classList.remove('selected');
          document.body.appendChild(ghost);
          chip.classList.add('dragging');
        }
        ghost.style.left = ev.clientX + 'px';
        ghost.style.top = ev.clientY + 'px';
        const under = document.elementFromPoint(ev.clientX, ev.clientY);
        const target = under && under.closest('[data-zone]');
        if (lastTarget && lastTarget !== target) lastTarget.classList.remove('drop-target');
        if (target) target.classList.add('drop-target');
        lastTarget = target;
        ev.preventDefault();
      };

      const onUp = (ev) => {
        if (started) {
          const under = document.elementFromPoint(ev.clientX, ev.clientY);
          const zone = under && under.closest('[data-zone]');
          if (zone) {
            if (zone.dataset.tier) rankState.placements[id] = parseInt(zone.dataset.tier, 10);
            else if (zone.dataset.tray) delete rankState.placements[id];
            else if (zone.dataset.skipshelf) rankState.placements[id] = null;
          }
          chip.dataset.justDragged = '1';
          rankState.sel = null;
          drawRank();
          scheduleSave();
        }
        cleanup();
      };

      const cleanup = () => {
        chip.removeEventListener('pointermove', onMove);
        chip.removeEventListener('pointerup', onUp);
        chip.removeEventListener('pointercancel', cleanup);
        if (ghost) ghost.remove();
        chip.classList.remove('dragging');
        if (lastTarget) lastTarget.classList.remove('drop-target');
      };

      try { chip.setPointerCapture(e.pointerId); } catch {}
      chip.addEventListener('pointermove', onMove);
      chip.addEventListener('pointerup', onUp);
      chip.addEventListener('pointercancel', cleanup);
    });
  }

  function placementsPayload() {
    return Object.entries(rankState.placements).map(([item_id, tier]) => ({ item_id, tier }));
  }

  async function saveRanking(submit) {
    const r = await api(`/api/templates/${rankState.id}/ranking${submit ? '?submit=1' : ''}`, {
      method: 'PUT',
      body: { placements: placementsPayload() },
    });
    if (rankState.data) rankState.data.my.status = r.status;
    return r;
  }

  function scheduleSave() {
    clearTimeout(rankState.saveTimer);
    rankState.saveNote = '';
    rankState.saveTimer = setTimeout(async () => {
      try {
        await saveRanking(false);
        rankState.saveNote = '· Saved ✓';
        const note = document.getElementById('save-note');
        if (note) note.textContent = '· Saved ✓';
      } catch (err) {
        toast('Autosave failed: ' + err.message);
      }
    }, 700);
  }

  async function addItemFlow(t) {
    const name = await askText({ title: 'Add an item', placeholder: 'Item name', confirmLabel: 'Add' });
    if (!name) return;
    try {
      const r = await api(`/api/templates/${t.id}/items`, { method: 'POST', body: { name } });
      if (r.duplicate) {
        toast(`Already on the list as “${r.item.name}”`);
        return;
      }
      toast(r.item.status === 'active' ? 'Item added' : 'Added to your ranking — proposal sent to the author');
      const cur = { ...rankState.placements };
      await renderRank(t.id);
      rankState.placements = { ...cur };
      drawRank();
    } catch (err) { toast(err.message); }
  }

  async function reportFlow(type, id) {
    const reason = await askText({ title: 'Report', placeholder: 'Why? (optional)', confirmLabel: 'Report' });
    if (reason === null) return;
    try {
      const r = await api('/api/report', { method: 'POST', body: { content_type: type, content_id: id, reason } });
      toast(r.hidden ? 'Reported — hidden pending review' : 'Reported — thank you');
    } catch (err) { toast(err.message); }
  }

  // ---------- Results / reveal / peek ----------

  const resultsUi = { view: 'crowd' };

  async function renderResults(id, scrollToComments) {
    loading('…');
    const [data, agg] = await Promise.all([
      api('/api/templates/' + id),
      api('/api/templates/' + id + '/aggregate'),
    ]);
    const t = data.template;
    if (t.hidden) { nav('/t/' + id, true); return; }
    const labels = t.tier_labels;
    const byId = {};
    for (const it of data.items) byId[it.id] = it;
    await Promise.race([prewarm(data.items, t.category, 42), new Promise((r) => setTimeout(r, 800))]);

    // Submitted-ness and having an alignment score are separate states now:
    // leave-one-out scoring returns nothing until someone ELSE has ranked, so a
    // first ranker is submitted-but-unscored (issue #14).
    const mineSubmitted = data.my.status === 'submitted';
    const stats = mineSubmitted && agg.my ? agg.my.stats : null;
    const myP = agg.my && agg.my.placements ? agg.my.placements : null;
    if (!myP && resultsUi.view !== 'crowd') resultsUi.view = 'crowd';
    const verdictWord = data.daily && data.daily.is_final ? 'final verdict' : 'live verdict';

    let revealHtml = '';
    if (stats) {
      const hot = stats.hottest;
      const hotItem = hot && byId[hot.item_id];
      const hotCard = hotItem && hot.distance > 0 ? `<div class="hot mt-5">
          <span class="tile" style="background:${I.tintFor(hotItem.id)}">${illoHtml(hotItem, 62, t.category)}</span>
          <span class="flex-1 min-w-0">
            <span class="kicker text-[14px] block">Your hottest take</span>
            <span class="cond text-[18px] block truncate">${esc(hotItem.name)}</span>
            <span class="flex gap-1.5 mt-1 items-center text-[13px]">You ${tierLetterChip(labels, hot.mine)} <span style="color:var(--ink-soft)">·</span> Crowd ${tierLetterChip(labels, hot.community)}</span>
          </span>
          <span class="rbadge">TOP ${hot.percentile}% CONTRARIAN!</span>
        </div>` : hotItem ? `<div class="hot mt-5">
          <span class="tile" style="background:${I.tintFor(hotItem.id)}">${illoHtml(hotItem, 62, t.category)}</span>
          <span class="flex-1 min-w-0 text-[14px]">
            <span class="kicker text-[14px] block">Most divided</span>
            <span class="cond text-[18px] block truncate">${esc(hotItem.name)}</span>
            You say ${tierLetterChip(labels, hot.mine)} and the others are split around you, so only ${Math.round(hot.credit * 100)}% of them agree.
          </span>
        </div>` : `<div class="hot mt-5"><span class="flex-1 text-[14px]"><span class="kicker text-[14px] block">No hot takes</span>
          You agree with the crowd on everything. Suspicious.</span></div>`;
      revealHtml = `<div class="text-center mt-1">
          <div class="kicker text-[15px]">${esc(t.title)} · ${verdictWord}</div>
          <div class="serif" style="font-size:84px;line-height:1">${stats.alignment}%</div>
          <div class="cond text-[21px]">Aligned with the crowd</div>
          <div class="kicker text-[14px] mt-1">vs ${stats.others_n} other ranker${stats.others_n === 1 ? '' : 's'} · ${stats.compared} item${stats.compared === 1 ? '' : 's'} compared</div>
        </div>
        <div class="stats3 mt-5" aria-label="${esc(breakdownLine(stats))}">
          <div><div class="n">${stats.exact}</div><div class="k">Exact</div></div>
          <div><div class="n">${stats.near || 0}</div><div class="k">One tier off</div></div>
          <div><div class="n" style="color:var(--accent)">${stats.clashes || 0}</div><div class="k">Clashes</div></div>
        </div>
        ${hotCard}`;
    } else if (mineSubmitted) {
      revealHtml = `<div class="text-center mt-1">
          <div class="kicker text-[15px]">${esc(t.title)} · ${verdictWord}</div>
          <div class="serif" style="font-size:84px;line-height:1">—</div>
        </div>
        <div class="card p-4 mt-3 text-[14px]" style="background:var(--peek-bg)">
          <div class="serif text-[21px] mb-1">You're the first ranker</div>
          Your ranking is in, but there's nobody to be aligned <i>with</i> yet. Your alignment % and
          hottest take unlock as soon as someone else ranks this list.
        </div>`;
    } else {
      revealHtml = `<div class="text-center mt-1"><div class="kicker text-[15px]">${esc(t.title)} · ${verdictWord}</div>
          <h1 class="cond text-[26px] leading-tight">${esc(t.title)}</h1></div>
        <div class="card p-4 mt-3 flex items-center gap-3 text-[14px]" style="background:var(--peek-bg)">
          <span class="flex-1"><b>You're peeking.</b> The crowd's grid is below. Your own verdict (alignment %, hottest take) unlocks when you rank.</span>
          <button data-nav="/t/${id}" class="circle md" style="font-size:14px">Rank it yourself</button>
        </div>`;
    }

    const contested = agg.most_contested && byId[agg.most_contested];
    const contestedHtml = contested ? `<button data-dist="${contested.id}" class="act-line un-pressable mt-2">
      Most contested: <span class="dim">${esc(contested.name)}, spread across ${agg.items[agg.most_contested].dist.filter((c) => c > 0).length} tiers</span></button>` : '';

    const itemBtn = (it, extra) => `<button class="fig gitem" data-dist="${it.id}" aria-label="${esc(it.name)}: show the vote spread">
        ${illoHtml(it, 42, t.category, `transform:rotate(${I.rotFor(it.id)}deg)`)}<span class="cap">${esc(it.name)}${extra || ''}</span>
        ${agg.most_contested === it.id ? '<span class="flag" style="background:var(--tint-danger-bg);color:var(--tint-danger-fg)">split</span>'
          : it.is_new ? '<span class="flag" style="background:var(--ink);color:var(--paper)">NEW</span>'
          : agg.comment_counts[it.id] ? `<span class="flag" style="background:var(--tint-neutral-bg);color:var(--tint-neutral-fg)" aria-label="${agg.comment_counts[it.id]} comments">${agg.comment_counts[it.id]} ¶</span>` : ''}
      </button>`;

    const median = (it) => agg.items[it.id] ? agg.items[it.id].median : null;
    function gridHtml(view) {
      const differs = (it) => myP && myP[it.id] != null && median(it) != null && myP[it.id] !== median(it);
      if (view === 'diff' && !data.items.some(differs)) {
        return '<div class="act-line dim kicker">You and the crowd agree on everything you placed.</div>';
      }
      return labels.map((label, i) => {
        const tier = i + 1;
        let list;
        if (view === 'mine') list = data.items.filter((it) => myP && myP[it.id] === tier);
        else if (view === 'diff') list = data.items.filter((it) => median(it) === tier && differs(it));
        else list = data.items.filter((it) => median(it) === tier).sort((a, b) => agg.items[b.id].placed - agg.items[a.id].placed);
        return `<div class="tier-row mb-2">
          <div class="tblock ${String(label).length > 2 ? 'small' : ''}" style="background:${tierColor(i)}">${esc(label)}</div>
          <div class="tier-items ${list.length ? '' : 'empty'}">${list.map((it) => itemBtn(it, view === 'diff' ? ` · you ${esc(labels[myP[it.id] - 1] || '')}` : '')).join('')
            || '<span class="kicker text-[13px]" style="color:var(--ink-faint)">—</span>'}</div>
        </div>`;
      }).join('');
    }

    const noData = data.items.filter((it) => !agg.items[it.id] || agg.items[it.id].median == null);
    const noDataHtml = noData.length ? `<div class="kicker text-[13px] mt-2">
      Not enough data yet: ${noData.map((it) => esc(it.name)).join(' · ')}</div>` : '';

    const groupBtns = (await getHome()).groups.map((g) =>
      `<button data-groupcmp="${g.id}" class="pill" style="background:var(--card);color:var(--ink)">${esc(g.name)} vs the world</button>`).join('');

    const hasHotTake = !!(stats && stats.hottest && stats.hottest.distance > 0);
    const views = [['crowd', `Crowd<sup class="cnt">(${agg.n})</sup>`], ...(myP ? [['mine', 'Mine'], ['diff', 'Difference']] : [])];

    screen(`<main class="max-w-xl mx-auto px-4 pb-10 un-safe-top un-safe-bottom">
      ${topbar('<button data-nav="/">Close</button>', mineSubmitted ? '<button id="share-open">Share</button>' : '')}
      ${revealHtml}
      ${contestedHtml}
      <div class="tabs mt-6" role="tablist" aria-label="Grid">${views.map(([k, l]) =>
        `<button role="tab" data-view="${k}" aria-selected="${resultsUi.view === k}">${l}</button>`).join('')}</div>
      <div class="kicker text-[13px]">median tier per item · ${agg.n} rankings · tap an item for its spread</div>
      <div id="grid" class="mt-3">${gridHtml(resultsUi.view)}</div>
      ${noDataHtml}
      ${mineSubmitted ? `<div class="flex gap-2 mt-6">
        <button id="share-grid" class="pill flex-1">Share my grid</button>
        <button id="share-take" class="pill accent flex-1" ${hasHotTake ? '' : 'disabled'}>Share my take</button>
      </div>
      ${hasHotTake ? '' : `<div class="kicker text-[13px] mt-1 text-center">${stats ? 'No hot takes to share. You agree with the crowd.' : 'Nobody else has ranked this yet, so there is no take to compare.'}</div>`}` : ''}
      <div class="text-center mt-1"><button data-nav="/t/${id}" class="linkish text-[16px]">${mineSubmitted ? 'Edit my ranking' : 'Rank this list'}</button></div>
      <section id="comments-section" class="mt-4">
        <h2 class="sec-h">Comments<sup class="cnt">(<span id="c-count">${agg.total_comments}</span>)</sup></h2>
        <div class="card p-3 mb-2">
          <label for="c-anchor" class="kicker text-[13px] block mb-1">About</label>
          <select id="c-anchor" class="mb-2">
            <option value="">Whole list</option>
            ${data.items.map((it) => `<option value="${it.id}">re: ${esc(it.name)}</option>`).join('')}
          </select>
          <textarea id="c-body" rows="2" placeholder="Say it. Politely-ish." aria-label="Comment"></textarea>
          <button id="c-post" class="pill mt-2">Post</button>
        </div>
        <div class="card px-3 py-1">
          <div id="c-list" class="text-sm py-2" style="color:var(--ink-soft)">Loading…</div>
        </div>
      </section>
      ${agg.rankers.length && mineSubmitted ? `<div class="mt-2">
        <h2 class="sec-h">Head-to-head</h2>
        <div class="flex flex-wrap gap-2">${agg.rankers.slice(0, 10).map((u) =>
          `<button data-nav="/t/${id}/compare/${encodeURIComponent(u)}" class="pill" style="background:var(--card);color:var(--ink)">vs ${esc(u)}</button>`).join('')}</div>
      </div>` : ''}
      ${t.visibility === 'public' && groupBtns ? `<div class="mt-2">
        <h2 class="sec-h">Group vs global</h2>
        <div class="flex flex-wrap gap-2">${groupBtns}</div>
      </div>` : ''}
    </main>`);

    const bindDist = () => document.querySelectorAll('[data-dist]').forEach((chip) => chip.addEventListener('click', () => {
      showDistribution(byId[chip.getAttribute('data-dist')], agg, labels, t.category);
    }));
    bindDist();
    document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
      resultsUi.view = b.dataset.view;
      document.querySelectorAll('[data-view]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      const grid = document.getElementById('grid');
      grid.innerHTML = gridHtml(resultsUi.view);
      hydrateIllos(grid);
      grid.querySelectorAll('[data-dist]').forEach((chip) => chip.addEventListener('click', () =>
        showDistribution(byId[chip.getAttribute('data-dist')], agg, labels, t.category)));
    }));
    setupComments(t, agg.total_comments);
    if (scrollToComments) {
      // route() scrolls to the top right after this render; queue the
      // comments scroll behind it.
      setTimeout(() => {
        const sec = document.getElementById('comments-section');
        if (sec) sec.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth' });
      }, 0);
    }

    const doGrid = () => shareGridCard(t, data, agg, stats);
    const doTake = () => shareTakeCard(t, byId, stats);
    const sg = document.getElementById('share-grid');
    if (sg) sg.addEventListener('click', doGrid);
    const st = document.getElementById('share-take');
    if (st) st.addEventListener('click', doTake);
    const so = document.getElementById('share-open');
    if (so) so.addEventListener('click', () => {
      const { panel, close } = showSheet(`
        <div class="serif text-[22px] mb-3">Share</div>
        <div class="flex flex-col gap-2">
          <button id="sh-grid" class="pill">Share my grid</button>
          <button id="sh-take" class="pill accent" ${hasHotTake ? '' : 'disabled'}>Share my take</button>
        </div>`);
      panel.querySelector('#sh-grid').addEventListener('click', () => { close(); doGrid(); });
      panel.querySelector('#sh-take').addEventListener('click', () => { close(); doTake(); });
    });
    document.querySelectorAll('[data-groupcmp]').forEach((b) => b.addEventListener('click', () =>
      showGroupCompare(t, data.items, agg, b.getAttribute('data-groupcmp'), b.textContent)));
  }

  function showDistribution(item, agg, labels, category) {
    if (!item) return;
    const a = agg.items[item.id];
    const total = a ? a.placed : 0;
    const max = a ? Math.max(...a.dist, 1) : 1;
    const bars = labels.map((l, i) => {
      const c = a ? a.dist[i] : 0;
      return `<div class="flex items-center gap-2 mb-1.5">
        <span class="tchip" style="background:${tierColor(i)};min-width:34px;text-align:center">${esc(l)}</span>
        <div class="dist-bar" style="background:${tierColor(i)};width:${Math.round((c / max) * 70)}%"></div>
        <span class="text-[13px] font-semibold">${c}</span>
      </div>`;
    }).join('');
    const { panel, close } = showSheet(`
      <div class="flex items-center gap-3 mb-2">
        ${illoHtml(item, 56, category)}
        <div class="min-w-0">
          <div class="cond text-[20px] leading-tight">${esc(item.name)}</div>
          <div class="kicker text-[13px]">
            ${a && a.median ? `crowd tier: ${esc(labels[a.median - 1])}` : 'not enough data yet'} ·
            ${total} placement${total === 1 ? '' : 's'} · ${a ? a.skip_pct : 0}% skipped
            ${item.is_new ? ' · new, low data' : ''}
          </div>
        </div>
      </div>
      ${bars}
      <button id="dist-comment" class="linkish text-[15px]">Comment on ${esc(item.name)}</button>
    `);
    hydrateIllos(panel);
    const dc = document.getElementById('dist-comment');
    if (dc) dc.addEventListener('click', () => {
      close();
      const sel = document.getElementById('c-anchor');
      if (sel) sel.value = item.id;
      const sec = document.getElementById('comments-section');
      if (sec) sec.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth' });
      const box = document.getElementById('c-body');
      if (box) box.focus({ preventScroll: true });
    });
  }

  async function showGroupCompare(t, items, globalAgg, groupId, label) {
    try {
      const g = await api(`/api/templates/${t.id}/aggregate?group=${groupId}`);
      const labels = t.tier_labels;
      const diffs = items
        .filter((it) => g.items[it.id] && g.items[it.id].median != null && globalAgg.items[it.id] && globalAgg.items[it.id].median != null)
        .map((it) => ({ it, gm: g.items[it.id].median, wm: globalAgg.items[it.id].median }))
        .sort((a, b) => Math.abs(b.gm - b.wm) - Math.abs(a.gm - a.wm));
      const top = diffs[0];
      showSheet(`
        <div class="font-display font-black text-lg mb-1">${esc(label || 'Group')} </div>
        <div class="text-[12.5px] mb-3" style="color:var(--ink-soft)">group medians (${g.n} member rankings) vs the global grid (${globalAgg.n})</div>
        ${top && Math.abs(top.gm - top.wm) > 0 ? `<div class="card p-3 mb-3 text-sm"><b>Biggest divergence</b> — ${esc(top.it.name)}: group says ${tierLetterChip(labels, top.gm)}, the world says ${tierLetterChip(labels, top.wm)}</div>` : '<div class="text-sm mb-3">Your group agrees with the world. Boring but harmonious.</div>'}
        ${diffs.map((d) => `<div class="flex items-center gap-2 text-[13.5px] py-1" style="border-bottom:1px solid var(--paper-deep)">
          <span class="flex-1 truncate">${esc(d.it.name)}</span>
          ${tierLetterChip(labels, d.gm)} <span class="text-[11px]" style="color:var(--ink-soft)">vs</span> ${tierLetterChip(labels, d.wm)}
        </div>`).join('')}
      `);
    } catch (err) { toast(err.message); }
  }

  // ---------- Comments (inline on the results screen) ----------

  let commentStream = null;
  function closeCommentStream() {
    if (commentStream) { commentStream.close(); commentStream = null; }
  }

  const COMMENTS_SHOWN = 30;

  function setupComments(t, initialTotal) {
    const listEl = document.getElementById('c-list');
    if (!listEl) return;
    let comments = [];   // newest-first, mirrors the API ordering
    let total = initialTotal || 0;
    let expanded = false;
    let loaded = false;

    const setCount = () => {
      const el = document.getElementById('c-count');
      if (el) el.textContent = total;
    };

    function renderList() {
      if (!loaded) return;
      if (!comments.length) { listEl.innerHTML = 'No comments yet — start the argument.'; return; }
      const shown = expanded ? comments : comments.slice(0, COMMENTS_SHOWN);
      const hiddenCount = comments.length - shown.length;
      listEl.innerHTML = shown.map((c, i) => `
        <div class="py-2" style="${i < shown.length - 1 ? 'border-bottom:1px solid var(--paper-deep)' : ''}">
          <div class="text-[12px]" style="color:var(--ink-soft)"><b style="color:var(--ink)">${esc(c.username)}</b>
            ${c.item_name ? ` · re: <b>${esc(c.item_name)}</b>` : ''}</div>
          <div class="text-[14px] mt-0.5" style="color:var(--ink)">${esc(c.body)}</div>
          <div class="flex gap-1.5 mt-1 items-center">
            ${['👍', '🔥', '😂', '❤️'].map((e) => {
              const r = (c.reactions || []).find((x) => x.emoji === e);
              return `<button data-react="${c.id}:${e}" class="text-[12px] px-1.5 py-0.5 rounded-full border ${r && r.mine ? 'font-bold' : ''}" style="border-color:${r && r.mine ? 'var(--accent)' : 'var(--line)'}">${e}${r ? ' ' + r.count : ''}</button>`;
            }).join('')}
            <button data-creport="${c.id}" class="ml-auto text-[11px]" style="color:var(--ink-soft)">report</button>
          </div>
        </div>`).join('')
        + (hiddenCount > 0 ? `<button id="c-more" class="mt-2 text-[13px] font-bold" style="color:var(--accent)">show earlier comments (${hiddenCount})</button>` : '');
      const more = listEl.querySelector('#c-more');
      if (more) more.addEventListener('click', () => { expanded = true; renderList(); });
      listEl.querySelectorAll('[data-react]').forEach((b) => b.addEventListener('click', async () => {
        const [cid, emoji] = b.getAttribute('data-react').split(':');
        try { await api(`/api/comments/${cid}/react`, { method: 'POST', body: { emoji } }); refresh(); } catch (err) { toast(err.message); }
      }));
      listEl.querySelectorAll('[data-creport]').forEach((b) => b.addEventListener('click', () =>
        reportFlow('comment', b.getAttribute('data-creport'))));
    }

    async function refresh() {
      try {
        const fetched = (await api(`/api/templates/${t.id}/comments`)).comments;
        // Keep anything that streamed in while the fetch was in flight.
        const have = new Set(fetched.map((c) => c.id));
        comments = comments.filter((c) => !have.has(c.id)).concat(fetched);
        loaded = true;
        renderList();
      } catch (err) {
        listEl.textContent = err.message;
      }
    }

    function addComment(c) {
      if (!c || comments.some((x) => x.id === c.id)) return;
      comments.unshift(c);
      total += 1;
      loaded = true;
      setCount();
      renderList();
    }

    refresh();

    document.getElementById('c-post').addEventListener('click', async () => {
      const box = document.getElementById('c-body');
      const body = box.value.trim();
      if (!body) return;
      const btn = document.getElementById('c-post');
      btn.disabled = true;
      try {
        const r = await api(`/api/templates/${t.id}/comments`, {
          method: 'POST',
          body: { body, item_id: document.getElementById('c-anchor').value || null },
        });
        box.value = '';
        addComment(r.comment);
      } catch (err) { toast(err.message); }
      btn.disabled = false;
    });

    // Live updates: server streams comments posted by anyone on this
    // template; id-dedupe absorbs the echo of our own posts.
    closeCommentStream();
    try {
      commentStream = new EventSource(urlWithToken(`/api/templates/${t.id}/comments/stream`));
      commentStream.addEventListener('comment', (e) => {
        try { addComment(JSON.parse(e.data)); } catch { /* malformed frame */ }
      });
    } catch { /* EventSource unavailable — list still works via refresh */ }
  }

  // ---------- Compare ----------

  async function renderCompare(id, username) {
    loading('Head-to-head');
    let cmp;
    try {
      cmp = await api(`/api/templates/${id}/compare/${encodeURIComponent(username)}`);
    } catch (err) {
      if (err.code === 'not_ranked') {
        screen(`${header('Head-to-head', { back: `/t/${id}/results` })}
          <main class="max-w-xl mx-auto p-4"><div class="card p-6 text-center">
          <div class="text-3xl mb-2">🤝</div><div class="font-semibold">${esc(err.message)}</div>
          <button data-nav="/t/${id}" class="btn-primary mt-3">Rank it</button></div></main>`);
        return;
      }
      throw err;
    }
    const labels = cmp.tier_labels;
    const clashRows = cmp.items.filter((r) => r.distance >= cmp.clash_threshold);
    const notCompared = [];
    if (cmp.only_mine.length) notCompared.push(`${cmp.only_mine.length} only you placed`);
    if (cmp.only_theirs.length) notCompared.push(`${cmp.only_theirs.length} only ${esc(cmp.username)} placed`);
    if (cmp.unavailable.length) notCompared.push(`${cmp.unavailable.length} no longer in this list`);

    screen(`${header('You vs ' + esc(cmp.username), { back: `/t/${id}/results` })}
    <main class="max-w-xl mx-auto p-4 un-safe-bottom">
      <div class="text-[13px] mb-2" style="color:var(--ink-soft)">“${esc(cmp.title)}”</div>
      <div class="card p-4 text-center mb-2">
        <div class="font-display font-black text-4xl">${cmp.alignment == null ? '—' : cmp.alignment + '%'} aligned</div>
        <div class="text-[13px] mt-1" style="color:var(--ink-soft)">${cmp.shared} item${cmp.shared === 1 ? '' : 's'} you both placed</div>
        ${cmp.shared ? `<div class="text-[12.5px] mt-1 font-bold">${breakdownLine(cmp)}</div>` : ''}
        ${cmp.coverage_thin ? `<div class="text-[12px] mt-1" style="color:var(--tint-danger-fg)">thin overlap — only ${cmp.shared} item${cmp.shared === 1 ? '' : 's'} in common</div>` : ''}
      </div>
      ${clashRows.length ? `<div class="card p-3 mb-3 text-sm">
        <div class="text-[11px] font-bold uppercase tracking-widest mb-1" style="color:var(--ink-soft)">Clashes · ${cmp.clash_threshold}+ tiers apart</div>
        ${clashRows.map((r) => `<div class="flex items-center gap-2 py-1">
          <span class="flex-1 truncate">${esc(r.name)}</span>
          ${tierLetterChip(labels, r.mine)} <span class="text-[11px]" style="color:var(--ink-soft)">vs</span> ${tierLetterChip(labels, r.theirs)}
        </div>`).join('')}
      </div>` : cmp.shared && cmp.exact === cmp.shared
        ? '<div class="card p-3 mb-3 text-sm">You two agree on everything. Get more opinions.</div>'
        : cmp.shared ? `<div class="card p-3 mb-3 text-sm">No clashes — you're never more than ${cmp.clash_threshold === 1 ? 'the same tier' : (cmp.clash_threshold - 1) + ' tier' + (cmp.clash_threshold === 2 ? '' : 's')} apart.</div>` : ''}
      <div class="grid grid-cols-[1fr_auto_auto] gap-x-3 text-[13.5px]">
        <div></div><div class="text-[11px] font-bold pb-1" style="color:var(--ink-soft)">YOU</div><div class="text-[11px] font-bold pb-1" style="color:var(--ink-soft)">${esc(cmp.username.toUpperCase())}</div>
        ${cmp.items.map((r) => `
          <div class="py-1 truncate" style="border-bottom:1px solid var(--paper-deep)">${esc(r.name)}</div>
          <div class="py-1" style="border-bottom:1px solid var(--paper-deep)">${tierLetterChip(labels, r.mine)}</div>
          <div class="py-1" style="border-bottom:1px solid var(--paper-deep)">${tierLetterChip(labels, r.theirs)}</div>`).join('')}
      </div>
      ${notCompared.length ? `<div class="text-[12.5px] mt-3" style="color:var(--ink-soft)">
        <b>Not compared</b> — ${notCompared.join(' · ')}. These don't affect the percentage.
      </div>` : ''}
    </main>`);
  }

  // ---------- Create (AI-assisted) ----------

  const newState = { items: [], labels: ['S', 'A', 'B', 'C', 'D'], meter: null };

  async function renderNew() {
    const h = await getHome().catch(() => null);
    const groupPre = new URLSearchParams(location.search).get('group') || '';
    newState.items = [];
    newState.labels = ['S', 'A', 'B', 'C', 'D'];
    newState.meter = null;

    screen(`${header('New template', { back: '/' })}
    <main class="max-w-xl mx-auto p-4 pb-10 un-safe-bottom">
      <label class="text-[12px] font-bold" style="color:var(--ink-soft)">TITLE</label>
      <input id="n-title" placeholder="Top 25 animes of the 2010s" class="mt-1 mb-3">

      <div class="flex items-center gap-2 mb-1">
        <button id="n-ai" class="btn-primary" style="width:auto;padding:9px 14px">✨ AI: propose the item set</button>
        <span id="n-meter" class="text-[11.5px]" style="color:var(--ink-soft)">${h && h.llm_enabled === false ? 'AI unavailable here — add items manually' : ''}</span>
      </div>

      <div class="card p-3 mt-2">
        <div class="text-[12px] font-bold mb-2" style="color:var(--ink-soft)">ITEMS (<span id="n-count">0</span>) — editable before publish</div>
        <div id="n-items" class="flex flex-wrap gap-1.5 mb-2"></div>
        <div class="flex gap-2">
          <input id="n-add" placeholder="Add an item…">
          <button id="n-add-btn" class="btn-primary" style="width:auto;padding:9px 16px">Add</button>
        </div>
      </div>

      <div class="card p-3 mt-3">
        <div class="text-[12px] font-bold mb-2" style="color:var(--ink-soft)">TIER SCALE (3–6 tiers) — Tier scale labels are display-only</div>
        <div id="n-tiers" class="flex flex-wrap gap-1.5 items-center"></div>
      </div>

      <div class="card p-3 mt-3">
        <div class="text-[12px] font-bold mb-1" style="color:var(--ink-soft)">WHO CAN ADD ITEMS LATER?</div>
        <select id="n-policy">
          <option value="open">Anyone (AI dedupes)</option>
          <option value="approved">With my approval</option>
          <option value="closed">Nobody — closed set</option>
        </select>
        <div class="text-[12px] font-bold mt-3 mb-1" style="color:var(--ink-soft)">VISIBILITY</div>
        <select id="n-vis">
          <option value="">Public feed</option>
          ${(h ? h.groups : []).map((g) => `<option value="${g.id}" ${groupPre === g.id ? 'selected' : ''}>Group: ${esc(g.name)}</option>`).join('')}
        </select>
      </div>

      <button id="n-publish" class="btn-primary mt-4">PUBLISH</button>
    </main>`);

    drawNewItems();
    drawNewTiers();

    document.getElementById('n-add-btn').addEventListener('click', addManual);
    document.getElementById('n-add').addEventListener('keydown', (e) => { if (e.key === 'Enter') addManual(); });
    document.getElementById('n-ai').addEventListener('click', aiPropose);
    document.getElementById('n-publish').addEventListener('click', publish);

    function addManual() {
      const inp = document.getElementById('n-add');
      const name = inp.value.trim();
      if (!name) return;
      const norm = name.toLowerCase().replace(/[^a-z0-9]+/g, '');
      if (newState.items.some((i) => i.name.toLowerCase().replace(/[^a-z0-9]+/g, '') === norm)) {
        toast('Already on the list'); return;
      }
      newState.items.push({ name, emoji: null });
      inp.value = '';
      drawNewItems();
    }

    async function aiPropose() {
      const title = document.getElementById('n-title').value.trim();
      if (!title) { toast('Give the template a title first'); return; }
      const btn = document.getElementById('n-ai');
      btn.disabled = true;
      btn.textContent = '✨ Thinking…';
      try {
        const r = await aiCall(() => api('/api/ai/items', { method: 'POST', body: { title } }));
        if (r) {
          newState.items = r.items;
          drawNewItems();
          if (r.spent_cents != null && r.cap_cents != null) {
            document.getElementById('n-meter').textContent =
              `AI used $${(r.spent_cents / 100).toFixed(2)} of $${(r.cap_cents / 100).toFixed(2)} today`;
          }
        }
      } finally {
        btn.disabled = false;
        btn.textContent = '✨ AI: propose the item set';
      }
    }

    async function publish() {
      const title = document.getElementById('n-title').value.trim();
      const vis = document.getElementById('n-vis').value;
      const btn = document.getElementById('n-publish');
      btn.disabled = true;
      try {
        const r = await api('/api/templates', {
          method: 'POST',
          body: {
            title,
            items: newState.items,
            tier_labels: newState.labels,
            item_policy: document.getElementById('n-policy').value,
            visibility: vis ? 'group' : 'public',
            group_id: vis || null,
          },
        });
        homeCache = null;
        toast('Published!');
        transition(() => nav('/t/' + r.id), 'push');
      } catch (err) {
        toast(err.message);
        btn.disabled = false;
      }
    }
  }

  function drawNewItems() {
    const el = document.getElementById('n-items');
    if (!el) return;
    el.innerHTML = newState.items.map((it, i) => `
      <span class="chip" style="cursor:default;touch-action:auto">${it.emoji ? esc(it.emoji) + ' ' : ''}${esc(it.name)}
        <button data-rm="${i}" class="ml-1 font-black" style="color:var(--danger-fg)">×</button></span>`).join('')
      || '<span class="text-[13px]" style="color:var(--ink-soft)">No items yet — use AI or add manually.</span>';
    document.getElementById('n-count').textContent = newState.items.length;
    el.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => {
      newState.items.splice(parseInt(b.getAttribute('data-rm'), 10), 1);
      drawNewItems();
    }));
  }

  function drawNewTiers() {
    const el = document.getElementById('n-tiers');
    if (!el) return;
    el.innerHTML = newState.labels.map((l, i) => `
      <input data-tl="${i}" value="${esc(l)}" maxlength="12"
        style="width:64px;text-align:center;font-weight:700;color:${TIER_INK};background:${tierColor(i)};border:none">`).join('')
      + `<button id="tl-minus" class="un-touch-target font-black text-lg px-2" ${newState.labels.length <= 3 ? 'disabled' : ''}>−</button>
         <button id="tl-plus" class="un-touch-target font-black text-lg px-2" ${newState.labels.length >= 6 ? 'disabled' : ''}>＋</button>`;
    el.querySelectorAll('[data-tl]').forEach((inp) => inp.addEventListener('input', () => {
      newState.labels[parseInt(inp.getAttribute('data-tl'), 10)] = inp.value;
    }));
    document.getElementById('tl-minus').addEventListener('click', () => {
      if (newState.labels.length > 3) { newState.labels.pop(); drawNewTiers(); }
    });
    document.getElementById('tl-plus').addEventListener('click', () => {
      if (newState.labels.length < 6) { newState.labels.push('F'); drawNewTiers(); }
    });
  }

  // Shared AI-call wrapper: consent flow + budget errors, per platform conventions.
  async function aiCall(fn) {
    try {
      return await fn();
    } catch (err) {
      if (err.code === 'grant_required' && window.usernode && usernode.requestLlmAccess) {
        try {
          const g = await usernode.requestLlmAccess();
          if (g && g.granted) return await fn();
          toast('AI access declined — add items manually');
          return null;
        } catch { /* no shell */ }
      }
      if (err.code === 'llm_unavailable') toast('AI unavailable in this environment — add items manually');
      else if (err.code === 'app_cap_exceeded') toast('Daily AI cap for this app reached — resets at midnight UTC');
      else if (err.code === 'budget_exceeded') toast('Your daily AI budget is spent — resets at midnight UTC');
      else toast(err.message);
      return null;
    }
  }

  // ---------- Groups ----------

  async function renderJoin(code) {
    loading('Joining…');
    try {
      const g = await api('/api/groups/join/' + encodeURIComponent(code), { method: 'POST' });
      homeCache = null;
      toast('Welcome to ' + g.name);
      nav('/g/' + g.id, true);
    } catch (err) { renderError(err); }
  }

  async function renderGroup(id) {
    loading('Group');
    const d = await api('/api/groups/' + id);
    const inviteUrl = location.origin + '/g/join/' + d.group.invite_code;
    screen(`${header(esc(d.group.name), { back: '/' })}
    <main class="max-w-xl mx-auto p-4 pb-10 un-safe-bottom">
      <div class="text-[13px] mb-3" style="color:var(--ink-soft)">${d.members.length} member${d.members.length === 1 ? '' : 's'}: ${d.members.map(esc).join(', ')}</div>
      ${d.templates.map((t) => `<div class="card p-3 mb-2">
        <button data-nav="${templateDest(t.id, t.mine_in ? 'submitted' : null)}" class="w-full text-left un-pressable flex items-center gap-2">
          <span class="flex-1 min-w-0 block">
            <span class="block font-bold text-[15px]">${esc(t.title)}</span>
            <span class="block text-[12.5px]" style="color:var(--ink-soft)">${t.n} of ${d.members.length} ranked${t.mine_in ? ' · your ranking is in ✓' : ' · <b style="color:var(--tint-accent-fg)">rank it</b>'}</span>
          </span>${CHEV}
        </button>
        ${t.biggest_split ? `<div class="text-[12.5px] mt-1 pt-1" style="border-top:1px solid var(--paper-deep);color:var(--ink-soft)">
          biggest split: <b style="color:var(--ink)">${esc(t.biggest_split.item)}</b>
          (${esc(t.biggest_split.top_user)}: ${tierLetterChip(t.tier_labels, t.biggest_split.top_tier)},
           ${esc(t.biggest_split.bottom_user)}: ${tierLetterChip(t.tier_labels, t.biggest_split.bottom_tier)})</div>` : ''}
        ${t.n > 0 ? `<button data-verdict="${t.id}" class="text-[12px] font-bold mt-1" style="color:var(--accent)">📤 share our verdict</button>` : ''}
      </div>`).join('') || '<div class="card p-4 text-sm" style="color:var(--ink-soft)">No group lists yet.</div>'}
      <button data-nav="/new?group=${d.group.id}" class="btn-primary mt-2">NEW GROUP LIST (AI-assisted)</button>
      <div class="card p-3 mt-3">
        <div class="text-[12px] font-bold mb-1" style="color:var(--ink-soft)">INVITE LINK</div>
        <div class="text-[12.5px] break-all mb-2">${esc(inviteUrl)}</div>
        <button id="copy-invite" class="text-[13px] font-bold" style="color:var(--accent)">Copy link</button>
      </div>
    </main>`);
    document.getElementById('copy-invite').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(inviteUrl); toast('Invite link copied'); }
      catch { toast('Copy failed — long-press the link instead'); }
    });
    document.querySelectorAll('[data-verdict]').forEach((b) => b.addEventListener('click', async () => {
      const tid = b.getAttribute('data-verdict');
      try {
        const [td, agg] = await Promise.all([
          api('/api/templates/' + tid),
          api(`/api/templates/${tid}/aggregate?group=${d.group.id}`),
        ]);
        const labels = td.template.tier_labels;
        const topItems = td.items.filter((it) => agg.items[it.id] && agg.items[it.id].median === 1);
        const top = topItems.map((it) => it.name);
        const canvas = await drawVerdictPoster({
          kicker: 'our verdict',
          title: `${d.group.name}'s verdict`,
          subtitle: td.template.title,
          items: topItems,
          category: td.template.category,
          line: top.length ? `${labels[0]}-tier: ${top.join(', ')}` : 'No S-tier consensus yet. Keep arguing.',
          foot: `${agg.n} member rankings`,
          link: shareLink(tid),
        });
        await shareCanvas(canvas, `${d.group.name}'s ${labels[0]}-tier for "${td.template.title}"`, location.origin + '/t/' + tid);
      } catch (err) { toast(err.message); }
    }));
  }

  // ---------- Profile ----------

  // ---------- Appearance (theme) control ----------
  // The runtime lives inline in index.html (it has to run before first paint);
  // this is only the Profile UI for it. The `dark` class sits on <html>, so it
  // survives every screen() re-render — nothing else here needs theme code.

  const THEME_MODES = [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']];

  function themeHint() {
    const t = window.ctlTheme;
    if (!t) return '';
    const mode = t.get();
    if (mode === 'light') return 'Always light.';
    if (mode === 'dark') return 'Always dark.';
    return `Following your device — ${t.resolved()} right now.`;
  }

  function themeSectionHtml() {
    const mode = window.ctlTheme ? window.ctlTheme.get() : 'system';
    return `<div class="text-[11px] font-bold uppercase tracking-widest mb-1" style="color:var(--ink-soft)">Appearance</div>
      <div class="card p-3 mb-4">
        <div class="seg" role="radiogroup" aria-label="Appearance">
          ${THEME_MODES.map(([v, label]) => `<button class="seg-btn un-pressable" data-theme-mode="${v}" role="radio" aria-checked="${mode === v ? 'true' : 'false'}">${label}</button>`).join('')}
        </div>
        <div id="theme-hint" class="text-[12px] mt-2" style="color:var(--ink-soft)">${esc(themeHint())}</div>
      </div>`;
  }

  // Repaint in place (no /api/me round-trip); a no-op when Profile isn't mounted.
  function paintThemeSeg() {
    const t = window.ctlTheme;
    if (!t) return;
    const mode = t.get();
    document.querySelectorAll('[data-theme-mode]').forEach((b) =>
      b.setAttribute('aria-checked', b.getAttribute('data-theme-mode') === mode ? 'true' : 'false'));
    const hint = document.getElementById('theme-hint');
    if (hint) hint.textContent = themeHint();
  }

  function bindThemeSeg() {
    const t = window.ctlTheme;
    if (!t) return;
    document.querySelectorAll('[data-theme-mode]').forEach((b) => b.addEventListener('click', () => {
      const mode = b.getAttribute('data-theme-mode');
      t.set(mode);
      paintThemeSeg();
      const label = (THEME_MODES.find((m) => m[0] === mode) || [, mode])[1];
      toast('Appearance: ' + label);
    }));
  }

  async function renderMe() {
    loading('Profile');
    const m = await api('/api/me');
    screen(`${header('Profile', { back: '/' })}
    <main class="max-w-xl mx-auto p-4 pb-10 un-safe-bottom">
      <div class="font-display font-black text-2xl mb-3">${esc(m.username)}</div>
      <div class="grid grid-cols-3 gap-2 mb-3">
        <div class="card p-3 text-center"><div class="font-display font-black text-2xl">🔥 ${m.streak}</div><div class="text-[11px]" style="color:var(--ink-soft)">Today's List streak</div></div>
        <div class="card p-3 text-center"><div class="font-display font-black text-2xl">${m.ranked_count}</div><div class="text-[11px]" style="color:var(--ink-soft)">lists ranked</div></div>
        <div class="card p-3 text-center"><div class="font-display font-black text-2xl">${m.avg_alignment == null ? '—' : m.avg_alignment + '%'}</div><div class="text-[11px]" style="color:var(--ink-soft)">avg alignment</div></div>
      </div>
      ${m.hottest && m.hottest.item_name ? `<div class="card p-3 mb-3 text-sm">
        <b>Your hottest take</b> — ${esc(m.hottest.item_name)} in ${tierLetterChip(m.hottest.tier_labels, m.hottest.mine)}
        (community: ${tierLetterChip(m.hottest.tier_labels, m.hottest.community)}) on “${esc(m.hottest.template_title)}”
      </div>` : ''}
      ${themeSectionHtml()}
      <div class="text-[11px] font-bold uppercase tracking-widest mb-1" style="color:var(--ink-soft)">My templates</div>
      ${m.my_templates.map((t) => `<button data-nav="/t/${t.id}/results" class="card card-tap w-full text-left px-3 py-2 mb-1 text-sm un-pressable flex items-center gap-2">
        <span class="flex-1 min-w-0"><b>${esc(t.title)}</b> — ${t.n} ranking${t.n === 1 ? '' : 's'}${t.visibility === 'group' ? ' · group' : ''}${t.hidden ? ' · <b style="color:var(--danger-fg)">hidden</b>' : ''}</span>${CHEV}
      </button>`).join('') || '<div class="card px-3 py-3 text-sm mb-1" style="color:var(--ink-soft)">None yet — make one, it takes a minute.</div>'}
      <button data-nav="/new" class="btn-primary mt-2 mb-4">CREATE A TEMPLATE</button>
      <div class="text-[11px] font-bold uppercase tracking-widest mb-1" style="color:var(--ink-soft)">This week Tier Lists changed because you voted</div>
      ${m.shipped.map((c) => `<div class="card px-3 py-2 mb-1 text-[13px]"><b>${esc(c.title)}</b>${c.body ? `<div style="color:var(--ink-soft)">${esc(c.body)}</div>` : ''}</div>`).join('') || '<div class="text-[13px]" style="color:var(--ink-soft)">Nothing shipped yet.</div>'}
      ${m.is_moderator ? `<button data-nav="/mod" class="card card-tap w-full text-left px-3 py-3 mt-3 text-[13px] font-bold un-pressable flex items-center gap-2"><span class="flex-1 min-w-0">🛡️ Moderation queue</span>${CHEV}</button>` : ''}
    </main>`);
    bindThemeSeg();
  }

  // ---------- Moderation ----------

  async function renderMod() {
    loading('Moderation');
    let d;
    try {
      d = await api('/api/mod/queue');
    } catch (err) {
      if (err.code === 'not_moderator') {
        screen(`${header('Moderation', { back: '/' })}<main class="max-w-xl mx-auto p-4">
          <div class="card p-6 text-center"><div class="text-3xl mb-2">🛡️</div>
          <div class="font-semibold mb-1">Moderators only</div>
          <div class="text-[13px]" style="color:var(--ink-soft)">Moderators are set via the MODERATOR_USERNAMES app secret (Settings → Secrets).</div></div></main>`);
        return;
      }
      throw err;
    }
    screen(`${header('Moderation', { back: '/' })}
    <main class="max-w-xl mx-auto p-4 pb-10 un-safe-bottom">
      <div class="text-[12.5px] mb-3" style="color:var(--ink-soft)">${d.stats.reports_24h} reports in 24h · ${d.stats.total_rankings} total rankings · auto-hide at 3 distinct reporters</div>
      <div class="text-[11px] font-bold uppercase tracking-widest mb-1" style="color:var(--ink-soft)">Report queue (${d.queue.length})</div>
      ${d.queue.map((q) => `<div class="card p-3 mb-2 text-sm">
        <div><span class="badge" style="background:var(--tint-neutral-bg);color:var(--tint-neutral-fg)">${q.content_type}</span> ${q.hidden ? '<span class="badge" style="background:var(--tint-danger-bg);color:var(--tint-danger-fg)">hidden</span>' : ''}
          <b>${esc(q.preview || '(deleted)')}</b></div>
        <div class="text-[12px] mt-1" style="color:var(--ink-soft)">${q.report_count} report${q.report_count === 1 ? '' : 's'} · ${q.reporters.map(esc).join(', ')}${q.reasons.length ? ' · “' + esc(q.reasons[0]) + '”' : ''}</div>
        <div class="flex gap-2 mt-2">
          ${q.template_id ? `<button data-nav="/t/${q.template_id}/results" class="text-[12px] font-bold" style="color:var(--accent)">view</button>` : ''}
          <button data-mod="${q.content_type}:${q.content_id}:restore" class="text-[12px] font-bold" style="color:var(--ok-fg)">restore</button>
          <button data-mod="${q.content_type}:${q.content_id}:remove" class="text-[12px] font-bold" style="color:var(--danger-fg)">keep hidden</button>
          <button data-mod="${q.content_type}:${q.content_id}:dismiss" class="text-[12px] font-bold" style="color:var(--ink-soft)">dismiss</button>
        </div>
      </div>`).join('') || '<div class="card p-3 text-sm mb-2" style="color:var(--ink-soft)">Queue is empty. 🎉</div>'}
      <div class="text-[11px] font-bold uppercase tracking-widest mb-1 mt-4" style="color:var(--ink-soft)">Integrity flags (${d.flags.length})</div>
      ${d.flags.map((f) => `<div class="card p-3 mb-2 text-sm">
        <b>${esc(f.kind)}</b> on “${esc(f.title || f.template_id || '?')}” · ${esc(JSON.stringify(f.detail || {}))}
        <button data-flag="${f.id}" class="ml-2 text-[12px] font-bold" style="color:var(--ok-fg)">resolve</button>
      </div>`).join('') || '<div class="card p-3 text-sm" style="color:var(--ink-soft)">No open flags.</div>'}
      <div class="card p-3 mt-4">
        <div class="text-[12px] font-bold mb-2" style="color:var(--ink-soft)">POST A WHAT'S-CHANGING / CHANGELOG ENTRY</div>
        <select id="cl-kind" class="mb-2"><option value="merging">merging (what's-changing strip)</option><option value="proposed">proposed</option><option value="shipped">shipped (changelog)</option></select>
        <input id="cl-title" placeholder="Custom tier colors — merging in 9h" class="mb-2">
        <button id="cl-post" class="btn-primary" style="padding:9px">Post</button>
      </div>
    </main>`);
    document.querySelectorAll('[data-mod]').forEach((b) => b.addEventListener('click', async () => {
      const [content_type, content_id, action] = b.getAttribute('data-mod').split(':');
      try { await api('/api/mod/resolve', { method: 'POST', body: { content_type, content_id, action } }); toast('Done'); renderMod(); }
      catch (err) { toast(err.message); }
    }));
    document.querySelectorAll('[data-flag]').forEach((b) => b.addEventListener('click', async () => {
      try { await api(`/api/mod/flags/${b.getAttribute('data-flag')}/resolve`, { method: 'POST' }); toast('Resolved'); renderMod(); }
      catch (err) { toast(err.message); }
    }));
    document.getElementById('cl-post').addEventListener('click', async () => {
      const title = document.getElementById('cl-title').value.trim();
      if (!title) return;
      try {
        await api('/api/mod/changelog', { method: 'POST', body: { kind: document.getElementById('cl-kind').value, title } });
        toast('Posted');
        homeCache = null;
        document.getElementById('cl-title').value = '';
      } catch (err) { toast(err.message); }
    });
  }

  // ---------- Share images (client-side canvas posters) ----------
  // Deliberately theme-INDEPENDENT: these are images posted outside the app,
  // so they always render on paper regardless of the sender's theme.
  // Don't "helpfully" swap these literals for theme tokens. Items are drawn
  // from the same cached illustration bitmaps the screens use.

  const SHARE = { paper: '#F1EDE4', card: '#FAF9F6', ink: '#1E1B18', soft: '#625D55', accent: '#9C4A30', onAccent: '#FAF9F6' };
  const F_SERIF = "'Instrument Serif', Georgia, serif";
  const F_COND = "'Archivo Narrow', 'Arial Narrow', Georgia, sans-serif";
  const F_SANS = 'Archivo, system-ui, sans-serif';

  // Never block sharing on fonts: whatever loads in ~1.5s is used, the rest
  // falls back to Georgia/system.
  async function shareFonts() {
    if (!document.fonts || !document.fonts.load) return;
    const want = [`italic 40px ${F_SERIF}`, `40px ${F_SERIF}`, `500 40px ${F_COND}`, `600 20px ${F_SANS}`];
    await Promise.race([Promise.all(want.map((f) => document.fonts.load(f).catch(() => null))), new Promise((r) => setTimeout(r, 1500))]);
  }

  function loadImage(src, cors) {
    return new Promise((resolve) => {
      if (!src) { resolve(null); return; }
      const img = new Image();
      if (cors) img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  async function itemImage(it, category, size) {
    if (it.image_url) {
      const photo = await loadImage(it.image_url, true);
      if (photo) return { img: photo, photo: true };
    }
    return { img: await loadImage(await I.load(I.keyFor(it, category), size, 'light')), photo: false };
  }

  function canvasBase(w, h, bg) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.fillStyle = bg || SHARE.paper;
    x.fillRect(0, 0, w, h);
    return { c, x };
  }

  function rrect(x, left, top, w, h, r) {
    x.beginPath();
    x.moveTo(left + r, top);
    x.arcTo(left + w, top, left + w, top + h, r);
    x.arcTo(left + w, top + h, left, top + h, r);
    x.arcTo(left, top + h, left, top, r);
    x.arcTo(left, top, left + w, top, r);
    x.closePath();
  }

  function ellipsize(x, text, maxW) {
    if (x.measureText(text).width <= maxW) return text;
    while (text.length > 1 && x.measureText(text + '…').width > maxW) text = text.slice(0, -1);
    return text + '…';
  }

  // Largest condensed headline size (down to `min`) that fits, then ellipsize.
  function fitText(x, text, weightFamily, maxPx, minPx, maxW) {
    let px = maxPx;
    x.font = `${weightFamily.replace('{px}', px)}`;
    while (px > minPx && x.measureText(text).width > maxW) { px -= 4; x.font = weightFamily.replace('{px}', px); }
    return ellipsize(x, text, maxW);
  }

  function drawItem(x, entry, cx, top, size, rot, caption, capPx) {
    if (entry && entry.img) {
      x.save();
      x.translate(cx, top + size / 2);
      x.rotate(rot * Math.PI / 180);
      if (entry.photo) {
        rrect(x, -size / 2, -size / 2, size, size, size * 0.12);
        x.clip();
      }
      x.drawImage(entry.img, -size / 2, -size / 2, size, size);
      x.restore();
    }
    if (caption) {
      x.fillStyle = SHARE.soft;
      x.font = `italic ${capPx}px ${F_SERIF}`;
      x.textAlign = 'center';
      x.fillText(ellipsize(x, caption, size + 26), cx, top + size + capPx * 0.95);
      x.textAlign = 'left';
    }
  }

  function footer(x, w, h, link) {
    x.fillStyle = SHARE.ink;
    x.font = `46px ${F_SERIF}`;
    x.fillText('Tier Lists', 60, h - 52);
    x.fillStyle = SHARE.soft;
    x.font = `italic 28px ${F_SERIF}`;
    x.textAlign = 'right';
    x.fillText(ellipsize(x, link, w / 2), w - 60, h - 54);
    x.textAlign = 'left';
  }

  function circleBadge(x, cx, cy, r, text, sub) {
    x.fillStyle = SHARE.accent;
    x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
    x.fillStyle = SHARE.onAccent;
    x.textAlign = 'center';
    x.font = `${sub ? 54 : 60}px ${F_SERIF}`;
    x.fillText(text, cx, cy + (sub ? 8 : 20));
    if (sub) { x.font = `italic 24px ${F_SERIF}`; x.fillText(sub, cx, cy + 40); }
    x.textAlign = 'left';
  }

  // 1080×1350 poster of a full grid.
  async function drawGridPoster({ kicker, title, labels, items, placementOf, category, badge, badgeSub, link }) {
    await shareFonts();
    const W = 1080, H = 1350;
    const { c, x } = canvasBase(W, H);
    x.fillStyle = SHARE.soft;
    x.textAlign = 'center';
    x.font = `italic 46px ${F_SERIF}`;
    x.fillText(kicker, W / 2, 98);
    x.fillStyle = SHARE.ink;
    const t = fitText(x, title.toUpperCase(), `500 {px}px ${F_COND}`, 92, 56, 640);
    x.fillText(t, W / 2, 196);
    x.textAlign = 'left';
    if (badge) circleBadge(x, W - 132, 150, 82, badge, badgeSub);

    const k = labels.length;
    const top = 268, bottom = 1208, gap = 16;
    const rowH = (bottom - top - gap * (k - 1)) / k;
    const rows = labels.map((_, i) => items.filter((it) => placementOf(it) === i + 1));
    const imgs = new Map();
    await Promise.all(rows.flat().map(async (it) => imgs.set(it.id, await itemImage(it, category, 240))));
    const left = 60, blockW = 128, rowL = left + blockW + 16, rowR = W - 60;
    rows.forEach((list, i) => {
      const y = top + i * (rowH + gap);
      x.fillStyle = tierColor(i);
      rrect(x, left, y, blockW, rowH, 26); x.fill();
      x.fillStyle = TIER_INK;
      x.textAlign = 'center';
      const lab = String(labels[i]);
      x.font = `${lab.length > 2 ? 40 : Math.min(84, rowH * 0.55)}px ${F_SERIF}`;
      x.fillText(ellipsize(x, lab, blockW - 16), left + blockW / 2, y + rowH / 2 + (lab.length > 2 ? 14 : Math.min(84, rowH * 0.55) * 0.34));
      x.textAlign = 'left';
      x.fillStyle = SHARE.card;
      rrect(x, rowL, y, rowR - rowL, rowH, 26); x.fill();
      if (!list.length) {
        x.fillStyle = '#B9B4AC';
        x.font = `italic 30px ${F_SERIF}`;
        x.fillText('—', rowL + 30, y + rowH / 2 + 10);
        return;
      }
      const capPx = rowH > 150 ? 24 : 20;
      const avail = rowR - rowL - 32;
      let size = Math.min(rowH - capPx - 34, 132);
      let slot = size + 26;
      let shown = list;
      if (list.length * slot > avail) {
        size = Math.max(56, Math.floor(avail / list.length) - 26);
        slot = size + 26;
        const fit = Math.floor(avail / slot);
        if (fit < list.length) shown = list.slice(0, fit - 1);
      }
      const blockH = size + capPx + 6;
      const y0 = y + (rowH - blockH) / 2;
      shown.forEach((it, j) => drawItem(x, imgs.get(it.id), rowL + 16 + slot * j + slot / 2, y0, size, I.rotFor(it.id), it.name, capPx));
      if (shown.length < list.length) {
        x.fillStyle = SHARE.soft;
        x.font = `italic 34px ${F_SERIF}`;
        x.fillText(`+${list.length - shown.length}`, rowL + 16 + slot * shown.length + 10, y + rowH / 2 + 12);
      }
    });
    footer(x, W, H, link);
    return c;
  }

  const article = (label) => {
    const l = String(label).trim();
    if (/^[AEFHILMNORSX]$/i.test(l)) return 'AN';
    return /^[aeiou]/i.test(l) ? 'AN' : 'A';
  };

  // 1080×1080 hot-take poster.
  async function drawTakePoster({ item, category, title, mine, crowd, mineIdx, crowdIdx, percentile, link }) {
    await shareFonts();
    const W = 1080, H = 1080;
    const { c, x } = canvasBase(W, H, I.tintFor(item.id));
    x.fillStyle = SHARE.soft;
    x.textAlign = 'center';
    x.font = `italic 50px ${F_SERIF}`;
    x.fillText('my hottest take', W / 2, 104);
    x.textAlign = 'left';

    // paper tile with the item drawn large
    const entry = await itemImage(item, category, 360);
    x.save();
    x.translate(370, 455);
    x.rotate(-3 * Math.PI / 180);
    x.fillStyle = '#FAF6EE';
    x.shadowColor = 'rgba(30,27,24,.12)'; x.shadowBlur = 30; x.shadowOffsetY = 10;
    rrect(x, -270, -270, 540, 540, 40); x.fill();
    x.restore();
    drawItem(x, entry, 370, 455 - 225, 450, -3, null);

    // me / everyone else tier tiles
    const tile = (label, idx, who, y) => {
      x.fillStyle = SHARE.soft;
      x.font = `italic 34px ${F_SERIF}`;
      x.textAlign = 'right';
      x.fillText(who, 820, y + 104);
      x.textAlign = 'center';
      x.fillStyle = tierColor(idx);
      rrect(x, 850, y, 170, 170, 34); x.fill();
      x.fillStyle = TIER_INK;
      const l = String(label);
      x.font = `${l.length > 2 ? 52 : 124}px ${F_SERIF}`;
      x.fillText(ellipsize(x, l, 150), 935, y + (l.length > 2 ? 104 : 128));
      x.textAlign = 'left';
    };
    tile(mine, mineIdx, 'me', 200);
    tile(crowd, crowdIdx, 'everyone else', 420);

    // black rotated badge
    if (percentile != null) {
      const txt = `TOP ${percentile}% CONTRARIAN!`;
      x.save();
      x.translate(860, 680);
      x.rotate(6 * Math.PI / 180);
      x.font = `600 30px ${F_SANS}`;
      const bw = x.measureText(txt).width + 48;
      x.fillStyle = '#1E1B18';
      rrect(x, -bw / 2, -34, bw, 68, 22); x.fill();
      x.fillStyle = '#FAF9F6';
      x.textAlign = 'center';
      x.fillText(txt, 0, 11);
      x.restore();
    }

    x.fillStyle = SHARE.ink;
    x.textAlign = 'center';
    const head = `${item.name.toUpperCase()} IS ${article(mine)} ${String(mine).toUpperCase()}.`;
    x.fillText(fitText(x, head, `500 {px}px ${F_COND}`, 100, 56, W - 120), W / 2, 845);
    x.fillStyle = SHARE.soft;
    x.font = `italic 36px ${F_SERIF}`;
    x.fillText(ellipsize(x, `on “${title}”`, W - 160), W / 2, 905);
    x.textAlign = 'left';
    footer(x, W, H, link);
    return c;
  }

  // Group space "share our verdict": same paper poster, S-tier items drawn.
  async function drawVerdictPoster({ kicker, title, subtitle, items, category, line, foot, link }) {
    await shareFonts();
    const W = 1080, H = 1350;
    const { c, x } = canvasBase(W, H);
    x.textAlign = 'center';
    x.fillStyle = SHARE.soft;
    x.font = `italic 46px ${F_SERIF}`;
    x.fillText(kicker, W / 2, 110);
    x.fillStyle = SHARE.ink;
    x.fillText(fitText(x, title.toUpperCase(), `500 {px}px ${F_COND}`, 92, 56, W - 140), W / 2, 214);
    x.fillStyle = SHARE.soft;
    x.font = `40px ${F_SERIF}`;
    x.fillText(ellipsize(x, subtitle, W - 160), W / 2, 280);
    x.textAlign = 'left';
    x.fillStyle = SHARE.card;
    rrect(x, 60, 340, W - 120, 700, 40); x.fill();
    const shown = items.slice(0, 6);
    const imgs = await Promise.all(shown.map((it) => itemImage(it, category, 240)));
    if (shown.length) {
      const cols = Math.min(3, shown.length), rowsN = Math.ceil(shown.length / cols);
      const size = rowsN > 1 ? 210 : 260;
      shown.forEach((it, i) => {
        const col = i % cols, row = Math.floor(i / cols);
        const cx = 60 + (W - 120) * (col + 0.5) / cols;
        const top = 340 + (700 - rowsN * (size + 50)) / 2 + row * (size + 50);
        drawItem(x, imgs[i], cx, top, size, I.rotFor(it.id), it.name, 28);
      });
    }
    x.fillStyle = SHARE.ink;
    x.textAlign = 'center';
    x.font = `44px ${F_SERIF}`;
    x.fillText(ellipsize(x, line, W - 140), W / 2, 1120);
    x.fillStyle = SHARE.soft;
    x.font = `italic 32px ${F_SERIF}`;
    x.fillText(foot, W / 2, 1172);
    x.textAlign = 'left';
    footer(x, W, H, link);
    return c;
  }

  async function shareCanvas(canvas, text, url) {
    const blob = await new Promise((r) => { try { canvas.toBlob(r, 'image/png'); } catch { r(null); } });
    if (!blob) { toast('Could not render the card'); return; }
    const file = new File([blob], 'tier-list.png', { type: 'image/png' });
    const shareText = text + (url ? ' — ' + url : '');
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], text: shareText }); return; } catch { /* cancelled */ }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'tier-list.png';
    a.click();
    try { await navigator.clipboard.writeText(shareText); toast('Card downloaded · link copied'); }
    catch { toast('Card downloaded'); }
  }

  const shareLink = (id) => location.host + '/t/' + id;

  async function shareGridCard(t, data, agg, stats) {
    toast('Drawing your grid…');
    try {
      const canvas = await drawGridPoster({
        kicker: data.daily ? `my tier list · No. ${data.daily.edition_no}` : 'my tier list',
        title: t.title,
        labels: t.tier_labels,
        items: data.items,
        placementOf: (it) => agg.my && agg.my.placements ? agg.my.placements[it.id] : null,
        category: t.category,
        badge: stats ? `${stats.alignment}%` : String(agg.n),
        badgeSub: stats ? null : 'ranked',
        link: 'rank yours → ' + shareLink(t.id),
      });
      await shareCanvas(canvas, `My tier list for "${t.title}"`, location.origin + '/t/' + t.id);
    } catch (err) { toast('Could not render the card'); console.warn(err); }
  }

  async function shareTakeCard(t, byId, stats) {
    if (!stats || !stats.hottest) return;
    const item = byId[stats.hottest.item_id];
    if (!item) return;
    const labels = t.tier_labels;
    const tier = labels[stats.hottest.mine - 1];
    toast('Drawing your take…');
    try {
      const canvas = await drawTakePoster({
        item, category: t.category, title: t.title,
        mine: tier, crowd: labels[stats.hottest.community - 1],
        mineIdx: stats.hottest.mine - 1, crowdIdx: stats.hottest.community - 1,
        percentile: stats.hottest.percentile,
        link: 'rank yours → ' + shareLink(t.id),
      });
      await shareCanvas(canvas, `I put ${item.name} in ${tier} tier. Fight me.`, location.origin + '/t/' + t.id);
    } catch (err) { toast('Could not render the card'); console.warn(err); }
  }

  // ---------- Illustration sheet (/illustrations, unlinked) ----------
  // Every registry drawing + fallback at 32/96/240px, for style review.

  async function renderIllustrations() {
    const keys = I.keys();
    screen(`<main class="max-w-xl mx-auto px-4 pb-10 un-safe-top un-safe-bottom">
      ${topbar('<button data-nav="/">Close</button>', '')}
      <h1 class="cond text-[26px]">Illustration sheet</h1>
      <div class="kicker text-[14px] mb-4">${keys.length} drawings · category fallbacks: ${I.FALLBACK_KEYS.join(', ')}</div>
      <div class="grid grid-cols-2 gap-3" data-illo-sheet>
        ${keys.map((k) => `<div class="card p-2 text-center" style="background:#FAF6EE;color:#1E1B18">
          ${illoHtml({ id: k, canonical_key: k, name: k }, 240, null, 'width:100%;height:auto;aspect-ratio:1')}
          <div class="flex items-end justify-center gap-2">${illoHtml({ id: k, canonical_key: k }, 96)}${illoHtml({ id: k, canonical_key: k }, 32)}</div>
          <div class="serif ital text-[14px]">${esc(k)}${I.FALLBACK_KEYS.includes(k) ? ' · fallback' : ''}</div>
        </div>`).join('')}
      </div>
    </main>`);
  }

  // ---------- boot ----------

  // One subscription for the app's lifetime: keeps the Profile control's
  // "(dark right now)" hint honest when the OS flips mid-session.
  if (window.ctlTheme) window.ctlTheme.onChange(paintThemeSeg);

  route();
})();
