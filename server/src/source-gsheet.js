// Открытые Google-таблицы (доступ «всем, у кого есть ссылка») — напрямую, без Apps Script.
// Ячейки — gviz CSV (Google Visualization API: те же значения, что видит человек; на таблицах КФУ сверено с htmlview
// ячейка в ячейку), список листов — со страницы htmlview (не удалось — первый лист). Скачивание файла у этих таблиц
// бывает запрещено (export → 401), а gviz работает.
// Разметка — как у таблиц КФУ (apps-script/Code.gs parseSource_): строка-заголовок группы в столбце A
// («1 курс Геология 05.03.01», «2 к. Лингвистика (оч-з.) 20-516»), ссылка на онлайн-занятия — в той же строке;
// под ней строка времени («1-я пара 08:30 - 09:50»); дальше дни «Пн»…«Сб» с парами по столбцам.
// Отличия от parseSource_ (у дополнительных таблиц): столбцы пар — по ширине листа, одни на все группы листа (номер пары
// не «съезжает», если вуз впишет пару в пустой столбец), пустое время в группе — из того же столбца у соседних групп;
// время «18:10 - 19-30» (опечатка) читается как 18:10 – 19:30, заголовок «2 к. …» — тоже группа. На основной таблице
// КФУ результат совпадает с Apps Script до знака (73 группы из 73: ключи, ссылки, время, пары) — поэтому она читается
// так же, а Apps Script остался запасным путём (source.js).

const DAYS = new Map([
  ['пн', 'Пн'], ['пон', 'Пн'], ['понедельник', 'Пн'], ['вт', 'Вт'], ['вторник', 'Вт'], ['ср', 'Ср'], ['среда', 'Ср'],
  ['чт', 'Чт'], ['четверг', 'Чт'], ['пт', 'Пт'], ['пятница', 'Пт'], ['сб', 'Сб'], ['суббота', 'Сб'], ['вс', 'Вс'], ['воскресенье', 'Вс'],
]);
const URL_RE = /https?:\/\/\S+/g;

export const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

/** Заголовок группы: код специальности (05.03.01, не дата) или «1 курс» / «2 к.» в начале; шапка листа — нет. */
export function isGroupHeader(s) {
  s = clean(s);
  if (!s || /^Расписание\s/i.test(s)) return false;
  return /\d{2}\.\d{2}\.\d{2}(?!\d)/.test(s) || /^\d\s*(курс(?![А-Яа-яЁё])|к\.)/i.test(s);
}

/** «Пн» / «понедельник» → «Пн»; не день — ''. */
export function normDay(s) {
  return DAYS.get(String(s || '').replace(/[^А-Яа-яЁё]/g, '').toLowerCase()) || '';
}

/** «1-я пара 08:30 - 09:50» → «08:30 – 09:50»; «18:10 - 19-30» → «18:10 – 19:30»; нет времени — ''. */
export function timeOnly(s) {
  const m = String(s || '').match(/(\d{1,2})[:.](\d{2})\s*[-–—]\s*(\d{1,2})[:.\-–](\d{2})/);
  return m ? `${m[1]}:${m[2]} – ${m[3]}:${m[4]}` : '';
}

/** CSV (RFC 4180: кавычки, "" внутри, переводы строк в ячейках) → строки ячеек. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  const t = String(text || '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/**
 * Лист → { header, groups }. section — раздел в выборе группы (и начало ключа: «section :: название группы»).
 * groups: [{ key, sheet, course, name, sub, link, times[], days:[{day, pairs[]}] }] — как у Apps Script.
 * header — как у Apps Script: строка «Расписание с 07.09.2026 …» в первых пяти строках, иначе ''.
 * o.apps — ровно как Apps Script (основная таблица КФУ): столбцы пар B–G, время не дополняется.
 * o.sub — подраздел (имя листа, если в таблице их несколько).
 */
export function parseGrid(rows, section, o = {}) {
  let header = '';
  for (const r of rows.slice(0, 5)) {
    const line = clean(r.join(' '));
    if (/Расписание\s+с\s+\d/i.test(line)) { header = line; break; }
  }
  const found = [];
  for (let r = 0; r < rows.length; r++) {
    const a = clean(rows[r][0]);
    if (!isGroupHeader(a)) continue;
    const timesRow = rows[r + 1] || [];
    const dayRows = [];
    for (let k = r + 2; k < rows.length && dayRows.length < 7; k++) {
      const first = clean(rows[k][0]);
      if (isGroupHeader(first)) break;
      const day = normDay(first);
      if (day) dayRows.push({ day, row: rows[k] });
    }
    found.push({ name: clean(a.replace(URL_RE, '')), link: (rows[r].join(' ').match(URL_RE) || [''])[0], timesRow, dayRows });
  }
  // Столбцы пар: у Apps Script — B–G; иначе — все столбцы листа после A (одни на все группы листа).
  const width = o.apps ? 7 : Math.max(1, ...rows.map((r) => r.length));
  const cols = [];
  for (let c = 1; c < width; c++) cols.push(c);
  // Время столбца по листу — самое частое непустое (группе без своего времени в этом столбце — оно).
  const colTime = cols.map((c) => {
    const n = new Map();
    for (const f of found) { const t = timeOnly(f.timesRow[c]); if (t) n.set(t, (n.get(t) || 0) + 1); }
    let best = '';
    for (const [t, k] of n) if (!best || k > n.get(best)) best = t;
    return best;
  });
  const groups = found.map((f) => {
    // Курс — как у Apps Script: только «N курс» (у «2 к. …» — пусто), чтобы оба пути давали одно и то же до знака.
    const g = { key: section + ' :: ' + f.name, sheet: section, course: (f.name.match(/^\s*(\d)\s*курс/i) || [null, ''])[1], name: f.name };
    // Режим Apps Script — ровно его поля и их порядок (key, sheet, course, name, link, times, days): иначе у снимка
    // другой отпечаток и при каждом переключении источника пишется новый.
    if (!o.apps) g.sub = o.sub || '';
    g.link = f.link;
    g.times = cols.map((c, i) => timeOnly(f.timesRow[c]) || (o.apps ? '' : colTime[i]));
    g.days = f.dayRows.map((d) => ({ day: d.day, pairs: cols.map((c) => clean(d.row[c])) }));
    return g;
  });
  return { header, groups };
}

