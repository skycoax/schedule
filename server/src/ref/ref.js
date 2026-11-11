// «Позови друга»: окно со своей ссылкой, баллами и значками; засчитывание устройства друга, пришедшего по ссылке.
// Сервер добавляет этот файл в страницу приложения (site.js): исходники приложения живут отдельно.
// API — social/ref.js. Мем — одно короткое видео без звука (src/ref/*.mp4) с «пж, распространи»: котик девушке, обнимашки парню
// (пол — по фамилии на сервере или ответ самого человека). Друг получает просто ссылку и открывает Para как обычно — без мемов.
// Вход в окно: карточка над вкладками при каждом открытии, после неё — маленькая кнопка над часами;
// ещё карточка в своём профиле и адрес с #invite.
(function () {
  'use strict';
  var path = location.pathname;
  if (path !== '/' && path !== '/index.html') return;

  var brand = {};
  try { brand = JSON.parse((document.getElementById('brand') || {}).textContent || '{}') || {}; } catch (e) { brand = {}; }
  if (!brand.social || brand.social === 'off') return;
  var UNI = brand.hub && brand.id ? brand.id : '';
  var withUni = function (p) { return UNI ? p + (p.indexOf('?') < 0 ? '?' : '&') + 'uni=' + encodeURIComponent(UNI) : p; };

  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* нет хранилища */ } }
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

  // ─── Мем: одно зацикленное видео без звука — котик девушке, обнимашки парню ───
  // Пол — догадка сервера по фамилии/отчеству (/ref/me) или ответ самого человека; не знаем — окно спросит один раз.
  var CLIPS = {
    f: { src: '/ref/mad-angry.mp4', ratio: 610 / 640 },   // котик «ну пж»
    m: { src: '/ref/hug-bros.mp4', ratio: 288 / 162 },    // парни обнимаются
  };
  var G_KEY = 'ref_g';   // {g:'f'|'m', self:1|0}; ответ самого человека догадка сервера не перебивает
  function genderSaved() {
    try { var s = JSON.parse(get(G_KEY) || 'null'); } catch (e) { s = null; }
    return s && CLIPS[s.g] ? s : null;
  }
  function learnGender(g, self) {
    var s = genderSaved();
    if (!CLIPS[g] || (s && s.self && !self)) return s ? s.g : null;
    set(G_KEY, JSON.stringify({ g: g, self: self ? 1 : 0 }));
    return g;
  }
  var CALM = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Другу уходит обычная ссылка с одной строкой — без мемов и подписей.
  var SHARE_TEXT = 'Para — расписание пар всегда под рукой';
  var BADGE_ICON = { blue: '#1d9bf0', green: '#30b857', purple: '#a35ee8', heart: '❤️', fire: '🔥', star: '⭐', bolt: '⚡', gem: '💎', crown: '👑' };

  var CSS = ':host{all:initial}'
    + '*{box-sizing:border-box}'
    + '.bg{position:fixed;inset:0;z-index:70;background:rgba(0,0,0,.36);opacity:0;transition:opacity .25s}'
    + '.bg.on{opacity:1}'
    + '.sh{position:fixed;left:0;right:0;bottom:0;z-index:71;max-width:480px;margin:0 auto;max-height:92vh;overflow:auto;'
    + 'padding:10px 18px calc(20px + env(safe-area-inset-bottom));border-radius:24px 24px 0 0;background:var(--surface,#fff);color:var(--ink-100,#1c1c1e);'
    + 'font:15px/1.4 var(--font,-apple-system,BlinkMacSystemFont,system-ui,sans-serif);-webkit-font-smoothing:antialiased;letter-spacing:-.01em;'
    + 'transform:translateY(105%);transition:transform .38s cubic-bezier(.2,.9,.25,1);box-shadow:0 -10px 40px rgba(0,0,0,.18)}'
    + '.sh.on{transform:none}'
    + '@media (min-width:600px){.sh{bottom:50%;border-radius:24px;transform:translateY(60%) scale(.96);opacity:0;transition:transform .3s,opacity .3s}.sh.on{transform:translateY(50%);opacity:1}}'
    + '.grab{width:38px;height:5px;border-radius:9px;background:var(--ink-30,rgba(60,60,67,.3));margin:0 auto 8px}'
    + '.x{position:absolute;top:12px;right:14px;width:30px;height:30px;border-radius:50%;border:0;background:var(--surface-2,#f2f2f7);color:var(--ink-60);font-size:17px;cursor:pointer}'
    + 'h2{font-size:22px;line-height:1.2;margin:6px 34px 4px 0;letter-spacing:-.02em}'
    + 'p{margin:6px 0;color:var(--ink-60,rgba(60,60,67,.62));font-size:14.5px}'
    + '.meme{margin:10px 0 4px}'
    + '.meme video{display:block;height:200px;width:auto;max-width:100%;margin:0 auto;border-radius:16px;object-fit:cover;background:var(--surface-2,#f2f2f7)}'
    + '.swap{display:block;margin:6px auto 0;padding:4px 8px;border:0;background:none;color:var(--ink-30,rgba(60,60,67,.3));font:inherit;font-size:12.5px;cursor:pointer}'
    + '.ask{padding:14px;border-radius:16px;background:var(--surface-2,#f2f2f7);font-weight:600;text-align:center}'
    + '@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}'
    + '.lbl{font-size:12px;font-weight:600;color:var(--ink-30);text-transform:uppercase;letter-spacing:.06em;margin:14px 0 4px}'
    + '.link{display:flex;gap:8px;align-items:center;padding:6px 6px 6px 12px;border-radius:14px;background:var(--surface-2,#f2f2f7)}'
    + '.link code{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:13px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--ink-100)}'
    + '.btn{border:0;border-radius:12px;padding:10px 14px;background:var(--accent,#007aff);color:#fff;font:inherit;font-weight:600;font-size:15px;cursor:pointer;-webkit-tap-highlight-color:transparent}'
    + '.btn:active{transform:scale(.97)}'
    + '.btn.sec{background:var(--accent-press,rgba(0,122,255,.12));color:var(--accent,#007aff)}'
    + '.btn.sm{padding:7px 12px;font-size:14px}'
    + '.row{display:flex;gap:8px;margin-top:10px}.row .btn{flex:1}'
    + '.pts{display:flex;align-items:baseline;gap:10px;margin-top:14px}'
    + '.pts b{font-size:40px;letter-spacing:-.03em;line-height:1}.pts span{color:var(--ink-60);font-size:14px}'
    + '.bar{height:8px;border-radius:99px;background:var(--surface-2,#f2f2f7);overflow:hidden;margin:8px 0 2px}'
    + '.bar i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#34c759,#30b0c7);transition:width .6s}'
    + '.next{font-size:13px;color:var(--ink-60)}'
    + '.badges{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:6px}'
    + '.bdg{position:relative;display:flex;flex-direction:column;align-items:center;gap:4px;padding:12px 6px 10px;border-radius:16px;border:0;'
    + 'background:var(--surface-2,#f2f2f7);color:var(--ink-100);font:inherit;font-size:12.5px;cursor:pointer;text-align:center}'
    + '.bdg.lock{opacity:.5;cursor:default}'
    + '.bdg.cur{box-shadow:inset 0 0 0 2px var(--accent,#007aff)}'
    + '.bdg i{font-style:normal;font-size:26px;line-height:30px;height:30px;display:grid;place-items:center}'
    + '.bdg .ck{width:28px;height:28px;border-radius:50%;color:#fff;font-size:16px;font-weight:800;line-height:28px}'
    + '.bdg small{color:var(--ink-60);font-size:11.5px}'
    + '.how{margin-top:14px;padding:12px 14px;border-radius:14px;background:var(--surface-2,#f2f2f7);font-size:13.5px;color:var(--ink-60)}'
    + '.how b{color:var(--ink-100)}'
    + '.toast{position:fixed;left:50%;bottom:calc(30px + env(safe-area-inset-bottom));z-index:80;transform:translateX(-50%);padding:9px 14px;border-radius:99px;'
    + 'background:var(--ink-100,#1c1c1e);color:var(--surface,#fff);font-size:14px;font-weight:600;pointer-events:none;opacity:0;transition:opacity .2s}'
    + '.toast.on{opacity:1}'
    + '.err{color:var(--red-ink,#d70015);font-size:13.5px}';

  // ─── Окно (bottom sheet) в shadow DOM: стили приложения не задевает, его переменные темы видит ───
  var host = null, root = null;
  function sheet(build) {
    close();
    host = document.createElement('div');
    host.setAttribute('data-para-ref', '');
    root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    var style = document.createElement('style'); style.textContent = CSS; root.appendChild(style);
    var bg = h('div', { class: 'bg', onclick: close });
    var sh = h('div', { class: 'sh', role: 'dialog', 'aria-modal': 'true' }, [h('div', { class: 'grab' }), h('button', { class: 'x', 'aria-label': 'Закрыть', onclick: close, text: '×' })]);
    root.appendChild(bg); root.appendChild(sh);
    document.body.appendChild(host);
    build(sh);
    requestAnimationFrame(function () { requestAnimationFrame(function () { bg.classList.add('on'); sh.classList.add('on'); }); });
    document.addEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.key === 'Escape') close(); }
  function close() {
    document.removeEventListener('keydown', onKey);
    if (!host) return;
    var old = host; host = null;
    var sh = old.shadowRoot ? old.shadowRoot.querySelector('.sh') : old.querySelector('.sh');
    var bg = old.shadowRoot ? old.shadowRoot.querySelector('.bg') : old.querySelector('.bg');
    if (sh) sh.classList.remove('on'); if (bg) bg.classList.remove('on');
    setTimeout(function () { old.remove(); }, 380);
    if (location.hash === '#invite') history.replaceState(history.state, '', location.pathname + location.search);
  }
  function toast(text) {
    if (!root) return;
    var t = h('div', { class: 'toast', text: text });
    root.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('on'); });
    setTimeout(function () { t.classList.remove('on'); setTimeout(function () { t.remove(); }, 250); }, 1700);
  }

  function h(tag, attrs, kids) {
    var n = document.createElement(tag);
    for (var k in attrs || {}) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'text') n.textContent = v;
      else if (k === 'html') n.innerHTML = v;   // только свои SVG/разметка мемов
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  // muted и playsinline — и свойством, и атрибутом: иначе iPhone сам видео не запустит.
  function clip(c, style) {
    var v = document.createElement('video');
    v.muted = true; v.defaultMuted = true; v.loop = true; v.playsInline = true; v.autoplay = !CALM; v.preload = 'auto';
    v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('disablepictureinpicture', ''); v.setAttribute('aria-hidden', 'true');
    if (style) v.setAttribute('style', style);
    v.src = c.src + (CALM ? '#t=0.1' : '');   // без движения — стоп-кадр
    return v;
  }
  // Видео для своего пола; пол не знаем — спрашиваем. Ошибся — «Не угадали?» меняет и запоминает.
  function meme(box, g) {
    var pick = function (x) { return function () { meme(box, learnGender(x, true)); }; };
    if (!CLIPS[g]) {
      box.replaceChildren(h('div', { class: 'ask' }, [
        h('div', { text: 'Подберём мем — ты:' }),
        h('div', { class: 'row' }, [
          h('button', { class: 'btn sec', text: '🙋‍♀️ Девушка', onclick: pick('f') }),
          h('button', { class: 'btn sec', text: '🙋‍♂️ Парень', onclick: pick('m') }),
        ]),
      ]));
      return;
    }
    var other = g === 'f' ? 'm' : 'f';
    box.replaceChildren(
      clip(CLIPS[g], 'aspect-ratio:' + CLIPS[g].ratio),
      h('button', { class: 'swap', text: other === 'm' ? 'Не угадали? Я парень' : 'Не угадали? Я девушка', onclick: pick(other) })
    );
  }

  // ─── Окно приглашающего ───
  function openInvite() {
    miniOn = true;
    sheet(function (sh) {
      // Заголовок и видео не перерисовываем, когда придут данные, — иначе видео начнётся заново.
      var body = h('div', {}, [h('p', { text: 'Загружаю…' })]);
      var box = h('div', { class: 'meme' });
      var saved = genderSaved();
      if (saved) meme(box, saved.g);
      sh.appendChild(h('h2', { text: 'Пж, распространи 🙏' }));
      sh.appendChild(box);
      sh.appendChild(body);
      api('/api/social/ref/me').then(function (me) {
        var g = learnGender(me.gender, false);
        if (!saved || saved.g !== g) meme(box, g);
        renderInvite(body, me);
      }, function (e) {
        if (!saved) meme(box, null);
        if (e.status === 401) return renderGuest(body);
        body.replaceChildren(h('p', { class: 'err', text: 'Не получилось: ' + (e.message || 'нет связи с сервером') }));
      });
    });
  }

  function renderGuest(body) {
    body.replaceChildren(
      h('p', { text: 'Позови друзей в Para — получи галочку ✔️ у имени. Своя ссылка и баллы — у аккаунта: войди, и можно звать.' }),
      h('div', { class: 'row' }, [h('button', { class: 'btn', text: 'Войти', onclick: function () {
        close();
        location.href = '/' + (UNI ? '?uni=' + encodeURIComponent(UNI) : '') + '#auth=consent';
      } })])
    );
  }

  function renderInvite(body, me) {
    var copy = function () {
      var done = function () { toast('Ссылка скопирована'); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(me.link).then(done, fallback);
      else fallback();
      function fallback() {
        var ta = document.createElement('textarea'); ta.value = me.link; ta.style.position = 'fixed'; ta.style.opacity = '0';
        root.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch (e) { /* нечем скопировать */ } ta.remove();
      }
    };
    var share = function () {
      if (navigator.share) navigator.share({ text: SHARE_TEXT + '\n' + me.link }).catch(function () { /* передумал */ });
      else copy();
    };
    var tg = function () {
      window.open('https://t.me/share/url?url=' + encodeURIComponent(me.link) + '&text=' + encodeURIComponent(SHARE_TEXT), '_blank', 'noopener');
    };

    var next = me.rewards.filter(function (r) { return !r.unlocked; })[0];
    var prev = me.rewards.filter(function (r) { return r.unlocked; }).pop();
    var from = prev ? prev.points : 0;
    var progress = next ? Math.min(100, (me.points - from) / (next.points - from) * 100) : 100;
    var friendsLeft = next ? Math.ceil((next.points - me.points) / me.perFriend) : 0;

    var badges = h('div', { class: 'badges' });
    var current = me.badge;
    var drawBadges = function () {
      badges.replaceChildren.apply(badges, me.rewards.map(function (r) {
        var ic = BADGE_ICON[r.badge];
        var icon = ic && ic.charAt(0) === '#' ? h('i', {}, [h('span', { class: 'ck', style: 'background:' + ic, text: '✓' })]) : h('i', { text: ic || '★' });
        var b = h('button', { class: 'bdg' + (r.unlocked ? '' : ' lock') + (current === r.badge ? ' cur' : ''), disabled: r.unlocked ? null : 'disabled',
          'aria-label': r.label + (r.unlocked ? '' : ', нужно ' + r.points + ' баллов'), onclick: function () {
            if (!r.unlocked) return;
            var want = current === r.badge ? null : r.badge;
            api('/api/social/ref/badge', { badge: want }).then(function () {
              current = want; drawBadges();
              toast(want ? r.label + ' — теперь у твоего имени' : 'Значок снят');
            }, function (e) { toast(e.message || 'Не получилось'); });
          } }, [icon, h('span', { text: r.label }), h('small', { text: current === r.badge ? 'стоит у тебя' : r.unlocked ? 'поставить' : r.points + ' баллов' })]);
        return b;
      }));
    };
    drawBadges();

    body.replaceChildren(
      h('p', { text: 'Скинь ссылку друзьям — за каждого баллы, а за баллы галочка ✔️ у имени.' }),
      h('div', { class: 'lbl', text: 'Твоя ссылка' }),
      h('div', { class: 'link' }, [h('code', { text: me.link.replace(/^https:\/\//, '') }), h('button', { class: 'btn sec sm', text: 'Копировать', onclick: copy })]),
      h('div', { class: 'row' }, [h('button', { class: 'btn', text: 'Отправить', onclick: share }), h('button', { class: 'btn sec', text: 'Telegram', onclick: tg })]),
      h('div', { class: 'pts' }, [h('b', { text: String(me.points) }), h('span', { text: 'баллов · ' + me.confirmed + ' ' + plural(me.confirmed, 'друг', 'друга', 'друзей') + (me.waiting ? ' · ' + me.waiting + ' ждут второго дня' : '') })]),
      h('div', { class: 'bar' }, [h('i', { style: 'width:' + progress + '%' })]),
      h('div', { class: 'next', text: next ? 'До «' + next.label + '» — ещё ' + friendsLeft + ' ' + plural(friendsLeft, 'друг', 'друга', 'друзей') : 'Все значки открыты — ты легенда 👑' }),
      h('div', { class: 'lbl', text: 'Значки за баллы' }),
      badges,
      h('div', { class: 'how', html: '' }, [
        h('div', {}, [h('b', { text: 'Как это работает. ' }), document.createTextNode('Друг открывает ссылку на своём телефоне и заходит в расписание два разных дня — тебе +' + me.perFriend + ' баллов.')]),
        h('div', { style: 'margin-top:6px', text: 'Засчитываются только новые устройства, одно — один раз. Баллы не сгорают, значок можно сменить в любой момент.' }),
      ])
    );
  }

  function plural(n, a, b, c) { n = Math.abs(n) % 100; var m = n % 10; return n > 10 && n < 20 ? c : m > 1 && m < 5 ? b : m === 1 ? a : c; }

  // ─── Друг пришёл по ссылке: молча засчитываем устройство, Para открывается как обычно ───
  var REF_KEY = 'ref_in';
  (function catchRef() {
    var params = new URLSearchParams(location.search);
    var code = (params.get('r') || '').toLowerCase();
    if (!/^[a-z0-9]{6,12}$/.test(code)) return;
    // Ссылку из адреса убираем: при обновлении страницы и в «Поделиться» она не нужна.
    params.delete('r');
    if (params.get('from') === 'ref') params.delete('from');
    var q = params.toString();
    history.replaceState(history.state, '', location.pathname + (q ? '?' + q : '') + location.hash);
    if (!get(REF_KEY)) set(REF_KEY, JSON.stringify({ code: code, at: Date.now() }));
  })();

  var arrived = !!pendingRef();   // пришёл по ссылке и переход ещё не засчитан — в этот заход не просим звать других
  function pendingRef() {
    try { var r = JSON.parse(get(REF_KEY) || 'null'); } catch (e) { r = null; }
    if (!r || Date.now() - r.at > 3 * 864e5) { if (r) set(REF_KEY, null); return null; }
    return r;
  }

  // Номер браузера приложение создаёт, когда человек принял условия, — ждём его и отмечаем переход.
  var visitTries = 0;
  function sendVisit() {
    var r = pendingRef();
    if (!r) return;
    var cid = get('cid') || cookie('cid');
    if (!cid) { if (visitTries++ < 400) setTimeout(sendVisit, 3000); return; }
    api('/api/social/ref/visit', { code: r.code, cid: cid }).then(function () { set(REF_KEY, null); }, function (e) {
      if (e.status >= 400 && e.status < 500 && e.status !== 429) set(REF_KEY, null);
    });
  }

  // ─── Входы в окно ───
  function afterBoot(fn, delay) {
    var waited = 0;
    (function wait() {
      var boot = document.getElementById('boot');
      if (boot && !boot.classList.contains('is-done') && waited < 15000) { waited += 300; setTimeout(wait, 300); return; }
      setTimeout(fn, delay);
    })();
  }

  // Карточка над вкладками — при каждом открытии приложения (после приглашения на тест, если оно на экране),
  // с видео для своего пола (не знаем пол — просто 🥺). Друг, только что пришедший по ссылке, в этот заход её не видит.
  // Закрыл или открыл окно — до конца захода вместо неё маленькая кнопка над часами (miniButton).
  var miniOn = false;
  var nudgeG;   // undefined — пол ещё не узнавали
  function nudge() {
    if (arrived) return;
    if (host || document.querySelector('[data-psy-nudge], [data-mygroup-ask], [data-mygroup-pick]')) { setTimeout(nudge, 3000); return; }
    if (nudgeG === undefined) {
      var s = genderSaved();
      nudgeG = s ? s.g : null;
      if (!s) {
        api('/api/social/ref/me').then(function (me) { nudgeG = learnGender(me.gender, false); }, function () { /* гость или нет связи */ }).then(nudge);
        return;
      }
    }
    var c = CLIPS[nudgeG];
    var card = document.createElement('div');
    card.setAttribute('data-ref-nudge', '');
    var sr = card.attachShadow ? card.attachShadow({ mode: 'open' }) : card;
    sr.innerHTML = '<style>:host{all:initial}'
      + '.c{position:fixed;left:12px;right:12px;z-index:20;max-width:440px;margin:0 auto;bottom:calc(var(--tabbar-space,72px) + 12px);display:flex;align-items:center;gap:12px;'
      + 'padding:10px 14px 10px 10px;border-radius:22px;background:var(--sheet-bg,rgba(255,255,255,.94));color:var(--ink-100,#1c1c1e);box-sizing:border-box;'
      + '-webkit-backdrop-filter:blur(24px) saturate(180%);backdrop-filter:blur(24px) saturate(180%);box-shadow:inset 0 0 0 1px var(--glass-edge,rgba(60,60,67,.1)),var(--glass-shadow,0 6px 20px rgba(0,0,0,.14));'
      + 'font:15px/1.3 var(--font,-apple-system,system-ui,sans-serif);letter-spacing:-.01em;cursor:pointer;animation:in .45s cubic-bezier(.2,.9,.25,1)}'
      + '@keyframes in{from{transform:translateY(140%);opacity:0}}'
      + '.v{display:block;flex:none;height:64px;border-radius:14px;object-fit:cover;background:var(--surface-2,#f2f2f7)}'
      + '.i{flex:none;width:52px;height:52px;border-radius:14px;display:grid;place-items:center;font-size:28px;background:linear-gradient(160deg,#ffd6e0,#ffe9c7)}'
      + '.t{font-weight:700}.s{font-size:13px;color:var(--ink-60,rgba(60,60,67,.62));margin-top:1px}.tx{flex:1;min-width:0}'
      + '.go{margin-top:5px;color:var(--accent,#007aff);font-weight:600;font-size:14px}'
      + '.x{position:absolute;top:-8px;right:-6px;width:26px;height:26px;border-radius:50%;border:0;background:var(--surface-2,#f2f2f7);color:var(--ink-60);box-shadow:0 1px 4px rgba(0,0,0,.15);cursor:pointer}'
      + '@media (prefers-reduced-motion:reduce){.c{animation:none}}'
      + '</style><div class="c" role="button"><div class="tx"><div class="t">Пж, распространи 🙏</div>'
      + '<div class="s">Позови друзей — получи галочку ✔️</div><div class="go">Позвать ›</div></div><button class="x" aria-label="Скрыть">×</button></div>';
    var v = c ? clip(c, 'width:' + Math.round(64 * c.ratio) + 'px') : h('div', { text: '🥺' });
    v.className = c ? 'v' : 'i';
    sr.querySelector('.c').insertBefore(v, sr.querySelector('.tx'));
    var hide = function () { card.remove(); miniOn = true; miniButton(); };
    sr.querySelector('.x').addEventListener('click', function (e) { e.stopPropagation(); hide(); });
    sr.querySelector('.c').addEventListener('click', function () { hide(); openInvite(); });
    document.body.appendChild(card);
  }

  // Карточка в своём профиле: экран профиля с настройками (.set-row / .ui-switch) — значит, свой.
  function profileCard() {
    document.querySelectorAll('.prof-screen').forEach(function (scr) {
      if (scr.querySelector('[data-ref-prof]') || !scr.querySelector('.set-row, .ui-switch')) return;
      var b = h('button', { 'data-ref-prof': '', type: 'button', onclick: openInvite, style: 'display:flex;align-items:center;gap:12px;width:100%;margin:0 0 14px;padding:12px 14px;border:0;border-radius:18px;'
        + 'background:linear-gradient(135deg,rgba(255,214,224,.55),rgba(255,233,199,.55));color:var(--ink-100);font:inherit;text-align:left;cursor:pointer' }, [
        h('span', { style: 'font-size:28px', text: '🥺' }),
        h('span', { style: 'flex:1;min-width:0' }, [
          h('b', { style: 'display:block;font-size:15px', text: 'Позови друзей — получи галочку ✔️' }),
          h('span', { style: 'display:block;font-size:13px;color:var(--ink-60)', text: 'Своя ссылка, баллы и значки у имени' }),
        ]),
        h('span', { style: 'color:var(--ink-30);font-size:20px', text: '›' }),
      ]);
      scr.insertBefore(b, scr.firstChild);
    });
  }
  // Маленькая кнопка отдельным блоком над часами (карточка «сейчас/дальше» на экране «Сегодня»).
  // Приложение перерисовывает экран само, поэтому блок держим прямо перед .hero / .hero-wrap и убираем без них.
  var mini = null;
  var MINI_CSS = '.ref-mini{display:flex;align-items:center;gap:8px;width:100%;margin:0 0 10px;padding:8px 12px 8px 10px;border:0;'
    + 'border-radius:14px;background:var(--surface);box-shadow:inset 0 0 0 1px var(--glass-edge);color:var(--ink-100);'
    + 'font:inherit;font-size:13.5px;font-weight:600;letter-spacing:-.01em;text-align:left;cursor:pointer;-webkit-tap-highlight-color:transparent;'
    + 'animation:ref-mini-in .35s cubic-bezier(.2,.9,.25,1)}'
    + '.ref-mini:active{transform:scale(.98)}'
    + '.ref-mini__i{flex:none;width:26px;height:26px;border-radius:8px;display:grid;place-items:center;font-size:16px;background:linear-gradient(160deg,#ffd6e0,#ffe9c7)}'
    + '.ref-mini__t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
    + '.ref-mini__go{flex:none;color:var(--accent);font-size:13px}'
    + '@keyframes ref-mini-in{from{opacity:0;transform:translateY(-6px)}}'
    + '@media (prefers-reduced-motion:reduce){.ref-mini{animation:none}}';
  function miniButton() {
    var view = document.getElementById('sched-view');
    var hero = view && view.querySelector(':scope > .hero-wrap, :scope > .hero');
    if (!miniOn || !hero) { if (mini && mini.isConnected) mini.remove(); return; }
    if (!mini) {
      if (!document.getElementById('ref-mini-css')) {
        var st = document.createElement('style'); st.id = 'ref-mini-css'; st.textContent = MINI_CSS; document.head.appendChild(st);
      }
      mini = h('button', { class: 'ref-mini', type: 'button', 'data-ref-mini': '', onclick: openInvite }, [
        h('span', { class: 'ref-mini__i', text: '🥺' }),
        h('span', { class: 'ref-mini__t', text: 'Позови друзей — получи галочку ✔️' }),
        h('span', { class: 'ref-mini__go', text: 'Позвать ›' }),
      ]);
    }
    if (mini.nextElementSibling !== hero) view.insertBefore(mini, hero);
  }

  var queued = false;
  new MutationObserver(function () {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; profileCard(); miniButton(); });
  }).observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener('hashchange', function () { if (location.hash === '#invite') openInvite(); });

  afterBoot(function () {
    sendVisit();
    if (location.hash === '#invite') openInvite();
    else setTimeout(nudge, 3000);
  }, 1200);
})();
