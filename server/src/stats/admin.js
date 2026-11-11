// Расширенная «Статистика» для модератора: круговые и паутинные графики под «Вся статистика».
// Сервер добавляет этот файл в страницу приложения (site.js): исходники приложения живут отдельно.
// Всем остальным приложение показывает только общую картину (/api/stats без устройств и моделей);
// здесь данные из GET /api/social/stats/full — он отвечает только модератору, у остальных 401/403 и блока нет.
// Блок рисуется в обычном DOM окна статистики (классы и переменные темы приложения), без innerHTML для данных.
(function () {
  'use strict';
  var path = location.pathname;
  if (path !== '/' && path !== '/index.html') return;

  var brand = {};
  try { brand = JSON.parse((document.getElementById('brand') || {}).textContent || '{}') || {}; } catch (e) { brand = {}; }
  var URL_FULL = '/api/social/stats/full' + (brand.hub && brand.id ? '?uni=' + encodeURIComponent(brand.id) : '');

  var SVGNS = 'http://www.w3.org/2000/svg';
  var OTHER = 'Другие';
  // Категориальные цвета — в постоянном порядке; «Другие» всегда серые. Для тёмной темы — свои ступени.
  var LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6'];
  var DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9'];

  var denied = false;   // не модератор — больше не спрашиваем до перезагрузки
  var cache = null;     // { at, data }
  var loading = null;

  function isDark() {
    return getComputedStyle(document.documentElement).getPropertyValue('--surface').trim().toLowerCase() === '#1c1c1e';
  }
  function palette() { return isDark() ? DARK : LIGHT; }
  function colorOf(rows, i) { return rows[i].name === OTHER ? 'var(--ink-30)' : palette()[i % 7]; }

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    for (var k in attrs || {}) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'style') n.style.cssText = attrs[k];
      else n.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  function svg(tag, attrs) {
    var n = document.createElementNS(SVGNS, tag);
    for (var k in attrs || {}) n.setAttribute(k, attrs[k]);
    return n;
  }
  var fmt = function (n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); };
  var pct = function (n, total) { return total ? Math.round(n / total * 100) + '%' : '0%'; };

  function load() {
    if (cache && Date.now() - cache.at < 60 * 1000) return Promise.resolve(cache.data);
    if (loading) return loading;
    loading = fetch(URL_FULL, { credentials: 'same-origin', headers: { 'X-Para': '1' } })
      .then(function (r) {
        if (r.status === 401 || r.status === 403) { denied = true; return null; }
        return r.ok ? r.json() : null;
      })
      .then(function (j) {
        var data = j && j.ok ? j.data : null;
        if (data) cache = { at: Date.now(), data: data };
        return data;
      })
      .catch(function () { return null; })
      .then(function (d) { loading = null; return d; });
    return loading;
  }

  // Не больше 7 долей: первые 6 + хвост одной долей «Другие».
  function fold(rows) {
    rows = (rows || []).filter(function (r) { return r.n > 0; });
    var own = rows.filter(function (r) { return r.name !== OTHER; });
    var rest = rows.filter(function (r) { return r.name === OTHER; }).reduce(function (s, r) { return s + r.n; }, 0);
    if (own.length > 7) {
      rest += own.slice(6).reduce(function (s, r) { return s + r.n; }, 0);
      own = own.slice(0, 6);
    }
    return rest ? own.concat([{ name: OTHER, n: rest }]) : own;
  }

  // ─── Круговой график (кольцо) с легендой: цвет никогда не единственный признак ───
  function donut(title, note, rawRows, colors) {
    var rows = fold(rawRows);
    if (!rows.length) return null;
    var total = rows.reduce(function (s, r) { return s + r.n; }, 0);
    var R = 54, r0 = 34, C = 64;
    var box = svg('svg', { viewBox: '0 0 128 128', width: '128', height: '128', role: 'img', 'aria-label': title });
    var centerV = svg('text', { x: C, y: C + 1, 'text-anchor': 'middle', class: 'pa-dv' });
    var centerL = svg('text', { x: C, y: C + 15, 'text-anchor': 'middle', class: 'pa-dl' });
    var legendItems = [];
    function center(v, l) { centerV.textContent = v; centerL.textContent = l; }
    function reset() { center(fmt(total), 'всего'); legendItems.forEach(function (li) { li.classList.remove('is-dim'); }); paths.forEach(function (p) { p.style.opacity = 1; }); }

    var paths = [];
    var a = -Math.PI / 2;
    rows.forEach(function (row, i) {
      var frac = row.n / total;
      var color = colors ? colors[i] : colorOf(rows, i);
      var p;
      if (frac >= 0.9999) {
        p = svg('circle', { cx: C, cy: C, r: (R + r0) / 2, fill: 'none', stroke: color, 'stroke-width': R - r0 });
      } else {
        var b = a + frac * Math.PI * 2;
        var large = b - a > Math.PI ? 1 : 0;
        var pt = function (rad, ang) { return (C + rad * Math.cos(ang)).toFixed(2) + ' ' + (C + rad * Math.sin(ang)).toFixed(2); };
        p = svg('path', {
          d: 'M' + pt(R, a) + 'A' + R + ' ' + R + ' 0 ' + large + ' 1 ' + pt(R, b)
            + 'L' + pt(r0, b) + 'A' + r0 + ' ' + r0 + ' 0 ' + large + ' 0 ' + pt(r0, a) + 'Z',
          fill: color, stroke: 'var(--surface)', 'stroke-width': '2', 'stroke-linejoin': 'round',
        });
        a = b;
      }
      p.setAttribute('class', 'pa-slice');
      var t = svg('title', {}); t.textContent = row.name + ': ' + fmt(row.n) + ' (' + pct(row.n, total) + ')';
      p.appendChild(t);
      var on = function () {
        center(pct(row.n, total), row.name.length > 12 ? row.name.slice(0, 11) + '…' : row.name);
        paths.forEach(function (q, j) { q.style.opacity = j === i ? 1 : 0.35; });
        legendItems.forEach(function (li, j) { li.classList.toggle('is-dim', j !== i); });
      };
      p.addEventListener('mouseenter', on); p.addEventListener('mouseleave', reset);
      p.addEventListener('click', on);
      paths.push(p);
      box.appendChild(p);
    });
    box.appendChild(centerV); box.appendChild(centerL);

    var legend = el('div', { class: 'pa-leg' });
    rows.forEach(function (row, i) {
      var li = el('div', { class: 'pa-li' }, [
        el('i', { style: 'background:' + (colors ? colors[i] : colorOf(rows, i)) }),
        el('span', { class: 'pa-li__n', text: row.name }),
        el('span', { class: 'pa-li__v', text: fmt(row.n) + ' · ' + pct(row.n, total) }),
      ]);
      li.addEventListener('mouseenter', function () { paths[i].dispatchEvent(new Event('mouseenter')); });
      li.addEventListener('mouseleave', reset);
      legendItems.push(li);
      legend.appendChild(li);
    });
    reset();
    return el('section', { class: 'sx pa-card' }, [
      el('h3', { class: 'sx__h', text: title }),
      note ? el('p', { class: 'sx__note', text: note }) : null,
      el('div', { class: 'pa-donut' }, [el('div', { class: 'pa-donut__svg' }, [box]), legend]),
    ]);
  }

  // ─── Паутинный (радарный) график: одна или две серии на общих осях ───
  function radar(title, note, axes, series, opts) {
    opts = opts || {};
    var n = axes.length;
    if (!n) return null;
    var S = 260, C = S / 2, R = 92;
    var max = 1;
    series.forEach(function (s) { s.values.forEach(function (v) { if (v > max) max = v; }); });
    var ang = function (i) { return -Math.PI / 2 + i * 2 * Math.PI / n; };
    var at = function (i, k) { return [C + R * k * Math.cos(ang(i)), C + R * k * Math.sin(ang(i))]; };
    var box = svg('svg', { viewBox: '0 0 ' + S + ' ' + S, class: 'pa-radar', role: 'img', 'aria-label': title });

    [0.25, 0.5, 0.75, 1].forEach(function (k) {
      var pts = axes.map(function (_, i) { return at(i, k).map(function (v) { return v.toFixed(1); }).join(','); }).join(' ');
      box.appendChild(svg('polygon', { points: pts, fill: 'none', stroke: 'var(--sep, rgba(128,128,128,.25))', 'stroke-width': '1' }));
    });
    axes.forEach(function (label, i) {
      var e = at(i, 1);
      box.appendChild(svg('line', { x1: C, y1: C, x2: e[0], y2: e[1], stroke: 'var(--sep, rgba(128,128,128,.25))', 'stroke-width': '1' }));
      if (opts.labelEvery && i % opts.labelEvery) return;
      var l = at(i, 1.16);
      var tx = svg('text', { x: l[0].toFixed(1), y: (l[1] + 4).toFixed(1), 'text-anchor': 'middle', class: 'pa-ax' });
      tx.textContent = label;
      box.appendChild(tx);
    });
    var maxT = svg('text', { x: C + 4, y: C - R - 3, class: 'pa-ax pa-ax--max' });
    maxT.textContent = fmt(max);
    box.appendChild(maxT);

    var tip = svg('text', { x: C, y: S - 4, 'text-anchor': 'middle', class: 'pa-tip' });
    series.forEach(function (s, si) {
      var color = palette()[si];
      var pts = s.values.map(function (v, i) { return at(i, v / max).map(function (x) { return x.toFixed(1); }).join(','); }).join(' ');
      box.appendChild(svg('polygon', { points: pts, fill: color, 'fill-opacity': '0.14', stroke: color, 'stroke-width': '2', 'stroke-linejoin': 'round' }));
    });
    series.forEach(function (s, si) {
      var color = palette()[si];
      s.values.forEach(function (v, i) {
        var p = at(i, v / max);
        var dot = svg('circle', { cx: p[0].toFixed(1), cy: p[1].toFixed(1), r: '4', fill: color, stroke: 'var(--surface)', 'stroke-width': '2', class: 'pa-dot' });
        var t = svg('title', {}); t.textContent = axes[i] + ' — ' + s.name + ': ' + fmt(v);
        dot.appendChild(t);
        var hit = svg('circle', { cx: p[0].toFixed(1), cy: p[1].toFixed(1), r: '10', fill: 'transparent' });
        var on = function () { tip.textContent = (opts.axisFull ? opts.axisFull(i) : axes[i]) + ' · ' + s.name + ': ' + fmt(v); dot.setAttribute('r', '5.5'); };
        var off = function () { tip.textContent = ''; dot.setAttribute('r', '4'); };
        hit.addEventListener('mouseenter', on); hit.addEventListener('mouseleave', off); hit.addEventListener('click', on);
        box.appendChild(dot); box.appendChild(hit);
      });
    });
    box.appendChild(tip);

    var legend = series.length > 1 ? el('div', { class: 'pa-leg pa-leg--row' }, series.map(function (s, si) {
      return el('div', { class: 'pa-li' }, [el('i', { style: 'background:' + palette()[si] }), el('span', { class: 'pa-li__n', text: s.name })]);
    })) : null;
    return el('section', { class: 'sx pa-card' }, [
      el('h3', { class: 'sx__h', text: title }),
      note ? el('p', { class: 'sx__note', text: note }) : null,
      legend,
      el('div', { class: 'pa-radar__wrap' }, [box]),
    ]);
  }

  function bars(title, note, rows) {
    rows = (rows || []).filter(function (r) { return r.n > 0; });
    if (!rows.length) return null;
    var max = Math.max.apply(null, rows.map(function (r) { return r.n; }).concat([1]));
    return el('section', { class: 'sx' }, [
      el('h3', { class: 'sx__h', text: title }),
      note ? el('p', { class: 'sx__note', text: note }) : null,
    ].concat(rows.map(function (r) {
      return el('div', { class: 'bl' + (r.name === OTHER ? ' bl--rest' : '') }, [
        el('div', { class: 'bl__top' }, [el('span', { class: 'bl__name', text: r.name }), el('span', { class: 'bl__n', text: fmt(r.n) })]),
        el('div', { class: 'bl__bar' }, [el('i', { style: 'width:' + (r.n / max * 100) + '%' })]),
      ]);
    })));
  }

  function tile(label, value, sub) {
    return el('div', { class: 'tile' }, [
      el('span', { class: 'tile__l', text: label }),
      el('b', { class: 'tile__v', text: value }),
      sub ? el('span', { class: 'tile__s', text: sub }) : null,
    ]);
  }

  function render(d) {
    var hours = d.byHour || [];
    var wd = d.byWeekday || [];
    var t30 = d.trend30 || [];
    var users30 = t30.reduce(function (s, x) { return s + x.users; }, 0);
    var new30 = t30.reduce(function (s, x) { return s + x.newUsers; }, 0);
    var avgDay = t30.length ? Math.round(users30 / t30.length) : 0;
    var best = t30.reduce(function (b, x) { return x.users > b.users ? x : b; }, { users: 0, date: '—' });
    var rv = d.reviews || { dist: [0, 0, 0, 0, 0], count: 0, average: 0 };
    var stars = ['★5', '★4', '★3', '★2', '★1'];
    var starColors = isDark()
      ? ['#3987e5', '#5f9ded', '#8bb7f2', '#b3cff6', '#d6e5fa']
      : ['#1d5fae', '#2a78d6', '#5c97e0', '#93bcec', '#c3d9f5'];
    var uniRows = (d.byUni || []).map(function (u) { return { name: u.name + (u.current ? ' ●' : ''), n: u.n }; });

    var block = el('div', { class: 'pa-admin', 'data-pa-admin': '' }, [
      el('style', { text: CSS }),
      el('div', { class: 'pa-head' }, [
        el('span', { class: 'pa-badge', text: 'Только для модератора' }),
        el('p', { class: 'sx__note', text: 'Это видишь только ты. Остальным приложение показывает общую картину — без устройств, моделей телефонов, браузеров и языка.' }),
        el('a', { class: 'pa-full', href: '/analytics' + (brand.hub && brand.id ? '?uni=' + encodeURIComponent(brand.id) : ''), target: '_blank', rel: 'noopener', text: 'Аналитика на весь экран: курсы, группы, кто ещё не пользуется →' }),
      ]),
      el('div', { class: 'tiles' }, [
        tile('За 30 дней', fmt(new30), 'новых людей'),
        tile('В среднем', fmt(avgDay), 'людей в день за 30 дней'),
        tile('Лучший день', fmt(best.users), best.date),
        tile('Оценка', rv.count ? String(rv.average).replace('.', ',') + ' ★' : '—', fmt(rv.count) + ' отзывов'),
      ]),
      el('div', { class: 'pa-grid' }, [
        donut('Устройства', 'Люди по типу устройства', d.byDevice),
        donut('Марки телефонов', null, d.byBrand),
        donut('Системы', null, d.byOs),
        donut('Браузеры', null, d.byBrowser),
        donut('Откуда приходят', 'Где человек впервые открыл ссылку', d.bySource),
        donut('Язык телефона', null, d.byLang),
        donut('Экраны', 'Ширина экрана, CSS-пиксели', d.byScreen),
        donut('Верность', 'Сколько разных дней человек открывал', d.byLoyalty),
        rv.count ? donut('Оценки', 'Все отзывы по звёздам', rv.dist.slice().reverse().map(function (n, i) { return { name: stars[i], n: n }; }).filter(function (r) { return r.n; }), rv.dist.slice().reverse().map(function (n, i) { return n ? starColors[i] : null; }).filter(Boolean)) : null,
        donut('Вузы', '● — этот вуз. Люди за всё время', uniRows),
      ]),
      radar('Часы суток', 'Заходы по часам за всё время, Ташкент',
        hours.map(function (h) { return String(h.h).padStart(2, '0'); }),
        [{ name: 'Заходы', values: hours.map(function (h) { return h.n; }) }],
        { labelEvery: 3, axisFull: function (i) { return String(i).padStart(2, '0') + ':00'; } }),
      radar('Дни недели', 'Заходы и люди по дням недели',
        wd.map(function (x) { return x.name; }),
        [{ name: 'Заходы', values: wd.map(function (x) { return x.n; }) }, { name: 'Люди', values: wd.map(function (x) { return x.users; }) }]),
      bars('Модели', 'iPhone не сообщает модель — только что это iPhone', d.byModel),
      bars('Группы', null, d.byGroup),
    ]);
    return block;
  }

  var CSS = ''
    + '.pa-admin{margin-top:26px;padding-top:16px;border-top:1px solid var(--sep)}'
    + '.pa-badge{display:inline-block;font-size:11.5px;font-weight:600;letter-spacing:.02em;text-transform:uppercase;color:var(--accent);'
    + 'background:var(--accent-press);border-radius:999px;padding:3px 9px}'
    + '.pa-head .sx__note{margin-top:8px}'
    + '.pa-full{display:block;margin-top:10px;padding:11px 14px;border-radius:14px;background:var(--accent-press);color:var(--accent);font-weight:600;font-size:14px;text-decoration:none}'
    + '.pa-grid{display:grid;grid-template-columns:1fr;gap:0}'
    + '.pa-card{padding:12px 14px;border-radius:16px;background:var(--surface-2);margin-top:10px}'
    + '.pa-donut{display:flex;align-items:center;gap:14px}'
    + '.pa-donut__svg{flex:none;width:112px;height:112px}.pa-donut__svg svg{width:100%;height:100%;display:block;overflow:visible}'
    + '.pa-slice{cursor:pointer;transition:opacity .15s}'
    + '.pa-dv{font-size:17px;font-weight:700;fill:var(--ink-100)}.pa-dl{font-size:10px;fill:var(--ink-60)}'
    + '.pa-leg{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}'
    + '.pa-leg--row{flex-direction:row;flex-wrap:wrap;gap:4px 14px;margin:4px 0}'
    + '.pa-li{display:flex;align-items:center;gap:7px;font-size:12.5px;line-height:1.3;color:var(--ink-100);transition:opacity .15s}'
    + '.pa-li.is-dim{opacity:.4}'
    + '.pa-li i{flex:none;width:9px;height:9px;border-radius:3px}'
    + '.pa-li__n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
    + '.pa-li__v{flex:none;color:var(--ink-60);font-variant-numeric:tabular-nums}'
    + '.pa-radar__wrap{display:flex;justify-content:center}.pa-radar{width:100%;max-width:300px;height:auto;overflow:visible}'
    + '.pa-ax{font-size:10.5px;fill:var(--ink-60)}.pa-ax--max{font-size:9px;fill:var(--ink-30)}'
    + '.pa-tip{font-size:11.5px;font-weight:600;fill:var(--ink-100)}'
    + '.pa-dot{pointer-events:none;transition:r .12s}'
    + '@media (min-width:420px){.pa-grid{grid-template-columns:1fr}}';

  // «Вся статистика» раскрыта — под общими списками дописываем блок модератора.
  function attach(sxs) {
    if (denied || sxs.querySelector('[data-pa-admin]') || sxs.getAttribute('data-pa-wait')) return;
    sxs.setAttribute('data-pa-wait', '1');
    load().then(function (d) {
      sxs.removeAttribute('data-pa-wait');
      if (!d || !sxs.isConnected || sxs.querySelector('[data-pa-admin]')) return;
      var foot = sxs.querySelector('.sx__foot');
      var block = render(d);
      if (foot) sxs.insertBefore(block, foot); else sxs.appendChild(block);
    });
  }
  function scan() {
    if (denied) return;
    var list = document.querySelectorAll('.sxs');
    for (var i = 0; i < list.length; i++) attach(list[i]);
  }
  var queued = false;
  new MutationObserver(function () {
    if (denied || queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; scan(); });
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
