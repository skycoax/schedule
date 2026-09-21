// Хранилище расписания вуза: снимки, сравнение, журнал изменений.
// Функции берут t — вуз (см. tenants.js): у каждого своя база и свои кеши.
// Логика сравнения перенесена из Apps Script (diffSnapshots_) и расширена
// на чередование недель (weekDays) и любое число пар в дне.
import { createHash } from 'node:crypto';
import { metaSet } from './db.js';

function clean(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

/** Что из расписания сохраняем и сравниваем (без fetchedAt и служебной weekMap). */
function core(sched) {
  const out = { header: sched.header || '', groups: sched.groups || [] };
  if (sched.weeks && sched.weeks.length) out.weeks = sched.weeks;
  return out;
}

/** Отпечаток содержимого — чтобы не плодить одинаковые снимки. */
export function hashSchedule(sched) {
  return createHash('sha256').update(JSON.stringify(core(sched))).digest('hex');
}

function indexGroups(sched) {
  const m = {};
  ((sched && sched.groups) || []).forEach((g) => { m[g.key] = g; });
  return m;
}

// Дни группы для недели w: у EduPage-групп — weekDays[w], у остальных — days.
function daysOf(g, w) {
  if (!g) return [];
  if (g.weekDays) return g.weekDays[w] || [];
  return g.days || [];
}

/** Сравнивает два снимка → массив изменений [{type, group, day, pair, time, week?, before, after}]. */
export function diffSchedules(oldS, newS) {
  const changes = [];
  const A = indexGroups(oldS), B = indexGroups(newS);
  const weeks = (newS && newS.weeks) || [];
  const nW = Math.max(1, weeks.length);

  if (oldS && oldS.header && newS.header && oldS.header !== newS.header) {
    changes.push({ type: 'header', before: oldS.header, after: newS.header });
  }

  Object.keys(B).forEach((key) => {
    const nb = B[key], ob = A[key];
    if (!ob) { changes.push({ type: 'group_added', group: nb.name, sheet: nb.sheet }); return; }

    for (let w = 0; w < nW; w++) {
      const oldDays = {}, newDays = {};
      daysOf(ob, w).forEach((d) => { oldDays[d.day] = d.pairs || []; });
      daysOf(nb, w).forEach((d) => { newDays[d.day] = d.pairs || []; });

      Object.keys(newDays).forEach((day) => {
        const op = oldDays[day] || [], np = newDays[day] || [];
        const n = Math.max(op.length, np.length);
        for (let i = 0; i < n; i++) {
          const before = clean(op[i]), after = clean(np[i]);
          if (before === after) continue;
          changes.push({
            type: !before ? 'added' : (!after ? 'removed' : 'changed'),
            group: nb.name, sheet: nb.sheet, day, pair: i + 1,
            time: (nb.times || [])[i] || '',
            ...(nW > 1 ? { week: weeks[w] } : {}),
            before, after,
          });
        }
      });
    }
  });

  // Пропавшие группы.
  Object.keys(A).forEach((key) => {
    if (!B[key]) changes.push({ type: 'group_removed', group: A[key].name, sheet: A[key].sheet });
  });

  return changes;
}

/**
 * Самый свежий снимок как объект расписания, или null.
 * Снимок у EduPage-вуза — мегабайты JSON: разбираем один раз и держим в памяти вуза,
 * пока в базе не появился новее.
 */
export function getLatestSchedule(t) {
  const head = t.db.prepare('SELECT id, fetched_at FROM snapshots ORDER BY id DESC LIMIT 1').get();
  if (!head) return null;
  if (!t.cache.latest || t.cache.latest.id !== head.id) {
    const row = t.db.prepare('SELECT data FROM snapshots WHERE id = ?').get(head.id);
    try { t.cache.latest = { id: head.id, data: JSON.parse(row.data) }; } catch { return null; }
  }
  return { ...t.cache.latest.data, fetchedAt: head.fetched_at };
}

/**
 * Сохраняет снимок. Если содержимое не изменилось — просто отмечает время сверки.
 * Если изменилось — пишет новый снимок и запись в журнал изменений.
 * Возвращает { changed, changes }.
 */
export function saveSnapshot(t, sched) {
  const hash = hashSchedule(sched);
  const prev = t.db.prepare('SELECT id, hash, data FROM snapshots ORDER BY id DESC LIMIT 1').get();
  metaSet(t.db, 'last_poll', new Date().toISOString());

  if (prev && prev.hash === hash) {
    return { changed: false, changes: [] };
  }

  let changes = [];
  if (prev) {
    try { changes = diffSchedules(JSON.parse(prev.data), sched); } catch { changes = []; }
  }

  t.db.prepare('INSERT INTO snapshots (fetched_at, hash, data) VALUES (?, ?, ?)')
    .run(sched.fetchedAt || new Date().toISOString(), hash, JSON.stringify(core(sched)));

  if (changes.length) {
    t.db.prepare('INSERT INTO changes (ts, items) VALUES (?, ?)')
      .run(new Date().toISOString(), JSON.stringify(changes));
  }

  // Держим историю снимков в разумных рамках (snapshotKeep из tenant.json).
  t.db.prepare('DELETE FROM snapshots WHERE id NOT IN (SELECT id FROM snapshots ORDER BY id DESC LIMIT ?)')
    .run(t.snapshotKeep);

  return { changed: !!prev, changes };
}

/**
 * Последние N записей журнала в форме, которую ждёт приложение: [{ts, changes:[…]}].
 * Журнал бывает большим (новая версия расписания — тысячи правок сразу) — кешируем.
 */
export function getChanges(t, limit = 40) {
  const head = t.db.prepare('SELECT MAX(id) id, COUNT(*) n FROM changes').get();
  const key = `${head.id}:${head.n}:${limit}`;
  if (t.cache.changes && t.cache.changes.key === key) return t.cache.changes.data;
  const rows = t.db.prepare('SELECT ts, items FROM changes ORDER BY id DESC LIMIT ?').all(limit);
  const data = rows.map((r) => {
    let items = [];
    try { items = JSON.parse(r.items); } catch { items = []; }
    return { ts: r.ts, changes: items };
  });
  t.cache.changes = { key, data };
  return data;
}
