// Аналитика заходов.
//
// Собираем то, что и так видит любой веб-сервер (IP, User-Agent, referrer), плюс
// то, что присылает страница (группа, экран, язык, метка источника). НО:
//   • сырой IP не храним — только соль+хеш (для дедупликации); огрублённый вид
//     (ip_coarse) больше не пишем, а старые значения стираем при запуске (scrubCoarseIp);
//   • ничего личного (имя, почта, телефон, точные координаты) не собираем;
//   • всё это раскрыто в политике приложения.
// То есть данные обезличенные и не для того, чтобы вычислять конкретного человека.
// Функции, пишущие и читающие заходы, берут t — вуз: у каждого своя база и свои кеши.
import { createHash } from 'node:crypto';
import { config } from './config.js';

// ─── Разбор User-Agent: устройство, модель, ОС, браузер ───
export function parseUa(ua) {
  ua = String(ua || '');
  const out = { device: 'Другое', model: '', os: '', browser: '' };

  // Устройство и ОС.
  if (/iPhone/.test(ua)) { out.device = 'iPhone'; out.model = 'iPhone'; }
  else if (/iPad/.test(ua)) { out.device = 'iPad'; out.model = 'iPad'; }
  else if (/Android/.test(ua)) {
    out.device = 'Android';
    // Модель Android обычно есть в UA: «Android 13; SM-G991B Build/…» или «… Redmi Note 12)».
    const m = ua.match(/Android[^;]*;\s*([^;)]+?)(?:\s+Build\/|[;)])/);
    if (m) out.model = m[1].replace(/\s+/g, ' ').trim();
  }
  else if (/Macintosh|Mac OS X/.test(ua)) { out.device = 'Mac'; out.model = 'Mac'; }
  else if (/Windows/.test(ua)) { out.device = 'Windows'; out.model = 'PC'; }
  else if (/Linux/.test(ua)) { out.device = 'Linux'; out.model = 'PC'; }

  const iOS = ua.match(/OS (\d+)[._](\d+)/);
  if (/iPhone|iPad/.test(ua) && iOS) out.os = 'iOS ' + iOS[1] + '.' + iOS[2];
  else if (/Android (\d+(?:\.\d+)?)/.test(ua)) out.os = 'Android ' + RegExp.$1;
  else if (/Windows NT 10/.test(ua)) out.os = 'Windows 10/11';
  else if (/Mac OS X (\d+)[._](\d+)/.test(ua)) out.os = 'macOS ' + RegExp.$1 + '.' + RegExp.$2;
  else if (/Windows/.test(ua)) out.os = 'Windows';
  else if (/Linux/.test(ua)) out.os = 'Linux';

  // Браузер — порядок важен: специфичные раньше общих.
  let b = ua.match(/(Edg|EdgA)\/(\d+)/);   if (b) out.browser = 'Edge ' + b[2];
  if (!out.browser && (b = ua.match(/OPR\/(\d+)/))) out.browser = 'Opera ' + b[1];
  if (!out.browser && (b = ua.match(/SamsungBrowser\/(\d+)/))) out.browser = 'Samsung ' + b[1];
  if (!out.browser && (b = ua.match(/YaBrowser\/(\d+)/))) out.browser = 'Yandex ' + b[1];
  if (!out.browser && (b = ua.match(/Firefox\/(\d+)/))) out.browser = 'Firefox ' + b[1];
  if (!out.browser && (b = ua.match(/Chrome\/(\d+)/))) out.browser = 'Chrome ' + b[1];
  if (!out.browser && (b = ua.match(/Version\/(\d+).*Safari/))) out.browser = 'Safari ' + b[1];
  if (!out.browser && /Safari/.test(ua)) out.browser = 'Safari';

  return out;
}

// ─── IP: псевдоним + огрублённый вид, сырой не сохраняем ───
export function ipParts(ip) {
  ip = String(ip || '').trim();
  // За nginx приходит X-Forwarded-For: «client, proxy» — берём первый.
  if (ip.includes(',')) ip = ip.split(',')[0].trim();
  if (ip.startsWith('::ffff:')) ip = ip.slice(7); // IPv4 в маске IPv6

  const hash = ip ? createHash('sha256').update(config.ipSalt + '|' + ip).digest('hex').slice(0, 16) : '';

  let coarse = '';
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
    coarse = ip.replace(/\.\d+$/, '.0');            // IPv4 → /24
  } else if (ip.includes(':')) {
    coarse = ip.split(':').slice(0, 3).join(':') + '::'; // IPv6 → /48
  }
  return { hash, coarse };
}

