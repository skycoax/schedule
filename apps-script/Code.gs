/**
 * Расписание КФУ (Джизак) — удобный просмотр + уведомления об изменениях.
 *
 * Что делает:
 *   1. doGet()        — отдаёт веб-страницу с расписанием твоей группы (ссылка для телефона).
 *   2. checkChanges() — раз в час сравнивает таблицу со снимком и шлёт в Telegram, что поменялось.
 *
 * Настройка — см. НАСТРОЙКА.md
 */

// ─────────────────────────── КОНФИГ ───────────────────────────

/** ID исходной таблицы с расписанием (менять не нужно). */
var SOURCE_ID = '1yuMXcH7UqitZwrlVAISPVtviBuTq6q4t9BSO97sPClc';

/** Папка в твоём Диске, где скрипт хранит снимок и историю изменений. */
var DATA_FOLDER = 'Расписание КФУ — данные';

var SNAPSHOT_FILE = 'raspisanie_snapshot.json';
var CHANGELOG_FILE = 'raspisanie_changes.json';

var DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
var DAY_FULL = {
  'Пн': 'Понедельник', 'Вт': 'Вторник', 'Ср': 'Среда',
  'Чт': 'Четверг', 'Пт': 'Пятница', 'Сб': 'Суббота', 'Вс': 'Воскресенье'
};

var TZ = 'Asia/Tashkent';

// ─────────────────────── РАЗБОР ТАБЛИЦЫ ───────────────────────

/** Похоже ли содержимое ячейки на заголовок группы? «1 курс Геология 05.03.01» */
function isGroupHeader_(s) {
  s = String(s || '').trim();
  if (!s) return false;
  // Шапка листа («Расписание с 07.09.2026 года…») — не группа.
  if (/^Расписание\s+с\s/i.test(s)) return false;
  // \b в JS не работает с кириллицей — границу слова задаём явным lookahead.
  // (?!\d) отсекает даты: 05.03.01 — код специальности, 07.09.2026 — нет.
  return /\d{2}\.\d{2}\.\d{2}(?!\d)/.test(s) || /^\s*\d\s*курс(?![А-Яа-яЁё])/i.test(s);
}

/** Приводим подпись дня к «Пн»/«Вт»/… или '' если это не день. */
function normDay_(s) {
  s = String(s || '').replace(/[^А-Яа-яЁё]/g, '').toLowerCase();
  if (!s) return '';
  var map = {
    'пн': 'Пн', 'пон': 'Пн', 'понедельник': 'Пн',
    'вт': 'Вт', 'вторник': 'Вт',
    'ср': 'Ср', 'среда': 'Ср',
    'чт': 'Чт', 'четверг': 'Чт',
    'пт': 'Пт', 'пятница': 'Пт',
    'сб': 'Сб', 'суббота': 'Сб',
    'вс': 'Вс', 'воскресенье': 'Вс'
  };
  return map[s] || '';
}

