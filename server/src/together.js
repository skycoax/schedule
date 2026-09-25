// Совместные пары (поток): другие группы вуза, у которых в то же время пара
// в той же аудитории или у того же преподавателя по тому же предмету.
// Полное расписание всех групп есть только на сервере, поэтому и поиск тут:
// приложению к выбранной группе приходит готовый список «с кем вместе».
// Индекс строится один раз на снимок и кешируется в t.cache.together.
import { parseCell, minutesRange, teacherNames, nameKey } from './parse-cell.js';

const daysOf = (g, w) => (g.weekDays ? (g.weekDays[w] || []) : (g.days || []));

// Аудитория как ключ: «117 ауд.» и «117 ауд» — одна. Без цифры («Онлайн», «Спортзал»,
// «Masofaviy») — не аудитория: онлайн-пары разных групп в одно время не совместные.
function roomKey(room) {
  const k = String(room || '').toLowerCase().replace(/[^\p{L}\p{N}/]/gu, '');
  return /\d/.test(k) ? k : '';
}

// Предмет как ключ. Цифры оставляем: у КФУ аудитория бывает прямо в названии
// («Математический анализ 109 П ауд»), и «109» с «221» не должны слиться.
function subjKey(subj) {
  return String(subj || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

// Заглушки вместо преподавателя: у них «одна и та же пара» в разных группах — не поток.
const NO_TEACHER_RE = /vacan|вакан|^tba$|^tbd$|staff|unknown|o['‘`’]?qituvchi$|преподаватель$/i;

/**
 * Ключи, по которым пара «та же самая» у разных групп (время — отдельно, в слоте).
 * Предмет должен совпадать всегда: иначе ловятся ошибки источника и «аудитории»
 * размером с целый корпус. Есть аудитория с номером — сверяем по ней (преподаватель
 * не может вести в двух местах сразу, так что разные аудитории — разные пары).
 * Нет её (онлайн, «Актовый зал», у КФУ номер внутри названия) — по преподавателю.
 */
function lessonKeys(info) {
  const subj = subjKey(info.subj);
  if (!subj) return [];
  const room = roomKey(info.room);
  if (room) return ['r|' + room + '|' + subj];
  const keys = [];
  for (const nm of teacherNames(info.who)) {
    const t = nameKey(nm);
    if (t && !NO_TEACHER_RE.test(nm.trim())) keys.push('t|' + t + '|' + subj);
  }
  return keys;
}

/**
 * Чистая функция: снимок → Map(ключ → [{ key, name }]).
 * Ключ = неделя|день|начало пары в минутах|ключ пары. Группа попадает в список,
 * если у неё в этот слот пара с таким же ключом. Экспортируется для проверки на данных.
 */
export function buildTogetherIndex(sched) {
  const index = new Map();
  const nW = Math.max(1, ((sched && sched.weeks) || []).length);
  for (const g of (sched && sched.groups) || []) {
    for (let w = 0; w < nW; w++) {
      for (const d of daysOf(g, w)) {
        const pairs = d.pairs || [];
        for (let i = 0; i < pairs.length; i++) {
          const info = parseCell(pairs[i]);
          const mm = info && minutesRange((g.times || [])[i]);
          if (!mm) continue;
          const slot = w + '|' + d.day + '|' + mm.a + '|';
          for (const k of lessonKeys(info)) {
            let arr = index.get(slot + k);
            if (!arr) { arr = []; index.set(slot + k, arr); }
            if (!arr.some((x) => x.key === g.key)) arr.push({ key: g.key, name: g.name });
          }
        }
      }
    }
  }
  return index;
}

/**
 * С кем у группы g совместные пары на неделе w: { 'Пн#3': ['Группа 1', …] }
 * (номер пары с 1 — как в журнале правок). Пары без соседей в ответ не попадают.
 */
export function togetherOf(index, g, w) {
  const out = {};
  for (const d of daysOf(g, w)) {
    const pairs = d.pairs || [];
    for (let i = 0; i < pairs.length; i++) {
      const info = parseCell(pairs[i]);
      const mm = info && minutesRange((g.times || [])[i]);
      if (!mm) continue;
      const slot = w + '|' + d.day + '|' + mm.a + '|';
      const names = [];
      for (const k of lessonKeys(info)) {
        for (const x of index.get(slot + k) || []) {
          if (x.key !== g.key && !names.includes(x.name)) names.push(x.name);
        }
      }
      if (names.length) out[d.day + '#' + (i + 1)] = names.sort((a, b) => a.localeCompare(b, 'ru'));
    }
  }
  return out;
}

// Индекс текущего снимка вуза, с кешем по id снимка (как у индекса преподавателей).
export function togetherIndexFor(t, sched) {
  const head = t.db.prepare('SELECT id FROM snapshots ORDER BY id DESC LIMIT 1').get();
  if (!head) return null;
  if (!t.cache.together || t.cache.together.id !== head.id) {
    t.cache.together = { id: head.id, map: buildTogetherIndex(sched) };
  }
  return t.cache.together.map;
}
