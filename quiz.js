/* Welcome Check (public, no login): quiz.html = before induction, quiz.html#post = after induction.
   Details (code / name / mobile / branch / DOJ) -> 15 questions (A-D) -> score.
   Scoring happens in the Apps Script; this page never has the answer key. */
(function () {
  'use strict';
  const API = (window.APP_CONFIG && window.APP_CONFIG.API_URL) || '';
  const L = window.QUIZ_I18N;
  const $ = s => document.querySelector(s);
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } } };
  const stage = /post/i.test(location.hash) ? 'post' : 'pre';
  let lang = store.get('qz_lang') || 'hi';
  if (!L[lang]) lang = 'en';
  const S = { step: 'who', who: {}, a: [], err: '', res: null, branches: null, noCode: false };
  const T = () => L[lang];
  const LETTERS = ['A', 'B', 'C', 'D'];
  const ERR = { QZ_INCOMPLETE: 'needDetails', FB_BUSY: 'busy' };

  async function call(payload) {
    let res;
    try { res = await fetch(API, { method: 'POST', body: JSON.stringify(payload) }); } catch (e) { throw new Error('error'); }
    const out = await res.json().catch(() => ({ ok: false, error: 'error' }));
    if (!out.ok) throw new Error(ERR[out.error] || 'error');
    return out;
  }

  const langBar = () => `<div class="langs">${Object.keys(L).map(k => `<button type="button" data-lang="${k}" class="${k === lang ? 'on' : ''}">${esc(L[k].name)}</button>`).join('')}</div>`;
  const wireLang = () => document.querySelectorAll('[data-lang]').forEach(b => b.onclick = () => { readWho(); lang = b.dataset.lang; store.set('qz_lang', lang); document.documentElement.lang = lang; render(); });
  const errBox = () => (S.err ? `<div class="msg bad">${esc(T().ui[S.err] || T().ui.error)}</div>` : '');
  function readWho() {
    if (S.step !== 'who' || !$('#q-name')) return;
    S.who = { code: S.noCode ? '' : $('#q-code').value.trim(), name: $('#q-name').value.trim(), mobile: $('#q-mob').value.trim(), branch: $('#q-br').value, doj: $('#q-doj').value };
  }

  function render() {
    const t = T(), u = t.ui, app = $('#app');
    $('#t-title').textContent = u.title;
    $('#t-sub').textContent = u[stage] + ' · ECO Mobility';
    document.title = u.title + ' · ECO Mobility';

    if (S.step === 'done') {
      const r = S.res;
      app.innerHTML = `<div class="card">${langBar()}
          <div class="msg ok">${esc(u.thanks)}, ${esc(r.name)}<div class="big">${esc(u.score)}: ${r.score} / ${r.outOf}</div><div>${esc(r.pass ? u.pass : u.below)}</div></div>
          <button class="btn btn-ghost" id="again" type="button">${esc(u.again)}</button></div>`;
      wireLang();
      $('#again').onclick = () => { S.step = 'who'; S.who = {}; S.a = []; S.err = ''; S.res = null; S.noCode = false; render(); window.scrollTo(0, 0); };
      return;
    }

    if (S.step === 'who') {
      const br = S.branches || [];
      app.innerHTML = `<div class="card">${langBar()}
          <p class="hint">${esc(u.intro)}</p>
          <div ${S.noCode ? 'hidden' : ''}><label for="q-code">${esc(u.code)}</label><input type="text" id="q-code" inputmode="numeric" autocomplete="off" value="${esc(S.who.code || '')}"></div>
          <label class="nocode"><input type="checkbox" id="q-nocode"${S.noCode ? ' checked' : ''}> <span>${esc(u.noCode)}</span></label>
          <label for="q-name">${esc(u.name)}</label><input type="text" id="q-name" autocomplete="name" value="${esc(S.who.name || '')}">
          <label for="q-mob">${esc(u.mobile)}</label><input type="tel" id="q-mob" inputmode="tel" maxlength="14" value="${esc(S.who.mobile || '')}">
          <label for="q-br">${esc(u.branch)}</label>${br.length ? `<select id="q-br"><option value="">${esc(u.pickBranch)}</option>${br.map(b => `<option${b === S.who.branch ? ' selected' : ''}>${esc(b)}</option>`).join('')}</select>` : `<input type="text" id="q-br" value="${esc(S.who.branch || '')}">`}
          <label for="q-doj">${esc(u.doj)}</label><input type="date" id="q-doj" value="${esc(S.who.doj || '')}">
        </div>${errBox()}<button class="btn" id="q-start" type="button">${esc(u.start)}</button>`;
      wireLang();
      $('#q-nocode').onchange = e => { readWho(); S.noCode = e.target.checked; render(); };
      $('#q-start').onclick = () => {
        readWho();
        if (!S.who.name || S.who.mobile.replace(/\D/g, '').length < 10 || !S.who.branch) { S.err = 'needDetails'; return render(); }
        S.err = ''; S.step = 'quiz'; render(); window.scrollTo(0, 0);
      };
      return;
    }

    // questions
    app.innerHTML = `<div class="card">${langBar()}<div class="who">${esc(S.who.name)}</div>
        ${t.q.map((q, k) => `<div class="q"><p><span class="num">${k + 1}.</span>${esc(q[0])}</p><div class="opts">
          ${q[1].map((o, j) => `<button type="button" data-a="${k}:${j}" class="${S.a[k] === j ? 'on' : ''}"><b>${LETTERS[j]}</b><span>${esc(o)}</span></button>`).join('')}</div></div>`).join('')}
      </div>${errBox()}
      <div class="row"><button class="btn btn-ghost" id="q-back" type="button">${esc(u.back)}</button><button class="btn" id="q-send" type="button">${esc(u.submit)}</button></div>`;
    wireLang();
    document.querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
      const [k, j] = b.dataset.a.split(':').map(Number); S.a[k] = j;
      b.parentNode.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    });
    $('#q-back').onclick = () => { S.step = 'who'; S.err = ''; render(); };
    $('#q-send').onclick = async () => {
      const n = t.q.length;
      if (S.a.filter(v => v != null).length !== n) {
        S.err = 'answerAll'; render();
        const first = Array.from({ length: n }, (_, k) => k).find(k => S.a[k] == null);
        const el = document.querySelectorAll('.q')[first]; if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      const btn = $('#q-send'); btn.disabled = true; btn.textContent = '…';
      try {
        S.res = await call(Object.assign({ action: 'quizSubmit', stage, answers: S.a.slice(0, n) }, S.who));
        S.err = ''; S.step = 'done'; render(); window.scrollTo(0, 0);
      } catch (err) { S.err = err.message; render(); }
    };
  }

  document.documentElement.lang = lang;
  render();
  call({ action: 'quizOptions' }).then(r => { S.branches = r.branches || []; if (S.step === 'who') { readWho(); render(); } }).catch(() => { S.branches = []; });
})();