function clean_(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

/** «1-я пара 08:30 - 09:50» → «08:30 – 09:50» (только время). */
function timeOnly_(s) {
  var m = String(s || '').match(/(\d{1,2}[:.]\d{2})\s*[-–—]\s*(\d{1,2}[:.]\d{2})/);
  return m ? m[1].replace('.', ':') + ' – ' + m[2].replace('.', ':') : '';
}

/**
 * Читает исходную таблицу целиком и возвращает нормализованную структуру:
 * { header, fetchedAt, groups: [ {key, sheet, course, name, link, times[6], days:[{day, pairs[6]}]} ] }
 */
function parseSource_() {
  var ss = SpreadsheetApp.openById(SOURCE_ID);
  var out = { title: ss.getName(), header: '', groups: [] };

  ss.getSheets().forEach(function (sh) {
    if (sh.isSheetHidden()) return;
    var sheetName = sh.getName();
    var v = sh.getDataRange().getDisplayValues();

    // Шапка «Расписание с 07.09.2026 года, 1 семестра, …» — берём первую найденную.
    if (!out.header) {
      for (var i = 0; i < Math.min(v.length, 5); i++) {
        var line = clean_(v[i].join(' '));
        if (/Расписание\s+с\s+\d/i.test(line)) { out.header = line; break; }
      }
    }

    for (var r = 0; r < v.length; r++) {
      var a = clean_(v[r][0]);
      if (!isGroupHeader_(a)) continue;

      var rowText = v[r].join(' ');
      var link = (rowText.match(/https?:\/\/\S+/) || [''])[0];
      var name = clean_(a.replace(/https?:\/\/\S+/g, ''));

      // Строка с парами и временем — следующая за заголовком.
      var timesRow = v[r + 1] || [];
      var times = [];
      for (var c = 1; c <= 6; c++) times.push(timeOnly_(timesRow[c]));

      // Дни идут подряд, пока не встретится следующий заголовок группы.
      var days = [];
      for (var k = r + 2; k < v.length && days.length < 7; k++) {
        var first = clean_(v[k][0]);
        if (isGroupHeader_(first)) break;
        var d = normDay_(first);
        if (!d) continue;
        var pairs = [];
        for (var c2 = 1; c2 <= 6; c2++) pairs.push(clean_(v[k][c2]));
        days.push({ day: d, pairs: pairs });
      }

      var course = (name.match(/^\s*(\d)\s*курс/i) || [null, ''])[1];
      out.groups.push({
        key: sheetName + ' :: ' + name,
        sheet: sheetName,
        course: course,
        name: name,
        link: link,
        times: times,
        days: days
      });
    }
  });

  out.fetchedAt = new Date().toISOString();
  return out;
}

// ───────────────────── ХРАНИЛИЩЕ (Google Диск) ─────────────────────

function dataFolder_() {
  var it = DriveApp.getFoldersByName(DATA_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(DATA_FOLDER);
}

function readJson_(name, fallback) {
  var it = dataFolder_().getFilesByName(name);
  if (!it.hasNext()) return fallback;
  try {
    return JSON.parse(it.next().getBlob().getDataAsString('UTF-8'));
  } catch (e) {
    return fallback;
  }
}

function writeJson_(name, obj) {
  var folder = dataFolder_();
  var body = JSON.stringify(obj);
  var it = folder.getFilesByName(name);
  if (it.hasNext()) it.next().setContent(body);
  else folder.createFile(name, body, 'application/json');
}

// ────────────────────────── СРАВНЕНИЕ ──────────────────────────

function indexGroups_(data) {
  var m = {};
  ((data && data.groups) || []).forEach(function (g) { m[g.key] = g; });
  return m;
}

/**
 * Сравнивает два снимка и возвращает список изменений:
 * [{type, group, sheet, day, pair, time, before, after}]
 */
function diffSnapshots_(oldData, newData) {
  var changes = [];
  var A = indexGroups_(oldData), B = indexGroups_(newData);

  if (oldData && oldData.header && newData.header && oldData.header !== newData.header) {
    changes.push({ type: 'header', before: oldData.header, after: newData.header });
  }

  Object.keys(B).forEach(function (key) {
    var nb = B[key];
    var ob = A[key];
    if (!ob) { changes.push({ type: 'group_added', group: nb.name, sheet: nb.sheet }); return; }

    var oldDays = {}, newDays = {};
    (ob.days || []).forEach(function (d) { oldDays[d.day] = d.pairs || []; });
    (nb.days || []).forEach(function (d) { newDays[d.day] = d.pairs || []; });

    Object.keys(newDays).forEach(function (day) {
      var op = oldDays[day] || [];
      var np = newDays[day] || [];
      for (var i = 0; i < 6; i++) {
        var before = clean_(op[i]), after = clean_(np[i]);
        if (before === after) continue;
        changes.push({
          type: !before ? 'added' : (!after ? 'removed' : 'changed'),
          group: nb.name, sheet: nb.sheet, day: day, pair: i + 1,
          time: (nb.times || [])[i] || '',
          before: before, after: after
        });
      }
    });

    if (clean_(ob.link) !== clean_(nb.link)) {
      changes.push({ type: 'link', group: nb.name, sheet: nb.sheet, before: ob.link, after: nb.link });
    }
  });

  Object.keys(A).forEach(function (key) {
    if (!B[key]) changes.push({ type: 'group_removed', group: A[key].name, sheet: A[key].sheet });
  });

  return changes;
}

// ────────────────────────── TELEGRAM ──────────────────────────

function props_() { return PropertiesService.getScriptProperties(); }

function tgSend_(text) {
  var token = props_().getProperty('TG_TOKEN');
  var chat = props_().getProperty('TG_CHAT_ID');
  if (!token || !chat) { Logger.log('Telegram не настроен — пропускаю отправку.'); return false; }
  var res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    payload: JSON.stringify({
      chat_id: chat, text: text, parse_mode: 'HTML', disable_web_page_preview: true
    })
  });
  var ok = res.getResponseCode() === 200;
  if (!ok) Logger.log('Telegram ответил ' + res.getResponseCode() + ': ' + res.getContentText());
  return ok;
}

/**
 * ЗАПУСТИ ОДИН РАЗ ВРУЧНУЮ, после того как впишешь TG_TOKEN и нажмёшь «Start» своему боту.
 * Находит твой chat_id и сохраняет его.
 */
