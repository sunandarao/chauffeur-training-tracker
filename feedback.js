/* Chauffeur feedback form (public, no login).
   Common QR (feedback.html): code + name + mobile -> pick Trainer + Module -> rate Q1..Q8 -> saved.
   Session link (feedback.html#s=<id>): pick name from that session -> code -> rate.
   The server matches ratings to the attendance row (or holds them until the trainer saves the session). */
(function () {
  'use strict';
  const API = (window.APP_CONFIG && window.APP_CONFIG.API_URL) || '';
  const L = window.FB_I18N, DEF = window.FB_DEFAULT_LANG || {};
  const $ = s => document.querySelector(s);
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const linkId = (location.hash.match(/s=([A-Za-z0-9]{12})/) || [])[1] || '';
  const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } } };
  let lang = store.get('fb_lang');
  let langChosen = !!lang;
  const S = { mode: linkId ? 'session' : 'common', step: linkId ? 'name' : 'who', q: [], err: '', search: '', who: {}, me: null, opts: null, session: null, pick: null, fatal: '' };
  const T = () => L[lang] || L.en;

  const ERR = { FB_EXPIRED: 'expired', FB_INVALID: 'invalid', FB_CODE: 'wrongCode', FB_DONE: 'done', FB_BUSY: 'busy', FB_INCOMPLETE: 'answerAll' };
  async function call(payload) {
    let res;
    try { res = await fetch(API, { method: 'POST', body: JSON.stringify(payload) }); } catch (e) { throw new Error('error'); }
    const out = await res.json().catch(() => ({ ok: false, error: 'error' }));
    if (!out.ok) throw new Error(ERR[out.error] || 'error');
    return out;
  }

  function setLang(k, manual) {
    lang = k; document.documentElement.lang = k;
    if (manual) { langChosen = true; store.set('fb_lang', k); }
    render();
  }
  const langBar = () => `<div class="langs" role="group" aria-label="Language">${Object.keys(L).map(k => `<button type="button" data-lang="${k}" class="${k === lang ? 'on' : ''}">${esc(L[k].name)}</button>`).join('')}</div>`;
  const wireLang = () => document.querySelectorAll('[data-lang]').forEach(b => b.onclick = () => setLang(b.dataset.lang, true));
  const questions = t => `<div class="card"><p class="hint">${esc(t.ui.rateHint)}</p>
      ${t.q.map((txt, k) => `<div class="q"><p><span class="num">Q${k + 1}.</span>${esc(txt)}</p><div class="scale" role="group">${[1, 2, 3, 4, 5].map(v => `<button type="button" data-q="${k}:${v}" class="${S.q[k] === v ? 'on' : ''}" aria-label="Q${k + 1} ${v}">${v}</button>`).join('')}</div></div>`).join('')}
    </div>`;
  const wireQuestions = () => document.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { const [k, v] = b.dataset.q.split(':').map(Number); S.q[k] = v; b.parentNode.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); });
  const errBox = t => (S.err ? `<div class="msg bad">${esc(t.ui[S.err] || t.ui.error)}</div>` : '');

  function render() {
    const t = T();
    $('#t-title').textContent = t.ui.title;
    document.title = t.ui.title + ' · ECO Mobility';
    const app = $('#app');
    if (S.fatal) { app.innerHTML = `<div class="card">${langBar()}<div class="msg bad">${esc(t.ui[S.fatal] || t.ui.error)}</div></div>`; wireLang(); return; }

    if (S.step === 'thanks') {
      app.innerHTML = `<div class="card"><div class="msg ok">${esc(t.ui.thanks)}</div><button class="btn btn-ghost" id="again" type="button">${esc(t.ui.another)}</button></div>`;
      $('#again').onclick = () => { S.q = []; S.err = ''; S.me = null; S.who = {}; S.pick = null; S.search = ''; S.step = S.mode === 'session' ? 'name' : 'who'; render(); window.scrollTo(0, 0); };
      return;
    }

    /* ---------- common QR mode ---------- */
    if (S.mode === 'common') {
      if (S.step === 'who') {
        const bi = k => `${esc(L.en.ui[k])}<span class="bi">${esc(L.hi.ui[k])}</span>`;
        $('#t-title').innerHTML = `${esc(L.en.ui.title)} <span class="bi-inline">· ${esc(L.hi.ui.title)}</span>`;
        app.innerHTML = `<div class="card">
            <label for="f-code">${bi('code')}</label><input type="text" id="f-code" inputmode="numeric" autocomplete="off" value="${esc(S.who.code || '')}">
            <label for="f-name">${bi('yourName')}</label><input type="text" id="f-name" autocomplete="name" value="${esc(S.who.name || '')}">
            <label for="f-mob">${bi('mobile')}</label><input type="tel" id="f-mob" inputmode="tel" autocomplete="tel" maxlength="14" value="${esc(S.who.mobile || '')}">
          </div>${S.err ? `<div class="msg bad">${esc(L.en.ui[S.err] || L.en.ui.error)}<br>${esc(L.hi.ui[S.err] || L.hi.ui.error)}</div>` : ''}<button class="btn" id="f-next" type="button">${esc(L.en.ui.next)} / ${esc(L.hi.ui.next)}</button>`;
        $('#f-next').onclick = async () => {
          S.who = { code: $('#f-code').value.trim(), name: $('#f-name').value.trim(), mobile: $('#f-mob').value.trim() };
          if (!S.who.code || !S.who.name || !S.who.mobile) { S.err = 'notFound'; return render(); }
          const btn = $('#f-next'); btn.disabled = true; btn.textContent = '…';
          try {
            const r = await call({ action: 'fbCheck', code: S.who.code, name: S.who.name, mobile: S.who.mobile });
            S.me = r; S.err = ''; S.step = 'lang'; S.allLangs = false;
            if (!S.opts) S.opts = await call({ action: 'fbOptions' });
            render(); window.scrollTo(0, 0);
          } catch (err) { S.err = err.message === 'wrongCode' ? 'notFound' : err.message; render(); }
        };
        return;
      }
      if (S.step === 'lang') {
        $('#t-title').innerHTML = `${esc(L.en.ui.title)} <span class="bi-inline">· ${esc(L.hi.ui.title)}</span>`;
        const local = DEF[String(S.me.location || '').toUpperCase()];
        const main = ['en'].concat(local && local !== 'hi' ? [local] : [], ['hi']);
        const rest = Object.keys(L).filter(k => !main.includes(k));
        app.innerHTML = `<div class="card">
            <div class="who">${esc(L.en.ui.hello)}, ${esc(S.me.name)}</div>
            <h2>Choose your language<span class="bi">${local && local !== 'hi' ? esc(L[local].ui.chooseLang) + ' · ' : ''}${esc(L.hi.ui.chooseLang)}</span></h2>
            <div class="langbig">${main.map(k => `<button type="button" data-pick="${k}">${esc(L[k].name)}</button>`).join('')}</div>
            ${S.allLangs ? `<div class="langbig small">${rest.map(k => `<button type="button" data-pick="${k}">${esc(L[k].name)}</button>`).join('')}</div>` : `<button class="linkbtn" id="more-langs" type="button">Other languages</button>`}
          </div>`;
        document.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => { lang = b.dataset.pick; langChosen = true; store.set('fb_lang', lang); document.documentElement.lang = lang; S.step = 'rate'; render(); window.scrollTo(0, 0); });
        const more = $('#more-langs'); if (more) more.onclick = () => { S.allLangs = true; render(); };
        return;
      }
      // rate
      const o = S.opts || { trainers: [], modules: [] };
      app.innerHTML = `<div class="card">${langBar()}
          <div class="who">${esc(t.ui.hello)}, ${esc(S.me.name)}</div>
          <label for="f-tr">${esc(t.ui.trainer)}</label><select id="f-tr"><option value="">${esc(t.ui.select)}</option>${o.trainers.map(x => `<option${x === S.who.trainer ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select>
          <label for="f-mod">${esc(t.ui.module)}</label><select id="f-mod"><option value="">${esc(t.ui.select)}</option>${o.modules.map(x => `<option${x === S.who.module ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select>
        </div>${questions(t)}${errBox(t)}
        <div class="row"><button class="btn btn-ghost" id="back" type="button">${esc(t.ui.back)}</button><button class="btn" id="send" type="button">${esc(t.ui.submit)}</button></div>`;
      wireLang(); wireQuestions();
      $('#f-tr').onchange = e => { S.who.trainer = e.target.value; };
      $('#f-mod').onchange = e => { S.who.module = e.target.value; };
      $('#back').onclick = () => { S.step = 'who'; S.err = ''; render(); };
      $('#send').onclick = async () => {
        S.who.trainer = $('#f-tr').value; S.who.module = $('#f-mod').value;
        if (!S.who.trainer || !S.who.module || S.q.filter(Boolean).length !== T().q.length) { S.err = 'answerAll'; return render(); }
        const btn = $('#send'); btn.disabled = true; btn.textContent = '…';
        try {
          await call({ action: 'fbSubmitCommon', code: S.who.code, name: S.who.name, mobile: S.who.mobile, trainer: S.who.trainer, module: S.who.module, q: S.q });
          S.step = 'thanks'; render(); window.scrollTo(0, 0);
        } catch (err) { S.err = err.message === 'wrongCode' ? 'notFound' : err.message; render(); }
      };
      return;
    }

    /* ---------- session link mode ---------- */
    if (!S.session) { app.innerHTML = `<div class="center">${esc(t.ui.loading)}</div>`; return; }
    const items = S.session.items;
    const sessionLine = `<div class="session"><b>${esc(S.session.module)}</b> · ${esc(S.session.date)} · ${esc(S.session.trainer)}${S.session.location ? ' · ' + esc(S.session.location) : ''}</div>`;
    if (S.step === 'name') {
      if (!items.some(i => !i.done)) { app.innerHTML = `<div class="card">${langBar()}${sessionLine}<div class="msg ok">${esc(t.ui.allDone)}</div></div>`; wireLang(); return; }
      const qq = S.search.trim().toLowerCase();
      const list = items.filter(i => !qq || i.name.toLowerCase().includes(qq));
      app.innerHTML = `<div class="card">${langBar()}${sessionLine}<h2>${esc(t.ui.pickName)}</h2>
        ${items.length > 8 ? `<input type="search" id="search" placeholder="${esc(t.ui.search)}" value="${esc(S.search)}" autocomplete="off">` : ''}
        <div class="names">${list.map(i => `<button type="button" data-e="${esc(i.e)}"${i.done ? ' disabled' : ''}><span>${esc(i.name)}</span>${i.done ? `<span class="tag" title="${esc(t.ui.done)}">✓</span>` : ''}</button>`).join('')}</div></div>`;
      wireLang();
      const sb = $('#search');
      if (sb) sb.oninput = () => { S.search = sb.value; const p = sb.selectionStart; render(); const n = $('#search'); n.focus(); n.setSelectionRange(p, p); };
      document.querySelectorAll('.names button[data-e]').forEach(b => b.onclick = () => { S.pick = items.find(i => i.e === b.dataset.e); S.step = 'form'; S.err = ''; S.q = []; render(); window.scrollTo(0, 0); });
      return;
    }
    app.innerHTML = `<div class="card">${langBar()}${sessionLine}<div class="who">${esc(S.pick.name)}</div>
        <label for="code">${esc(t.ui.code)}</label><input type="text" id="code" inputmode="numeric" autocomplete="off" value="${esc(S.code || '')}"></div>
      ${questions(t)}${errBox(t)}
      <div class="row"><button class="btn btn-ghost" id="back" type="button">${esc(t.ui.back)}</button><button class="btn" id="send" type="button">${esc(t.ui.submit)}</button></div>`;
    wireLang(); wireQuestions();
    $('#code').oninput = e => { S.code = e.target.value; };
    $('#back').onclick = () => { S.step = 'name'; S.err = ''; render(); };
    $('#send').onclick = async () => {
      S.code = $('#code').value.trim();
      if (!S.code) { S.err = 'wrongCode'; return render(); }
      if (S.q.filter(Boolean).length !== T().q.length) { S.err = 'answerAll'; return render(); }
      const btn = $('#send'); btn.disabled = true; btn.textContent = '…';
      try {
        await call({ action: 'fbSubmit', s: linkId, e: S.pick.e, code: S.code, q: S.q });
        S.pick.done = true; S.code = ''; S.step = 'thanks'; render(); window.scrollTo(0, 0);
      } catch (err) { if (err.message === 'done') S.pick.done = true; S.err = err.message; render(); }
    };
  }

  async function start() {
    if (!lang || !L[lang]) lang = 'hi';
    document.documentElement.lang = lang;
    if (!API) { S.fatal = 'invalid'; return render(); }
    if (S.mode === 'common') { render(); call({ action: 'fbOptions' }).then(o => { S.opts = o; }).catch(() => {}); return; }
    render();
    try {
      S.session = await call({ action: 'fbSession', s: linkId });
      if (!langChosen) lang = DEF[String(S.session.location || '').toUpperCase()] || 'hi';
    } catch (err) { S.fatal = err.message; }
    render();
  }
  start();
})();
