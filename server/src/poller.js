// Воркер: периодически перечитывает источник вуза и обновляет его базу.
// Приложение всегда читает из базы, поэтому опрос источника на скорость не влияет.
// У каждого вуза свой таймер и свой интервал (pollMinutes в tenant.json).
import { metaGet, metaSet } from './db.js';
import { fetchSchedule } from './source.js';
import { saveSnapshot } from './store.js';

// Карта «понедельник → номер недели» от EduPage. Копим, а не перезаписываем:
// так schedule.js знает и прошлые недели, и может досчитать будущие.
function saveWeekMap(db, fresh) {
  if (!fresh || !Object.keys(fresh).length) return;
  let map = {};
  try { map = JSON.parse(metaGet(db, 'week_map') || '{}'); } catch { map = {}; }
  Object.assign(map, fresh);
  const keep = Object.keys(map).sort().slice(-12);
  metaSet(db, 'week_map', JSON.stringify(Object.fromEntries(keep.map((k) => [k, map[k]]))));
}

export async function pollOnce(t, log) {
  if (t.cache.polling) return { skipped: true };
  t.cache.polling = true;
  try {
    const sched = await fetchSchedule(t);
    saveWeekMap(t.db, sched.weekMap);
    const res = saveSnapshot(t, sched);
    if (log) {
      if (res.changed && res.changes.length) {
        log.info({ changes: res.changes.length }, 'расписание обновилось');
      } else {
        log.debug({ groups: sched.groups.length }, 'сверка без изменений');
      }
    }
    return { ok: true, groups: sched.groups.length, changed: res.changed, changes: res.changes.length };
  } catch (err) {
    if (log) log.error({ err: String(err) }, 'сверка не удалась');
    return { ok: false, error: String(err) };
  } finally {
    t.cache.polling = false;
  }
}

export function startPoller(t, log) {
  // Первый прогон сразу, дальше — по интервалу вуза.
  pollOnce(t, log);
  t.timer = setInterval(() => pollOnce(t, log), t.pollMinutes * 60 * 1000);
  if (t.timer.unref) t.timer.unref();
  return t.timer;
}