// ─── Человекочитаемый источник по метке/referrer ───
export function sourceName(from, ref) {
  const f = String(from || '').toLowerCase();
  const map = { tg: 'Telegram', ig: 'Instagram', gh: 'GitHub', site: 'сайт', qr: 'QR-код', chat: 'Чат группы', ref: 'Позвал друг' };
  if (f && map[f]) return map[f];
  if (f) return f;
  const r = String(ref || '').toLowerCase();
  if (!r) return 'Прямой заход';
  // Старая ссылка на Apps Script: страница-переход живёт на googleusercontent.com.
  if (r.includes('googleusercontent.com') || r.includes('script.google.com')) return 'Старая ссылка Google';
  if (r.includes('t.me') || r.includes('telegram')) return 'Telegram';
  if (r.includes('instagram')) return 'Instagram';
  if (r.includes('google.')) return 'Поиск Google';
  if (r.includes('youtube')) return 'YouTube';
  try { return new URL(r).host || 'Другое'; } catch { return 'Другое'; }
}

/** Записать заход. `info` = { ip, ua, cid, first, from, ref, grp, scr, lang }. */
export function logHit(t, info) {
  const ua = parseUa(info.ua);
  // Sec-CH-UA-Model — настоящая модель Android, если браузер её прислал
  // (см. Accept-CH в index.html); обычный UA с 2024 года её больше не выдаёт.
  // Значение приходит как Structured Field String — в кавычках: "Pixel 8".
  // На десктопе браузер шлёт пустую строку в кавычках же: "" — это НЕ модель.
  const chModel = String(info.chModel || '').trim().replace(/^"|"$/g, '');
  if (chModel) ua.model = chModel;
  const ip = ipParts(info.ip);
  t.db.prepare(`
    INSERT INTO hits
      (ts, cid, is_first, ip_hash, ip_coarse, country, city,
       device, model, os, browser, ref, source, grp, screen, lang)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    new Date().toISOString(),
    String(info.cid || '').slice(0, 32),
    info.first ? 1 : 0,
    ip.hash, null,                                // ip_coarse больше не храним (см. scrubCoarseIp)
    null, null,                                   // country/city — грубая гео добавится позже
    ua.device, ua.model, ua.os, ua.browser,
    String(info.ref || '').slice(0, 300),
    sourceName(info.from, info.ref),
    String(info.grp || '').slice(0, 160),
    String(info.scr || '').slice(0, 20),
    String(info.lang || '').slice(0, 16),
  );
}

/**
 * Стереть огрублённые IP, записанные раньше. Идемпотентно; когда стирать нечего — один
 * быстрый UPDATE без изменений. Вызывается при запуске для базы каждого вуза.
 */
export function scrubCoarseIp(db) {
  db.prepare('UPDATE hits SET ip_coarse = NULL WHERE ip_coarse IS NOT NULL').run();
}

// ─── Последние дни подряд по Ташкенту ───
// Дни без заходов отдаём нулями: иначе график склеивает пропуски
// и рисует ровную линию там, где была тишина.
function lastDays(n) {
  const base = Date.now() + 5 * 3600 * 1000;
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(new Date(base - i * 86400000).toISOString().slice(0, 10));
  return out;
}

function trendDays(db, n) {
  const days = lastDays(n);
  const rows = db.prepare(`
    SELECT substr(datetime(ts,'+5 hours'),1,10) day,
           COUNT(*) hits,
           COUNT(DISTINCT CASE WHEN cid <> '' THEN cid END) users,
           COUNT(DISTINCT CASE WHEN cid <> '' AND is_first = 1 THEN cid END) newUsers
    FROM hits WHERE datetime(ts,'+5 hours') >= ?
    GROUP BY day
  `).all(days[0]);
  const byDay = new Map(rows.map((r) => [r.day, r]));
  // По возрастанию даты, подпись по-русски — ДД.ММ.
  return days.map((d) => {
    const r = byDay.get(d);
    return {
      date: d.slice(8, 10) + '.' + d.slice(5, 7),
      hits: r ? r.hits : 0,
      users: r ? r.users : 0,
      newUsers: r ? r.newUsers : 0,
    };
  });
}

// ─── Короткая сводка для блока на главном экране ───
// Её запрашивает каждый, кто открыл приложение, поэтому минуту держим в памяти,
// а не пересчитываем журнал на каждый заход.
export function summary(t) {
  const cached = t.cache.summary;
  if (cached && Date.now() - cached.at < 60 * 1000) return cached.data;
  const one = (sql, ...a) => t.db.prepare(sql).get(...a);
  const today = lastDays(1)[0];
  const data = {
    todayUsers: one("SELECT COUNT(DISTINCT cid) n FROM hits WHERE cid <> '' AND substr(datetime(ts,'+5 hours'),1,10)=?", today).n,
    todayNew: one("SELECT COUNT(DISTINCT cid) n FROM hits WHERE cid <> '' AND is_first=1 AND substr(datetime(ts,'+5 hours'),1,10)=?", today).n,
    uniquePeople: one("SELECT COUNT(DISTINCT cid) n FROM hits WHERE cid <> ''").n,
    trend: trendDays(t.db, 14),
  };
  t.cache.summary = { at: Date.now(), data };
  return data;
}

// ─── «Пульс» вуза для списка вузов ───
// Его просят сразу для всех вузов, поэтому только два дешёвых запроса и кеш на 5 минут.
export function pulse(t, days = 7) {
  const cached = t.cache.pulse;
  if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.data;
  const trend = trendDays(t.db, days);
  const data = {
    people: t.db.prepare("SELECT COUNT(DISTINCT cid) n FROM hits WHERE cid <> ''").get().n,
    today: trend.length ? trend[trend.length - 1].users : 0,
    spark: trend.map((d) => d.users),
  };
  t.cache.pulse = { at: Date.now(), data };
  return data;
}

// ─── Подробная статистика для модала ───
// Только сводные числа: «сколько людей», ни одной строки про конкретного человека.
// Списки считают людей (разные cid), а не заходы: студент, открывший расписание
// двадцать раз, не должен делать свой телефон «самым популярным».

const OTHER = 'Другие';

// Первые n позиций по убыванию + хвост одной строкой «Другие».
function rank(counts, n = 6) {
  let rest = counts.get(OTHER) || 0;
  let rows = [...counts.entries()]
    .filter(([name]) => name && name !== OTHER)
    .map(([name, c]) => ({ name, n: c }))
    .sort((a, b) => b.n - a.n);
  if (rows.length > n + 1) {
    rest += rows.slice(n).reduce((s, r) => s + r.n, 0);
    rows = rows.slice(0, n);
  }
  return rest ? [...rows, { name: OTHER, n: rest }] : rows;
}

function tally(people, pick, n) {
  const counts = new Map();
  for (const p of people) {
    const k = pick(p);
    if (k) counts.set(k, (counts.get(k) || 0) + 1);
  }
  return rank(counts, n);
}

function deviceKind(d) {
  if (d === 'iPhone' || d === 'iPad' || d === 'Android') return d;
  if (d === 'Windows' || d === 'Mac' || d === 'Linux') return 'Компьютер';
  return OTHER;
}

// Android присылает модель кодом (SM-A175F, 2404ARN45A) — марку узнаём по известным
// префиксам. Что не узнали — «Другие», а не угадываем.
function brandOf(device, model) {
  if (device === 'iPhone' || device === 'iPad') return 'Apple';
  if (device !== 'Android') return '';
  const m = String(model || '');
  if (!m) return '';
  if (/^(SM-|Galaxy)/i.test(m)) return 'Samsung';
  if (/^Pixel/i.test(m)) return 'Google Pixel';
  if (/^(Redmi|POCO|Mi\s|M\d{4}[A-Z]\d|\d{4,5}[A-Z0-9]{4,6}$)/i.test(m)) return 'Xiaomi';
  if (/^TECNO/i.test(m)) return 'Tecno';
  if (/^Infinix/i.test(m)) return 'Infinix';
  if (/^(V\d{4}|vivo)/i.test(m)) return 'vivo';
  if (/^(CPH|OPPO)/i.test(m)) return 'OPPO';
  if (/^(RMX|realme)/i.test(m)) return 'realme';
  if (/^(moto|motorola)/i.test(m)) return 'Motorola';
  if (/^HUAWEI/i.test(m)) return 'Huawei';
  if (/^HONOR/i.test(m)) return 'Honor';
  return OTHER;
}

function modelLabel(device, model) {
  if (device === 'iPhone' || device === 'iPad') return device; // Apple модель не сообщает
  if (device !== 'Android') return '';
  const m = String(model || '');
  if (!m) return '';
  const b = brandOf(device, m);
  const known = b && b !== OTHER;
  return known && !m.toLowerCase().includes(b.split(' ').pop().toLowerCase()) ? `${b} ${m}` : m;
}

function sourceLabel(s) {
  const v = String(s || '');
  if (v.includes('googleusercontent.com') || v.includes('script.google.com')) return 'Старая ссылка Google';
  return v;
}

const browserLabel = (b) => {
  const v = String(b || '').replace(/\s*\d+$/, '');
  return v === 'Samsung' ? 'Samsung Internet' : v;
};

const osLabel = (os) => String(os || '').replace(/^(iOS \d+)\.\d+$/, '$1').replace(/^macOS.*/, 'macOS');

const LANGS = { ru: 'Русский', uz: 'Узбекский', en: 'Английский', kk: 'Казахский', tg: 'Таджикский', ky: 'Киргизский', tr: 'Турецкий' };
const langLabel = (l) => {
  const code = String(l || '').slice(0, 2).toLowerCase();
  return code ? LANGS[code] || code.toUpperCase() : '';
};

// «1 курс Геология 05.03.01» → «Геология · 1 курс».
function groupLabel(g) {
  const m = String(g || '').match(/^\s*(\d)\s*курс\s+(.*?)\s*(\d{2}\.\d{2}\.\d{2})?\s*$/i);
  return m ? `${m[2]} · ${m[1]} курс` : String(g || '');
}

// До этого момента первый заход записывался с первой группой списка — ещё до
// того, как человек выбрал свою. Такие записи в «Группах» не учитываем.
const GROUP_FIX_TS = '2026-09-11T11:10:00Z';

export function aggregate(t) {
  const cached = t.cache.stats;
  if (cached && Date.now() - cached.at < 60 * 1000) return cached.data;
  const q = (sql, ...a) => t.db.prepare(sql).all(...a);
  const one = (sql, ...a) => t.db.prepare(sql).get(...a);
  const DAY = "substr(datetime(ts,'+5 hours'),1,10)";
  const today = lastDays(1)[0];

  const total = one('SELECT COUNT(*) n FROM hits').n;
  const uniquePeople = one("SELECT COUNT(DISTINCT cid) n FROM hits WHERE cid <> ''").n;
  const todayHits = one(`SELECT COUNT(*) n FROM hits WHERE ${DAY} = ?`, today).n;
  const todayUsers = one(`SELECT COUNT(DISTINCT cid) n FROM hits WHERE cid <> '' AND ${DAY} = ?`, today).n;
  const todayNew = one(`SELECT COUNT(DISTINCT cid) n FROM hits WHERE cid <> '' AND is_first = 1 AND ${DAY} = ?`, today).n;
  // Вернулись — заходили хотя бы в два разных дня.
  const returning = one(`SELECT COUNT(*) n FROM (
    SELECT cid FROM hits WHERE cid <> '' GROUP BY cid HAVING COUNT(DISTINCT ${DAY}) > 1)`).n;

  // Заходы по часам суток (Ташкент): все 24 часа, пустые — нулями.
  const hourRows = new Map(q(`
    SELECT CAST(substr(datetime(ts,'+5 hours'),12,2) AS INTEGER) h, COUNT(*) n FROM hits GROUP BY h
  `).map((r) => [r.h, r.n]));
  const byHour = Array.from({ length: 24 }, (_, h) => ({ h, n: hourRows.get(h) || 0 }));

  // Один человек — одна строка. Устройство и источник — с первого захода (откуда
  // пришёл впервые), модель — последняя настоящая (не заглушка "K"), группа — текущая.
  const people = q(`
    SELECT f.device, f.os, f.browser, f.source, f.lang,
      (SELECT m.model FROM hits m WHERE m.cid = p.cid AND m.model NOT IN ('', 'K')
        ORDER BY m.rowid DESC LIMIT 1) model,
      (SELECT g.grp FROM hits g WHERE g.cid = p.cid AND g.grp <> ''
        AND (g.is_first = 0 OR g.ts >= ?) ORDER BY g.rowid DESC LIMIT 1) grp
    FROM (SELECT cid, MIN(rowid) fid FROM hits WHERE cid <> '' GROUP BY cid) p
    JOIN hits f ON f.rowid = p.fid
  `, GROUP_FIX_TS);

  const data = {
    updated: new Date().toISOString(),
    total, uniquePeople, todayHits, todayUsers, todayNew, returning,
    trend: trendDays(t.db, 14),
    byHour,
    bySource: tally(people, (p) => sourceLabel(p.source)),
    byDevice: tally(people, (p) => deviceKind(p.device)),
    byBrand: tally(people, (p) => brandOf(p.device, p.model)),
    byModel: tally(people, (p) => modelLabel(p.device, p.model), 8),
    byGroup: tally(people, (p) => groupLabel(p.grp), 8),
    byBrowser: tally(people, (p) => browserLabel(p.browser)),
    byOs: tally(people, (p) => osLabel(p.os)),
    byLang: tally(people, (p) => langLabel(p.lang), 4),
  };
  t.cache.stats = { at: Date.now(), data };
  return data;
}

// ─── Что видят все, а что — только модератор ───
// Всем — общая картина: сколько людей, когда открывают, откуда приходят, какие группы.
// Устройства, марки и модели телефонов, браузеры, системы и язык — только модератору (fullStats).
// Скрытые списки — пустые массивы, а не отсутствующие поля: старая сборка приложения
// (лежит в кеше у людей) просто не нарисует пустой список, а не упадёт.
const PRIVATE = ['byDevice', 'byBrand', 'byModel', 'byBrowser', 'byOs', 'byLang'];

export function publicStats(t) {
  const data = { ...aggregate(t) };
  for (const k of PRIVATE) data[k] = [];
  return data;
}

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

/** Расширенная статистика для модератора: всё из aggregate и сверх того (для круговых и паутинных графиков). */
export function fullStats(t) {
  const cached = t.cache.fullStats;
  if (cached && Date.now() - cached.at < 60 * 1000) return cached.data;
  const q = (sql, ...a) => t.db.prepare(sql).all(...a);
  const LOCAL = "datetime(ts,'+5 hours')";

  // По дням недели (Ташкент): strftime %w — 0 воскресенье, переводим в Пн..Вс.
  const wdRows = new Map(q(`SELECT CAST(strftime('%w', ${LOCAL}) AS INTEGER) d, COUNT(*) n,
    COUNT(DISTINCT CASE WHEN cid <> '' THEN cid END) u FROM hits GROUP BY d`).map((r) => [r.d, r]));
  const byWeekday = WEEKDAYS.map((name, i) => {
    const r = wdRows.get((i + 1) % 7);
    return { name, n: r ? r.n : 0, users: r ? r.u : 0 };
  });

  // Сколько разных дней человек открывал приложение — верность.
  const BUCKETS = [['1 день', 1, 1], ['2–3 дня', 2, 3], ['4–7 дней', 4, 7], ['8–14 дней', 8, 14], ['15–30 дней', 15, 30], ['больше 30', 31, 1e9]];
  const daysPer = q(`SELECT COUNT(DISTINCT substr(${LOCAL},1,10)) d FROM hits WHERE cid <> '' GROUP BY cid`);
  const byLoyalty = BUCKETS.map(([name, lo, hi]) => ({ name, n: daysPer.filter((r) => r.d >= lo && r.d <= hi).length }));

  // Размер экрана — по ширине в CSS-пикселях (screen = «390x844»).
  const widths = q("SELECT screen FROM hits WHERE screen <> '' AND cid <> '' GROUP BY cid");
  const SIZES = [['до 360', 0, 360], ['361–400', 361, 400], ['401–480', 401, 480], ['планшет', 481, 1024], ['компьютер', 1025, 1e9]];
  const byScreen = SIZES.map(([name, lo, hi]) => ({
    name,
    n: widths.filter((r) => { const w = parseInt(String(r.screen), 10); return w >= lo && w <= hi; }).length,
  })).filter((r) => r.n);

  const base = aggregate(t);
  const data = { ...base, trend30: trendDays(t.db, 30), byWeekday, byLoyalty, byScreen };
  t.cache.fullStats = { at: Date.now(), data };
  return data;
}

// ─── Полная аналитика для страницы /analytics (только модератор, social/stats.js) ───
// Главный вопрос — какие группы ещё не пользуются Para. Список групп берём из расписания вуза,
// человека относим к его текущей группе (последняя выбранная), активность группы — заходы её людей.
// Списки здесь полные, без хвоста «Другие»: на большом экране модератор листает всё.

const DAY_MS = 86400000;
const localDay = (ms) => new Date(ms + 5 * 3600e3).toISOString().slice(0, 10);

function fullTally(people, pick) {
  const counts = new Map();
  for (const p of people) {
    const k = pick(p);
    if (k) counts.set(k, (counts.get(k) || 0) + 1);
  }
  return [...counts.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n);
}

// Курс — из поля course, иначе цифра из названия листа или группы («5 очное», «1 курс Геология»).
export function courseLabel(g) {
  if (g.course) return g.course + ' курс';
  const m = String(g.sheet || '').match(/^\s*(\d)\b/) || String(g.name || '').match(/^\s*(\d)\s*(курс|к\.)/i);
  return m ? m[1] + ' курс' : String(g.sheet || 'Без курса');
}
// Факультет — поле sub; у вузов без него — лист без курса («очное», «очно-заочное»).
export function facultyLabel(g) {
  if (g.sub) return String(g.sub);
  const rest = String(g.sheet || '').replace(/^\s*\d\s*(курс)?\s*/i, '').trim();
  return rest || String(g.sheet || '');
}

/**
 * schedule — снимок расписания (getLatestSchedule): нужны groups[{ name, course, sheet, sub }].
 * Без снимка групп из расписания нет — тогда считаем только по заходам.
 */
export function deepAnalytics(t, schedule) {
  const cached = t.cache.deep;
  if (cached && Date.now() - cached.at < 2 * 60 * 1000) return cached.data;

  const now = Date.now();
  const today = localDay(now);
  const d7 = localDay(now - 6 * DAY_MS), d14 = localDay(now - 13 * DAY_MS), d30 = localDay(now - 29 * DAY_MS);

  // Все заходы с номером браузера — один проход.
  const hits = t.db.prepare("SELECT cid, grp, is_first, ts FROM hits WHERE cid <> '' ORDER BY id").all();
  const person = new Map();   // cid → { grp, first, last, days:Set, hits30 }
  const dayHour = Array.from({ length: 7 }, () => new Array(24).fill(0));
  for (const h of hits) {
    const ms = Date.parse(h.ts);
    const day = localDay(ms);
    let p = person.get(h.cid);
    if (!p) { p = { grp: '', first: day, last: day, days: new Set(), hits30: 0 }; person.set(h.cid, p); }
    p.last = day;
    p.days.add(day);
    if (day >= d30) p.hits30++;
    // Первый заход до исправления записывался с чужой группой (см. GROUP_FIX_TS) — его группу не берём.
    if (h.grp && (!h.is_first || h.ts >= GROUP_FIX_TS)) p.grp = h.grp;
    const local = new Date(ms + 5 * 3600e3);
    dayHour[(local.getUTCDay() + 6) % 7][local.getUTCHours()]++;
  }

  const groups = ((schedule && schedule.groups) || []).filter((g) => g && g.name);
  const byName = new Map();
  for (const g of groups) {
    if (byName.has(g.name)) continue;
    byName.set(g.name, {
      name: g.name, course: courseLabel(g), faculty: facultyLabel(g),
      people: 0, new7: 0, active7: 0, activeToday: 0, regular: 0, hits30: 0, days14: new Set(), lastSeen: '',
      inSchedule: true,
    });
  }
  for (const p of person.values()) {
    if (!p.grp) continue;
    let g = byName.get(p.grp);
    if (!g) {
      // Группа, которой больше нет в расписании (переименовали, выпустилась) — отдельно.
      g = { name: p.grp, course: '', faculty: '', people: 0, new7: 0, active7: 0, activeToday: 0, regular: 0,
        hits30: 0, days14: new Set(), lastSeen: '', inSchedule: false };
      byName.set(p.grp, g);
    }
    g.people++;
    if (p.first >= d7) g.new7++;
    if (p.last >= d7) g.active7++;
    if (p.last === today) g.activeToday++;
    let recent = 0;
    for (const d of p.days) if (d >= d14) { recent++; g.days14.add(d); }
    if (recent >= 3) g.regular++;
    g.hits30 += p.hits30;
    if (p.last > g.lastSeen) g.lastSeen = p.last;
  }

  const status = (g) => {
    if (!g.people) return 'none';
    if (!g.active7) return 'lost';
    if (g.days14.size >= 8 && g.regular >= 2) return 'steady';
    if (g.regular >= 1 || g.days14.size >= 4) return 'some';
    return 'weak';
  };
  const list = [...byName.values()].map((g) => ({
    name: g.name, course: g.course, faculty: g.faculty, inSchedule: g.inSchedule,
    people: g.people, new7: g.new7, active7: g.active7, activeToday: g.activeToday, regular: g.regular,
    days14: g.days14.size, hits30: g.hits30, lastSeen: g.lastSeen, status: status(g),
  }));

  // Сводка по курсам и факультетам: сколько групп из расписания уже пользуются.
  const rollup = (key) => {
    const m = new Map();
    for (const g of list) {
      if (!g.inSchedule) continue;
      const k = g[key] || '—';
      let r = m.get(k);
      if (!r) { r = { name: k, groups: 0, using: 0, steady: 0, none: 0, lost: 0, people: 0, active7: 0, regular: 0 }; m.set(k, r); }
      r.groups++;
      if (g.people) r.using++;
      if (g.status === 'steady') r.steady++;
      if (g.status === 'none') r.none++;
      if (g.status === 'lost') r.lost++;
      r.people += g.people; r.active7 += g.active7; r.regular += g.regular;
    }
    return [...m.values()];
  };
  const byCourse = rollup('course').sort((a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true }));
  const byFaculty = rollup('faculty').sort((a, b) => b.groups - a.groups);

  // Люди по дням за 60 дней: активные и новые.
  const days60 = [];
  for (let i = 59; i >= 0; i--) days60.push(localDay(now - i * DAY_MS));
  const dayIdx = new Map(days60.map((d, i) => [d, i]));
  const users = new Array(60).fill(0), fresh = new Array(60).fill(0);
  for (const p of person.values()) {
    for (const d of p.days) { const i = dayIdx.get(d); if (i !== undefined) users[i]++; }
    const fi = dayIdx.get(p.first); if (fi !== undefined) fresh[fi]++;
  }

  // Техника и источники — полные списки (как в aggregate, но без «Другие»).
  const people = t.db.prepare(`
    SELECT f.device, f.os, f.browser, f.source, f.lang,
      (SELECT m.model FROM hits m WHERE m.cid = p.cid AND m.model NOT IN ('', 'K') ORDER BY m.rowid DESC LIMIT 1) model
    FROM (SELECT cid, MIN(rowid) fid FROM hits WHERE cid <> '' GROUP BY cid) p
    JOIN hits f ON f.rowid = p.fid`).all();

  const sched = list.filter((g) => g.inSchedule);
  const data = {
    updated: new Date().toISOString(),
    totals: {
      people: person.size,
      active7: [...person.values()].filter((p) => p.last >= d7).length,
      activeToday: [...person.values()].filter((p) => p.last === today).length,
      regular: [...person.values()].filter((p) => [...p.days].filter((d) => d >= d14).length >= 3).length,
      groups: sched.length,
      groupsUsing: sched.filter((g) => g.people).length,
      groupsSteady: sched.filter((g) => g.status === 'steady').length,
      groupsNone: sched.filter((g) => g.status === 'none').length,
      groupsLost: sched.filter((g) => g.status === 'lost').length,
      unassigned: [...person.values()].filter((p) => !p.grp).length,
    },
    daily: days60.map((d, i) => ({ date: d, users: users[i], fresh: fresh[i] })),
    dayHour,
    byCourse, byFaculty,
    groups: list.sort((a, b) => b.people - a.people || a.name.localeCompare(b.name, 'ru', { numeric: true })),
    tech: {
      device: fullTally(people, (p) => deviceKind(p.device)),
      brand: fullTally(people, (p) => brandOf(p.device, p.model)),
      model: fullTally(people, (p) => modelLabel(p.device, p.model)),
      os: fullTally(people, (p) => osLabel(p.os)),
      browser: fullTally(people, (p) => browserLabel(p.browser)),
      lang: fullTally(people, (p) => langLabel(p.lang)),
      source: fullTally(people, (p) => sourceLabel(p.source)),
    },
  };
  t.cache.deep = { at: Date.now(), data };
  return data;
}