function tgFindChatId() {
  var token = props_().getProperty('TG_TOKEN');
  if (!token) throw new Error('Сначала впиши TG_TOKEN в свойства скрипта (см. НАСТРОЙКА.md, шаг 4).');
  var res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/getUpdates', { muteHttpExceptions: true });
  var body = JSON.parse(res.getContentText());
  if (!body.ok) throw new Error('Telegram: ' + res.getContentText());
  var ids = {};
  (body.result || []).forEach(function (u) {
    var msg = u.message || u.edited_message || u.channel_post;
    if (msg && msg.chat) ids[msg.chat.id] = (msg.chat.username || msg.chat.first_name || msg.chat.title || '');
  });
  var keys = Object.keys(ids);
  if (!keys.length) throw new Error('Не вижу сообщений. Открой своего бота в Telegram, нажми «Start» и запусти эту функцию снова.');
  props_().setProperty('TG_CHAT_ID', keys[0]);
  tgSend_('✅ Готово. Бот подключён — буду присылать сюда изменения в расписании.');
  Logger.log('Сохранён chat_id: ' + keys[0] + ' (' + ids[keys[0]] + '). Найдено всего: ' + JSON.stringify(ids));
  return keys[0];
}

// ─────────────────── ОСНОВНАЯ ПРОВЕРКА (по триггеру) ───────────────────

function watchedKeys_() {
  try { return JSON.parse(props_().getProperty('WATCH') || '[]'); } catch (e) { return []; }
}

function esc_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatChangesForTelegram_(changes) {
  var lines = ['📅 <b>Расписание изменилось</b>'];
  var hdr = changes.filter(function (c) { return c.type === 'header'; })[0];
  if (hdr) lines.push('<i>' + esc_(hdr.after) + '</i>');
  lines.push('');

  var byGroup = {}, order = [];
  changes.forEach(function (c) {
    if (c.type === 'header') return;
    var g = c.group || '—';
    if (!byGroup[g]) { byGroup[g] = []; order.push(g); }
    byGroup[g].push(c);
  });

  order.forEach(function (grp) {
    lines.push('<b>' + esc_(grp) + '</b>');
    byGroup[grp].forEach(function (c) {
      if (c.type === 'group_added') { lines.push('• группа появилась в таблице'); return; }
      if (c.type === 'group_removed') { lines.push('• группа убрана из таблицы'); return; }
      if (c.type === 'link') { lines.push('• ссылка на Телемост изменилась'); return; }
      lines.push('• ' + (DAY_FULL[c.day] || c.day) + ', ' + c.pair + '-я пара' + (c.time ? ' (' + c.time + ')' : ''));
      if (c.type === 'added') lines.push('   ➕ ' + esc_(c.after));
      else if (c.type === 'removed') lines.push('   ➖ было: ' + esc_(c.before) + ' — <b>пары нет</b>');
      else {
        lines.push('   было: <s>' + esc_(c.before) + '</s>');
        lines.push('   стало: <b>' + esc_(c.after) + '</b>');
      }
    });
    lines.push('');
  });

  var url = webAppUrl_();
  if (url) lines.push('👉 <a href="' + url + '">Открыть расписание</a>');
  return lines.join('\n').slice(0, 4000);
}

function webAppUrl_() {
  var saved = props_().getProperty('WEBAPP_URL');
  if (saved) return saved;
  try { return ScriptApp.getService().getUrl(); } catch (e) { return ''; }
}

/** Главная функция — её вызывает почасовой триггер. */
function checkChanges() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    var fresh = parseSource_();
    var prev = readJson_(SNAPSHOT_FILE, null);

    writeJson_(SNAPSHOT_FILE, fresh);
    try { CacheService.getScriptCache().remove('schedule'); } catch (e) {}

    if (!prev) { Logger.log('Первый запуск — снимок сохранён, сравнивать пока не с чем.'); return; }

    var all = diffSnapshots_(prev, fresh);
    if (!all.length) { Logger.log('Изменений нет.'); return; }

    // Пишем в историю всё, что поменялось (её видно на вкладке «Изменения»).
    var log = readJson_(CHANGELOG_FILE, []);
    log.unshift({ ts: new Date().toISOString(), changes: all });
    writeJson_(CHANGELOG_FILE, log.slice(0, 100));

    // В Telegram шлём только про отслеживаемые группы.
    var watch = watchedKeys_();
    var mine = all;
    if (watch.length) {
      var names = {};
      (fresh.groups || []).forEach(function (g) { if (watch.indexOf(g.key) >= 0) names[g.name] = true; });
      mine = all.filter(function (c) { return c.type === 'header' || names[c.group]; });
    }
    if (!mine.length) { Logger.log('Изменения есть, но не в твоих группах.'); return; }

    tgSend_(formatChangesForTelegram_(mine));
    Logger.log('Отправлено изменений: ' + mine.length);
  } finally {
    lock.releaseLock();
    try { buildStats(); } catch (e) { Logger.log('Сводка не собралась: ' + e); }
  }
}

