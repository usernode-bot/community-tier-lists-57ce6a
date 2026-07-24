(() => {
  'use strict';

  // ---------- plumbing ----------

  const params = new URLSearchParams(location.search);
  if (params.get('token')) sessionStorage.setItem('ctl_token', params.get('token'));
  const TOKEN = params.get('token') || sessionStorage.getItem('ctl_token') || '';

  // Fixed warm→cool ramp by tier position; letters always accompany color.
  const RAMP = ['#E4573D', '#E5A83B', '#7FB542', '#3F97E8', '#8A6FDF', '#6B7A99'];
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
    t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1F2B47;color:#FAF6EE;padding:9px 18px;border-radius:99px;font-size:13.5px;font-weight:600;z-index:99;max-width:88vw';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2400);
  }

  function showSheet(html) {
    const back = document.createElement('div');
    back.className = 'sheet-backdrop';
    const panel = document.createElement('div');
    panel.className = 'sheet-panel';
    panel.innerHTML = html;
    const close = () => { back.remove(); panel.remove(); };
    back.addEventListener('click', close);
    document.body.appendChild(back);
    document.body.appendChild(panel);
    return { panel, close };
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
      `<button data-nav="${esc(opts.back || '/')}" class="un-touch-target text-xl font-bold px-1" style="color:#3F97E8" aria-label="Back">←</button>`;
    return `<header class="sticky top-0 z-20 un-safe-top" style="background:rgba(250,246,238,.94);backdrop-filter:blur(8px);border-bottom:2px solid var(--ink)">
      <div class="max-w-xl mx-auto flex items-center gap-2 px-3 h-12">
        ${back}
        <div class="font-display font-black text-[17px] truncate">${title}</div>
        <div class="ml-auto flex items-center gap-1">${opts.actions || ''}</div>
      </div>
    </header>`;
  }

  function screen(html) {
    $app.innerHTML = html;
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

  const tierLetterChip = (labels, tier) => tier == null ? '<span class="badge" style="background:#eee;color:#888">skip</span>'
    : `<span class="badge" style="background:${tierColor(tier - 1)};color:#fff">${esc(labels[tier - 1] || tier)}</span>`;

  // ---------- Home ----------

  async function renderHome() {
    loading('Tier Lists');
    const h = await getHome(true);
    const stagingPill = h.env === 'staging'
      ? '<span class="badge" style="background:#E5A83B33;color:#8a6415;border:1px solid #E5A83B66">staging</span>' : '';
    const modBtn = h.me.is_moderator
      ? '<button data-nav="/mod" class="un-touch-target text-lg" aria-label="Moderation">🛡️</button>' : '';

    let hero = '';
    if (h.today) {
      const cta = h.today.my_status === 'submitted' ? 'See the results'
        : h.today.my_status === 'draft' ? 'Resume ranking' : 'Rank it';
      const dest = h.today.my_status === 'submitted' ? `/t/${h.today.template_id}/results` : `/t/${h.today.template_id}`;
      hero = `<section class="card p-4 mb-4" style="background:linear-gradient(135deg,#fff, #f4eefe);border-color:#d9c8f5">
        <div class="text-[11px] font-bold uppercase tracking-widest" style="color:var(--accent)">Today's List · No. ${h.today.edition_no}</div>
        <div class="font-display font-black text-2xl mt-1">${esc(h.today.title)}</div>
        <div class="text-sm mt-1" style="color:var(--ink-soft)">${h.today.n} ranked so far${h.today.my_status === 'submitted' ? ' · yours is in ✓' : ''}</div>
        <button data-nav="${dest}" class="btn-primary mt-3">${cta}</button>
      </section>`;
    }

    const changing = h.changing.length ? `<section class="mb-4">
      <div class="text-[11px] font-bold uppercase tracking-widest mb-1" style="color:var(--ink-soft)">What's changing</div>
      ${h.changing.map((c) => `<div class="card px-3 py-2 mb-1 text-[13px]"><b>${esc(c.title)}</b>${c.body ? ` — <span style="color:var(--ink-soft)">${esc(c.body)}</span>` : ''}</div>`).join('')}
    </section>` : '';

    const inprog = h.in_progress.length ? `<section class="mb-4">
      <div class="text-[11px] font-bold uppercase tracking-widest mb-1" style="color:var(--ink-soft)">In progress</div>
      ${h.in_progress.map((r) => `<button data-nav="/t/${r.template_id}" class="card w-full text-left px-3 py-2 mb-1 text-sm un-pressable">
        <b>${esc(r.title)}</b> — ${r.placed} of ${r.total} placed · <span style="color:var(--accent)">resume</span></button>`).join('')}
    </section>` : '';

    const groups = `<section class="mb-4">
      <div class="flex items-center mb-1">
        <div class="text-[11px] font-bold uppercase tracking-widest" style="color:var(--ink-soft)">My groups</div>
        <button id="new-group" class="ml-auto text-[12px] font-bold" style="color:var(--accent)">+ new group</button>
      </div>
      ${h.groups.length ? h.groups.map((g) => `<button data-nav="/g/${g.id}" class="card w-full text-left px-3 py-2 mb-1 text-sm un-pressable">
        <b>${esc(g.name)}</b> · ${g.member_count} member${g.member_count === 1 ? '' : 's'}${g.recent ? ` · <span style="color:var(--accent)">${g.recent} new ranking${g.recent === 1 ? '' : 's'}</span>` : ''}</button>`).join('')
      : '<div class="card px-3 py-3 text-sm" style="color:var(--ink-soft)">Run private lists with friends — restaurants, crags, whatever you argue about.</div>'}
    </section>`;

    const feed = `<section class="mb-4">
      <div class="text-[11px] font-bold uppercase tracking-widest mb-1" style="color:var(--ink-soft)">Feed · trending &amp; recent</div>
      ${h.feed.map((t) => `<button data-nav="/t/${t.id}" class="card w-full text-left px-3 py-2 mb-1 un-pressable">
        <div class="text-sm font-bold">${t.recent_n >= 3 ? '🔥 ' : ''}${esc(t.title)}</div>
        <div class="text-[12px]" style="color:var(--ink-soft)">${t.n} ranking${t.n === 1 ? '' : 's'}${t.category ? ' · ' + esc(t.category) : ''} · by ${esc(t.author_username)}</div>
      </button>`).join('') || '<div class="card px-3 py-3 text-sm" style="color:var(--ink-soft)">Nothing here yet — create the first list!</div>'}
      ${h.recent_rankings.map((r) => `<button data-nav="/t/${r.template_id}" class="w-full text-left px-3 py-1.5 text-[12.5px] un-pressable" style="color:var(--ink-soft)">
        <b>${esc(r.username)}</b> ranked “${esc(r.title)}”</button>`).join('')}
    </section>`;

    screen(`${header(`Tier Lists ${stagingPill}`, {
      back: false,
      actions: `${modBtn}<button data-nav="/new" class="un-touch-target text-xl font-black" aria-label="New template" style="color:var(--accent)">＋</button>
        <button data-nav="/me" class="un-touch-target text-lg" aria-label="Profile">👤</button>`,
    })}
    <main class="max-w-xl mx-auto p-4 un-safe-bottom">${hero}${changing}${inprog}${groups}${feed}</main>`);

    const ng = document.getElementById('new-group');
    if (ng) ng.addEventListener('click', async () => {
      const name = prompt('Group name');
      if (!name) return;
      try {
        const g = await api('/api/groups', { method: 'POST', body: { name } });
        toast('Group created');
        nav('/g/' + g.id);
      } catch (err) { toast(err.message); }
    });
  }

  async function renderToday() {
    const h = await getHome();
    if (h.today) nav('/t/' + h.today.template_id, true);
    else { toast("No Today's List today"); nav('/', true); }
  }

  // ---------- Rank screen ----------

  const rankState = { id: null, data: null, placements: null, sel: null, saveTimer: null, saveNote: '' };

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
    drawRank();
  }

  function drawRank() {
    const { data, placements, sel } = rankState;
    const t = data.template;
    const labels = t.tier_labels;
    const items = data.items;
    const byId = {};
    for (const it of items) byId[it.id] = it;

    const chipHtml = (it, extra = '') => `<button class="chip ${sel === it.id ? 'selected' : ''}" data-item="${it.id}" ${extra}>
      ${it.image_url ? `<img src="${esc(it.image_url)}" alt="">` : ''}${it.emoji ? esc(it.emoji) + ' ' : ''}${esc(it.name)}
      ${it.is_new ? '<span class="badge" style="background:#7c3aed22;color:#6a50bd">NEW</span>' : ''}
      ${it.status === 'proposed' ? '<span class="badge" style="background:#E5A83B33;color:#8a6415">only you</span>' : ''}
    </button>`;

    const rows = labels.map((label, i) => {
      const tier = i + 1;
      const inTier = items.filter((it) => placements[it.id] === tier);
      return `<div class="tier-row mb-1.5" data-tier-row="${tier}">
        <div class="tier-label" style="background:${tierColor(i)}">${esc(label)}</div>
        <div class="tier-items" data-tier="${tier}">${inTier.map((it) => chipHtml(it)).join('')}</div>
      </div>`;
    }).join('');

    const trayItems = items.filter((it) => !(it.id in placements));
    const skipped = items.filter((it) => placements[it.id] === null);
    const placedCount = items.length - trayItems.length - skipped.length;
    const done = trayItems.length === 0;
    const submitted = data.my.status === 'submitted';

    const placer = sel && byId[sel] ? `<div class="card p-3 mt-2" id="placer">
      <div class="text-[12px] font-bold mb-2">Place “${esc(byId[sel].name)}”</div>
      <div class="flex flex-wrap gap-2">
        ${labels.map((l, i) => `<button class="tier-label un-pressable" data-place="${i + 1}" style="background:${tierColor(i)};min-height:44px">${esc(l)}</button>`).join('')}
        <button data-place="skip" class="un-pressable px-3 rounded-[10px] border font-bold text-sm" style="border-color:var(--line);min-height:44px">Skip — haven't seen it</button>
        ${(sel in placements) ? '<button data-place="tray" class="un-pressable px-3 rounded-[10px] border font-bold text-sm" style="border-color:var(--line);min-height:44px">↩ Back to tray</button>' : ''}
      </div>
    </div>` : '';

    screen(`${header(esc(t.title), {
      back: '/',
      actions: `<button id="report-t" class="un-touch-target text-[12px] font-bold" style="color:var(--ink-soft)">report</button>`,
    })}
    <main class="max-w-xl mx-auto p-4 pb-10 un-safe-bottom">
      ${data.daily ? `<div class="text-[11px] font-bold uppercase tracking-widest mb-2" style="color:var(--accent)">Today's List · No. ${data.daily.edition_no}${data.daily.is_final ? ' · final' : ''}</div>` : ''}
      <div class="text-[13px] mb-3" style="color:var(--ink-soft)">
        ${submitted ? 'You’ve ranked this — edits update the community aggregate live.' :
          `Aggregate hidden until you rank — ${placedCount} of ${items.length} placed${skipped.length ? `, ${skipped.length} skipped` : ''}.`}
        <span class="font-semibold">${esc(rankState.saveNote)}</span>
      </div>
      <div id="board">${rows}</div>
      ${placer}
      <div class="card p-3 mt-3">
        <div class="text-[12px] font-bold mb-2" style="color:var(--ink-soft)">ITEM TRAY — drag into a tier, or tap to place · skip = “haven't seen it”</div>
        <div class="tier-items" data-tray="1" style="border-style:dashed;min-height:56px">${trayItems.map((it) => chipHtml(it)).join('') || '<span class="text-[12.5px] py-1.5" style="color:var(--ink-soft)">All items placed or skipped 🎉</span>'}</div>
      </div>
      ${skipped.length ? `<div class="card p-3 mt-2">
        <div class="text-[12px] font-bold mb-2" style="color:var(--ink-soft)">SKIPPED (${skipped.length}) — not counted in the aggregate</div>
        <div class="tier-items" data-skipshelf="1">${skipped.map((it) => chipHtml(it)).join('')}</div>
      </div>` : ''}
      <div class="mt-3">
        <button id="add-item" class="text-[13px] font-bold" style="color:var(--accent)">+ add an item${t.item_policy === 'closed' ? ' (stays in your ranking only)' : t.item_policy === 'approved' ? ' (author approves before it’s shared)' : ''}</button>
      </div>
      ${data.proposals && data.proposals.length ? `<div class="card p-3 mt-3">
        <div class="text-[12px] font-bold mb-2">Proposed items (you're the author)</div>
        ${data.proposals.map((p) => `<div class="flex items-center gap-2 text-sm py-1">
          <span class="flex-1">${esc(p.name)} <span style="color:var(--ink-soft)">by ${esc(p.added_by_username || '?')}</span></span>
          <button data-decide="${p.id}:1" class="font-bold text-[12px]" style="color:#4d7325">approve</button>
          <button data-decide="${p.id}:0" class="font-bold text-[12px]" style="color:#b0361f">reject</button>
        </div>`).join('')}
      </div>` : ''}
      <button id="submit-btn" class="btn-primary mt-4" ${done ? '' : 'disabled'}>${submitted ? 'SAVE CHANGES' : 'SUBMIT RANKING'}</button>
      <div class="text-center mt-3">
        <button data-nav="/t/${t.id}/results" class="text-[13.5px] font-semibold" style="color:var(--ink-soft)">just show me the results → <span class="text-[11px]">(peek — ranking stays open)</span></button>
      </div>
    </main>`);

    bindRank();
  }

  function bindRank() {
    const { data } = rankState;
    const t = data.template;

    document.querySelectorAll('.chip[data-item]').forEach(attachChip);

    document.querySelectorAll('[data-place]').forEach((btn) => btn.addEventListener('click', () => {
      const v = btn.getAttribute('data-place');
      const id = rankState.sel;
      if (!id) return;
      if (v === 'tray') delete rankState.placements[id];
      else if (v === 'skip') rankState.placements[id] = null;
      else rankState.placements[id] = parseInt(v, 10);
      rankState.sel = null;
      drawRank();
      scheduleSave();
    }));

    const submit = document.getElementById('submit-btn');
    if (submit) submit.addEventListener('click', async () => {
      submit.disabled = true;
      try {
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
    chip.addEventListener('click', () => {
      if (chip.dataset.justDragged) { delete chip.dataset.justDragged; return; }
      rankState.sel = rankState.sel === chip.dataset.item ? null : chip.dataset.item;
      drawRank();
      const p = document.getElementById('placer');
      if (p) p.scrollIntoView({ block: 'nearest' });
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
          ghost.classList.add('chip-ghost');
          document.body.appendChild(ghost);
          chip.classList.add('dragging');
        }
        ghost.style.left = ev.clientX + 'px';
        ghost.style.top = ev.clientY + 'px';
        const under = document.elementFromPoint(ev.clientX, ev.clientY);
        const target = under && under.closest('.tier-items');
        if (lastTarget && lastTarget !== target) lastTarget.classList.remove('drop-target');
        if (target) target.classList.add('drop-target');
        lastTarget = target;
        ev.preventDefault();
      };

      const onUp = (ev) => {
        if (started) {
          const under = document.elementFromPoint(ev.clientX, ev.clientY);
          const zone = under && under.closest('.tier-items');
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
        rankState.saveNote = 'Saved ✓';
        const note = document.querySelector('main .text-\\[13px\\] .font-semibold');
        if (note) note.textContent = 'Saved ✓';
      } catch (err) {
        toast('Autosave failed: ' + err.message);
      }
    }, 700);
  }

  async function addItemFlow(t) {
    const name = prompt('Item name');
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
    const reason = prompt('Why are you reporting this? (optional)') ;
    if (reason === null) return;
    try {
      const r = await api('/api/report', { method: 'POST', body: { content_type: type, content_id: id, reason } });
      toast(r.hidden ? 'Reported — hidden pending review' : 'Reported — thank you');
    } catch (err) { toast(err.message); }
  }

  // ---------- Results / reveal / peek ----------

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

    const mineSubmitted = data.my.status === 'submitted' && agg.my && agg.my.stats;
    const stats = mineSubmitted ? agg.my.stats : null;

    let revealHtml = '';
    if (stats) {
      const hot = stats.hottest;
      const hotItem = hot && byId[hot.item_id];
      revealHtml = `
        <div class="card p-4 text-center mb-2">
          <div class="font-display font-black text-4xl">${stats.alignment}% aligned</div>
          <div class="text-[13px] mt-1" style="color:var(--ink-soft)">with ${agg.n} ranker${agg.n === 1 ? '' : 's'} · ${stats.ranked} items placed</div>
        </div>
        ${hotItem && hot.distance > 0 ? `<div class="card p-3 mb-2 text-sm">
          <b>Your hottest take</b> — ${esc(hotItem.name)} in ${tierLetterChip(labels, hot.mine)} (community: ${tierLetterChip(labels, hot.community)}) · top ${hot.percentile}% contrarian
        </div>` : agg.n > 1 ? '<div class="card p-3 mb-2 text-sm"><b>No hot takes</b> — you agree with the crowd on everything. Suspicious. 🤨</div>' : ''}`;
    } else {
      revealHtml = `<div class="card p-3 mb-2 text-sm" style="background:#7c3aed10;border-color:#d9c8f5">
        <b>You're peeking.</b> The community grid is below — your own reveal (alignment %, hottest take) unlocks when you rank.
        <button data-nav="/t/${id}" class="btn-primary mt-2">Rank it yourself</button>
      </div>`;
    }

    const contested = agg.most_contested && byId[agg.most_contested];
    const contestedHtml = contested ? `<div class="card p-3 mb-2 text-sm">
      <b>Most contested</b> — ${esc(contested.name)} (spread across ${agg.items[agg.most_contested].dist.filter((c) => c > 0).length} tiers)
    </div>` : '';

    const gridRows = labels.map((label, i) => {
      const tier = i + 1;
      const inTier = data.items
        .filter((it) => agg.items[it.id] && agg.items[it.id].median === tier)
        .sort((a, b) => agg.items[b.id].placed - agg.items[a.id].placed);
      return `<div class="tier-row mb-1.5">
        <div class="tier-label" style="background:${tierColor(i)}">${esc(label)}</div>
        <div class="tier-items" style="cursor:default">${inTier.map((it) => `
          <button class="chip" data-dist="${it.id}" style="touch-action:auto">${it.emoji ? esc(it.emoji) + ' ' : ''}${esc(it.name)}
            ${agg.most_contested === it.id ? '<span class="badge" style="background:#FF6B5722;color:#b0361f">🔥</span>' : ''}
            ${it.is_new ? '<span class="badge" style="background:#7c3aed22;color:#6a50bd">NEW</span>' : ''}
            ${agg.comment_counts[it.id] ? `<span class="badge" style="background:#eee;color:#666">💬${agg.comment_counts[it.id]}</span>` : ''}
          </button>`).join('')}</div>
      </div>`;
    }).join('');

    const noData = data.items.filter((it) => !agg.items[it.id] || agg.items[it.id].median == null);
    const noDataHtml = noData.length ? `<div class="text-[12.5px] mt-2" style="color:var(--ink-soft)">
      Not enough data yet: ${noData.map((it) => esc(it.name)).join(' · ')}</div>` : '';

    const groupBtns = (await getHome()).groups.map((g) =>
      `<button data-groupcmp="${g.id}" class="card px-3 py-2 text-[12.5px] font-bold un-pressable">${esc(g.name)} vs the world</button>`).join('');

    const hasHotTake = !!(stats && stats.hottest && stats.hottest.distance > 0);

    screen(`${header(esc(t.title), { back: '/' })}
    <main class="max-w-xl mx-auto p-4 pb-10 un-safe-bottom">
      ${data.daily ? `<div class="text-[11px] font-bold uppercase tracking-widest mb-2" style="color:var(--accent)">Today's List · No. ${data.daily.edition_no}${data.daily.is_final ? ' · final verdict' : ' · live'}</div>` : ''}
      ${revealHtml}
      ${contestedHtml}
      <div class="flex items-baseline gap-2 mt-4 mb-2">
        <div class="text-[11px] font-bold uppercase tracking-widest" style="color:var(--ink-soft)">Community grid</div>
        <div class="text-[12px]" style="color:var(--ink-soft)">median tier per item · ${agg.n} rankings · tap an item for its distribution</div>
      </div>
      ${gridRows}
      ${noDataHtml}
      ${mineSubmitted ? `<div class="grid grid-cols-2 gap-2 mt-4">
        <button id="share-grid" class="btn-primary" style="width:auto">SHARE MY GRID<span class="block text-[10px] font-semibold opacity-75">your full grid</span></button>
        <button id="share-take" class="btn-primary" style="width:auto" ${hasHotTake ? '' : 'disabled'}>SHARE MY TAKE<span class="block text-[10px] font-semibold opacity-75">your hottest take</span></button>
      </div>
      ${hasHotTake ? '' : '<div class="text-[12px] mt-1 text-center" style="color:var(--ink-soft)">No hot takes to share — you agree with the crowd.</div>'}` : ''}
      <button data-nav="/t/${id}" class="card w-full px-3 py-3 mt-2 text-[13px] font-bold un-pressable">✏️ ${mineSubmitted ? 'Edit my ranking' : 'Rank this list'}</button>
      <section id="comments-section" class="mt-4">
        <div class="text-[11px] font-bold uppercase tracking-widest mb-1" style="color:var(--ink-soft)">Comments (<span id="c-count">${agg.total_comments}</span>)</div>
        <div class="card p-2 mb-2">
          <select id="c-anchor" class="mb-2 text-[13px]">
            <option value="">Whole list</option>
            ${data.items.map((it) => `<option value="${it.id}">re: ${esc(it.name)}</option>`).join('')}
          </select>
          <textarea id="c-body" rows="2" placeholder="Say it. Politely-ish."></textarea>
          <button id="c-post" class="btn-primary mt-2" style="padding:9px">Post</button>
        </div>
        <div id="c-list" class="text-sm" style="color:var(--ink-soft)">Loading…</div>
      </section>
      ${agg.rankers.length && data.my.status === 'submitted' ? `<div class="mt-4">
        <div class="text-[11px] font-bold uppercase tracking-widest mb-1" style="color:var(--ink-soft)">Head-to-head</div>
        <div class="flex flex-wrap gap-2">${agg.rankers.slice(0, 10).map((u) =>
          `<button data-nav="/t/${id}/compare/${encodeURIComponent(u)}" class="card px-3 py-2 text-[12.5px] font-bold un-pressable">vs ${esc(u)}</button>`).join('')}</div>
      </div>` : ''}
      ${t.visibility === 'public' && groupBtns ? `<div class="mt-4">
        <div class="text-[11px] font-bold uppercase tracking-widest mb-1" style="color:var(--ink-soft)">Group vs global</div>
        <div class="flex flex-wrap gap-2">${groupBtns}</div>
      </div>` : ''}
    </main>`);

    document.querySelectorAll('[data-dist]').forEach((chip) => chip.addEventListener('click', () => {
      showDistribution(byId[chip.getAttribute('data-dist')], agg, labels);
    }));
    setupComments(t, agg.total_comments);
    if (scrollToComments) {
      // route() scrolls to the top right after this render; queue the
      // comments scroll behind it.
      setTimeout(() => {
        const sec = document.getElementById('comments-section');
        if (sec) sec.scrollIntoView({ behavior: 'smooth' });
      }, 0);
    }

    const sg = document.getElementById('share-grid');
    if (sg) sg.addEventListener('click', () => shareGridCard(t, data, agg, stats));
    const st = document.getElementById('share-take');
    if (st) st.addEventListener('click', () => shareTakeCard(t, byId, stats));
    document.querySelectorAll('[data-groupcmp]').forEach((b) => b.addEventListener('click', () =>
      showGroupCompare(t, data.items, agg, b.getAttribute('data-groupcmp'), b.textContent)));
  }

  function showDistribution(item, agg, labels) {
    if (!item) return;
    const a = agg.items[item.id];
    const total = a ? a.placed : 0;
    const max = a ? Math.max(...a.dist, 1) : 1;
    const bars = labels.map((l, i) => {
      const c = a ? a.dist[i] : 0;
      return `<div class="flex items-center gap-2 mb-1.5">
        <span class="badge" style="background:${tierColor(i)};color:#fff;width:30px;text-align:center">${esc(l)}</span>
        <div class="dist-bar" style="background:${tierColor(i)};width:${Math.round((c / max) * 70)}%"></div>
        <span class="text-[12px] font-bold">${c}</span>
      </div>`;
    }).join('');
    const { close } = showSheet(`
      <div class="font-display font-black text-lg mb-1">${item.emoji ? esc(item.emoji) + ' ' : ''}${esc(item.name)}</div>
      <div class="text-[12.5px] mb-3" style="color:var(--ink-soft)">
        ${a && a.median ? `community tier: ${esc(labels[a.median - 1])}` : 'not enough data yet'} ·
        ${total} placement${total === 1 ? '' : 's'} · ${a ? a.skip_pct : 0}% skipped
        ${item.is_new ? ' · <b style="color:#6a50bd">NEW — low data</b>' : ''}
      </div>
      ${bars}
      <button id="dist-comment" class="mt-3 text-[13px] font-bold" style="color:var(--accent)">💬 comment on ${esc(item.name)}</button>
    `);
    const dc = document.getElementById('dist-comment');
    if (dc) dc.addEventListener('click', () => {
      close();
      const sel = document.getElementById('c-anchor');
      if (sel) sel.value = item.id;
      const sec = document.getElementById('comments-section');
      if (sec) sec.scrollIntoView({ behavior: 'smooth' });
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
      listEl.innerHTML = shown.map((c) => `
        <div class="py-2" style="border-bottom:1px solid var(--paper-deep)">
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
    const biggest = cmp.items[0];
    screen(`${header('You vs ' + esc(cmp.username), { back: `/t/${id}/results` })}
    <main class="max-w-xl mx-auto p-4 un-safe-bottom">
      <div class="text-[13px] mb-2" style="color:var(--ink-soft)">“${esc(cmp.title)}” · ${cmp.shared} items you both placed</div>
      <div class="card p-4 text-center mb-2">
        <div class="font-display font-black text-4xl">${cmp.alignment == null ? '—' : cmp.alignment + '%'} aligned</div>
      </div>
      ${biggest && biggest.distance > 0 ? `<div class="card p-3 mb-3 text-sm">
        <b>You two disagree most about:</b> ${esc(biggest.name)} — you ${tierLetterChip(labels, biggest.mine)}, ${esc(cmp.username)} ${tierLetterChip(labels, biggest.theirs)}
      </div>` : '<div class="card p-3 mb-3 text-sm">You two agree on everything. Get more opinions.</div>'}
      <div class="grid grid-cols-[1fr_auto_auto] gap-x-3 text-[13.5px]">
        <div></div><div class="text-[11px] font-bold pb-1" style="color:var(--ink-soft)">YOU</div><div class="text-[11px] font-bold pb-1" style="color:var(--ink-soft)">${esc(cmp.username.toUpperCase())}</div>
        ${cmp.items.map((r) => `
          <div class="py-1 truncate" style="border-bottom:1px solid var(--paper-deep)">${esc(r.name)}</div>
          <div class="py-1" style="border-bottom:1px solid var(--paper-deep)">${tierLetterChip(labels, r.mine)}</div>
          <div class="py-1" style="border-bottom:1px solid var(--paper-deep)">${tierLetterChip(labels, r.theirs)}</div>`).join('')}
      </div>
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
        <button data-rm="${i}" class="ml-1 font-black" style="color:#b0361f">×</button></span>`).join('')
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
        style="width:64px;text-align:center;font-weight:800;color:#fff;background:${tierColor(i)};border:none">`).join('')
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
        <button data-nav="/t/${t.id}" class="w-full text-left un-pressable">
          <div class="font-bold text-[15px]">${esc(t.title)}</div>
          <div class="text-[12.5px]" style="color:var(--ink-soft)">${t.n} of ${d.members.length} ranked${t.mine_in ? ' · your ranking is in ✓' : ' · <b style="color:#6a50bd">rank it</b>'}</div>
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
        const top = td.items.filter((it) => agg.items[it.id] && agg.items[it.id].median === 1).map((it) => it.name);
        const canvas = drawCard({
          title: `${d.group.name}'s verdict`,
          subtitle: td.template.title,
          lines: top.length ? [`${labels[0]}-tier: ${top.join(', ')}`] : ['No S-tier consensus yet. Keep arguing.'],
          footer: `${agg.n} member rankings · Community Tier Lists`,
        });
        await shareCanvas(canvas, `${d.group.name}'s ${labels[0]}-tier for "${td.template.title}"`, location.origin + '/t/' + tid);
      } catch (err) { toast(err.message); }
    }));
  }

  // ---------- Profile ----------

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
      <div class="text-[11px] font-bold uppercase tracking-widest mb-1" style="color:var(--ink-soft)">My templates</div>
      ${m.my_templates.map((t) => `<button data-nav="/t/${t.id}/results" class="card w-full text-left px-3 py-2 mb-1 text-sm un-pressable">
        <b>${esc(t.title)}</b> — ${t.n} ranking${t.n === 1 ? '' : 's'}${t.visibility === 'group' ? ' · group' : ''}${t.hidden ? ' · <b style="color:#b0361f">hidden</b>' : ''}
      </button>`).join('') || '<div class="card px-3 py-3 text-sm mb-1" style="color:var(--ink-soft)">None yet — make one, it takes a minute.</div>'}
      <button data-nav="/new" class="btn-primary mt-2 mb-4">CREATE A TEMPLATE</button>
      <div class="text-[11px] font-bold uppercase tracking-widest mb-1" style="color:var(--ink-soft)">This week Tier Lists changed because you voted</div>
      ${m.shipped.map((c) => `<div class="card px-3 py-2 mb-1 text-[13px]"><b>${esc(c.title)}</b>${c.body ? `<div style="color:var(--ink-soft)">${esc(c.body)}</div>` : ''}</div>`).join('') || '<div class="text-[13px]" style="color:var(--ink-soft)">Nothing shipped yet.</div>'}
      ${m.is_moderator ? '<button data-nav="/mod" class="card w-full px-3 py-3 mt-3 text-[13px] font-bold un-pressable">🛡️ Moderation queue</button>' : ''}
    </main>`);
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
        <div><span class="badge" style="background:#eee">${q.content_type}</span> ${q.hidden ? '<span class="badge" style="background:#FF6B5722;color:#b0361f">hidden</span>' : ''}
          <b>${esc(q.preview || '(deleted)')}</b></div>
        <div class="text-[12px] mt-1" style="color:var(--ink-soft)">${q.report_count} report${q.report_count === 1 ? '' : 's'} · ${q.reporters.map(esc).join(', ')}${q.reasons.length ? ' · “' + esc(q.reasons[0]) + '”' : ''}</div>
        <div class="flex gap-2 mt-2">
          ${q.template_id ? `<button data-nav="/t/${q.template_id}/results" class="text-[12px] font-bold" style="color:var(--accent)">view</button>` : ''}
          <button data-mod="${q.content_type}:${q.content_id}:restore" class="text-[12px] font-bold" style="color:#4d7325">restore</button>
          <button data-mod="${q.content_type}:${q.content_id}:remove" class="text-[12px] font-bold" style="color:#b0361f">keep hidden</button>
          <button data-mod="${q.content_type}:${q.content_id}:dismiss" class="text-[12px] font-bold" style="color:var(--ink-soft)">dismiss</button>
        </div>
      </div>`).join('') || '<div class="card p-3 text-sm mb-2" style="color:var(--ink-soft)">Queue is empty. 🎉</div>'}
      <div class="text-[11px] font-bold uppercase tracking-widest mb-1 mt-4" style="color:var(--ink-soft)">Integrity flags (${d.flags.length})</div>
      ${d.flags.map((f) => `<div class="card p-3 mb-2 text-sm">
        <b>${esc(f.kind)}</b> on “${esc(f.title || f.template_id || '?')}” · ${esc(JSON.stringify(f.detail || {}))}
        <button data-flag="${f.id}" class="ml-2 text-[12px] font-bold" style="color:#4d7325">resolve</button>
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

  // ---------- Share cards (client-side canvas, 1200×630) ----------

  function cardBase() {
    const c = document.createElement('canvas');
    c.width = 1200; c.height = 630;
    const x = c.getContext('2d');
    x.fillStyle = '#FAF6EE';
    x.fillRect(0, 0, 1200, 630);
    x.fillStyle = '#1F2B47';
    x.fillRect(0, 0, 1200, 8);
    return { c, x };
  }

  function ellipsize(x, text, maxW) {
    if (x.measureText(text).width <= maxW) return text;
    while (text.length > 1 && x.measureText(text + '…').width > maxW) text = text.slice(0, -1);
    return text + '…';
  }

  function drawCard({ title, subtitle, lines, footer }) {
    const { c, x } = cardBase();
    x.fillStyle = '#1F2B47';
    x.font = '900 58px Georgia, serif';
    x.fillText(ellipsize(x, title, 1100), 50, 105);
    if (subtitle) {
      x.fillStyle = '#5A6378';
      x.font = '700 34px Inter, system-ui, sans-serif';
      x.fillText(ellipsize(x, subtitle, 1100), 50, 160);
    }
    x.fillStyle = '#1F2B47';
    x.font = '600 40px Inter, system-ui, sans-serif';
    let y = subtitle ? 250 : 210;
    for (const line of lines) {
      x.fillText(ellipsize(x, line, 1100), 50, y);
      y += 62;
    }
    x.fillStyle = '#A88317';
    x.font = '700 26px Inter, system-ui, sans-serif';
    x.fillText(footer, 50, 590);
    return c;
  }

  function drawGridCanvas(t, items, placementOf, statLine, editionTag) {
    const { c, x } = cardBase();
    const labels = t.tier_labels;
    x.fillStyle = '#1F2B47';
    x.font = '900 46px Georgia, serif';
    x.fillText(ellipsize(x, (editionTag ? editionTag + ' · ' : '') + t.title, 1100), 50, 90);
    const top = 120, bottom = 545;
    const rowH = (bottom - top) / labels.length;
    labels.forEach((label, i) => {
      const y = top + i * rowH;
      x.fillStyle = tierColor(i);
      x.fillRect(50, y + 6, 86, rowH - 12);
      x.fillStyle = '#fff';
      x.font = '900 40px Georgia, serif';
      x.textAlign = 'center';
      x.fillText(String(label).slice(0, 3), 93, y + rowH / 2 + 14);
      x.textAlign = 'left';
      const names = items.filter((it) => placementOf(it) === i + 1).map((it) => it.name);
      x.fillStyle = '#1F2B47';
      x.font = '600 27px Inter, system-ui, sans-serif';
      x.fillText(ellipsize(x, names.join(' · ') || '—', 990), 156, y + rowH / 2 + 10);
    });
    x.fillStyle = '#A88317';
    x.font = '700 26px Inter, system-ui, sans-serif';
    x.fillText(statLine, 50, 600);
    return c;
  }

  async function shareCanvas(canvas, text, url) {
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
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

  function shareGridCard(t, data, agg, stats) {
    const byId = {};
    for (const it of data.items) byId[it.id] = it;
    const hot = stats && stats.hottest && byId[stats.hottest.item_id];
    const statLine = stats
      ? `${stats.alignment}% aligned with ${agg.n} rankers${hot && stats.hottest.distance > 0 ? ` · hottest take: ${hot.name} in ${t.tier_labels[stats.hottest.mine - 1]}` : ''}`
      : `${agg.n} rankings · Community Tier Lists`;
    const canvas = drawGridCanvas(
      t, data.items,
      (it) => agg.my && agg.my.placements ? agg.my.placements[it.id] : null,
      statLine,
      data.daily ? `No. ${data.daily.edition_no}` : '');
    shareCanvas(canvas, `My tier list for "${t.title}"`, location.origin + '/t/' + t.id);
  }

  function shareTakeCard(t, byId, stats) {
    if (!stats || !stats.hottest) return;
    const item = byId[stats.hottest.item_id];
    if (!item) return;
    const tier = t.tier_labels[stats.hottest.mine - 1];
    const canvas = drawCard({
      title: `I put ${item.name} in ${tier} tier.`,
      subtitle: `“${t.title}” · community says ${t.tier_labels[stats.hottest.community - 1]}`,
      lines: ['Fight me.', `(top ${stats.hottest.percentile}% contrarian)`],
      footer: 'Community Tier Lists',
    });
    shareCanvas(canvas, `I put ${item.name} in ${tier} tier. Fight me.`, location.origin + '/t/' + t.id);
  }

  // ---------- boot ----------

  route();
})();
