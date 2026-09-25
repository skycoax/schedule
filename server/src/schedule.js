// Сборка ответа для приложения: расписание вуза + «сейчас» в часовом поясе Ташкента.
import { config } from './config.js';
import { metaGet } from './db.js';
import { getLatestSchedule, getChanges } from './store.js';
import { togetherIndexFor, togetherOf } from './together.js';

const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

/** Текущий момент в Asia/Tashkent — как его ждёт фронтенд. */
export function nowInTz() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('ru-RU', {
    timeZone: config.tz,
    weekday: 'short', hour: '2-digit', minute: '2-digit',
    day: '2-digit', month: '2-digit', hour12: false,
  }).formatToParts(now);

  const get = (t) => (parts.find((p) => p.type === t) || {}).value || '';
  const hour = Number(get('hour'));
  const minute = Number(get('minute'));

  // weekday 'short' в ru-RU даёт «пн», «вт», … — приводим к нашему виду.
  const wd = get('weekday').toLowerCase().slice(0, 2);
  const map = { 'пн': 'Пн', 'вт': 'Вт', 'ср': 'Ср', 'чт': 'Чт', 'пт': 'Пт', 'сб': 'Сб', 'вс': 'Вс' };

  return {
    day: map[wd] || DAYS[0],
    minutes: hour * 60 + minute,
    dateLabel: get('day') + '.' + get('month'),
    stamp: get('hour') + ':' + get('minute'),
  };
}

// ─── Чередование недель (A/B) ───
const DAY_MS = 86400000;
function mondayUtc(ms) {
  const d = new Date(ms);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY_MS;
}

// Какую неделю показывать. В воскресенье и в субботу после 15:00 смотрят уже на
// понедельник, поэтому берём следующую. Номер недели — из карты, которую поллер
// спросил у EduPage; для незнакомого понедельника досчитываем чередование от известного.
export function weekIndex(db, count, now) {
  const tashkent = Date.now() + 5 * 3600e3;
  const nextWeek = now.day === 'Вс' || (now.day === 'Сб' && now.minutes >= 15 * 60);
  const monday = mondayUtc(tashkent) + (nextWeek ? 7 * DAY_MS : 0);
  const iso = new Date(monday).toISOString().slice(0, 10);

  let map = {};
  try { map = JSON.parse(metaGet(db, 'week_map') || '{}'); } catch { map = {}; }
  if (map[iso] !== undefined) return map[iso] % count;
  const known = Object.keys(map).sort().pop();
  if (!known) return 0;
  const diff = Math.round((monday - Date.parse(known + 'T00:00:00Z')) / (7 * DAY_MS));
  return (((map[known] + diff) % count) + count) % count;
}

// Больше стольких групп полный список не отдаём даже без ?group= — это мегабайты.
const FULL_LIST_MAX = 150;

/**
 * Полный ответ GET /api/schedule для вуза t.
 * ?group=KEY — лёгкий режим: у всех групп только названия, пары — у выбранной,
 * правки — только её. Фронтенд всегда шлёт group (пусто, если ещё не выбрана).
 */
export function scheduleResponse(t, query = {}) {
  const now = nowInTz();
  const sched = getLatestSchedule(t);
  if (!sched) {
    return { header: '', groups: [], changes: [], now, fetchedAt: null, ready: false, week: '' };
  }

  const all = sched.groups || [];
  const weeks = sched.weeks || [];
  const wi = weeks.length > 1 ? weekIndex(t.db, weeks.length, now) : 0;
  const resolve = (g) => {
    const { weekDays, ...rest } = g;
    return weekDays ? { ...rest, days: weekDays[wi] || weekDays[0] || [] } : rest;
  };

  const wanted = typeof query.group === 'string' ? query.group : null;
  let groups, changes = getChanges(t, 40);

  if (wanted === null && all.length <= FULL_LIST_MAX) {
    groups = all.map(resolve);
  } else {
    const selected = all.find((g) => g.key === wanted) || null;
    // Совместные пары выбранной группы: с кем она сидит в одной аудитории (together.js).
    const withOf = (g) => {
      const idx = togetherIndexFor(t, sched);
      return idx ? togetherOf(idx, g, weeks.length > 1 ? wi : 0) : {};
    };
    groups = all.map((g) => (g === selected ? { ...resolve(g), with: withOf(g) } : {
      key: g.key, sheet: g.sheet, course: g.course, name: g.name, sub: g.sub || '',
      link: '', times: [], days: [],
    }));
    const name = selected ? selected.name : null;
    changes = changes
      .map((e) => ({ ts: e.ts, changes: (e.changes || []).filter((c) => name && c.group === name) }))
      .filter((e) => e.changes.length);
  }

  return {
    header: sched.header || '',
    groups,
    changes,
    now,
    fetchedAt: sched.fetchedAt || null,
    ready: true,
    week: weeks.length > 1 ? weeks[wi] : '',
  };
}