// ──────────────────────── ВЕБ-ПРИЛОЖЕНИЕ ────────────────────────

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.fn === 'ics') {
    var body = buildIcs_(p.group || '');
    return ContentService
      .createTextOutput(body || 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR')
      .setMimeType(ContentService.MimeType.ICAL);
  }
  if (p.fn) return jsonOut_(handleApi_(p));

  // Приложение переехало на свой домен — Apps Script остался только «трубой
  // данных» для fn=... (в т.ч. для нашего же сервера). Живого человека, который
  // открыл голую ссылку /exec, сразу отправляем на новый адрес — с сохранением
  // группы и метки источника, чтобы не выбирать её заново.
  var qs = [];
  if (p.group) qs.push('group=' + encodeURIComponent(p.group));
  if (p.from) qs.push('from=' + encodeURIComponent(p.from));
  var target = 'https://kfu.skycoax.uz/' + (qs.length ? '?' + qs.join('&') : '');
  return redirectPage_(target);
}

/**
 * У Apps Script нет настоящего HTTP-редиректа для веб-приложений — страница
 * всегда открывается внутри чужого iframe Google (script.googleusercontent.com
 * внутри script.google.com), а его sandbox даёт top-navigation только по
 * прямому клику пользователя (allow-top-navigation-by-user-activation) —
 * автоматический JS-редирект браузер молча блокирует, без ошибки, meta-refresh
 * тоже не переводит верхнее окно. Поэтому вместо авто-перехода — явная кнопка:
 * клик по <a target="_top"> — это и есть та самая пользовательская активация,
 * которую sandbox разрешает.
 */
