// Источник расписания вуза — задаётся в tenant.json:
//
//   "source": { "type": "sheets", "url": "…/exec" }  — Google-таблица через публичный
//     эндпоинт Apps Script (таблица КФУ приватная: читать её напрямую сервер не может,
//     а скрипт работает под аккаунтом владельца таблицы);
//   "source": { "type": "edupage", "host": "tsue.edupage.org" } — см. source-edupage.js.
//   У "sheets" может быть "id" — та же таблица открыта по ссылке: сервер читает её сам (source-gsheet.js; разделы —
//     имена листов, ключи групп — как у Apps Script), а Apps Script — запасной путь, если прямое чтение не вышло.
//     У КФУ Apps Script часто отвечает 404 или не укладывается в 30 с; прямое чтение — 1–2 с.
//   И "extra": [{ "id": "<id Google-таблицы>", "section": "Магистратура" }] — ещё открытые
//     таблицы (доступ по ссылке), которые сервер читает сам (source-gsheet.js); их группы идут после групп основной
//     таблицы, раздел в выборе группы — section.
//
// Остальная система от источника не зависит: оба отдают одну и ту же форму.
import { fetchEdupage } from './source-edupage.js';
import { fetchGsheet } from './source-gsheet.js';
import { getLatestSchedule } from './store.js';
import { metaGet, metaSet } from './db.js';

/**
 * Нормализованное расписание вуза: { header, fetchedAt, groups, weeks?, weekMap? }.
 * groups: [{ key, sheet, course, name, sub?, link, times[], days:[{day, pairs[]}] | weekDays:[[…],[…]] }]
 */
export async function fetchSchedule(t, log) {
  if (t.source.type === 'edupage') return fetchEdupage(t.source.host, {
    includeUnscheduledGroups: t.source.includeUnscheduledGroups === true,
  });
  const main = await fetchMain(t, log);
  const extra = t.source.extra || [];
  if (!extra.length) return main;
  const groups = [...main.groups];
  const keys = new Set(groups.map((g) => g.key));
  for (const cfg of extra) {
    for (const g of await extraGroups(t, cfg, log)) {
      if (keys.has(g.key)) { if (log) log.warn({ key: g.key }, 'дополнительная таблица: группа с таким ключом уже есть'); continue; }
      keys.add(g.key);
      groups.push(g);
    }
  }
  return { ...main, groups };
}

/** Основная таблица: напрямую (если задан source.id), не вышло — через Apps Script. */
async function fetchMain(t, log) {
  const src = t.source;
  const st = status(t);
  if (!src.id) { st.main = 'apps-script'; return fetchSheets(src.url); }
  try {
    const r = await fetchGsheet({ id: src.id, section: null });
    st.main = 'direct';
    return { header: r.header, fetchedAt: new Date().toISOString(), groups: r.groups };
  } catch (err) {
    if (log) log.warn({ err: String(err) }, 'основная таблица не прочиталась напрямую — читаем через Apps Script');
    st.main = 'apps-script';
    st.directError = String(err).slice(0, 200);
    return fetchSheets(src.url);
  }
}

/** Состояние источников вуза для /api/health: { main: 'direct' | 'apps-script', directError?, extra: { раздел: {...} } }. */
function status(t) {
  t.cache.sources = t.cache.sources || { main: '', extra: {} };
  return t.cache.sources;
}

// Дополнительная таблица не ответила — её группы из прошлой удачной сверки (в памяти, после перезапуска — из последнего
// снимка), чтобы они не «пропадали» и не «появлялись» в журнале правок из-за сбоя Google. Совсем нечем заменить — без них.
// Не отвечает дольше EXTRA_STALE (удалили, закрыли доступ) — её группы убираем: пусть будет видно, что их нет.
const extraCache = new Map();   // 'вуз:id' → groups
const EXTRA_STALE = 7 * 864e5;
const inSection = (g, section) => g.sheet === section;

async function extraGroups(t, cfg, log) {
  const k = t.id + ':' + cfg.id;
  const okKey = 'extra_ok:' + cfg.id;
  const st = status(t).extra;
  try {
    const { groups } = await fetchGsheet(cfg);
    extraCache.set(k, groups);
    const now = new Date().toISOString();
    try { metaSet(t.db, okKey, now); } catch { /* не страшно */ }
    st[cfg.section] = { ok: true, lastOk: now, groups: groups.length };
    return groups;
  } catch (err) {
    st[cfg.section] = { ok: false, lastOk: (st[cfg.section] && st[cfg.section].lastOk) || null, error: String(err).slice(0, 200) };
    let lastOk = null;
    try { lastOk = metaGet(t.db, okKey); } catch { lastOk = null; }
    if (lastOk && Date.now() - Date.parse(lastOk) > EXTRA_STALE) {
      if (log) log.warn({ err: String(err), section: cfg.section, lastOk }, 'дополнительная таблица не отвечает больше недели — без неё');
      return [];
    }
    let groups = extraCache.get(k);
    if (!groups) {
      let prev = null;
      try { prev = getLatestSchedule(t); } catch { prev = null; }
      groups = ((prev && prev.groups) || []).filter((g) => inSection(g, cfg.section));
    }
    if (log) log.warn({ err: String(err), section: cfg.section, kept: groups.length }, 'дополнительная таблица не прочиталась');
    return groups;
  }
}

async function fetchSheets(sourceUrl) {
  const url = sourceUrl + (sourceUrl.includes('?') ? '&' : '?') + 'fn=data';
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'accept': 'application/json' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error('Источник ответил ' + res.status);

  const json = await res.json();
  if (!json || !json.ok || !json.data) {
    throw new Error('Источник вернул не то: ' + JSON.stringify(json).slice(0, 200));
  }

  const d = json.data;
  // Берём только само расписание. Поля вроде now/owner/tgReady считаем у себя.
  return {
    header: String(d.header || ''),
    fetchedAt: d.fetchedAt || new Date().toISOString(),
    groups: Array.isArray(d.groups) ? d.groups : [],
  };
}
