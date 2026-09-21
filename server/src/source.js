// Источник расписания вуза — задаётся в tenant.json:
//
//   "source": { "type": "sheets", "url": "…/exec" }  — Google-таблица через публичный
//     эндпоинт Apps Script (таблица КФУ приватная: читать её напрямую сервер не может,
//     а скрипт работает под аккаунтом владельца таблицы);
//   "source": { "type": "edupage", "host": "tsue.edupage.org" } — см. source-edupage.js.
//
// Остальная система от источника не зависит: оба отдают одну и ту же форму.
import { fetchEdupage } from './source-edupage.js';

/**
 * Нормализованное расписание вуза: { header, fetchedAt, groups, weeks?, weekMap? }.
 * groups: [{ key, sheet, course, name, sub?, link, times[], days:[{day, pairs[]}] | weekDays:[[…],[…]] }]
 */
export async function fetchSchedule(t) {
  if (t.source.type === 'edupage') return fetchEdupage(t.source.host, {
    includeUnscheduledGroups: t.source.includeUnscheduledGroups === true,
  });
  return fetchSheets(t.source.url);
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
