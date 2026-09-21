// Аналитика заходов.
//
// Собираем то, что и так видит любой веб-сервер (IP, User-Agent, referrer), плюс
// то, что присылает страница (группа, экран, язык, метка источника). НО:
//   • сырой IP не храним — только соль+хеш (для дедупликации) и огрублённый вид
//     (последний октет обнулён) для грубой географии;
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
  const map = { tg: 'Telegram', ig: 'Instagram', gh: 'GitHub', site: 'сайт', qr: 'QR-код', chat: 'Чат группы' };
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
    ip.hash, ip.coarse,
    null, null,                                   // country/city — грубая гео добавится позже
    ua.device, ua.model, ua.os, ua.browser,
    String(info.ref || '').slice(0, 300),
    sourceName(info.from, info.ref),
    String(info.grp || '').slice(0, 160),
    String(info.scr || '').slice(0, 20),
    String(info.lang || '').slice(0, 16),
  );
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
