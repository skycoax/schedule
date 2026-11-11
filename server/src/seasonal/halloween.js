// Хеллоуин в Para — тихий сезонный слой поверх приложения: паутинка в углу (тает при прокрутке),
// паук на нити, изредка пролетающие летучие мыши и тыква на карточке «сейчас», которая сама
// зажигается вечером. Сервер добавляет файл в страницу только в сезон (site.js: 15 октября — 1 ноября
// по Ташкенту). Исходники приложения отдельно, поэтому всё — своими элементами в shadow DOM; из стилей
// приложения трогаем только мягкое свечение карточки «сейчас», когда тыква горит.
// Не мешает: слой ниже шапки, панели вкладок и шторок, касания проходят насквозь — ловят их только
// паук (спрятать на полминуты) и тыква (зажечь/погасить). Только на вкладке расписания.
// ?halloween=off — выключить у себя насовсем, ?halloween=on — включить вне сезона.
(function () {
  'use strict';
  if (window.__paraHalloween) return;
  window.__paraHalloween = 1;
  var path = location.pathname;
  if (path !== '/' && path !== '/index.html') return;
  if (!document.body.attachShadow || !window.requestAnimationFrame) return;

  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* нет хранилища */ } }
  function sget(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function sset(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* нет хранилища */ } }

  var flag = new URLSearchParams(location.search).get('halloween');
  if (flag === 'on' || flag === 'off') set('halloween', flag);
  var pref = get('halloween');
  function tashkent() { return new Date(Date.now() + 5 * 36e5); }   // UTC+5 круглый год
  var today = tashkent(), month = today.getUTCMonth() + 1, day = today.getUTCDate();
  var season = (month === 10 && day >= 15) || (month === 11 && day <= 1);
  if (pref === 'off' || (!season && pref !== 'on')) return;
  var bigNight = month === 10 && day === 31;   // в сам Хеллоуин мыши летают чаще, а тыква горит весь день

  var reduced = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  var html = document.documentElement;
  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function f(n) { return n.toFixed(1); }

  // ─── Рисунки ───
  // Паутина в левом верхнем углу: лучи из угла и провисающие между ними нити, одна порвана.
  function webPath() {
    var A = [6, 21, 37, 53, 69, 84], R = [15, 29, 45, 63, 84, 108], d = '', dangle = null;
    A.forEach(function (a) {
      var r = a * Math.PI / 180;
      d += 'M0 0L' + f(140 * Math.cos(r)) + ' ' + f(140 * Math.sin(r));
    });
    R.forEach(function (rr, j) {
      var ring = A.map(function (a, i) {
        var k = rr * (1 + (((i * 5 + j * 3) % 5) - 2) * 0.035), r = a * Math.PI / 180;
        return [k * Math.cos(r), k * Math.sin(r)];
      });
      for (var i = 0; i < ring.length - 1; i++) {
        var p = ring[i], q = ring[i + 1];
        if (j === R.length - 1 && i === 2) { dangle = p; continue; }
        d += 'M' + f(p[0]) + ' ' + f(p[1]) + 'Q' + f((p[0] + q[0]) * 0.42) + ' ' + f((p[1] + q[1]) * 0.42)
          + ' ' + f(q[0]) + ' ' + f(q[1]);
      }
    });
    if (dangle) d += 'M' + f(dangle[0]) + ' ' + f(dangle[1]) + 'q3 7-1 15';
    return d;
  }

  var SPIDER = '<svg viewBox="0 0 32 32" fill="currentColor"><g class="legs">'
    + '<path class="leg" d="M14 17.4 9 12.5 6.4 15.6"/><path class="leg" d="M18 17.4 23 12.5 25.6 15.6"/>'
    + '<path class="leg" d="M13.6 18.6 7.6 16.6 4.6 21"/><path class="leg" d="M18.4 18.6 24.4 16.6 27.4 21"/>'
    + '<path class="leg" d="M13.6 19.8 8.4 21.4 6.4 26.4"/><path class="leg" d="M18.4 19.8 23.6 21.4 25.6 26.4"/>'
    + '<path class="leg" d="M14 21 10.6 25.2 10.4 29.4"/><path class="leg" d="M18 21 21.4 25.2 21.6 29.4"/></g>'
    + '<ellipse cx="16" cy="12.2" rx="4.6" ry="5.4"/><circle cx="16" cy="19.4" r="3.3"/>'
    + '<circle class="eye" cx="14.8" cy="20.6" r=".8"/><circle class="eye" cx="17.2" cy="20.6" r=".8"/></svg>';

  var WING = '<path d="M18 9C15 4.5 9 3 1.5 5.5c3 1 4 3 4 5.5 2-1.4 4.1-1.2 5.3 1 1.2-1.6 3.4-1.6 5.2.4z"/>';
  var BAT = '<svg viewBox="0 0 40 20"><g class="w">' + WING + '</g>'
    + '<g transform="matrix(-1 0 0 1 40 0)"><g class="w">' + WING + '</g></g>'
    + '<ellipse cx="20" cy="10.5" rx="2.8" ry="4.2"/><path d="M18.2 7.4 18.6 4.6l1.1 2.2zM21.8 7.4l-.4-2.8-1.1 2.2z"/></svg>';

  var PUMPKIN = '<svg viewBox="0 0 28 26" aria-hidden="true"><defs>'
    + '<radialGradient id="hw-pm" cx=".42" cy=".36" r=".75"><stop offset="0" stop-color="#ffb347"/>'
    + '<stop offset=".55" stop-color="#fb8a1e"/><stop offset="1" stop-color="#d9600b"/></radialGradient>'
    + '<radialGradient id="hw-ps" cx=".5" cy=".35" r=".8"><stop offset="0" stop-color="#f58a22"/>'
    + '<stop offset="1" stop-color="#c2500a"/></radialGradient></defs>'
    + '<path d="M14.2 7.4c-.2-2.6.5-4.6 2.6-5.8" fill="none" stroke="#6f8a33" stroke-width="2.2" stroke-linecap="round"/>'
    + '<ellipse cx="8.6" cy="15.8" rx="7.6" ry="8.8" fill="url(#hw-ps)"/><ellipse cx="19.4" cy="15.8" rx="7.6" ry="8.8" fill="url(#hw-ps)"/>'
    + '<ellipse cx="14" cy="15.9" rx="7.2" ry="9.4" fill="url(#hw-pm)"/>'
    + '<path d="M10.9 7.8c-2.3 4.4-2.3 11.8 0 16.2M17.1 7.8c2.3 4.4 2.3 11.8 0 16.2" fill="none" stroke="#b9500c" stroke-opacity=".45" stroke-width=".8"/>'
    + '<path class="face" d="M9.3 14.4 11.9 11.5 12.7 14.8zM18.7 14.4 16.1 11.5 15.3 14.8zM13.3 16.9 14 15.6 14.7 16.9z'
    + 'M8.9 18c1.9 4.3 8.3 4.3 10.2 0l-1.5.9-1-.9-1.1 1.4-1.5-1-1.5 1-1.1-1.4-1 .9z"/></svg>';

  // Цвета — из переменных темы приложения: светлая и тёмная тема подхватываются сами.
  var CSS = ':host{all:initial}'
    + '.web{position:absolute;left:0;top:0;width:clamp(84px,14vw,156px);height:auto;overflow:visible;'
    + 'color:var(--ink-30,rgba(128,128,128,.3));opacity:.9;transition:opacity .2s linear}'
    + '.web path{fill:none;stroke:currentColor;stroke-width:.8;vector-effect:non-scaling-stroke;stroke-linecap:round}'
    + '.web circle{fill:currentColor}'
    + '.pend{position:absolute;left:0;top:0;will-change:transform}'
    + '.sway{position:absolute;left:0;top:0;transform-origin:0 0;animation:sway 5.5s ease-in-out infinite alternate}'
    + '@keyframes sway{from{transform:rotate(-1.4deg)}to{transform:rotate(1.4deg)}}'
    + '.silk{position:absolute;left:-.5px;top:0;width:1px;height:1px;background:var(--ink-30,rgba(128,128,128,.3));'
    + 'transform-origin:0 0;transform:scaleY(0);will-change:transform}'
    + '.spider{position:absolute;left:-16px;top:-7px;width:32px;height:32px;pointer-events:auto;cursor:pointer;'
    + '-webkit-tap-highlight-color:transparent;touch-action:manipulation;color:var(--ink-100,#1c1c1e);will-change:transform}'
    + '.spider svg{display:block;width:100%;height:100%;overflow:visible;opacity:.85}'
    + '.leg{fill:none;stroke:currentColor;stroke-width:1.25;stroke-linecap:round;stroke-linejoin:round;'
    + 'transform-box:view-box;transform-origin:16px 19px}'
    + '.busy .leg{animation:wig .16s ease-in-out infinite alternate}'
    + '.busy .leg:nth-child(4n+1),.busy .leg:nth-child(4n+2){animation-delay:-.08s}'
    + '@keyframes wig{from{transform:rotate(-7deg)}to{transform:rotate(7deg)}}'
    + '.eye{fill:#ff9f0a;animation:blink 6s infinite}'
    + '@keyframes blink{0%,95%,100%{opacity:1}97%{opacity:.1}}'
    + '.bat{position:absolute;left:0;top:0;width:34px;height:17px;margin:-8.5px 0 0 -17px;'
    + 'color:var(--ink-60,rgba(128,128,128,.6));will-change:transform,opacity}'
    + '.bat svg{display:block;width:100%;height:100%;overflow:visible;fill:currentColor}'
    + '.bat .w{transform-box:view-box;transform-origin:18px 9px;animation:flap var(--f,.2s) ease-in-out infinite alternate}'
    + '@keyframes flap{from{transform:rotate(-26deg)}to{transform:rotate(32deg) scaleY(.8)}}'
    + '@media (prefers-reduced-motion:reduce){.sway,.eye{animation:none}}';

  var PUMPKIN_CSS = ':host{all:initial}'
    + 'button{all:unset;position:relative;display:block;width:100%;height:100%;cursor:pointer;'
    + '-webkit-tap-highlight-color:transparent;touch-action:manipulation}'
    + 'button:before{content:"";position:absolute;inset:-9px}'
    + 'button:focus-visible{outline:2px solid var(--c1,#0a84ff);outline-offset:3px;border-radius:9px}'
    + '.halo{position:absolute;left:50%;top:60%;width:72px;height:72px;margin:-36px 0 0 -36px;border-radius:50%;pointer-events:none;'
    + 'background:radial-gradient(closest-side,rgba(255,176,64,.42),rgba(255,140,20,.13) 55%,transparent);opacity:0;transition:opacity .7s ease}'
    + '.lit .halo{opacity:1;animation:flick 2.8s ease-in-out infinite}'
    + '@keyframes flick{0%,100%{opacity:.85;transform:scale(1)}20%{opacity:1;transform:scale(1.05)}35%{opacity:.8}'
    + '55%{opacity:.97;transform:scale(.98)}75%{opacity:.88;transform:scale(1.03)}}'
    + 'svg{position:relative;display:block;width:100%;height:100%;overflow:visible;transform-origin:50% 92%;'
    + 'transition:transform .35s cubic-bezier(.3,1.6,.5,1)}'
    + '@media (hover:hover){button:hover svg{transform:rotate(-7deg)}}'
    + '.face{fill:#4a2208;transition:fill .5s ease}'
    + '.lit .face{fill:#ffd774}'
    + '.pop svg{animation:pop .55s cubic-bezier(.3,1.6,.5,1)}'
    + '@keyframes pop{0%{transform:scale(1)}35%{transform:scale(1.16,1.1)}100%{transform:scale(1)}}'
    + '.spark{position:absolute;left:50%;top:45%;width:3px;height:3px;margin:-1.5px;border-radius:50%;pointer-events:none;'
    + 'background:#ffc556;box-shadow:0 0 5px 1px rgba(255,159,10,.8)}'
    + '@media (prefers-reduced-motion:reduce){.lit .halo{animation:none}}';

  // Свечение свечи на карточке «сейчас» — единственное, что дописано в стили приложения.
  var PAGE_CSS = '.hero:after{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;opacity:0;'
    + 'background:radial-gradient(55% 120% at calc(100% - 34px) 0,rgba(255,149,0,.15),transparent 72%);transition:opacity .9s ease}'
    + 'html.hw-lit .hero:after{opacity:1;animation:hw-candle 3.6s ease-in-out infinite}'
    + '@keyframes hw-candle{0%,100%{opacity:.8}14%{opacity:.96}22%{opacity:.84}38%{opacity:1}52%{opacity:.88}66%{opacity:.98}80%{opacity:.83}}'
    + '@media (prefers-reduced-motion:reduce){html.hw-lit .hero:after{animation:none}}'
    + '@media print{[data-halloween],[data-halloween-pumpkin]{display:none!important}}';

  // Ждём, пока уйдёт экран запуска: паук спускается, когда расписание уже на экране.
  var waited = 0;
  (function waitBoot() {
    var boot = document.getElementById('boot');
    if (boot && !boot.classList.contains('is-done') && waited < 15000) { waited += 250; setTimeout(waitBoot, 250); return; }
    start();
  })();

  function start() {
    var style = document.createElement('style');
    style.setAttribute('data-halloween', '');
    style.textContent = PAGE_CSS;
    document.head.appendChild(style);

    var host = document.createElement('div');
    host.setAttribute('data-halloween', '');
    host.setAttribute('aria-hidden', 'true');
    // Ниже .topfade (15) и шапки (16): нить уходит под шапку, мыши пролетают за её стеклом.
    host.style.cssText = 'position:fixed;inset:0;z-index:14;pointer-events:none;contain:strict;transition:opacity .25s,visibility .25s';
    var root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<style>' + CSS + '</style>'
      + '<svg class="web" viewBox="0 0 140 140"><path d="' + webPath() + '"/><circle cx="41" cy="31" r="1.1"/></svg>'
      + '<div class="pend"><div class="sway"><div class="silk"></div><div class="spider">' + SPIDER + '</div></div></div>'
      + '<div class="sky"></div>';
    document.body.appendChild(host);

    var web = root.querySelector('.web'), pend = root.querySelector('.pend'), silk = root.querySelector('.silk');
    var spider = root.querySelector('.spider'), sky = root.querySelector('.sky');

    // Только на вкладке расписания: в обсуждениях и профиле плотнее кнопок — там не мешаем.
    function onTab() { return !html.dataset.tab || html.dataset.tab === 'schedule'; }
    function syncTab() {
      var on = onTab();
      host.style.opacity = on ? '' : '0';
      host.style.visibility = on ? '' : 'hidden';
    }
    new MutationObserver(syncTab).observe(html, { attributes: true, attributeFilter: ['data-tab'] });
    syncTab();

    // ─── Паук: маятник на нити ───
    // Длина нити тянется пружиной (вверх — быстро и без отскока, вниз — медленно, с мягким покачиванием),
    // угол — затухающий маятник: чем длиннее нить, тем медленнее качается.
    var HIDE = -30;
    var vw = 0, vh = 0, ax = 0, rest = 90;
    var th = 0, om = 0, L = HIDE, vL = 0, Lt = HIDE;
    var raf = 0, last = 0, busy = false, scared = false, hiddenUntil = 0, scareTimer = 0;

    // На широком экране паук висит на поле справа от колонки, на телефоне — в правом отступе, чуть ниже шапки.
    // Ширина — без полосы прокрутки, иначе на компьютере она закрывает паука.
    function layout() {
      vw = html.clientWidth || innerWidth; vh = html.clientHeight || innerHeight;
      var gutter = (vw - 1080) / 2;
      var nav = document.querySelector('.navrow');
      var navBottom = nav ? nav.getBoundingClientRect().bottom : 52;
      if (gutter >= 90) { ax = vw - gutter + Math.min(70, gutter * 0.4); rest = Math.round(vh * 0.24); }
      else { ax = vw - 12; rest = Math.round(navBottom + 30); }
    }
    function render() {
      pend.style.transform = 'translate3d(' + f(ax) + 'px,0,0) rotate(' + th.toFixed(4) + 'rad)';
      silk.style.transform = 'scaleY(' + f(Math.max(0, L)) + ')';
      spider.style.transform = 'translate3d(0,' + f(L) + 'px,0)';
    }
    function wake() { if (!raf && !document.hidden) raf = requestAnimationFrame(frame); }
    function frame(ts) {
      raf = 0;
      var dt = Math.min(0.034, (ts - last) / 1000 || 0.016);
      last = ts;
      var K = 2400 / Math.max(L, 40);
      om += (-K * Math.sin(th) - 1.15 * om) * dt;
      th = clamp(th + om * dt, -0.8, 0.8);
      var up = Lt < L, k = up ? 150 : 6.5, c = up ? 25 : 3.6;
      vL += (k * (Lt - L) - c * vL) * dt;
      L += vL * dt;
      var moving = Math.abs(vL) > 18;
      if (moving !== busy) { busy = moving; spider.classList.toggle('busy', busy); }
      render();
      if (Math.abs(th) > 0.002 || Math.abs(om) > 0.003 || Math.abs(Lt - L) > 0.4 || Math.abs(vL) > 0.4) wake();
    }
    function free() { return !scared && Date.now() >= hiddenUntil; }
    function spiderAt() { return [ax + Math.sin(th) * L, Math.cos(th) * L + 12]; }

    layout();
    render();
    if (reduced) { L = Lt = rest; render(); }
    else setTimeout(function () { layout(); Lt = rest; wake(); }, 500);   // спускается на нити

    // Прокрутка: паутина тает, паук раскачивается.
    var lastY = scrollY;
    addEventListener('scroll', function () {
      var y = scrollY, dy = y - lastY;
      lastY = y;
      web.style.opacity = String(clamp(1 - y / 180, 0, 1) * 0.9);
      if (reduced || L < 4) return;
      om += clamp(dy * 0.0022, -0.3, 0.3);
      wake();
    }, { passive: true });

    // Курсор рядом — паук настораживается: подтягивается чуть выше и перебирает лапками.
    // Недалеко — чтобы его всё ещё можно было поймать.
    addEventListener('pointermove', function (e) {
      if (e.pointerType !== 'mouse' || reduced || Date.now() < hiddenUntil || L < 4) return;
      var p = spiderAt(), dx = e.clientX - p[0], dy = e.clientY - p[1];
      if (dx * dx + dy * dy > 70 * 70) return;
      if (!scared) { scared = true; Lt = Math.max(18, rest - 12); om += dx > 0 ? -0.06 : 0.06; wake(); }
      clearTimeout(scareTimer);
      scareTimer = setTimeout(function () { scared = false; if (free()) { Lt = rest; wake(); } }, 1400);
    }, { passive: true });

    // Касание — паук уползает наверх, из-под него вылетают мыши; через полминуты возвращается.
    spider.addEventListener('click', function (e) {
      e.stopPropagation();
      var p = spiderAt();
      hiddenUntil = Date.now() + 30000;
      if (reduced) { L = Lt = HIDE; render(); }
      else { Lt = HIDE; om += rand(-0.3, 0.3); wake(); burst(p[0], p[1], 3); }
      setTimeout(function () {
        if (Date.now() < hiddenUntil) return;
        layout();
        if (reduced) { L = Lt = rest; render(); } else { Lt = rest; wake(); }
      }, 30000);
    });

    // Иногда сам спускается чуть ниже — заглянуть в расписание — и возвращается.
    (function peek() {
      setTimeout(function () {
        if (!document.hidden && !reduced && free()) {
          Lt = rest + rand(16, 34); om += rand(-0.18, 0.18); wake();
          setTimeout(function () { if (free()) { Lt = rest; wake(); } }, rand(1800, 3000));
        }
        peek();
      }, rand(15000, 32000));
    })();

    addEventListener('resize', function () { layout(); if (free() && !reduced) { Lt = rest; wake(); } else render(); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) wake(); });

    // ─── Летучие мыши ───
    function bat(flap) {
      var el = document.createElement('div');
      el.className = 'bat';
      el.style.setProperty('--f', flap.toFixed(3) + 's');
      el.innerHTML = BAT;
      sky.appendChild(el);
      return el;
    }
    function bez(a, b, c, d, t) { var u = 1 - t; return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d; }
    // Полёт по кривой Безье с покачиванием; наклон — по направлению полёта. P = [x0,y0, x1,y1, x2,y2, x3,y3].
    function fly(el, P, o) {
      var frames = [], N = 30, px = P[0], py = P[1];
      for (var i = 0; i <= N; i++) {
        var t = i / N;
        var x = bez(P[0], P[2], P[4], P[6], t);
        var y = bez(P[1], P[3], P[5], P[7], t) + Math.sin(t * Math.PI * o.bobs + o.phase) * o.bob;
        var tilt = clamp((y - py) / Math.max(1, Math.abs(x - px)), -1, 1) * 0.35 * (x >= px ? 1 : -1);
        var s = o.s0 + (o.s1 - o.s0) * Math.min(1, t * 3);
        var a = t < 0.08 ? t / 0.08 : t > 0.9 ? (1 - t) / 0.1 : 1;
        px = x; py = y;
        frames.push({
          transform: 'translate3d(' + f(x) + 'px,' + f(y) + 'px,0) rotate(' + tilt.toFixed(3) + 'rad) scale(' + s.toFixed(3) + ')',
          opacity: (a * o.alpha).toFixed(3),
        });
      }
      var anim = el.animate(frames, { duration: o.dur, delay: o.delay || 0, easing: 'linear', fill: 'both' });
      anim.onfinish = function () { el.remove(); };
    }
    // Стайка через верх экрана, слева направо или наоборот.
    function flock() {
      if (reduced || document.hidden || !onTab() || html.classList.contains('ui-lock')) return;
      var dir = Math.random() < 0.5 ? 1 : -1;
      var x0 = dir > 0 ? -40 : vw + 40, x3 = dir > 0 ? vw + 40 : -40;
      var y0 = vh * rand(0.1, 0.3), y3 = y0 + vh * rand(-0.14, 0.06);
      var dur = clamp(vw * 3.4, 3400, 7000), n = Math.random() < 0.3 ? 2 : 3;
      for (var i = 0; i < n; i++) {
        var s = [1, 0.78, 0.62][i], dy = i ? rand(-26, 26) : 0;
        fly(bat(rand(0.15, 0.22)), [
          x0, y0 + dy,
          x0 + (x3 - x0) * 0.33, y0 + dy + vh * rand(-0.12, 0.08),
          x0 + (x3 - x0) * 0.66, y3 + dy + vh * rand(-0.08, 0.1),
          x3, y3 + dy,
        ], { dur: dur * rand(0.92, 1.08), delay: i * rand(160, 420), bob: rand(4, 9), bobs: rand(5, 8),
          phase: rand(0, 6.28), s0: s, s1: s * rand(0.9, 1.1), alpha: i ? 0.75 : 0.9 });
      }
    }
    // Вспугнутые мыши: из точки вверх и в стороны, растут из маленьких.
    function burst(x, y, n) {
      for (var i = 0; i < n; i++) {
        var side = i % 2 ? 1 : -1, s = rand(0.6, 0.9), x3 = x + side * rand(90, 240) * (i ? 1 : 0.5);
        fly(bat(rand(0.1, 0.14)), [x, y, x + side * rand(10, 40), y - rand(30, 70), x3 - side * 30, rand(20, 80), x3, -40],
          { dur: rand(1300, 1900), delay: i * rand(60, 140), bob: rand(2, 5), bobs: rand(4, 7),
            phase: rand(0, 6.28), s0: 0.3, s1: s, alpha: 0.9 });
      }
    }
    (function plan(first) {
      var wait = first ? 2800 : bigNight ? rand(45e3, 90e3) : rand(85e3, 170e3);
      setTimeout(function () { flock(); plan(false); }, wait);
    })(!sget('hw-intro'));
    sset('hw-intro', '1');

    pumpkin(burst);
  }

  // ─── Тыква на карточке «сейчас» ───
  // Сидит на верхнем крае карточки справа. Вечером (с 18 до 6) и весь день 31 октября горит сама;
  // касание — зажечь/погасить до конца сессии. Горящая тыква подсвечивает карточку, как свеча.
  function pumpkin(burst) {
    var pk = document.createElement('div');
    pk.setAttribute('data-halloween-pumpkin', '');
    pk.style.cssText = 'position:absolute;right:22px;top:-21px;z-index:2;width:28px;height:26px;display:block';
    var pr = pk.attachShadow({ mode: 'open' });
    pr.innerHTML = '<style>' + PUMPKIN_CSS + '</style><button type="button"><span class="halo"></span>' + PUMPKIN + '</button>';
    var btn = pr.querySelector('button');

    // Касания тыквы не доходят до приложения: карточка «сейчас» — сама кнопка с пасхалкой.
    ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'click'].forEach(function (t) {
      pk.addEventListener(t, function (e) { e.stopPropagation(); }, { passive: true });
    });

    function auto() { var h = new Date(Date.now() + 5 * 36e5).getUTCHours(); return bigNight || h >= 18 || h < 6; }
    var lit = sget('hw-lit') ? sget('hw-lit') === '1' : auto();
    function apply(fx) {
      btn.classList.toggle('lit', lit);
      html.classList.toggle('hw-lit', lit);
      btn.setAttribute('aria-pressed', String(lit));
      btn.setAttribute('aria-label', lit ? 'Погасить тыкву' : 'Зажечь тыкву');
      if (!fx || reduced) return;
      btn.classList.remove('pop');
      void btn.offsetWidth;
      btn.classList.add('pop');
      if (lit) sparks();
    }
    function sparks() {
      for (var i = 0; i < 7; i++) {
        var s = document.createElement('i');
        s.className = 'spark';
        btn.appendChild(s);
        var dx = rand(-14, 14), dy = rand(-36, -16);
        s.animate([
          { transform: 'translate(0,0) scale(1)', opacity: 1 },
          { transform: 'translate(' + f(dx) + 'px,' + f(dy) + 'px) scale(.2)', opacity: 0 },
        ], { duration: rand(650, 1100), delay: i * 40, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'both' })
          .onfinish = (function (el) { return function () { el.remove(); }; })(s);
      }
    }
    apply(false);
    btn.addEventListener('click', function () {
      lit = !lit;
      sset('hw-lit', lit ? '1' : '0');
      apply(true);
      if (lit && !reduced) { var r = pk.getBoundingClientRect(); burst(r.left + r.width / 2, r.top + 4, 1); }
    });
    // Наступил вечер, пока приложение открыто, — тыква зажигается сама (если её не трогали).
    setInterval(function () {
      if (sget('hw-lit') !== null || auto() === lit) return;
      lit = !lit;
      apply(true);
    }, 60000);

    // Карточку «сейчас» приложение перерисовывает (смена вкладки, дня, группы) — тыква садится обратно.
    var queued = false;
    function place() {
      queued = false;
      var wrap = document.querySelector('.hero-wrap');
      if (wrap && pk.parentNode !== wrap) wrap.appendChild(pk);
    }
    var appRoot = document.getElementById('root') || document.body;
    new MutationObserver(function () { if (!queued) { queued = true; requestAnimationFrame(place); } })
      .observe(appRoot, { childList: true, subtree: true });
    place();
  }
})();