const sheetUrl = (id) => 'https://docs.google.com/spreadsheets/d/' + encodeURIComponent(id);

async function getText(url, what) {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30000), headers: { 'accept-language': 'ru' } });
  if (!res.ok) throw new Error(what + ': ответ ' + res.status);
  return res.text();
}

/** CSV листа. Ошибка gviz приходит с кодом 200 и JSON, закрытый доступ — страницей входа: это сбой, а не пустой лист. */
async function getCsv(url, what) {
  const body = await getText(url, what);
  if (/^\s*[{<]/.test(body) || /"status"\s*:\s*"error"/.test(body.slice(0, 400))) throw new Error(what + ': не CSV — ' + body.slice(0, 80));
  return body;
}

const tabsCache = new Map();   // id → { until, tabs }
const TABS_TTL = 60 * 60_000;   // список листов — раз в час
const TABS_RETRY = 5 * 60_000;  // не прочитался — старый список (или первый лист) ещё 5 минут, потом снова

/** Строка JS из htmlview («\x26», «\u0026», «\/») → текст. */
const unjs = (s) => s.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|.)/g, (_, e) =>
  (e[0] === 'x' || e[0] === 'u') && e.length > 1 ? String.fromCharCode(parseInt(e.slice(1), 16)) : e);

/**
 * Листы таблицы: { tabs: [{ name, gid }], fresh } со страницы htmlview; не нашли — прежний список или первый лист (gid 0).
 * fresh — список прочитан только что (а не из памяти).
 */
async function tabsOf(id) {
  const hit = tabsCache.get(id);
  if (hit && Date.now() < hit.until) return { tabs: hit.tabs, fresh: false };
  const tabs = [];
  try {
    const html = await getText(sheetUrl(id) + '/htmlview', 'список листов');
    const seen = new Set();
    for (const m of html.matchAll(/\{name: "((?:[^"\\]|\\.)*)", pageUrl: "[^"]*", gid: "(\d+)"/g)) {
      if (seen.has(m[2])) continue;
      seen.add(m[2]);
      tabs.push({ name: clean(unjs(m[1])), gid: m[2] });
    }
  } catch { /* ниже — прежний список */ }
  if (tabs.length) {
    tabsCache.set(id, { until: Date.now() + TABS_TTL, tabs });
    return { tabs, fresh: true };
  }
  const old = hit ? hit.tabs : [{ name: '', gid: '0' }];
  tabsCache.set(id, { until: Date.now() + TABS_RETRY, tabs: old });
  return { tabs: old, fresh: false };
}

const groupsSeen = new Map();   // 'id:gid' → сколько групп было на листе в прошлый раз

/**
 * Открытая таблица cfg = { id, section } → { header, groups }. Раздел и начало ключа группы — section, сколько бы листов
 * ни было (второй лист не меняет ключи: у студентов не слетает выбранная группа); имя листа при нескольких листах —
 * подраздел (sub). section = null — раздел = имя листа, разбор как у Apps Script (основная таблица КФУ).
 * Лист без групп пропускается; ни одной группы во всей таблице или любой лист не прочитался — ошибка.
 * Лист, которого больше нет, gviz отдаёт первым листом — такой повтор пропускаем и перечитываем список листов.
 */
export async function fetchGsheet(cfg) {
  const { tabs, fresh } = await tabsOf(cfg.id);
  if (!cfg.section && tabs.some((tab) => !tab.name)) throw new Error('не удалось узнать листы таблицы ' + cfg.id);
  let header = '';
  const groups = [];
  const seenCsv = new Set();
  const counts = [];
  for (const tab of tabs) {
    const csv = await getCsv(`${sheetUrl(cfg.id)}/gviz/tq?tqx=out:csv&headers=0&gid=${tab.gid}`, 'лист ' + (tab.name || tab.gid));
    if (seenCsv.has(csv)) {
      // Тот же лист второй раз: список листов из памяти устарел (лист удалили — gviz отдал первый) — это сбой, список
      // перечитаем в следующий раз; только что прочитанный список — значит, в таблице правда два одинаковых листа.
      if (!fresh) { tabsCache.delete(cfg.id); throw new Error('список листов таблицы ' + cfg.id + ' устарел'); }
      continue;
    }
    seenCsv.add(csv);
    const r = cfg.section
      ? parseGrid(parseCsv(csv), cfg.section, { sub: tabs.length > 1 ? tab.name : '' })
      : parseGrid(parseCsv(csv), tab.name, { apps: true });
    // На листе были группы, а теперь ни одной — скорее сбой Google, чем пустой лист: не верим (прошлые группы останутся).
    const k = cfg.id + ':' + tab.gid;
    if (!r.groups.length && (groupsSeen.get(k) || 0) > 0) throw new Error('лист ' + (tab.name || tab.gid) + ' вдруг без групп');
    counts.push([k, r.groups.length]);
    if (!header) header = r.header;
    groups.push(...r.groups);
  }
  if (!groups.length) throw new Error('в таблице ' + cfg.id + ' не нашлось ни одной группы');
  for (const [k, n] of counts) groupsSeen.set(k, n);
  return { header, groups };
}
