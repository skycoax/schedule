// «Моя группа»: вопрос «Ты учишься в группе …?» с группой, открытой в приложении, и строка «Моя группа» в своём профиле.
// Сервер добавляет этот файл в страницу приложения (site.js): исходники приложения живут отдельно. API — social/mygroup.js.
// Спрашиваем только того, кто вошёл и ещё не отвечал; «Не скажу» — тоже ответ. Крестик — спросим в следующий раз.
// Ответ видят только разработчик и модераторы (аудит на /analytics); со статистикой заходов он не связывается.
(function () {
  'use strict';
  var path = location.pathname;
  if (path !== '/' && path !== '/index.html') return;

  var brand = {};
  try { brand = JSON.parse((document.getElementById('brand') || {}).textContent || '{}') || {}; } catch (e) { brand = {}; }
  var UNI = brand.hub && brand.id ? brand.id : '';
  var withUni = function (p) { return UNI ? p + (p.indexOf('?') < 0 ? '?' : '&') + 'uni=' + encodeURIComponent(UNI) : p; };

  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function cookie(k) { var m = document.cookie.match(new RegExp('(?:^|; )' + k + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : null; }
  function api(p, body) {
    var init = { credentials: 'same-origin', headers: { 'X-Para': '1' } };
    if (body !== undefined) { init.method = 'POST'; init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
    return fetch(withUni(p), init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!j.ok) { var e = new Error(j.error || 'Ошибка'); e.status = r.status; throw e; }
        return j.data;
      });
    });
  }
  function h(tag, attrs, kids) {
    var n = document.createElement(tag);
    for (var k in attrs || {}) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'text') n.textContent = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }

  // Группа, открытая в приложении (ключ «лист :: название»), — только у студента.
  function appGroup() {
    if ((get('role') || cookie('role')) === 'teacher') return null;
    var g = get('group') || cookie('group');
    return g ? { key: g, name: g.split(' :: ').pop() } : null;
  }

  var me = null;   // ответ GET /api/social/mygroup; null — ещё не знаем или гость
  var PRIVACY = 'Группу видят только модераторы Para — чтобы понимать, с каких курсов и факультетов люди. Что ты смотришь в расписании, остаётся обезличенным.';

  var CSS = ':host{all:initial}*{box-sizing:border-box}'
    + '.card{position:fixed;left:12px;right:12px;z-index:20;max-width:440px;margin:0 auto;bottom:calc(var(--tabbar-space,72px) + 12px);padding:14px;border-radius:22px;'
    + 'background:var(--sheet-bg,rgba(255,255,255,.94));color:var(--ink-100,#1c1c1e);-webkit-backdrop-filter:blur(24px) saturate(180%);backdrop-filter:blur(24px) saturate(180%);'
    + 'box-shadow:inset 0 0 0 1px var(--glass-edge,rgba(60,60,67,.1)),var(--glass-shadow,0 6px 20px rgba(0,0,0,.14));'
    + 'font:15px/1.35 var(--font,-apple-system,system-ui,sans-serif);letter-spacing:-.01em;animation:in .45s cubic-bezier(.2,.9,.25,1)}'
    + '@keyframes in{from{transform:translateY(140%);opacity:0}}'
    + '.top{display:flex;gap:12px;align-items:flex-start;padding-right:18px}'
    + '.i{flex:none;width:40px;height:40px;border-radius:12px;display:grid;place-items:center;font-size:22px;background:var(--accent-press,rgba(0,122,255,.12))}'
    + '.q{font-weight:600}.g{display:block;font-weight:700;margin-top:1px;overflow-wrap:anywhere}'
    + '.row{display:flex;gap:6px;margin-top:12px}'
    + '.btn{flex:1;border:0;border-radius:12px;padding:9px 8px;background:var(--accent-press,rgba(0,122,255,.12));color:var(--accent,#007aff);font:inherit;font-weight:600;font-size:14px;cursor:pointer;-webkit-tap-highlight-color:transparent}'
    + '.btn.main{background:var(--accent,#007aff);color:#fff}'
    + '.btn.ghost{background:transparent;color:var(--ink-60,rgba(60,60,67,.62))}'
    + '.btn:active{transform:scale(.97)}'
    + '.note{margin-top:10px;font-size:12px;line-height:1.35;color:var(--ink-60,rgba(60,60,67,.62))}'
    + '.x{position:absolute;top:8px;right:8px;width:28px;height:28px;border-radius:50%;border:0;background:var(--surface-2,#f2f2f7);color:var(--ink-60);font-size:16px;cursor:pointer}'
    + '.bg{position:fixed;inset:0;z-index:70;background:rgba(0,0,0,.36)}'
    + '.sh{position:fixed;left:0;right:0;bottom:0;z-index:71;max-width:480px;margin:0 auto;height:86vh;display:flex;flex-direction:column;'
    + 'padding:12px 16px calc(14px + env(safe-area-inset-bottom));border-radius:24px 24px 0 0;background:var(--surface,#fff);color:var(--ink-100,#1c1c1e);'
    + 'font:15px/1.35 var(--font,-apple-system,system-ui,sans-serif);letter-spacing:-.01em;box-shadow:0 -10px 40px rgba(0,0,0,.18);animation:up .32s cubic-bezier(.2,.9,.25,1)}'
    + '@keyframes up{from{transform:translateY(100%)}}'
    + '@media (min-width:600px){.sh{bottom:7vh;border-radius:24px}}'
    + 'h2{font-size:21px;line-height:1.2;margin:4px 36px 2px 0;letter-spacing:-.02em}'
    + '.sub{font-size:13px;color:var(--ink-60,rgba(60,60,67,.62));margin:0 0 10px}'
    + 'input{width:100%;padding:10px 12px;border:0;border-radius:12px;background:var(--surface-2,#f2f2f7);color:var(--ink-100);font:inherit;outline:none}'
    + 'input:focus{box-shadow:0 0 0 2px var(--accent,#007aff)}'
    + '.list{flex:1;overflow:auto;margin:8px -4px 0;padding:0 4px;-webkit-overflow-scrolling:touch}'
    + '.it{display:block;width:100%;text-align:left;border:0;background:none;padding:10px 6px;border-bottom:1px solid var(--separator,rgba(60,60,67,.12));color:var(--ink-100);font:inherit;cursor:pointer}'
    + '.it b{display:block;font-weight:600;font-size:14.5px;overflow-wrap:anywhere}.it span{font-size:12.5px;color:var(--ink-60,rgba(60,60,67,.62))}'
    + '.it.cur b::after{content:" ✓";color:var(--accent,#007aff)}'
    + '.more{padding:10px 6px;font-size:13px;color:var(--ink-60,rgba(60,60,67,.62))}'
    + '.err{color:var(--red-ink,#d70015);font-size:13.5px;margin-top:8px}'
    + '@media (prefers-reduced-motion:reduce){*{animation:none!important}}';

  function layer(attr) {
    var host = document.createElement('div');
    host.setAttribute(attr, '');
    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    root.appendChild(h('style', { text: CSS }));
    document.body.appendChild(host);
    return { host: host, root: root };
  }

  // ─── Вопрос при открытии: «Ты учишься в группе …?» ───
  var asked = false;
  function ask() {
    if (asked || !me || me.answered) return;
    var g = appGroup();
    if (!g) return;
    if (document.querySelector('[data-psy-nudge], [data-para-ref], [data-mygroup-pick]')) { setTimeout(ask, 2000); return; }
    asked = true;
    var L = layer('data-mygroup-ask');
    var err = h('div', { class: 'err', hidden: 'hidden' });
    var done = function () { L.host.remove(); };
    var send = function (grp) {
      return api('/api/social/mygroup', { grp: grp }).then(function (r) {
        me.answered = true; me.grp = r.grp; me.course = r.course || null; me.faculty = r.faculty || null; me.grpUniLabel = me.uniLabel;
        done(); profileRow(true);
      }, function (e) { err.textContent = e.message || 'Не получилось'; err.removeAttribute('hidden'); });
    };
    L.root.appendChild(h('div', { class: 'card', role: 'dialog', 'aria-label': 'Твоя группа' }, [
      h('button', { class: 'x', 'aria-label': 'Спросить потом', text: '×', onclick: done }),
      h('div', { class: 'top' }, [
        h('div', { class: 'i', text: '🎓' }),
        h('div', {}, [h('span', { class: 'q', text: 'Ты учишься в группе' }), h('span', { class: 'g', text: '«' + g.name + '»?' })]),
      ]),
      h('div', { class: 'row' }, [
        h('button', { class: 'btn main', text: 'Да, моя', onclick: function () { send(g.key); } }),
        h('button', { class: 'btn', text: 'Другая', onclick: function () { done(); pick(); } }),
        h('button', { class: 'btn ghost', text: 'Не скажу', onclick: function () { send(null); } }),
      ]),
      err,
      h('div', { class: 'note', text: PRIVACY + ' Поменять — в профиле.' }),
    ]));
  }

  // ─── Выбор группы из списка вуза ───
  var groupsCache = null;
  function pick() {
    var L = layer('data-mygroup-pick');
    var close = function () { L.host.remove(); document.removeEventListener('keydown', onKey); };
    var onKey = function (e) { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    var input = h('input', { type: 'search', placeholder: 'Название группы, курс или факультет', 'aria-label': 'Поиск группы', autocomplete: 'off' });
    var list = h('div', { class: 'list', role: 'listbox' }, [h('div', { class: 'more', text: 'Загружаю группы…' })]);
    var err = h('div', { class: 'err', hidden: 'hidden' });
    var save = function (grp) {
      api('/api/social/mygroup', { grp: grp }).then(function (r) {
        me.answered = true; me.grp = r.grp; me.course = r.course || null; me.faculty = r.faculty || null; me.grpUniLabel = me.uniLabel;
        close(); profileRow(true);
      }, function (e) { err.textContent = e.message || 'Не получилось'; err.removeAttribute('hidden'); });
    };
    var draw = function () {
      var words = input.value.toLowerCase().replace(/ё/g, 'е').split(/\s+/).filter(Boolean);
      var hits = groupsCache.filter(function (g) {
        var s = (g.name + ' ' + g.course + ' ' + g.faculty).toLowerCase().replace(/ё/g, 'е');
        return words.every(function (w) { return s.indexOf(w) >= 0; });
      });
      var shown = hits.slice(0, 80);
      list.replaceChildren.apply(list, shown.map(function (g) {
        return h('button', { class: 'it' + (me.grp === g.name ? ' cur' : ''), type: 'button', role: 'option', onclick: function () { save(g.name); } },
          [h('b', { text: g.name }), h('span', { text: [g.course, g.faculty].filter(Boolean).join(' · ') })]);
      }).concat(hits.length > shown.length ? [h('div', { class: 'more', text: 'Ещё ' + (hits.length - shown.length) + ' — уточни поиск' })] : [])
        .concat(hits.length ? [] : [h('div', { class: 'more', text: 'Ничего не нашлось' })]));
    };
    input.addEventListener('input', draw);
    L.root.appendChild(h('div', { class: 'bg', onclick: close }));
    L.root.appendChild(h('div', { class: 'sh', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Моя группа' }, [
      h('button', { class: 'x', 'aria-label': 'Закрыть', text: '×', onclick: close }),
      h('h2', { text: 'Моя группа' }),
      h('p', { class: 'sub', text: (me.uniLabel ? me.uniLabel + '. ' : '') + PRIVACY }),
      input, err, list,
      h('div', { class: 'row' }, [h('button', { class: 'btn ghost', text: me.grp ? 'Убрать группу' : 'Не скажу', onclick: function () { save(null); } })]),
    ]));
    (groupsCache ? Promise.resolve(groupsCache) : api('/api/social/mygroup?list=1').then(function (d) { groupsCache = d.groups || []; return groupsCache; }))
      .then(draw, function (e) { list.replaceChildren(h('div', { class: 'err', text: e.message || 'Не получилось загрузить группы' })); });
  }

  // ─── Строка «Моя группа» в своём профиле (экран с настройками — .set-row / .ui-switch) ───
  function rowText() {
    if (!me) return '';
    if (me.grp) return me.grp + (me.course ? ' · ' + me.course : '');
    return me.answered ? 'Не указана' : 'Укажи — это займёт секунду';
  }
  function profileRow(refresh) {
    if (!me) return;
    document.querySelectorAll('.prof-screen').forEach(function (scr) {
      var old = scr.querySelector('[data-mygroup-prof]');
      if (old && !refresh) return;
      if (!scr.querySelector('.set-row, .ui-switch')) return;
      var b = h('button', { 'data-mygroup-prof': '', type: 'button', onclick: pick, style: 'display:flex;align-items:center;gap:12px;width:100%;margin:0 0 14px;padding:12px 14px;border:0;border-radius:18px;'
        + 'background:var(--surface-2,#f2f2f7);color:var(--ink-100);font:inherit;text-align:left;cursor:pointer' }, [
        h('span', { style: 'font-size:24px', text: '🎓' }),
        h('span', { style: 'flex:1;min-width:0' }, [
          h('b', { style: 'display:block;font-size:15px', text: 'Моя группа' }),
          h('span', { style: 'display:block;font-size:13px;color:var(--ink-60);overflow:hidden;text-overflow:ellipsis;white-space:nowrap', text: rowText() }),
        ]),
        h('span', { style: 'color:var(--ink-30);font-size:20px', text: '›' }),
      ]);
      if (old) { old.replaceWith(b); return; }
      var ref = scr.querySelector('[data-ref-prof]');
      if (ref) ref.after(b); else scr.insertBefore(b, scr.firstChild);
    });
  }

  function load() {
    return api('/api/social/mygroup').then(function (d) { me = d; return d; }, function () { me = null; return null; });
  }

  var queued = false, loadedAt = 0;
  new MutationObserver(function () {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () {
      queued = false;
      if (!document.querySelector('.prof-screen .set-row, .prof-screen .ui-switch')) return;
      if (me) { profileRow(false); return; }
      // Свой профиль открыли до ответа сервера или после входа — узнаём группу заново (не чаще раза в 20 секунд).
      if (Date.now() - loadedAt < 20000) return;
      loadedAt = Date.now();
      load().then(function () { profileRow(false); });
    });
  }).observe(document.documentElement, { childList: true, subtree: true });

  // Ждём, пока уйдёт экран запуска; спрашиваем чуть позже приглашения на тест, чтобы не налезать на него.
  var waited = 0;
  (function waitBoot() {
    var boot = document.getElementById('boot');
    if (boot && !boot.classList.contains('is-done') && waited < 15000) { waited += 300; setTimeout(waitBoot, 300); return; }
    setTimeout(function () { loadedAt = Date.now(); load().then(ask); }, 2800);
  })();
})();
