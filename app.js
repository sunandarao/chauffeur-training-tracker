/* Chauffeur Training Tracker - web app (no build step). Data comes from the Apps Script API. */
(function () {
  'use strict';

  const API_URL = (window.APP_CONFIG && window.APP_CONFIG.API_URL) || '';
  const Q_LABELS = ['Content easy to understand', 'Trainer explained clearly', 'Relevant to daily job', 'Examples / role-plays useful',
    'Materials helpful', 'Duration appropriate', 'Overall training experience'];
  const CATS = ['A+', 'A', 'B', 'C', 'No Category'];
  const LS = { token: 'ctt_token', user: 'ctt_user', draft: 'ctt_draft', view: 'ctt_view' };

  /* ---------------------------------------------------------------- utils */
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n, d = 0) => (n == null || isNaN(n) ? '–' : Number(n).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const pct = (a, b, d = 0) => (b ? fmt((a / b) * 100, d) + '%' : '–');
  const pctv = (v, d = 0) => (v == null || isNaN(v) ? '–' : fmt(v * 100, d) + '%'); // v is a 0–1 share
  const avg = arr => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : null);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };
  const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dShort = iso => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${d}-${MONTHS[+m - 1]}-${y.slice(2)}`; };
  const addMonths = (iso, n) => { const [y, m] = iso.split('-').map(Number); const t = new Date(y, m - 1 + n, 1); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`; };
  const monthLabel = ym => { const [y, m] = ym.split('-'); return `${MONTHS[+m - 1]}-${y.slice(2)}`; };
  const longDate = iso => { if (!iso) return ''; const [y, m, d] = iso.split('-').map(Number); const sfx = (d % 10 === 1 && d !== 11) ? 'st' : (d % 10 === 2 && d !== 12) ? 'nd' : (d % 10 === 3 && d !== 13) ? 'rd' : 'th'; return `${d}${sfx} ${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1]} ${y}`; };
  const scoreCls = v => (v == null ? '' : v >= 4.25 ? 'good' : v >= 3.5 ? 'warn' : 'bad');
  const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  function toast(msg, ms = 3200) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, ms);
  }

  /* ---------------------------------------------------------------- api */
  const S = { token: store.get(LS.token), user: JSON.parse(store.get(LS.user) || 'null'), raw: null, M: null, view: store.get(LS.view) || 'dashboard', charts: [] };

  async function api(action, payload = {}) {
    if (!API_URL || API_URL.indexOf('PASTE') === 0) throw new Error('The app is not connected yet: put the Apps Script URL in config.js.');
    let res;
    try {
      res = await fetch(API_URL, { method: 'POST', body: JSON.stringify(Object.assign({ action, token: S.token }, payload)) });
    } catch (e) { throw new Error('Cannot reach the server. Check your internet connection and try again.'); }
    let out;
    try { out = await res.json(); } catch (e) { throw new Error('The server sent an unexpected reply. Check that the Apps Script is deployed with access "Anyone".'); }
    if (!out.ok) {
      if (/^AUTH:/.test(out.error || '')) { logout(out.error.replace(/^AUTH:\s*/, '')); throw new Error('AUTH'); }
      throw new Error(out.error || 'Something went wrong.');
    }
    return out;
  }

  /* ---------------------------------------------------------------- model */
  function buildModel(d) {
    const fyStart = d.fyStart;
    const [fy, fm, fd] = fyStart.split('-').map(Number);
    const endD = new Date(fy + 1, fm - 1, fd - 1);
    const fyEnd = `${endD.getFullYear()}-${String(endD.getMonth() + 1).padStart(2, '0')}-${String(endD.getDate()).padStart(2, '0')}`;
    const fyLabel = `FY ${fy}-${String(fy + 1).slice(2)}`;
    const modules = d.modules.map(m => ({ name: m[0], dur: m[1], active: m[2] }));
    const modDur = {}; modules.forEach(m => { modDur[m.name] = m.dur; });
    // extra master columns from the sheet (duty counts, incidents); incidents are summed for the filter
    const extraCols = d.chCols || [];
    const incIdx = extraCols.map((h, i) => (/incident/i.test(h) ? i : -1)).filter(i => i >= 0);
    const ch = {}; const chList = [];
    d.chauffeurs.forEach(r => {
      const extra = (r[9] || []).map(v => (v === '' ? null : v));
      const c = { code: r[0], name: r[1], loc: r[2] || 'UNKNOWN', type: r[3] || '-', status: r[4], doj: r[5], dol: r[6], cat: r[7] || 'No Category',
        mobile: r[8] || '', extra, inc: incIdx.reduce((t, i) => t + (Number(extra[i]) || 0), 0),
        inScope: !(r[6] && r[6] < fyStart), n: 0, mins: 0, mods: {}, trainers: {}, first: '', last: '', att: [] };
      ch[c.code] = c; chList.push(c);
    });
    const att = [];
    d.attendance.forEach(r => {
      const a = { id: r[0], date: r[1], code: r[2], module: r[3], trainer: r[4] || '(not recorded)', remarks: r[5], q: (r[6] || []).slice(0, Q_LABELS.length), mine: r[7] === 1 };
      a.c = ch[a.code];
      a.mins = modDur[a.module] || 0;
      a.inFY = a.date >= fyStart && a.date <= fyEnd;
      const qs = a.q.filter(v => v !== '' && v != null);
      a.rating = qs.length ? avg(qs) : null;
      a.loc = a.c ? a.c.loc : 'UNKNOWN';
      att.push(a);
      if (a.c && a.inFY) {
        const c = a.c; c.n++; c.mins += a.mins; c.mods[a.module] = (c.mods[a.module] || 0) + 1;
        if (a.trainer) c.trainers[a.trainer] = 1;
        if (!c.first || a.date < c.first) c.first = a.date;
        if (!c.last || a.date > c.last) c.last = a.date;
      }
      if (a.c) a.c.att.push(a);
    });
    const scoped = chList.filter(c => c.inScope);
    const fyAtt = att.filter(a => a.inFY && a.c && a.c.inScope);
    const locations = Array.from(new Set(scoped.map(c => c.loc))).sort();
    const trainerNames = Array.from(new Set(att.map(a => a.trainer))).filter(t => t && t !== '(not recorded)').sort();
    // new entries: only active L&D users (people who left drop out) plus an option for outside trainers
    const trainerOptions = Array.from(new Set(d.trainers.concat(['External Trainer']))).filter(Boolean).sort();
    const months = []; for (let i = 0; i < 12; i++) months.push(addMonths(fyStart, i));
    const types = Array.from(new Set(chList.map(c => c.type))).sort();
    const pending = (d.pending || []).map(r => ({ id: r[0], date: r[1], code: r[2], name: r[3], module: r[4], trainer: r[5], remarks: r[6], by: r[7] }));
    return { d, fyStart, fyEnd, fyLabel, modules, modDur, ch, chList, scoped, att, fyAtt, locations, trainerNames, trainerOptions, months, extraCols, hasInc: incIdx.length > 0, types, pending };
  }

  // Aggregates for a subset (filter function over chauffeurs / attendance)
  function summarize(chs, atts) {
    const trained = chs.filter(c => c.n > 0).length;
    const mins = atts.reduce((s, a) => s + a.mins, 0);
    const rated = atts.filter(a => a.rating != null);
    return { chauffeurs: chs.length, trained, never: chs.length - trained, attendances: atts.length, hours: mins / 60,
      avgHours: trained ? mins / 60 / trained : 0, responses: rated.length, rating: avg(rated.map(a => a.rating)) };
  }
  function groupBy(arr, key) { const m = new Map(); arr.forEach(x => { const k = key(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }); return m; }
  const sessionsOf = atts => new Set(atts.map(a => a.date + '|' + a.module + '|' + a.loc + '|' + a.trainer)).size;

  /* ---------------------------------------------------------------- shell */
  function showLogin(msg) {
    $('#app-view').hidden = true; $('#login-view').hidden = false; $('#reset-form').hidden = true; $('#login-form').hidden = false;
    $('#login-error').textContent = msg || '';
    setTimeout(() => $('#login-email').focus(), 50);
  }
  function logout(msg) {
    S.token = null; S.user = null; store.del(LS.token); store.del(LS.user);
    closeDrawer(); showLogin(msg);
  }

  $('#login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('#login-btn'); btn.disabled = true; btn.textContent = 'Signing in…'; $('#login-error').textContent = '';
    try {
      const out = await api('login', { email: $('#login-email').value.trim(), password: $('#login-password').value });
      S.token = out.token; S.user = { name: out.name, role: out.role, email: out.email };
      store.set(LS.token, S.token); store.set(LS.user, JSON.stringify(S.user));
      $('#login-password').value = '';
      await start(true);
    } catch (err) {
      if (err.message !== 'AUTH') $('#login-error').textContent = err.message;
    } finally { btn.disabled = false; btn.textContent = 'Sign in'; }
  });

  // Forgot password: email -> 6-digit code -> new password (signs in straight away)
  const showReset = on => {
    $('#login-form').hidden = on; $('#reset-form').hidden = !on;
    $('#rs-error').textContent = '';
    if (on) { $('#rs-step1').hidden = false; $('#rs-step2').hidden = true; $('#rs-email').value = $('#login-email').value.trim(); setTimeout(() => $('#rs-email').focus(), 50); }
    else setTimeout(() => $('#login-email').focus(), 50);
  };
  $('#forgot-btn').onclick = () => showReset(true);
  $('#rs-back').onclick = () => showReset(false);
  const sendCode = async () => {
    const btn = $('#rs-send'); btn.disabled = true; btn.textContent = 'Sending…'; $('#rs-error').textContent = '';
    try {
      const out = await api('resetRequest', { email: $('#rs-email').value.trim() });
      $('#rs-sent').textContent = out.message; $('#rs-step1').hidden = true; $('#rs-step2').hidden = false;
      setTimeout(() => $('#rs-code').focus(), 50);
    } catch (err) { $('#rs-error').textContent = err.message; }
    finally { btn.disabled = false; btn.textContent = 'Email me a code'; }
  };
  $('#rs-send').onclick = sendCode;
  $('#rs-email').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); sendCode(); } };
  $('#rs-resend').onclick = () => { $('#rs-step1').hidden = false; $('#rs-step2').hidden = true; sendCode(); };
  $('#reset-form').addEventListener('submit', async e => {
    e.preventDefault();
    const pw = $('#rs-pw').value;
    if (pw.length < 6) { $('#rs-error').textContent = 'New password must be at least 6 characters.'; return; }
    if (pw !== $('#rs-pw2').value) { $('#rs-error').textContent = 'The two passwords do not match.'; return; }
    const btn = $('#rs-save'); btn.disabled = true; btn.textContent = 'Saving…'; $('#rs-error').textContent = '';
    try {
      const out = await api('resetConfirm', { email: $('#rs-email').value.trim(), code: $('#rs-code').value, newPassword: pw });
      S.token = out.token; S.user = { name: out.name, role: out.role, email: out.email };
      store.set(LS.token, S.token); store.set(LS.user, JSON.stringify(S.user));
      $('#rs-pw').value = ''; $('#rs-pw2').value = ''; $('#rs-code').value = '';
      showReset(false);
      await start(true);
      toast('Password changed. You are signed in.');
    } catch (err) { $('#rs-error').textContent = err.message; }
    finally { btn.disabled = false; btn.textContent = 'Set password and sign in'; }
  });

  // Busy indicator: progress bar under the header, a ticking timer, and a disabled Refresh button.
  function busy(on) {
    clearInterval(busy._t);
    document.body.classList.toggle('busy', on);
    const btn = $('#refresh-btn');
    btn.disabled = on; btn.textContent = on ? 'Refreshing…' : 'Refresh';
    if (!on) return;
    const t0 = Date.now();
    const tick = () => {
      const s = Math.round((Date.now() - t0) / 1000);
      $('#sync-status').textContent = `Refreshing… ${s}s`;
      const l = $('#main .loading'); if (l) l.textContent = `Loading training data… ${s}s`;
    };
    tick(); busy._t = setInterval(tick, 1000);
  }

  async function load(silent) {
    busy(true);
    let d;
    try { d = await api('data'); } finally { busy(false); }
    S.raw = d; S.M = buildModel(d); S.user = d.me; store.set(LS.user, JSON.stringify(d.me));
    $('#app-name').textContent = (window.APP_CONFIG && window.APP_CONFIG.APP_NAME) || 'CCR Chauffeur L&D Tracker';
    $('#fy-label').textContent = S.M.fyLabel;
    const viewer = d.me.role === 'viewer';
    const spoc = d.me.role === 'spoc';
    $('#me-name').textContent = d.me.name + (d.me.role === 'admin' ? ' · Admin' : viewer ? ' · View only' : spoc ? ' · L&D SPOC' : '');
    $('#admin-tab').hidden = d.me.role !== 'admin';
    $('#account-btn').hidden = false;
    $('#fbqr-btn').hidden = viewer;
    $$('#tabs [data-view="add"], #tabs [data-view="entries"]').forEach(b => { b.hidden = viewer; });
    $('#scope-label').textContent = scopeLabel();
    $('#scope-label').hidden = !(viewer || spoc);
    $('#export-btn').hidden = viewer; // viewers may look but not download
    const t = new Date();
    $('#sync-status').textContent = 'Updated ' + t.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    if (!silent) render();
  }

  // "PAN India", "MUMBAI", or "3 locations" for the signed-in viewer
  function scopeLabel() {
    const a = S.user && S.user.access;
    if (!a || a === 'All') return 'PAN India';
    if (!a.length) return 'No locations assigned';
    return a.length <= 2 ? a.join(', ') : `${a.length} locations`;
  }

  async function start(first) {
    $('#login-view').hidden = true; $('#app-view').hidden = false;
    $('#main').innerHTML = '<div class="loading">Loading training data…</div>';
    try {
      await load(true);
      // a branch head (one location) lands on their location card
      const r = parseHash();
      if (r) applyRoute(r.view, r.p);
      else if (first && (S.user.role === 'viewer' || S.user.role === 'spoc') && Array.isArray(S.user.access) && S.user.access.length === 1) {
        S.view = 'locations'; S.cardLoc = S.M.locations[0];
      }
      render();
    } catch (err) {
      console.error(err);
      if (err.message !== 'AUTH') $('#main').innerHTML = `<div class="panel"><h2>Could not load data</h2><p class="form-error">${esc(err.message)}</p><button class="btn" id="retry">Try again</button></div>`;
      const r = $('#retry'); if (r) r.onclick = start;
    }
  }

  /* Routing: every screen has an address (#/chauffeurs?loc=PUNE&st=Not%20trained), so Back/Forward,
     refresh and shared links open the same data. Tiles and table rows call go() to jump to the matching list. */
  const VIEWS = ['dashboard', 'locations', 'chauffeurs', 'feedback', 'add', 'entries', 'admin'];
  const chfDefault = () => ({ q: '', loc: 'All', act: 'All', st: 'All', cat: 'All', type: 'All', mod: 'All', inc: 'All' });
  // Active unless the master gives a leaving date or a status such as Left / Inactive / Resigned
  const isActive = c => !c.dol && !/left|inactive|resign|abscond|terminat/i.test(c.status || '');
  function applyRoute(view, p) {
    S.view = VIEWS.includes(view) ? view : 'dashboard'; store.set(LS.view, S.view);
    if (!p) return;
    if (S.view === 'dashboard') S.dashLoc = p.loc || 'All';
    if (S.view === 'locations' && p.loc) S.cardLoc = p.loc;
    if (S.view === 'chauffeurs') {
      S.chf = Object.assign(chfDefault(), p); delete S.chf.sort; S.chLimit = 500;
      S.sort = S.sort || {}; S.sort.chs = p.sort ? { key: p.sort, dir: 'desc' } : { key: 'name', dir: 'asc' };
    }
    if (S.view === 'feedback') S.fbf = { loc: p.loc || 'All', tr: p.tr || 'All', mod: p.mod || 'All' };
    if (S.view === 'entries') { S.enf = { from: p.from || '', to: p.to || '', tr: p.tr || 'All', mod: p.mod || 'All', loc: p.loc || 'All', mine: p.mine === '1', q: p.q || '' }; if (S.sel) S.sel.clear(); }
  }
  function go(view, p) {
    applyRoute(view, p || null);
    const h = routeHash();
    if (location.hash !== h) history.pushState(null, '', h);
    render(); window.scrollTo(0, 0);
  }
  // The address for what is on screen now (only non-default filters)
  function routeHash() {
    const v = S.view, p = {};
    const put = (k, val, def) => { if (val != null && val !== '' && val !== def) p[k] = val; };
    if (v === 'dashboard') put('loc', S.dashLoc, 'All');
    if (v === 'locations') put('loc', S.cardLoc);
    if (v === 'chauffeurs' && S.chf) { const d = chfDefault(); Object.keys(d).forEach(k => put(k, S.chf[k], d[k])); const so = S.sort && S.sort.chs; if (so && so.key !== 'name') put('sort', so.key); }
    if (v === 'feedback' && S.fbf) ['loc', 'tr', 'mod'].forEach(k => put(k, S.fbf[k], 'All'));
    if (v === 'entries' && S.enf) { put('from', S.enf.from); put('to', S.enf.to); ['tr', 'mod', 'loc'].forEach(k => put(k, S.enf[k], 'All')); put('q', S.enf.q); if (S.enf.mine) p.mine = '1'; }
    const qs = Object.keys(p).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(p[k])).join('&');
    return '#/' + v + (qs ? '?' + qs : '');
  }
  function parseHash() {
    const m = location.hash.match(/^#\/([a-z]+)(?:\?(.*))?$/); if (!m) return null;
    const p = {}; (m[2] || '').split('&').filter(Boolean).forEach(kv => { const [k, v] = kv.split('='); p[decodeURIComponent(k)] = decodeURIComponent(v || ''); });
    return { view: m[1], p };
  }
  window.addEventListener('popstate', () => { const r = parseHash(); if (!r || !S.M) return; closeDrawer(); applyRoute(r.view, r.p); render(); });
  // data-go="view|k=v&k=v" on tiles and rows
  const goAttr = (view, p) => `data-go="${esc(view + '|' + Object.keys(p || {}).filter(k => p[k] != null && p[k] !== '' && p[k] !== 'All').map(k => encodeURIComponent(k) + '=' + encodeURIComponent(p[k])).join('&'))}"`;
  function wireGo(root) {
    $$('[data-go]', root).forEach(el => {
      const [view, qs] = el.dataset.go.split('|'); const p = {};
      (qs || '').split('&').filter(Boolean).forEach(kv => { const [k, v] = kv.split('='); p[decodeURIComponent(k)] = decodeURIComponent(v || ''); });
      el.onclick = ev => { if (ev.target.closest('a, button:not([data-go]), input, select')) return; go(view, p); };
      if (!/^(TR|BUTTON)$/.test(el.tagName)) { el.tabIndex = 0; el.setAttribute('role', 'link'); el.onkeydown = ev => { if (ev.key === 'Enter') go(view, p); }; }
    });
  }

  $('#tabs').addEventListener('click', e => {
    const b = e.target.closest('button[data-view]'); if (!b) return;
    go(b.dataset.view);
  });
  // logo / app name = home: open the Dashboard with fresh data
  $('#home-btn').onclick = async () => { if (document.body.classList.contains('busy')) return; S.view = 'dashboard'; store.set(LS.view, S.view); if (location.hash !== routeHash()) history.pushState(null, '', routeHash()); window.scrollTo(0, 0); try { await load(); } catch (e) { if (e.message !== 'AUTH') toast(e.message); } };
  $('#refresh-btn').onclick = async () => { try { await load(); toast('Data refreshed'); } catch (e) { if (e.message !== 'AUTH') toast(e.message); } };
  $('#export-btn').onclick = () => exportExcel();
  $('#fbqr-btn').onclick = () => collectFeedback([]);
  $('#account-btn').onclick = () => openAccount();
  $('#overlay').onclick = () => closeDrawer();
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });

  function destroyCharts() { S.charts.forEach(c => c.destroy()); S.charts = []; }

  function render() {
    if (!S.M) return;
    if (S.view === 'admin' && S.user.role !== 'admin') S.view = 'dashboard';
    if ((S.view === 'add' || S.view === 'entries') && S.user.role === 'viewer') S.view = 'dashboard';
    $$('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.view === S.view));
    destroyCharts();
    const views = { dashboard: viewDashboard, locations: viewLocation, chauffeurs: viewChauffeurs, feedback: viewFeedback, add: viewAdd, entries: viewEntries, admin: viewAdmin };
    (views[S.view] || viewDashboard)();
    if (S.view === 'dashboard' || S.view === 'locations') welcome();
    wireGo($('#main'));
    const h = routeHash(); if (location.hash !== h) history.replaceState(null, '', h);
  }

  // Greeting strip at the top of the landing pages: name, role and area of the signed-in person
  function welcome() {
    const u = S.user; if (!u) return;
    const h = new Date().getHours();
    const part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    const role = { admin: 'Admin', trainer: 'L&D', spoc: 'L&D SPOC', viewer: 'View only' }[u.role] || '';
    const el = document.createElement('div');
    el.className = 'welcome';
    el.innerHTML = `<span class="welcome-hi">Welcome, <b>${esc(u.name || 'there')}</b></span><span class="muted">${part} · ${esc(role)} · ${esc(scopeLabel())}</span>`;
    $('#main').prepend(el);
  }

  /* ---------------------------------------------------------------- building blocks */
  function kpis(items) {
    return `<div class="kpis">${items.map(k => `<div class="kpi ${k.cls || ''}${k.go ? ' link' : ''}"${k.go ? ' ' + goAttr(k.go[0], k.go[1]) : ''}><span class="label">${esc(k.label)}${k.go ? ' <span class="go">›</span>' : ''}</span><span class="value">${k.value}</span>${k.sub ? `<span class="sub">${k.sub}</span>` : ''}</div>`).join('')}</div>`;
  }
  // Inline bar + number: bar(value, max, label, 'amber')
  function bar(v, max, label, cls = '') {
    const w = max ? Math.max(v > 0 ? 2 : 0, Math.round((v / max) * 100)) : 0;
    return `<span class="bar ${cls}"><span class="track"><i style="width:${w}%"></i></span><span class="num">${label}</span></span>`;
  }
  function select(id, label, options, value) {
    return `<div class="field"><label for="${id}">${esc(label)}</label><select id="${id}">${options.map(o => {
      const [v, t] = Array.isArray(o) ? o : [o, o];
      return `<option value="${esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${esc(t)}</option>`;
    }).join('')}</select></div>`;
  }
  function scoreCell(v) { return v == null ? '<span class="muted">–</span>' : `<span class="score ${scoreCls(v)}">${fmt(v, 2)}</span>`; }

  // Sortable table: cols = [{key,label,n(numeric),fmt(row)->html}], rows = objects
  function table(id, cols, rows, opts = {}) {
    const st = (S.sort = S.sort || {})[id] || { key: opts.sortKey || cols[0].key, dir: opts.sortDir || 'asc' };
    const sorted = rows.slice().sort((a, b) => {
      const x = a[st.key], y = b[st.key];
      const r = (typeof x === 'number' || typeof y === 'number') ? (x ?? -Infinity) - (y ?? -Infinity) : String(x ?? '').localeCompare(String(y ?? ''), undefined, { numeric: true });
      return st.dir === 'asc' ? r : -r;
    });
    const limited = opts.limit ? sorted.slice(0, opts.limit) : sorted;
    const head = cols.map(c => `<th class="sortable ${c.n ? 'n' : ''} ${c.cls || ''}"${c.title ? ` title="${esc(c.title)}"` : ''} data-t="${id}" data-k="${c.key}">${esc(c.label)}${st.key === c.key ? (st.dir === 'asc' ? ' ▲' : ' ▼') : ''}</th>`).join('');
    const body = limited.map(r => `<tr${opts.rowAttr ? ' ' + opts.rowAttr(r) : ''}>${cols.map(c => `<td class="${c.n ? 'n' : ''} ${c.cls || ''}">${c.fmt ? c.fmt(r) : esc(r[c.key])}</td>`).join('')}</tr>`).join('');
    const foot = opts.foot ? `<tfoot><tr>${opts.foot.map((f, i) => `<td class="${cols[i] && cols[i].n ? 'n' : ''}">${f}</td>`).join('')}</tr></tfoot>` : '';
    const more = opts.limit && sorted.length > opts.limit ? `<p class="note">Showing ${opts.limit} of ${fmt(sorted.length)}. Use search or filters to narrow down.</p>` : '';
    return `<div class="table-wrap ${opts.tall ? 'tall' : ''} ${opts.wrapCls || ''}"><table><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${cols.length}" class="muted">Nothing to show.</td></tr>`}</tbody>${foot}</table></div>${more}`;
  }
  function wireSort(root, rerender) {
    $$('th.sortable', root).forEach(th => th.addEventListener('click', () => {
      const id = th.dataset.t, k = th.dataset.k; const cur = (S.sort[id] || {});
      S.sort[id] = { key: k, dir: cur.key === k && cur.dir === 'desc' ? 'asc' : 'desc' };
      rerender();
    }));
  }

  function chart(canvasId, config) {
    const el = document.getElementById(canvasId); if (!el || !window.Chart) return;
    const ink2 = cssVar('--ink-2'), line = cssVar('--line');
    Chart.defaults.color = ink2; Chart.defaults.borderColor = line; Chart.defaults.font.family = cssVar('--font-body');
    config.options = Object.assign({ responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { labels: { boxWidth: 12 } } } }, config.options || {});
    S.charts.push(new Chart(el, config));
  }
  function monthlyChart(canvasId, atts) {
    const M = S.M;
    const byM = groupBy(atts, a => a.date.slice(0, 7));
    const nowYm = todayIso().slice(0, 7);
    const future = m => m > nowYm;
    chart(canvasId, {
      type: 'bar',
      data: {
        labels: M.months.map(monthLabel),
        datasets: [
          { type: 'bar', label: 'Attendees', data: M.months.map(m => (future(m) ? null : (byM.get(m) || []).length)), backgroundColor: cssVar('--accent'), borderRadius: 4, yAxisID: 'y' },
          { type: 'line', label: 'Manhours', data: M.months.map(m => (future(m) ? null : (byM.get(m) || []).reduce((s, a) => s + a.mins, 0) / 60)), borderColor: cssVar('--amber'), backgroundColor: cssVar('--amber'), tension: .25, pointRadius: 3, yAxisID: 'y1' }
        ]
      },
      options: { scales: { y: { beginAtZero: true, title: { display: true, text: 'Attendees' }, grid: { color: cssVar('--line') } }, y1: { beginAtZero: true, position: 'right', grid: { display: false }, title: { display: true, text: 'Manhours' } }, x: { grid: { display: false } } } }
    });
  }
  function hbarChart(canvasId, labels, values, color, label, opts = {}) {
    chart(canvasId, {
      type: 'bar',
      data: { labels, datasets: [{ label, data: values, backgroundColor: color, borderRadius: 4 }] },
      options: Object.assign({ indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, grid: { color: cssVar('--line') }, max: opts.max }, y: { grid: { display: false }, ticks: { autoSkip: false } } } }, opts.options || {})
    });
  }

  function moduleRows(chs, atts) {
    const M = S.M;
    const byMod = groupBy(atts, a => a.module);
    return M.modules.filter(m => m.active || byMod.has(m.name)).map(m => {
      const list = byMod.get(m.name) || [];
      const people = new Set(list.map(a => a.code)).size;
      return { module: m.name, dur: m.dur, att: list.length, people, cov: chs.length ? people / chs.length : 0, hours: list.length * m.dur / 60 };
    });
  }
  function trainerRows(atts) {
    return Array.from(groupBy(atts, a => a.trainer)).map(([t, list]) => {
      const rated = list.filter(a => a.rating != null);
      return { trainer: t, sessions: sessionsOf(list), att: list.length, people: new Set(list.map(a => a.code)).size, hours: list.reduce((s, a) => s + a.mins, 0) / 60,
        responses: rated.length, rate: list.length ? rated.length / list.length : 0, rating: rated.length ? avg(rated.map(a => a.rating)) : null };
    });
  }
  const trainerCols = [
    { key: 'trainer', label: 'L&D', fmt: r => `<span class="nowrap">${esc(r.trainer)}</span>` },
    { key: 'sessions', label: 'Total Sessions', n: 1, fmt: r => fmt(r.sessions) },
    { key: 'att', label: 'Participants', n: 1, fmt: r => fmt(r.att) },
    { key: 'people', label: 'Unique', n: 1, fmt: r => fmt(r.people) },
    { key: 'hours', label: 'Manhours', n: 1, fmt: r => fmt(r.hours, 1) },
    { key: 'rating', label: 'Avg Feedback rating', n: 1, fmt: r => scoreCell(r.rating) },
    { key: 'rate', label: 'Feedback response coverage', n: 1, fmt: r => `${pct(r.responses, r.att)} <span class="muted">(${fmt(r.responses)})</span>` }
  ];

  /* ---------------------------------------------------------------- Dashboard */
  function viewDashboard() {
    const M = S.M;
    const loc = S.dashLoc || 'All';
    const chs = M.scoped.filter(c => loc === 'All' || c.loc === loc);
    const atts = M.fyAtt.filter(a => loc === 'All' || a.loc === loc);
    const s = summarize(chs, atts);
    const locRows = M.locations.map(l => {
      const c = M.scoped.filter(x => x.loc === l); const a = M.fyAtt.filter(x => x.loc === l); const t = c.filter(x => x.n > 0).length;
      return { loc: l, chauffeurs: c.length, trained: t, cov: c.length ? t / c.length : 0, att: a.length, hours: a.reduce((q, x) => q + x.mins, 0) / 60 };
    });
    const split = (key, keys) => keys.map(k => {
      const c = chs.filter(x => x[key] === k); const t = c.filter(x => x.n > 0).length;
      return { k, chauffeurs: c.length, trained: t, att: c.reduce((q, x) => q + x.n, 0), cov: c.length ? t / c.length : 0, hours: c.reduce((q, x) => q + x.mins, 0) / 60 };
    }).filter(r => r.chauffeurs);
    const types = Array.from(new Set(chs.map(c => c.type))).sort();
    const mods = moduleRows(chs, atts);
    const maxCov = 1, maxH = Math.max(...locRows.map(r => r.hours), 1);
    const last = M.att.reduce((m, a) => (a.date > m ? a.date : m), '');
    const viewer = S.user.role === 'viewer';
    const L = loc === 'All' ? undefined : loc;
    const kGo = {
      total: ['chauffeurs', { loc: L, st: 'In FY scope' }], unique: ['chauffeurs', { loc: L, st: 'Trained' }], never: ['chauffeurs', { loc: L, st: 'Not trained' }],
      att: viewer ? ['chauffeurs', { loc: L, st: 'Trained', sort: 'n' }] : ['entries', { loc: L, from: M.fyStart, to: M.fyEnd }],
      hours: ['chauffeurs', { loc: L, st: 'Trained', sort: 'hrs' }], fb: ['feedback', { loc: L }] };

    $('#main').innerHTML = `
      <div class="quick">
        ${viewer ? '' : `<button class="qa qa-main" type="button" ${goAttr('add', {})}>${ICON.add}<span><b>Record a session</b><small>Add today's training</small></span></button>`}
        <button class="qa" type="button" ${goAttr('chauffeurs', { loc: L, st: 'Not trained' })}>${ICON.chauffeurs}<span><b>Who is not trained</b><small>${fmt(s.never)} chauffeurs to call</small></span></button>
        ${viewer ? `<button class="qa" type="button" ${goAttr('feedback', { loc: L })}>${ICON.feedback}<span><b>Chauffeur feedback</b><small>Ratings by L&amp;D and module</small></span></button>`
          : `<button class="qa" type="button" id="qa-qr">${ICON.qr}<span><b>Feedback QR</b><small>Show or download the QR</small></span></button>`}
        <button class="qa" type="button" ${goAttr('locations', { loc: L || (S.cardLoc || '') })}>${ICON.locations}<span><b>Location cards</b><small>Coverage and ranking</small></span></button>
      </div>
      <div class="view-head"><div><h1>Training Dashboard</h1><p class="muted">${esc(M.fyLabel)} · ${dShort(M.fyStart)} to ${dShort(M.fyEnd)} · last training logged ${dShort(last)}</p></div>
        <div class="filters">${select('f-dloc', 'Location', ['All'].concat(M.locations), loc)}</div></div>
      ${kpis([
        { label: 'Total Chauffeurs', value: fmt(s.chauffeurs), sub: 'Effective ' + longDate(M.fyStart), go: kGo.total },
        { label: 'Unique', value: fmt(s.trained), sub: pct(s.trained, s.chauffeurs, 1) + ' coverage · target ' + fmt(fyElapsed() * 100, 1) + '%', cls: s.chauffeurs ? ({ good: 'good', warn: 'warn', bad: 'bad' })[covStatus(s.trained / s.chauffeurs)] : '', go: kGo.unique },
        { label: 'Chauffeurs in Scope', value: fmt(s.never), sub: pct(s.never, s.chauffeurs, 1) + ' of chauffeurs', cls: s.never ? 'bad' : '', go: kGo.never },
        { label: 'Attendees', value: fmt(s.attendances), sub: fmt(sessionsOf(atts)) + ' sessions', go: kGo.att },
        { label: 'Manhours', value: fmt(s.hours, 0), sub: fmt(s.avgHours, 1) + ' per trained chauffeur', cls: 'hours', go: kGo.hours },
        { label: 'Feedback rating', value: s.rating == null ? '–' : fmt(s.rating, 2) + '<small class="of5">out of 5</small>', sub: fmt(s.responses) + ' responses (response rate ' + pct(s.responses, s.attendances) + ')', go: kGo.fb }
      ])}
      <div class="grid-2">
        <section class="panel"><div class="panel-head"><h2>Monthly trend</h2><p class="muted">Bars: attendees · line: manhours</p></div><div class="chart-box"><canvas id="c-month"></canvas></div></section>
        <section class="panel"><div class="panel-head"><h2>Manhours by module</h2><p class="muted">Attendees × module duration</p></div><div class="chart-box"><canvas id="c-mod"></canvas></div></section>
      </div>
      ${loc === 'All' ? `<section class="panel" id="p-loc"><div class="panel-head"><h2>Coverage by location</h2><p class="muted">${covNote()}</p></div>
        ${table('loc', [
          { key: 'loc', label: 'Location' },
          { key: 'chauffeurs', label: 'Chauffeurs', n: 1, fmt: r => fmt(r.chauffeurs) },
          { key: 'trained', label: 'Trained', n: 1, fmt: r => fmt(r.trained) },
          { key: 'cov', label: 'Coverage', fmt: r => `<span title="${covTitle(r.cov)}">${bar(r.cov, maxCov, pct(r.cov, 1), covStatus(r.cov))}</span>` },
          { key: 'att', label: 'Attendees', n: 1, fmt: r => fmt(r.att) },
          { key: 'hours', label: 'Manhours', fmt: r => bar(r.hours, maxH, fmt(r.hours, 1), 'amber') }
        ], locRows, { sortKey: 'chauffeurs', sortDir: 'desc', rowAttr: r => `class="click" data-loc="${esc(r.loc)}"`,
          foot: ['Total', fmt(s.chauffeurs), fmt(s.trained), pct(s.trained, s.chauffeurs, 1), fmt(s.attendances), fmt(s.hours, 1)] })}</section>` : ''}
      <div class="grid-2">
        <section class="panel"><div class="panel-head"><h2>L&amp;D team</h2></div>${table('trn', trainerCols, trainerRows(atts), { sortKey: 'att', sortDir: 'desc', rowAttr: r => 'class="click" ' + (viewer ? goAttr('feedback', { loc: L, tr: r.trainer }) : goAttr('entries', { loc: L, tr: r.trainer, from: M.fyStart, to: M.fyEnd })) })}</section>
        <section class="panel"><div class="panel-head"><h2>Modules</h2></div>${table('mod', [
          { key: 'module', label: 'Module' }, { key: 'dur', label: 'Duration', n: 1, fmt: r => r.dur + ' min' }, { key: 'att', label: 'Participants', n: 1, fmt: r => fmt(r.att) },
          { key: 'people', label: 'Unique', n: 1, fmt: r => fmt(r.people) }, { key: 'hours', label: 'Manhours', n: 1, fmt: r => fmt(r.hours, 1) }
        ], mods, { sortKey: 'hours', sortDir: 'desc', rowAttr: r => 'class="click" ' + goAttr('chauffeurs', { loc: L, st: 'In FY scope', mod: 'not:' + r.module }) })}</section>
      </div>
      <div class="grid-2 split2">
        <section class="panel"><div class="panel-head"><h2>Category-wise</h2></div>${splitTable('cat', split('cat', CATS), 'Category', k => goAttr('chauffeurs', { loc: L, st: 'In FY scope', cat: k }))}</section>
        <section class="panel"><div class="panel-head"><h2>Chauffeur Type</h2></div>${splitTable('typ', split('type', types), 'Type', k => goAttr('chauffeurs', { loc: L, st: 'In FY scope', type: k }))}</section>
      </div>`;
    $('#f-dloc').onchange = e => { S.dashLoc = e.target.value; render(); };
    if ($('#qa-qr')) $('#qa-qr').onclick = () => collectFeedback([]);
    $$('#p-loc tr[data-loc]').forEach(tr => tr.onclick = () => go('locations', { loc: tr.dataset.loc }));
    wireSort($('#main'), render);
    monthlyChart('c-month', atts);
    const mh = mods.slice().sort((a, b) => b.hours - a.hours);
    hbarChart('c-mod', mh.map(r => r.module), mh.map(r => +r.hours.toFixed(1)), cssVar('--amber'), 'Manhours');
  }
  function splitTable(id, rows, first, link) {
    return table(id, [
      { key: 'k', label: first }, { key: 'chauffeurs', label: 'Total Chauffeurs', n: 1, fmt: r => fmt(r.chauffeurs) },
      { key: 'att', label: 'Trained', n: 1, fmt: r => fmt(r.att) }, { key: 'trained', label: 'Unique Trained', n: 1, fmt: r => fmt(r.trained) },
      { key: 'cov', label: 'Coverage', n: 1, fmt: r => covPill(r.cov) }, { key: 'hours', label: 'Manhours', n: 1, fmt: r => fmt(r.hours, 1) }
    ], rows, { sortKey: 'chauffeurs', sortDir: 'desc', rowAttr: link ? r => 'class="click" ' + link(r.k) : null });
  }
  // Coverage is judged against the share of the financial year that has passed (pro-rata target).
  // green: at or above target, amber: below target, red: under 60% of target (= 30% when the target is 50%).
  // Target = completed months of the FY / 12 (Apr-Sep done = 6/12 = 50%). At least one month.
  function fyMonthsDone() {
    const M = S.M; if (!M) return 12;
    const [fy, fm] = M.fyStart.split('-').map(Number), [ty, tm] = todayIso().split('-').map(Number);
    return Math.min(12, Math.max(1, (ty - fy) * 12 + (tm - fm)));
  }
  function fyElapsed() { return fyMonthsDone() / 12; }
  const covStatus = c => { const r = c / fyElapsed(); return r >= 1 ? 'good' : r >= 0.6 ? 'warn' : 'bad'; };
  const covTitle = c => `${fmt(c * 100, 1)}% coverage = ${fmt(c / fyElapsed() * 100, 0)}% of the pro-rata target (target ${fmt(fyElapsed() * 100, 1)}% = ${fyMonthsDone()} of 12 months)`;
  const covPill = c => `<span class="pill ${covStatus(c)}" title="${covTitle(c)}">${fmt(c * 100, 0)}%</span>`;
  const covNote = () => `Target by now ${fmt(fyElapsed() * 100, 1)}% (${fyMonthsDone()} of 12 months) · colour vs target: <span class="pill good">${fmt(fyElapsed() * 100, 0)}%+</span> <span class="pill warn">${fmt(fyElapsed() * 60, 0)}–${fmt(fyElapsed() * 100, 0)}%</span> <span class="pill bad">below ${fmt(fyElapsed() * 60, 0)}%</span>`;

  /* ---------------------------------------------------------------- Location card */
  function viewLocation() {
    const M = S.M;
    const loc = S.cardLoc || M.locations[0];
    const chs = M.scoped.filter(c => c.loc === loc);
    const atts = M.fyAtt.filter(a => a.loc === loc);
    const s = summarize(chs, atts);
    // national rank uses the server's per-location counts (all locations, no names)
    const nat = (M.d.coverage || []).filter(r => r[1] > 0);
    const covs = nat.map(r => ({ l: r[0], v: r[2] / r[1] })).sort((a, b) => b.v - a.v);
    const rank = covs.findIndex(x => x.l === loc) + 1;
    const natTot = nat.reduce((a, r) => [a[0] + r[1], a[1] + r[2]], [0, 0]);
    const natCov = natTot[0] ? natTot[1] / natTot[0] : null;
    const mods = moduleRows(chs, atts);
    const top = chs.filter(c => c.n > 0).sort((a, b) => b.mins - a.mins || b.n - a.n).slice(0, 10);
    const q = (S.ntSearch || '').toLowerCase();
    const never = chs.filter(c => c.n === 0 && (!q || c.name.toLowerCase().includes(q) || String(c.code).includes(q)));
    const rated = atts.filter(a => a.rating != null);
    const qRows = Q_LABELS.map((label, i) => {
      const v = atts.map(a => a.q[i]).filter(x => x !== '' && x != null);
      return { q: `Q${i + 1}. ${label}`, avg: v.length ? avg(v) : null, n: v.length, pos: v.length ? v.filter(x => x >= 4).length / v.length : null };
    });

    $('#main').innerHTML = `
      <div class="view-head"><div><h1>${esc(loc)}</h1><p class="muted">Location card · ${esc(M.fyLabel)}${rank ? ` · coverage rank <b>${rank}</b> of ${covs.length} locations` : ''}</p></div>
        ${M.locations.length > 1 ? `<div class="filters">${select('f-cloc', 'Location', M.locations, loc)}</div>` : ''}</div>
      ${kpis([
        { label: 'Total Chauffeurs', value: fmt(s.chauffeurs), sub: 'Effective ' + longDate(M.fyStart), go: ['chauffeurs', { loc, st: 'In FY scope' }] },
        { label: 'Unique', value: fmt(s.trained), sub: pct(s.trained, s.chauffeurs, 1) + ' coverage · target ' + fmt(fyElapsed() * 100, 1) + '%' + (natCov != null ? ` · PAN India ${pct(natTot[1], natTot[0], 1)}` : ''), cls: s.chauffeurs ? covStatus(s.trained / s.chauffeurs) : '', go: ['chauffeurs', { loc, st: 'Trained' }] },
        { label: 'Chauffeurs in Scope', value: fmt(s.never), sub: pct(s.never, s.chauffeurs, 1) + ' of chauffeurs', cls: s.never ? 'bad' : '', go: ['chauffeurs', { loc, st: 'Not trained' }] },
        { label: 'Attendees', value: fmt(s.attendances), sub: fmt(sessionsOf(atts)) + ' sessions', go: S.user.role === 'viewer' ? ['chauffeurs', { loc, st: 'Trained', sort: 'n' }] : ['entries', { loc, from: M.fyStart, to: M.fyEnd }] },
        { label: 'Manhours', value: fmt(s.hours, 1), sub: fmt(s.avgHours, 1) + ' per trained chauffeur', cls: 'hours', go: ['chauffeurs', { loc, st: 'Trained', sort: 'hrs' }] },
        { label: 'Feedback rating', value: s.rating == null ? '–' : fmt(s.rating, 2) + '<small class="of5">out of 5</small>', sub: `${fmt(s.responses)} responses (response rate ${pct(s.responses, s.attendances)})`, go: ['feedback', { loc }] }
      ])}
      <div class="grid-2">
        <section class="panel"><div class="panel-head"><h2>Module-wise</h2><p class="muted">% = share of this location's chauffeurs trained in the module</p></div>${table('lmod', [
          { key: 'module', label: 'Module' }, { key: 'att', label: 'Participants', n: 1, fmt: r => fmt(r.att) }, { key: 'people', label: 'Unique', n: 1, fmt: r => fmt(r.people) },
          { key: 'cov', label: '% covered', n: 1, fmt: r => covPill(r.cov) }, { key: 'hours', label: 'Manhours', n: 1, fmt: r => fmt(r.hours, 1) }
        ], mods, { sortKey: 'hours', sortDir: 'desc', rowAttr: r => 'class="click" ' + goAttr('chauffeurs', { loc, st: 'In FY scope', mod: 'not:' + r.module }), foot: ['Total', fmt(s.attendances), fmt(s.trained), pct(s.trained, s.chauffeurs, 1), fmt(s.hours, 1)] })}</section>
        <section class="panel"><div class="panel-head"><h2>Monthly trend</h2></div><div class="chart-box"><canvas id="c-lmonth"></canvas></div></section>
      </div>
      <div class="grid-2">
        <section class="panel"><div class="panel-head"><h2>L&amp;D team at ${esc(loc)}</h2></div>${table('ltrn', trainerCols, trainerRows(atts), { sortKey: 'att', sortDir: 'desc' })}</section>
        <section class="panel"><div class="panel-head"><h2>Top 10 by manhours</h2></div>${table('ltop', [
          { key: 'name', label: 'Chauffeur' }, { key: 'code', label: 'Code' }, { key: 'n', label: 'Trainings', n: 1 }, { key: 'mins', label: 'Manhours', n: 1, fmt: r => fmt(r.mins / 60, 1) }
        ], top, { sortKey: 'mins', sortDir: 'desc', rowAttr: r => `class="click" data-code="${esc(r.code)}"` })}</section>
      </div>
      <div class="grid-2">
        <section class="panel"><div class="panel-head"><h2>Not trained yet <span class="pill bad">${fmt(s.never)}</span></h2>
          <div class="field" style="width:220px"><input id="nt-search" placeholder="Search name or code" value="${esc(S.ntSearch || '')}"></div></div>
          ${table('lnever', [{ key: 'name', label: 'Chauffeur' }, { key: 'code', label: 'Code' }, { key: 'cat', label: 'Category' }, { key: 'type', label: 'Type' }, { key: 'doj', label: 'DOJ', fmt: r => dShort(r.doj) }],
            never, { tall: true, rowAttr: r => `class="click" data-code="${esc(r.code)}"` })}</section>
        <section class="panel"><div class="panel-head"><h2>Chauffeur feedback</h2><p class="muted">Ratings 1–5 · ${fmt(rated.length)} responses</p></div>${table('lq', [
          { key: 'q', label: 'Question' }, { key: 'avg', label: 'Avg', n: 1, fmt: r => scoreCell(r.avg) }, { key: 'n', label: 'Responses', n: 1 },
          { key: 'pos', label: '% 4–5', n: 1, fmt: r => (r.pos == null ? '–' : pct(r.pos, 1)) }
        ], qRows, { sortKey: 'q', sortDir: 'asc' })}</section>
      </div>`;
    if ($('#f-cloc')) $('#f-cloc').onchange = e => { S.ntSearch = ''; go('locations', { loc: e.target.value }); };
    const ns = $('#nt-search');
    ns.oninput = () => { S.ntSearch = ns.value; const pos = ns.selectionStart; render(); const n2 = $('#nt-search'); n2.focus(); n2.setSelectionRange(pos, pos); };
    $$('#main tr[data-code]').forEach(tr => tr.onclick = () => openChauffeur(tr.dataset.code));
    wireSort($('#main'), render);
    monthlyChart('c-lmonth', atts);
  }

  /* ---------------------------------------------------------------- Chauffeurs */
  // One row per chauffeur, like the Chauffeur Master sheet: master columns, FY training summary and a count per module.
  function masterRows() {
    const M = S.M, f = S.chf = S.chf || chfDefault();
    const q = f.q.trim().toLowerCase();
    const [mk, mn] = f.mod === 'All' ? ['', ''] : [f.mod.split(':')[0], f.mod.slice(f.mod.indexOf(':') + 1)];
    return M.chList.filter(c =>
      (f.loc === 'All' || c.loc === f.loc) && (f.cat === 'All' || c.cat === f.cat) && (f.type === 'All' || c.type === f.type) &&
      (!f.act || f.act === 'All' || (isActive(c) ? 'Active' : 'Inactive') === f.act) &&
      (f.st === 'All' || (f.st === 'In FY scope' ? c.inScope : f.st === 'Trained' ? c.n > 0 && c.inScope : f.st === 'Not trained' ? c.n === 0 && c.inScope : !c.inScope)) &&
      (!mk || (mk === 'done' ? (c.mods[mn] || 0) > 0 : !(c.mods[mn] > 0))) &&
      (f.inc === 'All' || (f.inc === 'With incidents' ? c.inc > 0 : c.inc === 0)) &&
      (!q || c.name.toLowerCase().includes(q) || String(c.code).toLowerCase().includes(q) || (c.mobile && c.mobile.includes(q))));
  }
  const ICON = {"dashboard":"<svg class=\"ico\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><rect x=\"3\" y=\"3\" width=\"7\" height=\"7\" rx=\"1.5\"/><rect x=\"14\" y=\"3\" width=\"7\" height=\"7\" rx=\"1.5\"/><rect x=\"3\" y=\"14\" width=\"7\" height=\"7\" rx=\"1.5\"/><rect x=\"14\" y=\"14\" width=\"7\" height=\"7\" rx=\"1.5\"/></svg>","locations":"<svg class=\"ico\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z\"/><circle cx=\"12\" cy=\"10\" r=\"2.5\"/></svg>","chauffeurs":"<svg class=\"ico\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><circle cx=\"9\" cy=\"8\" r=\"3.5\"/><path d=\"M2.5 20a6.5 6.5 0 0 1 13 0\"/><path d=\"M16 4.5a3.5 3.5 0 0 1 0 7\"/><path d=\"M18 14.5a6.5 6.5 0 0 1 3.5 5.5\"/></svg>","feedback":"<svg class=\"ico\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z\"/></svg>","add":"<svg class=\"ico\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 8v8M8 12h8\"/></svg>","entries":"<svg class=\"ico\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M8 6h13M8 12h13M8 18h13\"/><circle cx=\"3.5\" cy=\"6\" r=\"1\"/><circle cx=\"3.5\" cy=\"12\" r=\"1\"/><circle cx=\"3.5\" cy=\"18\" r=\"1\"/></svg>","admin":"<svg class=\"ico\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1\"/><circle cx=\"15\" cy=\"6\" r=\"2\"/><circle cx=\"9\" cy=\"12\" r=\"2\"/><circle cx=\"17\" cy=\"18\" r=\"2\"/></svg>","qr":"<svg class=\"ico\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><rect x=\"3\" y=\"3\" width=\"7\" height=\"7\" rx=\"1\"/><rect x=\"14\" y=\"3\" width=\"7\" height=\"7\" rx=\"1\"/><rect x=\"3\" y=\"14\" width=\"7\" height=\"7\" rx=\"1\"/><path d=\"M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3\"/></svg>"};
  const MOD_SHORT = { 'SMART Chauffeur Training': 'SMART', 'Defensive Driving Training': 'DD', 'Smart Chauffeur Induction': 'Induction', 'English Session': 'English',
    'Together In Diversity': 'Diversity', 'Grooming & Hygiene Standards': 'Grooming', 'First Aid Training': 'First Aid', 'Suraksha LMV Training - HE': 'Suraksha',
    'Smart Chauffeur Training Virtual': 'Virtual', 'Defensive Driving Training (Incident)': 'DD Incident', 'Respect First Chauffeur Code': 'Respect First' };
  const initials = n => String(n || '').replace(/[^A-Za-z ]/g, ' ').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
  const hue = n => { let h = 0; for (const ch of String(n)) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
  const modShort = n => MOD_SHORT[n] || n.split(/\s+/).slice(0, 2).join(' ');
  function masterMods() { const M = S.M; return M.modules.filter(m => m.active || M.fyAtt.some(a => a.module === m.name)); }
  function viewChauffeurs() {
    const M = S.M, f = S.chf = S.chf || chfDefault();
    const list = masterRows();
    const mods = masterMods();
    const today = Date.parse(todayIso());
    const rows = list.map(c => {
      const o = { code: c.code, name: c.name, loc: c.loc, mobile: c.mobile, type: c.type, act: isActive(c) ? 'Active' : 'Inactive', doj: c.doj, dol: c.dol, cat: c.cat, scope: c.inScope ? 'Yes' : 'No',
        n: c.n, first: c.first, last: c.last, days: c.last ? Math.round((today - Date.parse(c.last)) / 864e5) : null, hrs: c.mins / 60, c };
      M.extraCols.forEach((h, i) => { o['x' + i] = c.extra[i]; });
      mods.forEach((m, i) => { o['m' + i] = c.mods[m.name] || 0; });
      return o;
    });
    const inScope = list.filter(c => c.inScope), trained = inScope.filter(c => c.n > 0).length;
    const hasMob = M.chList.some(c => c.mobile);
    const shortX = h => h.replace(/duty\s*count/i, 'Duty').replace(/incidents?/i, 'Inc.').replace(/20(\d\d)-(\d\d)/, '$1-$2');
    const cols = [
      { key: 'code', label: 'Code' }, { key: 'name', label: 'Chauffeur', fmt: r => `<span class="av" style="--h:${hue(r.name)}">${esc(initials(r.name))}</span><span class="nm" title="${esc(r.name)}">${esc(r.name)}</span>` }, { key: 'loc', label: 'Location' }
    ].concat(hasMob ? [{ key: 'mobile', label: 'Mobile', cls: 'mono' }] : [], [
      { key: 'type', label: 'Type' },
      { key: 'act', label: 'Status', fmt: r => `<span class="dot ${r.act === 'Active' ? 'on' : 'off'}">${r.act}</span>` },
      { key: 'cat', label: 'Cat.', fmt: r => `<span class="cat cat-${esc(String(r.cat).replace('+', 'p').replace(/\s+/g, '').toLowerCase())}">${esc(r.cat === 'No Category' ? '–' : r.cat)}</span>` }, { key: 'doj', label: 'DOJ', fmt: r => dShort(r.doj) }, { key: 'dol', label: 'DOL', fmt: r => dShort(r.dol) }
    ], M.extraCols.map((h, i) => ({ key: 'x' + i, label: shortX(h), title: h, n: 1, cls: i === 0 ? 'grp' : '',
      fmt: r => (r['x' + i] == null ? '' : /incident/i.test(h) && r['x' + i] > 0 ? `<span class="pill bad">${esc(r['x' + i])}</span>` : typeof r['x' + i] === 'number' ? fmt(r['x' + i]) : esc(r['x' + i])) })), [
      { key: 'n', label: 'Trainings', title: 'Trainings this FY', n: 1, cls: 'grp', fmt: r => (r.n ? fmt(r.n) : r.c.inScope ? '<span class="pill bad">0</span>' : '0') },
      { key: 'first', label: 'First', title: 'First training this FY', fmt: r => dShort(r.first) }, { key: 'last', label: 'Last', title: 'Last training', fmt: r => dShort(r.last) },
      { key: 'days', label: 'Days', title: 'Days since last training', n: 1, fmt: r => (r.days == null ? '' : r.days > 180 ? `<span class="stale">${fmt(r.days)}</span>` : fmt(r.days)) },
      { key: 'hrs', label: 'Hrs', title: 'Manhours this FY', n: 1, fmt: r => (r.hrs ? fmt(r.hrs, 1) : '') }
    ], mods.map((m, i) => ({ key: 'm' + i, label: modShort(m.name), title: m.name + ' (times this FY)', n: 1, cls: i === 0 ? 'grp' : '', fmt: r => (r['m' + i] ? `<span class="mc">${r['m' + i]}</span>` : '') })));
    // summary cards filter the list below (other filters kept)
    const msGo = st => goAttr('chauffeurs', Object.assign({}, f, { st, sort: S.sort && S.sort.chs && S.sort.chs.key !== 'name' ? S.sort.chs.key : '' }));
    const limit = S.chLimit || 500;
    const canDl = S.user.role !== 'viewer';
    const modOpts = [['All', 'All modules']].concat(...mods.map(m => [['done:' + m.name, 'Done: ' + m.name], ['not:' + m.name, 'Not done: ' + m.name]]));
    $('#main').innerHTML = `
      <div class="view-head"><div><h1>Chauffeur Master</h1><p class="muted">${esc(M.fyLabel)} · module columns = times trained this FY</p></div>
        <div class="actions">${canDl ? '<button class="btn btn-sm" id="m-dl" type="button">Download this list</button>' : ''}<button class="btn btn-sm btn-ghost" id="m-reset" type="button">Clear filters</button></div></div>
      <div class="filters compact">
        <div class="field wide"><label for="f-q">Search</label><input id="f-q" placeholder="Name, code or mobile" value="${esc(f.q)}"></div>
        ${select('f-loc', 'Location', ['All'].concat(M.locations), f.loc)}
        ${select('f-act', 'Status', ['All', 'Active', 'Inactive'], f.act || 'All')}
        ${select('f-st', 'Training status', ['All', 'In FY scope', 'Trained', 'Not trained', 'Left before FY'], f.st)}
        ${select('f-cat', 'Category', ['All'].concat(CATS), f.cat)}
        ${select('f-type', 'Driver type', ['All'].concat(M.types), f.type)}
        ${select('f-mod', 'Module', modOpts, f.mod)}
        ${M.hasInc ? select('f-inc', 'Incidents', ['All', 'With incidents', 'No incidents'], f.inc) : ''}
      </div>
      <div class="mstats">
        <div class="ms link${f.st === 'All' ? ' on' : ''}" ${msGo('All')}><span class="ms-l">Chauffeurs ›</span><span class="ms-v">${fmt(list.length)}</span><span class="ms-s">${fmt(list.filter(isActive).length)} active</span></div>
        <div class="ms link${f.st === 'Trained' ? ' on' : ''}" ${msGo('Trained')}><span class="ms-l">Trained ›</span><span class="ms-v good">${fmt(trained)}</span><span class="ms-s">in FY scope</span></div>
        <div class="ms link${f.st === 'Not trained' ? ' on' : ''}" ${msGo('Not trained')}><span class="ms-l">Not trained ›</span><span class="ms-v bad">${fmt(inScope.length - trained)}</span><span class="ms-s">call for the next session</span></div>
        <div class="ms ms-wide link${f.st === 'In FY scope' ? ' on' : ''}" ${msGo('In FY scope')}><span class="ms-l">Coverage ›</span><span class="ms-v">${pct(trained, inScope.length, 1)}</span>
          <span class="ms-bar ${inScope.length ? covStatus(trained / inScope.length) : ''}"><i style="width:${inScope.length ? Math.round(trained / inScope.length * 100) : 0}%"></i><b style="left:${Math.round(fyElapsed() * 100)}%" title="Target by now"></b></span>
          <span class="ms-s">target ${fmt(fyElapsed() * 100, 0)}% by now${list.length - inScope.length ? ` · ${fmt(list.length - inScope.length)} left before FY` : ''}</span></div>
      </div>
      <section class="panel panel-flush">${table('chs', cols, rows, { limit, wrapCls: 'master', sortKey: 'name', rowAttr: r => `class="click${r.c.inScope ? '' : ' left'}" data-code="${esc(r.code)}"` })}
        ${rows.length > limit ? `<div class="actions" style="margin-top:8px"><button class="btn btn-sm" id="m-more" type="button">Show ${fmt(Math.min(500, rows.length - limit))} more</button></div>` : ''}</section>`;
    const fq = $('#f-q');
    fq.oninput = () => { f.q = fq.value; S.chLimit = 500; const p = fq.selectionStart; render(); const n = $('#f-q'); n.focus(); n.setSelectionRange(p, p); };
    ['loc', 'act', 'st', 'cat', 'type', 'mod', 'inc'].forEach(k => { const el = $('#f-' + k); if (el) el.onchange = e => { f[k] = e.target.value; S.chLimit = 500; render(); }; });
    $('#m-reset').onclick = () => go('chauffeurs', {});
    if ($('#m-more')) $('#m-more').onclick = () => { S.chLimit = limit + 500; render(); };
    if ($('#m-dl')) $('#m-dl').onclick = () => downloadMaster(cols, rows);
    $$('#main tr[data-code]').forEach(tr => tr.onclick = () => openChauffeur(tr.dataset.code));
    wireSort($('#main'), render);
  }
  // The filtered master as an Excel file (L&D, SPOC, admin; viewers cannot download)
  function downloadMaster(cols, rows) {
    if (S.user.role === 'viewer' || !window.XLSX) return;
    const st = (S.sort && S.sort.chs) || { key: 'name', dir: 'asc' };
    const sorted = rows.slice().sort((a, b) => { const x = a[st.key], y = b[st.key]; const r = (typeof x === 'number' || typeof y === 'number') ? (x ?? -Infinity) - (y ?? -Infinity) : String(x ?? '').localeCompare(String(y ?? ''), undefined, { numeric: true }); return st.dir === 'asc' ? r : -r; });
    const val = (r, k) => { const v = r[k]; if (k === 'hrs') return v ? Math.round(v * 10) / 10 : 0; return v == null ? '' : v; };
    const ws = XLSX.utils.aoa_to_sheet([cols.map(c => c.label)].concat(sorted.map(r => cols.map(c => val(r, c.key)))));
    ws['!cols'] = cols.map(c => ({ wch: c.key === 'name' ? 28 : Math.max(9, Math.min(22, c.label.length + 2)) }));
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: sorted.length, c: cols.length - 1 } }) };
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Chauffeur Master');
    XLSX.writeFile(wb, `Chauffeur_Master_${todayIso()}.xlsx`);
    toast('List downloaded');
  }

  function openDrawer(html) {
    $('#drawer').innerHTML = html; $('#drawer').hidden = false; $('#overlay').hidden = false; document.body.style.overflow = 'hidden';
    const c = $('#drawer [data-close]'); if (c) { c.onclick = closeDrawer; c.focus(); }
  }
  function closeDrawer() { $('#drawer').hidden = true; $('#overlay').hidden = true; document.body.style.overflow = ''; }

  function openChauffeur(code) {
    const M = S.M; const c = M.ch[code]; if (!c) return;
    const fyAtt = c.att.filter(a => a.inFY).sort((a, b) => b.date.localeCompare(a.date));
    const all = c.att.slice().sort((a, b) => b.date.localeCompare(a.date));
    const activeMods = M.modules.filter(m => m.active || c.mods[m.name]);
    openDrawer(`
      <div class="drawer-head"><div><h1>${esc(c.name)}</h1><p class="muted">Code ${esc(c.code)} · ${esc(c.loc)}</p></div><button class="btn" data-close type="button">Close</button></div>
      ${kpis([
        { label: 'Trainings', value: fmt(c.n), sub: M.fyLabel },
        { label: 'Manhours', value: fmt(c.mins / 60, 1), cls: 'hours' },
        { label: 'Modules done', value: `${Object.keys(c.mods).length} / ${M.modules.filter(m => m.active).length}` },
        { label: 'Last training', value: c.last ? dShort(c.last) : '–', sub: c.last ? Math.round((Date.now() - new Date(c.last).getTime()) / 864e5) + ' days ago' : 'Never trained', cls: c.last ? '' : 'bad' }
      ])}
      <section class="panel"><div class="dl">
        <div><span>Driver type</span><b>${esc(c.type)}</b></div><div><span>Category</span><b>${esc(c.cat)}</b></div>
        <div><span>Status</span><b>${esc(c.status || '-')}</b></div><div><span>Date of joining</span><b>${esc(dShort(c.doj) || '-')}</b></div>
        <div><span>Date of leaving</span><b>${esc(dShort(c.dol) || '-')}</b></div><div><span>In FY scope</span><b>${c.inScope ? 'Yes' : 'No (left before FY)'}</b></div>
        ${c.mobile ? `<div><span>Mobile</span><b>${esc(c.mobile)}</b></div>` : ''}
        ${M.extraCols.map((h, i) => `<div><span>${esc(h)}</span><b>${esc(c.extra[i] == null ? '-' : c.extra[i])}</b></div>`).join('')}
      </div></section>
      <section class="panel"><div class="panel-head"><h2>Modules</h2></div><div class="table-wrap"><table><thead><tr><th>Module</th><th>Status</th><th class="n">Times</th><th class="n">Manhours</th><th>Dates</th><th>L&amp;D</th></tr></thead><tbody>
        ${activeMods.map(m => {
          const l = fyAtt.filter(a => a.module === m.name);
          return `<tr><td>${esc(m.name)}</td><td>${l.length ? '<span class="pill good">Done</span>' : '<span class="pill warn">Pending</span>'}</td><td class="n">${l.length}</td><td class="n">${fmt(l.length * m.dur / 60, 1)}</td>
            <td>${esc(l.map(a => dShort(a.date)).reverse().join(', '))}</td><td>${esc(Array.from(new Set(l.map(a => a.trainer))).join(', '))}</td></tr>`;
        }).join('')}</tbody></table></div></section>
      <section class="panel"><div class="panel-head"><h2>Training history</h2><p class="muted">${all.length} record(s)</p></div><div class="table-wrap"><table><thead><tr><th>Date</th><th>Module</th><th>L&amp;D</th><th class="n">Feedback</th><th>Remarks</th></tr></thead><tbody>
        ${all.map(a => `<tr><td>${dShort(a.date)}</td><td>${esc(a.module)}</td><td>${esc(a.trainer)}</td><td class="n">${scoreCell(a.rating)}</td><td>${esc(a.remarks)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No training recorded.</td></tr>'}
      </tbody></table></div></section>`);
  }

  /* ---------------------------------------------------------------- Feedback */
  function viewFeedback() {
    const M = S.M;
    const f = S.fbf = S.fbf || { loc: 'All', tr: 'All', mod: 'All' };
    const base = M.fyAtt.filter(a => (f.loc === 'All' || a.loc === f.loc) && (f.tr === 'All' || a.trainer === f.tr) && (f.mod === 'All' || a.module === f.mod));
    const rated = base.filter(a => a.rating != null);
    const q7 = rated.map(a => a.q[6]).filter(x => x !== '' && x != null);
    const low = rated.filter(a => a.rating <= 2.5).sort((a, b) => b.date.localeCompare(a.date));
    const qRows = Q_LABELS.map((label, i) => {
      const v = base.map(a => a.q[i]).filter(x => x !== '' && x != null);
      const dist = [5, 4, 3, 2, 1].map(k => v.filter(x => x === k).length);
      return { q: `Q${i + 1}. ${label}`, avg: v.length ? avg(v) : null, n: v.length, d5: dist[0], d4: dist[1], d3: dist[2], d2: dist[3], d1: dist[4], pos: v.length ? (dist[0] + dist[1]) / v.length : null };
    });
    const brk = (key, filterOut) => Array.from(groupBy(M.fyAtt.filter(a => (filterOut !== 'loc' ? (f.loc === 'All' || a.loc === f.loc) : true) && (filterOut !== 'tr' ? (f.tr === 'All' || a.trainer === f.tr) : true) && (filterOut !== 'mod' ? (f.mod === 'All' || a.module === f.mod) : true)), a => a[key]))
      .map(([k, list]) => { const r = list.filter(a => a.rating != null); const o = r.map(a => a.q[6]).filter(x => x !== '' && x != null);
        return { k, att: list.length, n: r.length, rate: list.length ? r.length / list.length : 0, avg: r.length ? avg(r.map(a => a.rating)) : null, q7: o.length ? avg(o) : null, pos: r.length ? r.filter(a => a.rating >= 4).length / r.length : null }; });
    const bCols = label => [
      { key: 'k', label }, { key: 'att', label: 'Attendees', n: 1, fmt: r => fmt(r.att) }, { key: 'n', label: 'Responses', n: 1, fmt: r => fmt(r.n) },
      { key: 'rate', label: 'Resp. rate', n: 1, fmt: r => pctv(r.rate) }, { key: 'avg', label: 'Avg', n: 1, fmt: r => scoreCell(r.avg) },
      { key: 'q7', label: 'Overall (Q7)', n: 1, fmt: r => scoreCell(r.q7) }, { key: 'pos', label: '% positive', n: 1, fmt: r => pctv(r.pos) }];

    $('#main').innerHTML = `
      <div class="view-head"><div><h1>Training Feedback</h1><p class="muted">Chauffeur ratings, 1 (poor) to 5 (excellent) · ${esc(M.fyLabel)}</p></div>
        <div class="filters">${select('fb-loc', 'Location', ['All'].concat(M.locations), f.loc)}${select('fb-tr', 'L&D', ['All'].concat(M.trainerNames), f.tr)}${select('fb-mod', 'Module', ['All'].concat(M.modules.map(m => m.name)), f.mod)}</div></div>
      ${kpis([
        { label: 'Responses', value: fmt(rated.length), sub: pct(rated.length, base.length) + ' of ' + fmt(base.length) + ' attendees' },
        { label: 'Average rating', value: rated.length ? fmt(avg(rated.map(a => a.rating)), 2) : '–', sub: 'all ' + Q_LABELS.length + ' questions' },
        { label: 'Overall experience', value: q7.length ? fmt(avg(q7), 2) : '–', sub: 'Q7' },
        { label: 'Positive', value: rated.length ? pct(rated.filter(a => a.rating >= 4).length, rated.length) : '–', sub: 'average 4 or more', cls: 'good' },
        { label: 'Low ratings', value: fmt(low.length), sub: 'average 2.5 or less', cls: low.length ? 'bad' : '' }
      ])}
      <div class="grid-2">
        <section class="panel"><div class="panel-head"><h2>By question</h2></div>${table('fq', [
          { key: 'q', label: 'Question' }, { key: 'avg', label: 'Avg', n: 1, fmt: r => scoreCell(r.avg) },
          { key: 'd5', label: '5', n: 1 }, { key: 'd4', label: '4', n: 1 }, { key: 'd3', label: '3', n: 1 }, { key: 'd2', label: '2', n: 1 }, { key: 'd1', label: '1', n: 1 },
          { key: 'pos', label: '% 4–5', n: 1, fmt: r => pctv(r.pos) }], qRows, { sortKey: 'q' })}</section>
        <section class="panel"><div class="panel-head"><h2>Average by question</h2></div><div class="chart-box"><canvas id="c-fq"></canvas></div></section>
      </div>
      <section class="panel"><div class="panel-head"><h2>By L&amp;D</h2><p class="muted">Location and module filters apply</p></div>${table('ftr', bCols('L&D'), brk('trainer', 'tr'), { sortKey: 'n', sortDir: 'desc' })}
        <p class="note">Averages from only a few responses are not reliable; check the Responses column.</p></section>
      <div class="grid-2">
        <section class="panel"><div class="panel-head"><h2>By module</h2></div>${table('fmo', bCols('Module'), brk('module', 'mod'), { sortKey: 'n', sortDir: 'desc' })}</section>
        <section class="panel"><div class="panel-head"><h2>By location</h2></div>${table('flo', bCols('Location'), brk('loc', 'loc'), { sortKey: 'n', sortDir: 'desc', tall: true })}</section>
      </div>
      <section class="panel"><div class="panel-head"><h2>Low ratings to follow up <span class="pill bad">${low.length}</span></h2></div>${table('flow', [
        { key: 'date', label: 'Date', fmt: r => dShort(r.date) }, { key: 'nm', label: 'Chauffeur' }, { key: 'loc', label: 'Location' }, { key: 'module', label: 'Module' },
        { key: 'trainer', label: 'L&D' }, { key: 'rating', label: 'Avg', n: 1, fmt: r => scoreCell(r.rating) }, { key: 'remarks', label: 'Remarks' }
      ], low.map(a => Object.assign({ nm: a.c ? a.c.name : a.code }, a)), { sortKey: 'date', sortDir: 'desc', tall: true, rowAttr: r => `class="click" data-code="${esc(r.code)}"` })}</section>`;
    $('#fb-loc').onchange = e => { f.loc = e.target.value; render(); };
    $('#fb-tr').onchange = e => { f.tr = e.target.value; render(); };
    $('#fb-mod').onchange = e => { f.mod = e.target.value; render(); };
    $$('#main tr[data-code]').forEach(tr => tr.onclick = () => openChauffeur(tr.dataset.code));
    wireSort($('#main'), render);
    hbarChart('c-fq', qRows.map((r, i) => 'Q' + (i + 1)), qRows.map(r => (r.avg == null ? 0 : +r.avg.toFixed(2))), cssVar('--accent'), 'Average', { max: 5 });
  }

  /* ---------------------------------------------------------------- Add training */
  function loadDraft() {
    try { return JSON.parse(store.get(LS.draft) || 'null') || null; } catch (e) { return null; }
  }
  function saveDraft() { store.set(LS.draft, JSON.stringify(S.draft)); }

  function viewAdd() {
    const M = S.M; const me = S.user;
    const activeMods = M.modules.filter(m => m.active);
    S.draft = S.draft || loadDraft() || { date: todayIso(), module: activeMods[0] ? activeMods[0].name : '', trainer: me.name, loc: 'All', remarks: '', people: [] };
    const D = S.draft;
    D.unk = D.unk || []; // codes not in the master, kept aside on save
    const total = D.people.length + D.unk.length;
    if (!activeMods.some(m => m.name === D.module)) D.module = activeMods[0] ? activeMods[0].name : '';
    const existing = new Set(M.att.filter(a => a.date === D.date && a.module === D.module).map(a => a.code));
    const dupCount = D.people.filter(p => existing.has(p.code)).length;

    $('#main').innerHTML = `
      <div class="view-head"><div><h1>Add training</h1><p class="muted">One entry = one session: same date, module and L&amp;D for every chauffeur you add.</p></div></div>
      <section class="panel">
        <div class="form-grid">
          <div class="field"><label for="a-date">Training date</label><input type="date" id="a-date" value="${esc(D.date)}" max="${todayIso()}"></div>
          ${select('a-mod', 'Training module', activeMods.map(m => [m.name, `${m.name} (${m.dur} min)`]), D.module)}
          ${me.role === 'admin' || me.role === 'spoc' ? select('a-tr', 'L&D', M.trainerOptions.includes(D.trainer) ? M.trainerOptions : [D.trainer].concat(M.trainerOptions), D.trainer) : `<div class="field"><label>L&amp;D</label><input value="${esc(me.name)}" disabled></div>`}
          ${select('a-loc', 'Location (narrows the search)', ['All'].concat(M.locations), D.loc)}
        </div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Chauffeurs attended <span class="pill neutral">${D.people.length}</span></h2>
          <div class="actions"><button class="btn btn-sm" id="a-upload-btn" type="button">Upload Excel / CSV</button><input type="file" id="a-file" accept=".xlsx,.xls,.csv" hidden><button class="btn btn-sm btn-ghost" id="a-template" type="button">Download template</button><button class="btn btn-sm" id="a-paste-btn" type="button">Paste many codes</button>${total ? '<button class="btn btn-sm btn-danger" id="a-clear" type="button">Clear list</button>' : ''}</div></div>
        <div id="a-upload-msg"></div>
        <div class="field picker"><label for="a-search">Add chauffeur</label><input id="a-search" placeholder="Type a name or code…" autocomplete="off"><div class="suggest" id="a-suggest" hidden></div></div>
        <div id="a-paste" hidden style="margin-top:10px" class="field"><label for="a-paste-text">Paste codes (comma, space or one per line)</label><textarea id="a-paste-text" placeholder="16628, 19538, 3530"></textarea><div class="actions"><button class="btn btn-sm btn-primary" id="a-paste-add" type="button">Add these codes</button><span id="a-paste-msg" class="muted"></span></div></div>
        ${dupCount ? `<p class="warn-box" style="margin-top:10px">${dupCount} chauffeur(s) below already have <b>${esc(D.module)}</b> on ${dShort(D.date)}. They will be skipped when you save.</p>` : ''}
        ${D.unk.length ? `<div class="warn-box" style="margin-top:12px"><b>Not in master (${D.unk.length})</b>: ${D.unk.map((u, i) => `<span class="pill neutral">${esc(u.code)}${u.name ? ' · ' + esc(u.name) : ''} <button type="button" class="x" data-unk="${i}" aria-label="Remove">×</button></span>`).join(' ')}
          <br><span class="muted">Saved to <b>Not in Master</b>, not counted; they move into the counts once these chauffeurs are added to the master.</span></div>` : ''}
        <div class="picked" style="margin-top:12px">${D.people.map((p, i) => {
          const c = M.ch[p.code]; const open = p.open;
          const filled = (p.q || []).filter(Boolean).length;
          return `<div class="picked-row">
            <div class="picked-top"><div class="who"><b>${esc(c ? c.name : p.code)}</b> <span class="muted">· ${esc(p.code)} · ${esc(c ? c.loc : '')}</span>${existing.has(p.code) ? ' <span class="pill warn">already recorded</span>' : ''}</div>
              <button class="btn btn-sm" data-rate="${i}" type="button">${open ? 'Hide feedback' : filled ? `Feedback (${filled}/${Q_LABELS.length})` : 'Add feedback'}</button>
              <button class="btn btn-sm btn-danger" data-rm="${i}" type="button" aria-label="Remove">Remove</button></div>
            ${open ? `<div class="ratings">${Q_LABELS.map((ql, k) => `<div class="rq"><span>Q${k + 1}. ${esc(ql)}</span><span class="seg">${[1, 2, 3, 4, 5].map(v => `<button type="button" data-q="${i}:${k}:${v}" class="${(p.q || [])[k] === v ? 'on' : ''}">${v}</button>`).join('')}</span></div>`).join('')}
              <div class="actions"><button class="btn btn-sm" data-qall="${i}:5" type="button">All 5</button><button class="btn btn-sm" data-qall="${i}:4" type="button">All 4</button><button class="btn btn-sm" data-qall="${i}:0" type="button">Clear</button></div></div>` : ''}
          </div>`;
        }).join('') || '<div class="empty">No chauffeurs added yet. Search above, or paste a list of codes.</div>'}</div>
      </section>
      <section class="panel">
        <div class="field"><label for="a-rem">Remarks (optional)</label><input id="a-rem" value="${esc(D.remarks)}" placeholder="Batch, venue or notes"></div>
        <div class="actions" style="margin-top:12px"><button class="btn btn-primary" id="a-save" type="button"${total ? '' : ' disabled'}>Save ${total} attendance${total === 1 ? '' : 's'}</button><span id="a-msg" class="muted">Your list is kept on this device until you save.</span></div>
        <div id="a-result"></div>
      </section>`;

    const upd = (k, v) => { D[k] = v; saveDraft(); };
    $('#a-date').onchange = e => { upd('date', e.target.value); render(); };
    $('#a-mod').onchange = e => { upd('module', e.target.value); render(); };
    if ($('#a-tr')) $('#a-tr').onchange = e => upd('trainer', e.target.value);
    $('#a-loc').onchange = e => upd('loc', e.target.value);
    $('#a-rem').oninput = e => upd('remarks', e.target.value);
    const addCode = code => { if (!D.people.some(p => p.code === code)) D.people.push({ code, q: [], open: false }); saveDraft(); };

    // search
    const inp = $('#a-search'), box = $('#a-suggest');
    let hits = [], hl = 0;
    const draw = () => {
      if (!hits.length) { box.hidden = true; return; }
      box.innerHTML = hits.map((c, i) => `<button type="button" data-code="${esc(c.code)}" class="${i === hl ? 'hl' : ''}"><span><b>${esc(c.name)}</b> <span class="muted">${esc(c.code)}</span></span><span class="muted">${esc(c.loc)}${c.n ? '' : ' · not trained'}</span></button>`).join('');
      box.hidden = false;
      $$('button', box).forEach(b => b.onmousedown = ev => { ev.preventDefault(); addCode(b.dataset.code); render(); setTimeout(() => $('#a-search').focus(), 0); });
    };
    inp.oninput = () => {
      const q = inp.value.trim().toLowerCase(); hl = 0;
      if (q.length < 2 && !/^\d+$/.test(q)) { hits = []; return draw(); }
      const pool = M.chList.filter(c => c.inScope && !D.people.some(p => p.code === c.code));
      hits = pool.filter(c => (D.loc === 'All' || c.loc === D.loc) && (String(c.code).toLowerCase().startsWith(q) || c.name.toLowerCase().includes(q))).slice(0, 12);
      if (hits.length < 4 && D.loc !== 'All') hits = hits.concat(pool.filter(c => c.loc !== D.loc && (String(c.code).toLowerCase().startsWith(q) || c.name.toLowerCase().includes(q))).slice(0, 6));
      draw();
    };
    inp.onkeydown = e => {
      if (e.key === 'ArrowDown') { hl = Math.min(hl + 1, hits.length - 1); draw(); e.preventDefault(); }
      if (e.key === 'ArrowUp') { hl = Math.max(hl - 1, 0); draw(); e.preventDefault(); }
      if (e.key === 'Enter' && hits[hl]) { e.preventDefault(); addCode(hits[hl].code); render(); setTimeout(() => $('#a-search').focus(), 0); }
    };
    inp.onblur = () => setTimeout(() => { box.hidden = true; }, 150);

    // Upload: first sheet; the code column is the one whose header mentions "code" or "ID" (else column A).
    // Optional rating columns headed Q1..Q8 are read too. "NAME__12345" style IDs are understood.
    $('#a-upload-btn').onclick = () => $('#a-file').click();
    $('#a-template').onclick = () => {
      if (!window.XLSX) return toast('Please wait a moment and try again.');
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([['Chauffeur Code', 'Chauffeur Name (optional)'].concat(Q_LABELS.map((q, i) => `Q${i + 1} ${q} (1-5, optional)`)), [16628, 'AVDHESH A JHA', 5, 5, 4, 5, 5, 4, 5, 5]]);
      ws['!cols'] = [{ wch: 15 }, { wch: 26 }].concat(Q_LABELS.map(() => ({ wch: 14 })));
      XLSX.utils.book_append_sheet(wb, ws, 'Attendance');
      XLSX.writeFile(wb, 'Training_Attendance_Template.xlsx');
    };
    $('#a-file').onchange = async e => {
      const file = e.target.files[0]; e.target.value = '';
      if (!file) return;
      if (!window.XLSX) return toast('Please wait a moment and try again.');
      try {
        const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
        const isCode = c => /code/i.test(c), isId = c => /(^|[^a-z])id([^a-z]|$)/i.test(c);
        let hdr = rows.findIndex(r => r.some(c => isCode(String(c)) || isId(String(c))));
        let codeCol = 0; const qCols = {};
        if (hdr >= 0) {
          const h = rows[hdr].map(c => String(c).trim());
          codeCol = h.findIndex(isCode);
          if (codeCol < 0) codeCol = Math.max(0, h.findIndex(isId));
          h.forEach((c, i) => { const m = c.match(/^q\s*([1-8])\b/i); if (m) qCols[+m[1] - 1] = i; });
        }
        const data = rows.slice(hdr + 1);
        const bad = []; let added = 0, already = 0;
        data.forEach(r => {
          let raw = String(r[codeCol] == null ? '' : r[codeCol]).trim();
          if (!raw) return;
          if (raw.includes('__')) raw = raw.split('__').pop().trim();
          const code = /^\d+(\.0+)?$/.test(raw) ? String(parseInt(raw, 10)) : raw.toUpperCase();
          if (!M.ch[code]) { bad.push(raw); return; }
          if (D.people.some(p => p.code === code)) { already++; return; }
          const q = []; Object.keys(qCols).forEach(k => { const v = Number(r[qCols[k]]); if (v >= 1 && v <= 5 && Math.round(v) === v) q[k] = v; });
          D.people.push({ code, q, open: false }); added++;
        });
        saveDraft(); render();
        $('#a-upload-msg').innerHTML = `<p class="${bad.length ? 'warn-box' : 'ok-box'}" style="margin-top:10px">From <b>${esc(file.name)}</b>: added ${added} chauffeur(s)${Object.keys(qCols).length ? ' with their ratings' : ''}${already ? `, ${already} already in the list` : ''}.${bad.length ? ` <b>${bad.length} code(s) not in the master</b>: ${esc(bad.slice(0, 20).join(', '))}${bad.length > 20 ? '…' : ''} <button class="btn btn-sm" id="a-keep" type="button">Keep them as Not in master</button>` : ''}</p>`;
        if ($('#a-keep')) $('#a-keep').onclick = () => { bad.forEach(c => { const k = /^\d+(\.0+)?$/.test(c) ? String(parseInt(c, 10)) : c.toUpperCase(); if (!D.unk.some(u => u.code === k)) D.unk.push({ code: k, name: '' }); }); saveDraft(); render(); };
      } catch (err) {
        $('#a-upload-msg').innerHTML = `<p class="form-error">Could not read that file. Use .xlsx, .xls or .csv with a "Chauffeur Code" column.</p>`;
      }
    };

    $('#a-paste-btn').onclick = () => { $('#a-paste').hidden = !$('#a-paste').hidden; if (!$('#a-paste').hidden) $('#a-paste-text').focus(); };
    $('#a-paste-add').onclick = () => {
      const codes = $('#a-paste-text').value.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean).map(s => (/^\d+$/.test(s) ? String(parseInt(s, 10)) : s.toUpperCase()));
      const bad = []; let n = 0;
      codes.forEach(c => { if (M.ch[c]) { if (!D.people.some(p => p.code === c)) { addCode(c); n++; } } else bad.push(c); });
      render();
      if (bad.length) { $('#a-paste').hidden = false; $('#a-paste-text').value = bad.join(', '); $('#a-paste-msg').innerHTML = `Added ${n}. Not in the master: ${bad.length} code(s) left in the box. <button class="btn btn-sm" id="a-keep2" type="button">Keep them as Not in master</button>`;
        $('#a-keep2').onclick = () => { bad.forEach(c => { if (!D.unk.some(u => u.code === c)) D.unk.push({ code: c, name: '' }); }); saveDraft(); render(); }; }
      else toast(`Added ${n} chauffeur(s)`);
    };
    if ($('#a-clear')) $('#a-clear').onclick = () => { D.people = []; D.unk = []; saveDraft(); render(); };
    $$('[data-unk]').forEach(b => b.onclick = () => { D.unk.splice(+b.dataset.unk, 1); saveDraft(); render(); });
    $$('[data-rm]').forEach(b => b.onclick = () => { D.people.splice(+b.dataset.rm, 1); saveDraft(); render(); });
    $$('[data-rate]').forEach(b => b.onclick = () => { const p = D.people[+b.dataset.rate]; p.open = !p.open; saveDraft(); render(); });
    $$('[data-q]').forEach(b => b.onclick = () => { const [i, k, v] = b.dataset.q.split(':').map(Number); const p = D.people[i]; p.q = p.q || []; p.q[k] = p.q[k] === v ? 0 : v; saveDraft(); render(); });
    $$('[data-qall]').forEach(b => b.onclick = () => { const [i, v] = b.dataset.qall.split(':').map(Number); D.people[i].q = v ? Array(Q_LABELS.length).fill(v) : []; saveDraft(); render(); });

    $('#a-save').onclick = async () => {
      const btn = $('#a-save'); btn.disabled = true; btn.textContent = 'Saving…';
      try {
        const out = await api('addTraining', { date: D.date, module: D.module, trainer: D.trainer, remarks: D.remarks, entries: D.people.map(p => ({ code: p.code, q: (p.q || []).map(v => v || '') })).concat(D.unk.map(u => ({ code: u.code, name: u.name, q: [] }))) });
        S.draft = { date: D.date, module: D.module, trainer: D.trainer, loc: D.loc, remarks: '', people: [], unk: [] }; saveDraft();
        await load(true); render();
        $('#a-result').innerHTML = `<p class="ok-box" style="margin-top:12px">Saved <b>${out.added.length}</b> attendance(s) for ${esc(D.module)} on ${dShort(D.date)}.${(out.pending || []).length ? ` <b>${out.pending.length}</b> kept in Not in Master (not counted until added to the master).` : ''}${out.feedbackAttached ? ` ${out.feedbackAttached} chauffeur feedback(s) received earlier were attached.` : ''}${out.duplicates.length ? ` Skipped ${out.duplicates.length} already recorded.` : ''}${out.unknown.length ? ` Not saved (code not found${S.user.role === 'spoc' ? ' or outside your locations' : ''}): ${esc(out.unknown.join(', '))}.` : ''}</p>${(out.ids || []).length ? `<div class="actions" style="margin-top:10px"><button class="btn btn-primary" id="a-fb" type="button">Collect feedback for this session (QR / WhatsApp)</button></div>` : ''}`;
        if ($('#a-fb')) $('#a-fb').onclick = () => collectFeedback(out.ids);
        toast('Training saved');
      } catch (err) {
        if (err.message !== 'AUTH') { btn.disabled = false; btn.textContent = 'Save'; $('#a-msg').innerHTML = `<span class="form-error">${esc(err.message)}</span>`; }
      }
    };
  }

  /* ---------------------------------------------------------------- Entries */
  function viewEntries() {
    const M = S.M; const me = S.user;
    const f = S.enf = S.enf || { from: '', to: '', tr: 'All', mod: 'All', loc: 'All', mine: me.role !== 'admin', q: '' };
    if (!f.loc) f.loc = 'All';
    const q = f.q.trim().toLowerCase();
    const rows = M.att.filter(a => (!f.from || a.date >= f.from) && (!f.to || a.date <= f.to) && (f.tr === 'All' || a.trainer === f.tr) && (f.mod === 'All' || a.module === f.mod) && (f.loc === 'All' || a.loc === f.loc) && (!f.mine || a.mine) &&
      (!q || String(a.code).toLowerCase().includes(q) || (a.c && a.c.name.toLowerCase().includes(q)))).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
    // editable: admin any; others entries they made or that carry their name (server re-checks, incl. SPOC locations)
    const canDel = a => me.role === 'admin' || a.mine || a.trainer.toLowerCase() === me.name.toLowerCase();
    const shown = rows.slice(0, 400);
    S.sel = S.sel || new Set();
    $('#main').innerHTML = `
      <div class="view-head"><div><h1>Entries</h1><p class="muted">${fmt(rows.length)} record(s). ${me.role === 'admin' ? 'As admin you can edit or delete any entry.' : 'Tick entries you made or that carry your name to edit them; you can delete entries you made.'}</p></div></div>
      <section class="panel" id="bulk-panel">
        <div class="panel-head"><h2>Bulk upload (Excel or CSV)</h2><p class="muted">Many sessions in one file: each row = one chauffeur in one session</p></div>
        <div class="actions"><button class="btn btn-primary btn-sm" id="b-pick" type="button">Choose file</button><input type="file" id="b-file" accept=".xlsx,.xls,.csv" hidden><button class="btn btn-sm btn-ghost" id="b-template" type="button">Download template</button>
          <span class="muted">Columns: Date, Chauffeur Code, Module, L&amp;D${me.role === 'trainer' ? ' (ignored: your name is used)' : ''}, Remarks, Q1–Q7 (optional), Chauffeur Name (only for codes not in master)</span></div>
        <div id="b-out"></div>
      </section>
      ${M.pending.length ? `<section class="panel" id="pend-panel"><div class="panel-head"><h2>Not in master <span class="pill warn">${M.pending.length}</span></h2><p class="muted">Not counted until the chauffeur is added to the master${me.role === 'admin' ? ' (Admin → Add or edit a chauffeur, or the weekly master)' : ' – ask the admin to add them'}; they then move into the counts automatically.</p></div>
        <div class="table-wrap tall"><table><thead><tr><th></th><th>Date</th><th>Code</th><th>Name</th><th>Module</th><th>L&amp;D</th><th>Remarks</th>${me.role === 'admin' ? '<th>Entered by</th>' : ''}</tr></thead><tbody>
        ${M.pending.map(p => `<tr><td><input type="checkbox" data-pid="${esc(p.id)}" style="width:auto" aria-label="Select"></td><td>${dShort(p.date)}</td><td><b>${esc(p.code)}</b></td><td>${esc(p.name || '–')}</td><td>${esc(p.module)}</td><td>${esc(p.trainer)}</td><td>${esc(p.remarks)}</td>${me.role === 'admin' ? `<td class="muted">${esc(p.by)}</td>` : ''}</tr>`).join('')}
        </tbody></table></div>
        <div class="actions" style="margin-top:8px"><button class="btn btn-sm btn-danger" id="pend-dis" type="button" disabled>Dismiss selected</button><span id="pend-msg"></span></div></section>` : ''}
      <div class="filters">
        <div class="field" style="width:150px"><label for="e-from">From</label><input type="date" id="e-from" value="${esc(f.from)}"></div>
        <div class="field" style="width:150px"><label for="e-to">To</label><input type="date" id="e-to" value="${esc(f.to)}"></div>
        ${select('e-tr', 'L&D', ['All'].concat(M.trainerNames), f.tr)}
        ${select('e-mod', 'Module', ['All'].concat(M.modules.map(m => m.name)), f.mod)}
        ${select('e-loc', 'Location', ['All'].concat(M.locations), f.loc)}
        <div class="field" style="width:200px"><label for="e-q">Chauffeur</label><input id="e-q" placeholder="Name or code" value="${esc(f.q)}"></div>
        <label style="display:flex;gap:6px;align-items:center;padding-bottom:.5rem"><input type="checkbox" id="e-mine" style="width:auto"${f.mine ? ' checked' : ''}> Only my entries</label>
      </div>
      <section class="panel">
        <div class="actions" style="margin-bottom:10px"><button class="btn btn-sm btn-primary" id="e-fb" type="button" disabled>Collect feedback</button><button class="btn btn-sm" id="e-edit" type="button" disabled>Edit selected</button><button class="btn btn-sm btn-danger" id="e-del" type="button" disabled>Delete selected</button><span id="e-confirm"></span></div>
        <div id="e-editbox"></div>
        <div class="table-wrap tall"><table><thead><tr><th></th><th>Date</th><th>Chauffeur</th><th>Code</th><th>Location</th><th>Module</th><th>L&amp;D</th><th class="n">Feedback</th><th>Remarks</th></tr></thead><tbody>
        ${shown.map(a => `<tr><td>${canDel(a) ? `<input type="checkbox" data-id="${esc(a.id)}" style="width:auto"${S.sel.has(a.id) ? ' checked' : ''} aria-label="Select">` : ''}</td><td>${dShort(a.date)}</td><td>${esc(a.c ? a.c.name : '?')}</td><td>${esc(a.code)}</td><td>${esc(a.loc)}</td><td>${esc(a.module)}</td><td>${esc(a.trainer)}</td><td class="n">${scoreCell(a.rating)}</td><td>${esc(a.remarks)}</td></tr>`).join('') || '<tr><td colspan="9" class="muted">No entries match.</td></tr>'}
        </tbody></table></div>${rows.length > 400 ? '<p class="note">Showing the newest 400. Narrow with filters to see older ones.</p>' : ''}
      </section>`;
    const set = (k, v) => { f[k] = v; S.sel.clear(); render(); };
    $('#e-from').onchange = e => set('from', e.target.value);
    $('#e-to').onchange = e => set('to', e.target.value);
    $('#e-tr').onchange = e => set('tr', e.target.value);
    $('#e-mod').onchange = e => set('mod', e.target.value);
    $('#e-loc').onchange = e => set('loc', e.target.value);
    $('#e-mine').onchange = e => set('mine', e.target.checked);
    const eq = $('#e-q'); eq.oninput = () => { f.q = eq.value; const p = eq.selectionStart; render(); const n = $('#e-q'); n.focus(); n.setSelectionRange(p, p); };
    const delBtn = $('#e-del');
    const editBtn = $('#e-edit');
    const fbBtn = $('#e-fb');
    fbBtn.onclick = () => collectFeedback(Array.from(S.sel));
    const sync = () => { delBtn.disabled = editBtn.disabled = fbBtn.disabled = !S.sel.size; delBtn.textContent = S.sel.size ? `Delete ${S.sel.size} selected` : 'Delete selected'; editBtn.textContent = S.sel.size ? `Edit ${S.sel.size} selected` : 'Edit selected'; $('#e-confirm').innerHTML = ''; };
    $$('input[data-id]').forEach(cb => cb.onchange = () => { cb.checked ? S.sel.add(cb.dataset.id) : S.sel.delete(cb.dataset.id); sync(); });
    sync();
    editBtn.onclick = () => {
      const keep = '__keep__';
      const box = $('#e-editbox');
      box.innerHTML = `<div class="panel" style="background:var(--surface-2);margin-bottom:12px">
        <h3>Edit ${S.sel.size} selected entr${S.sel.size === 1 ? 'y' : 'ies'}</h3><p class="note" style="margin-top:2px">Only the fields you change are updated. The chauffeur stays the same.</p>
        <div class="form-grid" style="margin-top:10px">
          ${select('ed-tr', 'L&D', [[keep, '(keep as is)']].concat(M.trainerOptions.map(t => [t, t])), keep)}
          ${select('ed-mod', 'Module', [[keep, '(keep as is)']].concat(M.modules.filter(m => m.active).map(m => [m.name, m.name])), keep)}
          <div class="field"><label for="ed-date">Date (leave empty to keep)</label><input type="date" id="ed-date" max="${todayIso()}"></div>
          <div class="field"><label for="ed-rem">Remarks</label><input id="ed-rem" placeholder="(keep as is)"></div>
        </div>
        <label style="display:flex;gap:6px;align-items:center;margin-top:8px"><input type="checkbox" id="ed-remclear" style="width:auto"> Clear remarks</label>
        <div class="actions" style="margin-top:10px"><button class="btn btn-primary" id="ed-save" type="button">Save changes</button><button class="btn" id="ed-cancel" type="button">Cancel</button><span id="ed-msg"></span></div></div>`;
      $('#ed-cancel').onclick = () => { box.innerHTML = ''; };
      $('#ed-save').onclick = async () => {
        const changes = {};
        if ($('#ed-tr').value !== keep) changes.trainer = $('#ed-tr').value;
        if ($('#ed-mod').value !== keep) changes.module = $('#ed-mod').value;
        if ($('#ed-date').value) changes.date = $('#ed-date').value;
        if ($('#ed-remclear').checked) changes.remarks = ''; else if ($('#ed-rem').value.trim()) changes.remarks = $('#ed-rem').value.trim();
        if (!Object.keys(changes).length) { $('#ed-msg').innerHTML = '<span class="form-error">Change at least one field.</span>'; return; }
        const btn = $('#ed-save'); btn.disabled = true; btn.textContent = 'Saving…';
        try {
          const out = await api('updateEntries', { ids: Array.from(S.sel), changes });
          S.sel.clear(); await load(true); render();
          toast(`Updated ${out.updated} entr${out.updated === 1 ? 'y' : 'ies'}${out.duplicates ? `, ${out.duplicates} skipped (would duplicate)` : ''}${out.refused ? `, ${out.refused} not allowed` : ''}`, 5000);
        } catch (err) { if (err.message !== 'AUTH') { btn.disabled = false; btn.textContent = 'Save changes'; $('#ed-msg').innerHTML = `<span class="form-error">${esc(err.message)}</span>`; } }
      };
    };
    delBtn.onclick = () => {
      $('#e-confirm').innerHTML = `<span class="muted">Delete ${S.sel.size} record(s) permanently?</span> <button class="btn btn-sm btn-danger" id="e-yes" type="button">Yes, delete</button> <button class="btn btn-sm" id="e-no" type="button">Cancel</button>`;
      $('#e-no').onclick = sync;
      $('#e-yes').onclick = async () => {
        try { const out = await api('deleteEntries', { ids: Array.from(S.sel) }); S.sel.clear(); await load(true); render(); toast(`Deleted ${out.deleted} record(s)`); }
        catch (err) { if (err.message !== 'AUTH') toast(err.message); }
      };
    };
    wireBulk();
    if ($('#pend-panel')) {
      const pick = () => $$('input[data-pid]:checked').map(x => x.dataset.pid);
      $$('input[data-pid]').forEach(cb => cb.onchange = () => { const n = pick().length; $('#pend-dis').disabled = !n; $('#pend-dis').textContent = n ? `Dismiss ${n} selected` : 'Dismiss selected'; $('#pend-msg').innerHTML = ''; });
      $('#pend-dis').onclick = () => {
        const ids = pick();
        $('#pend-msg').innerHTML = `<span class="muted">Dismiss ${ids.length} session(s)? They will not be counted even if the code is added later.</span> <button class="btn btn-sm btn-danger" id="pend-yes" type="button">Yes, dismiss</button>`;
        $('#pend-yes').onclick = async () => {
          try { const out = await api('dismissPending', { ids }); await load(true); render(); toast(`Dismissed ${out.dismissed}`); }
          catch (err) { if (err.message !== 'AUTH') $('#pend-msg').innerHTML = `<span class="form-error">${esc(err.message)}</span>`; }
        };
      };
    }
  }

  /* ---------------------------------------------------------------- Feedback collection (QR / WhatsApp) */
  // One common QR for every session. Chauffeurs enter code + name + mobile, pick the L&D person and module;
  // the server attaches the ratings to their attendance (or holds them until the session is saved).
  async function collectFeedback(ids) {
    const url = location.origin + '/feedback.html';
    let svg = '', png = '';
    try { const q = qrcode(0, 'M'); q.addData(url); q.make(); svg = q.createSvgTag({ cellSize: 7, margin: 2, scalable: true }); png = q.createDataURL(12, 4); } catch (e) { svg = '<p class="note">QR code could not be drawn here; share the link instead.</p>'; }
    const msg = `Training feedback (1 minute). Enter your chauffeur code, name and mobile number, choose your trainer and module: ${url}`;
    const tracked = (ids || []).length;
    openDrawer(`
      <div class="drawer-head"><div><h1>Feedback QR</h1><p class="muted">One QR for all sessions · show it at the end of every training</p></div><button class="btn" data-close type="button">Close</button></div>
      <section class="panel" style="display:grid;gap:12px;justify-items:center;text-align:center">
        <h2>Ask chauffeurs to scan this with their phone camera</h2>
        <div class="qr-box">${svg}</div>
        <p class="muted" style="margin:0">They enter their <b>chauffeur code, name and mobile number</b>, choose <b>the trainer</b> and <b>the module</b>, and rate 7 questions (1–5) in their language. Feedback is matched to this week's attendance automatically.</p>
        ${png ? `<a class="btn btn-sm" href="${png}" download="CCR_Feedback_QR.png">Download QR (for printing)</a>` : ''}
      </section>
      <section class="panel" style="display:grid;gap:10px">
        <div class="link-box"><code id="fb-url">${esc(url)}</code><button class="btn btn-sm" id="fb-copy" type="button">Copy link</button></div>
        <div class="actions"><a class="btn" href="https://wa.me/?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">Share on WhatsApp</a><a class="btn" href="${esc(url)}" target="_blank" rel="noopener">Open form</a></div>
        <p class="note" style="margin:0">To keep your number private, share the link with the branch supervisor or the official branch group, not with chauffeurs directly.</p>
      </section>
      ${tracked ? `<section class="panel"><div class="panel-head"><h2>This session</h2><button class="btn btn-sm" id="fb-count" type="button">Refresh</button></div><div id="fb-status" class="muted"></div></section>` : ''}`);
    $('#fb-copy').onclick = async () => {
      try { await navigator.clipboard.writeText(url); toast('Link copied'); }
      catch (err) { const rg = document.createRange(); rg.selectNodeContents($('#fb-url')); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(rg); toast('Press Ctrl+C to copy'); }
    };
    if (!tracked) return;
    const show = () => {
      const want = new Set(ids);
      const list = S.M.att.filter(x => want.has(x.id));
      const done = list.filter(x => x.rating != null);
      $('#fb-status').innerHTML = `<b>${done.length} of ${list.length}</b> have given feedback.${list.length - done.length ? ` Waiting for: ${esc(list.filter(x => x.rating == null).map(x => (x.c ? x.c.name : x.code)).join(', '))}` : ' Everyone is done.'}`;
    };
    $('#fb-count').onclick = async () => { $('#fb-status').textContent = 'Checking…'; try { await load(true); show(); } catch (err) { if (err.message !== 'AUTH') $('#fb-status').textContent = 'Could not check right now.'; } };
    show();
  }

  /* ---------------------------------------------------------------- Bulk upload (Entries) */
  // Reads a sheet with many sessions, checks every row, previews, then saves one addTraining call per
  // session (same date + module + L&D + remarks). The server still enforces duplicates and SPOC locations.
  function parseDateCell(v) {
    const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    // mk() rejects impossible dates such as 31-02 instead of rolling them into March
    const mk = (y, mo, d) => { const t = new Date(y, mo, d); return t.getFullYear() === y && t.getMonth() === mo && t.getDate() === d ? iso(t) : ''; };
    // Excel dates read by the spreadsheet library can land a few seconds before midnight (e.g. 2-Oct 23:59:50 for
    // 3-Oct); a one-minute nudge puts those back on the right day and leaves any other time where it is.
    if (v instanceof Date && !isNaN(v)) return iso(new Date(v.getTime() + 60e3));
    if (typeof v === 'number' && v > 20000 && v < 80000) { const d = new Date(Math.round((v - 25569) * 864e5)); return iso(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); }
    const s = String(v || '').trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return mk(+m[1], +m[2] - 1, +m[3]);
    m = s.match(/^(\d{1,2})[\/\-. ](\d{1,2})[\/\-. ](\d{2,4})$/); // day first (Indian format)
    if (m) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return mk(y, +m[2] - 1, +m[1]); }
    m = s.match(/^(\d{1,2})[\-\/ ]([A-Za-z]{3,})[\-\/ ,]*(\d{2,4})$/);
    if (m) { const mi = MONTHS.findIndex(x => x.toLowerCase() === m[2].slice(0, 3).toLowerCase()); if (mi >= 0) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return mk(y, mi, +m[1]); } }
    return '';
  }

  function wireBulk() {
    const M = S.M, me = S.user;
    const pickL = (opts, v) => { const k = String(v || '').trim().toLowerCase(); return opts.find(o => o.toLowerCase() === k) || ''; };
    $('#b-template').onclick = () => {
      if (!window.XLSX) return toast('Please wait a moment and try again.');
      const wb = XLSX.utils.book_new();
      const head = ['Date', 'Chauffeur Code', 'Module', 'L&D', 'Remarks'].concat(Q_LABELS.map((q, i) => `Q${i + 1}`));
      const ex = M.modules.filter(m => m.active)[0];
      const ws = XLSX.utils.aoa_to_sheet([head.concat(['Chauffeur Name (only for codes not in master)']), ['26-09-2026', 16628, ex ? ex.name : '', me.name, 'Batch 1', 5, 5, 4, 5, 5, 4, 5], ['26-09-2026', 19538, ex ? ex.name : '', me.name, 'Batch 1']]);
      ws['!cols'] = [{ wch: 12 }, { wch: 15 }, { wch: 34 }, { wch: 20 }, { wch: 18 }].concat(Q_LABELS.map(() => ({ wch: 5 })));
      XLSX.utils.book_append_sheet(wb, ws, 'Entries');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Modules (spell exactly)']].concat(M.modules.filter(m => m.active).map(m => [m.name]), [[''], ['L&D names']], M.trainerOptions.map(t => [t]), [[''], ['Ratings Q1-Q7: 1 to 5, optional']], Q_LABELS.map((q, i) => [`Q${i + 1} ${q}`]))), 'Lists');
      XLSX.writeFile(wb, 'Bulk_Training_Upload_Template.xlsx');
    };
    $('#b-pick').onclick = () => $('#b-file').click();
    $('#b-file').onchange = async e => {
      const file = e.target.files[0]; e.target.value = '';
      if (!file || !window.XLSX) return;
      const out = $('#b-out');
      let rows;
      try {
        const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
        rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
      } catch (err) { out.innerHTML = '<p class="form-error">Could not read that file. Use .xlsx, .xls or .csv.</p>'; return; }
      const hi = rows.findIndex(r => r.some(c => /date/i.test(String(c))) && r.some(c => /code|(^|[^a-z])id([^a-z]|$)/i.test(String(c))));
      if (hi < 0) { out.innerHTML = '<p class="form-error">No header row found. The file needs at least "Date" and "Chauffeur Code" columns (use Download template).</p>'; return; }
      const h = rows[hi].map(c => String(c).trim());
      const col = re => h.findIndex(c => re.test(c));
      const C = { date: col(/date/i), code: col(/code/i) >= 0 ? col(/code/i) : col(/(^|[^a-z])id([^a-z]|$)/i), mod: col(/module/i), tr: col(/l\s*&\s*d|trainer/i), rem: col(/remark/i), name: col(/name/i) };
      const qc = {}; h.forEach((c, i) => { const m = c.match(/^q\s*([1-8])\b/i); if (m) qc[+m[1] - 1] = i; });
      const activeMods = M.modules.filter(m => m.active).map(m => m.name);
      const today = todayIso();
      const errors = [], groups = new Map(); let okRows = 0, newRows = 0;
      rows.slice(hi + 1).forEach((r, i) => {
        const line = hi + i + 2;
        if (r.every(v => String(v).trim() === '')) return;
        const date = parseDateCell(r[C.date]);
        let raw = String(r[C.code] == null ? '' : r[C.code]).trim(); if (raw.includes('__')) raw = raw.split('__').pop().trim();
        const code = /^\d+(\.0+)?$/.test(raw) ? String(parseInt(raw, 10)) : raw.toUpperCase();
        const mod = C.mod >= 0 ? pickL(activeMods, r[C.mod]) : '';
        let tr = me.name;
        if (me.role !== 'trainer' && C.tr >= 0 && String(r[C.tr]).trim()) tr = pickL(M.trainerOptions, r[C.tr]);
        const why = [];
        if (!date) why.push('date not understood'); else if (date > today) why.push('future date');
        if (!code) why.push('no code');
        const isNew = !!code && !M.ch[code]; // not in the master (or outside a SPOC's locations): kept aside by the server
        if (!mod) why.push(C.mod < 0 ? 'no Module column' : `module "${String(r[C.mod]).trim()}" not in the list`);
        if (!tr) why.push(`L&D "${String(r[C.tr]).trim()}" not in the list`);
        if (why.length) { errors.push({ line, why: why.join(', ') }); return; }
        const rem = C.rem >= 0 ? String(r[C.rem]).trim() : '';
        const q = []; Object.keys(qc).forEach(k => { const v = Number(r[qc[k]]); q[k] = v >= 1 && v <= 5 && Math.round(v) === v ? v : ''; });
        const key = [date, mod, tr, rem].join('|');
        if (!groups.has(key)) groups.set(key, { date, module: mod, trainer: tr, remarks: rem, entries: [] });
        // a bare number in the name column is a stray rating, not a name
        const nm = C.name >= 0 ? String(r[C.name] || '').trim() : '';
        groups.get(key).entries.push({ code, q, name: /^[\d.\s]*$/.test(nm) ? '' : nm });
        if (isNew) newRows++; else okRows++;
      });
      const list = Array.from(groups.values()).sort((a, b) => a.date.localeCompare(b.date));
      out.innerHTML = `
        <div class="${errors.length ? 'warn-box' : 'ok-box'}" style="margin-top:12px"><b>${esc(file.name)}</b>: ${okRows} row(s) ready in ${list.length} session(s).${newRows ? ` <b>${newRows} row(s) have codes not in the master</b>: they will be kept in <b>Not in Master</b> (not counted) and move into the counts once the chauffeur is added.` : ''}${errors.length ? ` <b>${errors.length} row(s) have problems</b> and will be skipped (see below).` : ''}</div>
        ${list.length ? `<div class="table-wrap" style="margin-top:10px"><table><thead><tr><th>Date</th><th>Module</th><th>L&amp;D</th><th>Remarks</th><th class="n">Chauffeurs</th></tr></thead><tbody>
          ${list.map(g => `<tr><td>${dShort(g.date)}</td><td>${esc(g.module)}</td><td>${esc(g.trainer)}</td><td>${esc(g.remarks)}</td><td class="n">${g.entries.length}</td></tr>`).join('')}</tbody></table></div>` : ''}
        ${errors.length ? `<details style="margin-top:10px"${list.length ? '' : ' open'}><summary>Rows with problems (${errors.length})</summary><div class="table-wrap tall"><table><thead><tr><th class="n">Row</th><th>Problem</th></tr></thead><tbody>${errors.map(x => `<tr><td class="n">${x.line}</td><td>${esc(x.why)}</td></tr>`).join('')}</tbody></table></div></details>` : ''}
        ${list.length ? `<div class="actions" style="margin-top:12px"><button class="btn btn-primary" id="b-go" type="button">Import ${okRows + newRows} row(s)</button><button class="btn" id="b-cancel" type="button">Cancel</button><span id="b-prog" class="muted"></span></div>` : ''}`;
      if (!list.length) return;
      $('#b-cancel').onclick = () => { out.innerHTML = ''; };
      $('#b-go').onclick = async () => {
        const btn = $('#b-go'); btn.disabled = true; $('#b-cancel').disabled = true;
        let added = 0, dup = 0, unk = [], failed = [], kept = 0;
        for (let i = 0; i < list.length; i++) {
          const g = list[i];
          $('#b-prog').textContent = `Saving session ${i + 1} of ${list.length}…`;
          try {
            const r = await api('addTraining', { date: g.date, module: g.module, trainer: g.trainer, remarks: g.remarks, entries: g.entries });
            added += r.added.length; dup += r.duplicates.length; unk = unk.concat(r.unknown); kept += (r.pending || []).length;
          } catch (err) {
            if (err.message === 'AUTH') return;
            failed.push(`${dShort(g.date)} ${g.module}: ${err.message}`);
          }
        }
        await load(true); render();
        $('#b-out').innerHTML = `<p class="${failed.length || unk.length ? 'warn-box' : 'ok-box'}" style="margin-top:12px">Imported <b>${added}</b> attendance(s).${kept ? ` <b>${kept}</b> kept in Not in Master (not counted until those chauffeurs are added).` : ''}${dup ? ` Skipped ${dup} already recorded.` : ''}${unk.length ? ` Not saved (not found${me.role === 'spoc' ? ' or outside your locations' : ''}): ${esc(unk.join(', '))}.` : ''}${failed.length ? `<br>Failed sessions: ${esc(failed.join(' · '))}` : ''}</p>`;
        toast(`Imported ${added} attendance(s)`);
      };
    };
  }

  /* ---------------------------------------------------------------- Admin */
  async function viewAdmin() {
    const M = S.M;
    const noid = M.chList.filter(c => /^NOID/i.test(String(c.code)));
    const incomplete = M.chList.filter(c => c.status === 'Added from CCR');
    $('#main').innerHTML = `
      <div class="view-head"><div><h1>Admin</h1><p class="muted">Users, modules, chauffeur records and settings. Changes save straight to the Google Sheet.</p></div></div>
      <nav class="subnav" aria-label="Admin sections">${[['ad-users', 'Users'], ['ad-sync', 'Sheet sync'], ['ad-master', 'Weekly master'], ['ad-import', 'Import feedback'], ['ad-codes', 'Fix codes'], ['ad-chauffeur', 'Add chauffeur'], ['ad-modules', 'Modules'], ['ad-fy', 'Financial year']]
        .map(([id, t]) => `<button type="button" data-jump="${id}">${t}</button>`).join('')}</nav>
      <section class="panel" id="ad-users"><div class="panel-head"><h2>Users</h2><p class="muted">L&amp;D team signs in with email + password</p></div><div class="loading">Loading users…</div></section>
      <section class="panel" id="ad-sync">
        <div class="panel-head"><h2>Google Sheet sync</h2><p class="muted">The Google Sheet is the source of truth. Its <b>Master View</b> tab mirrors this Chauffeur Master and rebuilds itself within 10 minutes of any change.</p></div>
        <div class="actions"><button class="btn btn-sm btn-primary" id="sy-go" type="button">Sync Master View now</button><span class="muted" id="sy-msg">${M.d.sheetSynced ? 'Last built ' + esc(M.d.sheetSynced) : 'Not built yet: run installAutoSync once in Apps Script, or press Sync now.'}</span></div>
      </section>
      <section class="panel" id="ad-master">
        <div class="panel-head"><h2>Weekly master update (Excel)</h2><p class="muted">Sheet "Chauffeur Master" (or the first sheet): Chauffeur Code, Name or Chauffeur ID, Location, Mobile, Driver Type, Status, DOJ, DOL, Category, Duty Count…, Incidents…</p></div>
        <div class="actions"><button class="btn btn-primary btn-sm" id="mu-pick" type="button">Choose master file</button><input type="file" id="mu-file" accept=".xlsx,.xls,.csv" hidden></div>
        <div id="mu-out"></div>
      </section>
      <section class="panel" id="ad-import">
        <div class="panel-head"><h2>Import feedback (Excel)</h2><p class="muted">Sheet "IMPORT" with Entry ID + Q1–Q7, e.g. the review file prepared for you</p></div>
        <div class="actions"><button class="btn btn-primary btn-sm" id="if-pick" type="button">Choose file</button><input type="file" id="if-file" accept=".xlsx,.xls,.csv" hidden></div>
        <div id="if-out"></div>
      </section>
      <div class="grid-2">
        <section class="panel" id="ad-codes"><div class="panel-head"><h2>Fix chauffeur codes <span class="pill ${noid.length ? 'bad' : 'good'}">${noid.length} temporary</span></h2></div>
          <p class="muted" style="margin-top:0">Replaces a code everywhere (attendance included). If the new code already exists, the two records are merged.</p>
          <div class="form-grid">${select('ad-from', 'Current code', noid.length ? noid.map(c => [c.code, `${c.code} · ${c.name} · ${c.loc}`]) : [['', 'No temporary codes']], '')}
            <div class="field"><label for="ad-to">Real chauffeur code</label><input id="ad-to" inputmode="numeric"></div></div>
          <div class="field" style="margin-top:8px"><label for="ad-from-any">…or type any current code</label><input id="ad-from-any" placeholder="Leave empty to use the list"></div>
          <div class="actions" style="margin-top:10px"><button class="btn btn-primary" id="ad-replace" type="button">Replace code</button><span id="ad-replace-msg"></span></div></section>
        <section class="panel" id="ad-chauffeur"><div class="panel-head"><h2>Add or edit a chauffeur</h2></div>
          <div class="form-grid">
            <div class="field"><label for="cf-code">Code</label><input id="cf-code" placeholder="Type a code to load it"></div>
            <div class="field"><label for="cf-name">Name</label><input id="cf-name"></div>
            ${select('cf-loc', 'Location', M.locations.concat(['(new location)']), M.locations[0])}
            <div class="field" id="cf-newloc-wrap" hidden><label for="cf-newloc">New location name</label><input id="cf-newloc"></div>
            ${select('cf-type', 'Driver type', ['Dedicated', 'Owned', 'VDP', 'MMG', 'Not in Master'], 'Dedicated')}
            ${select('cf-cat', 'Category', CATS, 'A')}
            <div class="field"><label for="cf-status">Status</label><input id="cf-status" value="Active"></div>
            <div class="field"><label for="cf-doj">Date of joining</label><input type="date" id="cf-doj"></div>
            <div class="field"><label for="cf-dol">Date of leaving</label><input type="date" id="cf-dol"></div>
          </div>
          <div class="actions" style="margin-top:10px"><button class="btn btn-primary" id="cf-save" type="button">Save chauffeur</button><span id="cf-msg" class="muted"></span></div>
          ${incomplete.length ? `<p class="note">${incomplete.length} chauffeur(s) were added from the CCR sheet and still need DOJ, type and category. Filter the Google Sheet on Status = "Added from CCR".</p>` : ''}</section>
      </div>
      <div class="grid-2">
        <section class="panel" id="ad-modules"><div class="panel-head"><h2>Modules</h2></div>
          <div class="table-wrap"><table><thead><tr><th>Module</th><th class="n">Minutes</th><th>In use</th><th></th></tr></thead><tbody>
          ${M.modules.map((m, i) => `<tr><td>${esc(m.name)}</td><td class="n"><input type="number" min="1" max="1440" value="${m.dur}" data-mdur="${i}" style="width:90px"></td><td><input type="checkbox" data-mact="${i}" style="width:auto"${m.active ? ' checked' : ''}></td><td><button class="btn btn-sm" data-msave="${i}" type="button">Save</button></td></tr>`).join('')}
          </tbody></table></div>
          <div class="form-grid" style="margin-top:12px"><div class="field"><label for="nm-name">New module</label><input id="nm-name"></div><div class="field"><label for="nm-dur">Minutes</label><input id="nm-dur" type="number" min="1" max="1440" value="90"></div></div>
          <div class="actions" style="margin-top:8px"><button class="btn" id="nm-add" type="button">Add module</button></div>
          <h3 style="margin-top:16px">Merge a module into another</h3>
          <div class="form-grid">${select('mg-from', 'Move all records of', M.modules.map(m => m.name), '')}${select('mg-to', 'Into', M.modules.map(m => m.name), M.modules[1] ? M.modules[1].name : '')}</div>
          <div class="actions" style="margin-top:8px"><button class="btn btn-danger" id="mg-go" type="button">Merge</button><span id="mg-msg"></span></div></section>
        <section class="panel" id="ad-fy"><div class="panel-head"><h2>Financial year</h2></div>
          <div class="field" style="max-width:240px"><label for="st-fy">FY start date</label><input type="date" id="st-fy" value="${esc(M.fyStart)}"></div>
          <p class="note">Chauffeurs who left before this date are excluded, and only trainings inside the year are counted. Change it to 1 April each new year.</p>
          <div class="actions" style="margin-top:8px"><button class="btn btn-primary" id="st-save" type="button">Save</button></div></section>
      </div>`;

    const done = async msg => { await load(true); render(); toast(msg); };
    $$('[data-jump]').forEach(b => b.onclick = () => { const el = document.getElementById(b.dataset.jump); if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 140, behavior: 'smooth' }); });

    // Feedback import: preview against the live data, then write (optionally clearing all ratings first)
    $('#if-pick').onclick = () => $('#if-file').click();
    $('#if-file').onchange = async e => {
      const file = e.target.files[0]; e.target.value = '';
      if (!file || !window.XLSX) return;
      const box = $('#if-out');
      let rows;
      try {
        const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
        const name = wb.SheetNames.find(n => n.trim().toUpperCase() === 'IMPORT') || wb.SheetNames[0];
        rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
      } catch (err) { box.innerHTML = '<p class="form-error">Could not read that file.</p>'; return; }
      const h = (rows[0] || []).map(c => String(c).trim().toUpperCase());
      const cId = h.findIndex(c => c === 'ENTRY ID');
      const qc = Q_LABELS.map((x, k) => h.findIndex(c => c === 'Q' + (k + 1)));
      if (cId < 0 || qc.some(i => i < 0)) { box.innerHTML = `<p class="form-error">The sheet needs the columns Entry ID and Q1–Q${Q_LABELS.length}.</p>`; return; }
      const ids = new Set(M.att.map(a => a.id));
      const list = [], missing = [], bad = [];
      rows.slice(1).forEach(r => {
        const id = String(r[cId] || '').trim(); if (!id) return;
        const q = qc.map(i => Number(r[i]));
        if (q.some(v => !(Number.isInteger(v) && v >= 1 && v <= 5))) { bad.push(id); return; }
        if (!ids.has(id)) { missing.push(id); return; }
        list.push({ id, q });
      });
      const ratedNow = M.att.filter(a => a.rating != null).length;
      box.innerHTML = `
        <div class="${missing.length || bad.length ? 'warn-box' : 'ok-box'}" style="margin-top:12px"><b>${esc(file.name)}</b>: ${list.length} feedback rows ready.
          ${missing.length ? `<br>${missing.length} Entry ID(s) not found in the live data (will be skipped): ${esc(missing.slice(0, 15).join(', '))}${missing.length > 15 ? '…' : ''}` : ''}
          ${bad.length ? `<br>${bad.length} row(s) with a rating that is not 1–5 (will be skipped): ${esc(bad.slice(0, 15).join(', '))}` : ''}</div>
        <label style="display:flex;gap:8px;align-items:center;margin-top:10px"><input type="checkbox" id="if-clear" style="width:auto" checked> <span><b>Full replace:</b> first clear the ratings on all ${fmt(ratedNow)} attendance records that have feedback today</span></label>
        <div class="actions" style="margin-top:10px"><button class="btn btn-primary" id="if-go" type="button"${list.length ? '' : ' disabled'}>Import ${list.length} feedback rows</button><span id="if-msg"></span></div>`;
      $('#if-go').onclick = () => {
        const clearAll = $('#if-clear').checked;
        $('#if-msg').innerHTML = `<span class="muted">${clearAll ? `This removes all current feedback and writes ${list.length} rows.` : `This writes ${list.length} rows and keeps other feedback.`} Continue?</span> <button class="btn btn-sm btn-danger" id="if-yes" type="button">Yes, import</button>`;
        $('#if-yes').onclick = async () => {
          $('#if-yes').disabled = true; $('#if-yes').textContent = 'Importing…';
          try {
            const r = await api('importFeedback', { rows: list, clearAll });
            await done(`Feedback imported: ${r.written} written${clearAll ? `, ${r.cleared} cleared first` : ''}${r.notFound.length ? `, ${r.notFound.length} not found` : ''}`);
          } catch (err) { fail($('#if-msg'), err); }
        };
      };
    };
    wireMasterUpload(done);
    $('#sy-go').onclick = async () => {
      const b = $('#sy-go'); b.disabled = true; b.textContent = 'Syncing…';
      try { const r = await api('rebuildMasterView'); M.d.sheetSynced = r.built; $('#sy-msg').textContent = `Master View rebuilt: ${fmt(r.rows)} chauffeurs · ${r.built}`; }
      catch (err) { if (err.message !== 'AUTH') $('#sy-msg').innerHTML = `<span class="form-error">${esc(err.message)}</span>`; }
      finally { b.disabled = false; b.textContent = 'Sync Master View now'; }
    };
    const fail = (el, err) => { if (err.message !== 'AUTH') { if (el) el.innerHTML = `<span class="form-error">${esc(err.message)}</span>`; else toast(err.message); } };

    $('#ad-replace').onclick = async () => {
      const from = $('#ad-from-any').value.trim() || $('#ad-from').value; const to = $('#ad-to').value.trim();
      if (!from || !to) { $('#ad-replace-msg').innerHTML = '<span class="form-error">Choose a code and type the real code.</span>'; return; }
      try { const out = await api('replaceCode', { from, to }); await done(`Code ${from} → ${to}: ${out.moved} attendance(s) moved${out.merged ? ', records merged' : ''}`); } catch (err) { fail($('#ad-replace-msg'), err); }
    };
    // chauffeur form
    const fill = c => {
      $('#cf-name').value = c ? c.name : ''; $('#cf-status').value = c ? c.status || 'Active' : 'Active';
      if (c) { $('#cf-loc').value = c.loc; $('#cf-type').value = c.type; $('#cf-cat').value = c.cat; }
      $('#cf-doj').value = c ? c.doj : ''; $('#cf-dol').value = c ? c.dol : '';
      $('#cf-msg').textContent = c ? 'Editing existing chauffeur' : 'New chauffeur';
    };
    $('#cf-code').onchange = () => { const v = $('#cf-code').value.trim(); fill(M.ch[/^\d+$/.test(v) ? String(parseInt(v, 10)) : v.toUpperCase()]); };
    $('#cf-loc').onchange = () => { $('#cf-newloc-wrap').hidden = $('#cf-loc').value !== '(new location)'; };
    $('#cf-save').onclick = async () => {
      const raw = $('#cf-code').value.trim(); const code = /^\d+$/.test(raw) ? String(parseInt(raw, 10)) : raw.toUpperCase();
      const loc = $('#cf-loc').value === '(new location)' ? $('#cf-newloc').value.trim() : $('#cf-loc').value;
      try {
        const sv = await api('saveChauffeur', { isNew: !M.ch[code], chauffeur: { code, name: $('#cf-name').value, location: loc, type: $('#cf-type').value, category: $('#cf-cat').value, status: $('#cf-status').value, doj: $('#cf-doj').value, dol: $('#cf-dol').value } });
        await done('Chauffeur saved' + (sv.pendingMoved ? ` · ${sv.pendingMoved} pending session(s) now counted` : ''));
      } catch (err) { fail($('#cf-msg'), err); }
    };
    // modules
    $$('[data-msave]').forEach(b => b.onclick = async () => {
      const i = +b.dataset.msave; const m = M.modules[i];
      try { await api('saveModule', { module: { name: m.name, duration: Number($(`[data-mdur="${i}"]`).value), active: $(`[data-mact="${i}"]`).checked } }); await done('Module saved'); } catch (err) { fail(null, err); }
    });
    $('#nm-add').onclick = async () => {
      try { await api('saveModule', { module: { name: $('#nm-name').value, duration: Number($('#nm-dur').value), active: true } }); await done('Module added'); } catch (err) { fail(null, err); }
    };
    $('#mg-go').onclick = () => {
      const from = $('#mg-from').value, to = $('#mg-to').value;
      $('#mg-msg').innerHTML = `<span class="muted">Move every "${esc(from)}" record to "${esc(to)}"?</span> <button class="btn btn-sm btn-danger" id="mg-yes" type="button">Yes, merge</button>`;
      $('#mg-yes').onclick = async () => { try { const out = await api('mergeModule', { from, to }); await done(`${out.moved} record(s) moved to ${to}`); } catch (err) { fail($('#mg-msg'), err); } };
    };
    $('#st-save').onclick = async () => { try { await api('saveSettings', { fyStart: $('#st-fy').value }); await done('Financial year saved'); } catch (err) { fail(null, err); } };

    // users (loaded separately)
    try {
      const out = await api('listUsers');
      if (S.view !== 'admin') return;
      const box = $('#ad-users');
      const roleCell = u => (u.role === 'admin' ? '<span class="role role-admin">Admin</span>' : u.role === 'viewer' ? '<span class="role role-viewer">Viewer</span>' : u.role === 'spoc' ? '<span class="role role-spoc">L&amp;D SPOC</span>' : '<span class="role role-ld">L&amp;D</span>');
      const regionNames = Object.keys(out.regions || {}).filter(r => (out.regions[r] || []).length);
      box.innerHTML = `<div class="panel-head"><h2>Users</h2><p class="muted">Admins and L&amp;D see all locations. Viewers see only their Access.</p></div>
        <div class="table-wrap users"><table><thead><tr><th>User</th><th>Role</th><th>Access</th><th>Status</th><th>Sign-in</th><th></th></tr></thead><tbody>
        ${out.users.map((u, i) => `<tr class="${u.active ? '' : 'inactive'}"><td><div class="who-cell"><span class="av" style="--h:${hue(u.name)}">${esc(initials(u.name))}</span><span><b>${esc(u.name)}</b><small>${esc(u.email || 'no login')}</small></span></div></td><td>${roleCell(u)}</td>
          <td><span class="acc">${esc(u.role === 'viewer' || u.role === 'spoc' ? u.access || '(none)' : 'All')}</span></td>
          <td>${u.active ? '<span class="dot on">Active</span>' : '<span class="dot off">Inactive</span>'}</td>
          <td>${[u.hasPassword ? '<span class="pill neutral">Password</span>' : '', u.hasLink ? '<span class="pill neutral">View link</span>' : ''].filter(Boolean).join(' ') || '<span class="pill warn">Not set</span>'}</td>
          <td><div class="actions"><button class="btn btn-sm" data-uedit="${i}" type="button">Edit</button>${u.email ? `<button class="btn btn-sm" data-ulink="${i}" type="button">${u.hasLink ? 'New link' : 'Create view link'}</button>` : ''}${u.hasLink ? `<button class="btn btn-sm btn-danger" data-urevoke="${i}" type="button">Cancel link</button>` : ''}</div></td></tr>`).join('')}
        </tbody></table></div>
        <div id="link-out"></div>
        <div class="panel" style="background:var(--surface-2);margin-top:14px;box-shadow:none" id="uu-box">
          <div class="panel-head"><h3>Add many users at once</h3><p class="muted">Excel with Name, Email, Role, Access (Active and Password optional)</p></div>
          <div class="actions"><button class="btn btn-primary btn-sm" id="uu-pick" type="button">Upload users (Excel)</button><input type="file" id="uu-file" accept=".xlsx,.xls,.csv" hidden><button class="btn btn-sm btn-ghost" id="uu-template" type="button">Download template</button></div>
          <div id="uu-out"></div>
        </div>
        <h3 style="margin-top:16px" id="uf-title">Add a user</h3>
        <div class="form-grid" style="margin-top:8px">
          <div class="field"><label for="uf-name">Name (L&amp;D: as it should appear on entries)</label><input id="uf-name"></div>
          <div class="field"><label for="uf-email">Email</label><input id="uf-email" type="email"></div>
          ${select('uf-role', 'Role', [['trainer', 'L&D (enters training, all locations)'], ['spoc', 'L&D SPOC (enters training, own locations)'], ['viewer', 'Viewer (read-only)'], ['admin', 'Admin']], 'trainer')}
          <div class="field" id="uf-access-wrap" hidden><label for="uf-access">Access (viewers and SPOCs)</label><input id="uf-access" list="access-options" placeholder="All, a region, or MUMBAI, PUNE"><datalist id="access-options">${['All'].concat(regionNames, M.locations).map(x => `<option value="${esc(x)}">`).join('')}</datalist></div>
          ${select('uf-active', 'Status', [['yes', 'Active'], ['no', 'Inactive']], 'yes')}
          <div class="field"><label for="uf-pw">Password (optional; leave empty to keep)</label><input id="uf-pw" type="text" autocomplete="off" placeholder="min 6 characters"></div>
        </div>
        <p class="note">Regions: ${regionNames.length ? regionNames.map(r => `<b>${esc(r)}</b> (${esc(out.regions[r].join(', '))})`).join(' · ') : 'none yet'}. Edit regions in the Regions tab of the Google Sheet.</p>
        <div class="actions" style="margin-top:10px"><button class="btn btn-primary" id="uf-save" type="button">Save user</button><span id="uf-msg"></span></div>
        <p class="note">L&amp;D SPOC: SPOC + their location(s); they add training and see only those locations. Branch Head: Viewer + one location. Regional Head: Viewer + region. Head HR / COO: Viewer + All. Viewers can sign in with a password, or with a personal view link (no password). Viewers cannot export or download.</p>`;
      const syncRole = () => { $('#uf-access-wrap').hidden = !['viewer', 'spoc'].includes($('#uf-role').value); };
      wireUserUpload(out, regionNames);
      $('#uf-role').onchange = syncRole;
      $$('[data-uedit]').forEach(b => b.onclick = () => {
        const u = out.users[+b.dataset.uedit];
        $('#uf-title').textContent = 'Edit ' + u.name; $('#uf-name').value = u.name; $('#uf-email').value = u.email; $('#uf-role').value = u.role; $('#uf-active').value = u.active ? 'yes' : 'no'; $('#uf-pw').value = '';
        $('#uf-access').value = u.role === 'viewer' || u.role === 'spoc' ? u.access : ''; syncRole();
        $('#uf-email').focus();
      });
      $$('[data-ulink]').forEach(b => b.onclick = async () => {
        const u = out.users[+b.dataset.ulink];
        try {
          const r = await api('makeLink', { email: u.email });
          const url = location.origin + location.pathname + '#k=' + r.key;
          $('#link-out').innerHTML = `<div class="link-box"><span>View link for <b>${esc(u.name)}</b> (anyone with this link signs in as them; any older link stops working):</span><code id="link-url">${esc(url)}</code><button class="btn btn-sm btn-primary" id="link-copy" type="button">Copy link</button></div>`;
          $('#link-copy').onclick = async () => {
            try { await navigator.clipboard.writeText(url); toast('Link copied'); }
            catch (e) { const rg = document.createRange(); rg.selectNodeContents($('#link-url')); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(rg); toast('Press Ctrl+C to copy'); }
          };
        } catch (err) { fail($('#uf-msg'), err); }
      });
      $$('[data-urevoke]').forEach(b => b.onclick = async () => {
        const u = out.users[+b.dataset.urevoke];
        try { await api('revokeLink', { email: u.email }); toast('Link cancelled for ' + u.name); render(); } catch (err) { fail($('#uf-msg'), err); }
      });
      $('#uf-save').onclick = async () => {
        try {
          await api('saveUser', { user: { name: $('#uf-name').value, email: $('#uf-email').value, role: $('#uf-role').value, access: $('#uf-access').value, active: $('#uf-active').value === 'yes', password: $('#uf-pw').value } });
          toast('User saved'); render();
        } catch (err) { fail($('#uf-msg'), err); }
      };
    } catch (err) { if (err.message !== 'AUTH') $('#ad-users').innerHTML = `<p class="form-error">${esc(err.message)}</p>`; }
  }

  // Weekly master: read the file in the browser, show what will change, then send it to the server.
  // New codes are added, existing ones updated with the non-empty cells; nothing is deleted.
  function wireMasterUpload(done) {
    const M = S.M;
    $('#mu-pick').onclick = () => $('#mu-file').click();
    $('#mu-file').onchange = async e => {
      const file = e.target.files[0]; e.target.value = '';
      if (!file || !window.XLSX) return;
      const box = $('#mu-out');
      let wb;
      try { wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true }); }
      catch (err) { box.innerHTML = '<p class="form-error">Could not read that file.</p>'; return; }
      // A file can hold many sheets: use "Chauffeur Master" if there is one, else the sheet that looks most like a
      // master (code + location + name headers). The admin can switch sheets in the preview.
      const rowsOf = n => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' });
      const looks = n => { const r = rowsOf(n).slice(0, 15).find(x => x.some(c => /code/i.test(String(c)))) || []; const t = r.join('|'); return [/code/i, /location/i, /name|chauffeur\s*id/i, /driver\s*type|category|doj/i].filter(re => re.test(t)).length; };
      const guess = wb.SheetNames.find(n => /chauffeur\s*master/i.test(n)) || wb.SheetNames.slice().sort((a, b) => looks(b) - looks(a))[0];
      const parse = name => {
      const rows = rowsOf(name);
      const picker = wb.SheetNames.length > 1 ? `<div class="field" style="max-width:320px;margin-top:12px"><label for="mu-sheet">Sheet in this file (${wb.SheetNames.length} sheets)</label><select id="mu-sheet">${wb.SheetNames.map(n => `<option${n === name ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></div>` : '';
      const wireSheet = () => { if ($('#mu-sheet')) $('#mu-sheet').onchange = ev => parse(ev.target.value); };
      const hi = rows.findIndex(r => r.some(c => /code/i.test(String(c))));
      if (hi < 0) { box.innerHTML = picker + `<p class="form-error">Sheet "${esc(name)}" has no header row with a "Code" column. Choose the master sheet above.</p>`; wireSheet(); return; }
      const h = rows[hi].map(c => String(c).trim());
      const find = re => h.findIndex(c => re.test(c));
      const ix = { code: find(/code/i), id: find(/chauffeur\s*id/i), name: find(/name/i), loc: find(/location/i), mob: find(/mobile/i), type: find(/driver\s*type|^type$/i),
        status: find(/^status$/i), doj: find(/^doj|joining/i), dol: find(/^dol|leaving/i), cat: find(/category/i) };
      // duty / incident columns, but not module count columns such as 'Defensive Driving Training (Incident)'
      const modSet = new Set(M.modules.map(m => m.name.toLowerCase()));
      const extraIx = h.map((c, i) => (/duty|incident/i.test(c) && !modSet.has(c.toLowerCase()) && !/training/i.test(c) ? i : -1)).filter(i => i >= 0);
      const cell = (r, i) => (i < 0 ? '' : r[i] == null ? '' : r[i]);
      const list = []; const seen = new Set(); let dup = 0, noName = 0;
      rows.slice(hi + 1).forEach(r => {
        let code = String(cell(r, ix.code)).trim(); if (!code) return;
        code = /^\d+(\.0+)?$/.test(code) ? String(parseInt(code, 10)) : code.toUpperCase();
        if (seen.has(code)) { dup++; return; } seen.add(code);
        let name = String(cell(r, ix.name)).trim();
        const id = String(cell(r, ix.id)).trim();
        if ((!name || /^#|^0$/.test(name)) && id.includes('__')) name = id.split('__')[0].trim();
        const dol = String(cell(r, ix.dol)).trim();
        const x = { code, name: name.toUpperCase(), location: String(cell(r, ix.loc)).trim().toUpperCase(), mobile: String(cell(r, ix.mob)).replace(/\D/g, '').slice(-10),
          type: String(cell(r, ix.type)).trim(), status: String(cell(r, ix.status)).trim(), category: String(cell(r, ix.cat)).trim(),
          doj: parseDateCell(cell(r, ix.doj)), dol: dol === '-' ? '' : parseDateCell(cell(r, ix.dol)), extra: {} };
        extraIx.forEach(i => { const v = cell(r, i); if (v !== '' && v !== '-') x.extra[h[i]] = typeof v === 'number' ? v : String(v).trim(); });
        if (!M.ch[code] && !x.name) { noName++; return; }
        list.push(x);
      });
      const isNew = list.filter(x => !M.ch[x.code]);
      const missing = M.chList.filter(c => !seen.has(String(c.code)) && !c.dol && c.status !== 'Added from CCR');
      box.innerHTML = picker + `
        <div class="ok-box" style="margin-top:12px"><b>${esc(file.name)}</b> › sheet <b>${esc(name)}</b>: ${fmt(list.length)} chauffeurs read ·
          <b>${fmt(isNew.length)} new</b> · ${fmt(list.length - isNew.length)} existing (non-empty cells will update the sheet)${extraIx.length ? ` · extra columns: ${esc(extraIx.map(i => h[i]).join(', '))}` : ''}
          ${dup ? `<br>${dup} repeated code(s) skipped (first row kept).` : ''}${noName ? `<br>${noName} new code(s) without a name skipped.` : ''}</div>
        ${isNew.length ? `<p class="note">New: ${esc(isNew.slice(0, 12).map(x => x.code + ' ' + x.name).join(', '))}${isNew.length > 12 ? '…' : ''}</p>` : ''}
        <label style="display:flex;gap:8px;align-items:center;margin-top:10px"><input type="checkbox" id="mu-left" style="width:auto"> <span>Mark the <b>${fmt(missing.length)}</b> chauffeurs not in this file as <b>Left</b> on</span> <input type="date" id="mu-date" value="${todayIso()}" style="width:160px"></label>
        <div class="actions" style="margin-top:10px"><button class="btn btn-primary" id="mu-go" type="button"${list.length ? '' : ' disabled'}>Update master (${fmt(list.length)} rows)</button><span id="mu-msg"></span></div>`;
      $('#mu-go').onclick = async () => {
        const btn = $('#mu-go'); btn.disabled = true; btn.textContent = 'Updating…';
        try {
          const r = await api('syncMaster', { rows: list, markMissing: $('#mu-left').checked, leftDate: $('#mu-date').value });
          await done(`Master updated: ${r.added} added, ${r.updated} updated, ${r.unchanged} unchanged${r.left ? `, ${r.left} marked Left` : ''}${r.pendingMoved ? `, ${r.pendingMoved} pending session(s) now counted` : ''}`);
        } catch (err) { if (err.message !== 'AUTH') { btn.disabled = false; btn.textContent = 'Update master'; $('#mu-msg').innerHTML = `<span class="form-error">${esc(err.message)}</span>`; } }
      };
      wireSheet();
      };
      parse(guess);
    };
  }

  // Same reading of a role as the server: admin; anything with SPOC; viewer / head / HR / COO; else L&D
  const roleOfText = v => { const r = String(v || '').trim().toLowerCase(); return r === 'admin' ? 'admin' : /spoc/.test(r) ? 'spoc' : /viewer|view only|head|coo|hr/.test(r) ? 'viewer' : 'trainer'; };
  const ROLE_LABEL = { admin: 'Admin', spoc: 'L&D SPOC', viewer: 'Viewer', trainer: 'L&D' };

  // Admin: upload many users from Excel. Preview first (new / update / problem), then one save for all.
  function wireUserUpload(out, regionNames) {
    const M = S.M;
    const known = new Set(out.users.map(u => String(u.email || '').toLowerCase()).filter(Boolean));
    const nameOf = {}; out.users.forEach(u => { if (u.email) nameOf[String(u.email).toLowerCase()] = u.name; });
    const validAccess = new Set(['ALL'].concat(regionNames.map(r => r.toUpperCase()), M.locations.map(l => l.toUpperCase())));
    $('#uu-template').onclick = () => {
      if (!window.XLSX) return;
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([['Name', 'Email', 'Role', 'Access', 'Active', 'Password (optional)'],
        ['Example Branch Head', 'branch.head@ecosmobility.com', 'Viewer', 'PUNE', 'Yes', ''],
        ['Example L&D SPOC', 'ld.spoc@ecosmobility.com', 'L&D SPOC', 'SOUTH 1', 'Yes', ''],
        ['Example Trainer', 'trainer@ecosmobility.com', 'L&D', 'All', 'Yes', '']]);
      ws['!cols'] = [{ wch: 26 }, { wch: 34 }, { wch: 12 }, { wch: 28 }, { wch: 8 }, { wch: 20 }];
      XLSX.utils.book_append_sheet(wb, ws, 'Users');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Role (type one)'], ['L&D'], ['L&D SPOC'], ['Viewer'], ['Admin'], [''], ['Access (viewers and SPOCs)'], ['All']]
        .concat(regionNames.map(r => [r]), M.locations.map(l => [l]), [[''], ['Several locations: separate with commas, e.g. MUMBAI, PUNE'], ['Password empty: the person uses Forgot password? on the sign-in page']])), 'Lists');
      XLSX.writeFile(wb, 'Users_Upload_Template.xlsx');
    };
    $('#uu-pick').onclick = () => $('#uu-file').click();
    $('#uu-file').onchange = async e => {
      const file = e.target.files[0]; e.target.value = '';
      if (!file || !window.XLSX) return;
      const box = $('#uu-out');
      let rows;
      try {
        const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
        const name = wb.SheetNames.find(n => /^users?$/i.test(n.trim())) || wb.SheetNames.find(n => /user/i.test(n)) || wb.SheetNames[0];
        rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' });
      } catch (err) { box.innerHTML = '<p class="form-error">Could not read that file.</p>'; return; }
      const hi = rows.findIndex(r => r.some(c => /e-?mail/i.test(String(c))) && r.some(c => /name/i.test(String(c))));
      if (hi < 0) { box.innerHTML = '<p class="form-error">No header row with Name and Email was found. Use Download template.</p>'; return; }
      const h = rows[hi].map(c => String(c).trim());
      const col = re => h.findIndex(c => re.test(c));
      const C = { name: col(/^name/i), email: col(/e-?mail/i), role: col(/role/i), access: col(/access/i), active: col(/^(active|status)/i), pw: col(/password/i) };
      const seen = new Set(), list = [];
      rows.slice(hi + 1).forEach((r, i) => {
        if (r.every(v => String(v).trim() === '')) return;
        const cell = k => (C[k] < 0 ? '' : String(r[C[k]] == null ? '' : r[C[k]]).trim());
        const x = { row: hi + i + 2, name: cell('name'), email: cell('email').toLowerCase(), roleText: cell('role'), access: cell('access'), active: !/^(no|n|inactive|left)$/i.test(cell('active')), password: cell('pw') };
        x.role = roleOfText(x.roleText);
        const why = [];
        if (!x.name) why.push('no name');
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x.email)) why.push('email not valid');
        else if (seen.has(x.email)) why.push('email repeated in the file');
        seen.add(x.email);
        if (!x.roleText) why.push('no role');
        if (x.role === 'viewer' || x.role === 'spoc') {
          if (!x.access) why.push('Access needed for ' + ROLE_LABEL[x.role]);
          else { const bad = x.access.split(',').map(a => a.trim()).filter(a => a && !validAccess.has(a.toUpperCase())); if (bad.length) why.push('unknown Access: ' + bad.join(', ')); }
        } else x.access = 'All';
        if (x.password && x.password.length < 6) why.push('password under 6 characters');
        x.why = why.join(', ');
        x.isNew = !known.has(x.email);
        // renaming an L&D person splits their entries under two names, so say so
        x.rename = !x.isNew && nameOf[x.email] && nameOf[x.email] !== x.name ? nameOf[x.email] : '';
        list.push(x);
      });
      const ok = list.filter(x => !x.why);
      const nNew = ok.filter(x => x.isNew).length;
      box.innerHTML = `
        <div class="${ok.length === list.length ? 'ok-box' : 'warn-box'}" style="margin-top:10px"><b>${esc(file.name)}</b>: ${list.length} user(s) read · <b>${nNew} new</b> · ${ok.length - nNew} update existing${list.length - ok.length ? ` · <b>${list.length - ok.length} with problems</b> (skipped)` : ''}</div>
        <div class="table-wrap tall" style="margin-top:8px"><table><thead><tr><th class="n">Row</th><th>Name</th><th>Email</th><th>Role</th><th>Access</th><th>Status</th><th></th></tr></thead><tbody>
        ${list.map(x => `<tr><td class="n">${x.row}</td><td>${esc(x.name)}</td><td>${esc(x.email)}</td><td>${esc(ROLE_LABEL[x.role])}<span class="muted">${x.roleText && ROLE_LABEL[x.role].toLowerCase() !== x.roleText.toLowerCase() ? ' (' + esc(x.roleText) + ')' : ''}</span></td><td>${esc(x.access)}</td><td>${x.active ? 'Active' : 'Inactive'}</td>
          <td>${x.why ? `<span class="pill bad">${esc(x.why)}</span>` : x.isNew ? '<span class="pill good">New</span>' : x.rename ? `<span class="pill warn">Update · name was ${esc(x.rename)}</span>` : '<span class="pill neutral">Update</span>'}</td></tr>`).join('')}
        </tbody></table></div>
        <div class="actions" style="margin-top:10px"><button class="btn btn-primary" id="uu-go" type="button"${ok.length ? '' : ' disabled'}>Save ${ok.length} user(s)</button><span id="uu-msg" class="muted">${ok.some(x => x.rename) ? '<b>Name changes:</b> new entries will show the new name; keep L&amp;D names as they appear on entries. ' : ''}Users without a password set their own with <b>Forgot password?</b></span></div>`;
      $('#uu-go').onclick = async () => {
        const btn = $('#uu-go'); btn.disabled = true; btn.textContent = 'Saving…';
        try {
          const r = await api('saveUsers', { users: ok.map(x => ({ row: x.row, name: x.name, email: x.email, role: x.role, access: x.access, active: x.active, password: x.password })) });
          toast(`Users saved: ${r.added} added, ${r.updated} updated${r.errors.length ? `, ${r.errors.length} not saved` : ''}`, 6000);
          if (r.errors.length) { $('#uu-msg').innerHTML = `<span class="form-error">Not saved: ${esc(r.errors.map(x => 'row ' + x.row + ' ' + x.email + ' – ' + x.error).join(' · '))}</span>`; btn.textContent = 'Saved'; setTimeout(render, 6000); }
          else render();
        } catch (err) { if (err.message !== 'AUTH') { btn.disabled = false; btn.textContent = 'Save users'; $('#uu-msg').innerHTML = `<span class="form-error">${esc(err.message)}</span>`; } }
      };
    };
  }

  /* ---------------------------------------------------------------- Account */
  function openAccount() {
    openDrawer(`
      <div class="drawer-head"><div><h1>${esc(S.user.name)}</h1><p class="muted">${esc(S.user.email)} · ${S.user.role === 'admin' ? 'Admin' : S.user.role === 'viewer' ? 'View only · ' + esc(scopeLabel()) : S.user.role === 'spoc' ? 'L&D SPOC · ' + esc(scopeLabel()) : 'L&D'}</p></div><button class="btn" data-close type="button">Close</button></div>
      <section class="panel"><h2>Change password</h2><p class="note" style="margin-top:4px">Forgot your current password? Sign out and use <b>Forgot password?</b> on the sign-in page.</p>
        <div class="form-grid" style="margin-top:10px">
          <div class="field"><label for="pw-old">Current password</label><input id="pw-old" type="password" autocomplete="current-password"></div>
          <div class="field"><label for="pw-new">New password</label><input id="pw-new" type="password" autocomplete="new-password" placeholder="min 6 characters"></div>
        </div>
        <div class="actions" style="margin-top:10px"><button class="btn btn-primary" id="pw-save" type="button">Change password</button><span id="pw-msg"></span></div></section>
      <section class="panel"><div class="actions"><button class="btn btn-danger" id="logout-btn" type="button">Sign out</button></div></section>`);
    $('#pw-save').onclick = async () => {
      try { await api('changePassword', { oldPassword: $('#pw-old').value, newPassword: $('#pw-new').value }); $('#pw-msg').innerHTML = '<span class="pill good">Password changed</span>'; $('#pw-old').value = ''; $('#pw-new').value = ''; }
      catch (err) { if (err.message !== 'AUTH') $('#pw-msg').innerHTML = `<span class="form-error">${esc(err.message)}</span>`; }
    };
    $('#logout-btn').onclick = () => logout('You have signed out.');
  }

  /* ---------------------------------------------------------------- Excel export */
  function exportExcel() {
    if (S.user && S.user.role === 'viewer') return;
    if (!S.M || !window.XLSX) { toast('Export is not ready yet. Try again in a moment.'); return; }
    const M = S.M; const wb = XLSX.utils.book_new();
    const add = (name, rows, widths) => { const ws = XLSX.utils.aoa_to_sheet(rows); if (widths) ws['!cols'] = widths.map(w => ({ wch: w })); XLSX.utils.book_append_sheet(wb, ws, name); };
    const r1 = v => (v == null ? '' : Math.round(v * 10) / 10), r2 = v => (v == null ? '' : Math.round(v * 100) / 100);
    const modNames = M.modules.map(m => m.name);

    add('Attendance', [['Date', 'Chauffeur Code', 'Chauffeur Name', 'Location', 'Module', 'Duration (mins)', 'L&D', 'Remarks'].concat(Q_LABELS.map((q, i) => `Q${i + 1} ${q}`), ['Avg Rating', 'In FY'])]
      .concat(M.att.slice().sort((a, b) => a.date.localeCompare(b.date)).map(a => [a.date, a.code, a.c ? a.c.name : '', a.loc, a.module, a.mins, a.trainer, a.remarks].concat(a.q.map(v => (v === '' ? '' : v)), [r2(a.rating), a.inFY ? 'Yes' : 'No']))),
    [12, 12, 26, 16, 34, 10, 18, 22, 8, 8, 8, 8, 8, 8, 8, 8, 9, 7]);

    add('Chauffeur Summary', [['Code', 'Name', 'Location', 'Mobile', 'Driver Type', 'Category', 'DOJ', 'DOL'].concat(M.extraCols, ['In FY Scope', 'Trainings (FY)', 'Manhours (FY)', 'First Training', 'Last Training', 'L&D'], modNames)]
      .concat(M.chList.map(c => [c.code, c.name, c.loc, c.mobile, c.type, c.cat, c.doj, c.dol].concat(c.extra.map(v => (v == null ? '' : v)), [c.inScope ? 'Yes' : 'No', c.n, r1(c.mins / 60), c.first, c.last, Object.keys(c.trainers).join(', ')], modNames.map(m => c.mods[m] || 0)))),
    [10, 26, 16, 12, 10, 11, 11, 10, 10, 10, 11, 11, 30]);

    const locRows = M.locations.map(l => { const c = M.scoped.filter(x => x.loc === l); const a = M.fyAtt.filter(x => x.loc === l); const s = summarize(c, a);
      return [l, s.chauffeurs, s.trained, s.chauffeurs ? r1(s.trained / s.chauffeurs * 100) : 0, s.never, s.attendances, r1(s.hours), s.responses, r2(s.rating)].concat(modNames.map(m => a.filter(x => x.module === m).length)); });
    const tot = summarize(M.scoped, M.fyAtt);
    add('Location Summary', [['Location', 'Chauffeurs', 'Trained', 'Coverage %', 'Never Trained', 'Attendees', 'Manhours', 'Feedback Responses', 'Avg Rating'].concat(modNames)].concat(locRows,
      [['TOTAL', tot.chauffeurs, tot.trained, r1(tot.trained / tot.chauffeurs * 100), tot.never, tot.attendances, r1(tot.hours), tot.responses, r2(tot.rating)].concat(modNames.map(m => M.fyAtt.filter(x => x.module === m).length))]), [18, 11, 9, 11, 13, 12, 11, 12, 10]);

    add('L&D Summary', [['L&D', 'Total Sessions', 'Participants', 'Unique', 'Manhours', 'Feedback Responses', 'Avg Feedback rating']].concat(trainerRows(M.fyAtt).sort((a, b) => b.att - a.att).map(r => [r.trainer, r.sessions, r.att, r.people, r1(r.hours), r.responses, r2(r.rating)])), [20, 10, 12, 11, 11, 12, 10]);
    add('Module Summary', [['Module', 'Duration (mins)', 'Participants', 'Unique', 'Manhours']].concat(moduleRows(M.scoped, M.fyAtt).map(r => [r.module, r.dur, r.att, r.people, r1(r.hours)])), [36, 14, 12, 16, 11]);
    const byM = groupBy(M.fyAtt, a => a.date.slice(0, 7));
    add('Monthly', [['Month', 'Attendees', 'Manhours', 'Feedback Responses', 'Avg Rating'].concat(modNames)].concat(M.months.map(m => { const l = byM.get(m) || []; const r = l.filter(a => a.rating != null);
      return [monthLabel(m), l.length, r1(l.reduce((s, a) => s + a.mins, 0) / 60), r.length, r2(avg(r.map(a => a.rating)))].concat(modNames.map(n => l.filter(a => a.module === n).length)); })), [10, 12, 11, 12, 10]);
    add('Feedback by Question', [['Question', 'Average', 'Responses', '5', '4', '3', '2', '1']].concat(Q_LABELS.map((q, i) => { const v = M.fyAtt.map(a => a.q[i]).filter(x => x !== '' && x != null);
      return [`Q${i + 1}. ${q}`, r2(avg(v)), v.length].concat([5, 4, 3, 2, 1].map(k => v.filter(x => x === k).length)); })), [36, 10, 10, 6, 6, 6, 6, 6]);

    const d = new Date();
    XLSX.writeFile(wb, `Chauffeur_Training_${M.fyLabel.replace(/\s+/g, '')}_${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.xlsx`);
    toast('Excel file downloaded');
  }

  /* ---------------------------------------------------------------- boot */
  // A personal view link looks like https://site/#k=<key>: sign in with it, then remove it from the address bar.
  async function boot() {
    const m = location.hash.match(/^#k=([A-Za-z0-9]+)$/);
    if (m) {
      history.replaceState(null, '', location.pathname + location.search);
      try {
        const out = await api('linkLogin', { key: m[1] });
        S.token = out.token; S.user = { name: out.name, role: out.role, email: out.email };
        store.set(LS.token, S.token); store.set(LS.user, JSON.stringify(S.user));
        return start(true);
      } catch (err) { return showLogin(err.message); }
    }
    if (S.token) start(); else showLogin();
  }
  boot();
  // keep the dashboard live: refresh every 5 minutes while the tab is visible
  setInterval(() => { if (S.token && S.M && document.visibilityState === 'visible' && S.view !== 'add' && S.view !== 'admin') load().catch(() => {}); }, 5 * 60 * 1000);
})();
