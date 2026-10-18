// Приглашение пройти психологический тест — карточка над панелью вкладок приложения расписания.
// Сервер добавляет этот файл в страницу приложения (site.js): исходники приложения живут отдельно.
// Показывается, только если человек ещё не прошёл тест в этом вузе; «×» или смахивание вниз — скрыть на 3 дня.
// Стиль — как у приложения (его переменные темы доступны внутри shadow DOM), стили приложения не задевает.
(function () {
  'use strict';
  var SNOOZE = 'psy-nudge-until';
  var DAY = 864e5;
  var path = location.pathname;
  if (path !== '/' && path !== '/index.html') return;

  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* нет хранилища */ } }
  if (Number(get(SNOOZE)) > Date.now()) return;

  var reduced = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  // Ждём, пока уйдёт экран запуска, и даём человеку пару секунд увидеть расписание.
  var waited = 0;
  (function waitBoot() {
    var boot = document.getElementById('boot');
    if ((boot && !boot.classList.contains('is-done')) && waited < 15000) { waited += 300; setTimeout(waitBoot, 300); return; }
    setTimeout(check, 2200);
  })();

  function check() {
    fetch('/api/social/psy/status', { credentials: 'same-origin', headers: { 'X-Para': '1' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j && j.ok && !j.data.passed) show(j.data.signedIn); })
      .catch(function () { /* без сети — молчим */ });
  }

  function show(signedIn) {
    var host = document.createElement('div');
    host.setAttribute('data-psy-nudge', '');
    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    root.innerHTML = '<style>'
      + ':host{all:initial}'
      + '.card{position:fixed;left:12px;right:12px;z-index:20;max-width:440px;margin:0 auto;'
      + 'bottom:calc(var(--tabbar-space, 72px) + 12px);box-sizing:border-box;display:flex;align-items:center;gap:12px;padding:12px 12px 12px 14px;'
      + 'border-radius:22px;background:var(--sheet-bg, rgba(255,255,255,.94));color:var(--ink-100, #1c1c1e);'
      + '-webkit-backdrop-filter:blur(24px) saturate(180%);backdrop-filter:blur(24px) saturate(180%);'
      + 'box-shadow:inset 0 0 0 1px var(--glass-edge, rgba(60,60,67,.1)), var(--glass-shadow, 0 6px 20px rgba(0,0,0,.14));'
      + 'font:15px/1.3 var(--font, -apple-system, BlinkMacSystemFont, system-ui, sans-serif);letter-spacing:-.01em;'
      + '-webkit-font-smoothing:antialiased;touch-action:pan-x;user-select:none;-webkit-user-select:none;cursor:grab;'
      + 'transform:translateY(calc(100% + 120px));opacity:0;will-change:transform}'
      + '.icon{width:44px;height:44px;border-radius:11px;flex:none;display:grid;place-items:center;'
      + 'background:linear-gradient(160deg,#5ac8fa 0%,#007aff 45%,#5856d6 100%);box-shadow:inset 0 1px 0 rgba(255,255,255,.35)}'
      + '.icon svg{width:28px;height:28px}'
      + '.txt{flex:1;min-width:0}'
      + '.t{font-weight:600;font-size:15px}'
      + '.s{color:var(--ink-60, rgba(60,60,67,.62));font-size:13px;margin-top:1px}'
      + '.go{flex:none;border:0;border-radius:999px;padding:8px 14px;background:var(--accent, #007aff);color:#fff;font-family:inherit;font-weight:600;font-size:15px;line-height:1.2;'
      + 'letter-spacing:-.01em;cursor:pointer;transition:transform .2s cubic-bezier(.2,.9,.25,1),opacity .2s;touch-action:manipulation}'
      + '.go:active{transform:scale(.94);opacity:.85;transition:transform 100ms ease-out,opacity 100ms}'
      + '.x{position:absolute;top:-8px;right:-6px;width:26px;height:26px;border-radius:50%;border:0;padding:0;cursor:pointer;'
      + 'background:var(--surface-2, #f2f2f7);color:var(--ink-60, rgba(60,60,67,.62));display:grid;place-items:center;'
      + 'box-shadow:0 1px 4px rgba(0,0,0,.15);touch-action:manipulation}'
      + '.x:active{opacity:.6}'
      + '.x svg{width:10px;height:10px}'
      + '@media (prefers-color-scheme:dark){.card{background:var(--sheet-bg, rgba(28,28,30,.94));color:var(--ink-100, #fff)}}'
      + '@media print{.card{display:none}}'
      + '</style>'
      + '<div class="card" role="complementary" aria-label="Психологический тест">'
      + '<div class="icon" aria-hidden="true"><svg viewBox="0 0 46 46" fill="none" stroke="#fff" stroke-linejoin="round">'
      + '<path d="M23 5 39 14v18L23 41 7 32V14z" stroke-opacity=".45" stroke-width="1.8"/>'
      + '<path d="M23 9 35 17 31 30 21 37 11 27 16 16z" fill="rgba(255,255,255,.28)" stroke-width="2.6"/></svg></div>'
      + '<div class="txt"><div class="t">Психологический тест</div><div class="s"></div></div>'
      + '<button class="go" type="button">Пройти</button>'
      + '<button class="x" type="button" aria-label="Скрыть"><svg viewBox="0 0 10 10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">'
      + '<path d="M2 2l6 6M8 2 2 8"/></svg></button></div>';
    var card = root.querySelector('.card');
    root.querySelector('.s').textContent = signedIn
      ? 'Вы ещё не прошли тест. 7 минут — и узнаете свой тип и сильные стороны'
      : '7 минут — узнайте свой темперамент и сильные стороны';
    document.body.appendChild(host);

    // Появление и уход — по одному пути: снизу вверх и обратно вниз.
    var EASE = 'cubic-bezier(.2,.9,.25,1)';
    function moveTo(y, opacity, ms, done) {
      card.style.transition = reduced ? 'opacity .2s' : 'transform ' + ms + 'ms ' + EASE + ', opacity ' + Math.min(ms, 250) + 'ms';
      card.style.transform = reduced ? 'none' : 'translateY(' + y + ')';
      card.style.opacity = String(opacity);
      if (done) setTimeout(done, reduced ? 200 : ms);
    }
    requestAnimationFrame(function () { requestAnimationFrame(function () { moveTo('0px', 1, 520); }); });

    var gone = false;
    function dismiss(days, fast) {
      if (gone) return;
      gone = true;
      set(SNOOZE, String(Date.now() + days * DAY));
      moveTo('calc(100% + 120px)', 0, fast ? 260 : 380, function () { host.remove(); });
    }
    root.querySelector('.x').addEventListener('click', function (e) { e.stopPropagation(); dismiss(3); });
    root.querySelector('.go').addEventListener('click', function (e) {
      e.stopPropagation();
      set(SNOOZE, String(Date.now() + DAY));        // не дошёл до конца — напомним завтра
      location.href = '/psy';
    });

    // Смахнуть вниз: карточка идёт за пальцем 1:1, вверх — с сопротивлением; решает скорость или расстояние.
    var start = null, last = null;
    card.addEventListener('pointerdown', function (e) {
      if (gone || e.target.closest && e.target.closest('button')) return;
      start = { y: e.clientY, t: e.timeStamp };
      last = start;
      card.setPointerCapture(e.pointerId);
      card.style.transition = 'none';
    });
    card.addEventListener('pointermove', function (e) {
      if (!start) return;
      var dy = e.clientY - start.y;
      var y = dy >= 0 ? dy : -(-dy * 60) / (60 + -dy * 0.55);   // резинка вверх
      card.style.transform = 'translateY(' + y + 'px)';
      last = { y: e.clientY, t: e.timeStamp, v: (e.clientY - last.y) / Math.max(1, e.timeStamp - last.t) * 1000 };
    });
    function release() {
      if (!start) return;
      var dy = (last ? last.y : start.y) - start.y, v = (last && last.v) || 0;
      start = null;
      if (dy > 50 || v > 600) dismiss(3, true);
      else moveTo('0px', 1, 420);
    }
    card.addEventListener('pointerup', release);
    card.addEventListener('pointercancel', release);
  }
})();