function redirectPage_(url) {
  var safe = String(url).replace(/&/g, '&amp;').replace(/'/g, '%27').replace(/"/g, '%22');
  var html = '<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>Расписание</title></head>' +
    '<body style="font:15px -apple-system,BlinkMacSystemFont,sans-serif;' +
    'padding:40px 24px;text-align:center;color:#1c1c1e;background:#f2f2f7">' +
    '<div style="font-size:17px;font-weight:600;margin-bottom:10px">Расписание переехало</div>' +
    '<div style="font-size:14px;color:#3c3c4399;margin-bottom:22px;line-height:1.5">' +
    'Нажми кнопку — откроется новый адрес, настроенный на твою группу.</div>' +
    '<a href="' + safe + '" target="_top" style="display:inline-block;height:50px;' +
    'line-height:50px;padding:0 28px;border-radius:15px;background:#007AFF;color:#fff;' +
    'font-size:16px;font-weight:600;text-decoration:none">Перейти на новый сайт</a>' +
    '</body></html>';
  // <meta viewport> внутри html не работает: страница сидит в iframe Google, и масштаб
  // задаёт внешняя страница. Без addMetaTag на телефоне всё мелкое, как на десктопе.
  return HtmlService.createHtmlOutput(html)
    .setTitle('Расписание')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/* Старое тело doGet — держим функцию serveApp_ на случай, если понадобится
   вернуть встроенную страницу (например, для отладки без переезда). Сейчас
   не вызывается. */
function serveApp_(p) {
  var t = HtmlService.createTemplateFromFile('Index');
  // ?from=tg в ссылке — так различаем, откуда пришёл человек. Внутри Apps Script
  // настоящий referrer не виден: страница живёт в чужом фрейме.
  t.from = String(p.from || '').slice(0, 32).replace(/[^A-Za-z0-9_-]/g, '');
  // Внутри Apps Script у страницы каждый раз новый домен-песочница, поэтому
  // хранилище браузера обнуляется. Настройки везём в самой ссылке.
  t.grp0 = String(p.group || '').slice(0, 200)
    .replace(/[^0-9A-Za-zА-Яа-яЁё \.\-:№()]/g, '');
  t.ok0 = p.ok === '1' ? '1' : '';
  t.cid0 = String(p.u || '').slice(0, 14).replace(/[^a-z0-9]/gi, '');
  return t.evaluate()
    .setTitle('Расписание')
    // addMetaTag принимает только разрешённый список; theme-color и apple-* туда
    // не входят — они прописаны прямо в <head> файла Index.html.
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/* ─── JSON-API для страницы на своём сервере ───
   Чтение открыто, запись — только с токеном (makeApiToken). */
function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
function tokenOk_(t) {
  var want = props_().getProperty('API_TOKEN');
  return !!want && t === want;
}
function handleApi_(p) {
  try {
    if (p.fn === 'data') return { ok: true, data: api_getData(p.force === '1') };
    if (p.fn === 'refresh') { checkChanges(); return { ok: true, data: api_getData(true) }; }
    if (p.fn === 'hit') { logHit_(p); return { ok: true }; }
    if (p.fn === 'group' || p.fn === 'watch') {
      if (!tokenOk_(p.token)) return { ok: false, error: 'Нужен токен' };
      if (p.fn === 'group') api_setGroup(p.key || '');
      else api_setWatch(JSON.parse(p.keys || '[]'));
      return { ok: true };
    }
    return { ok: false, error: 'Неизвестная команда' };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** ЗАПУСТИ ОДИН РАЗ, если страница будет жить на своём сервере: выдаёт токен на запись. */
function makeApiToken() {
  var t = Utilities.getUuid().replace(/-/g, '').slice(0, 24);
  props_().setProperty('API_TOKEN', t);
  Logger.log('API_TOKEN: ' + t + '  — впиши его в index.html на сервере');
  return t;
}

/** Данные для страницы. Кэш на 10 минут, чтобы открывалось быстро. */
function api_getData(force) {
  var cache = CacheService.getScriptCache();
  var data = null;
  if (!force) {
    var hit = cache.get('schedule');
    if (hit) { try { data = JSON.parse(hit); } catch (e) { data = null; } }
  }
  if (!data) {
    data = readJson_(SNAPSHOT_FILE, null);
    if (!data || force) {
      data = parseSource_();
      writeJson_(SNAPSHOT_FILE, data);
    }
    try { cache.put('schedule', JSON.stringify(data), 600); } catch (e) {}
  }

  var now = new Date();
  var dow = Number(Utilities.formatDate(now, TZ, 'u')); // 1 = понедельник
  return {
    header: data.header || '',
    fetchedAt: data.fetchedAt || '',
    groups: data.groups || [],
    changes: readJson_(CHANGELOG_FILE, []).slice(0, 40),
    watch: watchedKeys_(),
    selected: props_().getProperty('SELECTED_GROUP') || '',
    exec: webAppUrl_(),
    owner: isOwner_(),
    tgReady: !!(props_().getProperty('TG_TOKEN') && props_().getProperty('TG_CHAT_ID')),
    now: {
      day: DAYS[dow - 1] || 'Вс',
      minutes: Number(Utilities.formatDate(now, TZ, 'H')) * 60 + Number(Utilities.formatDate(now, TZ, 'm')),
      dateLabel: Utilities.formatDate(now, TZ, 'd.MM'),
      stamp: Utilities.formatDate(now, TZ, 'HH:mm')
    }
  };
}

/**
 * Ссылка открыта всем, поэтому настройки меняет только владелец скрипта.
 * У анонимного посетителя getActiveUser() пуст — значит это не он.
 */
function isOwner_() {
  try {
    var active = Session.getActiveUser().getEmail();
    return !!active && active === Session.getEffectiveUser().getEmail();
  } catch (e) {
    return false;
  }
}

/** Запомнить выбранную группу (только для владельца). */
function api_setGroup(key) {
  if (!isOwner_()) return false;
  props_().setProperty('SELECTED_GROUP', String(key || ''));
  return true;
}

/** Включить/выключить уведомления для группы (только для владельца). */
function api_setWatch(keys) {
  if (!isOwner_()) return watchedKeys_();
  props_().setProperty('WATCH', JSON.stringify(keys || []));
  return watchedKeys_();
}

/** Проверить прямо сейчас (кнопка «Обновить» на странице). */
function api_refresh() {
  checkChanges();
  return api_getData(true);
}

// ─────────────────── СТАТИСТИКА ЗАХОДОВ ───────────────────
/*
 * Считаем обезличенно: ни имени, ни почты, ни телефона, ни точного места.
 * Посетитель — случайный номер, который живёт в его браузере и ни с чем не связан.
 * Всё, что собирается, слово в слово описано в «Условиях и данных» в приложении.
 */

var STATS_NAME = 'Расписание КФУ — статистика';

function statsSheet_() {
  var id = props_().getProperty('STATS_ID'), ss = null;
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create(STATS_NAME);
    props_().setProperty('STATS_ID', ss.getId());
    var sh = ss.getSheets()[0];
    sh.setName('Заходы');
    sh.appendRow(['Время', 'Посетитель', 'Новый', 'Источник', 'Метка',
                  'Referrer', 'Группа', 'Устройство', 'Экран', 'Язык']);
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 150);
    sh.setColumnWidth(7, 260);
    sh.getRange('A2:A').setNumberFormat('dd.MM.yyyy HH:mm');
  }
  return ss.getSheets()[0];
}

/* Внутри Apps Script страница видит referrer своей же обёртки, а не настоящий
   сайт. Такой адрес — не источник, а шум, и в таблицу он попадать не должен. */
function isSandbox_(u) {
  return /googleusercontent\.com|script\.google\.com/i.test(String(u || ''));
}

/** Человекочитаемый источник: по метке в ссылке, иначе по referrer. */
function srcName_(from, ref) {
  var f = String(from || '').toLowerCase();
  var map = { tg: 'Telegram', ig: 'Instagram', gh: 'GitHub', site: 'bestcenter.uz',
              qr: 'QR-код', chat: 'Чат группы' };
  if (f && map[f]) return map[f];
  if (f) return f;
  var r = String(ref || '').toLowerCase();
  if (!r || isSandbox_(r)) return 'Прямой заход';
  if (r.indexOf('t.me') >= 0 || r.indexOf('telegram') >= 0) return 'Telegram';
  if (r.indexOf('instagram') >= 0) return 'Instagram';
  if (r.indexOf('bestcenter') >= 0) return 'bestcenter.uz';
  if (r.indexOf('google.') >= 0) return 'Поиск Google';
  if (r.indexOf('youtube') >= 0) return 'YouTube';
  if (r.indexOf('facebook') >= 0) return 'Facebook';
  var host = r.split('/')[2];
  return host || 'Другое';
}

function cut_(v, n) { return String(v == null ? '' : v).slice(0, n); }

function logHit_(p) {
  try {
    statsSheet_().appendRow([
      new Date(),
      cut_(p.cid, 14),
      p.first === '1' ? 'да' : '',
      srcName_(p.from, p.ref),
      cut_(p.from, 32),
      isSandbox_(p.ref) ? '' : cut_(p.ref, 200),
      cut_(p.grp, 120),
      cut_(p.dev, 40),
      cut_(p.scr, 20),
      cut_(p.lang, 16)
    ]);
  } catch (e) {
    // Статистика не должна ронять расписание — молча пропускаем.
    Logger.log('Статистика не записалась: ' + e);
  }
}

/** Вызывается страницей внутри Apps Script. */
function api_hit(p) {
  logHit_(p || {});
  return true;
}

/*
 * Лист «Сводка» — то, ради чего статистика и нужна: сколько людей, откуда,
 * с чего и какие группы. Пересобирается целиком при каждом вызове, чтобы
 * не копить хвосты от прошлых запусков.
 */
/* В журнале уже лежат строки, записанные до фильтра песочницы: вместо
   источника там адрес обёртки Apps Script. Чистим на месте, один раз. */
function cleanLog_(log) {
  var n = log.getLastRow() - 1;
  if (n < 1) return;
  var rng = log.getRange(2, 4, n, 3);          // Источник, Метка, Referrer
  var v = rng.getValues(), dirty = false;
  v.forEach(function (r) {
    if (isSandbox_(r[0])) { r[0] = 'Прямой заход'; dirty = true; }
    if (isSandbox_(r[2])) { r[2] = ''; dirty = true; }
  });
  if (dirty) rng.setValues(v);
}

function buildStats() {
  var ss = statsSheet_().getParent();
  var log = ss.getSheetByName('Заходы');
  cleanLog_(log);
  var rows = log.getLastRow() > 1
    ? log.getRange(2, 1, log.getLastRow() - 1, 10).getValues() : [];

  var sh = ss.getSheetByName('Сводка') || ss.insertSheet('Сводка', 0);
  sh.clear();

  var today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  var people = {}, devices = {}, byDay = {}, byGroup = {}, byDev = {}, bySrc = {};
  var total = 0, todayHits = 0, todayNew = 0, newTotal = 0;

  rows.forEach(function (r) {
    var d = r[0];
    if (!d) return;
    var day = (d instanceof Date)
      ? Utilities.formatDate(d, TZ, 'yyyy-MM-dd')
      : String(d).slice(0, 10);
    total++;
    people[r[1]] = 1;
    /* Номер живёт только у тех, кто сохранил своё звено или добавил на экран.
       Для остальных считаем приблизительно: устройство + экран + язык. */
    devices[[r[7], r[8], r[9], r[6]].join('|')] = 1;
    byDay[day] = (byDay[day] || 0) + 1;
    if (r[6]) byGroup[r[6]] = (byGroup[r[6]] || 0) + 1;
    if (r[7]) byDev[r[7]] = (byDev[r[7]] || 0) + 1;
    if (r[3]) bySrc[r[3]] = (bySrc[r[3]] || 0) + 1;
    if (r[2]) { newTotal++; if (day === today) todayNew++; }
    if (day === today) todayHits++;
  });

  function top(obj, limit) {
    return Object.keys(obj)
      .map(function (k) { return [k, obj[k]]; })
      .sort(function (a, b) { return b[1] - a[1]; })
      .slice(0, limit || 100);
  }

  var out = [];
  function head(t) { out.push([t, '']); }
  function pair(a, b) { out.push([a, b]); }
  function blank() { out.push(['', '']); }

  pair('Обновлено', Utilities.formatDate(new Date(), TZ, 'dd.MM.yyyy HH:mm'));
  blank();
  head('ГЛАВНОЕ');
  pair('Всего заходов', total);
  pair('Разных устройств (примерно)', Object.keys(devices).length);
  pair('Заходов сегодня', todayHits);
  pair('Из них первый раз', todayNew);
  blank();

  head('ПО ДНЯМ');
  top(byDay, 14).sort(function (a, b) { return a[0] < b[0] ? 1 : -1; })
    .forEach(function (p) {
      pair(p[0].slice(8, 10) + '.' + p[0].slice(5, 7), p[1]);
    });
  blank();

  head('ГРУППЫ');
  top(byGroup, 15).forEach(function (p) { pair(p[0], p[1]); });
  blank();

  head('УСТРОЙСТВА');
  top(byDev).forEach(function (p) { pair(p[0], p[1]); });
  blank();

  head('ОТКУДА ПРИШЛИ');
  top(bySrc).forEach(function (p) { pair(p[0], p[1]); });

  sh.getRange(1, 1, out.length, 2).setValues(out);
  sh.setColumnWidth(1, 330);
  sh.setColumnWidth(2, 90);
  sh.getRange(1, 1, out.length, 1).setFontWeight('normal');
  // Заголовки разделов — жирным, чтобы сводка читалась сверху вниз.
  out.forEach(function (r, i) {
    if (r[0] && r[1] === '' && r[0] === r[0].toUpperCase() && r[0].length > 2) {
      sh.getRange(i + 1, 1, 1, 2).setFontWeight('bold').setBackground('#f1f3f4');
    }
  });
  sh.setFrozenRows(1);
  ss.setActiveSheet(sh);
  ss.moveActiveSheet(1);
  Logger.log('Сводка обновлена: ' + total + ' заходов, ' +
             Object.keys(people).length + ' человек');
  return total;
}

/** Ссылка на таблицу со статистикой — запусти и открой из журнала. */
function statsLink() {
  var url = statsSheet_().getParent().getUrl();
  Logger.log('Статистика: ' + url);
  return url;
}

// ─────────────────── КАЛЕНДАРЬ (.ics) ───────────────────
/*
 * Отдаём подписку, а не разовый файл: телефон перечитывает ссылку раз в несколько
 * часов, поэтому правки в таблице сами доезжают до календаря. Пары описаны одним
 * повторяющимся событием на каждый слот — так календарь весит копейки.
 */

/** Сколько недель длится семестр — на столько вперёд повторяем пары. */
var ICS_WEEKS = 18;

function pad2_(n) { return (n < 10 ? '0' : '') + n; }

function icsEsc_(t) {
  return String(t == null ? '' : t)
    .replace(/\\/g, '\\\\').replace(/;/g, '\\;')
    .replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

/** Длинные строки в iCalendar положено складывать, иначе часть клиентов их режет. */
function icsFold_(line) {
  if (line.length <= 72) return line;
  var out = [], s = line;
  while (s.length > 72) { out.push(s.slice(0, 72)); s = ' ' + s.slice(72); }
  out.push(s);
  return out.join('\r\n');
}

/** Устойчивый ASCII-идентификатор: календарь по нему узнаёт «то же самое событие». */
function icsUid_(key) {
  var h = 0;
  for (var i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return 'p' + h.toString(36) + '@kfu-jizzax';
}

/** «Расписание с 07.09.2026 года…» → дата, с которой действует расписание. */
function icsStart_(header) {
  var m = String(header || '').match(/с\s+(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? new Date(+m[3], +m[2] - 1, +m[1]) : new Date();
}

/** Первая дата нужного дня недели, начиная с start. dayIdx: 1 = понедельник. */
function icsFirstDate_(start, dayIdx) {
  var d = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  var cur = d.getDay() === 0 ? 7 : d.getDay();
  d.setDate(d.getDate() + ((dayIdx - cur) + 7) % 7);
  return d;
}

/** Дата + минуты от полуночи (по Ташкенту) → метка UTC для iCalendar. */
function icsStamp_(date, minutes) {
  var midnight = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  var inst = new Date(midnight.getTime() + minutes * 60000);
  return Utilities.formatDate(inst, 'UTC', "yyyyMMdd'T'HHmmss'Z'");
}

function icsMinutes_(range) {
  var m = String(range || '').match(/(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})/);
  return m ? { a: +m[1] * 60 + +m[2], b: +m[3] * 60 + +m[4] } : null;
}

/** Тот же разбор ячейки, что и на странице: предмет / аудитория / преподаватель. */
var ICS_ROOM_RE = /^(.*?)(\d{1,4}\s*(?:ауд|аудитория|ком|каб|зал)(?![А-Яа-яЁё])\.?(?:\s*[A-Z]{2,5}(?![a-zA-Z]))?)\s*(.*)$/i;
var ICS_WHO_RE = /(?:(?:проф|доц|асс|ст\.\s*пр|преп)\.?\s*[А-ЯЁ][а-яё]+|[А-ЯЁ][а-яё]+\s+[А-ЯЁ]\.)/;
function icsSplit_(txt) {
  var t = clean_(txt);
  if (!t) return null;
  var link = t.match(/https?:\/\/\S+/);
  if (link) t = clean_(t.replace(link[0], ''));
  if (!t) return null;
  var subj = t, room = '', who = '';
  var m = t.match(ICS_ROOM_RE);
  if (m && m[1].trim()) { subj = m[1].trim(); room = m[2].trim(); who = m[3].trim(); }
  if (!who) {
    var w = subj.match(ICS_WHO_RE);
    if (w && w.index > 0) { who = subj.slice(w.index).trim(); subj = subj.slice(0, w.index).trim(); }
  }
  return { subj: subj.replace(/[,.\s]+$/, ''), room: room, who: who.replace(/^[,\s]+/, '') };
}

/** Собирает подписку для одной группы. */
function buildIcs_(groupKey) {
  var data = readJson_(SNAPSHOT_FILE, null) || parseSource_();
  var g = ((data && data.groups) || []).filter(function (x) { return x.key === groupKey; })[0];
  if (!g) return null;

  var start = icsStart_(data.header);
  var until = new Date(start.getTime() + ICS_WEEKS * 7 * 86400000);
  var untilStamp = Utilities.formatDate(until, 'UTC', "yyyyMMdd'T'HHmmss'Z'");
  var now = Utilities.formatDate(new Date(), 'UTC', "yyyyMMdd'T'HHmmss'Z'");

  var L = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Raspisanie KFU Jizzax//RU',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    icsFold_('X-WR-CALNAME:' + icsEsc_(g.name)),
    'X-WR-TIMEZONE:' + TZ,
    'REFRESH-INTERVAL;VALUE=DURATION:PT4H',
    'X-PUBLISHED-TTL:PT4H'
  ];

  (g.days || []).forEach(function (d) {
    var idx = DAYS.indexOf(d.day) + 1;
    if (idx < 1 || idx > 6) return;
    var first = icsFirstDate_(start, idx);
    (d.pairs || []).forEach(function (cell, i) {
      var info = icsSplit_(cell);
      if (!info) return;
      var mm = icsMinutes_((g.times || [])[i]);
      if (!mm) return;
      L.push('BEGIN:VEVENT');
      L.push('UID:' + icsUid_(g.key + '|' + d.day + '|' + i));
      L.push('DTSTAMP:' + now);
      L.push('DTSTART:' + icsStamp_(first, mm.a));
      L.push('DTEND:' + icsStamp_(first, mm.b));
      L.push('RRULE:FREQ=WEEKLY;UNTIL=' + untilStamp);
      L.push(icsFold_('SUMMARY:' + icsEsc_(info.subj)));
      if (info.room) L.push(icsFold_('LOCATION:' + icsEsc_(info.room)));
      if (info.who) L.push(icsFold_('DESCRIPTION:' + icsEsc_(info.who)));
      L.push('BEGIN:VALARM');
      L.push('TRIGGER:-PT10M');
      L.push('ACTION:DISPLAY');
      L.push(icsFold_('DESCRIPTION:' + icsEsc_(info.subj)));
      L.push('END:VALARM');
      L.push('END:VEVENT');
    });
  });

  L.push('END:VCALENDAR');
  return L.join('\r\n');
}

// ─────────────────────── УСТАНОВКА ТРИГГЕРА ───────────────────────

/** ЗАПУСТИ ОДИН РАЗ: создаёт почасовую проверку расписания. */
function setupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'checkChanges') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('checkChanges').timeBased().everyHours(1).create();
  checkChanges(); // сразу делаем первый снимок
  Logger.log('Готово: проверка расписания будет запускаться каждый час.');
}
