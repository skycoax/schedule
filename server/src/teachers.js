// Индекс преподавателей вуза: из полного снимка расписания собираем, у кого какие
// пары (предмет, кабинет, группа, время). Это те же данные, что видят студенты, —
// просто под другим углом. Полное расписание всех групп есть только на сервере
// (у EduPage-вуза групп больше тысячи, наружу они так не отдаются), поэтому и индекс — тут.
// Строится один раз на снимок и кешируется в t.cache.teachers.
import { getLatestSchedule } from './store.js';
import { parseCell, minutesRange } from './parse-cell.js';
import { nowInTz, weekIndex } from './schedule.js';

const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

// Каноническое имя «Фамилия И.О.»: у вузов СНГ преподаватель в ячейке записан так,
// часто с должностью/кафедрой в хвосте («Наврузова Е.П. асс. СОООЯ»). Берём именно
// «Фамилию И.О.», хвост отбрасываем. ВАЖНО: \b в JS не знает кириллицы (см. parse.ts) —
// поэтому границы не через \b, а по самому шаблону имени.
const NAME_RE_G = /[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?\s+[А-ЯЁ]\.\s*(?:[А-ЯЁ]\.)?/g;
// Должности — срезаем как хвост (для не-кириллических имён, где шаблон выше не сработал).
const RANK_TAIL_RE = /[\s,]*(?:профессор|доцент|ассистент|преподаватель|тьютор|проф|доц|асс|ст\.?\s*преп|ст\.?\s*пр|преп|тьют)\.?\s*$/i;

// Ключ для склейки вариантов одного человека: только буквы, нижний регистр.
// «Наврузова Е.П.» и «Наврузова Е.П. асс.» → один и тот же ключ.
function nameKey(name) {
  return String(name || '').toLowerCase().replace(/[^\p{L}]/gu, '');
}

// Имена преподавателей из текста ячейки (их может быть несколько).
// Кириллица: берём все совпадения «Фамилия И.О.». Иначе (латиница EduPage и т. п.):
// режем по запятым и снимаем должность с хвоста.
function teacherNames(who) {
  const s = String(who || '').replace(/\s+/g, ' ').trim();
  const cyr = s.match(NAME_RE_G);
  if (cyr && cyr.length) return cyr.map((x) => x.replace(/\s+/g, ' ').trim());
  return s.split(/\s*[,;/]\s*/)
    .map((x) => {
      let out = x.trim();
      for (let i = 0; i < 3; i++) { const n = out.replace(RANK_TAIL_RE, '').trim(); if (n === out) break; out = n; }
      return out.replace(/^[·|,;.\s]+|[·|,;.\s]+$/g, '').trim();
    })
    .filter((x) => /\p{L}/u.test(x) && x.replace(/[^\p{L}]/gu, '').length >= 2);
}

const daysOf = (g, w) => (g.weekDays ? (g.weekDays[w] || []) : (g.days || []));

/**
 * Чистая функция: снимок расписания → Map(key → { key, name, lessons: [...] }).
 * lesson = { w, day, i, time, subj, room, group, groupKey }.
 * Экспортируется отдельно, чтобы можно было прогнать на реальных данных без базы.
 */
export function buildTeacherIndex(sched) {
  const teachers = new Map();
  const weeks = (sched && sched.weeks) || [];
  const nW = Math.max(1, weeks.length);
  const groups = (sched && sched.groups) || [];

  for (const g of groups) {
    for (let w = 0; w < nW; w++) {
      for (const d of daysOf(g, w)) {
        const pairs = d.pairs || [];
        for (let i = 0; i < pairs.length; i++) {
          const info = parseCell(pairs[i]);
          if (!info || !info.who) continue;
          const time = (g.times || [])[i] || '';
          for (const nm of teacherNames(info.who)) {
            const key = nameKey(nm);
            if (!key) continue;
            let rec = teachers.get(key);
            if (!rec) { rec = { key, name: nm, variants: new Map(), lessons: [] }; teachers.set(key, rec); }
            rec.variants.set(nm, (rec.variants.get(nm) || 0) + 1);
            rec.lessons.push({ w, day: d.day, i, time, subj: info.subj, room: info.room, group: g.name, groupKey: g.key });
          }
        }
      }
    }
  }

  // Отображаемое имя — самый частый вариант написания, при равенстве — самый длинный.
  for (const rec of teachers.values()) {
    let best = rec.name, bestN = -1;
    for (const [nm, n] of rec.variants) {
      if (n > bestN || (n === bestN && nm.length > best.length)) { best = nm; bestN = n; }
    }
    rec.name = best;
    delete rec.variants;
  }
  return teachers;
}

// Индекс текущего снимка вуза, с кешем по id снимка (как getLatestSchedule).
function indexFor(t) {
  const head = t.db.prepare('SELECT id FROM snapshots ORDER BY id DESC LIMIT 1').get();
  if (!head) return null;
  if (!t.cache.teachers || t.cache.teachers.id !== head.id) {
    const sched = getLatestSchedule(t);
    if (!sched) return null;
    t.cache.teachers = { id: head.id, sched, map: buildTeacherIndex(sched) };
  }
  return t.cache.teachers;
}

/** GET /api/teachers — список преподавателей вуза с числом пар (уникальных слотов). */
export function teachersList(t) {
  const idx = indexFor(t);
  if (!idx) return { ok: true, data: [] };
  const arr = [...idx.map.values()].map((r) => {
    const slots = new Set(r.lessons.map((l) => l.w + '|' + l.day + '|' + l.time + '|' + l.subj));
    return { key: r.key, name: r.name, n: slots.size };
  });
  arr.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  return { ok: true, data: arr };
}

/**
 * GET /api/teacher?key=… — расписание одного преподавателя на текущую неделю.
 * Параллельные группы с той же парой (предмет+кабинет+время) склеиваются: показываем
 * один урок и список групп. days: [{ day, items: [{ time, subj, room, groups: [] }] }].
 */
export function teacherSchedule(t, key) {
  const now = nowInTz();
  const idx = indexFor(t);
  if (!idx) return { ok: true, data: { key, name: '', week: '', now, days: [] } };
  const rec = idx.map.get(String(key || ''));
  if (!rec) return { ok: false, error: 'Преподаватель не найден', now };

  const weeks = idx.sched.weeks || [];
  const wi = weeks.length > 1 ? weekIndex(t.db, weeks.length, now) : 0;

  const byDay = new Map();
  for (const l of rec.lessons) {
    if ((weeks.length > 1 ? l.w : 0) !== wi) continue;
    if (!byDay.has(l.day)) byDay.set(l.day, new Map());
    const dayMap = byDay.get(l.day);
    const k = l.time + '|' + l.subj + '|' + l.room;
    let e = dayMap.get(k);
    if (!e) { e = { time: l.time, subj: l.subj, room: l.room, groups: [] }; dayMap.set(k, e); }
    if (!e.groups.includes(l.group)) e.groups.push(l.group);
  }

  const days = DAYS.filter((d) => byDay.has(d)).map((d) => {
    const items = [...byDay.get(d).values()];
    items.sort((a, b) => ((minutesRange(a.time) || { a: 1e9 }).a) - ((minutesRange(b.time) || { a: 1e9 }).a));
    return { day: d, items };
  });

  return { ok: true, data: { key: rec.key, name: rec.name, week: weeks.length > 1 ? weeks[wi] : '', now, days } };
}
