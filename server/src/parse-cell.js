// Серверный разбор ячейки расписания — держать в паре с web/src/lib/parse.ts.
// В браузере это parse.ts (для карточек студента); на сервере та же логика нужна
// индексу преподавателей (teachers.js), где полное расписание всех групп есть только тут.
// \b в JS не знает кириллицы — границы слов задаём явно, как в оригинале.

const ROOM_RE = /^(.*?)(\d{1,4}\s*(?:ауд|аудитория|ком|каб|зал)(?![А-Яа-яЁё])\.?(?:\s*[A-Z]{2,5}(?![a-zA-Z]))?)\s*(.*)$/i;
const WHO_RE = /(?:(?:проф|доц|асс|ст\.\s*пр|преп)\.?\s*[А-ЯЁ][а-яё]+|[А-ЯЁ][а-яё]+\s+[А-ЯЁ]\.)/;

/** Ячейка → { subj, room, who } или null для пустой. Тот же алгоритм, что в parse.ts. */
export function parseCell(txt) {
  let t = String(txt || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const link = t.match(/https?:\/\/\S+/);
  if (link) t = t.replace(link[0], '').trim();
  if (!t) return null;

  // Формат EduPage: «Предмет · ауд. 1/111 · Преподаватель» — части явные.
  if (t.includes(' · ')) {
    const parts = t.split(' · ').map((s) => s.trim()).filter(Boolean);
    const out = { subj: parts[0] || '', room: '', who: '' };
    parts.slice(1).forEach((p) => {
      if (/^ауд\.\s*/i.test(p)) out.room = p.replace(/^ауд\.\s*/i, '');
      else out.who = out.who ? out.who + ', ' + p : p;
    });
    return out.subj ? out : null;
  }

  let subj = t, room = '', who = '';
  const m = t.match(ROOM_RE);
  if (m && m[1].trim()) { subj = m[1].trim(); room = m[2].trim(); who = m[3].trim(); }
  if (!who) {
    const w = subj.match(WHO_RE);
    if (w && w.index !== undefined && w.index > 0) {
      who = subj.slice(w.index).trim();
      subj = subj.slice(0, w.index).trim();
    }
  }
  return {
    subj: subj.replace(/[,.\s]+$/, ''),
    room,
    who: who.replace(/^[,\s]+/, ''),
  };
}

// ─── Преподаватели в ячейке (индекс преподавателей и совместные пары) ───

// Каноническое имя «Фамилия И.О.»: у вузов СНГ преподаватель в ячейке записан так,
// часто с должностью/кафедрой в хвосте («Наврузова Е.П. асс. СОООЯ»). Берём именно
// «Фамилию И.О.», хвост отбрасываем. ВАЖНО: \b в JS не знает кириллицы (см. parse.ts) —
// поэтому границы не через \b, а по самому шаблону имени.
const NAME_RE_G = /[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?\s+[А-ЯЁ]\.\s*(?:[А-ЯЁ]\.)?/g;
// Должности — срезаем как хвост (для не-кириллических имён, где шаблон выше не сработал).
const RANK_TAIL_RE = /[\s,]*(?:профессор|доцент|ассистент|преподаватель|тьютор|проф|доц|асс|ст\.?\s*преп|ст\.?\s*пр|преп|тьют)\.?\s*$/i;

// Ключ для склейки вариантов одного человека: только буквы, нижний регистр.
// «Наврузова Е.П.» и «Наврузова Е.П. асс.» → один и тот же ключ.
export function nameKey(name) {
  return String(name || '').toLowerCase().replace(/[^\p{L}]/gu, '');
}

// Имена преподавателей из текста ячейки (их может быть несколько).
// Кириллица: берём все совпадения «Фамилия И.О.». Иначе (латиница EduPage и т. п.):
// режем по запятым и снимаем должность с хвоста.
export function teacherNames(who) {
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

/** «08:30 – 09:50» → { a: минуты начала, b: минуты конца } или null. */
export function minutesRange(range) {
  const m = String(range || '').match(/(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})/);
  return m ? { a: +m[1] * 60 + +m[2], b: +m[3] * 60 + +m[4] } : null;
}
