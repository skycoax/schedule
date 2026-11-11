// «Неделя целиком»: подписи в ячейках, свой цвет каждому предмету и подробности пары по нажатию.
// Сервер добавляет этот файл в страницу приложения (site.js): исходники приложения живут отдельно,
// а файлы сборки (/assets/) кешируются навсегда, поэтому сетку дорабатываем здесь, поверх готового DOM.
// Приложение красит предметы восемью цветами по кругу — у девятого цвет первого. Когда предметов больше
// восьми, перекрашиваем их своей палитрой (ячейки, легенду и карточки дней — одинаково), иначе не трогаем.
// Название предмета берём из title ячейки («Предмет · День»), подробности — из карточки этого дня ниже.
(function () {
  'use strict';
  var path = location.pathname;
  if (path !== '/' && path !== '/index.html') return;

  var DAYS = { 'Пн': 'Понедельник', 'Вт': 'Вторник', 'Ср': 'Среда', 'Чт': 'Четверг', 'Пт': 'Пятница', 'Сб': 'Суббота' };
  // 16 различимых оттенков — для групп, где предметов больше восьми. Подпись в ячейке всё равно главная.
  var LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#2e9e3e', '#6250d6', '#e34948',
    '#0f9fb5', '#9a6136', '#a347c7', '#7f8f00', '#5d6d82', '#c2185b', '#d4a017', '#00796b'];
  var DARK = ['#3987e5', '#e0703f', '#22b585', '#d99a10', '#e07aa2', '#3aa84a', '#8a7ef0', '#e66767',
    '#1fb3c9', '#b07a52', '#b866d8', '#97a812', '#7d8ca0', '#e0457f', '#e3b53a', '#26a69a'];

  var subjColors = Object.create(null);   // предмет → свой цвет (только когда предметов > 8)
  var subjShort = Object.create(null);    // предмет → сокращение для узкой ячейки
  var legendKey = '';

  function isDark() {
    return getComputedStyle(document.documentElement).getPropertyValue('--surface').trim().toLowerCase() === '#1c1c1e';
  }
  var subjOf = function (td) { return String(td.getAttribute('title') || '').split(' · ')[0].trim(); };

  // ─── Сокращение: «История России» → «Истор.», «Физ. культура и спорт» → «Физ. к.», «БЖД» → «БЖД» ───
  var VOWELS = /[аеёиоуыэюяaeiouy]$/i;
  function stem(w, len) {
    var s = w.slice(0, len);
    if (s.length === w.length) return s;
    while (s.length > 3 && VOWELS.test(s)) s = s.slice(0, -1);   // по-русски сокращают на согласную
    return s + '.';
  }
  function shorten(name, len) {
    var words = name.replace(/\s+/g, ' ').trim().split(' ');
    if (name.length <= len) return name;
    var first = words[0];
    if (first.replace(/\.$/, '').length <= 4 && words[1]) {
      return first + ' ' + words[1].charAt(0).toLowerCase() + '.';
    }
    return stem(first, len - 1);
  }
  function buildShorts(names) {
    var out = Object.create(null), seen = Object.create(null);
    names.forEach(function (n) { out[n] = shorten(n, 7); });
    names.forEach(function (n) { seen[out[n]] = (seen[out[n]] || 0) + 1; });
    // Одинаковые сокращения у разных предметов — добавляем начало второго слова или берём длиннее.
    names.forEach(function (n) {
      if (seen[out[n]] < 2) return;
      var w = n.split(/\s+/);
      out[n] = w[1] ? stem(w[0], 5) + ' ' + stem(w[1], 4) : stem(n, 10);
    });
    return out;
  }

  // Чёрный или белый текст поверх цвета ячейки — по яркости.
  function inkFor(color) {
    var m = String(color).match(/\d+(\.\d+)?/g);
    if (!m || m.length < 3) return '#fff';
    var lin = function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    var L = 0.2126 * lin(+m[0]) + 0.7152 * lin(+m[1]) + 0.0722 * lin(+m[2]);
    return L > 0.36 ? 'rgba(0,0,0,.82)' : '#fff';
  }

  function setVar(node, color) {
    if (color && node.style.getPropertyValue('--c') !== color) node.style.setProperty('--c', color);
  }

  // ─── Палитра по легенде (она отсортирована по числу пар — частые предметы получают первые цвета) ───
  function syncLegend(card) {
    var names = [];
    card.querySelectorAll('.leg__name').forEach(function (n) { names.push(n.textContent.trim()); });
    var key = names.join('|');
    if (key !== legendKey) {
      legendKey = key;
      subjShort = buildShorts(names);
      subjColors = Object.create(null);
      if (names.length > 8) {
        var pal = isDark() ? DARK : LIGHT;
        names.forEach(function (n, i) { subjColors[n] = pal[i % pal.length]; });
      }
    }
    card.querySelectorAll('.leg').forEach(function (leg) {
      var n = leg.querySelector('.leg__name');
      if (n) setVar(leg, subjColors[n.textContent.trim()]);
    });
  }

  function syncMatrix(matrix) {
    matrix.querySelectorAll('td.cell').forEach(function (td) {
      var label = td.querySelector('.wk-l');
      if (!td.classList.contains('on')) { if (label) label.remove(); td.removeAttribute('data-wk'); return; }
      var subj = subjOf(td);
      setVar(td, subjColors[subj]);
      if (!label) {
        label = document.createElement('span');
        label.className = 'wk-l';
        td.appendChild(label);
        td.setAttribute('role', 'button');
        td.setAttribute('tabindex', '0');
      }
      var wide = td.clientWidth >= 110;
      var text = wide ? subj : (subjShort[subj] || shorten(subj, 7));
      if (label.textContent !== text) label.textContent = text;
      var ink = inkFor(getComputedStyle(td).backgroundColor);
      if (label.style.color !== ink) label.style.color = ink;
      td.setAttribute('aria-label', subj);
      td.setAttribute('data-wk', '1');
    });
  }

  // Карточки дней и «Сегодня» — тем же цветом, что и сетка.
  function syncRows() {
    if (!legendKey) return;
    document.querySelectorAll('.row').forEach(function (row) {
      var n = row.querySelector('.row__name');
      if (n) setVar(row, subjColors[n.textContent.trim()]);
    });
  }

  function scan() {
    document.querySelectorAll('.matrix').forEach(function (matrix) {
      var card = matrix.closest('.card');
      if (card) syncLegend(card);
      syncMatrix(matrix);
    });
    syncRows();
  }

  // ─── Подробности пары по нажатию ───
  var pop = null;
  function closePop() { if (pop) { pop.remove(); pop = null; } }

  function rowFor(td) {
    // Столбец — день (первый столбец — номера пар), строка — номер пары. В карточке дня пары идут по порядку,
    // поэтому нужная — k-я по счёту среди занятых ячеек этого столбца выше и включая эту.
    var col = td.cellIndex;
    var tr = td.parentElement;
    var k = -1;
    var rows = tr.parentElement.children;
    for (var i = 1; i < rows.length; i++) {
      var c = rows[i].children[col];
      if (c && c.classList.contains('on')) k++;
      if (rows[i] === tr) break;
    }
    var days = document.getElementById('days');
    var dayCard = days && days.children[col - 1];
    var list = dayCard ? dayCard.querySelectorAll('.row') : [];
    return { row: list[k] || null, pair: Array.prototype.indexOf.call(rows, tr) };
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function openPop(td) {
    closePop();
    var subj = subjOf(td);
    var th = td.closest('table').querySelector('tr').children[td.cellIndex];
    var dayShort = th ? th.textContent.trim() : '';
    var found = rowFor(td);
    var row = found.row;
    var time = row && row.querySelector('.row__ms');
    var room = row && row.querySelector('.room');
    var who = row && row.querySelector('.who');
    var chg = row && row.querySelector('.chg');

    pop = el('div', 'wk-pop');
    pop.setAttribute('role', 'dialog');
    pop.style.setProperty('--c', getComputedStyle(td).getPropertyValue('--c'));
    var head = el('div', 'wk-pop__h');
    head.appendChild(el('i', 'wk-pop__dot'));
    head.appendChild(el('b', '', subj));
    pop.appendChild(head);
    pop.appendChild(el('div', 'wk-pop__s',
      (DAYS[dayShort] || dayShort) + ' · ' + found.pair + ' пара' + (time ? ' · ' + time.textContent.trim() : '')));
    if (room) pop.appendChild(el('div', 'wk-pop__l', '📍 ' + room.textContent.trim()));
    if (who) pop.appendChild(el('div', 'wk-pop__l', '👤 ' + who.textContent.trim()));
    if (chg) pop.appendChild(el('div', 'wk-pop__l wk-pop__chg', chg.textContent.trim() + (chg.title ? ' — ' + chg.title : '')));
    if (row) {
      var go = el('button', 'wk-pop__go', 'Открыть день');
      go.addEventListener('click', function () {
        closePop();
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        row.classList.remove('wk-flash'); void row.offsetWidth; row.classList.add('wk-flash');
        setTimeout(function () { row.classList.remove('wk-flash'); }, 1600);
      });
      pop.appendChild(go);
    }
    document.body.appendChild(pop);

    // Под ячейкой, а если не помещается — над ней; по горизонтали — в пределах экрана.
    var r = td.getBoundingClientRect();
    var w = pop.offsetWidth, h = pop.offsetHeight;
    var left = Math.min(Math.max(12, r.left + r.width / 2 - w / 2), window.innerWidth - w - 12);
    var top = r.bottom + 8;
    if (top + h > window.innerHeight - 12) top = Math.max(12, r.top - h - 8);
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
    td.classList.add('wk-sel');
    pop._td = td;
    var prev = pop;
    var cleanup = function () { td.classList.remove('wk-sel'); };
    var obs = new MutationObserver(function () { if (!prev.isConnected) { cleanup(); obs.disconnect(); } });
    obs.observe(document.body, { childList: true });
  }

  document.addEventListener('click', function (e) {
    var td = e.target.closest && e.target.closest('.matrix td.cell.on');
    if (td) {
      if (pop && pop._td === td) { closePop(); return; }
      openPop(td);
      return;
    }
    if (pop && !pop.contains(e.target)) closePop();
  }, true);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closePop();
    var td = e.target.closest && e.target.closest('.matrix td.cell.on');
    if (td && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openPop(td); }
  });
  window.addEventListener('scroll', closePop, { passive: true, capture: true });
  window.addEventListener('resize', function () { closePop(); scan(); });

  var style = document.createElement('style');
  style.textContent = ''
    + '.matrix td.cell{height:28px;padding:0;position:relative;overflow:hidden;max-width:0}'
    + '.matrix td.cell.on{cursor:pointer;-webkit-tap-highlight-color:transparent;transition:transform .15s,box-shadow .15s}'
    + '.matrix td.cell.on:active{transform:scale(.94)}'
    + '.matrix td.cell.on.wk-sel{opacity:1!important;box-shadow:0 0 0 2px var(--surface),0 0 0 4px var(--c)}'
    + '.wk-l{display:block;padding:0 4px;font-size:10.5px;font-weight:600;line-height:28px;letter-spacing:-.01em;'
    + 'text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none}'
    + '@media (min-width:600px){.wk-l{font-size:12px}}'
    + '.wk-pop{position:fixed;z-index:60;width:min(280px,calc(100vw - 24px));box-sizing:border-box;padding:12px 14px;border-radius:16px;'
    + 'background:var(--sheet-bg,rgba(255,255,255,.96));color:var(--ink-100);-webkit-backdrop-filter:blur(24px) saturate(180%);'
    + 'backdrop-filter:blur(24px) saturate(180%);box-shadow:inset 0 0 0 1px var(--glass-edge,rgba(60,60,67,.1)),0 10px 30px rgba(0,0,0,.22);'
    + 'font:14px/1.35 var(--font,-apple-system,system-ui,sans-serif);animation:wk-in .16s ease-out}'
    + '@keyframes wk-in{from{opacity:0;transform:translateY(4px) scale(.98)}}'
    + '.wk-pop__h{display:flex;align-items:flex-start;gap:8px;font-size:15px}'
    + '.wk-pop__h b{font-weight:600}'
    + '.wk-pop__dot{flex:none;width:10px;height:10px;border-radius:50%;background:var(--c);margin-top:5px}'
    + '.wk-pop__s{margin:4px 0 0 18px;font-size:13px;color:var(--ink-60)}'
    + '.wk-pop__l{margin:6px 0 0 18px;font-size:13.5px}'
    + '.wk-pop__chg{color:var(--red-ink)}'
    + '.wk-pop__go{margin:10px 0 0 18px;border:0;border-radius:999px;padding:6px 12px;background:var(--accent-press,rgba(0,122,255,.12));'
    + 'color:var(--accent,#007aff);font-family:inherit;font-weight:600;font-size:13px;line-height:1.2;cursor:pointer}'
    + '.row.wk-flash{animation:wk-flash 1.5s ease-out}'
    + '@keyframes wk-flash{0%,35%{background:color-mix(in srgb,var(--c) 22%,transparent)}100%{background:transparent}}';
  document.head.appendChild(style);

  var queued = false;
  new MutationObserver(function () {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; scan(); });
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['title', 'class'] });
  scan();
  // Тема поменялась — палитру пересчитать.
  if (window.matchMedia) {
    var mq = matchMedia('(prefers-color-scheme: dark)');
    var re = function () { legendKey = ''; scan(); };
    if (mq.addEventListener) mq.addEventListener('change', re);
  }
})();
