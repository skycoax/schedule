// Источник для вузов на EduPage (ТГЭУ: tsue.edupage.org).
//
// EduPage отдаёт публичное расписание одним большим JSON — по сути дамп базы:
// classes (группы), lessons (что за занятие), cards (когда и где), periods (звонки)…
// Здесь это превращается в ту же форму, что и таблица КФУ: группы с парами по дням.
// Поэтому приложение, журнал правок, отзывы и статистика не знают, откуда данные.
//
// Чередование недель (A/B) храним целиком: у группы weekDays[0], weekDays[1].
// Какую неделю показывать сейчас, решает schedule.js — по карте «понедельник →
// неделя», которую мы спрашиваем у самого EduPage, а не вычисляем сами.
const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

async function call(host, path, func, args) {
  const url = `https://${host}/timetable/server/${path}?__func=${func}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 (schedule viewer)' },
    body: JSON.stringify({ __args: args, __gsh: '00000000' }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`EduPage ${func} ответил ${res.status}`);
  const json = await res.json();
  if (!json || !json.r) throw new Error(`EduPage ${func} вернул не то`);
  return json.r;
}

const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const hhmm = (t) => clean(t).replace(/^(\d):/, '0$1');

// Даты — по Ташкенту, в виде 'YYYY-MM-DD'.
const tashkentToday = () => new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function mondayOf(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  return addDays(iso, -((d.getUTCDay() + 6) % 7));
}

// «MENEJMENT FAKULTETI» → «Menejment fakulteti»
function pretty(s) {
  const t = clean(s).toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// Форма обучения по заголовку раздела; пусто — дневной бакалавриат.
function programOf(name) {
  if (/magistr|\bmsc\b/i.test(name)) return 'Магистратура';
  if (/kechki/i.test(name)) return 'Вечернее';
  if (/masofav|масофав/i.test(name)) return 'Дистанционное';
  return '';
}
const PROGRAM_ORDER = { '': 0, 'Магистратура': 1, 'Вечернее': 2, 'Дистанционное': 3 };

// Год набора в коде группы. Вузы пишут его по-разному:
// «MO-900/26» (в конце), «CIE26-1» и «MUA-25-01» (перед номером группы).
function cohortYearOf(name) {
  const atStart = name.match(/^(\d{2})-\d{2}(?:\D|$)/);
  const beforeGroup = name.match(/(?:^|\D)(\d{2})-\d+[a-zа-я*]*$/i);
  const atEnd = name.match(/[/\-=](\d{2})[a-zа-я*]*$/i);
  return Number((atStart || beforeGroup || atEnd || [])[1]) || 0;
}

// В некоторых EduPage (EMU) нет строк «1 KURS», а курс зашит первой цифрой
// трёхзначного номера после буквенного кода: B101AR → 1, S501BR → 5,
// TPI301AO → 3. Ограниченная форма не задевает годы набора вроде CIE26-1.
function ordinalCourseOf(name) {
  const match = clean(name).match(/^[^\d]{1,8}([1-6])\d{2}(?:\D|$)/i);
  return match ? match[1] : '';
}

// Несколько занятий в одном слоте (поток, подгруппы) — одной ячейкой.
// Формат «Предмет · ауд. 1/111 · Преподаватель» разбирает parseCell на фронте.
function cellText(list) {
  if (!list.length) return '';
  const uniq = (a) => [...new Set(a.filter(Boolean))];
  const subj = uniq(list.map((e) => e.subj)).join(' / ');
  const room = uniq(list.map((e) => e.room)).join(', ');
  const who = uniq(list.map((e) => e.who)).join(', ');
  return [subj, room && 'ауд. ' + room, who].filter(Boolean).join(' · ');
}

/** Нормализованное расписание: { header, fetchedAt, groups, weeks, weekMap }. */
export async function fetchEdupage(host, options = {}) {
  if (!host) throw new Error('Не задан адрес EduPage (source.host в tenant.json)');
  const today = tashkentToday();
  // Учебный год в EduPage переключается 1 августа.
  const eduYear = Number(today.slice(5, 7)) >= 8 ? Number(today.slice(0, 4)) : Number(today.slice(0, 4)) - 1;

  // 1. Какая версия расписания действует: последняя опубликованная, начавшаяся не позже сегодня.
  const viewer = await call(host, 'ttviewer.js', 'getTTViewerData', [null, eduYear]);
  const list = (viewer.regular && viewer.regular.timetables) || [];
  const visible = list.filter((t) => !t.hidden);
  const current = visible
    .filter((t) => String(t.datefrom || '') <= today)
    .sort((a, b) => String(b.datefrom).localeCompare(String(a.datefrom)))[0];
  const ttNum = (current && current.tt_num) || (viewer.regular && viewer.regular.default_num) || (visible[0] && visible[0].tt_num);
  if (!ttNum) throw new Error('EduPage: нет опубликованного расписания');
  const tt = list.find((t) => t.tt_num === ttNum) || {};

  // 2. Само расписание.
  const data = await call(host, 'regulartt.js', 'regularttGetData', [null, ttNum]);
  const T = {};
  for (const t of data.dbiAccessorRes.tables) T[t.id] = t.data_rows || [];
  const byId = (rows) => Object.fromEntries((rows || []).map((r) => [r.id, r]));
  const lessons = byId(T.lessons), subjects = byId(T.subjects), teachers = byId(T.teachers);
  const rooms = byId(T.classrooms), subgroups = byId(T.groups);
  const classIdsWithLessons = new Set(Object.values(lessons).flatMap((lesson) => lesson.classids || []));

  const periods = (T.periods || []).slice().sort((a, b) => Number(a.period) - Number(b.period));
  const nP = periods.length;
  const pIndex = Object.fromEntries(periods.map((p, i) => [String(p.period), i]));
  const weeks = (T.weeks || []).map((w) => clean(w.name));
  const nW = Math.max(1, weeks.length);

  // 3. Раскладываем карточки по группам. EduPage может делить одну
  // реальную пару на несколько технических периодов (IUT — обычно 3–4 по 30 минуты).
  // Храним карточку как одно событие с началом и концом, чтобы не показывать её 3–4 раза.
  const slots = new Map();
  const put = (cid, w, d, start, end, entry) => {
    let grid = slots.get(cid);
    if (!grid) {
      grid = Array.from({ length: nW }, () => Array.from({ length: DAYS.length }, () => []));
      slots.set(cid, grid);
    }
    const events = grid[w][d];
    if (!events.some((e) => e.start === start && e.end === end && e.entry.key === entry.key)) {
      events.push({ start, end, entry });
    }
  };

  for (const card of T.cards || []) {
    const l = lessons[card.lessonid];
    if (!l || !card.period || !/1/.test(card.days || '')) continue;
    const start = pIndex[String(card.period)];
    if (start === undefined) continue;
    const subjName = clean(subjects[l.subjectid] && subjects[l.subjectid].name);
    if (!subjName) continue;

    const who = (l.teacherids || []).map((id) => clean(teachers[id] && teachers[id].short)).filter(Boolean).join(', ');
    const room = (card.classroomids || []).map((id) => clean(rooms[id] && rooms[id].short)).filter(Boolean).join(', ');
    // Если занятие не у всей группы, а у подгруппы — пишем её в названии.
    const parts = [...new Set((l.groupids || []).map((id) => subgroups[id]).filter((g) => g && !g.entireclass).map((g) => clean(g.name)))];
    const subj = parts.length ? `${subjName} (${parts.join(', ')})` : subjName;
    const entry = { key: `${subj}|${room}|${who}`, subj, room, who };

    const dur = Math.max(1, Number(l.durationperiods) || 1);
    const end = Math.min(nP, start + dur);
    for (let w = 0; w < nW; w++) {
      if (((card.weeks || '')[w] || '1') !== '1') continue;
      for (let d = 0; d < DAYS.length; d++) {
        if ((card.days || '')[d] !== '1') continue;
        for (const cid of l.classids || []) put(cid, w, d, start, end, entry);
      }
    }
  }

  // 4. Группы в порядке EduPage: заголовки «ФАКУЛЬТЕТ» и «1 KURS» идут строками
  // без пар прямо в списке групп — по ним и восстанавливаем, что к чему относится.
  const yy = eduYear % 100;
  // Иногда форма обучения есть только в названии версии расписания,
  // например «2-kurs MSc», а отдельных строк-заголовков нет.
  let faculty = '', facultyNo = 0, program = programOf(tt.text), course = '';
  const seen = new Set();
  const rows = [];
  for (const c of T.classes || []) {
    const name = clean(c.name);
    if (!name || name === '-') continue;

    const includeEmptyGroup = options.includeUnscheduledGroups === true && classIdsWithLessons.has(c.id);
    if (!slots.has(c.id) && !includeEmptyGroup) {
      const isHeader = /kurs/i.test(name) || !/\d/.test(name) || /fakultet|audit|magistr/i.test(name);
      if (!isHeader) continue; // группа без пар в этой версии расписания
      const prog = programOf(name);
      const k = name.match(/(\d)\s*-?\s*kurs/i);
      if (k) {
        // «1 KURS» после «4 KURS» без заголовка факультета — начался факультет без имени.
        if (prog || (course && Number(k[1]) <= Number(course))) { faculty = ''; facultyNo++; }
        if (prog) program = prog;
        course = k[1];
      } else {
        faculty = programOf(name) ? '' : pretty(name);
        facultyNo++;
        program = prog;
        course = '';
      }
      continue;
    }

    // Курс — из заголовка; если его не было, по году набора в коде («…/26» → 1 курс).
    let crs = course;
    if (!crs) {
      const cohortYear = cohortYearOf(name);
      const n = cohortYear ? yy - cohortYear + 1 : 0;
      if (n >= 1 && n <= 6) crs = String(n);
    }
    if (!crs) crs = ordinalCourseOf(name);
    let key = name;
    for (let i = 2; seen.has(key); i++) key = `${name} (${i})`;
    seen.add(key);

    const grid = slots.get(c.id) || Array.from(
      { length: nW },
      () => Array.from({ length: DAYS.length }, () => []),
    );
    // У каждой группы свой набор времён начала. Если в разные дни пара с одним
    // началом длится 3 или 4 периода, берём более поздний конец: на экране это всё равно один слот.
    const events = grid.flat(2);
    const starts = [...new Set(events.map((e) => e.start))].sort((a, b) => a - b);
    const ends = Object.fromEntries(starts.map((start) => [start,
      Math.max(...events.filter((e) => e.start === start).map((e) => e.end))]));
    const groupTimes = starts.map((start) =>
      `${hhmm(periods[start].starttime)} – ${hhmm(periods[ends[start] - 1].endtime)}`);
    const weekDays = grid.map((wk) => DAYS.map((day, d) => ({
      day,
      pairs: starts.map((start) => cellText(wk[d].filter((e) => e.start === start).map((e) => e.entry))),
    })));
    rows.push({
      group: {
        key,
        sheet: crs ? (program ? `${program} · ${crs} курс` : `${crs} курс`) : (program || 'Другие группы'),
        course: crs,
        name,
        sub: faculty,
        link: '',
        times: groupTimes,
        ...(nW > 1 ? { weekDays } : { days: weekDays[0] }),
      },
      sort: [PROGRAM_ORDER[program] ?? 9, Number(crs) || 9, facultyNo],
    });
  }

  rows.sort((a, b) => {
    for (let i = 0; i < 3; i++) if (a.sort[i] !== b.sort[i]) return a.sort[i] - b.sort[i];
    return a.group.name.localeCompare(b.group.name, 'ru', { numeric: true });
  });

  // 5. Какая неделя (A/B) на этой и следующей неделе — спрашиваем у EduPage.
  const weekMap = {};
  if (nW > 1 && slots.size) {
    const anyClass = slots.keys().next().value;
    for (const mon of [mondayOf(today), addDays(mondayOf(today), 7)]) {
      try {
        const r = await call(host, 'currenttt.js', 'curentttGetData', [null, {
          year: eduYear, datefrom: mon, dateto: addDays(mon, 6), table: 'classes', id: anyClass,
          showColors: true, showIgroupsInClasses: false, showOrig: true, log_module: 'CurrentTTView',
        }]);
        const i = weeks.indexOf(clean(r.week_name));
        if (i >= 0) weekMap[mon] = i;
      } catch { /* неделю досчитаем по чередованию от известной */ }
    }
  }

  const g = T.globals && T.globals[0];
  return {
    header: clean(g && g.settings && g.settings.m_strDateBellowTimeTable) || clean(tt.text),
    fetchedAt: new Date().toISOString(),
    groups: rows.map((r) => r.group),
    weeks: nW > 1 ? weeks : [],
    weekMap,
  };
}
